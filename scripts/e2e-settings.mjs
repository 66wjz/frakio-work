import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.FRAKIO_E2E_URL || 'http://127.0.0.1:5173';
const executablePath = process.env.FRAKIO_E2E_BROWSER || '';
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
const moaRequests = [];
const initialState = await fetch(`${baseUrl}/api/state`).then((response) => response.json());
const initialUi = initialState.ui || {};
const railFixtureSpaceId = initialUi.activeSpaceId || initialState.spaces?.[0]?.id || null;
const railFixtureTitles = {
  project: '左栏悬浮交互与完整标题滚动效果验证项目',
  nested: '项目内对话标题需要在悬停后平滑滚动到最右侧',
  direct: '普通对话标题需要在悬停后平滑滚动到最右侧并保持',
  short: '短标题',
};
const moduleFixtureProfiles = [
  { profileName: 'iris', agentId: 'iris', name: 'Iris', role: '助理', color: '#8b5cf6', inheritedGlobalCount: 1 },
  { profileName: 'max', agentId: 'max', name: 'Max', role: 'CEO / 调度裁决', color: '#d97706', inheritedGlobalCount: 1 },
  { profileName: 'nora', agentId: 'nora', name: 'Nora', role: '电商总监', color: '#0f766e', inheritedGlobalCount: 1 },
  { profileName: 'kai', agentId: 'kai', name: 'Kai', role: '营销总监', color: '#2563eb', inheritedGlobalCount: 1 },
  { profileName: 'leo', agentId: 'leo', name: 'Leo', role: '设计总监', color: '#db2777', inheritedGlobalCount: 1 },
  { profileName: 'victor', agentId: 'victor', name: 'Victor', role: '技术总监', color: '#475569', inheritedGlobalCount: 1 },
];

function moduleFixture(kind) {
  const title = kind === 'skill' ? 'Skill' : 'Plugin';
  return {
    kind,
    profiles: moduleFixtureProfiles,
    global: [{
      kind,
      scope: 'global',
      name: `shared-${kind}`,
      profileName: '',
      originProfileName: 'iris',
      originAgentId: 'iris',
      originAgentName: 'Iris',
      originColor: '#8b5cf6',
      description: `${title} shared by all configured agents with a deliberately long description for layout verification.`,
      category: 'local',
      file: kind === 'skill' ? 'SKILL.md' : 'plugin.json',
      hash: 'fixture-global-hash',
      enabled: true,
      duplicateProfileNames: [],
      archivedDuplicateProfiles: ['max', 'nora'],
    }],
    profile: moduleFixtureProfiles.map((profile) => ({
      kind,
      scope: 'profile',
      name: `${profile.profileName}-${kind}`,
      profileName: profile.profileName,
      agentId: profile.agentId,
      agentName: profile.name,
      color: profile.color,
      description: `${profile.name} exclusive ${title}.`,
      category: 'Profile',
      file: kind === 'skill' ? 'SKILL.md' : 'plugin.json',
      hash: `fixture-${profile.profileName}`,
      enabled: true,
      duplicateProfileNames: [],
      archivedDuplicateProfiles: [],
    })),
  };
}

page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('favicon')) errors.push(`${message.text()} ${message.location().url}`.trim());
});
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
  if (request.url().includes('/api/hermes/config/moa')) moaRequests.push(request.url());
});
await page.route('**/api/auth/status', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ managed: false, authenticated: true }),
  });
});

async function clearBlockingNotices() {
  const closeGuide = page.getByRole('button', { name: /(稍后处理|进入工作台)/ });
  await closeGuide.waitFor({ state: 'visible', timeout: 20000 }).catch(() => null);
  if (await closeGuide.count()) await closeGuide.click();
  const decline = page.getByRole('button', { name: '不发送' });
  if (await decline.count()) await decline.click();
}

async function openSettings() {
  if (await page.locator('.settings-rail-sidebar').count()) return;
  await page.getByRole('button', { name: '打开用户菜单' }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor({ state: 'visible' });
}

async function selectSettingsEntry(label, heading) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('heading', { name: heading, exact: true }).waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('button', { name: label, exact: true }).getAttribute('aria-current'), 'page');
}

async function assertNoHorizontalOverflow(scope, message) {
  const metrics = await scope.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  assert.ok(metrics.scrollWidth <= metrics.clientWidth + 1, `${message}: ${metrics.scrollWidth}px > ${metrics.clientWidth}px`);
}

