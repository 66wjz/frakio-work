// wjz新建文件，新建原因：解耦 server.mjs 中的用户资料、Hermes Profile、技能与插件管理（Hermes Modules）路由（user-and-profiles），修改时间：2026-08-18。
// 文件内容概述：/api/user-profile, /api/hermes-profiles/*, /api/hermes-modules/*, /api/hermes-local/status, /api/hermes/network-status。
import express from 'express';
import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function slug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-');
}

export function createUserAndProfilesRouter({
  readState,
  writeState,
  hermesWorkbenchRuntimeHome,
  profileDirForName,
  normalizeUserProfile,
  syncUserProfileToHermesProfiles,
  staleAgentRuntimeSessions,
  syncProfileAgent,
  resolveProfileTextFile,
  updateHermesProfileSkillState,
  findProfileAvatar,
  readManagedHermesModules,
  resolveManagedModuleFile,
  runHermesModuleMutation,
  managedModuleKind,
  reloadManagedSkills,
  managedModuleOwnerRows,
  runningManagedProfiles,
  updateManagedModuleState,
  promoteManagedModule,
  demoteManagedModule,
  deleteManagedModule,
  discoverHermesStudio,
  respondNetworkCapabilityStatus,
  captureTelemetry = () => {},
  captureMeaningfulActivity = () => {},
}) {
  const router = express.Router();

  // 1. Get Hermes Profile Avatar
  router.get('/hermes-profiles/:profileName/avatar', async (req, res) => {
    const dir = await profileDirForName(req.params.profileName);
    if (!dir) return res.status(404).send('Profile not found');
    const assetsDir = path.join(dir, 'assets');
    try {
      const entries = await readdir(assetsDir, { withFileTypes: true });
      const avatar = entries.find((entry) => entry.isFile() && /^avatar\.(png|jpe?g|webp|gif)$/i.test(entry.name));
      if (!avatar) return res.status(404).send('Avatar not found');
      const avatarPath = path.join(assetsDir, avatar.name);
      const ext = path.extname(avatar.name).toLowerCase();
      const contentType =
        ext === '.png'
          ? 'image/png'
          : ext === '.webp'
            ? 'image/webp'
            : ext === '.gif'
              ? 'image/gif'
              : 'image/jpeg';
      res.type(contentType).send(await readFile(avatarPath));
    } catch {
      res.status(404).send('Avatar not found');
    }
  });

  // 2. Get User Avatar
  router.get('/user-profile/avatar', async (_req, res) => {
    try {
      const assetsDir = path.join(hermesWorkbenchRuntimeHome, 'assets');
      const entries = await readdir(assetsDir, { withFileTypes: true }).catch(() => []);
      const avatar = entries.find((entry) => entry.isFile() && /^user-avatar\.(png|jpe?g|webp|gif)$/i.test(entry.name));
      if (!avatar) return res.status(404).send('Avatar not found');
      const avatarPath = path.join(assetsDir, avatar.name);
      const ext = path.extname(avatar.name).toLowerCase();
      const contentType =
        ext === '.png'
          ? 'image/png'
          : ext === '.webp'
            ? 'image/webp'
            : ext === '.gif'
              ? 'image/gif'
              : 'image/jpeg';
      res.type(contentType).send(await readFile(avatarPath));
    } catch {
      res.status(404).send('Avatar not found');
    }
  });

  // 3. Get User Profile
  router.get('/user-profile', async (_req, res) => {
    const state = await readState();
    res.json({ userProfile: state.userProfile || normalizeUserProfile() });
  });

  // 4. Upload User Avatar
  router.post('/user-profile/avatar', async (req, res) => {
    try {
      const mime = String(req.body?.mimeType || '');
      const data = String(req.body?.data || '');
      const match = data.match(/^data:([^;]+);base64,(.+)$/);
      const rawBase64 = match ? match[2] : data;
      const detectedMime = match ? match[1] : mime;
      const supported = /image\/(png|webp|gif|jpeg|jpg)/i.test(detectedMime);
      if (!supported) return res.status(400).json({ error: '仅支持 png、jpg、webp、gif 头像。' });
      const buffer = Buffer.from(rawBase64, 'base64');
      if (!buffer.length || buffer.length > 3 * 1024 * 1024)
        return res.status(400).json({ error: '头像大小需小于 3MB。' });
      const assetsDir = path.join(hermesWorkbenchRuntimeHome, 'assets');
      await mkdir(assetsDir, { recursive: true });
      const existing = await readdir(assetsDir, { withFileTypes: true }).catch(() => []);
      await Promise.all(
        existing
          .filter((entry) => entry.isFile() && /^user-avatar\.(png|jpe?g|webp|gif)$/i.test(entry.name))
          .map((entry) => unlink(path.join(assetsDir, entry.name)).catch(() => null)),
      );
      const avatarPath = path.join(assetsDir, 'user-avatar.png');
      if (!isInside(assetsDir, avatarPath)) return res.status(403).json({ error: '头像路径不合法。' });
      await writeFile(avatarPath, buffer);
      const fileStat = await stat(avatarPath);
      res.json({ avatarUrl: `/api/user-profile/avatar?v=${Math.round(fileStat.mtimeMs)}` });
    } catch (error) {
      res.status(500).json({ error: error.message || '头像保存失败。' });
    }
  });

  // 5. Update User Profile
  router.put('/user-profile', async (req, res) => {
    try {
      const state = await readState();
      const previous = state.userProfile || {};
      const next = normalizeUserProfile({
        ...previous,
        ...(req.body?.userProfile || req.body || {}),
        updatedAt: Date.now(),
      });
      if (next.avatarUrl && next.nickname) next.completedAt = next.completedAt || Date.now();
      state.userProfile = next;
      await writeState(state);
      await syncUserProfileToHermesProfiles(state, next);
      for (const agent of state.agents || []) staleAgentRuntimeSessions(agent.id, 'user_profile_changed');
      const refreshed = await readState();
      res.json({ userProfile: refreshed.userProfile, agents: refreshed.agents });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message || '用户资料保存失败。' });
    }
  });

  // 6. Upload Hermes Profile Avatar
  router.post('/hermes-profiles/:profileName/avatar', async (req, res) => {
    try {
      const dir = await profileDirForName(req.params.profileName);
      if (!dir) return res.status(404).json({ error: '未找到可编辑的 Hermes Profile。' });
      const mimeType = String(req.body?.mimeType || '').toLowerCase();
      if (!/image\/(png|webp|gif|jpeg|jpg)/i.test(mimeType))
        return res.status(400).json({ error: '只支持 PNG、JPG、WEBP、GIF 头像。' });
      const rawData = String(req.body?.data || '').replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
      const buffer = Buffer.from(rawData, 'base64');
      if (!buffer.length || buffer.length > 5 * 1024 * 1024)
        return res.status(400).json({ error: '头像文件为空或超过 5MB。' });
      const assetsDir = path.join(dir, 'assets');
      await mkdir(assetsDir, { recursive: true });
      const entries = await readdir(assetsDir, { withFileTypes: true }).catch(() => []);
      await Promise.all(
        entries
          .filter((entry) => entry.isFile() && /^avatar\.(png|jpe?g|webp|gif)$/i.test(entry.name))
          .map((entry) => rm(path.join(assetsDir, entry.name), { force: true })),
      );
      const avatarPath = path.join(assetsDir, 'avatar.png');
      if (!isInside(dir, avatarPath)) return res.status(403).json({ error: '头像路径超出 Hermes Profile。' });
      await writeFile(avatarPath, buffer);
      const synced = await syncProfileAgent(req.params.profileName);
      res.json({
        avatarUrl: await findProfileAvatar(dir, req.params.profileName),
        agent: synced.agent,
        profile: synced.profile,
      });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message || '头像保存失败。' });
    }
  });

  // 7. Read Hermes Profile File
  router.get('/hermes-profiles/:profileName/file', async (req, res) => {
    try {
      const { target } = await resolveProfileTextFile(req.params.profileName, req.query.kind, req.query.name);
      const content = await readFile(target, 'utf8').catch(() => '');
      res.json({ content, file: target });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message || '读取 Profile 文件失败。' });
    }
  });

  // 8. Update Hermes Profile File
  router.put('/hermes-profiles/:profileName/file', async (req, res) => {
    try {
      const moduleKind = String(req.body?.kind || '').trim();
      if (['notes', 'user', 'soul'].includes(moduleKind)) {
        return res.status(409).json({
          error: '这是 Frakio 生成的 Hermes 兼容投影。请在 Agent 中心或记忆中心修改正式数据。',
          code: 'FRAKIO_PROJECTION_READ_ONLY',
          importRequired: true,
        });
      }
      const { target } = await resolveProfileTextFile(req.params.profileName, moduleKind, req.body?.name);
      const content = String(req.body?.content || '').slice(0, 250000);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
      const synced = await syncProfileAgent(req.params.profileName);
      if (moduleKind === 'skill' || moduleKind === 'plugin') {
        captureTelemetry('feature_used', {
          feature: moduleKind === 'skill' ? 'skill_synced' : 'plugin_synced',
          outcome: 'completed',
        });
        captureMeaningfulActivity('feature_used');
      }
      res.json({ ok: true, file: target, agent: synced.agent, profile: synced.profile });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message || '保存 Profile 文件失败。' });
    }
  });

  // 9. Update Hermes Profile Skill State
  router.put('/hermes-profiles/:profileName/skill-state', async (req, res) => {
    try {
      const result = await updateHermesProfileSkillState(
        req.params.profileName,
        req.body?.name,
        Boolean(req.body?.enabled),
      );
      const synced = await syncProfileAgent(req.params.profileName);
      captureTelemetry('feature_used', { feature: 'skill_synced', outcome: 'completed' });
      captureMeaningfulActivity('feature_used');
      res.json({ ok: true, ...result, agent: synced.agent, profile: synced.profile });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message || '技能状态保存失败。' });
    }
  });

  // 10. Read Managed Hermes Modules
  router.get('/hermes-modules', async (req, res) => {
    try {
      res.json(await readManagedHermesModules(req.query.kind));
    } catch (error) {
      res.status(error.status || 500).json({
        error: error.message || '模块读取失败。',
        ...(error.code ? { code: error.code } : {}),
        ...(error.details ? { details: error.details } : {}),
      });
    }
  });

  // 11. Read Managed Hermes Module File
  router.get('/hermes-modules/file', async (req, res) => {
    try {
      const moduleEntry = await resolveManagedModuleFile(
        req.query.kind,
        req.query.scope,
        req.query.name,
        req.query.profileName,
      );
      res.json({
        content: await readFile(moduleEntry.manifestPath, 'utf8').catch(() => ''),
        file: moduleEntry.file,
        name: moduleEntry.name,
      });
    } catch (error) {
      res.status(error.status || 500).json({
        error: error.message || '模块文件读取失败。',
        ...(error.code ? { code: error.code } : {}),
      });
    }
  });

  // 12. Update Managed Hermes Module File
  router.put('/hermes-modules/file', async (req, res) => {
    try {
      const result = await runHermesModuleMutation(async () => {
        const cleanKind = managedModuleKind(req.body?.kind);
        const moduleEntry = await resolveManagedModuleFile(
          cleanKind,
          req.body?.scope,
          req.body?.name,
          req.body?.profileName,
        );
        const content = String(req.body?.content || '').slice(0, 250000);
        await writeFile(moduleEntry.manifestPath, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
        const reloads =
          cleanKind === 'skill'
            ? await reloadManagedSkills(
                req.body?.scope === 'global'
                  ? (await managedModuleOwnerRows()).map((owner) => owner.name)
                  : [slug(req.body?.profileName || '')],
              )
            : [];
        const restartRequiredProfiles =
          cleanKind === 'plugin'
            ? await runningManagedProfiles(
                req.body?.scope === 'global'
                  ? await managedModuleOwnerRows()
                  : (await managedModuleOwnerRows()).filter((owner) => owner.name === slug(req.body?.profileName || '')),
              )
            : [];
        return { modules: await readManagedHermesModules(cleanKind), reloads, restartRequiredProfiles };
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(error.status || 500).json({
        error: error.message || '模块文件保存失败。',
        ...(error.code ? { code: error.code } : {}),
        ...(error.details ? { details: error.details } : {}),
      });
    }
  });

  // 13. Update Managed Hermes Module State
  router.put('/hermes-modules/state', async (req, res) => {
    try {
      const result = await runHermesModuleMutation(() =>
        updateManagedModuleState(req.body?.kind, req.body?.name, req.body?.profileName, Boolean(req.body?.enabled)),
      );
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(error.status || 500).json({
        error: error.message || '模块状态保存失败。',
        ...(error.code ? { code: error.code } : {}),
        ...(error.details ? { details: error.details } : {}),
      });
    }
  });

  // 14. Update Managed Hermes Module Scope (Promote / Demote)
  router.post('/hermes-modules/scope', async (req, res) => {
    try {
      const action = String(req.body?.action || '').trim();
      if (!['promote', 'demote'].includes(action))
        return res.status(400).json({ error: '范围操作必须是 promote 或 demote。' });
      const result = await runHermesModuleMutation(() =>
        action === 'promote'
          ? promoteManagedModule(req.body?.kind, req.body?.name, req.body?.profileName)
          : demoteManagedModule(req.body?.kind, req.body?.name, req.body?.targetProfileName),
      );
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(error.status || 500).json({
        error: error.message || '模块范围保存失败。',
        ...(error.code ? { code: error.code } : {}),
        ...(error.details ? { details: error.details } : {}),
      });
    }
  });

  // 15. Delete Managed Hermes Module
  router.delete('/hermes-modules', async (req, res) => {
    try {
      const result = await runHermesModuleMutation(() =>
        deleteManagedModule(req.body?.kind, req.body?.name, req.body?.scope, req.body?.profileName),
      );
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(error.status || 500).json({
        error: error.message || '模块删除失败。',
        ...(error.code ? { code: error.code } : {}),
        ...(error.details ? { details: error.details } : {}),
      });
    }
  });

  // 16. Hermes Local Status
  router.get('/hermes-local/status', async (_req, res) => {
    try {
      const discovery = await discoverHermesStudio();
      const state = await readState();
      state.integrations = state.integrations || {};
      state.integrations.hermesStudio = {
        ...state.integrations.hermesStudio,
        detectedUrl: discovery.studio.url || state.integrations.hermesStudio.detectedUrl || '',
        lastCheckedAt: discovery.checkedAt,
        authMode: discovery.studio.authMode,
      };
      await writeState(state);
      res.json(discovery);
    } catch (error) {
      res.status(500).json({ error: error.message || '无法获取 Hermes 本地状态。' });
    }
  });

  // 17. Hermes Network Status
  if (respondNetworkCapabilityStatus) {
    router.get('/hermes/network-status', (req, res) => void respondNetworkCapabilityStatus(req, res));
    router.post('/hermes/network-status/refresh', (req, res) => void respondNetworkCapabilityStatus(req, res, true));
  }

  return router;
}
// wjz新建文件结束。
