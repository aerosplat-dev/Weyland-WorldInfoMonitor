import test from 'node:test';
import assert from 'node:assert/strict';
import { MOBILE_MEDIA_QUERY, clampPosition, isMobileLayout } from '../lib/ui/dragResize.js';

test('clampPosition leaves a recoverable desktop position unchanged', () => {
    assert.deepEqual(
        clampPosition(120, 80, 760, 580, 1440, 900),
        { left: 120, top: 80 },
    );
});

test('clampPosition retains a grabbable horizontal strip at both viewport edges', () => {
    assert.equal(clampPosition(-900, 80, 760, 580, 1440, 900).left, -640);
    assert.equal(clampPosition(2000, 80, 760, 580, 1440, 900).left, 1320);
});

test('clampPosition keeps the titlebar vertically recoverable', () => {
    assert.equal(clampPosition(120, -300, 760, 580, 1440, 900).top, 0);
    assert.equal(clampPosition(120, 3000, 760, 580, 1440, 900).top, 820);
});

test('clampPosition handles a window narrower than the normal visible strip', () => {
    assert.deepEqual(
        clampPosition(-500, 20, 80, 200, 320, 480),
        { left: 0, top: 20 },
    );
});

test('isMobileLayout uses the shared width/coarse-pointer media query', () => {
    let receivedQuery = '';
    const result = isMobileLayout((query) => {
        receivedQuery = query;
        return { matches: true };
    });
    assert.equal(receivedQuery, MOBILE_MEDIA_QUERY);
    assert.equal(result, true);
    assert.equal(isMobileLayout(() => ({ matches: false })), false);
});