async function assertBoundaryFade(scope, expectedSize, message) {
  const result = await scope.evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      maskImage: styles.maskImage,
      webkitMaskImage: styles.webkitMaskImage,
      overflowY: styles.overflowY,
      scrollbarWidth: styles.scrollbarWidth,
      paddingTop: styles.paddingTop,
      paddingBottom: styles.paddingBottom,
      maxScrollTop: Math.max(0, element.scrollHeight - element.clientHeight),
    };
  });
  assert.match(result.maskImage, /linear-gradient\(/, `${message} 缺少标准 alpha mask`);
  assert.match(result.webkitMaskImage, /linear-gradient\(/, `${message} 缺少 WebKit alpha mask`);
  assert.match(result.maskImage, /rgba?\(0,\s*0,\s*0,\s*0\)|transparent/, `${message} mask 顶部不是透明边界`);
  assert.match(result.maskImage, new RegExp(`${expectedSize}px`), `${message} 渐隐尺寸不是 ${expectedSize}px`);
  assert.equal(result.overflowY, 'auto', `${message} 不是独立纵向滚动容器`);
  assert.notEqual(result.scrollbarWidth, 'none', `${message} 滚动条不可操作`);
  assert.ok(parseFloat(result.paddingTop) >= expectedSize, `${message} 顶部留白不足`);
  assert.ok(parseFloat(result.paddingBottom) >= expectedSize, `${message} 底部留白不足`);
  return result;
}

async function exerciseScrollBoundary(scope, message) {
  const result = await scope.evaluate((element) => {
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    element.scrollTop = 0;
    const top = element.scrollTop;
    element.scrollTop = maxScrollTop / 2;
    const middle = element.scrollTop;
    element.scrollTop = maxScrollTop;
    const bottom = element.scrollTop;
    return { maxScrollTop, top, middle, bottom };
  });
  assert.ok(result.maxScrollTop > 0, `${message} 没有形成可验证的滚动范围`);
  assert.equal(result.top, 0, `${message} 无法滚动到顶部`);
  assert.ok(result.middle > 0 && result.middle < result.maxScrollTop, `${message} 无法滚动到中间`);
  assert.ok(Math.abs(result.bottom - result.maxScrollTop) <= 1, `${message} 无法滚动到底部`);
}

async function assertRailTitleScroll(title, message) {
  const row = page.locator('[data-rail-hover-row]').filter({ has: title });
  await title.waitFor({ state: 'visible' });
  await page.waitForFunction((text) => document.querySelector(`.rail-scrolling-title[title="${text}"]`)?.dataset.overflowing === 'true', await title.getAttribute('title'));
  const initial = await title.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    scrollLeft: element.scrollLeft,
  }));
  assert.ok(initial.scrollWidth > initial.clientWidth + 1, `${message} 没有形成截断`);
  assert.equal(initial.scrollLeft, 0, `${message} 初始位置不在最左侧`);

  const lineWidthBefore = await row.locator('.rail-thread-line').count()
    ? await row.locator('.rail-thread-line').evaluate((element) => element.getBoundingClientRect().width)
    : null;
  await row.hover();
  await page.waitForTimeout(240);
  assert.equal(await title.evaluate((element) => element.scrollLeft), 0, `${message} 在 400ms 停留延迟前提前滚动`);
  await page.waitForFunction((text) => document.querySelector(`.rail-scrolling-title[title="${text}"]`)?.scrollLeft > 0, await title.getAttribute('title'), { timeout: 1200 });
  const started = await title.evaluate((element) => ({
    scrollLeft: element.scrollLeft,
    overflow: element.scrollWidth - element.clientWidth,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    rowHovered: element.closest('[data-rail-hover-row]')?.matches(':hover'),
  }));
  assert.ok(started.scrollLeft > 0, `${message} 停留后没有开始滚动：${JSON.stringify(started)}`);
  await page.waitForFunction((text) => {
    const element = document.querySelector(`.rail-scrolling-title[title="${text}"]`);
    return element && Math.abs(element.scrollLeft - (element.scrollWidth - element.clientWidth)) <= 2;
  }, await title.getAttribute('title'), { timeout: 5000 });

  if (lineWidthBefore !== null) {
    const lineWidthAfter = await row.locator('.rail-thread-line').evaluate((element) => element.getBoundingClientRect().width);
    assert.ok(Math.abs(lineWidthAfter - lineWidthBefore) <= 0.5, `${message} 头像淡出或更多按钮出现时发生宽度跳动`);
    assert.equal(await row.locator('.rail-thread-participants').evaluate((element) => getComputedStyle(element).opacity), '0', `${message} 悬停时参与者头像没有淡出`);
    assert.equal(await row.locator('.rail-more-button').evaluate((element) => getComputedStyle(element).opacity), '1', `${message} 悬停时更多按钮没有出现`);
  }

  await page.locator('.rail-section-head').first().hover();
  await page.waitForFunction((text) => document.querySelector(`.rail-scrolling-title[title="${text}"]`)?.scrollLeft === 0, await title.getAttribute('title'));
  assert.equal(await title.evaluate((element) => element.scrollLeft), 0, `${message} 离开后没有回到起点`);

  await row.locator('.rail-main').focus();
  await page.waitForFunction((text) => {
    const element = document.querySelector(`.rail-scrolling-title[title="${text}"]`);
    return element && Math.abs(element.scrollLeft - (element.scrollWidth - element.clientWidth)) <= 2;
  }, await title.getAttribute('title'), { timeout: 5000 });
  await page.locator('.rail-actions .rail-action').first().focus();
  await page.waitForFunction((text) => document.querySelector(`.rail-scrolling-title[title="${text}"]`)?.scrollLeft === 0, await title.getAttribute('title'));
}

async function assertDarkSettingsPage(label) {
  const result = await page.locator('.settings-content').evaluate((root) => {
    const parseColor = (value) => {
      const parts = value.match(/[\d.]+/g)?.map(Number) || [];
      return {
        r: parts[0] || 0,
        g: parts[1] || 0,
        b: parts[2] || 0,
        a: parts.length > 3 ? parts[3] : 1,
      };
    };
    const largeLightSurfaces = [...root.querySelectorAll('*')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width * rect.height < 14000) return false;
        const color = parseColor(getComputedStyle(element).backgroundColor);
        return color.a >= 0.55 && color.r >= 225 && color.g >= 225 && color.b >= 225;
      })
      .slice(0, 8)
      .map((element) => ({
        className: element.className,
        background: getComputedStyle(element).backgroundColor,
      }));
    const title = root.querySelector('h1, h2, h3');
    const titleColor = title ? parseColor(getComputedStyle(title).color) : null;
    return {
      largeLightSurfaces,
      titleColor,
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
    };
  });

  assert.deepEqual(result.largeLightSurfaces, [], `${label} 暗色页仍有大面积浅色容器`);
  assert.ok(!result.titleColor || Math.max(result.titleColor.r, result.titleColor.g, result.titleColor.b) >= 180, `${label} 暗色页标题对比度不足`);
  assert.ok(result.scrollWidth <= result.clientWidth + 1, `${label} 暗色页横向溢出`);
}

