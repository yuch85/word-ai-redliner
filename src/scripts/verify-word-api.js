/* global Word */
import { applySentenceDiffStrategy, computeDiff } from 'office-word-diff';

export async function runAllVerifications(logCallback) {
    const log = logCallback || console.log;

    log("=== Starting Comprehensive API Verification ===");

    try {
        await verifyOffsetInsertion(log);
        await verifyTrackedChanges(log);
        await verifyTokenMapStrategy(log);
        // await verifyChunkSearch(log); // Disabled per user request
        await verifyLineDiffStrategy(log);
        await verifyPlaceholderTest6(log);
        await verifyOoxmlInsertion(log);
        await verifyBlockDeletion(log);

        log("=== All Verifications Completed ===");
    } catch (error) {
        log(`CRITICAL ERROR: ${error.message}`);
        console.error(error);
    }
}

async function verifyOffsetInsertion(log) {
    await Word.run(async (context) => {
        log("\n[Test 1] Tokenized Range Access (getTextRanges)");

        const body = context.document.body;
        const paragraph = body.insertParagraph("Start End", Word.InsertLocation.start);
        paragraph.insertParagraph("Test 1 - Tokenized Range Access", Word.InsertLocation.before);
        paragraph.font.color = "purple";
        await context.sync();

        // Strategy: Use getTextRanges to get handles to specific parts

        // Sub-Test A: Word Level
        try {
            const wordRanges = paragraph.getTextRanges([" "], false);
            wordRanges.load("items");
            await context.sync();
            log(`DEBUG: Found ${wordRanges.items.length} word ranges.`);

            if (wordRanges.items.length >= 1) {
                // Insert after first word ("Start")
                // "Start" is item 0.
                // We want to insert "Middle " between "Start" and "End".
                // Item 0 is "Start". Item 1 is "End".
                // Insert "Middle " Before Item 1.
                if (wordRanges.items.length > 1) {
                    wordRanges.items[1].insertText("Middle ", Word.InsertLocation.before);
                    log("✅ Action: Inserted 'Middle ' before second word.");
                } else {
                    // Fallback if only 1 word found (e.g. "Start End" might be parsed differently?)
                    wordRanges.items[0].insertText(" Middle", Word.InsertLocation.after);
                }
            }
        } catch (e) {
            log(`❌ Error in Word-Level split: ${e.message}`);
        }

        await context.sync();

        // Verify Test A result immediately
        paragraph.load("text");
        await context.sync();

        if (paragraph.text === "Start Middle End") {
            log("✅ SUCCESS: Word-level insertion worked. Result: 'Start Middle End'");
        } else {
            log(`❌ FAILURE: Expected 'Start Middle End', got '${paragraph.text}'`);
        }

        // Sub-Test B: Character Level (Experimental) - DISABLED (Known to fail with InvalidArgument)
        /*
        try {
            // Create a NEW paragraph for Test B, don't delete the old one yet so user can see it
            const p2 = body.insertParagraph("ABC", Word.InsertLocation.start);
            await context.sync();

            // Try splitting by empty string to get chars?
            // Note: Documentation says "punctuation marks and other ending marks". 
            // Passing [""] might not work or might return nothing.
            // Let's try [""] and see.
            const charRanges = p2.getTextRanges([""], false);
            charRanges.load("items");
            await context.sync();

            log(`DEBUG: Found ${charRanges.items.length} char ranges for 'ABC'.`);

            if (charRanges.items.length === 3) {
                log("✅ SUCCESS: Character-level access supported!");
                // Insert "-" after "B" (Item 1)
                charRanges.items[1].insertText("-", Word.InsertLocation.after);
            } else {
                log("⚠️ INFO: Character-level split not supported with [''].");
            }

            // p2.delete(); // Keep it for visual inspection
        } catch (e) {
            log(`⚠️ INFO: Character-level split failed: ${e.message}`);
        }
        */

        // Cleanup - Commented out for visual inspection
        // paragraph.delete();
        // await context.sync();
    });
}

