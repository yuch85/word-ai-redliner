/**
 * Unit tests for src/lib/context-extractor.js
 * Tests extractContext() and formatContextPrefix() exports.
 *
 * Covers:
 * - CTX-01: Definition extraction from common legal patterns
 * - CTX-02: Document outline built from heading paragraphs
 * - Abbreviation extraction from parenthetical notation
 * - formatContextPrefix with relevant-term filtering and token budget
 */
const { extractContext, formatContextPrefix } = require('../src/lib/context-extractor.js');

// Helper to build a minimal ParsedParagraph
function makePara(overrides) {
  return {
    index: 0,
    text: '',
    headingLevel: 0,
    styleBuiltIn: 'Normal',
    isListItem: false,
    listString: null,
    listLevel: 0,
    inTable: false,
    tokenEstimate: 0,
    ...overrides,
  };
}

// Helper to build a DocumentModel
function makeDocModel(paragraphs) {
  const totalTokens = paragraphs.reduce((sum, p) => sum + (p.tokenEstimate || 0), 0);
  return { paragraphs, totalTokens };
}

// ============================================================================
// extractContext -- definitions
// ============================================================================

describe('extractContext - definitions', () => {
  test('finds "Effective Date" means... pattern', () => {
    const docModel = makeDocModel([
      makePara({
        index: 0,
        text: '"Effective Date" means the date on which this Agreement is executed by both Parties.',
        tokenEstimate: 20,
      }),
    ]);
    const ctx = extractContext(docModel);
    expect(ctx.definitions).toHaveLength(1);
    expect(ctx.definitions[0].term).toBe('Effective Date');
    expect(ctx.definitions[0].definition).toContain('Effective Date');
    expect(ctx.definitions[0].paragraphIndex).toBe(0);
  });

  test('finds "Buyer" shall mean... pattern', () => {
    const docModel = makeDocModel([
      makePara({
        index: 3,
        text: '"Buyer" shall mean the party identified in Schedule A as the purchasing entity.',
        tokenEstimate: 18,
      }),
    ]);
    const ctx = extractContext(docModel);
    expect(ctx.definitions).toHaveLength(1);
    expect(ctx.definitions[0].term).toBe('Buyer');
    expect(ctx.definitions[0].paragraphIndex).toBe(3);
  });

  test('finds (the "Company") pattern', () => {
    const docModel = makeDocModel([
      makePara({
        index: 1,
        text: 'Acme Corporation (the "Company") is a Delaware corporation organized under the laws of the State.',
        tokenEstimate: 22,
      }),
    ]);
    const ctx = extractContext(docModel);
    expect(ctx.definitions).toHaveLength(1);
    expect(ctx.definitions[0].term).toBe('Company');
    expect(ctx.definitions[0].paragraphIndex).toBe(1);
  });

  test('finds (hereinafter "Vendor") pattern', () => {
    const docModel = makeDocModel([
      makePara({
        index: 2,
        text: 'TechServices LLC (hereinafter "Vendor") agrees to provide the following services.',
        tokenEstimate: 16,
      }),
    ]);
    const ctx = extractContext(docModel);
    expect(ctx.definitions).toHaveLength(1);
    expect(ctx.definitions[0].term).toBe('Vendor');
    expect(ctx.definitions[0].paragraphIndex).toBe(2);
  });

  test('finds terms with smart quotes (\u201C \u201D)', () => {
    const docModel = makeDocModel([
      makePara({
        index: 0,
        text: '\u201CService Period\u201D means the twelve-month period commencing on the Effective Date.',
        tokenEstimate: 18,
      }),
    ]);
    const ctx = extractContext(docModel);
    expect(ctx.definitions).toHaveLength(1);
    expect(ctx.definitions[0].term).toBe('Service Period');
  });

  test('finds "is defined as" pattern', () => {
    const docModel = makeDocModel([
      makePara({
        index: 5,
        text: '"Confidential Information" is defined as all non-public information disclosed by either Party.',
        tokenEstimate: 20,
      }),
    ]);
    const ctx = extractContext(docModel);
    expect(ctx.definitions).toHaveLength(1);
    expect(ctx.definitions[0].term).toBe('Confidential Information');
  });

  test('finds "refers to" pattern', () => {
    const docModel = makeDocModel([
      makePara({
        index: 6,
        text: '"Intellectual Property" refers to all patents, trademarks, and copyrights owned by the Company.',
        tokenEstimate: 18,
      }),
    ]);
    const ctx = extractContext(docModel);
    expect(ctx.definitions).toHaveLength(1);
    expect(ctx.definitions[0].term).toBe('Intellectual Property');
  });

  test('returns empty definitions array when no definitions found', () => {
    const docModel = makeDocModel([
      makePara({
        index: 0,
        text: 'This is a regular paragraph with no defined terms.',
        tokenEstimate: 12,
      }),
    ]);
    const ctx = extractContext(docModel);
    expect(ctx.definitions).toEqual([]);
  });

  test('captures definition text (first 200 chars of paragraph)', () => {
    const longText = '"Agreement" means ' + 'x'.repeat(300);
    const docModel = makeDocModel([
      makePara({ index: 0, text: longText, tokenEstimate: 80 }),
    ]);
    const ctx = extractContext(docModel);
    expect(ctx.definitions[0].definition.length).toBeLessThanOrEqual(200);
  });
});