async function waitForPersistedUi(key, value) {
  await page.waitForFunction(
    async ({ expectedKey, expectedValue }) => {
      const state = await fetch('/api/state').then((response) => response.json());
      return state.ui?.[expectedKey] === expectedValue;
    },
    { expectedKey: key, expectedValue: value },
  );
}

async function restoreUi() {
  const keys = [
    'appearance',
    'richToolDescriptions',
    'sendKey',
  ];
  const patch = Object.fromEntries(keys.filter((key) => key in initialUi).map((key) => [key, initialUi[key]]));
  if (!('appearance' in patch)) patch.appearance = 'system';
  if (!('richToolDescriptions' in patch)) patch.richToolDescriptions = true;
  if (!('sendKey' in patch)) patch.sendKey = 'enter';
  await fetch(`${baseUrl}/api/state/ui`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

try {
  await page.route('**/api/hermes-modules*', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const kind = new URL(route.request().url()).searchParams.get('kind') === 'plugin' ? 'plugin' : 'skill';
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(moduleFixture(kind)) });
  });
  await page.route('**/api/workspaces/e2e-rail-project/knowledge', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        workspace: { id: 'e2e-rail-project', name: railFixtureTitles.project, primaryVaultId: 'e2e-rail-vault', sharedVaultIds: [], writableVaultIds: [] },
        vault: { id: 'e2e-rail-vault', name: `${railFixtureTitles.project} Vault`, rootPath: '/tmp/frakio-e2e-rail-project', index: {} },
        index: { documentCount: 0, files: [] },
        commits: [],
      }),
    });
  });
  await page.route('**/api/workspaces', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    body.workspaces = [
      {
        id: 'e2e-rail-project',
        spaceId: railFixtureSpaceId,
        name: railFixtureTitles.project,
        rootPath: '/tmp/frakio-e2e-rail-project',
        vaultId: null,
        environment: 'local',
        activeThreadId: 'e2e-rail-nested',
        archivedAt: null,
        pinnedAt: null,
        updatedAt: new Date().toISOString(),
        threads: [{
          id: 'e2e-rail-nested',
          spaceId: railFixtureSpaceId,
          workspaceId: 'e2e-rail-project',
          title: railFixtureTitles.nested,
          mode: 'workspace',
          primaryAgentId: null,
          participantAgentIds: [],
          vaultId: null,
          vaultName: '',
          updatedAt: new Date().toISOString(),
          preview: '',
          runStatus: 'idle',
        }],
      },
      ...(body.workspaces || []),
    ];
    await route.fulfill({ response, body: JSON.stringify(body), headers: { ...response.headers(), 'content-type': 'application/json' } });
  });
  await page.route('**/api/conversations', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    const conversation = (id, title) => ({
      id,
      spaceId: railFixtureSpaceId,
      workspaceId: null,
      title,
      mode: 'direct',
      primaryAgentId: null,
      participantAgentIds: [],
      vaultId: null,
      vaultName: '',
      updatedAt: new Date().toISOString(),
      preview: '',
      runStatus: 'idle',
    });
    body.conversations = [
      conversation('e2e-rail-direct-long', railFixtureTitles.direct),
      conversation('e2e-rail-direct-short', railFixtureTitles.short),
      ...Array.from({ length: 18 }, (_, index) => conversation(`e2e-rail-fill-${index}`, `侧栏滚动边界测试对话 ${index + 1}`)),
      ...(body.conversations || []),
    ];
    await route.fulfill({ response, body: JSON.stringify(body), headers: { ...response.headers(), 'content-type': 'application/json' } });
  });
  await page.route('**/api/hermes-runtime/releases', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      releases: [
        {
          tag: 'v2026.7.20',
          releaseDate: '2026-07-20',
          label: 'Hermes v2026.7.20',
          url: 'https://github.com/NousResearch/hermes-agent/releases/tag/v2026.7.20',
        },
      ],
    }),
  }));
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await clearBlockingNotices();

  const mainSidebarScroll = page.locator('.sidebar-scroll');
  const appShell = page.locator('.app');
  await appShell.evaluate((element) => element.style.setProperty('--sidebar-width', '220px'));
  const projectTitle = page.locator(`.rail-project-title[title="${railFixtureTitles.project}"]`);
  const nestedTitle = page.locator(`.rail-thread-title[title="${railFixtureTitles.nested}"]`);
  const directTitle = page.locator(`.rail-thread-title[title="${railFixtureTitles.direct}"]`);
  const shortTitle = page.locator(`.rail-thread-title[title="${railFixtureTitles.short}"]`);
  await assertRailTitleScroll(projectTitle, '项目标题');
  await assertRailTitleScroll(nestedTitle, '项目内对话标题');
  await assertRailTitleScroll(directTitle, '普通对话标题');

  const shortRow = page.locator('[data-rail-hover-row]').filter({ has: shortTitle });
  await shortRow.hover();
  await page.waitForTimeout(600);
  assert.equal(await shortTitle.getAttribute('data-overflowing'), 'false', '短标题被错误标记为截断');
  assert.equal(await shortTitle.evaluate((element) => element.scrollLeft), 0, '短标题产生了滚动');

  const projectRow = page.locator('.rail-project-row').filter({ has: projectTitle });
  const projectPositionBefore = await projectRow.evaluate((element) => ({
    top: element.getBoundingClientRect().top,
    background: getComputedStyle(element, '::before').backgroundColor,
  }));
  await page.locator('.rail-subitem').filter({ has: nestedTitle }).hover();
  const projectPositionAfter = await projectRow.evaluate((element) => ({
    top: element.getBoundingClientRect().top,
    background: getComputedStyle(element, '::before').backgroundColor,
  }));
  assert.ok(Math.abs(projectPositionAfter.top - projectPositionBefore.top) <= 0.5, '悬停子对话时项目行发生位移');
  assert.equal(projectPositionAfter.background, projectPositionBefore.background, '悬停子对话时项目表面被错误激活');

  await projectRow.evaluate((element) => element.classList.add('active'));
  await page.waitForTimeout(180);
  const activeProject = await projectRow.evaluate((element) => ({
    transform: getComputedStyle(element).transform,
    background: getComputedStyle(element, '::before').backgroundColor,
  }));
  assert.notEqual(activeProject.transform, 'none', '项目选中态没有保持抬升');
  assert.notEqual(activeProject.background, 'rgba(0, 0, 0, 0)', '项目选中态没有表面背景');
  await projectRow.evaluate((element) => element.classList.remove('active'));

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const directRow = page.locator('[data-rail-hover-row]').filter({ has: directTitle });
  await directRow.hover();
  await page.waitForTimeout(650);
  assert.equal(await directTitle.evaluate((element) => element.scrollLeft), 0, '减少动态效果时长标题仍然滚动');
  assert.equal(await directRow.evaluate((element) => getComputedStyle(element).transform), 'none', '减少动态效果时条目仍然位移');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await appShell.evaluate((element) => element.style.setProperty('--sidebar-width', '420px'));
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.sidebar-scroll').evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true, '420px 左栏出现横向溢出');
  await appShell.evaluate((element) => element.style.removeProperty('--sidebar-width'));
  await assertBoundaryFade(mainSidebarScroll, 20, '主界面左栏');
  await exerciseScrollBoundary(mainSidebarScroll, '主界面左栏');
  assert.equal(await page.locator('.rail-actions').evaluate((element) => Boolean(element.closest('.sidebar-scroll'))), false, '主界面固定操作区被放进渐隐容器');
  assert.equal(await page.getByRole('button', { name: '打开用户菜单' }).evaluate((element) => Boolean(element.closest('.sidebar-scroll'))), false, '底部用户入口被放进渐隐容器');

  await openSettings();

  assert.equal(await page.getByRole('heading', { name: '工作台', exact: true }).isVisible(), true, '设置默认入口不是工作台');
  await assertBoundaryFade(page.locator('.settings-nav'), 20, '设置左栏导航');
  await assertBoundaryFade(page.locator('.settings-content'), 32, '设置中央主卡');
  await exerciseScrollBoundary(page.locator('.settings-content'), '设置中央主卡');
  assert.equal(await page.getByRole('button', { name: '返回对话', exact: true }).evaluate((element) => Boolean(element.closest('.settings-nav'))), false, '返回按钮被放进设置导航渐隐容器');
  assert.equal(await page.getByPlaceholder('搜索设置...').evaluate((element) => Boolean(element.closest('.settings-nav'))), false, '设置搜索框被放进导航渐隐容器');
  const expectedNavigation = [
    '个人资料', '工作台', '外观', '隐私', '归档对话',
    'Agent 配置', 'Memory', 'Knowledge', '仓库', '技能', '插件', '工具能力',
    'Runtime Center', '模型', 'Hermes 集成', 'MCP', '频道', '任务', '监控', '系统状态', '版本更新',
  ];
  const navigationLabels = await page.locator('.settings-nav-group button strong').allTextContents();
  assert.deepEqual(navigationLabels, expectedNavigation, '设置导航顺序不正确');

  const entryHeadings = [
    ['工作台', '工作台'],
    ['外观', '外观'],
    ['隐私', '隐私'],
    ['归档对话', '归档对话'],
    ['Agent 配置', 'Agent Profile'],
    ['Memory', 'Memory Ledger'],
    ['Knowledge', 'Knowledge'],
    ['仓库', 'Obsidian 仓库'],
    ['技能', '技能'],
    ['插件', '插件'],
    ['工具能力', '工具能力'],
    ['Runtime Center', 'Runtime Center'],
    ['模型', 'Frakio Work 模型中心'],
    ['Hermes 集成', 'Hermes 集成'],
    ['MCP', 'MCP 服务器'],
    ['频道', '频道'],
    ['任务', '定时任务'],
    ['监控', '监控'],
    ['系统状态', '系统状态'],
    ['版本更新', '版本更新'],
  ];

  let releaseProfileSummary;
  let markProfileSummaryRequested;
  const profileSummaryGate = new Promise((resolve) => {
    releaseProfileSummary = resolve;
  });
  const profileSummaryRequested = new Promise((resolve) => {
    markProfileSummaryRequested = resolve;
  });
  await page.route('**/api/user-profile/summary', async (route) => {
    markProfileSummaryRequested();
    await profileSummaryGate;
    await route.continue();
  });
  await page.getByRole('button', { name: '个人资料', exact: true }).click();
  await page.getByRole('heading', { name: '个人资料', exact: true }).waitFor({ state: 'visible' });
  await profileSummaryRequested;
  assert.equal(await page.locator('.token-activity-cell').count(), 371, '个人资料加载期间没有保留完整年度网格');
  assert.equal(await page.locator('.token-activity-grid').getAttribute('aria-busy'), 'true', '个人资料加载状态没有暴露给辅助技术');
  releaseProfileSummary();
  await page.waitForFunction(() => document.querySelector('.token-activity-grid')?.getAttribute('aria-busy') === 'false');
  await page.unroute('**/api/user-profile/summary');

  const profileAvatarSize = await page.locator('.profile-avatar-button').evaluate((element) => element.getBoundingClientRect().width);
  assert.ok(profileAvatarSize >= 87 && profileAvatarSize <= 89, `个人资料头像尺寸不是 88px：${profileAvatarSize}`);
  const profileSurfaces = await page.locator('.profile-dashboard').evaluate((root) => {
    const activity = getComputedStyle(root.querySelector('.profile-activity-panel'));
    const insight = getComputedStyle(root.querySelector('.profile-insight-panel'));
    const stats = getComputedStyle(root.querySelector('.profile-stat-strip'));
    return {
      activityBackground: activity.backgroundColor,
      activityBorder: activity.borderTopWidth,
      insightBackground: insight.backgroundColor,
      insightBorder: insight.borderTopWidth,
      statsBackground: stats.backgroundColor,
      statsBorder: stats.borderTopWidth,
    };
  });
  assert.equal(profileSurfaces.activityBackground, 'rgba(0, 0, 0, 0)', 'Token 活动仍有独立底色');
  assert.equal(profileSurfaces.activityBorder, '0px', 'Token 活动仍有区域外框');
  assert.equal(profileSurfaces.insightBackground, 'rgba(0, 0, 0, 0)', '活动洞察仍有独立底色');
  assert.equal(profileSurfaces.insightBorder, '0px', '活动洞察仍有区域外框');
  assert.equal(profileSurfaces.statsBackground, 'rgba(0, 0, 0, 0)', '统计条仍有填充底色');
  assert.equal(profileSurfaces.statsBorder, '1px', '统计条没有保留克制细框');

  await page.setViewportSize({ width: 1440, height: 620 });
  const settingsScrollTop = await page.locator('.settings-content').evaluate((element) => {
    element.scrollTop = Math.min(180, Math.max(0, element.scrollHeight - element.clientHeight));
    return element.scrollTop;
  });
  const profileEditButton = page.getByRole('button', { name: '编辑', exact: true });
  // Keep the programmed background position; Playwright's pointer click would
  // scroll an off-screen trigger into view before the modal opens.
  await profileEditButton.evaluate((element) => element.click());
  const profileEditor = page.locator('.profile-edit-card');
  const profileEditorBody = page.locator('.user-profile-edit-body');
  await profileEditor.waitFor({ state: 'visible' });
  assert.equal(await page.locator('.settings-content').evaluate((element) => getComputedStyle(element).overflow), 'hidden', '打开个人资料弹窗后背景仍可滚动');
  assert.equal(await page.locator('.settings-content').evaluate((element) => element.scrollTop), settingsScrollTop, '打开个人资料弹窗时背景滚动位置发生变化');
  const profileEditorLayout = await profileEditor.evaluate((card) => {
    const body = card.querySelector('.user-profile-edit-body');
    const header = card.querySelector('.user-profile-edit-hero');
    const footer = card.querySelector('.modal-actions');
    return {
      rows: getComputedStyle(card.querySelector('.user-profile-form')).gridTemplateRows,
      bodyOverflow: body ? getComputedStyle(body).overflowY : '',
      overscroll: body ? getComputedStyle(body).overscrollBehavior : '',
      headerTop: header?.getBoundingClientRect().top,
      footerBottom: footer?.getBoundingClientRect().bottom,
      cardTop: card.getBoundingClientRect().top,
      cardBottom: card.getBoundingClientRect().bottom,
    };
  });
  assert.equal(profileEditorLayout.bodyOverflow, 'auto', '个人资料字段没有独立滚动容器');
  assert.equal(profileEditorLayout.overscroll, 'contain', '个人资料滚动会传递给背景页面');
  assert.ok(Math.abs(profileEditorLayout.headerTop - profileEditorLayout.cardTop) <= 1, '个人资料弹窗顶部没有固定');
  assert.ok(Math.abs(profileEditorLayout.footerBottom - profileEditorLayout.cardBottom) <= 1, '个人资料弹窗底部操作栏没有固定');
  assert.equal(await profileEditorBody.evaluate((element) => document.activeElement === element.querySelector('[data-profile-autofocus]')), true, '个人资料弹窗打开后没有聚焦首个字段');
  await profileEditor.getByLabel('用户名/昵称').fill('临时未保存资料');
  await page.keyboard.press('Escape');
  await page.getByText('放弃未保存的修改？', { exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await profileEditor.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await profileEditor.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === '编辑');
  assert.equal(await profileEditButton.evaluate((element) => document.activeElement === element), true, '关闭个人资料弹窗后焦点没有返回编辑按钮');
  await page.setViewportSize({ width: 1440, height: 900 });

  const latestActivityCell = page.locator('.token-activity-cell:not(.is-future)').last();
  await latestActivityCell.hover();
  assert.equal(await page.getByRole('tooltip').isVisible(), true, 'Token 单元悬停没有显示提示');
  assert.match(await page.getByRole('tooltip').innerText(), /Token/, 'Token 提示缺少数值');
  await latestActivityCell.focus();
  assert.match(await latestActivityCell.getAttribute('aria-label') || '', /当日/, '每日模式缺少可访问数值说明');
  await latestActivityCell.press('Escape');
  assert.equal(await page.getByRole('tooltip').count(), 0, 'Escape 没有关闭 Token 提示');

  await page.getByRole('button', { name: '每周', exact: true }).click();
  assert.match(await latestActivityCell.getAttribute('aria-label') || '', /本周/, '每周模式没有更新单元说明');
  await page.getByRole('button', { name: '累计', exact: true }).click();
  assert.match(await latestActivityCell.getAttribute('aria-label') || '', /累计/, '累计模式没有更新单元说明');
  await page.getByRole('button', { name: '每日', exact: true }).click();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reducedMotionStyles = await latestActivityCell.evaluate((element) => {
    const styles = getComputedStyle(element);
    return { animationName: styles.animationName, transitionDuration: styles.transitionDuration };
  });
  assert.equal(reducedMotionStyles.animationName, 'none', '减少动态效果下热力图仍有入场动画');
  assert.ok(reducedMotionStyles.transitionDuration === '0s' || reducedMotionStyles.transitionDuration === '0ms', '减少动态效果下热力图仍有过渡');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  for (const [label, heading] of entryHeadings) await selectSettingsEntry(label, heading);

  await selectSettingsEntry('外观', '外观');
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await waitForPersistedUi('appearance', 'dark');
  assert.equal(await page.locator('.app').getAttribute('data-appearance'), 'dark');

  const darkEntryHeadings = [
    ['个人资料', '个人资料'],
    ['归档对话', '归档对话'],
    ['Agent 配置', 'Agent Profile'],
    ['Memory', 'Memory Ledger'],
    ['Knowledge', 'Knowledge'],
    ['工具能力', '工具能力'],
    ['Runtime Center', 'Runtime Center'],
    ['Hermes 集成', 'Hermes 集成'],
    ['技能', '技能'],
    ['插件', '插件'],
    ['模型', 'Frakio Work 模型中心'],
    ['仓库', 'Obsidian 仓库'],
    ['MCP', 'MCP 服务器'],
    ['频道', '频道'],
    ['任务', '定时任务'],
    ['监控', '监控'],
    ['系统状态', '系统状态'],
    ['版本更新', '版本更新'],
  ];
  for (const [label, heading] of darkEntryHeadings) {
    await selectSettingsEntry(label, heading);
    await assertDarkSettingsPage(label);
  }

  await selectSettingsEntry('模型', 'Frakio Work 模型中心');
  assert.deepEqual(
    await page.locator('.model-center-tabs button').allTextContents(),
    ['模型配置', '授权账户', '辅助模型'],
    '模型页仍显示组合模型入口',
  );
  assert.equal(await page.getByText('组合模型', { exact: true }).count(), 0, '模型页仍存在组合模型内容');
  assert.deepEqual(moaRequests, [], '模型页仍请求组合模型配置接口');

  await selectSettingsEntry('技能', '技能');
  const skillScope = page.locator('.managed-scope-strip');
  await skillScope.getByRole('button').nth(6).waitFor({ state: 'visible' });
  assert.equal(await skillScope.getByRole('button').count(), 7, '技能范围栏没有显示全局与全部 Agent');
  assert.match(await page.locator('.managed-module-origin').innerText(), /来源：Iris/, '全局技能没有显示来源 Agent');
  await skillScope.getByRole('button').filter({ hasText: 'Max' }).click();
  assert.equal(await page.locator('.managed-module-toolbar').getByText('另继承 1 个全局技能', { exact: true }).isVisible(), true, 'Agent 技能页没有显示继承数量');
  assert.equal(await page.locator('.managed-module-row').getByText('max-skill', { exact: true }).isVisible(), true, 'Agent 范围没有只显示自身技能');
  const skillContrast = await page.locator('.managed-module-row').first().evaluate((row) => {
    const parse = (value) => {
      const values = value.match(/[\d.]+/g)?.map(Number) || [];
      return { r: values[0] || 0, g: values[1] || 0, b: values[2] || 0, a: values.length > 3 ? values[3] : 1 };
    };
    const blend = (front, back) => ({
      r: front.r * front.a + back.r * (1 - front.a),
      g: front.g * front.a + back.g * (1 - front.a),
      b: front.b * front.a + back.b * (1 - front.a),
      a: 1,
    });
    let background = { r: 0, g: 0, b: 0, a: 1 };
    const ancestry = [];
    for (let element = row; element; element = element.parentElement) ancestry.push(element);
    for (const element of ancestry.reverse()) background = blend(parse(getComputedStyle(element).backgroundColor), background);
    const luminance = (color) => {
      const channel = (value) => {
        const normalized = value / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
    };
    const ratio = (foreground) => {
      const foregroundLuminance = luminance(parse(foreground));
      const backgroundLuminance = luminance(background);
      return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
    };
    return {
      body: ratio(getComputedStyle(row.querySelector('.managed-module-main > p')).color),
      secondary: ratio(getComputedStyle(row.querySelector('.managed-module-meta > span')).color),
    };
  });
  assert.ok(skillContrast.body >= 4.5, `暗色技能正文对比度不足：${skillContrast.body.toFixed(2)}:1`);
  assert.ok(skillContrast.secondary >= 3, `暗色技能次要文字对比度不足：${skillContrast.secondary.toFixed(2)}:1`);
  await page.setViewportSize({ width: 760, height: 900 });
  await assertNoHorizontalOverflow(page.locator('.settings-content'), '760px 技能页横向溢出');
  await assertNoHorizontalOverflow(page.locator('.managed-modules-page'), '760px 技能管理页横向溢出');
  const scopeOverflow = await skillScope.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, overflowX: getComputedStyle(element).overflowX }));
  assert.ok(scopeOverflow.scrollWidth > scopeOverflow.clientWidth, '760px 范围头像栏没有形成独立横向滚动');
  assert.equal(scopeOverflow.overflowX, 'auto', '760px 范围头像栏没有接管横向滚动');
  await page.setViewportSize({ width: 1440, height: 900 });

  await selectSettingsEntry('插件', '插件');
  const pluginScope = page.locator('.managed-scope-strip');
  await pluginScope.getByRole('button').nth(6).waitFor({ state: 'visible' });
  assert.equal(await pluginScope.getByRole('button').count(), 7, '插件范围栏没有显示全局与全部 Agent');
  assert.match(await page.locator('.managed-module-origin').innerText(), /来源：Iris/, '全局插件没有显示来源 Agent');

  await selectSettingsEntry('Agent 配置', 'Agent Profile');
  const agentTabs = page.locator('.agent-tabs');
  assert.equal(await agentTabs.count(), 1, 'Agent 档案标签 Banner 不存在');
  const agentTabButtons = agentTabs.getByRole('button');
  assert.equal(await agentTabButtons.count(), 3, 'Agent 档案标签数量不正确');
  const agentTabAppearance = await agentTabs.evaluate((element) => {
    const selected = element.querySelector('button.selected');
    const inactive = element.querySelector('button:not(.selected)');
    const containerStyles = getComputedStyle(element);
    const selectedStyles = selected ? getComputedStyle(selected) : null;
    const inactiveStyles = inactive ? getComputedStyle(inactive) : null;
    return {
      containerBackground: containerStyles.backgroundColor,
      containerBorder: containerStyles.borderTopColor,
      containerShadow: containerStyles.boxShadow,
      selectedBackground: selectedStyles?.backgroundColor || '',
      selectedColor: selectedStyles?.color || '',
      selectedShadow: selectedStyles?.boxShadow || '',
      inactiveColor: inactiveStyles?.color || '',
    };
  });
  assert.match(agentTabAppearance.containerBackground, /^rgba\(255, 255, 255, 0\.0/, 'Agent 标签 Banner 仍使用浅色实底');
  assert.notEqual(agentTabAppearance.containerBorder, 'rgb(255, 255, 255)', 'Agent 标签 Banner 仍使用纯白边框');
  assert.equal(agentTabAppearance.containerShadow, 'none', 'Agent 标签 Banner 仍有浅色阴影');
  assert.match(agentTabAppearance.selectedBackground, /^rgba\(255, 255, 255, 0\.0/, 'Agent 标签选中态仍是白色胶囊');
  assert.notEqual(agentTabAppearance.selectedColor, agentTabAppearance.inactiveColor, 'Agent 标签选中态没有文字层级');
  assert.equal(agentTabAppearance.selectedShadow, 'none', 'Agent 标签选中态仍有浅色投影');

  for (const label of ['笔记', '用户画像', '灵魂']) {
    const tabButton = agentTabs.getByRole('button', { name: label, exact: true });
    await tabButton.click();
    assert.equal(await tabButton.getAttribute('class'), 'selected', `Agent 标签“${label}”没有切换选中态`);
  }
  await page.keyboard.press('Shift+Tab');
  const focusedAgentTab = agentTabs.locator('button:focus-visible');
  assert.equal(await focusedAgentTab.count(), 1, '键盘导航没有聚焦 Agent 标签');
  const focusAppearance = await focusedAgentTab.evaluate((element) => {
    const styles = getComputedStyle(element);
    return { outlineStyle: styles.outlineStyle, outlineWidth: styles.outlineWidth };
  });
  assert.equal(focusAppearance.outlineStyle, 'solid', 'Agent 标签键盘焦点不可见');
  assert.equal(focusAppearance.outlineWidth, '2px', 'Agent 标签焦点环尺寸不正确');

  await page.setViewportSize({ width: 760, height: 900 });
  await assertNoHorizontalOverflow(page.locator('.settings-content'), '760px Agent 配置页横向溢出');
  await assertNoHorizontalOverflow(page.locator('.agent-profile-detail'), '760px Agent 档案详情横向溢出');
  await page.setViewportSize({ width: 1440, height: 900 });

  await selectSettingsEntry('监控', '监控');
  const chartTokens = await page.locator('.app').evaluate((app) => {
    const styles = getComputedStyle(app);
    return {
      grid: styles.getPropertyValue('--settings-chart-grid').trim(),
      axis: styles.getPropertyValue('--settings-chart-axis').trim(),
      legend: styles.getPropertyValue('--settings-chart-legend').trim(),
      canvas: styles.getPropertyValue('--settings-chart-canvas').trim(),
    };
  });
  assert.ok(chartTokens.grid && chartTokens.axis && chartTokens.legend && chartTokens.canvas, '监控图表没有读取暗色语义变量');
  assert.equal(await page.locator('.usage-trend-scroll').count() > 0, true, '监控趋势图容器不存在');

  await selectSettingsEntry('版本更新', '版本更新');
  assert.equal(await page.getByText('更新由 Frakio Work 管理的 Hermes Agent 源码与运行配置。').count(), 0, '版本页仍显示 Hermes Agent 源码更新模块');
  assert.equal(await page.getByRole('region', { name: 'Hermes Agent Runtime 版本管理' }).count(), 1, 'Hermes Agent Runtime 版本管理不存在');
  assert.equal(await page.getByLabel('官方稳定版本').count(), 1, 'Runtime 缺少官方稳定版本选择器');
  const releaseNotesButton = page.getByRole('button', { name: '查看完整更新日志' });
  if (await releaseNotesButton.count()) {
    await releaseNotesButton.click();
    assert.equal(await page.getByRole('dialog').locator('.release-notes-dialog-head h2').isVisible(), true, '完整更新日志弹窗没有打开');
    await page.getByRole('dialog').getByRole('button', { name: '关闭更新日志' }).click();
  }
  await page.setViewportSize({ width: 760, height: 900 });
  await assertNoHorizontalOverflow(page.locator('.settings-content'), '760px 版本更新页横向溢出');
  await page.setViewportSize({ width: 1440, height: 900 });

  const search = page.getByPlaceholder('搜索设置...');
  for (const [keyword, expected] of [
    ['本地连接', '系统状态'],
    ['Hermes Runtime', 'Hermes 集成'],
    ['主题', '外观'],
  ]) {
    await search.fill(keyword);
    assert.equal(await page.getByRole('button', { name: expected, exact: true }).isVisible(), true, `旧关键词“${keyword}”没有命中“${expected}”`);
  }
  await search.fill('');

  await selectSettingsEntry('工作台', '工作台');
  assert.equal(await page.getByRole('region', { name: '本地配置同步' }).isVisible(), true, 'Profile 同步没有迁入工作台');
  assert.equal(await page.getByRole('button', { name: '同步配置', exact: true }).isVisible(), true, 'Profile 同步操作不可用');

  const sendKey = page.getByRole('region', { name: '工作台偏好' }).getByRole('combobox').nth(0);
  const nextSendKey = initialUi.sendKey === 'mod-enter' ? 'enter' : 'mod-enter';
  await sendKey.selectOption(nextSendKey);
  await waitForPersistedUi('sendKey', nextSendKey);

  const richDescriptions = page.getByRole('switch', { name: '丰富的工具描述' });
  const nextRichDescriptions = !(initialUi.richToolDescriptions !== false);
  await page.locator('label.frakio-settings-toggle-row').filter({ hasText: '丰富的工具描述' }).click();
  assert.equal(await richDescriptions.isChecked(), nextRichDescriptions, '点击开关标签没有更新控件状态');
  await waitForPersistedUi('richToolDescriptions', nextRichDescriptions);

  await selectSettingsEntry('外观', '外观');
  const nextAppearance = initialUi.appearance === 'dark' ? 'light' : 'dark';
  await page.getByRole('button', { name: nextAppearance === 'dark' ? '深色' : '浅色', exact: true }).click();
  await waitForPersistedUi('appearance', nextAppearance);
  assert.equal(await page.locator('.app').getAttribute('data-appearance'), nextAppearance);

  await page.reload({ waitUntil: 'networkidle' });
  await clearBlockingNotices();
  await openSettings();
  const persistedSendKey = page.getByRole('region', { name: '工作台偏好' }).getByRole('combobox').nth(0);
  assert.equal(await persistedSendKey.inputValue(), nextSendKey, '发送键没有持久化');
  assert.equal(await page.getByRole('switch', { name: '丰富的工具描述' }).isChecked(), nextRichDescriptions, '丰富工具描述没有持久化');
  await selectSettingsEntry('外观', '外观');
  assert.equal(await page.locator('.app').getAttribute('data-appearance'), nextAppearance, '主题没有持久化');

  await page.setViewportSize({ width: 1440, height: 900 });
  await assertNoHorizontalOverflow(page.locator('.app'), '1440px 设置页横向溢出');
  await assertNoHorizontalOverflow(page.locator('.settings-content'), '1440px 内容区横向溢出');

  await selectSettingsEntry('个人资料', '个人资料');
  await page.setViewportSize({ width: 760, height: 900 });
  await page.waitForTimeout(200);
  await assertNoHorizontalOverflow(page.locator('.app'), '760px 设置页横向溢出');
  await assertNoHorizontalOverflow(page.locator('.settings-content'), '760px 内容区横向溢出');
  await assertNoHorizontalOverflow(page.locator('.profile-dashboard'), '760px 个人资料页横向溢出');
  const compactAvatarSize = await page.locator('.profile-avatar-button').evaluate((element) => element.getBoundingClientRect().width);
  assert.ok(compactAvatarSize >= 75 && compactAvatarSize <= 77, `760px 个人资料头像尺寸不是 76px：${compactAvatarSize}`);
  const mobileToggle = page.getByRole('button', { name: '展开设置导航' });
  assert.equal(await mobileToggle.isVisible(), true, '760px 设置导航没有收起');
  await mobileToggle.click();
  assert.equal(await page.getByRole('button', { name: '系统状态', exact: true }).isVisible(), true, '移动设置导航无法展开');
  const mobileSettingsScrollOwnership = await page.locator('.settings-rail-body').evaluate((body) => {
    const nav = body.querySelector('.settings-nav');
    return {
      bodyOverflowY: getComputedStyle(body).overflowY,
      navOverflowY: nav ? getComputedStyle(nav).overflowY : '',
      searchInsideNav: Boolean(body.querySelector('.settings-nav .settings-search')),
    };
  });
  assert.equal(mobileSettingsScrollOwnership.bodyOverflowY, 'hidden', '760px 设置抽屉仍由整体滚动');
  assert.equal(mobileSettingsScrollOwnership.navOverflowY, 'auto', '760px 设置导航没有独立滚动');
  assert.equal(mobileSettingsScrollOwnership.searchInsideNav, false, '760px 设置搜索框进入了渐隐导航');
  await assertBoundaryFade(page.locator('.settings-nav'), 20, '760px 设置导航');
  await assertBoundaryFade(page.locator('.settings-content'), 32, '760px 设置中央主卡');
  await page.getByRole('button', { name: '系统状态', exact: true }).click();
  await page.getByRole('heading', { name: '系统状态', exact: true }).waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('button', { name: '展开设置导航' }).isVisible(), true, '选择入口后移动导航没有收起');
  await assertNoHorizontalOverflow(page.locator('.settings-content'), '760px 系统状态页横向溢出');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '返回对话', exact: true }).click();
  await page.getByRole('heading', { level: 1 }).waitFor({ state: 'visible' });
  assert.equal(await page.locator('.settings-rail-sidebar').count(), 0, '返回对话后设置导航仍然存在');
  assert.deepEqual(errors, [], `Browser console errors: ${errors.join(' | ')}`);
  console.log('Playwright settings flow passed.');
} finally {
  await restoreUi().catch(() => undefined);
  await browser.close();
}