async function verifyTrackedChanges(log) {
    // Check WordApi 1.4 support first
    if (!Office.context.requirements.isSetSupported('WordApi', '1.4')) {
        log('⚠️ WordApi 1.4 not available on this host - skipping tracked changes test');
        return;
    }

    await Word.run(async (context) => {
        log("\n[Test 2] Offset-Based Tracked Deletion (using needle search and split)");
        // selection.moveStart requires WordApiDesktop 1.4 (document.selection), which isn’t available on this host, so we stick to range-based offsets instead.
        try {
            // 1. Setup
            log("DEBUG: Step 1 - Setup paragraph");
            log("DEBUG: Step 1 - Setup paragraph");
            const body = context.document.body;
            const paragraph = body.insertParagraph("The quick brown fox", Word.InsertLocation.start);
            paragraph.insertParagraph("Test 2 - Offset-Based Tracked Deletion", Word.InsertLocation.before);
            await context.sync();

            // 2. Load paragraph text to verify content
            paragraph.load("text");
            await context.sync();
            log(`DEBUG: Paragraph text: "${paragraph.text}"`);


            // 3. Calculate exact offsets for deletion
            const startOffset = 10;  // Start of "brown "
            const length = 6;        // Length of "brown " (including the trailing space)

            log(`DEBUG: Step 2 - Calculate offsets: start=${startOffset}, length=${length}`);

            // 4. Extract target and use it directly for search
            const text = paragraph.text;
            const target = text.slice(startOffset, startOffset + length);

            log(`DEBUG: Step 3 - Target to delete: "${target}"`);

            // 5. Search for exact target text
            const searchResults = paragraph.search(target, {
                matchCase: true,
                matchWholeWord: false
            });
            searchResults.load("items");
            await context.sync();

            if (searchResults.items.length === 0) {
                log("⚠️ Could not find target");
                return;
            }

            log(`DEBUG: Found ${searchResults.items.length} match(es) for "${target}"`);

            // 6. Get the first match (should be unique in this test case)
            const targetRange = searchResults.items[0];
            targetRange.load("text");
            await context.sync();

            log(`DEBUG: Step 4 - Match text: "${targetRange.text}"`);

            // 7. Enable Track Changes
            log("DEBUG: Step 5 - Enable Track Changes");
            try {
                if (!Word.ChangeTrackingMode) {
                    throw new Error('ChangeTrackingMode API not available');
                }
                context.document.changeTrackingMode = Word.ChangeTrackingMode.trackAll;
                await context.sync();
                log("✅ Track changes enabled (TrackAll mode)");
            } catch (trackError) {
                log(`❌ Could not enable track changes: ${trackError.message}`);
                return;
            }

            // 8. Delete the target range (track changes is now enabled)
            log("DEBUG: Step 6 - Deleting target range");
            targetRange.delete();
            await context.sync();

            log("✅ SUCCESS: Offset-based deletion completed!");

            // 9. Disable Track Changes
            log("DEBUG: Step 10 - Disable Track Changes");
            context.document.changeTrackingMode = Word.ChangeTrackingMode.off;
            await context.sync();

        } catch (e) {
            log(`❌ ERROR in Test 2: ${e.message}`);
            if (e instanceof OfficeExtension.Error) {
                log(`Debug Info: ${JSON.stringify(e.debugInfo)}`);
            }
        }

        // Cleanup - commented out for visual inspection
        // paragraph.delete();
        // await context.sync();
    });
}

