import assert from 'node:assert/strict';
import test from 'node:test';
import { availablePaneMax, createLatestFrameScheduler, normalizePaneWidth, paneWidthFromKey, paneWidthFromPointer } from '../web/src/pane-resize.mjs';

test('persisted pane widths are rounded and clamped', () => {
  assert.equal(normalizePaneWidth(284.7917, 240, 420), 285);
  assert.equal(normalizePaneWidth(9999, 240, 420), 420);
  assert.equal(normalizePaneWidth('invalid', 280, 520), 280);
  assert.equal(normalizePaneWidth(224, 220, 420), 224);
});

test('pointer movement expands each pane toward its outside edge', () => {
  assert.equal(paneWidthFromPointer({ side: 'left', startWidth: 240, startX: 260, currentX: 300, minWidth: 240, maxWidth: 420 }), 280);
  assert.equal(paneWidthFromPointer({ side: 'right', startWidth: 344, startX: 900, currentX: 860, minWidth: 280, maxWidth: 520 }), 384);
});

test('pointer widths stay inside fixed and available bounds', () => {
  assert.equal(paneWidthFromPointer({ side: 'left', startWidth: 240, startX: 260, currentX: 100, minWidth: 240, maxWidth: 360 }), 240);
  assert.equal(paneWidthFromPointer({ side: 'left', startWidth: 224, startX: 260, currentX: 200, minWidth: 220, maxWidth: 420 }), 220);
  assert.equal(paneWidthFromPointer({ side: 'right', startWidth: 344, startX: 900, currentX: 600, minWidth: 280, maxWidth: 410 }), 410);
  assert.equal(paneWidthFromPointer({ side: 'left', startWidth: 240, startX: 260.25, currentX: 300.8, minWidth: 240, maxWidth: 420 }), 281);
});

test('available pane width preserves the central card', () => {
  assert.equal(availablePaneMax({ side: 'left', viewportWidth: 1280, sidebarWidth: 240, contextWidth: 344, leftVisible: true, rightVisible: true, minWidth: 240, maxWidth: 420 }), 344);
  assert.equal(availablePaneMax({ side: 'right', viewportWidth: 1440, sidebarWidth: 240, contextWidth: 344, leftVisible: true, rightVisible: true, chromeWidth: 24, minWidth: 320, maxWidth: Number.MAX_SAFE_INTEGER }), 656);
  assert.equal(availablePaneMax({ side: 'right', viewportWidth: 1440, sidebarWidth: 240, contextWidth: 344, leftVisible: false, rightVisible: true, chromeWidth: 24, minWidth: 320, maxWidth: Number.MAX_SAFE_INTEGER }), 896);
  assert.equal(availablePaneMax({ side: 'right', viewportWidth: 2400, sidebarWidth: 240, contextWidth: 344, leftVisible: true, rightVisible: true, chromeWidth: 24, minWidth: 320, maxWidth: Number.MAX_SAFE_INTEGER }), 1616);
});

test('keyboard arrows follow the visual edge direction', () => {
  assert.equal(paneWidthFromKey({ side: 'left', currentWidth: 280, key: 'ArrowRight', shiftKey: false, minWidth: 240, maxWidth: 420 }), 296);
  assert.equal(paneWidthFromKey({ side: 'right', currentWidth: 344, key: 'ArrowLeft', shiftKey: true, minWidth: 320, maxWidth: 720 }), 408);
  assert.equal(paneWidthFromKey({ side: 'right', currentWidth: 320, key: 'ArrowRight', shiftKey: false, minWidth: 320, maxWidth: 720 }), 320);
  assert.equal(paneWidthFromKey({ side: 'left', currentWidth: 224, key: 'ArrowLeft', shiftKey: false, minWidth: 220, maxWidth: 420 }), 220);
  assert.equal(paneWidthFromKey({ side: 'left', currentWidth: 224, key: 'ArrowRight', shiftKey: false, minWidth: 220, maxWidth: 420 }), 240);
  assert.equal(paneWidthFromKey({ side: 'right', currentWidth: 512, key: 'Home', shiftKey: false, minWidth: 320, maxWidth: 720 }), 320);
  assert.equal(paneWidthFromKey({ side: 'right', currentWidth: 512, key: 'End', shiftKey: false, minWidth: 320, maxWidth: 720 }), 720);
});

test('drag scheduling applies only the latest pointer position in a frame', () => {
  const frames = new Map();
  const applied = [];
  let nextFrame = 1;
  const scheduler = createLatestFrameScheduler({
    requestFrame: (callback) => { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelFrame: (id) => frames.delete(id),
    apply: (value) => applied.push(value),
  });

  scheduler.schedule(900);
  scheduler.schedule(860);
  scheduler.schedule(820);
  assert.equal(frames.size, 1);
  frames.values().next().value();
  assert.deepEqual(applied, [820]);
});

test('drag scheduling flushes the final pointer position before commit', () => {
  const frames = new Map();
  const applied = [];
  const scheduler = createLatestFrameScheduler({
    requestFrame: (callback) => { frames.set(1, callback); return 1; },
    cancelFrame: (id) => frames.delete(id),
    apply: (value) => applied.push(value),
  });

  scheduler.schedule(744);
  scheduler.flush();
  assert.deepEqual(applied, [744]);
  assert.equal(frames.size, 0);
});
