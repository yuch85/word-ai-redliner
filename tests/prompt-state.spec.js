/**
 * Unit tests for PromptManager state model, CRUD, activation, and validation.
 * Covers requirements: PRMT-01, PRMT-02, PRMT-03, PRMT-04, PRMT-05, PRMT-06, SUMM-01, SUMM-02
 */
import { PromptManager, CATEGORIES } from '../src/lib/prompt-manager.js';

// localStorage mock (node test environment has no DOM)
const localStorageMock = (() => {
    let store = {};
    return {
        getItem: (key) => store[key] || null,
        setItem: (key, value) => { store[key] = String(value); },
        removeItem: (key) => { delete store[key]; },
        clear: () => { store = {}; }
    };
})();
global.localStorage = localStorageMock;

beforeEach(() => {
    localStorage.clear();
});

// ============================================================================
// PRMT-01: Three prompt categories exist
// ============================================================================

describe('categories', () => {
    test('PromptManager initializes with four categories: context, amendment, comment, summary', () => {
        const pm = new PromptManager();
        const state = pm.getState();
        expect(Object.keys(state)).toEqual(['context', 'amendment', 'comment', 'summary']);
    });

    test('CATEGORIES constant contains the four category names', () => {
        expect(CATEGORIES).toEqual(['context', 'amendment', 'comment', 'summary']);
    });

    test('each category starts with empty prompts array and null activePromptId', () => {
        const pm = new PromptManager();
        const state = pm.getState();
        for (const cat of CATEGORIES) {
            expect(state[cat].prompts).toEqual([]);
            expect(state[cat].activePromptId).toBeNull();
        }
    });
});

// ============================================================================
// PRMT-02: Each category has independent prompt library
// ============================================================================

describe('independent', () => {
    test('adding a prompt to one category does not affect others', () => {
        const pm = new PromptManager();
        pm.addPrompt('amendment', { name: 'Legal Review', template: 'Review {selection}', description: 'Legal' });

        expect(pm.getPrompts('amendment')).toHaveLength(1);
        expect(pm.getPrompts('context')).toHaveLength(0);
        expect(pm.getPrompts('comment')).toHaveLength(0);
    });

    test('activating a prompt in one category does not affect others', () => {
        const pm = new PromptManager();
        pm.addPrompt('amendment', { name: 'Legal Review', template: 'Review {selection}', description: 'Legal' });
        pm.addPrompt('comment', { name: 'Grammar Check', template: 'Check {selection}', description: 'Grammar' });

        pm.selectPrompt('amendment', 'legal-review');

        expect(pm.getActivePrompt('amendment')).not.toBeNull();
        expect(pm.getActivePrompt('comment')).toBeNull();
        expect(pm.getActivePrompt('context')).toBeNull();
    });
});

// ============================================================================
// PRMT-03: CRUD operations per category
// ============================================================================

