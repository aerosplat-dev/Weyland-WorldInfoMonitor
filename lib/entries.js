export const WI_POSITION = Object.freeze({
    BEFORE: 0,
    AFTER: 1,
    AN_TOP: 2,
    AN_BOTTOM: 3,
    AT_DEPTH: 4,
    EM_TOP: 5,
    EM_BOTTOM: 6,
});

export const DEFAULT_DEPTH = 4;

const TARGET_MARKERS = Object.freeze([
    'main',
    'worldInfoBefore',
    'worldInfoAfter',
    'dialogueExamples',
    'chatHistory',
]);

const EXTENSION_PROMPT_POSITION = Object.freeze({
    NONE: -1,
    IN_PROMPT: 0,
    IN_CHAT: 1,
    BEFORE_PROMPT: 2,
});

const EXTENSION_PROMPT_ROLE = Object.freeze({
    SYSTEM: 0,
    USER: 1,
    ASSISTANT: 2,
});

const LOREBOOK_COLLATOR = new Intl.Collator('en', {
    sensitivity: 'base',
    numeric: true,
});

function cloneValue(value) {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }

    return JSON.parse(JSON.stringify(value));
}

function asFiniteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function compareNumbers(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}

function compareTuples(left, right) {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index++) {
        const comparison = compareNumbers(left[index] ?? 0, right[index] ?? 0);
        if (comparison !== 0) return comparison;
    }
    return 0;
}

function stableSort(values, compare) {
    return values
        .map((value, index) => ({ value, index }))
        .sort((left, right) => compare(left.value, right.value) || left.index - right.index)
        .map(({ value }) => value);
}

/**
 * @param {Record<string, any>} entry
 * @returns {string}
 */
export function getEntryDisplayName(entry) {
    if (entry.comment !== undefined && String(entry.comment).trim()) {
        return String(entry.comment).trim();
    }

    const keys = entry.keys ?? entry.key;
    if (Array.isArray(keys)) {
        const joined = keys.map(String).filter(Boolean).join(', ');
        if (joined) return joined;
    } else if (keys !== undefined && keys !== null && String(keys).trim()) {
        return String(keys).trim();
    }

    return entry.uid === undefined || entry.uid === null
        ? 'Untitled entry'
        : `Entry ${entry.uid}`;
}

/**
 * @param {Record<string, any>} entry
 * @returns {'Constant'|'Vectorized'|'Keyword'}
 */
export function getActivationLabel(entry) {
    if (entry.constant === true) return 'Constant';
    if (entry.vectorized === true) return 'Vectorized';
    return 'Keyword';
}

/**
 * @param {Record<string, any>} entry
 * @returns {string}
 */
export function getInsertionLabel(entry) {
    switch (Number(entry.position)) {
        case WI_POSITION.BEFORE:
            return 'Before Character';
        case WI_POSITION.AFTER:
            return 'After Character';
        case WI_POSITION.AN_TOP:
            return 'Author\u2019s Note \u00b7 Top';
        case WI_POSITION.AN_BOTTOM:
            return 'Author\u2019s Note \u00b7 Bottom';
        case WI_POSITION.AT_DEPTH:
            return `At Depth \u00b7 ${asFiniteNumber(entry.depth, DEFAULT_DEPTH)}`;
        case WI_POSITION.EM_TOP:
            return 'Example Messages \u00b7 Top';
        case WI_POSITION.EM_BOTTOM:
            return 'Example Messages \u00b7 Bottom';
        default:
            return 'Unknown Position';
    }
}

/**
 * Makes a detached monitor entry from a core WORLD_INFO_ACTIVATED entry.
 * `finalPromptContent` must be the result of core's WORLD_INFO prompt-regex
 * pass when one is available. Passing it explicitly, even when it is an empty
 * string, distinguishes post-regex output from the activated source content.
 *
 * @param {Record<string, any>} entry
 * @param {{finalPromptContent?: unknown}} [options]
 * @returns {Record<string, any>}
 */
