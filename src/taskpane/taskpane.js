/* global Word, Office */

// Import CSS for webpack to bundle
import './taskpane.css';
import { applyTokenMapStrategy, applySentenceDiffStrategy } from 'office-word-diff';
import { sendPrompt, testConnection as llmTestConnection } from '../lib/llm-client.js';
import { PromptManager, CATEGORIES } from '../lib/prompt-manager.js';

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

const promptManager = new PromptManager();
let currentTab = 'context';
const unsavedText = { context: '', amendment: '', comment: '' };
let isProcessing = false;
let supportsComments = false;  // Set during initialize() via WordApi 1.4 check

Office.onReady((info) => {
    if (info.host === Office.HostType.Word) {
        initialize();
    }
});

function initialize() {
    // Load saved settings
    loadSettings();

    // Load prompt state from localStorage
    promptManager.loadState();

    // Setup event listeners -- general
    document.getElementById("reviewBtn").onclick = handleReviewSelection;
    document.getElementById("saveSettingsBtn").onclick = saveSettings;
    document.getElementById("clearLogsBtn").onclick = clearLogs;
    document.getElementById("settingsToggle").onclick = toggleSettings;
    document.getElementById("runVerificationBtn").onclick = runVerification;
    document.getElementById("backendSelect").onchange = handleBackendSwitch;

    // Tab bar -- click and keyboard navigation
    for (const category of CATEGORIES) {
        const tabBtn = document.getElementById(`tab-${category}`);
        tabBtn.addEventListener('click', () => switchTab(category));
        tabBtn.addEventListener('keydown', handleTabKeydown);
    }

    // Per-category prompt controls
    for (const category of CATEGORIES) {
        document.getElementById(`promptSelect-${category}`).onchange = (e) => {
            handleCategoryPromptSelect(category, e.target.value);
        };
        document.getElementById(`savePromptBtn-${category}`).onclick = () => {
            showSavePromptModal(category);
        };
        document.getElementById(`deletePromptBtn-${category}`).onclick = () => {
            handleDeletePromptConfirm(category);
        };
        document.getElementById(`resetPromptBtn-${category}`).onclick = () => {
            handleResetPrompt(category);
        };
    }

    // Status summary -- click to jump to tab
    const statusLines = document.querySelectorAll('#promptStatusSummary .status-line');
    statusLines.forEach((line) => {
        line.addEventListener('click', () => {
            const cat = line.getAttribute('data-category');
            if (cat) {
                switchTab(cat);
            }
        });
    });

    // Modal buttons
    document.getElementById("savePromptConfirmBtn").onclick = handleSavePromptConfirm;
    document.getElementById("savePromptCancelBtn").onclick = hideSavePromptModal;

    // Initial UI state
    updateUIFromConfig();

    // Render prompt UI from PromptManager state
    renderAllDropdowns();
    updateDotIndicators();
    updateStatusSummary();
    updateReviewButton();

    // Detect WordApi 1.4 support for comment features
    if (typeof Office !== 'undefined' && Office.context && Office.context.requirements) {
        supportsComments = Office.context.requirements.isSetSupported('WordApi', '1.4');
    }

    if (!supportsComments) {
        // Hide comment-related UI elements (graceful degradation)
        const commentTab = document.getElementById('tab-comment');
        const commentPanel = document.getElementById('panel-comment');
        const commentStatusBar = document.getElementById('commentStatusBar');
        if (commentTab) commentTab.style.display = 'none';
        if (commentPanel) commentPanel.style.display = 'none';
        if (commentStatusBar) commentStatusBar.style.display = 'none';
        addLog('Comment features unavailable (requires Word API 1.4)', 'info');
    }

    // Restore unsaved text from active prompts on load
    for (const category of CATEGORIES) {
        const activePrompt = promptManager.getActivePrompt(category);
        if (activePrompt) {
            unsavedText[category] = activePrompt.template;
            document.getElementById(`promptTextarea-${category}`).value = activePrompt.template;
        }
    }

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
// PROMPT MANAGEMENT (PromptManager Integration)
// ============================================================================

/**
 * Populates the dropdown for a single category from PromptManager state.
 * Selects the active prompt if one exists.
 *
 * @param {string} category - One of 'context', 'amendment', 'comment'
 */
function renderCategoryDropdown(category) {
    const select = document.getElementById(`promptSelect-${category}`);
    const prompts = promptManager.getPrompts(category);
    const activePrompt = promptManager.getActivePrompt(category);

    select.innerHTML = '<option value="">(None)</option>';

    prompts.forEach((prompt) => {
        const option = document.createElement('option');
        option.value = prompt.id;
        option.textContent = prompt.name;
        if (prompt.description) {
            option.title = prompt.description;
        }
        select.appendChild(option);
    });

    // Select the active prompt in the dropdown
    if (activePrompt) {
        select.value = activePrompt.id;
    }
}

/**
 * Renders dropdowns for all three categories.
 */
function renderAllDropdowns() {
    for (const category of CATEGORIES) {
        renderCategoryDropdown(category);
    }
}

/**
 * Handles selecting a prompt from a category's dropdown.
 * Auto-activates the selected prompt or deactivates if "(None)" is chosen.
 *
 * @param {string} category - One of 'context', 'amendment', 'comment'
 * @param {string} promptId - The prompt ID, or empty string for "(None)"
 */
function handleCategoryPromptSelect(category, promptId) {
    const textarea = document.getElementById(`promptTextarea-${category}`);

    if (!promptId) {
        // "(None)" selected -- deactivate category
        promptManager.selectPrompt(category, null);
        textarea.value = '';
        unsavedText[category] = '';
        addLog(`${capitalize(category)} prompt deactivated`, "info");
    } else {
        // Select and auto-activate prompt
        const prompt = promptManager.selectPrompt(category, promptId);
        if (prompt) {
            textarea.value = prompt.template;
            unsavedText[category] = prompt.template;
            addLog(`Loaded ${category} prompt: ${prompt.name}`, "info");
        }
    }

    updateDotIndicators();
    updateStatusSummary();
    updateReviewButton();
}

/**
 * Switches to a different tab, preserving unsaved textarea edits.
 *
 * @param {string} category - The category tab to switch to
 */
function switchTab(category) {
    if (category === currentTab) return;

    // Save current textarea content before switching
    const currentTextarea = document.getElementById(`promptTextarea-${currentTab}`);
    unsavedText[currentTab] = currentTextarea.value;

    // Update tab bar ARIA and styles
    for (const cat of CATEGORIES) {
        const tabBtn = document.getElementById(`tab-${cat}`);
        const panel = document.getElementById(`panel-${cat}`);
        const isTarget = (cat === category);

        tabBtn.setAttribute('aria-selected', isTarget ? 'true' : 'false');
        tabBtn.classList.toggle('active', isTarget);
        tabBtn.tabIndex = isTarget ? 0 : -1;

        if (isTarget) {
            panel.removeAttribute('hidden');
        } else {
            panel.setAttribute('hidden', '');
        }
    }

    currentTab = category;

    // Restore textarea content for new tab
    const newTextarea = document.getElementById(`promptTextarea-${category}`);
    newTextarea.value = unsavedText[category];
}

/**
 * Handles arrow key navigation within the tab bar per WAI-ARIA pattern.
 *
 * @param {KeyboardEvent} e
 */
function handleTabKeydown(e) {
    const currentIndex = CATEGORIES.indexOf(currentTab);
    let newIndex = currentIndex;

    switch (e.key) {
        case 'ArrowRight':
            newIndex = (currentIndex + 1) % CATEGORIES.length;
            break;
        case 'ArrowLeft':
            newIndex = (currentIndex - 1 + CATEGORIES.length) % CATEGORIES.length;
            break;
        case 'Home':
            newIndex = 0;
            break;
        case 'End':
            newIndex = CATEGORIES.length - 1;
            break;
        default:
            return; // Don't prevent default for other keys
    }

    e.preventDefault();
    const newCategory = CATEGORIES[newIndex];
    document.getElementById(`tab-${newCategory}`).focus();
    switchTab(newCategory);
}

/**
 * Updates the dot indicators on each tab to reflect activation state.
 * Green dot = active prompt, red dot = no active prompt.
 */
function updateDotIndicators() {
    for (const category of CATEGORIES) {
        const dot = document.getElementById(`dot-${category}`);
        const isActive = promptManager.getActivePrompt(category) !== null;
        dot.classList.toggle('active', isActive);
    }
}

/**
 * Updates the status summary widget above the Review button.
 * Shows active prompt name or "(none)" for each category.
 */
function updateStatusSummary() {
    const summary = document.getElementById('promptStatusSummary');

    for (const category of CATEGORIES) {
        const line = summary.querySelector(`.status-line[data-category="${category}"]`);
        if (!line) continue;

        const dot = line.querySelector('.status-dot');
        const value = line.querySelector('.status-value');
        const activePrompt = promptManager.getActivePrompt(category);

        if (activePrompt) {
            dot.classList.add('active');
            value.textContent = activePrompt.name;
        } else {
            dot.classList.remove('active');
            value.textContent = '(none)';
        }
    }
}

/**
 * Updates the Review button label and enabled/disabled state
 * based on the active mode from PromptManager.
 *
 * Labels: "Amend Selection \u2192" | "Comment on Selection \u2192" | "Amend & Comment \u2192" | "Review Selection" (disabled)
 */
function updateReviewButton() {
    const btn = document.getElementById('reviewBtn');
    const mode = promptManager.getActiveMode();

    switch (mode) {
        case 'amendment':
            btn.textContent = 'Amend Selection \u2192';
            btn.disabled = false;
            btn.title = '';
            break;
        case 'comment':
            btn.textContent = 'Comment on Selection \u2192';
            btn.disabled = false;
            btn.title = '';
            break;
        case 'both':
            btn.textContent = 'Amend & Comment \u2192';
            btn.disabled = false;
            btn.title = '';
            break;
        case 'none':
        default:
            btn.textContent = 'Review Selection';
            btn.disabled = true;
            btn.title = 'Select an Amendment or Comment prompt to enable';
            break;
    }
}

/**
 * Opens the save prompt modal with category context.
 *
 * @param {string} category - The category being saved to
 */
function showSavePromptModal(category) {
    document.getElementById('savePromptModal').classList.add('active');
    document.getElementById('savePromptCategory').textContent = `Saving to: ${capitalize(category)}`;
    document.getElementById('promptName').value = '';
    document.getElementById('promptDescription').value = '';
    document.getElementById('promptName').focus();
}

/**
 * Hides the save prompt modal.
 */
function hideSavePromptModal() {
    document.getElementById('savePromptModal').classList.remove('active');
}

/**
 * Handles the Save button in the save prompt modal.
 * Creates a new prompt in the current tab's category and auto-selects it.
 */
function handleSavePromptConfirm() {
    const name = document.getElementById('promptName').value.trim();
    const description = document.getElementById('promptDescription').value.trim();
    const template = document.getElementById(`promptTextarea-${currentTab}`).value.trim();

    if (!name) {
        addLog('Please enter a prompt name', "warning");
        return;
    }

    if (!template) {
        addLog('Prompt template cannot be empty', "warning");
        return;
    }

    const prompt = promptManager.addPrompt(currentTab, { name, template, description });
    addLog(`Prompt saved: ${name} (${currentTab})`, "success");

    renderCategoryDropdown(currentTab);
    hideSavePromptModal();

    // Auto-select the saved prompt
    handleCategoryPromptSelect(currentTab, prompt.id);
    document.getElementById(`promptSelect-${currentTab}`).value = prompt.id;
}

/**
 * Handles deleting the currently selected prompt in a category.
 *
 * @param {string} category - The category to delete from
 */
function handleDeletePromptConfirm(category) {
    const select = document.getElementById(`promptSelect-${category}`);
    const promptId = select.value;

    if (!promptId) {
        addLog('No prompt selected to delete', "warning");
        return;
    }

    const prompt = promptManager.getPrompt(category, promptId);
    if (!prompt) return;

    promptManager.deletePrompt(category, promptId);
    addLog(`Prompt deleted: ${prompt.name} (${category})`, "success");

    renderCategoryDropdown(category);
    document.getElementById(`promptTextarea-${category}`).value = '';
    unsavedText[category] = '';

    updateDotIndicators();
    updateStatusSummary();
    updateReviewButton();
}

/**
 * Clears the textarea for a category without deactivating.
 * User must select "(None)" from dropdown to deactivate.
 *
 * @param {string} category - The category to clear
 */
function handleResetPrompt(category) {
    document.getElementById(`promptTextarea-${category}`).value = '';
    unsavedText[category] = '';
    addLog(`${capitalize(category)} prompt text cleared`, "info");
}

/**
 * Capitalizes the first letter of a string.
 * @param {string} str
 * @returns {string}
 */
function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// ============================================================================
// COMMENT STATUS BAR
// ============================================================================

/**
 * Updates the comment status bar visibility and pending count text.
 * Called by the integration plan (03-03) whenever the pending count changes.
 *
 * @param {number} count - Number of comments currently pending
 */
function updateCommentStatusBar(count) {
    const bar = document.getElementById('commentStatusBar');
    if (!bar) return;

    if (count === 0) {
        bar.style.display = 'none';
    } else {
        bar.style.display = 'flex';
        const text = document.getElementById('commentStatusText');
        if (text) {
            text.textContent = `${count} comment${count !== 1 ? 's' : ''} pending...`;
        }
    }
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

    if (!promptManager.canSubmit()) {
        addLog("Please select an Amendment or Comment prompt", "warning");
        return;
    }

    const btn = document.getElementById("reviewBtn");
    const activeMode = promptManager.getActiveMode();

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

        // 2. Compose and send prompt
        // Amendment execution (existing workflow)
        if (activeMode === 'amendment' || activeMode === 'both') {
            const messages = promptManager.composeMessages(selectionText, 'amendment');

            // Flatten messages into a single prompt for current sendPromptToLLM.
            // Phase 1's unified client will accept messages[] directly.
            // For now: system message (if any) prepended as context, user message is the prompt.
            let fullPrompt;
            if (messages.length === 2) {
                // System + user message
                fullPrompt = messages[0].content + '\n\n' + messages[1].content;
            } else if (messages.length === 1) {
                fullPrompt = messages[0].content;
            } else {
                throw new Error("No prompt composed -- check active prompts");
            }

            const backendConfig = getActiveBackendConfig();
            const response = await sendPrompt(backendConfig, fullPrompt, addLog);

            addLog("LLM Response received", "success");
            addLog(`Response: ${response.substring(0, 100)}${response.length > 100 ? '...' : ''}`, "info");

            // 3. Apply Diff Logic
            addLog("Applying changes...", "info");

            await Word.run(async (context) => {
                const selection = context.document.getSelection();
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
        }

        // Comment execution -- Phase 3 will implement async comment queue.
        // For now, log that comment is active but not yet implemented.
        if (activeMode === 'comment' || activeMode === 'both') {
            if (activeMode === 'comment') {
                // Comment-only mode -- Phase 3 will handle this
                addLog("Comment prompt is active. Comment insertion will be available in a future update.", "info");
            } else {
                // Both mode -- amendment already executed above; comment deferred to Phase 3
                addLog("Amendment applied. Comment insertion will follow in a future update.", "info");
            }
        }

    } catch (error) {
        addLog(`Error: ${error.message}`, "error");
    } finally {
        isProcessing = false;
        btn.classList.remove("loading");
        updateReviewButton();
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

/**
 * Extended version of addLog that appends a clickable "Retry" link to the log entry.
 * Used for failed comment requests where the user can retry the operation.
 *
 * @param {string} message - The log message text
 * @param {string} type - Log type: "info", "success", "warning", "error"
 * @param {Function} retryCallback - Function to call when Retry is clicked
 */
function addLogWithRetry(message, type, retryCallback) {
    const logsDiv = document.getElementById("logs");
    const entry = document.createElement("div");
    const timestamp = new Date().toLocaleTimeString();
    entry.className = `log-${type}`;

    const msgSpan = document.createElement("span");
    msgSpan.textContent = `[${timestamp}] ${message} `;
    entry.appendChild(msgSpan);

    if (retryCallback) {
        const retryLink = document.createElement("a");
        retryLink.textContent = "Retry";
        retryLink.href = "#";
        retryLink.className = "retry-link";
        retryLink.onclick = (e) => {
            e.preventDefault();
            retryCallback();
            entry.remove();  // Remove the error log entry on retry
        };
        entry.appendChild(retryLink);
    }

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
