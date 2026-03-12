/**
 * Unit tests for prompt composition (message assembly for chat completions).
 * Covers requirements: PRMT-07, PRMT-08, PRMT-09
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
// Import validation (real test)
// ============================================================================

describe('PromptManager import', () => {
    test('PromptManager can be instantiated and has three expected categories', () => {
        const pm = new PromptManager();
        const state = pm.getState();
        expect(Object.keys(state)).toEqual(['context', 'amendment', 'comment']);
        expect(CATEGORIES).toEqual(['context', 'amendment', 'comment']);
    });
});

// ============================================================================
// PRMT-07: Context prompt as system message
// ============================================================================

describe('system message', () => {
    test('when context prompt is active, composeMessages() returns it as {role: "system", content: contextTemplate}', () => {
        const pm = new PromptManager();
        pm.addPrompt('context', { name: 'Legal Context', template: 'You are a legal reviewer', description: 'Legal' });
        pm.selectPrompt('context', 'legal-context');
        pm.addPrompt('amendment', { name: 'Review', template: '{selection}', description: 'Review' });
        pm.selectPrompt('amendment', 'review');

        const messages = pm.composeMessages('contract text', 'amendment');

        expect(messages).toHaveLength(2);
        expect(messages[0]).toEqual({ role: 'system', content: 'You are a legal reviewer' });
        expect(messages[1]).toEqual({ role: 'user', content: 'contract text' });
    });

    test('when no context prompt is active, messages array has no system message', () => {
        const pm = new PromptManager();
        pm.addPrompt('amendment', { name: 'Review', template: '{selection}', description: 'Review' });
        pm.selectPrompt('amendment', 'review');

        const messages = pm.composeMessages('some text', 'amendment');

        expect(messages).toHaveLength(1);
        expect(messages[0]).toEqual({ role: 'user', content: 'some text' });
    });
});

// ============================================================================
// PRMT-08: Amendment prompt uses {selection} placeholder
// ============================================================================

describe('amendment selection', () => {
    test('amendment prompt has {selection} replaced with actual text in user message', () => {
        const pm = new PromptManager();
        pm.addPrompt('amendment', { name: 'Amend', template: 'Review this: {selection}', description: 'Amend' });
        pm.selectPrompt('amendment', 'amend');

        const messages = pm.composeMessages('hello world', 'amendment');

        expect(messages).toHaveLength(1);
        expect(messages[0]).toEqual({ role: 'user', content: 'Review this: hello world' });
    });
});

// ============================================================================
// PRMT-09: Comment prompt uses {selection} placeholder
// ============================================================================

describe('comment selection', () => {
    test('comment prompt has {selection} replaced with actual text in user message', () => {
        const pm = new PromptManager();
        pm.addPrompt('comment', { name: 'Analyze', template: 'Analyze: {selection}', description: 'Analyze' });
        pm.selectPrompt('comment', 'analyze');

        const messages = pm.composeMessages('some text', 'comment');

        expect(messages).toHaveLength(1);
        expect(messages[0]).toEqual({ role: 'user', content: 'Analyze: some text' });
    });
});

// ============================================================================
// Edge cases
// ============================================================================

describe('edge cases', () => {
    test('multiple {selection} occurrences are all replaced', () => {
        const pm = new PromptManager();
        pm.addPrompt('amendment', { name: 'Multi', template: 'First: {selection}, Second: {selection}', description: 'Multi' });
        pm.selectPrompt('amendment', 'multi');

        const messages = pm.composeMessages('test', 'amendment');

        expect(messages[0]).toEqual({ role: 'user', content: 'First: test, Second: test' });
    });

    test('no active prompt for target category returns empty array', () => {
        const pm = new PromptManager();

        const messages = pm.composeMessages('text', 'amendment');

        expect(messages).toEqual([]);
    });

    test('context prompt is static -- {selection} in context template is NOT replaced', () => {
        const pm = new PromptManager();
        pm.addPrompt('context', { name: 'Ctx', template: 'Context with {selection} token', description: 'Ctx' });
        pm.selectPrompt('context', 'ctx');
        pm.addPrompt('amendment', { name: 'Amend', template: '{selection}', description: 'Amend' });
        pm.selectPrompt('amendment', 'amend');

        const messages = pm.composeMessages('replaced text', 'amendment');

        expect(messages[0]).toEqual({ role: 'system', content: 'Context with {selection} token' });
        expect(messages[1]).toEqual({ role: 'user', content: 'replaced text' });
    });

    test('template without {selection} placeholder appends selection text automatically', () => {
        const pm = new PromptManager();
        pm.addPrompt('comment', { name: 'Review', template: 'Review this clause for legal issues.', description: 'Review' });
        pm.selectPrompt('comment', 'review');

        const messages = pm.composeMessages('The tenant shall indemnify...', 'comment');

        expect(messages).toHaveLength(1);
        expect(messages[0].role).toBe('user');
        expect(messages[0].content).toContain('Review this clause for legal issues.');
        expect(messages[0].content).toContain('The tenant shall indemnify...');
    });

    test('template without {selection} appends with double newline separator', () => {
        const pm = new PromptManager();
        pm.addPrompt('amendment', { name: 'Amend', template: 'Improve this clause.', description: 'Amend' });
        pm.selectPrompt('amendment', 'amend');

        const messages = pm.composeMessages('clause text here', 'amendment');

        expect(messages[0].content).toBe('Improve this clause.\n\nclause text here');
    });

    test('composeMessages always returns array of {role, content} objects', () => {
        const pm = new PromptManager();
        pm.addPrompt('context', { name: 'Ctx', template: 'System prompt', description: '' });
        pm.selectPrompt('context', 'ctx');
        pm.addPrompt('comment', { name: 'Cmt', template: 'Comment on {selection}', description: '' });
        pm.selectPrompt('comment', 'cmt');

        const messages = pm.composeMessages('text', 'comment');

        expect(Array.isArray(messages)).toBe(true);
        messages.forEach(msg => {
            expect(msg).toHaveProperty('role');
            expect(msg).toHaveProperty('content');
            expect(typeof msg.role).toBe('string');
            expect(typeof msg.content).toBe('string');
        });
    });
});
