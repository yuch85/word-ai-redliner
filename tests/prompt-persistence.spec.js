/**
 * Unit tests for PromptManager localStorage persistence.
 * Covers requirement: PRMT-11
 */
import { PromptManager, CATEGORIES } from '../src/lib/prompt-manager.js';

// localStorage mock (node test environment has no DOM)
const localStorageMock = (() => {
    let store = {};
    return {
        getItem: (key) => (key in store ? store[key] : null),
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
// PRMT-11: Prompt libraries persist in localStorage
// ============================================================================

describe('persist', () => {
    test('persistState writes prompts to wordAI.prompts.{category} key', () => {
        const pm = new PromptManager();
        pm.addPrompt('amendment', { name: 'Legal Review', template: 'Review {selection}', description: 'Legal' });

        const stored = JSON.parse(localStorage.getItem('wordAI.prompts.amendment'));
        expect(stored).toHaveLength(1);
        expect(stored[0].id).toBe('legal-review');
    });

    test('persistState writes activePromptId to wordAI.active.{category} key', () => {
        const pm = new PromptManager();
        pm.addPrompt('amendment', { name: 'Legal Review', template: 'Review {selection}', description: 'Legal' });
        pm.selectPrompt('amendment', 'legal-review');

        const stored = localStorage.getItem('wordAI.active.amendment');
        expect(stored).toBe('legal-review');
    });

    test('persistState writes empty string for activePromptId when null', () => {
        const pm = new PromptManager();
        pm.addPrompt('amendment', { name: 'Legal Review', template: 'Review {selection}', description: 'Legal' });
        pm.selectPrompt('amendment', 'legal-review');
        pm.selectPrompt('amendment', null);

        const stored = localStorage.getItem('wordAI.active.amendment');
        expect(stored).toBe('');
    });

    test('loadState reads prompts and active state from localStorage', () => {
        // Pre-populate localStorage
        localStorage.setItem('wordAI.prompts.context', JSON.stringify([
            { id: 'us-federal', name: 'US Federal', template: 'US Federal law context', description: 'Fed' }
        ]));
        localStorage.setItem('wordAI.active.context', 'us-federal');

        localStorage.setItem('wordAI.prompts.amendment', JSON.stringify([
            { id: 'legal-review', name: 'Legal Review', template: 'Review {selection}', description: 'Legal' }
        ]));
        localStorage.setItem('wordAI.active.amendment', 'legal-review');

        const pm = new PromptManager();
        pm.loadState();

        expect(pm.getPrompts('context')).toHaveLength(1);
        expect(pm.getActivePrompt('context').id).toBe('us-federal');
        expect(pm.getPrompts('amendment')).toHaveLength(1);
        expect(pm.getActivePrompt('amendment').id).toBe('legal-review');
        expect(pm.getPrompts('comment')).toHaveLength(0);
        expect(pm.getActivePrompt('comment')).toBeNull();
    });

    test('loadState falls back to empty state when keys are missing', () => {
        const pm = new PromptManager();
        pm.loadState();

        for (const cat of CATEGORIES) {
            expect(pm.getPrompts(cat)).toEqual([]);
            expect(pm.getActivePrompt(cat)).toBeNull();
        }
    });

    test('loadState handles corrupted JSON gracefully without throwing', () => {
        localStorage.setItem('wordAI.prompts.amendment', '{invalid json!!!');
        localStorage.setItem('wordAI.active.amendment', 'some-id');

        const pm = new PromptManager();
        expect(() => pm.loadState()).not.toThrow();
        expect(pm.getPrompts('amendment')).toEqual([]);
    });

    test('loadState does NOT read from old wordAI.prompts key (fresh start)', () => {
        // Simulate old data existing
        localStorage.setItem('wordAI.prompts', JSON.stringify([
            { id: 'old-prompt', name: 'Old Prompt', template: 'old template', description: 'old' }
        ]));

        const pm = new PromptManager();
        pm.loadState();

        // Should NOT have imported old prompts
        expect(pm.getPrompts('amendment')).toEqual([]);
        expect(pm.getPrompts('context')).toEqual([]);
        expect(pm.getPrompts('comment')).toEqual([]);
    });

    test('each category persists independently', () => {
        const pm = new PromptManager();
        pm.addPrompt('context', { name: 'US Federal', template: 'US Federal law', description: 'Fed' });
        pm.addPrompt('amendment', { name: 'Legal Review', template: 'Review {selection}', description: 'Legal' });
        pm.addPrompt('comment', { name: 'Style Guide', template: 'Check {selection}', description: 'Style' });

        // Each key should have exactly one prompt
        expect(JSON.parse(localStorage.getItem('wordAI.prompts.context'))).toHaveLength(1);
        expect(JSON.parse(localStorage.getItem('wordAI.prompts.amendment'))).toHaveLength(1);
        expect(JSON.parse(localStorage.getItem('wordAI.prompts.comment'))).toHaveLength(1);
    });

    test('round-trip: add prompts, create new PromptManager, loadState restores all', () => {
        const pm1 = new PromptManager();
        pm1.addPrompt('amendment', { name: 'Legal Review', template: 'Review {selection}', description: 'Legal' });
        pm1.addPrompt('comment', { name: 'Style Guide', template: 'Check {selection}', description: 'Style' });
        pm1.selectPrompt('amendment', 'legal-review');
        pm1.selectPrompt('comment', 'style-guide');

        // New instance loads from localStorage
        const pm2 = new PromptManager();
        pm2.loadState();

        expect(pm2.getPrompts('amendment')).toHaveLength(1);
        expect(pm2.getActivePrompt('amendment').id).toBe('legal-review');
        expect(pm2.getPrompts('comment')).toHaveLength(1);
        expect(pm2.getActivePrompt('comment').id).toBe('style-guide');
    });
});
