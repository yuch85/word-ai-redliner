/* global Word, Office */

// Import CSS for webpack to bundle
import './taskpane.css';
import { applyTokenMapStrategy, applySentenceDiffStrategy } from 'office-word-diff';
import { sendPrompt, testConnection as llmTestConnection } from '../lib/llm-client.js';

// Global configuration (defaults from env, overridable via UI/localStorage)
let config = {
    backend: 'ollama',
    trackChangesEnabled: true,
    lineDiffEnabled: false,
    backends: {
        ollama: {
            url: process.env.DEFAULT_OLLAMA_URL || '/ollama',
            apiKey: '',
            model: process.env.DEFAULT_MODEL || 'gpt-oss:20b'
        },
        vllm: {
            url: process.env.DEFAULT_VLLM_URL || '/vllm',
            apiKey: '',
            model: process.env.DEFAULT_VLLM_MODEL || 'qwen3.5-35b-a3b'
        }
    }
};

/**
 * Returns the config object for the currently selected backend.
 * @returns {{ url: string, apiKey: string, model: string }}
 */
function getActiveBackendConfig() {
    return config.backends[config.backend];
}

let prompts = [];
let isProcessing = false;

Office.onReady((info) => {
    if (info.host === Office.HostType.Word) {
        initialize();
    }
});

function initialize() {
    // Load saved settings and prompts
    loadSettings();
    loadPrompts();

    // Setup event listeners
    document.getElementById("reviewBtn").onclick = handleReviewSelection;
    document.getElementById("saveSettingsBtn").onclick = saveSettings;
    document.getElementById("clearLogsBtn").onclick = clearLogs;
    document.getElementById("settingsToggle").onclick = toggleSettings;
    document.getElementById("runVerificationBtn").onclick = runVerification;
    document.getElementById("backendSelect").onchange = handleBackendSwitch;

    // Prompt management
    document.getElementById("promptSelect").onchange = handlePromptSelect;
    document.getElementById("savePromptBtn").onclick = showSavePromptModal;
    document.getElementById("deletePromptBtn").onclick = handleDeletePrompt;
    document.getElementById("resetPromptBtn").onclick = handleResetPrompt;
    document.getElementById("savePromptConfirmBtn").onclick = handleSavePrompt;
    document.getElementById("savePromptCancelBtn").onclick = hideSavePromptModal;

    // Initial UI state
    updateUIFromConfig();

    // Auto-test connection and load models
    testConnectionUI();

    addLog("Contract Review Add-in initialized.", "info");
}

// ============================================================================
// SETTINGS & UI
// ============================================================================

function loadSettings() {
    try {
        const saved = localStorage.getItem('wordAI.config');
        if (saved) {
            const parsed = JSON.parse(saved);

            if (parsed.ollamaUrl && !parsed.backends) {
                // Old flat format detected -- migrate to nested backends structure
                config.backend = 'ollama';
                config.backends.ollama.url = parsed.ollamaUrl;
                config.backends.ollama.apiKey = parsed.apiKey || '';
                config.backends.ollama.model = parsed.selectedModel || config.backends.ollama.model;
                if (typeof parsed.trackChangesEnabled === 'boolean') {
                    config.trackChangesEnabled = parsed.trackChangesEnabled;
                }
                if (typeof parsed.lineDiffEnabled === 'boolean') {
                    config.lineDiffEnabled = parsed.lineDiffEnabled;
                }
                // Save migrated config immediately so migration only runs once
                localStorage.setItem('wordAI.config', JSON.stringify(config));
            } else {
                // New nested format -- merge normally
                config = { ...config, ...parsed };
            }
        }
    } catch (e) {
        console.error("Failed to load settings:", e);
    }
}