async function verifyTokenMapStrategy(log) {
    if (!Office.context.requirements.isSetSupported('WordApi', '1.4')) {
        log('⚠️ WordApi 1.4 not available - skipping token map strategy test');
        return;
    }

    await Word.run(async (context) => {
        log("\n[Test 3] Token Map Strategy (Complex Legal Text) - Atomic & Clean Fallback");

        const body = context.document.body;

        // Complex Legal Text
        const text1 = `The term "Confidential Information" for the purpose of this Agreement shall mean any and all information and materials relating to the [Disclosing Party] disclosed, furnished or communicated (whether orally, provided such oral information is reduced to writing within 30 days after disclosure, or in writing, machine readable form, text, drawings, photographs, graphics, designs, plans, presentations, on-site visits or any other form whatsoever) by the Disclosing Party (whether through any of the Disclosing Party's Representatives (as defined below) or otherwise), directly or indirectly to the Receiving Party (or to the Receiving Party through the Receiving Party's Representatives), whether on, before or after the date hereof, in connection with the Purpose, but shall not include any such information:`;

        const text2 = `In this Agreement, “Confidential Information” means any information, data, or materials of whatever nature relating to the [Disclosing Party] that are disclosed, supplied, transmitted, or otherwise made available (whether verbally — including oral disclosures later summarised in writing within 30 days — or in written, digital, visual, schematic, photographic, demonstrative, on-site, or any other tangible or intangible form) by the [Disclosing Party], whether such disclosure is made directly or indirectly, and whether through any of the [Disclosing Party]’s Representatives (as defined below) or by any other method, to the [Receiving Party] or its Representatives. For the avoidance of doubt, such Confidential Information may be provided before, during, or after the date of this Agreement and may arise in connection with, arising out of, or merely incidental to the Purpose. Confidential Information does not include information that:`;

        const paragraph = body.insertParagraph(text1, Word.InsertLocation.start);
        paragraph.insertParagraph("Test 3 - Token Map Strategy", Word.InsertLocation.before);

        // SYNC 1: Setup text. This is the baseline.
        await context.sync();

        try {
            log("DEBUG: Running diff_wordMode...");
            const diffs = computeDiff(text1, text2);

            // Log summary of diffs
            let insertCount = 0, deleteCount = 0, equalCount = 0;
            diffs.forEach(d => {
                if (d[0] === 1) insertCount++;
                else if (d[0] === -1) deleteCount++;
                else equalCount++;
            });
            log(`DEBUG: DMP generated ${diffs.length} chunks (Eq:${equalCount}, Del:${deleteCount}, Ins:${insertCount})`);

            // --- Build Refined Token Map (Batched) ---
            log("DEBUG: Building Refined Token Map (Batched)...");

            // 1. Get Coarse Ranges
            const coarseRanges = paragraph.getTextRanges([" "], false);
            coarseRanges.load("items/text");
            // SYNC 2: Load coarse ranges
            await context.sync();

            const fineTokens = [];
            const dmpRegex = /(\w+|[^\w\s]+|\s+)/g;
            const searchProxies = [];

            // 2. Queue all searches
            for (let i = 0; i < coarseRanges.items.length; i++) {
                const coarseRange = coarseRanges.items[i];
                const coarseText = coarseRange.text;
                let match;
                dmpRegex.lastIndex = 0;

                while ((match = dmpRegex.exec(coarseText)) !== null) {
                    const tokenText = match[0];
                    if (tokenText.length === 0) continue;

                    // Queue search
                    const searchResults = coarseRange.search(tokenText, { matchCase: true });
                    searchResults.load("items");
                    searchProxies.push({
                        text: tokenText,
                        results: searchResults,
                        coarseText: coarseText // for debugging
                    });
                }
            }

            // SYNC 3: Execute all searches
            await context.sync();

            // 3. Process results
            for (const proxy of searchProxies) {
                if (proxy.results.items.length > 0) {
                    fineTokens.push({
                        text: proxy.text,
                        range: proxy.results.items[0]
                    });
                } else {
                    log(`⚠️ Could not map fine token "${proxy.text}" inside "${proxy.coarseText}"`);
                    throw new Error(`Token mapping failed for "${proxy.text}"`);
                }
            }

            fineTokens.forEach((t, i) => t.index = i);
            log(`DEBUG: Refined Token Map built with ${fineTokens.length} entries.`);

            // --- Pass 1: Identify Deletions ---
            log("DEBUG: Pass 1 - Collecting delete targets");
            const deleteTargets = [];
            let tokenIndex = 0;

            for (const [op, chunk] of diffs) {
                if (op === 0) { // EQUAL
                    const chunkTokens = chunk.match(/(\w+|[^\w\s]+|\s+)/g) || [];
                    tokenIndex += chunkTokens.length;
                } else if (op === -1) { // DELETE
                    const chunkTokens = chunk.match(/(\w+|[^\w\s]+|\s+)/g) || [];
                    const count = chunkTokens.length;
                    for (let i = 0; i < count; i++) {
                        if (tokenIndex < fineTokens.length) {
                            deleteTargets.push(fineTokens[tokenIndex]);
                            tokenIndex++;
                        }
                    }
                }
            }

            // --- Pass 2: Identify Insertions ---
            log("DEBUG: Pass 2 - Collecting insert operations");
            const deletedIndices = new Set(deleteTargets.map(t => t.index));
            const tokensAfterDeletes = fineTokens.filter(t => !deletedIndices.has(t.index));

            const insertOps = []; // { anchor: Range, location: InsertLocation, text: string }
            let currentTokenIdx = 0;
            let lastAnchorRange = null;

            for (const [op, chunk] of diffs) {
                if (op === 0) { // EQUAL
                    let textToConsume = chunk;
                    while (textToConsume.length > 0 && currentTokenIdx < tokensAfterDeletes.length) {
                        const token = tokensAfterDeletes[currentTokenIdx];
                        const tokenText = token.text;

                        if (textToConsume.startsWith(tokenText)) {
                            textToConsume = textToConsume.slice(tokenText.length);
                            lastAnchorRange = token.range;
                            currentTokenIdx++;
                        } else {
                            log(`⚠️ Sync warning: Expected "${textToConsume.slice(0, 10)}..." but found token "${tokenText}"`);
                            log("Map lookup failed - initiating fallback to Sentence Diff Strategy...");

                            // If token mapping fails during the insertion pass, the document state is inconsistent 
                            // (deletions from Pass 1 have already been applied).
                            // We throw an error here to be caught by the main try/catch block, which will 
                            // handle the clean fallback (resetting the paragraph and applying the Sentence Diff strategy).

                            throw new Error("Map lookup failed: Token mismatch.");
                        }
                    }
                } else if (op === 1) { // INSERT
                    if (lastAnchorRange) {
                        insertOps.push({
                            anchor: lastAnchorRange,
                            location: Word.InsertLocation.after,
                            text: chunk
                        });
                    } else {
                        // Insert at start of paragraph
                        insertOps.push({
                            anchor: paragraph.getRange(Word.InsertLocation.start),
                            location: Word.InsertLocation.before,
                            text: chunk
                        });
                    }
                }
            }

            // --- Execution Phase (Atomic-ish) ---
            log("DEBUG: Executing queued operations...");

            // 1. Enable Track Changes
            if (Word.ChangeTrackingMode) {
                context.document.changeTrackingMode = Word.ChangeTrackingMode.trackAll;
            }

            // 2. Apply Deletes (Reverse order to be safe, though ranges track themselves)
            deleteTargets.sort((a, b) => b.index - a.index);
            deleteTargets.forEach(token => token.range.delete());

            // 3. Apply Inserts
            insertOps.forEach(op => op.anchor.insertText(op.text, op.location));

            // 4. Disable Track Changes
            if (Word.ChangeTrackingMode) {
                context.document.changeTrackingMode = Word.ChangeTrackingMode.off;
            }

            // SYNC 4: Commit all edits
            await context.sync();
            log("✅ SUCCESS: Word-level diff applied atomically.");

        } catch (e) {
            log(`❌ Word-level strategy failed: ${e.message}`);
            log("⚠️ Initiating Clean Fallback to Sentence Diff Strategy...");

            // Fallback Logic:
            // 1. Reset the paragraph to the original text (text1) to ensure a clean state, 
            //    as the failed word-level attempt may have left partial deletions.
            // 2. Apply the Sentence Diff Strategy as a robust fallback.
            paragraph.clear();
            paragraph.insertText(text1, Word.InsertLocation.start);
            await context.sync();
            log("DEBUG: Paragraph reset to original text1 for fallback.");

            await applySentenceDiffStrategy(context, paragraph, text1, text2, log);
        }
    });
}

