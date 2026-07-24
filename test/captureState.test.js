import test from 'node:test';
import assert from 'node:assert/strict';

import {
    REFRESH_STATES,
    createCaptureState,
    shouldCaptureGeneration,
} from '../lib/captureState.js';

function activated(uid) {
    return [{
        uid,
        world: 'Lore',
        comment: `Entry ${uid}`,
        key: [`key-${uid}`],
        content: `content-${uid}`,
        position: 0,
        nested: { uid },
    }];
}

test('dry run, quiet, and impersonate generations are ignored', () => {
    assert.equal(shouldCaptureGeneration('normal'), true);
    assert.equal(shouldCaptureGeneration('normal', true), false);
    assert.equal(shouldCaptureGeneration('quiet'), false);
    assert.equal(shouldCaptureGeneration('IMPERSONATE'), false);
});

test('new scanning capture keeps the preceding list visible', () => {
    const capture = createCaptureState();
    const firstId = capture.startGeneration('normal');
    const pending = capture.beginActivation(activated('old'));
    assert.equal(capture.commitActivation(firstId, pending.entries), true);
    capture.finalizeAfterData();

    const secondId = capture.startGeneration('swipe');
    assert.ok(secondId > firstId);
    assert.equal(capture.getState().refreshState, REFRESH_STATES.SCANNING);
    assert.deepEqual(capture.getState().entries.map((item) => item.uid), ['old']);
});

test('ignored starts preserve visible data and reject their activation', () => {
    const capture = createCaptureState();
    const id = capture.startGeneration('normal');
    const pending = capture.beginActivation(activated('kept'));
    capture.commitActivation(id, pending.entries);
    capture.finalizeAfterData();

    assert.equal(capture.startGeneration('quiet'), null);
    assert.deepEqual(capture.getState().entries.map((item) => item.uid), ['kept']);
    assert.equal(capture.getState().refreshState, REFRESH_STATES.CAPTURED);
    assert.equal(capture.beginActivation(activated('wrong')), null);
});

test('only after-data finalizes an empty capture', () => {
    const afterDataCapture = createCaptureState();
    afterDataCapture.startGeneration('normal');
    assert.equal(afterDataCapture.finalizeAfterData(), true);
    assert.deepEqual(afterDataCapture.getState().entries, []);
    assert.equal(afterDataCapture.getState().refreshState, REFRESH_STATES.CAPTURED);

    const stoppedCapture = createCaptureState();
    stoppedCapture.startGeneration('normal');
    assert.equal(stoppedCapture.stopGeneration(), true);
    assert.deepEqual(stoppedCapture.getState().entries, []);
    assert.equal(stoppedCapture.getState().refreshState, REFRESH_STATES.NONE);
});

test('stopped capture restores the pre-scan entries and status', () => {
    const capture = createCaptureState();
    const priorId = capture.startGeneration('normal');
    const prior = capture.beginActivation(activated('prior'));
    capture.commitActivation(priorId, prior.entries);
    capture.finalizeAfterData();

    const nextId = capture.startGeneration('swipe');
    const next = capture.beginActivation(activated('staged'));
    capture.commitActivation(nextId, next.entries);
    assert.deepEqual(capture.getState().entries.map((item) => item.uid), ['staged']);
    assert.equal(capture.getState().refreshState, REFRESH_STATES.SCANNING);

    assert.equal(capture.stopGeneration(), true);
    assert.deepEqual(capture.getState().entries.map((item) => item.uid), ['prior']);
    assert.equal(capture.getState().refreshState, REFRESH_STATES.CAPTURED);
});

test('committed enrichment remains scanning until after-data', () => {
    const capture = createCaptureState();
    const id = capture.startGeneration('normal');
    const pending = capture.beginActivation(activated('staged'));
    capture.commitActivation(id, pending.entries);
    assert.equal(capture.getState().refreshState, REFRESH_STATES.SCANNING);

    assert.equal(capture.finalizeAfterData(), true);
    assert.equal(capture.getState().refreshState, REFRESH_STATES.CAPTURED);
    assert.deepEqual(capture.getState().entries.map((item) => item.uid), ['staged']);
});