describe('crud', () => {
    test('addPrompt generates ID from name and returns the prompt object', () => {
        const pm = new PromptManager();
        const result = pm.addPrompt('amendment', {
            name: 'Legal Review',
            template: 'Review {selection} for legal issues',
            description: 'Reviews for legal compliance'
        });

        expect(result).toEqual({
            id: 'legal-review',
            name: 'Legal Review',
            template: 'Review {selection} for legal issues',
            description: 'Reviews for legal compliance'
        });
    });

    test('addPrompt with duplicate ID upserts (updates existing)', () => {
        const pm = new PromptManager();
        pm.addPrompt('amendment', { name: 'Legal Review', template: 'Old template', description: 'Old' });
        pm.addPrompt('amendment', { name: 'Legal Review', template: 'New template', description: 'New' });

        const prompts = pm.getPrompts('amendment');
        expect(prompts).toHaveLength(1);
        expect(prompts[0].template).toBe('New template');
        expect(prompts[0].description).toBe('New');
    });

    test('deletePrompt removes a prompt from the category', () => {
        const pm = new PromptManager();
        pm.addPrompt('amendment', { name: 'Legal Review', template: 'Review {selection}', description: 'Legal' });
        pm.addPrompt('amendment', { name: 'Grammar Check', template: 'Check {selection}', description: 'Grammar' });

        pm.deletePrompt('amendment', 'legal-review');

        const prompts = pm.getPrompts('amendment');
        expect(prompts).toHaveLength(1);
        expect(prompts[0].id).toBe('grammar-check');
    });

    test('deletePrompt clears activePromptId if deleted prompt was active', () => {
        const pm = new PromptManager();
        pm.addPrompt('amendment', { name: 'Legal Review', template: 'Review {selection}', description: 'Legal' });
        pm.selectPrompt('amendment', 'legal-review');

        expect(pm.getActivePrompt('amendment')).not.toBeNull();

        pm.deletePrompt('amendment', 'legal-review');

        expect(pm.getActivePrompt('amendment')).toBeNull();
    });

    test('getPrompts returns the prompts array for a category', () => {
        const pm = new PromptManager();
        pm.addPrompt('context', { name: 'US Federal', template: 'US Federal law context', description: 'Fed' });
        pm.addPrompt('context', { name: 'UK Contract', template: 'UK contract law context', description: 'UK' });

        const prompts = pm.getPrompts('context');
        expect(prompts).toHaveLength(2);
        expect(prompts[0].id).toBe('us-federal');
        expect(prompts[1].id).toBe('uk-contract');
    });

    test('getPrompt returns a single prompt by ID or undefined', () => {
        const pm = new PromptManager();
        pm.addPrompt('comment', { name: 'Style Guide', template: 'Check {selection}', description: 'Style' });

        expect(pm.getPrompt('comment', 'style-guide')).toBeDefined();
        expect(pm.getPrompt('comment', 'style-guide').name).toBe('Style Guide');
        expect(pm.getPrompt('comment', 'nonexistent')).toBeUndefined();
    });

    test('ID generation: name.toLowerCase().replace(/\\s+/g, "-")', () => {
        const pm = new PromptManager();
        const result = pm.addPrompt('amendment', {
            name: 'My  Custom   Prompt',
            template: 'test',
            description: 'test'
        });
        expect(result.id).toBe('my-custom-prompt');
    });
});

// ============================================================================
// PRMT-04: Maximum one active prompt per category
// ============================================================================

describe('activation', () => {
    test('selectPrompt sets activePromptId and returns the prompt', () => {
        const pm = new PromptManager();
        pm.addPrompt('amendment', { name: 'Legal Review', template: 'Review {selection}', description: 'Legal' });

        const result = pm.selectPrompt('amendment', 'legal-review');

        expect(result.id).toBe('legal-review');
        expect(pm.getActivePrompt('amendment').id).toBe('legal-review');
    });

    test('selectPrompt with null deactivates the category', () => {
        const pm = new PromptManager();
        pm.addPrompt('amendment', { name: 'Legal Review', template: 'Review {selection}', description: 'Legal' });
        pm.selectPrompt('amendment', 'legal-review');

        pm.selectPrompt('amendment', null);

        expect(pm.getActivePrompt('amendment')).toBeNull();
    });

    test('only one prompt can be active per category at a time', () => {
        const pm = new PromptManager();
        pm.addPrompt('amendment', { name: 'Legal Review', template: 'Review {selection}', description: 'Legal' });
        pm.addPrompt('amendment', { name: 'Grammar Check', template: 'Check {selection}', description: 'Grammar' });

        pm.selectPrompt('amendment', 'legal-review');
        expect(pm.getActivePrompt('amendment').id).toBe('legal-review');

        pm.selectPrompt('amendment', 'grammar-check');
        expect(pm.getActivePrompt('amendment').id).toBe('grammar-check');
    });

    test('getActivePrompt returns null when no prompt is active', () => {
        const pm = new PromptManager();
        expect(pm.getActivePrompt('amendment')).toBeNull();
    });

    test('selecting a prompt auto-activates it', () => {
        const pm = new PromptManager();
        pm.addPrompt('comment', { name: 'Style Guide', template: 'Check {selection}', description: 'Style' });

        pm.selectPrompt('comment', 'style-guide');

        expect(pm.getActivePrompt('comment')).not.toBeNull();
        expect(pm.getActivePrompt('comment').id).toBe('style-guide');
    });
});

// ============================================================================
// PRMT-05: Context category is optional
// ============================================================================

