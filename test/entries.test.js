import test from 'node:test';
import assert from 'node:assert/strict';

import {
    WI_POSITION,
    cloneAndNormalizeEntries,
    getExactPromptOccurrenceRanks,
    getStructuralPromptTuple,
    groupEntriesByLorebook,
    sortEntriesByPromptOrder,
} from '../lib/entries.js';

function entry(name, position, extra = {}) {
    return {
        uid: name,
        world: extra.world ?? 'Book',
        comment: name,
        key: [`${name}-key`],
        content: `${name} content`,
        position,
        order: extra.order ?? 10,
        ...extra,
    };
}

test('entries are deeply cloned and receive display/post-regex fields', () => {
    const source = [{
        uid: 7,
        world: 'Lore',
        comment: '  Named Entry  ',
        key: ['alpha', 'beta'],
        keysecondary: ['gamma'],
        content: 'raw',
        position: WI_POSITION.AT_DEPTH,
        depth: 6,
        constant: true,
        nested: { untouched: true },
    }];
    const snapshot = structuredClone(source);
    const normalized = cloneAndNormalizeEntries(source, { transformContent: () => '' });

    assert.deepEqual(source, snapshot);
    assert.notStrictEqual(normalized[0].nested, source[0].nested);
    assert.equal(normalized[0].displayName, 'Named Entry');
    assert.deepEqual(normalized[0].secondaryKeys, ['gamma']);
    assert.equal(normalized[0].strategyLabel, 'Constant');
    assert.equal(normalized[0].insertionLabel, 'At Depth · 6');
    assert.equal(normalized[0].finalPromptContent, '');
    assert.equal(normalized[0].type, 'wi');
    assert.equal(normalized[0].omittedAfterFiltering, true);
});

test('all local numeric positions receive insertion labels', () => {
    const expected = [
        [WI_POSITION.BEFORE, 'Before Character'],
        [WI_POSITION.AFTER, 'After Character'],
        [WI_POSITION.AN_TOP, 'Author’s Note · Top'],
        [WI_POSITION.AN_BOTTOM, 'Author’s Note · Bottom'],
        [WI_POSITION.AT_DEPTH, 'At Depth · 4'],
        [WI_POSITION.EM_TOP, 'Example Messages · Top'],
        [WI_POSITION.EM_BOTTOM, 'Example Messages · Bottom'],
    ];
    const result = cloneAndNormalizeEntries(expected.map(([position]) => ({
        uid: position,
        world: 'Lore',
        key: ['fallback'],
        content: 'kept',
        position,
    })));
    assert.deepEqual(result.map((item) => item.insertionLabel), expected.map(([, label]) => label));
    assert.equal(result[0].displayName, 'fallback');
});

test('lorebook grouping alphabetizes copies without input mutation', () => {
    const entries = [
        entry('Zulu', WI_POSITION.BEFORE, { world: 'Beta' }),
        entry('Ten', WI_POSITION.BEFORE, { world: 'alpha 10' }),
        entry('Two', WI_POSITION.BEFORE, { world: 'alpha 2' }),
        entry('Alpha', WI_POSITION.BEFORE, { world: 'Beta' }),
    ];
    const originalOrder = entries.map((item) => item.uid);
    const groups = groupEntriesByLorebook(entries);
    assert.deepEqual(entries.map((item) => item.uid), originalOrder);
    assert.deepEqual(groups.map((group) => group.world), ['alpha 2', 'alpha 10', 'Beta']);
    assert.deepEqual(groups[2].entries.map((item) => item.uid), ['Alpha', 'Zulu']);
});

test('structural sort honors live markers, every position, depth, and in-chat lane', () => {
    const entries = [
        entry('before', WI_POSITION.BEFORE),
        entry('em-bottom', WI_POSITION.EM_BOTTOM),
        entry('an-bottom', WI_POSITION.AN_BOTTOM),
        entry('at-depth-3', WI_POSITION.AT_DEPTH, { depth: 3 }),
        entry('after', WI_POSITION.AFTER),
        entry('at-depth-5', WI_POSITION.AT_DEPTH, { depth: 5 }),
        entry('em-top', WI_POSITION.EM_TOP),
        entry('an-top', WI_POSITION.AN_TOP),
    ];
    const originalOrder = entries.map((item) => item.uid);
    const promptCollection = [
        { identifier: 'chatHistory' },
        { identifier: 'worldInfoAfter' },
        { identifier: 'dialogueExamples' },
        { identifier: 'worldInfoBefore' },
    ];
    const sorted = sortEntriesByPromptOrder(entries, { promptCollection, authorsNoteDepth: 3 });

    assert.deepEqual(entries.map((item) => item.uid), originalOrder);
    assert.deepEqual(sorted.map((item) => item.uid), [
        'at-depth-5',
        'an-top',
        'an-bottom',
        'at-depth-3',
        'after',
        'em-top',
        'em-bottom',
        'before',
    ]);
    assert.deepEqual(
        getStructuralPromptTuple(entries[5], { promptCollection, authorsNoteDepth: 3 }),
        [0, 0, -5, 0, 2, 10, WI_POSITION.AT_DEPTH],
    );
});