async function verifyChunkSearch(log) {
    if (!Office.context.requirements.isSetSupported('WordApi', '1.4')) {
        log('⚠️ WordApi 1.4 not available - skipping complex chunk search test');
        return;
    }

    await Word.run(async (context) => {
        log("\n[Test 4] Chunk Search Strategy (Complex Legal Text)");

        const body = context.document.body;

        // Complex Legal Text (Same as 3A)
        const text1 = `The term "Confidential Information" for the purpose of this Agreement shall mean any and all information and materials relating to the [Disclosing Party] disclosed, furnished or communicated (whether orally, provided such oral information is reduced to writing within 30 days after disclosure, or in writing, machine readable form, text, drawings, photographs, graphics, designs, plans, presentations, on-site visits or any other form whatsoever) by the Disclosing Party (whether through any of the Disclosing Party's Representatives (as defined below) or otherwise), directly or indirectly to the Receiving Party (or to the Receiving Party through the Receiving Party's Representatives), whether on, before or after the date hereof, in connection with the Purpose, but shall not include any such information:`;

        const text2 = `In this Agreement, “Confidential Information” means any information, data, or materials of whatever nature relating to the [Disclosing Party] that are disclosed, supplied, transmitted, or otherwise made available (whether verbally — including oral disclosures later summarised in writing within 30 days — or in written, digital, visual, schematic, photographic, demonstrative, on-site, or any other tangible or intangible form) by the [Disclosing Party], whether such disclosure is made directly or indirectly, and whether through any of the [Disclosing Party]’s Representatives (as defined below) or by any other method, to the [Receiving Party] or its Representatives. For the avoidance of doubt, such Confidential Information may be provided before, during, or after the date of this Agreement and may arise in connection with, arising out of, or merely incidental to the Purpose. Confidential Information does not include information that:`;

        const paragraph = body.insertParagraph(text1, Word.InsertLocation.start);
        paragraph.insertParagraph("Test 4 - Chunk Search Strategy", Word.InsertLocation.before);
        await context.sync();

        const diffs = computeDiff(text1, text2);

        log(`DEBUG: DMP generated ${diffs.length} chunks.`);

        try {
            if (Word.ChangeTrackingMode) {
                context.document.changeTrackingMode = Word.ChangeTrackingMode.trackAll;
                await context.sync();
                log("DEBUG: Track changes enabled");
            }
        } catch (e) {
            log(`⚠️ Could not enable track changes: ${e.message}`);
        }

        let cursorRange = paragraph.getRange(Word.RangeLocation.start);
        log("DEBUG: Replaying diffs...");

        for (const [op, chunk] of diffs) {
            if (op === 0) { // EQUAL
                const searchRange = cursorRange.expandTo(paragraph.getRange(Word.RangeLocation.end));
                const searchResults = searchRange.search(chunk, { matchCase: true });
                searchResults.load("items");
                await context.sync();

                if (searchResults.items.length > 0) {
                    const match = searchResults.items[0];
                    cursorRange = match.getRange(Word.RangeLocation.end);
                } else {
                    log(`❌ ERROR: Could not find EQUAL chunk "${chunk.slice(0, 20)}..."`);
                    throw new Error(`Lost sync on chunk: ${chunk.slice(0, 20)}...`);
                }

            } else if (op === -1) { // DELETE
                const searchRange = cursorRange.expandTo(paragraph.getRange(Word.RangeLocation.end));
                const searchResults = searchRange.search(chunk, { matchCase: true });
                searchResults.load("items");
                await context.sync();

                if (searchResults.items.length > 0) {
                    const match = searchResults.items[0];
                    match.delete();
                    await context.sync();
                } else {
                    log(`❌ ERROR: Could not find DELETE chunk "${chunk.slice(0, 20)}..."`);
                    throw new Error(`Lost sync on delete: ${chunk.slice(0, 20)}...`);
                }

            } else if (op === 1) { // INSERT
                const insertedRange = cursorRange.insertText(chunk, Word.InsertLocation.after);
                await context.sync();
                cursorRange = insertedRange.getRange(Word.RangeLocation.end);
            }
        }

        await context.sync();
        log("✅ Replay completed successfully.");

        if (Word.ChangeTrackingMode) {
            context.document.changeTrackingMode = Word.ChangeTrackingMode.off;
            await context.sync();
        }
    });
}

