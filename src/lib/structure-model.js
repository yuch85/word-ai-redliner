/* global Word */

/**
 * Represents a structure-aware paragraph block.
 * Maintains a "Token Map" of ranges for precise editing.
 */
export class ParagraphBlock {
    constructor(paragraph) {
        this.paragraph = paragraph;
        this.tokens = []; // Array of { text: string, range: Word.Range }
        this.text = "";
    }

    /**
     * Builds the Token Map by splitting the paragraph into ranges.
     * Uses getTextRanges([" "]) to split by space, preserving punctuation with words.
     * @param {Word.RequestContext} context 
     */
    async tokenize(context) {
        // 1. Get ranges split by space
        // Note: This is a simplified tokenizer. For production, we might want more granular splitting,
        // but getTextRanges([" "]) is a good starting point as it aligns with "Word" granularity.
        const tokenRanges = this.paragraph.getTextRanges([" "], false);
        tokenRanges.load("items");
        await context.sync();

        // 2. Build the map
        this.tokens = [];
        this.text = "";

        for (let i = 0; i < tokenRanges.items.length; i++) {
            const range = tokenRanges.items[i];
            range.load("text");
            // We process in batches or sync after loading all? 
            // Loading 'text' property requires a sync if we want to read it immediately.
            // To be efficient, we should load all then sync once.
        }
        await context.sync();

        for (let i = 0; i < tokenRanges.items.length; i++) {
            const range = tokenRanges.items[i];
            this.tokens.push({
                index: i,
                text: range.text,
                range: range
            });
            this.text += range.text;
        }
    }

    /**
     * Returns the plain text of the block.
     */
    getText() {
        return this.text;
    }

    /**
     * Returns the token at a specific index.
     * @param {number} index 
     */
    getToken(index) {
        return this.tokens[index];
    }
}
