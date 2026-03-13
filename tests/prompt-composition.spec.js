/**
 * Unit tests for prompt composition (message assembly for chat completions).
 * Covers requirements: PRMT-07, PRMT-08, PRMT-09, SUMM-05
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
    test('PromptManager can be instantiated and has four expected categories', () => {
        const pm = new PromptManager();
        const state = pm.getState();
        expect(Object.keys(state)).toEqual(['context', 'amendment', 'comment', 'summary']);
        expect(CATEGORIES).toEqual(['context', 'amendment', 'comment', 'summary']);
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

// ============================================================================
// SUMM-05: composeSummaryMessages
// ============================================================================

describe('SUMM-05: composeSummaryMessages', () => {
    const sampleComments = [
        { index: 1, commentText: 'This clause is ambiguous', associatedText: 'The party shall', author: 'Jane Doe', date: '2026-03-01', resolved: false },
        { index: 2, commentText: 'Consider adding a deadline', associatedText: 'within a reasonable time', author: 'John Smith', date: '2026-03-02', resolved: true }
    ];

    test('with active summary prompt and {comments} placeholder, returns messages with placeholder replaced by formatted comment data', () => {
        const pm = new PromptManager();
        pm.addPrompt('summary', { name: 'Exec Summary', template: 'Summarize these comments:\n{comments}', description: 'Exec' });
        pm.selectPrompt('summary', 'exec-summary');

        const messages = pm.composeSummaryMessages(sampleComments);

        expect(messages).toHaveLength(1);
        expect(messages[0].role).toBe('user');
        expect(messages[0].content).toContain('Summarize these comments:');
        expect(messages[0].content).toContain('[Comment 1] by Jane Doe');
        expect(messages[0].content).toContain('[Comment 2] by John Smith');
        expect(messages[0].content).not.toContain('{comments}');
    });

    test('with active context + summary prompts, returns system message + user message', () => {
        const pm = new PromptManager();
        pm.addPrompt('context', { name: 'Legal Context', template: 'You are a legal document reviewer', description: 'Legal' });
        pm.selectPrompt('context', 'legal-context');
        pm.addPrompt('summary', { name: 'Exec Summary', template: 'Summarize: {comments}', description: 'Exec' });
        pm.selectPrompt('summary', 'exec-summary');

        const messages = pm.composeSummaryMessages(sampleComments);

        expect(messages).toHaveLength(2);
        expect(messages[0]).toEqual({ role: 'system', content: 'You are a legal document reviewer' });
        expect(messages[1].role).toBe('user');
        expect(messages[1].content).toContain('Summarize:');
    });

    test('without {comments} placeholder, appends comment data after double newline', () => {
        const pm = new PromptManager();
        pm.addPrompt('summary', { name: 'Exec Summary', template: 'Please provide a summary of all comments.', description: 'Exec' });
        pm.selectPrompt('summary', 'exec-summary');

        const messages = pm.composeSummaryMessages(sampleComments);

        expect(messages).toHaveLength(1);
        expect(messages[0].content).toBe(
            'Please provide a summary of all comments.\n\n' +
            '[Comment 1] by Jane Doe on "The party shall":\n"This clause is ambiguous"\n\n' +
            '[Comment 2] by John Smith on "within a reasonable time":\n"Consider adding a deadline"'
        );
    });

    test('returns empty array when no summary prompt is active', () => {
        const pm = new PromptManager();

        const messages = pm.composeSummaryMessages(sampleComments);

        expect(messages).toEqual([]);
    });

    test('multiple comments formatted with index numbers, author names, associated text', () => {
        const pm = new PromptManager();
        pm.addPrompt('summary', { name: 'Exec Summary', template: '{comments}', description: 'Exec' });
        pm.selectPrompt('summary', 'exec-summary');

        const messages = pm.composeSummaryMessages(sampleComments);

        const content = messages[0].content;
        expect(content).toContain('[Comment 1] by Jane Doe on "The party shall":\n"This clause is ambiguous"');
        expect(content).toContain('[Comment 2] by John Smith on "within a reasonable time":\n"Consider adding a deadline"');
    });

    test('comments are separated by double newlines', () => {
        const pm = new PromptManager();
        pm.addPrompt('summary', { name: 'Exec Summary', template: '{comments}', description: 'Exec' });
        pm.selectPrompt('summary', 'exec-summary');

        const messages = pm.composeSummaryMessages(sampleComments);

        const content = messages[0].content;
        // Two comments should be separated by \n\n
        const parts = content.split('\n\n');
        expect(parts).toHaveLength(2);
    });

    test('returns array of {role, content} objects', () => {
        const pm = new PromptManager();
        pm.addPrompt('context', { name: 'Ctx', template: 'System', description: '' });
        pm.selectPrompt('context', 'ctx');
        pm.addPrompt('summary', { name: 'Sum', template: '{comments}', description: '' });
        pm.selectPrompt('summary', 'sum');

        const messages = pm.composeSummaryMessages(sampleComments);

        expect(Array.isArray(messages)).toBe(true);
        messages.forEach(msg => {
            expect(msg).toHaveProperty('role');
            expect(msg).toHaveProperty('content');
            expect(typeof msg.role).toBe('string');
            expect(typeof msg.content).toBe('string');
        });
    });
});
