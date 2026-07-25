import test from 'node:test';
import assert from 'node:assert/strict';

import { getEntryActivationPresentation } from '../lib/ui/monitorWindow.js';

test('activation presentation mirrors SillyTavern World Info notation', () => {
    assert.deepEqual(
        getEntryActivationPresentation({ constant: true }),
        { type: 'constant', label: 'Constant', icon: '🔵' },
    );
    assert.deepEqual(
        getEntryActivationPresentation({}),
        { type: 'keyword', label: 'Keyword', icon: '🟢' },
    );
    assert.deepEqual(
        getEntryActivationPresentation({ vectorized: true }),
        { type: 'vectorized', label: 'Vectorized', icon: '🔗' },
    );
});

test('activation presentation accepts legacy strategy labels', () => {
    assert.equal(getEntryActivationPresentation({ strategy: 'Constant' }).type, 'constant');
    assert.equal(getEntryActivationPresentation({ activationLabel: 'Vectorized' }).type, 'vectorized');
    assert.equal(getEntryActivationPresentation({ strategyLabel: 'Normal' }).type, 'keyword');
});