async function verifyLineDiffStrategy(log) {
    if (!Office.context.requirements.isSetSupported('WordApi', '1.4')) {
        log('⚠️ WordApi 1.4 not available - skipping line diff test');
        return;
    }

    await Word.run(async (context) => {
        log("\n[Test 5] Line Diff Strategy (Complex Legal Text)");

        const body = context.document.body;

        // Complex Legal Text (Same as Test 3, but modified for sentence diff)
        // Note: text1 ends with ". " to match the first sentence of text2 exactly.
        const text1 = `The term "Confidential Information" for the purpose of this Agreement shall mean any and all information and materials relating to the [Disclosing Party] disclosed, furnished or communicated (whether orally, provided such oral information is reduced to writing within 30 days after disclosure, or in writing, machine readable form, text, drawings, photographs, graphics, designs, plans, presentations, on-site visits or any other form whatsoever) by the Disclosing Party (whether through any of the Disclosing Party's Representatives (as defined below) or otherwise), directly or indirectly to the Receiving Party (or to the Receiving Party through the Receiving Party's Representatives), whether on, before or after the date hereof, in connection with the Purpose, but shall not include any such information. `;

        const text2 = `The term "Confidential Information" for the purpose of this Agreement shall mean any and all information and materials relating to the [Disclosing Party] disclosed, furnished or communicated (whether orally, provided such oral information is reduced to writing within 30 days after disclosure, or in writing, machine readable form, text, drawings, photographs, graphics, designs, plans, presentations, on-site visits or any other form whatsoever) by the Disclosing Party (whether through any of the Disclosing Party's Representatives (as defined below) or otherwise), directly or indirectly to the Receiving Party (or to the Receiving Party through the Receiving Party's Representatives), whether on, before or after the date hereof, in connection with the Purpose, but shall not include any such information. For clarity, such Confidential Information also includes supplementary background materials reasonably connected to the Purpose.`;

        const paragraph = body.insertParagraph(text1, Word.InsertLocation.start);
        paragraph.insertParagraph("Test 5 - Line Diff Strategy", Word.InsertLocation.before);
        await context.sync();

        await applySentenceDiffStrategy(context, paragraph, text1, text2, log);
    });
}