function saveSettings() {
    const backend = document.getElementById("backendSelect").value;
    const endpointUrl = document.getElementById("endpointUrl").value.trim();
    const apiKey = document.getElementById("apiKey").value.trim();
    const trackChanges = document.getElementById("trackChangesCheckbox").checked;
    const lineDiff = document.getElementById("lineDiffCheckbox").checked;
    const selectedModel = document.getElementById("modelSelect").value;

    config.backend = backend;
    config.backends[backend].url = endpointUrl || config.backends[backend].url;
    config.backends[backend].apiKey = apiKey;
    // Only update model for Ollama -- vLLM model is read-only
    if (backend === 'ollama') {
        config.backends[backend].model = selectedModel || config.backends[backend].model;
    }
    config.trackChangesEnabled = trackChanges;
    config.lineDiffEnabled = lineDiff;

    try {
        localStorage.setItem('wordAI.config', JSON.stringify(config));
        addLog("Settings saved.", "success");

        // Re-test connection with new settings
        testConnectionUI();
    } catch (e) {
        addLog(`Failed to save settings: ${e.message}`, "error");
    }
}

function updateUIFromConfig() {
    const backendConfig = getActiveBackendConfig();
    const modelSelect = document.getElementById("modelSelect");

    document.getElementById("backendSelect").value = config.backend;
    document.getElementById("endpointUrl").value = backendConfig.url;
    document.getElementById("apiKey").value = backendConfig.apiKey;
    document.getElementById("trackChangesCheckbox").checked = config.trackChangesEnabled;
    document.getElementById("lineDiffCheckbox").checked = config.lineDiffEnabled;

    if (config.backend === 'vllm') {
        // vLLM: show configured model as read-only (disabled dropdown)
        modelSelect.innerHTML = '';
        const option = document.createElement('option');
        option.value = backendConfig.model;
        option.textContent = backendConfig.model;
        modelSelect.appendChild(option);
        modelSelect.disabled = true;
    } else {
        // Ollama: enable dropdown (models populated by testConnectionUI)
        modelSelect.disabled = false;
    }
}

/**
 * Handles switching between backends in the UI.
 * Restores the selected backend's saved settings and triggers a connection test.
 */
function handleBackendSwitch() {
    config.backend = document.getElementById('backendSelect').value;
    updateUIFromConfig();
    testConnectionUI();
}

function toggleSettings() {
    const content = document.getElementById("settingsContent");
    const header = document.getElementById("settingsToggle");
    content.classList.toggle("active");
    header.classList.toggle("active");
}

// ============================================================================
// PROMPT MANAGEMENT
// ============================================================================

function initializeDefaultPrompts() {
    return [
        {
            id: 'legal-review',
            name: 'Legal Review',
            template: 'Review and improve the following contract text for legal issues, ambiguities, and risks. Return ONLY the revised text with no explanations, commentary, or introductory phrases:\n\n{selection}',
            description: 'Comprehensive legal review of contract text'
        },
        {
            id: 'plain-english',
            name: 'Plain English',
            template: 'Rewrite the following legal text in plain, simple English while maintaining legal accuracy. Return ONLY the rewritten text with no explanations, commentary, or introductory phrases:\n\n{selection}',
            description: 'Convert legal jargon to plain language'
        }
    ];
}

async function loadPrompts() {
    try {
        // Try to fetch from server
        const response = await fetch('/api/prompts', {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });

        if (response.ok) {
            prompts = await response.json();
            addLog(`Loaded ${prompts.length} prompts from server`, "info");
        } else {
            throw new Error(`Server returned ${response.status}`);
        }
    } catch (error) {
        // Fallback to localStorage or defaults
        const saved = localStorage.getItem('wordAI.prompts');
        if (saved) {
            prompts = JSON.parse(saved);
        } else {
            prompts = initializeDefaultPrompts();
        }
    }
    renderPrompts();
}

function renderPrompts() {
    const select = document.getElementById('promptSelect');
    const currentValue = select.value;

    select.innerHTML = '<option value="">Select a prompt...</option>';

    prompts.forEach(prompt => {
        const option = document.createElement('option');
        option.value = prompt.id;
        option.textContent = prompt.name;
        if (prompt.description) {
            option.title = prompt.description;
        }
        select.appendChild(option);
    });

    if (currentValue) {
        select.value = currentValue;
    }
}

function handlePromptSelect(e) {
    const promptId = e.target.value;
    if (!promptId) return;

    const prompt = prompts.find(p => p.id === promptId);
    if (prompt) {
        document.getElementById('promptTextarea').value = prompt.template;
        addLog(`Loaded prompt: ${prompt.name}`, "info");
    }
}