describe('context optional', () => {
    test('canSubmit returns true when amendment is active but context is not', () => {
        const pm = new PromptManager();
        pm.addPrompt('amendment', { name: 'Legal Review', template: 'Review {selection}', description: 'Legal' });
        pm.selectPrompt('amendment', 'legal-review');

        // context is NOT active
        expect(pm.getActivePrompt('context')).toBeNull();
        expect(pm.canSubmit()).toBe(true);
    });

    test('canSubmit returns true when comment is active but context is not', () => {
        const pm = new PromptManager();
        pm.addPrompt('comment', { name: 'Style Guide', template: 'Check {selection}', description: 'Style' });
        pm.selectPrompt('comment', 'style-guide');

        expect(pm.getActivePrompt('context')).toBeNull();
        expect(pm.canSubmit()).toBe(true);
    });
});

// ============================================================================
// PRMT-06: Validation - at least one of amendment/comment must be active
// ============================================================================

describe('validation', () => {
    test('canSubmit returns false when neither amendment nor comment is active', () => {
        const pm = new PromptManager();
        expect(pm.canSubmit()).toBe(false);
    });

    test('canSubmit returns false when only context is active', () => {
        const pm = new PromptManager();
        pm.addPrompt('context', { name: 'US Federal', template: 'US Federal law context', description: 'Fed' });
        pm.selectPrompt('context', 'us-federal');

        expect(pm.canSubmit()).toBe(false);
    });

    test('canSubmit returns true when amendment is active', () => {
        const pm = new PromptManager();
        pm.addPrompt('amendment', { name: 'Legal Review', template: 'Review {selection}', description: 'Legal' });
        pm.selectPrompt('amendment', 'legal-review');

        expect(pm.canSubmit()).toBe(true);
    });

    test('canSubmit returns true when comment is active', () => {
        const pm = new PromptManager();
        pm.addPrompt('comment', { name: 'Style Guide', template: 'Check {selection}', description: 'Style' });
        pm.selectPrompt('comment', 'style-guide');

        expect(pm.canSubmit()).toBe(true);
    });

    test('canSubmit returns true when both amendment and comment are active', () => {
        const pm = new PromptManager();
        pm.addPrompt('amendment', { name: 'Legal Review', template: 'Review {selection}', description: 'Legal' });
        pm.addPrompt('comment', { name: 'Style Guide', template: 'Check {selection}', description: 'Style' });
        pm.selectPrompt('amendment', 'legal-review');
        pm.selectPrompt('comment', 'style-guide');

        expect(pm.canSubmit()).toBe(true);
    });

    test('getActiveMode returns "none" when nothing is active', () => {
        const pm = new PromptManager();
        expect(pm.getActiveMode()).toBe('none');
    });

    test('getActiveMode returns "amendment" when only amendment is active', () => {
        const pm = new PromptManager();
        pm.addPrompt('amendment', { name: 'Legal Review', template: 'Review {selection}', description: 'Legal' });
        pm.selectPrompt('amendment', 'legal-review');

        expect(pm.getActiveMode()).toBe('amendment');
    });

    test('getActiveMode returns "comment" when only comment is active', () => {
        const pm = new PromptManager();
        pm.addPrompt('comment', { name: 'Style Guide', template: 'Check {selection}', description: 'Style' });
        pm.selectPrompt('comment', 'style-guide');

        expect(pm.getActiveMode()).toBe('comment');
    });

    test('getActiveMode returns "both" when amendment and comment are active', () => {
        const pm = new PromptManager();
        pm.addPrompt('amendment', { name: 'Legal Review', template: 'Review {selection}', description: 'Legal' });
        pm.addPrompt('comment', { name: 'Style Guide', template: 'Check {selection}', description: 'Style' });
        pm.selectPrompt('amendment', 'legal-review');
        pm.selectPrompt('comment', 'style-guide');

        expect(pm.getActiveMode()).toBe('both');
    });
});

// ============================================================================
// updatePrompt: In-place prompt updates
// ============================================================================

