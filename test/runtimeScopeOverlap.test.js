import test from 'node:test';
import assert from 'node:assert/strict';

import { createGenerationScopeTracker } from '../lib/runtimeScope.js';

test('overlapping real and ignored non-dry assemblies are treated as ambiguous', () => {
    const tracker = createGenerationScopeTracker();
    tracker.beginScope({ captureId: 61, generationType: 'normal' });
    tracker.beginScope({ generationType: 'quiet', ignored: true });
    const chat = [{ role: 'system', content: 'cannot be safely attributed' }];

    assert.equal(tracker.getCaptureScope(), null);
    assert.equal(tracker.attachPrompt(chat, false), null);
    assert.equal(tracker.resolveAfterData({ prompt: chat }), null);
});