test('activation payload is cloned before enrichment and again on commit', () => {
    const capture = createCaptureState();
    const id = capture.startGeneration('normal');
    const source = activated('clone');
    const pending = capture.beginActivation(source);
    source[0].comment = 'mutated source';
    source[0].nested.uid = 'mutated';
    assert.equal(pending.entries[0].comment, 'Entry clone');
    assert.equal(pending.entries[0].nested.uid, 'clone');

    capture.commitActivation(id, pending.entries);
    pending.entries[0].comment = 'mutated pending';
    assert.equal(capture.getState().entries[0].comment, 'Entry clone');
});

test('after-data waits for observed async activation', async () => {
    const capture = createCaptureState();
    capture.startGeneration('normal');
    let resolveEnrichment;
    const gate = new Promise((resolve) => {
        resolveEnrichment = resolve;
    });
    const capturePromise = capture.captureActivation(activated('pending'), async (entries) => {
        await gate;
        return entries;
    });
    assert.equal(capture.finalizeAfterData(), true);
    assert.equal(capture.getState().refreshState, REFRESH_STATES.SCANNING);
    resolveEnrichment();
    assert.equal(await capturePromise, true);
    assert.deepEqual(capture.getState().entries.map((item) => item.uid), ['pending']);
});

test('a dry start is a literal no-op while live enrichment is pending', async () => {
    const capture = createCaptureState();
    const liveId = capture.startGeneration('normal');
    let resolveEnrichment;
    const gate = new Promise((resolve) => {
        resolveEnrichment = resolve;
    });
    const capturePromise = capture.captureActivation(activated('live'), async (entries) => {
        await gate;
        return entries;
    });

    assert.equal(capture.startGeneration('normal', {}, true), null);
    assert.equal(capture.getState().activeCaptureId, liveId);
    assert.equal(capture.getState().captureId, liveId);
    resolveEnrichment();
    assert.equal(await capturePromise, true);
    assert.equal(capture.getState().refreshState, REFRESH_STATES.SCANNING);

    capture.finalizeAfterData();
    assert.equal(capture.getState().refreshState, REFRESH_STATES.CAPTURED);
    assert.deepEqual(capture.getState().entries.map((item) => item.uid), ['live']);
});

test('stopping while enrichment is pending restores prior data and rejects the late commit', async () => {
    const capture = createCaptureState();
    const priorId = capture.startGeneration('normal');
    const prior = capture.beginActivation(activated('prior'));
    capture.commitActivation(priorId, prior.entries);
    capture.finalizeAfterData();

    capture.startGeneration('swipe');
    let resolveEnrichment;
    const gate = new Promise((resolve) => {
        resolveEnrichment = resolve;
    });
    const capturePromise = capture.captureActivation(activated('late'), async (entries) => {
        await gate;
        return entries;
    });

    assert.equal(capture.stopGeneration(), true);
    assert.deepEqual(capture.getState().entries.map((item) => item.uid), ['prior']);
    assert.equal(capture.getState().refreshState, REFRESH_STATES.CAPTURED);
    resolveEnrichment();
    assert.equal(await capturePromise, false);
    assert.deepEqual(capture.getState().entries.map((item) => item.uid), ['prior']);
});

test('slow stale async commit is rejected after a newer capture starts', async () => {
    const capture = createCaptureState();
    capture.startGeneration('normal');
    let resolveEnrichment;
    const gate = new Promise((resolve) => {
        resolveEnrichment = resolve;
    });
    const oldPromise = capture.captureActivation(activated('stale'), async (entries) => {
        await gate;
        return entries;
    });
    const newerId = capture.startGeneration('regenerate');
    resolveEnrichment();

    assert.equal(await oldPromise, false);
    assert.equal(capture.getState().activeCaptureId, newerId);
    assert.equal(capture.getState().refreshState, REFRESH_STATES.SCANNING);
    assert.deepEqual(capture.getState().entries, []);
});

test('chat changed clears and invalidates pending work', () => {
    const capture = createCaptureState();
    const id = capture.startGeneration('normal');
    const pending = capture.beginActivation(activated('wrong-chat'));
    capture.changeChat();
    assert.equal(capture.commitActivation(id, pending.entries), false);
    assert.deepEqual(capture.getState().entries, []);
    assert.equal(capture.getState().refreshState, REFRESH_STATES.NONE);
});