export function cloneAndNormalizeEntry(entry, options = {}) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new TypeError('World Info entry must be an object');
    }

    const cloned = cloneValue(entry);
    const hasExplicitPromptContent = Object.hasOwn(options, 'finalPromptContent');
    const finalPromptContent = String(
        hasExplicitPromptContent
            ? options.finalPromptContent ?? ''
            : cloned.finalPromptContent ?? cloned.content ?? '',
    );
    const keys = cloned.keys ?? cloned.key;
    const secondaryKeys = cloned.secondaryKeys ?? cloned.keysecondary ?? cloned.secondary_keys;

    return {
        ...cloned,
        world: String(cloned.world ?? 'Unknown lorebook'),
        uid: cloned.uid ?? cloned.id ?? null,
        type: 'wi',
        keys: Array.isArray(keys)
            ? [...keys]
            : keys === undefined || keys === null
                ? []
                : [String(keys)],
        secondaryKeys: Array.isArray(secondaryKeys)
            ? [...secondaryKeys]
            : secondaryKeys === undefined || secondaryKeys === null
                ? []
                : [String(secondaryKeys)],
        displayName: getEntryDisplayName(cloned),
        strategyLabel: getActivationLabel(cloned),
        insertionLabel: getInsertionLabel(cloned),
        finalPromptContent,
        omittedAfterFiltering: finalPromptContent.length === 0,
    };
}

/**
 * Clones and normalizes an activation payload without changing the payload or
 * any entry object inside it.
 *
 * @param {unknown[]} entries
 * @param {{transformContent?: (content: string, entry: Record<string, any>, index: number) => unknown}} [options]
 * @returns {Record<string, any>[]}
 */
export function cloneAndNormalizeEntries(entries, options = {}) {
    if (!Array.isArray(entries)) return [];

    return entries.map((entry, index) => {
        const cloned = cloneValue(entry);
        const content = String(cloned?.content ?? '');
        const finalPromptContent = typeof options.transformContent === 'function'
            ? options.transformContent(content, cloned, index)
            : cloned?.finalPromptContent ?? content;
        return cloneAndNormalizeEntry(cloned, { finalPromptContent });
    });
}

/**
 * Returns alphabetized lorebook groups and alphabetized entries while
 * preserving both the source array and the order of its entries.
 *
 * @param {Record<string, any>[]} entries
 * @returns {{world: string, entries: Record<string, any>[]}[]}
 */
export function groupEntriesByLorebook(entries) {
    const groups = new Map();
    for (const entry of Array.isArray(entries) ? entries : []) {
        const world = String(entry.world ?? 'Unknown lorebook');
        if (!groups.has(world)) groups.set(world, []);
        groups.get(world).push(entry);
    }

    return stableSort([...groups.entries()], ([leftWorld], [rightWorld]) => (
        LOREBOOK_COLLATOR.compare(leftWorld, rightWorld)
    )).map(([world, groupEntries]) => ({
        world,
        entries: stableSort(groupEntries, (left, right) => (
            LOREBOOK_COLLATOR.compare(getEntryDisplayName(left), getEntryDisplayName(right))
        )),
    }));
}

function normalizePromptCollection(promptCollection) {
    if (Array.isArray(promptCollection)) return promptCollection;
    if (Array.isArray(promptCollection?.collection)) return promptCollection.collection;
    return [];
}

/**
 * Builds live Prompt Manager marker ranks. Missing markers receive stable
 * ranks after all live markers, in their canonical fallback order.
 *
 * @param {unknown[]|{collection?: unknown[]}} promptCollection
 * @returns {Map<string, number>}
 */
export function getPromptMarkerRanks(promptCollection) {
    const collection = normalizePromptCollection(promptCollection);
    const ranks = new Map();

    collection.forEach((prompt, index) => {
        const identifier = prompt?.identifier;
        if (TARGET_MARKERS.includes(identifier) && !ranks.has(identifier)) {
            ranks.set(identifier, index);
        }
    });

    let fallbackRank = collection.length;
    for (const identifier of TARGET_MARKERS) {
        if (!ranks.has(identifier)) ranks.set(identifier, fallbackRank++);
    }

    return ranks;
}

