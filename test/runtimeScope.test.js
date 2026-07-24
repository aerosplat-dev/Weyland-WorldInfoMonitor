import test from 'node:test';
import assert from 'node:assert/strict';

import { createGenerationScopeTracker } from '../lib/runtimeScope.js';

test('OpenAI prompt arrays resolve their own scopes by object identity', () => {
    const tracker = createGenerationScopeTracker();
    const roleplay = tracker.beginScope({
        captureId: 11,
        generationType: 'normal',
    });
    const roleplayChat = [{ role: 'system', content: 'roleplay' }];
    assert.equal(tracker.attachPrompt(roleplayChat, false), roleplay);

    const quiet = tracker.beginScope({
        generationType: 'quiet',
        ignored: true,
    });
    const quietChat = [{ role: 'system', content: 'quiet' }];
    assert.equal(tracker.attachPrompt(quietChat, false), quiet);

    const resolvedRoleplay = tracker.resolveAfterData({ prompt: roleplayChat });
    assert.equal(resolvedRoleplay.scope, roleplay);
    assert.equal(resolvedRoleplay.matchedByIdentity, true);

    const resolvedQuiet = tracker.resolveAfterData({ prompt: quietChat });
    assert.equal(resolvedQuiet.scope, quiet);
    assert.equal(resolvedQuiet.matchedByIdentity, true);
});

test('capture events are gated by the current non-ignored assembly scope', () => {
    const tracker = createGenerationScopeTracker();
    const roleplay = tracker.beginScope({ captureId: 21, generationType: 'normal' });
    assert.equal(tracker.getCaptureScope(), roleplay);

    const dry = tracker.beginScope({
        generationType: 'normal',
        dryRun: true,
        ignored: true,
    });
    assert.equal(tracker.getCaptureScope(), null);

    tracker.resolveAfterData({ prompt: 'dry text prompt' });
    tracker.markFinished(dry);
    assert.equal(tracker.getCaptureScope(), roleplay);
});

test('non-OpenAI after-data safely falls back to the current assembly scope', () => {
    const tracker = createGenerationScopeTracker();
    const roleplay = tracker.beginScope({ captureId: 31, generationType: 'swipe' });

    const resolved = tracker.resolveAfterData({ prompt: 'serialized text prompt' });
    assert.equal(resolved.scope, roleplay);
    assert.equal(resolved.matchedByIdentity, false);
});

test('paired finish events are deduplicated until deferred removal', () => {
    const removals = [];
    const tracker = createGenerationScopeTracker({
        scheduleRemoval(callback) {
            removals.push(callback);
        },
    });
    const parent = tracker.beginScope({ captureId: 41, generationType: 'normal' });
    const child = tracker.beginScope({ generationType: 'quiet', ignored: true });

    const first = tracker.finishCurrentScope();
    const second = tracker.finishCurrentScope();
    assert.equal(first.scope, child);
    assert.equal(first.duplicate, false);
    assert.equal(second.scope, child);
    assert.equal(second.duplicate, true);
    assert.equal(tracker.getCurrentScope(), child);

    removals.shift()();
    assert.equal(tracker.getCurrentScope(), parent);
});

test('reset invalidates prompt identity mappings and all live scopes', () => {
    const tracker = createGenerationScopeTracker();
    const scope = tracker.beginScope({ captureId: 51, generationType: 'normal' });
    const chat = [];
    tracker.attachPrompt(chat, false);
    tracker.reset();

    assert.equal(tracker.getCurrentScope(), null);
    assert.equal(tracker.resolveAfterData({ prompt: chat }), null);
    assert.equal(scope.removed, true);
});
