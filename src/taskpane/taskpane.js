/* global Word, Office */

// Import CSS for webpack to bundle
import './taskpane.css';
import { applyTokenMapStrategy, applySentenceDiffStrategy } from 'office-word-diff';
import { sendPrompt, testConnection as llmTestConnection } from '../lib/llm-client.js';
import { PromptManager, CATEGORIES } from '../lib/prompt-manager.js';
import { CommentQueue } from '../lib/comment-queue.js';
import { fireCommentRequest } from '../lib/comment-request.js';
import { extractAllComments, extractDocumentText, extractDocumentStructured, estimateTokenCount, extractTrackedChanges } from '../lib/comment-extractor.js';
import { createSummaryDocument, buildSummaryHtml } from '../lib/document-generator.js';
import { parseDelimitedResponse, buildFallbackClassificationPrompt } from '../lib/response-parser.js';
import { parseDocument } from '../lib/document-parser.js';
import { chunkDocument } from '../lib/document-chunker.js';
import { extractContext } from '../lib/context-extractor.js';
import { processChunksParallel } from '../lib/orchestrator.js';
import { bookmarkChunkRanges, applyChunkResults, cleanupBookmarks } from '../lib/reassembler.js';

// Global configuration (defaults from env, overridable via UI/localStorage)
let config = {
    backend: 'ollama',
    trackChangesEnabled: true,
    lineDiffEnabled: false,
    docExtraction: {
        richness: 'structured'
    },
    trackedChangesExtraction: false,
    commentGranularity: 0,
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
const unsavedText = { context: '', amendment: '', comment: '', summary: '' };
let isProcessing = false;
let isProcessingDoc = false;
let processDocController = null; // AbortController for cancellation
let supportsComments = false;  // Set during initialize() via WordApi 1.4 check
const commentQueue = new CommentQueue(addLog);

// Token estimate cache -- avoids repeated Word API calls
let _tokenEstimateCache = { docCharCount: null, commentCount: null };
let _tokenEstimateDirty = true;  // Set true to trigger Word API re-read
let _tokenEstimateTimer = null;  // Debounce timer

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
    document.getElementById("processDocBtn").onclick = handleProcessDocument;
    document.getElementById("clearLogsBtn").onclick = clearLogs;
    document.getElementById("settingsToggle").onclick = toggleSettings;
    document.getElementById("runVerificationBtn").onclick = runVerification;
    document.getElementById("backendSelect").onchange = handleBackendSwitch;

    // Auto-save settings on every change (no Save button needed)
    document.getElementById("backendSelect").addEventListener('change', saveSettings);
    document.getElementById("modelSelect").addEventListener('change', saveSettings);
    document.getElementById("endpointUrl").addEventListener('input', saveSettings);
    document.getElementById("apiKey").addEventListener('input', saveSettings);
    document.getElementById("trackChangesCheckbox").addEventListener('change', saveSettings);
    document.getElementById("lineDiffCheckbox").addEventListener('change', saveSettings);
    document.getElementById("docRichnessSelect").addEventListener('change', saveSettings);
    document.getElementById("trackedChangesExtraction").addEventListener('change', saveSettings);
    document.getElementById("commentGranularity").addEventListener('change', saveSettings);

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
            const select = document.getElementById(`promptSelect-${category}`);
            const selectedValue = select.value;
            const textarea = document.getElementById(`promptTextarea-${category}`);
            const template = textarea.value.trim();

            if (!template) {
                addLog('Prompt template cannot be empty', 'warning');
                return;
            }

            if (selectedValue && selectedValue !== '__new__') {
                // Existing prompt selected -- update in-place
                promptManager.updatePrompt(category, selectedValue, { template });
                unsavedText[category] = template;
                addLog(`Prompt updated: ${promptManager.getPrompt(category, selectedValue).name} (${category})`, 'success');
            } else {
                // No prompt or "+ New Prompt" selected -- show create modal
                showSavePromptModal(category);
            }
        };
        document.getElementById(`deletePromptBtn-${category}`).onclick = () => {
            handleDeletePromptConfirm(category);
        };
        document.getElementById(`resetPromptBtn-${category}`).onclick = () => {
            handleResetPrompt(category);
        };
    }

    // Modal buttons
    document.getElementById("savePromptConfirmBtn").onclick = handleSavePromptConfirm;
    document.getElementById("savePromptCancelBtn").onclick = hideSavePromptModal;

    // Comment instructions field (amendment tab) -- update button label as user types
    document.getElementById('commentInstructions').addEventListener('input', updateReviewButton);

    // Initial UI state
    updateUIFromConfig();

    // Render prompt UI from PromptManager state
    renderAllDropdowns();
    updateDotIndicators();
    updateReviewButton();
    updateProcessDocButton();
    updateTabDisabledState();
    updateTokenEstimate();

    // Detect and log supported Word API version (diagnostics only)
    const apiVersions = ['1.8', '1.7', '1.6', '1.5', '1.4', '1.3', '1.2', '1.1'];
    let detectedVersion = 'unknown';
    try {
        if (typeof Office !== 'undefined' && Office.context && Office.context.requirements) {
            for (const ver of apiVersions) {
                if (Office.context.requirements.isSetSupported('WordApi', ver)) {
                    detectedVersion = ver;
                    break;
                }
            }
        }
    } catch (e) { /* detection failed */ }
    addLog(`Word API version: ${detectedVersion}`, 'info');

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

            // Ensure docExtraction defaults exist (for configs saved before this feature)
            if (!config.docExtraction) {
                config.docExtraction = { richness: 'structured' };
            }
            // Clean up legacy maxLength from older configs
            if (config.docExtraction.maxLength !== undefined) {
                delete config.docExtraction.maxLength;
            }

            // Ensure trackedChangesExtraction default (for configs saved before this feature)
            if (config.trackedChangesExtraction === undefined) {
                config.trackedChangesExtraction = false;
            }

            // Ensure commentGranularity default (for configs saved before this feature)
            if (config.commentGranularity === undefined) {
                config.commentGranularity = 0;
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
    config.docExtraction = {
        richness: document.getElementById('docRichnessSelect').value
    };
    config.trackedChangesExtraction = document.getElementById('trackedChangesExtraction').checked;
    config.commentGranularity = parseInt(document.getElementById('commentGranularity').value || '0', 10);

    try {
        localStorage.setItem('wordAI.config', JSON.stringify(config));
        addLog("Settings saved.", "success");
        invalidateTokenEstimateCache();
        updateTokenEstimate();

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

    const richnessSelect = document.getElementById('docRichnessSelect');
    if (richnessSelect && config.docExtraction) {
        richnessSelect.value = config.docExtraction.richness || 'structured';
    }

    const trackedChangesCheckbox = document.getElementById('trackedChangesExtraction');
    if (trackedChangesCheckbox) {
        trackedChangesCheckbox.checked = !!config.trackedChangesExtraction;
    }

    const granularitySelect = document.getElementById('commentGranularity');
    if (granularitySelect) {
        granularitySelect.value = String(config.commentGranularity || 0);
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

    const newOpt = document.createElement('option');
    newOpt.value = '__new__';
    newOpt.textContent = '+ New Prompt';
    select.appendChild(newOpt);

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

    if (promptId === '__new__') {
        promptManager.selectPrompt(category, null);
        textarea.value = '';
        unsavedText[category] = '';
        addLog(`${capitalize(category)}: ready for new prompt`, "info");
        updateDotIndicators();
        updateReviewButton();
        updateTabDisabledState();
        updateTokenEstimate();
        return;
    }

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
    updateReviewButton();
    updateTabDisabledState();
    updateTokenEstimate();
}

/**
 * Switches to a different tab, preserving unsaved textarea edits.
 *
 * @param {string} category - The category tab to switch to
 */
function switchTab(category) {
    if (category === currentTab) return;

    // Block switching to disabled tabs
    const targetTab = document.getElementById(`tab-${category}`);
    if (targetTab && targetTab.classList.contains('disabled')) return;

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

    updateTabDisabledState();

    // Invalidate token estimate cache on tab switch -- document may have changed
    invalidateTokenEstimateCache();
    updateTokenEstimate();
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
 * Enables or disables tabs based on the active mode.
 * In summary mode: amendment and comment tabs are disabled.
 * In non-summary mode: all tabs are enabled.
 * Context tab is always enabled.
 */
function updateTabDisabledState() {
    const mode = promptManager.getActiveMode();
    const isSummaryMode = (mode === 'summary');

    const amendmentTab = document.getElementById('tab-amendment');
    const commentTab = document.getElementById('tab-comment');

    if (amendmentTab) {
        amendmentTab.classList.toggle('disabled', isSummaryMode);
        if (isSummaryMode) amendmentTab.setAttribute('aria-disabled', 'true');
        else amendmentTab.removeAttribute('aria-disabled');
    }

    if (commentTab) {
        commentTab.classList.toggle('disabled', isSummaryMode);
        if (isSummaryMode) commentTab.setAttribute('aria-disabled', 'true');
        else commentTab.removeAttribute('aria-disabled');
    }
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
 * Updates the Review button label and enabled/disabled state
 * based on the active mode from PromptManager.
 *
 * Labels: "Amend Selection \u2192" | "Comment on Selection \u2192" | "Amend & Comment \u2192" | "Review Selection" (disabled)
 */
function updateReviewButton() {
    const btn = document.getElementById('reviewBtn');
    const mode = promptManager.getActiveMode();

    switch (mode) {
        case 'summary':
            btn.textContent = 'Generate Summary';
            btn.disabled = false;
            btn.title = 'Extract all comments and generate summary document';
            break;
        case 'amendment': {
            const commentField = document.getElementById('commentInstructions');
            const hasCommentInstructions = commentField && commentField.value.trim();
            if (hasCommentInstructions) {
                btn.textContent = 'Amend & Comment \u2192';
                btn.title = 'Amendment + comment in single LLM call';
            } else {
                btn.textContent = 'Amend Selection \u2192';
                btn.title = '';
            }
            btn.disabled = false;
            break;
        }
        case 'comment':
            btn.textContent = 'Comment on Selection \u2192';
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
    updateProcessDocButton();
    updateTokenEstimate();
}

/**
 * Invalidates the token estimate cache, causing the next
 * updateTokenEstimate() call to re-read from the Word API.
 */
function invalidateTokenEstimateCache() {
    _tokenEstimateDirty = true;
}

/**
 * Reads document size metrics from Word API for token estimation.
 * Cached: only calls Word API when _tokenEstimateDirty is true.
 * Returns cached values on subsequent calls until invalidated.
 *
 * @param {object} options - Which metrics are needed
 * @param {boolean} options.needDocText - Whether to read body.text length
 * @param {boolean} options.needComments - Whether to count comments
 * @returns {Promise<{docCharCount: number|null, commentCount: number|null}>}
 */
async function getDocumentMetrics({ needDocText, needComments }) {
    const docCached = !needDocText || _tokenEstimateCache.docCharCount !== null;
    const commentsCached = !needComments || _tokenEstimateCache.commentCount !== null;
    if (!_tokenEstimateDirty && docCached && commentsCached) {
        return _tokenEstimateCache;
    }

    try {
        await Word.run(async (context) => {
            const body = context.document.body;

            // Read body text length if needed
            if (needDocText) {
                body.load('text');
            }

            // Read comment count if needed
            let commentCollection = null;
            if (needComments && supportsComments) {
                commentCollection = body.getComments();
                commentCollection.load('items');
            }

            await context.sync();

            if (needDocText) {
                _tokenEstimateCache.docCharCount = (body.text || '').length;
            }
            if (needComments && supportsComments && commentCollection) {
                _tokenEstimateCache.commentCount = commentCollection.items.length;
            }
        });
        _tokenEstimateDirty = false;
    } catch (e) {
        // Word API unavailable (e.g., test environment) -- leave cache as null
        console.warn('Token estimate: Word API unavailable, using prompt-only estimate', e);
    }

    return _tokenEstimateCache;
}

/**
 * Updates the token estimation display with current prompt and data sizes.
 * Reads actual document size from Word API (cached + debounced) to show
 * realistic token estimates including document text and comments.
 *
 * Shows estimated total tokens across: active context prompt + active
 * category prompt (amendment/comment/summary) + document text + comments.
 *
 * Uses estimateTokenCount (Math.ceil(text.length / 4)) heuristic.
 * Informational only -- helps users gauge LLM context window fit.
 *
 * Async: callers fire-and-forget. DOM is updated when data is ready.
 */
async function updateTokenEstimate() {
    // Debounce: cancel pending call, schedule new one after 300ms
    if (_tokenEstimateTimer) {
        clearTimeout(_tokenEstimateTimer);
    }

    await new Promise((resolve) => {
        _tokenEstimateTimer = setTimeout(resolve, 300);
    });
    _tokenEstimateTimer = null;

    const container = document.getElementById('tokenEstimate');
    const valueEl = document.getElementById('tokenEstimateValue');
    const breakdownEl = document.getElementById('tokenEstimateBreakdown');
    if (!container || !valueEl) return;

    const mode = promptManager.getActiveMode();
    if (mode === 'none') {
        container.style.display = 'none';
        return;
    }

    let totalTokens = 0;
    const parts = [];
    let needDocText = false;
    let needComments = false;
    let hasTrackedChanges = false;

    // Context prompt tokens (always included if active)
    const contextPrompt = promptManager.getActivePrompt('context');
    if (contextPrompt && contextPrompt.template) {
        const ctxTokens = estimateTokenCount(contextPrompt.template);
        totalTokens += ctxTokens;
        parts.push(`ctx:~${ctxTokens.toLocaleString()}`);
    }

    if (mode === 'summary') {
        // Summary mode: summary prompt + actual document data estimates
        const summaryPrompt = promptManager.getActivePrompt('summary');
        if (summaryPrompt && summaryPrompt.template) {
            const summTokens = estimateTokenCount(summaryPrompt.template);
            totalTokens += summTokens;
            parts.push(`prompt:~${summTokens.toLocaleString()}`);

            if (summaryPrompt.template.includes('{whole document}')) {
                needDocText = true;
            }
            if (summaryPrompt.template.includes('{comments}')) {
                needComments = true;
            }
            if (config.trackedChangesExtraction && summaryPrompt.template.includes('{tracked changes}')) {
                hasTrackedChanges = true;
            }
        }
    } else {
        // Amendment/comment mode: category prompt
        const categories = ['amendment', 'comment'];
        for (const cat of categories) {
            const prompt = promptManager.getActivePrompt(cat);
            if (prompt && prompt.template) {
                const catTokens = estimateTokenCount(prompt.template);
                totalTokens += catTokens;
                parts.push(`${cat.substring(0, 5)}:~${catTokens.toLocaleString()}`);
            }
        }
        // Selection text is variable and unknown until user selects -- show note
        parts.push('+selection');
    }

    // Fetch real document metrics from Word API (cached + debounced)
    if (needDocText || needComments) {
        const metrics = await getDocumentMetrics({ needDocText, needComments });

        if (needDocText && metrics.docCharCount !== null) {
            const docTokens = Math.ceil(metrics.docCharCount / 4);
            totalTokens += docTokens;
            parts.push(`doc:~${docTokens.toLocaleString()}`);
        } else if (needDocText) {
            // Word API failed -- show note instead of number
            parts.push('+doc text');
        }

        if (needComments && metrics.commentCount !== null) {
            // Estimate ~50 tokens per comment (author + text + associated text)
            const commentTokens = metrics.commentCount * 50;
            totalTokens += commentTokens;
            parts.push(`comments:~${commentTokens.toLocaleString()}`);
        } else if (needComments) {
            parts.push('+comments');
        }
    }

    // Tracked changes: can't cheaply estimate OOXML parsing cost, show note
    if (hasTrackedChanges) {
        parts.push('+tracked changes');
    }

    container.style.display = 'flex';
    valueEl.textContent = `~${totalTokens.toLocaleString()}`;
    breakdownEl.textContent = `(${parts.join(' | ')})`;

    // Color coding based on rough context window thresholds
    valueEl.classList.remove('warning', 'danger');
    if (totalTokens > 100000) {
        valueEl.classList.add('danger');
    } else if (totalTokens > 50000) {
        valueEl.classList.add('warning');
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
    updateReviewButton();
    updateTabDisabledState();
    updateTokenEstimate();
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
    updateTokenEstimate();
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

/**
 * Handles the summary generation workflow.
 * Extracts all comments, sends to LLM with summary prompt, creates new document.
 * Fire-and-forget: user can switch modes immediately after triggering.
 */
async function handleSummaryGeneration() {
    const btn = document.getElementById('reviewBtn');

    try {
        btn.classList.add('loading');
        btn.disabled = true;
        addLog('Extracting document comments...', 'info');

        // 1. Extract all comments
        const comments = await extractAllComments();

        if (comments.length === 0) {
            addLog('No comments found in document. Add comments first, then generate summary.', 'warning');
            return;
        }

        addLog(`Found ${comments.length} comment(s). Sending to LLM...`, 'info');

        // 2. Extract document text if summary prompt uses {whole document} placeholder
        const summaryOpts = {};
        const activeSummaryPrompt = promptManager.getActivePrompt('summary');
        if (activeSummaryPrompt && activeSummaryPrompt.template.includes('{whole document}')) {
            const extraction = config.docExtraction || {};
            const richness = extraction.richness || 'structured';
            addLog(`Extracting document text (${richness})...`, 'info');
            summaryOpts.documentText = await extractDocumentStructured({ richness });
            addLog(`Document text extracted (${summaryOpts.documentText.length} chars, ~${estimateTokenCount(summaryOpts.documentText)} tokens)`, 'info');
        }

        // 3. Extract tracked changes if enabled and summary prompt uses {tracked changes} placeholder
        if (config.trackedChangesExtraction && activeSummaryPrompt && activeSummaryPrompt.template.includes('{tracked changes}')) {
            addLog('Extracting tracked changes (OOXML parsing)...', 'info');
            const tcResult = await extractTrackedChanges();
            addLog(`Tracked changes extracted (${tcResult.changes.length} change(s))`, 'info');

            // Format tracked changes for the prompt -- show before/after with author prominently
            let tcText = '';
            if (tcResult.changes.length > 0) {
                tcText = tcResult.changes.map((c, i) => {
                    const num = i + 1;
                    const author = c.author || 'Unknown';
                    const date = c.date || '';
                    const dateStr = date ? ` on ${date}` : '';

                    if (c.type === 'Replaced') {
                        return `[Change ${num}] REPLACED by ${author}${dateStr}:\n` +
                               `  BEFORE: "${c.beforeText}"\n` +
                               `  AFTER:  "${c.afterText}"` +
                               (c.paragraphText ? `\n  IN CLAUSE: "${c.paragraphText}"` : '');
                    } else if (c.type === 'Deleted') {
                        return `[Change ${num}] DELETED by ${author}${dateStr}:\n` +
                               `  REMOVED: "${c.text}"` +
                               (c.paragraphText ? `\n  IN CLAUSE: "${c.paragraphText}"` : '');
                    } else if (c.type === 'Added') {
                        return `[Change ${num}] ADDED by ${author}${dateStr}:\n` +
                               `  INSERTED: "${c.text}"` +
                               (c.paragraphText ? `\n  IN CLAUSE: "${c.paragraphText}"` : '');
                    } else if (c.type.startsWith('Moved')) {
                        return `[Change ${num}] ${c.type.toUpperCase()} by ${author}${dateStr}:\n` +
                               `  TEXT: "${c.text}"` +
                               (c.paragraphText ? `\n  IN CLAUSE: "${c.paragraphText}"` : '');
                    }
                    return `[Change ${num}] ${c.type} by ${author}${dateStr}: "${c.text}"`;
                }).join('\n\n');
            }

            if (tcText) {
                summaryOpts.trackedChangesText = tcText;
            } else if (tcResult.changes.length === 0) {
                summaryOpts.trackedChangesText = '(No tracked changes found in document)';
            }
        }

        // 4. Compose messages using PromptManager
        const messages = promptManager.composeSummaryMessages(comments, summaryOpts);

        if (messages.length === 0) {
            addLog('No summary prompt active. Select a Summary prompt first.', 'warning');
            return;
        }

        // 4. Send to LLM (flatten messages to single prompt for sendPrompt compatibility)
        const backendConfig = getActiveBackendConfig();
        let fullPrompt;
        if (messages.length >= 2 && messages[0].role === 'system') {
            fullPrompt = messages[0].content + '\n\n' + messages.slice(1).map(m => m.content).join('\n\n');
        } else {
            fullPrompt = messages.map(m => m.content).join('\n\n');
        }

        const llmResponse = await sendPrompt(backendConfig, fullPrompt, addLog);
        addLog(`Summary received (${llmResponse.length} chars). Creating document...`, 'info');

        // 5. Build HTML and create document
        // Get document title for the summary doc
        let docTitle = 'Comment Summary';
        try {
            await Word.run(async (context) => {
                const props = context.document.properties;
                props.load('title');
                await context.sync();
                if (props.title) {
                    docTitle = `Comment Summary - ${props.title}`;
                }
            });
        } catch (e) {
            // Title lookup failed -- use default
        }

        const html = buildSummaryHtml(llmResponse, comments, docTitle);
        await createSummaryDocument(html, docTitle, addLog);

        addLog('Summary document opened successfully.', 'success');

    } catch (error) {
        addLog(`Summary generation failed: ${error.message}`, 'error');
        console.error('Summary generation error:', error);
    } finally {
        btn.classList.remove('loading');
        updateReviewButton();
    }
}

async function handleReviewSelection() {
    // Summary mode uses a separate workflow
    if (promptManager.getActiveMode() === 'summary') {
        handleSummaryGeneration();
        return;
    }

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

    // Only block UI for amendment (synchronous) operations
    // Comment-only mode is non-blocking (fire-and-forget)
    const needsBlocking = (activeMode === 'amendment');

    try {
        if (needsBlocking) {
            isProcessing = true;
            btn.classList.add("loading");
            btn.disabled = true;
        }

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

        const activeBackend = getActiveBackendConfig();
        addLog(`Processing selection (${selectionText.length} chars) via ${activeBackend.model}...`, "info");

        // 2. Amendment execution
        if (activeMode === 'amendment') {
            const commentInstructions = document.getElementById('commentInstructions').value.trim();

            if (commentInstructions) {
                // Merged amendment + comment in single LLM call
                await handleMergedAmendmentComment(selectionText, commentInstructions, activeBackend);
            } else {
                // Amendment-only (existing synchronous workflow)
                await handleAmendmentOnly(selectionText, activeBackend);
            }
        }

        // 3. Comment-only execution -- fire-and-forget via comment queue
        if (activeMode === 'comment') {
            if (!supportsComments) {
                addLog("Comment features require Word API 1.4", "warning");
            } else {
                const backendConfig = getActiveBackendConfig();
                fireCommentRequest(selectionText, {
                    config: backendConfig,
                    sendPromptFn: sendPrompt,
                    promptManager: promptManager,
                    commentQueue: commentQueue,
                    log: addLog,
                    addLogWithRetryFn: addLogWithRetry,
                    updateStatusBarFn: updateCommentStatusBar
                });
            }
        }

    } catch (error) {
        addLog(`Error: ${error.message}`, "error");
    } finally {
        if (needsBlocking) {
            isProcessing = false;
            btn.classList.remove("loading");
            updateReviewButton();
        }
    }
}

/**
 * Handles amendment-only submission (no comment instructions).
 * Sends amendment prompt to LLM and applies diff as tracked changes.
 */
async function handleAmendmentOnly(selectionText, activeBackend) {
    const messages = promptManager.composeMessages(selectionText, 'amendment');

    let fullPrompt;
    if (messages.length === 2) {
        fullPrompt = messages[0].content + '\n\n' + messages[1].content;
    } else if (messages.length === 1) {
        fullPrompt = messages[0].content;
    } else {
        throw new Error("No prompt composed -- check active prompts");
    }

    const backendConfig = getActiveBackendConfig();
    const response = await sendPrompt(backendConfig, fullPrompt, addLog);

    addLog(`LLM Response received [${backendConfig.model}]`, "success");
    addLog(`Response: ${response.substring(0, 100)}${response.length > 100 ? '...' : ''}`, "info");

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

/**
 * Handles merged amendment + comment submission.
 * Sends a single merged prompt to LLM, parses delimited response,
 * applies amendment as tracked changes and inserts comment on selection.
 * Falls back to a second LLM call if delimiters are missing.
 */
async function handleMergedAmendmentComment(selectionText, commentInstructions, activeBackend) {
    const messages = promptManager.composeMergedMessages(selectionText, commentInstructions);

    let fullPrompt;
    if (messages.length === 2) {
        fullPrompt = messages[0].content + '\n\n' + messages[1].content;
    } else if (messages.length === 1) {
        fullPrompt = messages[0].content;
    } else {
        throw new Error("No prompt composed -- check active prompts");
    }

    const backendConfig = getActiveBackendConfig();
    addLog(`Sending merged amendment + comment request [${backendConfig.model}]...`, "info");
    const response = await sendPrompt(backendConfig, fullPrompt, addLog);

    addLog(`LLM Response received [${backendConfig.model}]`, "success");
    addLog(`Response: ${response.substring(0, 100)}${response.length > 100 ? '...' : ''}`, "info");

    // Parse delimited response
    let parsed = parseDelimitedResponse(response);

    // Fallback: if delimiters not found, try a second LLM call to classify
    if (parsed.amendment === null) {
        addLog("Response missing delimiters, attempting to classify...", "info");
        const fallbackMessages = buildFallbackClassificationPrompt(response, selectionText);
        const fallbackPrompt = fallbackMessages[0].content + '\n\n' + fallbackMessages[1].content;

        try {
            const fallbackResponse = await sendPrompt(backendConfig, fallbackPrompt, addLog);
            parsed = parseDelimitedResponse(fallbackResponse);

            if (parsed.amendment === null) {
                // Still no delimiters -- treat entire original response as amendment (best-effort)
                addLog("Could not split response into amendment and comment", "warning");
                parsed = { amendment: response.trim(), comment: null, raw: response };
            }
        } catch (fallbackError) {
            // Fallback call failed -- use original response as amendment
            addLog(`Fallback classification failed: ${fallbackError.message}`, "warning");
            parsed = { amendment: response.trim(), comment: null, raw: response };
        }
    }

    // Apply amendment as tracked changes
    if (parsed.amendment) {
        addLog("Applying amendment changes...", "info");

        await Word.run(async (context) => {
            const selection = context.document.getSelection();
            if (Word.ChangeTrackingMode) {
                context.document.changeTrackingMode = config.trackChangesEnabled
                    ? Word.ChangeTrackingMode.trackAll
                    : Word.ChangeTrackingMode.off;
            }
            if (config.lineDiffEnabled) {
                await applySentenceDiffStrategy(context, selection, selectionText, parsed.amendment, addLog);
            } else {
                await applyTokenMapStrategy(context, selection, selectionText, parsed.amendment, addLog);
            }
        });

        addLog("Amendment changes applied successfully", "success");
    }

    // Insert comment on selection if available and supported
    if (parsed.comment && supportsComments) {
        addLog("Inserting comment...", "info");

        try {
            await Word.run(async (context) => {
                const selection = context.document.getSelection();
                selection.load("text");
                await context.sync();

                // Insert comment directly on the current selection range
                const contentRange = selection.getRange();
                contentRange.insertComment(parsed.comment);
                await context.sync();
            });

            addLog("Comment inserted successfully", "success");
        } catch (commentError) {
            // Comment insertion failed -- log the comment text so it is not lost
            addLog(`Comment insertion failed: ${commentError.message}. Comment text: "${parsed.comment}"`, "warning");
        }
    } else if (parsed.comment && !supportsComments) {
        addLog(`Comment generated but Word API 1.4 not available. Comment: "${parsed.comment}"`, "warning");
    }
}

// ============================================================================
// WHOLE-DOCUMENT PROCESSING
// ============================================================================

/**
 * Updates the Process Document button label and state based on active mode.
 * Labels: "Amend Document -->" | "Comment on Document -->" | "Amend & Comment Document -->" | hidden (summary)
 * When processing: shows "Cancel" with cancel-mode class.
 */
function updateProcessDocButton() {
    const btn = document.getElementById('processDocBtn');
    if (!btn) return;

    // During processing, button shows "Cancel" and stays enabled
    if (isProcessingDoc) {
        btn.textContent = 'Cancel';
        btn.classList.add('cancel-mode');
        btn.disabled = false;
        btn.style.display = '';
        return;
    }

    btn.classList.remove('cancel-mode');
    const mode = promptManager.getActiveMode();

    switch (mode) {
        case 'summary':
            btn.style.display = 'none';
            break;
        case 'amendment': {
            btn.style.display = '';
            const commentField = document.getElementById('commentInstructions');
            const hasCommentInstructions = commentField && commentField.value.trim();
            if (hasCommentInstructions) {
                btn.textContent = 'Amend & Comment Document \u2192';
            } else {
                btn.textContent = 'Amend Document \u2192';
            }
            btn.disabled = !promptManager.canSubmit();
            btn.title = 'Process entire document with active prompts';
            break;
        }
        case 'comment':
            btn.style.display = '';
            btn.textContent = 'Comment on Document \u2192';
            btn.disabled = !promptManager.canSubmit();
            btn.title = 'Process entire document with active prompts';
            break;
        case 'none':
        default:
            btn.style.display = '';
            btn.textContent = 'Process Document';
            btn.disabled = true;
            btn.title = 'Select an Amendment or Comment prompt to enable';
            break;
    }
}

/**
 * Updates the process progress bar with current chunk progress.
 * @param {object} progress - Progress object from orchestrator
 * @param {number} progress.completed - Completed chunks
 * @param {number} progress.failed - Failed chunks
 * @param {number} progress.total - Total chunks
 * @param {number} progress.percentComplete - Percentage complete
 * @param {number} progress.estimatedSecondsRemaining - ETA in seconds
 */
function updateProcessProgress(progress) {
    const fill = document.getElementById('progressFill');
    const text = document.getElementById('progressText');
    if (fill) fill.style.width = `${progress.percentComplete}%`;
    if (text) {
        text.textContent = `Processing: ${progress.completed + progress.failed}/${progress.total} chunks`;
        if (progress.estimatedSecondsRemaining > 0) {
            text.textContent += ` (~${progress.estimatedSecondsRemaining}s remaining)`;
        }
    }
}

/**
 * Handles the full whole-document processing workflow.
 * Parses document, chunks it, extracts context, processes chunks in parallel,
 * applies results as tracked changes/comments, and shows summary.
 * Double-click acts as cancel.
 */
async function handleProcessDocument() {
    // If already processing, this is a cancel action
    if (isProcessingDoc && processDocController) {
        processDocController.abort();
        addLog('Cancelling document processing...', 'warning');
        return;
    }

    if (!promptManager.canSubmit()) {
        addLog('Please select an Amendment or Comment prompt', 'warning');
        return;
    }

    const activeMode = promptManager.getActiveMode();
    if (activeMode === 'summary') return; // Should not happen (button hidden)

    // Block all buttons
    isProcessingDoc = true;
    processDocController = new AbortController();
    const processBtn = document.getElementById('processDocBtn');
    const reviewBtn = document.getElementById('reviewBtn');
    processBtn.textContent = 'Cancel';
    processBtn.classList.add('cancel-mode');
    reviewBtn.disabled = true;

    // Show progress bar, hide comment status bar
    const progressBar = document.getElementById('processProgressBar');
    const commentBar = document.getElementById('commentStatusBar');
    progressBar.style.display = 'flex';
    commentBar.style.display = 'none';

    try {
        // Step 1: Parse document
        addLog('Parsing document...', 'info');
        const docModel = await parseDocument();
        addLog(`Found ${docModel.paragraphs.length} paragraphs (~${docModel.totalTokens} tokens)`, 'info');

        // Step 2: Chunk document
        const chunks = chunkDocument(docModel, { maxTokens: 6000 });
        addLog(`Split into ${chunks.length} chunks`, 'info');

        // Step 3: Extract context
        const documentContext = extractContext(docModel);
        addLog(`Extracted ${documentContext.definitions.length} definitions, ${documentContext.outline.length} headings`, 'info');

        // Step 4: Bookmark chunk ranges
        const bookmarkMap = await bookmarkChunkRanges(chunks);

        // Step 5: Process chunks in parallel
        const backendConfig = getActiveBackendConfig();
        const concurrency = chunks.some(c => c.tokenCount > 8000) ? 4 : 6;
        const commentInstructions = document.getElementById('commentInstructions')?.value?.trim() || '';

        const results = await processChunksParallel(chunks, {
            config: backendConfig,
            promptManager: promptManager,
            documentContext: documentContext,
            log: addLog,
            onProgress: updateProcessProgress,
            signal: processDocController.signal,
            concurrency: concurrency,
            timeoutMs: 300000,
            commentInstructions: commentInstructions
        });

        // Step 6: Apply results to document
        addLog('Applying changes to document...', 'info');
        const granularity = parseInt(document.getElementById('commentGranularity')?.value || '0', 10);
        const applicationResult = await applyChunkResults(results, bookmarkMap, {
            trackChangesEnabled: config.trackChangesEnabled,
            lineDiffEnabled: config.lineDiffEnabled,
            log: addLog,
            commentGranularity: granularity
        });

        // Step 7: Cleanup
        await cleanupBookmarks(bookmarkMap);

        // Step 8: Summary log
        const failed = results.filter(r => r.status === 'rejected').length;
        const cancelled = results.filter(r => r.status === 'cancelled').length;
        addLog(
            `Document processed: ${chunks.length} chunks, ` +
            `${applicationResult.amendmentsApplied} amendments applied, ` +
            `${applicationResult.commentsInserted} comments inserted` +
            (failed > 0 ? `, ${failed} chunks failed` : '') +
            (cancelled > 0 ? `, ${cancelled} chunks cancelled` : ''),
            failed > 0 ? 'warning' : 'success'
        );

        // Show "Retry All Failed" link if failures exist
        if (failed > 0) {
            const failedChunks = results.filter(r => r.status === 'rejected');
            addLogWithRetry(
                `${failed} chunk(s) failed. Click to retry failed chunks.`,
                'warning',
                () => retryFailedChunks(failedChunks, bookmarkMap, backendConfig)
            );
        }

    } catch (error) {
        if (error.name === 'AbortError') {
            addLog('Document processing cancelled. Already-applied changes remain in the document.', 'warning');
        } else {
            addLog(`Document processing failed: ${error.message}`, 'error');
            console.error('Process document error:', error);
        }
    } finally {
        isProcessingDoc = false;
        processDocController = null;
        progressBar.style.display = 'none';
        commentBar.style.display = commentQueue.count > 0 ? 'flex' : 'none';
        updateReviewButton();
        updateProcessDocButton();
    }
}

/**
 * Retries processing only the failed chunks.
 * Re-runs the orchestrator on the failed chunk subset and applies results.
 *
 * @param {Array} failedResults - Array of ChunkResult objects with status 'rejected'
 * @param {Map} bookmarkMap - Original chunkId -> bookmarkName map
 * @param {object} backendConfig - Backend configuration
 */
async function retryFailedChunks(failedResults, bookmarkMap, backendConfig) {
    addLog(`Retrying ${failedResults.length} failed chunk(s)...`, 'info');

    isProcessingDoc = true;
    processDocController = new AbortController();
    const processBtn = document.getElementById('processDocBtn');
    const progressBar = document.getElementById('processProgressBar');

    processBtn.textContent = 'Cancel';
    processBtn.classList.add('cancel-mode');
    progressBar.style.display = 'flex';

    try {
        // Reconstruct chunks from failed results for re-processing
        const retryChunks = failedResults.map(r => ({
            id: r.chunkId,
            text: r.originalText || '',
            tokenCount: r.originalText ? Math.ceil(r.originalText.length / 4) : 0,
            overlapText: ''
        }));

        const commentInstructions = document.getElementById('commentInstructions')?.value?.trim() || '';

        const results = await processChunksParallel(retryChunks, {
            config: backendConfig,
            promptManager: promptManager,
            documentContext: null,
            log: addLog,
            onProgress: updateProcessProgress,
            signal: processDocController.signal,
            concurrency: 4,
            timeoutMs: 300000,
            commentInstructions: commentInstructions
        });

        const granularity = parseInt(document.getElementById('commentGranularity')?.value || '0', 10);
        const applicationResult = await applyChunkResults(results, bookmarkMap, {
            trackChangesEnabled: config.trackChangesEnabled,
            lineDiffEnabled: config.lineDiffEnabled,
            log: addLog,
            commentGranularity: granularity
        });

        const stillFailed = results.filter(r => r.status === 'rejected').length;
        addLog(
            `Retry complete: ${applicationResult.amendmentsApplied} amendments, ` +
            `${applicationResult.commentsInserted} comments` +
            (stillFailed > 0 ? `, ${stillFailed} still failed` : ''),
            stillFailed > 0 ? 'warning' : 'success'
        );

    } catch (error) {
        if (error.name === 'AbortError') {
            addLog('Retry cancelled.', 'warning');
        } else {
            addLog(`Retry failed: ${error.message}`, 'error');
        }
    } finally {
        isProcessingDoc = false;
        processDocController = null;
        progressBar.style.display = 'none';
        updateReviewButton();
        updateProcessDocButton();
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