function getAuthorsNoteLocation(position, markerRanks) {
    if (position === EXTENSION_PROMPT_POSITION.BEFORE_PROMPT) {
        return { markerRank: markerRanks.get('main') ?? Number.MAX_SAFE_INTEGER, markerLane: -1, inChat: false };
    }
    if (position === EXTENSION_PROMPT_POSITION.IN_PROMPT) {
        return { markerRank: markerRanks.get('main') ?? Number.MAX_SAFE_INTEGER, markerLane: 1, inChat: false };
    }
    if (position === EXTENSION_PROMPT_POSITION.IN_CHAT) {
        return { markerRank: markerRanks.get('chatHistory') ?? Number.MAX_SAFE_INTEGER, markerLane: 0, inChat: true };
    }
    return { markerRank: Number.MAX_SAFE_INTEGER, markerLane: 0, inChat: false };
}

/**
 * Produces the structural fallback tuple used by prompt-order mode:
 * [markerRank, markerLane, depthRank, roleRank, contentLane, order, position].
 *
 * Core builds most WI buckets by sorting descending and unshifting, so their
 * effective order is ascending. EM Top is unshifted a second time into the
 * examples array and therefore remains descending. In-chat messages appear
 * deepest first and, at equal depth, assistant/user/system after the final
 * core reverse. Author's Note content precedes custom-depth WI at equal
 * depth/role because extension-prompt keys are joined alphabetically.
 *
 * @param {Record<string, any>} entry
 * @param {{promptCollection?: unknown[]|{collection?: unknown[]}, markerRanks?: Map<string, number>, authorsNotePosition?: number, authorsNoteDepth?: number, authorsNoteRole?: number, defaultDepth?: number}} [options]
 * @returns {[number, number, number, number, number, number, number]}
 */
export function getStructuralPromptTuple(entry, options = {}) {
    const position = asFiniteNumber(entry.position, Number.MAX_SAFE_INTEGER);
    const markerRanks = options.markerRanks instanceof Map
        ? options.markerRanks
        : getPromptMarkerRanks(options.promptCollection);
    const defaultDepth = asFiniteNumber(options.defaultDepth, DEFAULT_DEPTH);
    const authorsNotePosition = asFiniteNumber(options.authorsNotePosition, EXTENSION_PROMPT_POSITION.IN_CHAT);
    const authorsNoteDepth = asFiniteNumber(options.authorsNoteDepth, defaultDepth);
    const authorsNoteRole = asFiniteNumber(options.authorsNoteRole, EXTENSION_PROMPT_ROLE.SYSTEM);

    let markerRank = Number.MAX_SAFE_INTEGER;
    let markerLane = 0;
    let depthRank = 0;
    let roleRank = 0;
    let contentLane = 0;
    let orderRank = asFiniteNumber(entry.order, Number.MAX_SAFE_INTEGER);

    if (position === WI_POSITION.BEFORE) {
        markerRank = markerRanks.get('worldInfoBefore') ?? markerRank;
    } else if (position === WI_POSITION.AFTER) {
        markerRank = markerRanks.get('worldInfoAfter') ?? markerRank;
    } else if (position === WI_POSITION.EM_TOP) {
        markerRank = markerRanks.get('dialogueExamples') ?? markerRank;
        markerLane = -1;
        orderRank = -asFiniteNumber(entry.order, 0);
    } else if (position === WI_POSITION.EM_BOTTOM) {
        markerRank = markerRanks.get('dialogueExamples') ?? markerRank;
        markerLane = 1;
    } else if (position === WI_POSITION.AT_DEPTH) {
        markerRank = markerRanks.get('chatHistory') ?? markerRank;
        depthRank = -asFiniteNumber(entry.depth, defaultDepth);
        const role = asFiniteNumber(entry.role, EXTENSION_PROMPT_ROLE.SYSTEM);
        roleRank = role === 0 ? 0 : -role;
        contentLane = 2;
    } else if (position === WI_POSITION.AN_TOP || position === WI_POSITION.AN_BOTTOM) {
        const location = getAuthorsNoteLocation(authorsNotePosition, markerRanks);
        markerRank = location.markerRank;
        markerLane = location.markerLane;
        if (location.inChat) {
            depthRank = -authorsNoteDepth;
            roleRank = authorsNoteRole === 0 ? 0 : -authorsNoteRole;
        }
        contentLane = position === WI_POSITION.AN_TOP ? 0 : 1;
    }

    return [
        markerRank,
        markerLane,
        depthRank,
        roleRank,
        contentLane,
        orderRank,
        position,
    ];
}