function showSavePromptModal() {
    document.getElementById('savePromptModal').classList.add('active');
    document.getElementById('promptName').value = '';
    document.getElementById('promptDescription').value = '';
    document.getElementById('promptName').focus();
}

function hideSavePromptModal() {
    document.getElementById('savePromptModal').classList.remove('active');
}

async function handleSavePrompt() {
    const name = document.getElementById('promptName').value.trim();
    const description = document.getElementById('promptDescription').value.trim();
    const template = document.getElementById('promptTextarea').value.trim();

    if (!name) {
        addLog('Please enter a prompt name', "warning");
        return;
    }

    if (!template) {
        addLog('Prompt template cannot be empty', "warning");
        return;
    }

    const id = name.toLowerCase().replace(/\s+/g, '-');
    const newPrompt = { id, name, template, description };

    // Update local array
    const existingIndex = prompts.findIndex(p => p.id === id);
    if (existingIndex !== -1) {
        prompts[existingIndex] = newPrompt;
    } else {
        prompts.push(newPrompt);
    }

    // Save to localStorage
    try {
        localStorage.setItem('wordAI.prompts', JSON.stringify(prompts));
        addLog(`Prompt saved: ${name}`, "success");
    } catch (e) {
        addLog(`Failed to save prompt: ${e.message}`, "error");
    }

    renderPrompts();
    hideSavePromptModal();

    document.getElementById('promptSelect').value = id;
}

function handleDeletePrompt() {
    const promptId = document.getElementById('promptSelect').value;
    if (!promptId) {
        addLog('No prompt selected', "warning");
        return;
    }

    const prompt = prompts.find(p => p.id === promptId);
    if (!prompt) return;

    if (confirm(`Delete prompt "${prompt.name}"?`)) {
        prompts = prompts.filter(p => p.id !== promptId);

        try {
            localStorage.setItem('wordAI.prompts', JSON.stringify(prompts));
            addLog(`Prompt deleted: ${prompt.name}`, "success");
        } catch (e) {
            addLog(`Failed to delete prompt: ${e.message}`, "error");
        }

        renderPrompts();
        document.getElementById('promptTextarea').value = '';
    }
}

function handleResetPrompt() {
    document.getElementById('promptTextarea').value = '';
    document.getElementById('promptSelect').value = '';
    addLog('Prompt cleared', "info");
}

// ============================================================================
// CONNECTION & MODEL MANAGEMENT
// ============================================================================

/**
 * Tests connection to the active LLM backend and populates models.
 * Uses the unified llm-client.js testConnection function.
 */
async function testConnectionUI() {
    const indicator = document.getElementById("statusIndicator");
    const statusText = document.getElementById("statusText");
    const backendConfig = getActiveBackendConfig();
    const backendLabel = config.backend === 'vllm' ? 'vLLM' : 'Ollama';

    indicator.className = "status-indicator";
    statusText.textContent = "Connecting...";

    try {
        const result = await llmTestConnection(backendConfig);

        indicator.classList.add("connected");
        statusText.textContent = `${backendLabel}: Connected`;
        addLog(`Connected to ${backendLabel}! Found ${result.models.length} model(s).`, "success");

        // Populate model dropdown
        populateModels(result.models);

        if (config.backend === 'vllm') {
            // vLLM: set model to configured value as read-only
            const modelSelect = document.getElementById("modelSelect");
            modelSelect.innerHTML = '';
            const option = document.createElement('option');
            option.value = backendConfig.model;
            option.textContent = backendConfig.model;
            modelSelect.appendChild(option);
            modelSelect.disabled = true;
        }
    } catch (error) {
        indicator.classList.add("error");

        // Handle auth-specific errors
        if (error.message && (error.message.includes('401') || error.message.includes('403'))) {
            statusText.textContent = `${backendLabel}: API key required`;
            addLog(`${backendLabel} authentication failed: ${error.message}`, "error");
        } else {
            statusText.textContent = `${backendLabel}: Connection Error`;
            addLog(`${backendLabel} connection failed: ${error.message}`, "error");
        }

        console.error("Connection error:", error);
    }
}

