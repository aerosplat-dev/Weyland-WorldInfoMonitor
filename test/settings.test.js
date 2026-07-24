import test from 'node:test';
import assert from 'node:assert/strict';

import {
    SETTINGS_KEY,
    SORT_MODES,
    getSettings,
    normalizeSettings,
    setSortMode,
} from '../lib/settings.js';

test('legacy settings migrate without mutating their source', () => {
    const legacy = { group: false, order: true, mes: true };
    const snapshot = structuredClone(legacy);
    assert.deepEqual(normalizeSettings(legacy), { sortMode: SORT_MODES.PROMPT_ORDER });
    assert.deepEqual(legacy, snapshot);

    for (const other of [
        { group: true, order: true, mes: true },
        { group: false, order: false, mes: true },
        { order: true },
        null,
    ]) {
        assert.deepEqual(normalizeSettings(other), { sortMode: SORT_MODES.LOREBOOKS });
    }
});

test('explicit sort mode is normalized and wins over legacy fields', () => {
    assert.deepEqual(
        normalizeSettings({ sortMode: 'prompt-order', group: true }),
        { sortMode: SORT_MODES.PROMPT_ORDER },
    );
    assert.deepEqual(
        normalizeSettings({ sortMode: 'obsolete', group: false, order: true }),
        { sortMode: SORT_MODES.LOREBOOKS },
    );
});

test('scoped settings are compact and save-ready', () => {
    const extensionSettings = {
        [SETTINGS_KEY]: { group: false, order: true, mes: true, obsolete: true },
    };
    const settings = getSettings(extensionSettings);
    assert.deepEqual(settings, { sortMode: SORT_MODES.PROMPT_ORDER });
    assert.strictEqual(settings, extensionSettings[SETTINGS_KEY]);

    const changed = setSortMode(extensionSettings, 'lorebooks');
    assert.strictEqual(changed, extensionSettings[SETTINGS_KEY]);
    assert.deepEqual(extensionSettings[SETTINGS_KEY], { sortMode: SORT_MODES.LOREBOOKS });
});

test('missing settings are initialized and invalid containers rejected', () => {
    const extensionSettings = {};
    assert.deepEqual(getSettings(extensionSettings), { sortMode: SORT_MODES.LOREBOOKS });
    assert.throws(() => getSettings(null), /must be an object/);
});
