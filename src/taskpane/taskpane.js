/* global Word, Office */

// Import CSS for webpack to bundle
import './taskpane.css';
import { applyTokenMapStrategy, applySentenceDiffStrategy } from 'office-word-diff';

// Global configuration (defaults from env, overridable via UI/localStorage)
let config = {
    ollamaUrl: process.env.DEFAULT_OLLAMA_URL || '/ollama',
    apiKey: '',
    selectedModel: process.env.DEFAULT_MODEL || 'gpt-oss:20b',
    trackChangesEnabled: true,
    lineDiffEnabled: false
};

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
    testConnection();

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
            config = { ...config, ...parsed };
        }
    } catch (e) {
        console.error("Failed to load settings:", e);
    }
}

function saveSettings() {
    const ollamaUrl = document.getElementById("ollamaUrl").value.trim();
    const apiKey = document.getElementById("apiKey").value.trim();
    const trackChanges = document.getElementById("trackChangesCheckbox").checked;
    const lineDiff = document.getElementById("lineDiffCheckbox").checked;
    const selectedModel = document.getElementById("modelSelect").value;

    config = {
        ollamaUrl: ollamaUrl || process.env.DEFAULT_OLLAMA_URL || '/ollama',
        apiKey: apiKey,
        selectedModel: selectedModel || config.selectedModel,
        trackChangesEnabled: trackChanges,
        lineDiffEnabled: lineDiff
    };

    try {
        localStorage.setItem('wordAI.config', JSON.stringify(config));
        addLog("Settings saved.", "success");

        // Re-test connection with new settings
        testConnection();
    } catch (e) {
        addLog(`Failed to save settings: ${e.message}`, "error");
    }
}

function updateUIFromConfig() {
    document.getElementById("ollamaUrl").value = config.ollamaUrl;
    document.getElementById("apiKey").value = config.apiKey;
    document.getElementById("trackChangesCheckbox").checked = config.trackChangesEnabled;
    document.getElementById("lineDiffCheckbox").checked = config.lineDiffEnabled;
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

async function testConnection() {
    const indicator = document.getElementById("statusIndicator");
    const statusText = document.getElementById("statusText");

    indicator.className = "status-indicator";
    statusText.textContent = "Connecting...";

    try {
        let url = config.ollamaUrl;
        if (!url.endsWith('/')) url += '/';
        url += 'api/tags';

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {})
            }
        });

        if (response.ok) {
            const data = await response.json();
            const models = data.models || [];

            indicator.classList.add("connected");
            statusText.textContent = "Connected";
            addLog(`Connected to Ollama! Found ${models.length} models.`, "success");

            // Populate model dropdown
            populateModels(models);
        } else {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
    } catch (error) {
        indicator.classList.add("error");
        statusText.textContent = "Connection Error";
        addLog(`Connection failed: ${error.message}`, "error");
        console.error("Connection error:", error);
    }
}

function populateModels(models) {
    const select = document.getElementById("modelSelect");
    select.innerHTML = '';

    if (models.length === 0) {
        select.innerHTML = '<option value="">No models available</option>';
        return;
    }

    models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.name;
        option.textContent = model.name;
        if (model.name === config.selectedModel) {
            option.selected = true;
        }
        select.appendChild(option);
    });

    // If selected model not in list, select first or default to gpt-oss:20b
    const modelNames = models.map(m => m.name);
    if (!modelNames.includes(config.selectedModel)) {
        const gptOss = modelNames.find(n => n.includes('gpt-oss:20b'));
        config.selectedModel = gptOss || modelNames[0];
        select.value = config.selectedModel;
    }
}

// ============================================================================
// LLM INTEGRATION
// ============================================================================

async function sendPromptToLLM(prompt, selection) {
    const fullPrompt = prompt.replace(/{selection}/g, selection);

    let url = config.ollamaUrl;
    if (!url.endsWith('/')) url += '/';
    url += 'api/generate';

    addLog(`Sending to LLM (model: ${config.selectedModel})...`, "info");

    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.setRequestHeader('Content-Type', 'application/json');

        if (config.apiKey) {
            xhr.setRequestHeader('Authorization', `Bearer ${config.apiKey}`);
        }

        xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const data = JSON.parse(xhr.responseText);
                    resolve(data.response);
                } catch (e) {
                    reject(new Error(`Parse error: ${e.message}`));
                }
            } else {
                reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
            }
        };

        xhr.onerror = () => reject(new Error('Network error'));
        xhr.ontimeout = () => reject(new Error('Request timeout'));
        xhr.timeout = 60000; // 60 seconds

        xhr.send(JSON.stringify({
            model: config.selectedModel,
            prompt: fullPrompt,
            stream: false
        }));
    });
}

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

        // 2. Call LLM
        const response = await sendPromptToLLM(promptText, selectionText);

        addLog("✅ LLM Response received", "success");
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

        addLog("✅ Changes applied successfully", "success");

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
