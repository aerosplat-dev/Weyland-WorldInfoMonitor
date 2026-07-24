export const SETTINGS_KEY = 'worldInfoInfo';

export const SORT_MODES = Object.freeze({
    LOREBOOKS: 'lorebooks',
    PROMPT_ORDER: 'prompt-order',
});

export const DEFAULT_SETTINGS = Object.freeze({
    sortMode: SORT_MODES.LOREBOOKS,
});

/**
 * Returns the persisted representation of a sort mode. The old UI sometimes
 * referred to prompt order as simply "prompt"; accepting that spelling keeps
 * callers and pre-release settings forward-compatible.
 *
 * @param {unknown} value
 * @returns {'lorebooks'|'prompt-order'}
 */
export function normalizeSortMode(value) {
    return value === SORT_MODES.PROMPT_ORDER || value === 'prompt'
        ? SORT_MODES.PROMPT_ORDER
        : SORT_MODES.LOREBOOKS;
}

/**
 * Converts old group/order/mes settings to the two-mode monitor setting
 * without modifying the object supplied by SillyTavern.
 *
 * The legacy prompt-like layout existed only when grouping was disabled and
 * insertion ordering was enabled. All other legacy combinations map to the
 * predictable lorebook browser. `mes` controlled synthetic chat rows which
 * the redesigned monitor intentionally does not reproduce.
 *
 * @param {unknown} value
 * @returns {{sortMode: 'lorebooks'|'prompt-order'}}
 */
export function normalizeSettings(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};

    if (Object.hasOwn(source, 'sortMode')) {
        return { sortMode: normalizeSortMode(source.sortMode) };
    }

    const usesLegacyPromptOrder = source.group === false && source.order !== false;
    return {
        sortMode: usesLegacyPromptOrder
            ? SORT_MODES.PROMPT_ORDER
            : SORT_MODES.LOREBOOKS,
    };
}

/**
 * Initializes/backfills the extension's scoped settings object. This is the
 * one intentional mutation in the settings module: SillyTavern's settings
 * container receives a compact, save-ready value with legacy keys removed.
 *
 * @param {Record<string, any>} extensionSettings
 * @returns {{sortMode: 'lorebooks'|'prompt-order'}}
 */
export function getSettings(extensionSettings) {
    if (!extensionSettings || typeof extensionSettings !== 'object') {
        throw new TypeError('extensionSettings must be an object');
    }

    const settings = normalizeSettings(extensionSettings[SETTINGS_KEY]);
    extensionSettings[SETTINGS_KEY] = settings;
    return settings;
}

/**
 * Persists a normalized sort mode in the scoped settings object.
 *
 * @param {Record<string, any>} extensionSettings
 * @param {unknown} sortMode
 * @returns {{sortMode: 'lorebooks'|'prompt-order'}}
 */
export function setSortMode(extensionSettings, sortMode) {
    const settings = getSettings(extensionSettings);
    settings.sortMode = normalizeSortMode(sortMode);
    return settings;
}