test('ordinary WI buckets reverse equal-order activation ties like core unshift', () => {
    const entries = [
        entry('Zulu stays first', WI_POSITION.BEFORE, { order: 20 }),
        entry('Alpha stays second', WI_POSITION.BEFORE, { order: 20 }),
        entry('Lower order first', WI_POSITION.BEFORE, { order: 1 }),
    ];
    assert.deepEqual(
        sortEntriesByPromptOrder(entries).map((item) => item.uid),
        ['Lower order first', 'Alpha stays second', 'Zulu stays first'],
    );
});

test('EM Top mirrors the double-unshift while EM Bottom mirrors one unshift', () => {
    const entries = [
        entry('top-high-a', WI_POSITION.EM_TOP, { order: 30 }),
        entry('top-high-b', WI_POSITION.EM_TOP, { order: 30 }),
        entry('top-low', WI_POSITION.EM_TOP, { order: 10 }),
        entry('bottom-high-a', WI_POSITION.EM_BOTTOM, { order: 30 }),
        entry('bottom-high-b', WI_POSITION.EM_BOTTOM, { order: 30 }),
        entry('bottom-low', WI_POSITION.EM_BOTTOM, { order: 10 }),
    ];

    assert.deepEqual(
        sortEntriesByPromptOrder(entries).map((item) => item.uid),
        [
            'top-high-a',
            'top-high-b',
            'top-low',
            'bottom-low',
            'bottom-high-b',
            'bottom-high-a',
        ],
    );
});

test('in-chat fallback orders depth, role, Author’s Note, then custom depth content', () => {
    const entries = [
        entry('system-depth', WI_POSITION.AT_DEPTH, { depth: 4, role: 0 }),
        entry('user-depth', WI_POSITION.AT_DEPTH, { depth: 4, role: 1 }),
        entry('assistant-depth', WI_POSITION.AT_DEPTH, { depth: 4, role: 2 }),
        entry('an-bottom', WI_POSITION.AN_BOTTOM),
        entry('an-top', WI_POSITION.AN_TOP),
    ];

    assert.deepEqual(
        sortEntriesByPromptOrder(entries, {
            promptCollection: [{ identifier: 'chatHistory' }],
            authorsNotePosition: 1,
            authorsNoteDepth: 4,
            authorsNoteRole: 1,
        }).map((item) => item.uid),
        ['assistant-depth', 'an-top', 'an-bottom', 'user-depth', 'system-depth'],
    );
});

test('live Author’s Note position moves its WI around the main marker', () => {
    const entries = [
        entry('at-depth', WI_POSITION.AT_DEPTH, { depth: 8 }),
        entry('an-top', WI_POSITION.AN_TOP),
        entry('before', WI_POSITION.BEFORE),
    ];
    const promptCollection = [
        { identifier: 'main' },
        { identifier: 'worldInfoBefore' },
        { identifier: 'chatHistory' },
    ];

    assert.deepEqual(
        sortEntriesByPromptOrder(entries, {
            promptCollection,
            authorsNotePosition: 2,
            authorsNoteDepth: 1,
            authorsNoteRole: 0,
        }).map((item) => item.uid),
        ['an-top', 'before', 'at-depth'],
    );
});

test('complete exact final-chat ranks override structure', () => {
    const [before, after] = cloneAndNormalizeEntries([
        entry('before', WI_POSITION.BEFORE),
        entry('after', WI_POSITION.AFTER),
    ]);
    const entries = [before, after];
    const finalChat = [
        { role: 'system', content: `prefix ${after.finalPromptContent}` },
        { role: 'system', content: `prefix ${before.finalPromptContent}` },
    ];
    assert.deepEqual(getExactPromptOccurrenceRanks(entries, finalChat), {
        complete: true,
        ranks: [{ messageIndex: 1, offset: 7 }, { messageIndex: 0, offset: 7 }],
    });
    assert.deepEqual(
        sortEntriesByPromptOrder(entries, { finalChat }).map((item) => item.uid),
        ['after', 'before'],
    );
});

test('an incomplete exact match makes the whole list use structural fallback', () => {
    const [before, after] = cloneAndNormalizeEntries([
        entry('before', WI_POSITION.BEFORE),
        entry('after', WI_POSITION.AFTER),
    ]);
    const finalChat = [{ role: 'system', content: after.finalPromptContent }];
    assert.equal(getExactPromptOccurrenceRanks([before, after], finalChat).complete, false);
    assert.deepEqual(
        sortEntriesByPromptOrder([after, before], { finalChat }).map((item) => item.uid),
        ['before', 'after'],
    );

    const duplicates = [
        { ...before, finalPromptContent: 'same' },
        { ...after, finalPromptContent: 'same' },
    ];
    assert.equal(
        getExactPromptOccurrenceRanks(duplicates, [{ content: 'same\nsame' }]).complete,
        false,
    );
});
