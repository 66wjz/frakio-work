'use strict';

function closeActionForState({ quitting = false } = {}) {
  return quitting ? 'close' : 'hide';
}

function closeNoticeForPlatform(platform = process.platform) {
  const quitShortcut = platform === 'darwin' ? 'Cmd+Q' : '菜单中的退出';
  return {
    type: 'info',
    buttons: ['知道了'],
    defaultId: 0,
    title: 'Frakio Work 仍在后台运行',
    message: '关闭窗口后，Frakio Work 会继续在后台运行。',
    detail: `下次打开应用会直接恢复当前窗口。需要完全退出时，请使用 ${quitShortcut} 或菜单里的“退出”。`,
    checkboxLabel: '不再提示',
    checkboxChecked: false,
  };
}

function restoreWindow(target) {
  if (!target || target.isDestroyed?.()) return false;
  if (target.isMinimized?.()) target.restore();
  if (!target.isVisible?.()) target.show();
  target.focus?.();
  return true;
}

module.exports = {
  closeActionForState,
  closeNoticeForPlatform,
  restoreWindow,
};