// ============================================================================
// extractContext -- abbreviations
// ============================================================================

describe('extractContext - abbreviations', () => {
  test('finds abbreviation patterns like (ABC) after full name', () => {
    const docModel = makeDocModel([
      makePara({
        index: 0,
        text: 'The Acme Business Corporation (ABC) was founded in 2020.',
        tokenEstimate: 14,
      }),
    ]);
    const ctx = extractContext(docModel);
    expect(ctx.abbreviations).toHaveLength(1);
    expect(ctx.abbreviations[0].abbreviation).toBe('ABC');
    expect(ctx.abbreviations[0].paragraphIndex).toBe(0);
  });

  test('finds abbreviation with preceding text as expansion', () => {
    const docModel = makeDocModel([
      makePara({
        index: 2,
        text: 'The Securities and Exchange Commission (SEC) regulates this activity.',
        tokenEstimate: 14,
      }),
    ]);
    const ctx = extractContext(docModel);
    expect(ctx.abbreviations).toHaveLength(1);
    expect(ctx.abbreviations[0].abbreviation).toBe('SEC');
    expect(ctx.abbreviations[0].expansion).toBeTruthy();
  });

  test('requires at least 2 uppercase letters for abbreviation', () => {
    const docModel = makeDocModel([
      makePara({
        index: 0,
        text: 'Something (A) is not an abbreviation but (AB) is.',
        tokenEstimate: 12,
      }),
    ]);
    const ctx = extractContext(docModel);
    // Only (AB) should match, not (A)
    expect(ctx.abbreviations.length).toBeGreaterThanOrEqual(1);
    const abbrs = ctx.abbreviations.map((a) => a.abbreviation);
    expect(abbrs).toContain('AB');
    expect(abbrs).not.toContain('A');
  });

  test('returns empty abbreviations when none found', () => {
    const docModel = makeDocModel([
      makePara({
        index: 0,
        text: 'No abbreviations in this text at all.',
        tokenEstimate: 8,
      }),
    ]);
    const ctx = extractContext(docModel);
    expect(ctx.abbreviations).toEqual([]);
  });
});

// ============================================================================
// extractContext -- outline
// ============================================================================

describe('extractContext - outline', () => {
  test('builds outline from heading paragraphs with correct level and text', () => {
    const docModel = makeDocModel([
      makePara({ index: 0, text: 'Introduction', headingLevel: 1, styleBuiltIn: 'Heading1', tokenEstimate: 3 }),
      makePara({ index: 1, text: 'This is the introduction body.', headingLevel: 0, tokenEstimate: 7 }),
      makePara({ index: 2, text: 'Background', headingLevel: 2, styleBuiltIn: 'Heading2', tokenEstimate: 2 }),
      makePara({ index: 3, text: 'Background details here.', headingLevel: 0, tokenEstimate: 5 }),
      makePara({ index: 4, text: 'Terms and Conditions', headingLevel: 1, styleBuiltIn: 'Heading1', tokenEstimate: 5 }),
    ]);
    const ctx = extractContext(docModel);
    expect(ctx.outline).toHaveLength(3);
    expect(ctx.outline[0]).toEqual({ level: 1, text: 'Introduction', paragraphIndex: 0 });
    expect(ctx.outline[1]).toEqual({ level: 2, text: 'Background', paragraphIndex: 2 });
    expect(ctx.outline[2]).toEqual({ level: 1, text: 'Terms and Conditions', paragraphIndex: 4 });
  });

  test('returns empty outline when no headings found', () => {
    const docModel = makeDocModel([
      makePara({ index: 0, text: 'Just a normal paragraph.', headingLevel: 0, tokenEstimate: 6 }),
      makePara({ index: 1, text: 'Another normal paragraph.', headingLevel: 0, tokenEstimate: 6 }),
    ]);
    const ctx = extractContext(docModel);
    expect(ctx.outline).toEqual([]);
  });
});

// ============================================================================
// extractContext -- empty / minimal document
// ============================================================================

