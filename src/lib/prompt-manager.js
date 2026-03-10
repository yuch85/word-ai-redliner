/**
 * PromptManager Module
 *
 * Data layer for the three-category prompt system (Context, Amendment, Comment).
 * Encapsulates state model, CRUD operations, activation logic, validation,
 * and localStorage persistence. Extracted from the monolithic taskpane.js
 * to provide a testable, reusable contract for the UI layer.
 *
 * @module prompt-manager
 */

/**
 * The three prompt categories.
 * @type {string[]}
 */
export const CATEGORIES = ['context', 'amendment', 'comment'];

/**
 * Manages prompt state across three independent categories.
 *
 * Each category maintains its own array of prompts and an optional
 * activePromptId. Prompts are persisted independently in localStorage
 * under separate keys (wordAI.prompts.{category}, wordAI.active.{category}).
 */
export class PromptManager {
    constructor() {
        this.state = {
            context: { prompts: [], activePromptId: null },
            amendment: { prompts: [], activePromptId: null },
            comment: { prompts: [], activePromptId: null }
        };
    }

    /**
     * Generates a prompt ID from a name using the existing codebase pattern.
     * @param {string} name - Human-readable prompt name
     * @returns {string} Kebab-case ID
     */
    _generateId(name) {
        return name.toLowerCase().replace(/\s+/g, '-');
    }

    /**
     * Validates that a category string is one of the three known categories.
     * @param {string} category
     * @throws {Error} If category is invalid
     */
    _validateCategory(category) {
        if (!CATEGORIES.includes(category)) {
            throw new Error(`Invalid category: "${category}". Must be one of: ${CATEGORIES.join(', ')}`);
        }
    }

    /**
     * Adds a prompt to a category. If a prompt with the same generated ID
     * already exists, it is updated (upsert behavior).
     *
     * @param {string} category - One of 'context', 'amendment', 'comment'
     * @param {object} data - Prompt data
     * @param {string} data.name - Human-readable name
     * @param {string} data.template - Prompt template text
     * @param {string} data.description - Short description
     * @returns {object} The prompt object { id, name, template, description }
     */
    addPrompt(category, { name, template, description }) {
        this._validateCategory(category);

        const id = this._generateId(name);
        const prompt = { id, name, template, description };
        const catState = this.state[category];

        const existingIndex = catState.prompts.findIndex(p => p.id === id);
        if (existingIndex !== -1) {
            catState.prompts[existingIndex] = prompt;
        } else {
            catState.prompts.push(prompt);
        }

        this.persistState(category);
        return prompt;
    }

    /**
     * Deletes a prompt from a category by ID. If the deleted prompt was
     * active, the category is deactivated.
     *
     * @param {string} category - One of 'context', 'amendment', 'comment'
     * @param {string} promptId - The prompt ID to delete
     */
    deletePrompt(category, promptId) {
        this._validateCategory(category);

        const catState = this.state[category];
        catState.prompts = catState.prompts.filter(p => p.id !== promptId);

        if (catState.activePromptId === promptId) {
            catState.activePromptId = null;
        }

        this.persistState(category);
    }

    /**
     * Returns all prompts for a category.
     *
     * @param {string} category - One of 'context', 'amendment', 'comment'
     * @returns {Array<object>} Array of prompt objects
     */
    getPrompts(category) {
        this._validateCategory(category);
        return this.state[category].prompts;
    }

    /**
     * Returns a single prompt by ID, or undefined if not found.
     *
     * @param {string} category - One of 'context', 'amendment', 'comment'
     * @param {string} promptId - The prompt ID to find
     * @returns {object|undefined} The prompt object or undefined
     */
    getPrompt(category, promptId) {
        this._validateCategory(category);
        return this.state[category].prompts.find(p => p.id === promptId);
    }

    /**
     * Selects (activates) a prompt in a category, or deactivates the category
     * when promptId is null.
     *
     * @param {string} category - One of 'context', 'amendment', 'comment'
     * @param {string|null} promptId - The prompt ID to activate, or null to deactivate
     * @returns {object|null} The activated prompt, or null if deactivated
     */
    selectPrompt(category, promptId) {
        this._validateCategory(category);

        const catState = this.state[category];
        catState.activePromptId = promptId;

        this.persistState(category);

        if (promptId === null) {
            return null;
        }
        return catState.prompts.find(p => p.id === promptId) || null;
    }

    /**
     * Returns the active prompt for a category, or null if none is active.
     *
     * @param {string} category - One of 'context', 'amendment', 'comment'
     * @returns {object|null} The active prompt or null
     */
    getActivePrompt(category) {
        this._validateCategory(category);

        const catState = this.state[category];
        if (!catState.activePromptId) {
            return null;
        }
        return catState.prompts.find(p => p.id === catState.activePromptId) || null;
    }

    /**
     * Returns whether the current state allows submission.
     * At least one of amendment or comment must have an active prompt.
     * Context is optional and does not affect submission validation.
     *
     * @returns {boolean}
     */
    canSubmit() {
        return !!(this.state.amendment.activePromptId || this.state.comment.activePromptId);
    }

    /**
     * Returns the active mode based on which task categories have active prompts.
     *
     * @returns {'amendment'|'comment'|'both'|'none'}
     */
    getActiveMode() {
        const hasAmendment = !!this.state.amendment.activePromptId;
        const hasComment = !!this.state.comment.activePromptId;

        if (hasAmendment && hasComment) return 'both';
        if (hasAmendment) return 'amendment';
        if (hasComment) return 'comment';
        return 'none';
    }

    /**
     * Persists a category's prompts and active state to localStorage.
     * Uses try-catch to handle storage errors gracefully.
     *
     * Keys:
     *   wordAI.prompts.{category} - JSON array of prompt objects
     *   wordAI.active.{category} - Active prompt ID string (empty if null)
     *
     * @param {string} category - One of 'context', 'amendment', 'comment'
     */
    persistState(category) {
        this._validateCategory(category);

        const catState = this.state[category];
        try {
            localStorage.setItem(
                `wordAI.prompts.${category}`,
                JSON.stringify(catState.prompts)
            );
            localStorage.setItem(
                `wordAI.active.${category}`,
                catState.activePromptId || ''
            );
        } catch (e) {
            console.error(`Failed to persist prompt state for ${category}:`, e);
        }
    }

    /**
     * Loads all three categories from localStorage. Falls back to empty state
     * if keys are missing or JSON is corrupted.
     *
     * Does NOT read from old wordAI.prompts key (fresh start per PRMT-10 override).
     */
    loadState() {
        for (const category of CATEGORIES) {
            try {
                const promptsJson = localStorage.getItem(`wordAI.prompts.${category}`);
                if (promptsJson) {
                    this.state[category].prompts = JSON.parse(promptsJson);
                } else {
                    this.state[category].prompts = [];
                }
            } catch (e) {
                console.error(`Failed to load prompts for ${category}:`, e);
                this.state[category].prompts = [];
            }

            try {
                const activeId = localStorage.getItem(`wordAI.active.${category}`);
                this.state[category].activePromptId = activeId || null;
            } catch (e) {
                console.error(`Failed to load active prompt for ${category}:`, e);
                this.state[category].activePromptId = null;
            }
        }
    }

    /**
     * Returns the full state object (for UI consumers).
     *
     * @returns {object} State with context, amendment, comment sub-objects
     */
    getState() {
        return this.state;
    }
}
