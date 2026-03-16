/**
 * Unit tests for response-parser.js
 * Tests delimiter parsing and fallback classification prompt building.
 */
import { parseDelimitedResponse, buildFallbackClassificationPrompt } from '../src/lib/response-parser.js';

// ============================================================================
// parseDelimitedResponse
// ============================================================================

describe('parseDelimitedResponse', () => {
    test('parses response with both ===AMENDMENT=== and ===COMMENT=== sections', () => {
        const input = '===AMENDMENT===\namended text here\n===COMMENT===\ncomment text here';
        const result = parseDelimitedResponse(input);

        expect(result.amendment).toBe('amended text here');
        expect(result.comment).toBe('comment text here');
        expect(result.raw).toBe(input);
    });

    test('returns nulls when no delimiters found', () => {
        const input = 'no delimiters here, just plain text';
        const result = parseDelimitedResponse(input);

        expect(result.amendment).toBeNull();
        expect(result.comment).toBeNull();
        expect(result.raw).toBe(input);
    });

    test('handles only ===AMENDMENT=== section (no comment)', () => {
        const input = '===AMENDMENT===\nonly amendment content here';
        const result = parseDelimitedResponse(input);

        expect(result.amendment).toBe('only amendment content here');
        expect(result.comment).toBeNull();
        expect(result.raw).toBe(input);
    });

    test('trims whitespace around extracted sections', () => {
        const input = '===AMENDMENT===\n  amended text  \n\n===COMMENT===\n  comment text  \n';
        const result = parseDelimitedResponse(input);

        expect(result.amendment).toBe('amended text');
        expect(result.comment).toBe('comment text');
    });

    test('handles empty sections (whitespace only) as null', () => {
        const input = '===AMENDMENT===\n   \n===COMMENT===\n   ';
        const result = parseDelimitedResponse(input);

        expect(result.amendment).toBeNull();
        expect(result.comment).toBeNull();
    });

    test('handles multiline content in both sections', () => {
        const input = '===AMENDMENT===\nline 1\nline 2\nline 3\n===COMMENT===\ncomment line 1\ncomment line 2';
        const result = parseDelimitedResponse(input);

        expect(result.amendment).toBe('line 1\nline 2\nline 3');
        expect(result.comment).toBe('comment line 1\ncomment line 2');
    });

    test('always includes raw field with original text', () => {
        const input = '===AMENDMENT===\ntext\n===COMMENT===\ncomment';
        const result = parseDelimitedResponse(input);

        expect(result.raw).toBe(input);
    });

    test('handles text before ===AMENDMENT=== marker (preamble)', () => {
        const input = 'Here is my response:\n===AMENDMENT===\namended text\n===COMMENT===\ncomment text';
        const result = parseDelimitedResponse(input);

        expect(result.amendment).toBe('amended text');
        expect(result.comment).toBe('comment text');
    });
});

// ============================================================================
// buildFallbackClassificationPrompt
// ============================================================================

describe('buildFallbackClassificationPrompt', () => {
    test('returns a messages array with system and user messages', () => {
        const messages = buildFallbackClassificationPrompt('raw response', 'original clause');

        expect(Array.isArray(messages)).toBe(true);
        expect(messages).toHaveLength(2);
    });

    test('system message instructs response formatting', () => {
        const messages = buildFallbackClassificationPrompt('raw response', 'original clause');

        expect(messages[0].role).toBe('system');
        expect(messages[0].content).toContain('response formatter');
        expect(messages[0].content).toContain('amendment');
        expect(messages[0].content).toContain('comment');
    });

    test('user message includes the raw response and original selection', () => {
        const messages = buildFallbackClassificationPrompt('the LLM output', 'the selected text');

        expect(messages[1].role).toBe('user');
        expect(messages[1].content).toContain('the LLM output');
        expect(messages[1].content).toContain('the selected text');
    });

    test('user message includes delimiter instructions', () => {
        const messages = buildFallbackClassificationPrompt('raw', 'sel');

        expect(messages[1].content).toContain('===AMENDMENT===');
        expect(messages[1].content).toContain('===COMMENT===');
    });

    test('returns proper {role, content} structure', () => {
        const messages = buildFallbackClassificationPrompt('raw', 'sel');

        messages.forEach(msg => {
            expect(msg).toHaveProperty('role');
            expect(msg).toHaveProperty('content');
            expect(typeof msg.role).toBe('string');
            expect(typeof msg.content).toBe('string');
        });
    });
});