async function verifyPlaceholderTest6(log) {
    if (!Office.context.requirements.isSetSupported('WordApi', '1.4')) {
        log('⚠️ WordApi 1.4 not available - skipping whole paragraph strategy test');
        return;
    }

    await Word.run(async (context) => {
        log("\n[Test 6] Whole Paragraph Strategy");

        const body = context.document.body;

        // Same text as Test 3
        const text1 = `The term "Confidential Information" for the purpose of this Agreement shall mean any and all information and materials relating to the [Disclosing Party] disclosed, furnished or communicated (whether orally, provided such oral information is reduced to writing within 30 days after disclosure, or in writing, machine readable form, text, drawings, photographs, graphics, designs, plans, presentations, on-site visits or any other form whatsoever) by the Disclosing Party (whether through any of the Disclosing Party's Representatives (as defined below) or otherwise), directly or indirectly to the Receiving Party (or to the Receiving Party through the Receiving Party's Representatives), whether on, before or after the date hereof, in connection with the Purpose, but shall not include any such information:`;

        const text2 = `In this Agreement, “Confidential Information” means any information, data, or materials of whatever nature relating to the [Disclosing Party] that are disclosed, supplied, transmitted, or otherwise made available (whether verbally — including oral disclosures later summarised in writing within 30 days — or in written, digital, visual, schematic, photographic, demonstrative, on-site, or any other tangible or intangible form) by the [Disclosing Party], whether such disclosure is made directly or indirectly, and whether through any of the [Disclosing Party]’s Representatives (as defined below) or by any other method, to the [Receiving Party] or its Representatives. For the avoidance of doubt, such Confidential Information may be provided before, during, or after the date of this Agreement and may arise in connection with, arising out of, or merely incidental to the Purpose. Confidential Information does not include information that:`;

        const paragraph = body.insertParagraph(text1, Word.InsertLocation.start);
        paragraph.insertParagraph("Test 6 - Whole Paragraph Strategy", Word.InsertLocation.before);
        await context.sync();

        // Enable Track Changes
        let trackingEnabled = false;
        try {
            if (Word.ChangeTrackingMode) {
                context.document.changeTrackingMode = Word.ChangeTrackingMode.trackAll;
                await context.sync();
                trackingEnabled = true;
                log("DEBUG: Track changes enabled");
            }
        } catch (e) {
            log(`⚠️ Could not enable track changes: ${e.message}`);
        }

        // Strategy: Delete entire paragraph content, then insert new content
        // 1. Get range of the paragraph content
        const range = paragraph.getRange(Word.RangeLocation.content);

        // 2. Delete (Tracked)
        range.delete();

        // 3. Insert new text (Tracked)
        // We insert AFTER the deleted range to ensure it appears as a replacement.
        // Note: After delete(), the range object might still point to the deleted marker.
        // Inserting 'after' the deleted range should place it correctly.
        range.insertText(text2, Word.InsertLocation.after);

        await context.sync();
        log("✅ Whole paragraph replacement applied.");

        if (trackingEnabled) {
            context.document.changeTrackingMode = Word.ChangeTrackingMode.off;
            await context.sync();
        }
    });
}