describe('updatePrompt', () => {
    test('updates only the template field, preserving id, name, description', () => {
        const pm = new PromptManager();
        pm.addPrompt('amendment', { name: 'Legal Review', template: 'Old text', description: 'Legal desc' });

        const result = pm.updatePrompt('amendment', 'legal-review', { template: 'New text' });

        expect(result.id).toBe('legal-review');
        expect(result.name).toBe('Legal Review');
        expect(result.template).toBe('New text');
        expect(result.description).toBe('Legal desc');
    });

    test('updates both template and description when both provided', () => {
        const pm = new PromptManager();
        pm.addPrompt('amendment', { name: 'Legal Review', template: 'Old', description: 'Old desc' });

        const result = pm.updatePrompt('amendment', 'legal-review', { template: 'X', description: 'Y' });

        expect(result.template).toBe('X');
        expect(result.description).toBe('Y');
    });

    test('returns the updated prompt object', () => {
        const pm = new PromptManager();
        pm.addPrompt('amendment', { name: 'Legal Review', template: 'Old', description: 'Desc' });

        const result = pm.updatePrompt('amendment', 'legal-review', { template: 'Updated' });

        expect(result).toEqual({
            id: 'legal-review',
            name: 'Legal Review',
            template: 'Updated',
            description: 'Desc'
        });
    });

    test('calls persistState after mutation', () => {
        const pm = new PromptManager();
        pm.addPrompt('amendment', { name: 'Legal Review', template: 'Old', description: 'Desc' });

        const spy = jest.spyOn(pm, 'persistState');
        pm.updatePrompt('amendment', 'legal-review', { template: 'New' });

        expect(spy).toHaveBeenCalledWith('amendment');
        spy.mockRestore();
    });

    test('throws Error with "not found" for non-existent promptId', () => {
        const pm = new PromptManager();

        expect(() => {
            pm.updatePrompt('amendment', 'nonexistent', { template: 'X' });
        }).toThrow(/not found/);
    });

    test('throws Error for invalid category', () => {
        const pm = new PromptManager();

        expect(() => {
            pm.updatePrompt('invalid', 'some-id', { template: 'X' });
        }).toThrow(/Invalid category/);
    });

    test('does NOT change id or name even if passed in updates', () => {
        const pm = new PromptManager();
        pm.addPrompt('amendment', { name: 'Legal Review', template: 'Old', description: 'Desc' });

        const result = pm.updatePrompt('amendment', 'legal-review', {
            id: 'hacked-id',
            name: 'Hacked Name',
            template: 'New template'
        });

        expect(result.id).toBe('legal-review');
        expect(result.name).toBe('Legal Review');
        expect(result.template).toBe('New template');
    });
});

// ============================================================================
// SUMM-01: Summary category support
// ============================================================================

describe('SUMM-01: summary category', () => {
    test('CATEGORIES contains 4 entries including summary', () => {
        expect(CATEGORIES).toHaveLength(4);
        expect(CATEGORIES).toContain('summary');
    });

    test('PromptManager state has summary key with empty prompts and null activePromptId', () => {
        const pm = new PromptManager();
        const state = pm.getState();
        expect(state.summary).toBeDefined();
        expect(state.summary.prompts).toEqual([]);
        expect(state.summary.activePromptId).toBeNull();
    });

    test('addPrompt("summary", {...}) works and returns prompt object', () => {
        const pm = new PromptManager();
        const result = pm.addPrompt('summary', {
            name: 'Executive Summary',
            template: 'Summarize these comments: {comments}',
            description: 'Executive-level summary'
        });

        expect(result).toEqual({
            id: 'executive-summary',
            name: 'Executive Summary',
            template: 'Summarize these comments: {comments}',
            description: 'Executive-level summary'
        });
    });

    test('getPrompts("summary") returns added prompts', () => {
        const pm = new PromptManager();
        pm.addPrompt('summary', { name: 'Brief Summary', template: 'Brief: {comments}', description: 'Brief' });
        pm.addPrompt('summary', { name: 'Detailed Summary', template: 'Detail: {comments}', description: 'Detailed' });

        const prompts = pm.getPrompts('summary');
        expect(prompts).toHaveLength(2);
        expect(prompts[0].id).toBe('brief-summary');
        expect(prompts[1].id).toBe('detailed-summary');
    });

    test('selectPrompt("summary", id) activates and getActivePrompt("summary") returns it', () => {
        const pm = new PromptManager();
        pm.addPrompt('summary', { name: 'Executive Summary', template: '{comments}', description: 'Exec' });

        pm.selectPrompt('summary', 'executive-summary');

        const active = pm.getActivePrompt('summary');
        expect(active).not.toBeNull();
        expect(active.id).toBe('executive-summary');
    });

    test('deletePrompt("summary", id) removes and clears active if deleted was active', () => {
        const pm = new PromptManager();
        pm.addPrompt('summary', { name: 'Executive Summary', template: '{comments}', description: 'Exec' });
        pm.selectPrompt('summary', 'executive-summary');

        expect(pm.getActivePrompt('summary')).not.toBeNull();

        pm.deletePrompt('summary', 'executive-summary');

        expect(pm.getPrompts('summary')).toHaveLength(0);
        expect(pm.getActivePrompt('summary')).toBeNull();
    });

    test('updatePrompt("summary", id, { template: "new" }) works', () => {
        const pm = new PromptManager();
        pm.addPrompt('summary', { name: 'Executive Summary', template: 'Old', description: 'Desc' });

        const result = pm.updatePrompt('summary', 'executive-summary', { template: 'New template' });

        expect(result.template).toBe('New template');
        expect(result.id).toBe('executive-summary');
        expect(result.name).toBe('Executive Summary');
    });
});