function searchableMessageContent(message) {
    const content = message?.content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';

    return content.map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        if (typeof part?.content === 'string') return part.content;
        return '';
    }).join('\n');
}

function findOccurrences(needle, finalChat) {
    const occurrences = [];
    for (let messageIndex = 0; messageIndex < finalChat.length; messageIndex++) {
        const haystack = searchableMessageContent(finalChat[messageIndex]);
        let offset = haystack.indexOf(needle);
        while (offset !== -1) {
            occurrences.push({ messageIndex, offset });
            offset = haystack.indexOf(needle, offset + Math.max(1, needle.length));
        }
    }
    return occurrences;
}

/**
 * Finds unambiguous entry occurrences in CHAT_COMPLETION_PROMPT_READY's final
 * chat payload. Exact ranks are complete only when every post-regex entry has
 * non-empty, unique content, occurs exactly once, and no two entries resolve
 * to the same message/offset. Callers must use structural ordering for the
 * whole list when complete is false rather than mixing rank systems.
 *
 * @param {Record<string, any>[]} entries
 * @param {unknown[]} finalChat
 * @returns {{complete: boolean, ranks: ({messageIndex: number, offset: number}|null)[]}}
 */
export function getExactPromptOccurrenceRanks(entries, finalChat) {
    const safeEntries = Array.isArray(entries) ? entries : [];
    const safeChat = Array.isArray(finalChat) ? finalChat : [];
    const contents = safeEntries.map((entry) => String(entry.finalPromptContent ?? ''));
    const contentCounts = new Map();

    for (const content of contents) {
        contentCounts.set(content, (contentCounts.get(content) ?? 0) + 1);
    }

    const ranks = contents.map((content) => {
        if (!content || contentCounts.get(content) !== 1) return null;
        const occurrences = findOccurrences(content, safeChat);
        return occurrences.length === 1 ? occurrences[0] : null;
    });
    const uniqueRanks = new Set(ranks.filter(Boolean).map((rank) => `${rank.messageIndex}:${rank.offset}`));
    const complete = ranks.every(Boolean) && uniqueRanks.size === ranks.length;

    return { complete, ranks };
}

/**
 * Orders entries relative to one another as they appear in the final prompt.
 * When every exact final-chat occurrence is available, those ranks are the
 * sole ordering source. Otherwise every entry uses the structural tuple, which
 * keeps the comparator transitive and deterministic. Equal-order ties mirror
 * core's unshift reversal, except EM Top where the second unshift restores
 * activation order. Prompt mode deliberately has no alphabetical tie-break.
 *
 * @param {Record<string, any>[]} entries
 * @param {{finalChat?: unknown[], exactOccurrenceRanks?: {complete: boolean, ranks: ({messageIndex: number, offset: number}|null)[]}, promptCollection?: unknown[]|{collection?: unknown[]}, authorsNotePosition?: number, authorsNoteDepth?: number, authorsNoteRole?: number, defaultDepth?: number}} [options]
 * @returns {Record<string, any>[]}
 */
export function sortEntriesByPromptOrder(entries, options = {}) {
    const safeEntries = Array.isArray(entries) ? entries : [];
    const exact = options.exactOccurrenceRanks
        ?? getExactPromptOccurrenceRanks(safeEntries, options.finalChat ?? []);

    if (exact.complete && exact.ranks.length === safeEntries.length) {
        return safeEntries
            .map((entry, index) => ({ entry, index, rank: exact.ranks[index] }))
            .sort((left, right) => {
                if (!left.rank || !right.rank) return left.index - right.index;
                return compareTuples(
                    [left.rank.messageIndex, left.rank.offset],
                    [right.rank.messageIndex, right.rank.offset],
                ) || left.index - right.index;
            })
            .map(({ entry }) => entry);
    }

    const markerRanks = getPromptMarkerRanks(options.promptCollection);
    return safeEntries
        .map((entry, index) => ({
            entry,
            index,
            tuple: getStructuralPromptTuple(entry, { ...options, markerRanks }),
        }))
        .sort((left, right) => {
            const structural = compareTuples(left.tuple, right.tuple);
            if (structural !== 0) return structural;
            const isEmTop = Number(left.entry.position) === WI_POSITION.EM_TOP;
            return isEmTop ? left.index - right.index : right.index - left.index;
        })
        .map(({ entry }) => entry);
}