async function verifyOoxmlInsertion(log) {
    await Word.run(async (context) => {
        log("\n[Test 7] OOXML Insertion (Table)");

        const body = context.document.body;

        // Simple OOXML for a 1x1 table
        const tableOoxml = `
      <w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:r><w:t>Before Table</w:t></w:r>
      </w:p>
      <w:tbl xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:tblPr>
          <w:tblBorders>
            <w:top w:val="single" w:sz="4"/>
            <w:left w:val="single" w:sz="4"/>
            <w:bottom w:val="single" w:sz="4"/>
            <w:right w:val="single" w:sz="4"/>
          </w:tblBorders>
        </w:tblPr>
        <w:tr>
          <w:tc>
            <w:p><w:r><w:t>Cell 1</w:t></w:r></w:p>
          </w:tc>
        </w:tr>
      </w:tbl>
    `;

        // Insert at start
        body.insertOoxml(tableOoxml, Word.InsertLocation.start);
        const paragraph = body.insertParagraph("Test 7 - OOXML Insertion", Word.InsertLocation.start);
        await context.sync();

        log("✅ ACTION: Inserted OOXML Table. Please visually verify.");

        // No cleanup - leave it for visual inspection
    });
}

async function verifyBlockDeletion(log) {
    await Word.run(async (context) => {
        log("\n[Test 8] Block Deletion");

        const body = context.document.body;
        const p1 = body.insertParagraph("Para to delete", Word.InsertLocation.start);
        const p2 = body.insertParagraph("Para to keep", Word.InsertLocation.after);
        p1.insertParagraph("Test 8 - Block Deletion", Word.InsertLocation.before);
        await context.sync();

        // Delete p1
        p1.delete();
        await context.sync();

        // Verify p2 is still there
        p2.load("text");
        await context.sync();

        if (p2.text === "Para to keep") {
            log("✅ SUCCESS: Deleted target block, kept subsequent block.");
        } else {
            log("❌ FAILURE: Subsequent block affected.");
        }

        // Cleanup
        p2.delete();
        await context.sync();
    });
}