describe('extractContext - empty/minimal document', () => {
  test('returns empty arrays when document has no content', () => {
    const docModel = makeDocModel([]);
    const ctx = extractContext(docModel);
    expect(ctx.definitions).toEqual([]);
    expect(ctx.abbreviations).toEqual([]);
    expect(ctx.outline).toEqual([]);
  });

  test('returns empty arrays when no definitions/abbreviations/headings found', () => {
    const docModel = makeDocModel([
      makePara({ index: 0, text: 'Plain text without any special patterns.', headingLevel: 0, tokenEstimate: 10 }),
    ]);
    const ctx = extractContext(docModel);
    expect(ctx.definitions).toEqual([]);
    expect(ctx.abbreviations).toEqual([]);
    expect(ctx.outline).toEqual([]);
  });
});

// ============================================================================
// formatContextPrefix
// ============================================================================

describe('formatContextPrefix', () => {
  const fullContext = {
    definitions: [
      { term: 'Effective Date', definition: '"Effective Date" means the date on which this Agreement is executed.', paragraphIndex: 0 },
      { term: 'Buyer', definition: '"Buyer" shall mean the party identified in Schedule A.', paragraphIndex: 1 },
      { term: 'Confidential Information', definition: '"Confidential Information" is defined as all non-public information.', paragraphIndex: 5 },
    ],
    abbreviations: [
      { abbreviation: 'ABC', expansion: 'Acme Business Corporation', paragraphIndex: 2 },
    ],
    outline: [
      { level: 1, text: 'Introduction', paragraphIndex: 0 },
      { level: 2, text: 'Definitions', paragraphIndex: 3 },
      { level: 1, text: 'Terms', paragraphIndex: 10 },
    ],
  };

  test('includes only definitions whose term appears in chunk text (case-insensitive)', () => {
    const chunkText = 'The effective date shall be determined by mutual agreement of the Parties.';
    const result = formatContextPrefix(fullContext, chunkText);
    expect(result).toContain('Effective Date');
    expect(result).not.toContain('Buyer');
    expect(result).not.toContain('Confidential Information');
  });

  test('includes all relevant definitions when chunk references multiple', () => {
    const chunkText = 'The Buyer acknowledges that the Effective Date is binding.';
    const result = formatContextPrefix(fullContext, chunkText);
    expect(result).toContain('Effective Date');
    expect(result).toContain('Buyer');
    expect(result).not.toContain('Confidential Information');
  });

  test('omits definitions section when chunk text contains no defined terms', () => {
    const chunkText = 'This paragraph has absolutely no defined terms from the glossary.';
    const result = formatContextPrefix(fullContext, chunkText);
    expect(result).not.toContain('DOCUMENT DEFINITIONS');
  });

  test('includes document outline section', () => {
    const chunkText = 'Some chunk text referencing the Effective Date.';
    const result = formatContextPrefix(fullContext, chunkText);
    expect(result).toContain('DOCUMENT STRUCTURE');
    expect(result).toContain('Introduction');
    expect(result).toContain('Definitions');
    expect(result).toContain('Terms');
  });

  test('truncates output to stay within maxTokens budget', () => {
    // Create a context with many definitions to force truncation
    const manyDefs = [];
    for (let i = 0; i < 50; i++) {
      manyDefs.push({
        term: `LongTermName${i}`,
        definition: `"LongTermName${i}" means a very detailed and lengthy definition that spans multiple words and phrases to consume token budget. `.repeat(3),
        paragraphIndex: i,
      });
    }

    const bigContext = {
      definitions: manyDefs,
      abbreviations: [],
      outline: fullContext.outline,
    };

    // Build chunk text referencing all terms
    const chunkText = manyDefs.map((d) => d.term).join(' ');

    const result = formatContextPrefix(bigContext, chunkText, 100);
    // estimateTokenCount = Math.ceil(text.length / 4), so 100 tokens ~ 400 chars
    // The result should be truncated
    const estimatedTokens = Math.ceil(result.length / 4);
    expect(estimatedTokens).toBeLessThanOrEqual(100);
  });

  test('includes abbreviations section when present', () => {
    const chunkText = 'The ABC corporation is referenced here with the Effective Date.';
    const result = formatContextPrefix(fullContext, chunkText);
    expect(result).toContain('ABC');
    expect(result).toContain('Acme Business Corporation');
  });

  test('returns empty string when context has no relevant content for chunk', () => {
    const emptyContext = {
      definitions: [],
      abbreviations: [],
      outline: [],
    };
    const result = formatContextPrefix(emptyContext, 'Some chunk text');
    expect(result).toBe('');
  });
});