/**
 * Populates the model dropdown from the /v1/models response.
 * Models use OpenAI format: { id: "model-name" }.
 */
function populateModels(models) {
    const select = document.getElementById("modelSelect");
    const activeModel = getActiveBackendConfig().model;
    select.innerHTML = '';

    if (models.length === 0) {
        select.innerHTML = '<option value="">No models available</option>';
        return;
    }

    models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.id;
        if (model.id === activeModel) {
            option.selected = true;
        }
        select.appendChild(option);
    });

    // If selected model not in list, select first available
    const modelIds = models.map(m => m.id);
    if (!modelIds.includes(activeModel)) {
        const fallback = modelIds[0];
        config.backends[config.backend].model = fallback;
        select.value = fallback;
    }
}

// ============================================================================
// LLM INTEGRATION
// ============================================================================

async function handleReviewSelection() {
    if (isProcessing) {
        addLog("Already processing a request", "warning");
        return;
    }

    const promptText = document.getElementById("promptTextarea").value.trim();
    if (!promptText) {
        addLog("Please enter a prompt", "warning");
        return;
    }

    const btn = document.getElementById("reviewBtn");

    try {
        isProcessing = true;
        btn.classList.add("loading");
        btn.disabled = true;

        // 1. Get Selection
        let selectionText = "";
        await Word.run(async (context) => {
            const selection = context.document.getSelection();
            selection.load("text");
            await context.sync();

            if (!selection.text || !selection.text.trim()) {
                throw new Error("Please select some text first.");
            }
            selectionText = selection.text;
        });

        addLog(`Processing selection (${selectionText.length} chars)...`, "info");

        // 2. Call LLM via unified client
        const backendConfig = getActiveBackendConfig();
        const fullPrompt = promptText.replace(/{selection}/g, selectionText);
        const response = await sendPrompt(backendConfig, fullPrompt, addLog);

        addLog("LLM Response received", "success");
        addLog(`Response: ${response.substring(0, 100)}${response.length > 100 ? '...' : ''}`, "info");

        // 3. Apply Diff Logic
        addLog("Applying changes...", "info");

        await Word.run(async (context) => {
            // Re-get the selection to ensure we have a valid range
            const selection = context.document.getSelection();

            // Ensure Track Changes state matches config
            if (Word.ChangeTrackingMode) {
                context.document.changeTrackingMode = config.trackChangesEnabled
                    ? Word.ChangeTrackingMode.trackAll
                    : Word.ChangeTrackingMode.off;
            }

            if (config.lineDiffEnabled) {
                await applySentenceDiffStrategy(context, selection, selectionText, response, addLog);
            } else {
                await applyTokenMapStrategy(context, selection, selectionText, response, addLog);
            }
        });

        addLog("Changes applied successfully", "success");

    } catch (error) {
        addLog(`Error: ${error.message}`, "error");
    } finally {
        isProcessing = false;
        btn.classList.remove("loading");
        btn.disabled = false;
    }
}

// ============================================================================
// VERIFICATION SCRIPT
// ============================================================================

async function runVerification() {
    const btn = document.getElementById("runVerificationBtn");

    try {
        btn.classList.add("loading");
        btn.disabled = true;
        addLog("Loading verification script...", "info");

        const module = await import('../scripts/verify-word-api.js');
        await module.runAllVerifications(addLog);

    } catch (error) {
        addLog(`Verification Error: ${error.message}`, "error");
        console.error(error);
    } finally {
        btn.classList.remove("loading");
        btn.disabled = false;
    }
}

// ============================================================================
// LOGGING
// ============================================================================

function addLog(message, type = "info") {
    const logsDiv = document.getElementById("logs");
    const entry = document.createElement("div");
    const timestamp = new Date().toLocaleTimeString();

    entry.className = `log-${type}`;
    entry.textContent = `[${timestamp}] ${message}`;

    logsDiv.appendChild(entry);
    logsDiv.scrollTop = logsDiv.scrollHeight;

    console.log(`[${type.toUpperCase()}] ${message}`);

    // Send to server log (best effort)
    fetch('/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, type, timestamp: new Date().toISOString() })
    }).catch(() => { });
}

function clearLogs() {
    document.getElementById("logs").innerHTML = "";
}
