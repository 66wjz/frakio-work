'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { closeActionForState, closeNoticeForPlatform, restoreWindow } = require('./window-lifecycle.cjs');

test('window close hides the app unless the app is quitting', () => {
  assert.equal(closeActionForState({ quitting: false }), 'hide');
  assert.equal(closeActionForState({ quitting: true }), 'close');
});

test('close notice describes the platform quit shortcut', () => {
  assert.match(closeNoticeForPlatform('darwin').detail, /Cmd\+Q/);
  assert.match(closeNoticeForPlatform('win32').detail, /菜单中的退出/);
});

test('restoreWindow shows and focuses an existing hidden window', () => {
  const calls = [];
  const win = {
    isDestroyed: () => false,
    isMinimized: () => true,
    isVisible: () => false,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
  };
  assert.equal(restoreWindow(win), true);
  assert.deepEqual(calls, ['restore', 'show', 'focus']);
  assert.equal(restoreWindow({ isDestroyed: () => true }), false);
});