// ============================================================================
// SUMM-02: Summary mode and submission
// ============================================================================

describe('SUMM-02: summary mode and submission', () => {
    test('getActiveMode returns "summary" when only summary is active', () => {
        const pm = new PromptManager();
        pm.addPrompt('summary', { name: 'Exec Summary', template: '{comments}', description: 'Exec' });
        pm.selectPrompt('summary', 'exec-summary');

        expect(pm.getActiveMode()).toBe('summary');
    });

    test('getActiveMode returns "summary" when summary AND amendment are both active (summary precedence)', () => {
        const pm = new PromptManager();
        pm.addPrompt('summary', { name: 'Exec Summary', template: '{comments}', description: 'Exec' });
        pm.addPrompt('amendment', { name: 'Legal Review', template: '{selection}', description: 'Legal' });
        pm.selectPrompt('summary', 'exec-summary');
        pm.selectPrompt('amendment', 'legal-review');

        expect(pm.getActiveMode()).toBe('summary');
    });

    test('canSubmit returns true when summary is active', () => {
        const pm = new PromptManager();
        pm.addPrompt('summary', { name: 'Exec Summary', template: '{comments}', description: 'Exec' });
        pm.selectPrompt('summary', 'exec-summary');

        expect(pm.canSubmit()).toBe(true);
    });

    test('canSubmit returns true when summary is active but amendment/comment are not', () => {
        const pm = new PromptManager();
        pm.addPrompt('summary', { name: 'Exec Summary', template: '{comments}', description: 'Exec' });
        pm.selectPrompt('summary', 'exec-summary');

        expect(pm.getActivePrompt('amendment')).toBeNull();
        expect(pm.getActivePrompt('comment')).toBeNull();
        expect(pm.canSubmit()).toBe(true);
    });

    test('canSubmit still returns true for amendment-only (regression check)', () => {
        const pm = new PromptManager();
        pm.addPrompt('amendment', { name: 'Legal Review', template: '{selection}', description: 'Legal' });
        pm.selectPrompt('amendment', 'legal-review');

        expect(pm.canSubmit()).toBe(true);
    });

    test('canSubmit still returns true for comment-only (regression check)', () => {
        const pm = new PromptManager();
        pm.addPrompt('comment', { name: 'Style Guide', template: '{selection}', description: 'Style' });
        pm.selectPrompt('comment', 'style-guide');

        expect(pm.canSubmit()).toBe(true);
    });

    test('canSubmit still returns true for both amendment and comment (regression check)', () => {
        const pm = new PromptManager();
        pm.addPrompt('amendment', { name: 'Legal Review', template: '{selection}', description: 'Legal' });
        pm.addPrompt('comment', { name: 'Style Guide', template: '{selection}', description: 'Style' });
        pm.selectPrompt('amendment', 'legal-review');
        pm.selectPrompt('comment', 'style-guide');

        expect(pm.canSubmit()).toBe(true);
    });

    test('canSubmit returns false when only context is active (no regression)', () => {
        const pm = new PromptManager();
        pm.addPrompt('context', { name: 'US Federal', template: 'US Federal context', description: 'Fed' });
        pm.selectPrompt('context', 'us-federal');

        expect(pm.canSubmit()).toBe(false);
    });
});
