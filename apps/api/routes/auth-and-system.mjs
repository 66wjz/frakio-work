// wjz新建文件，新建原因：解耦 server.mjs 中的认证、用户 Session、系统健康检查与 App 更新状态路由（auth-and-system），修改时间：2026-08-18。
// 文件内容概述：/api/auth/*, /api/session, /api/health, /api/app-update/status 路由及中间件挂载。
import express from 'express';
import { appUpdateStatus } from '../lib/app-update.mjs';
import { FRAKIO_SERVICE_PROTOCOL } from '../lib/service-discovery.mjs';

export function createAuthAndSystemRouter({
  managedWebAuth,
  localSecurity,
  runtimeModelGateway,
  readFrakioPackageVersion,
  port,
  isManagedWebMode,
  isDesktopMode,
}) {
  const router = express.Router();

  // 1. Runtime Model Gateway Token Endpoint
  if (runtimeModelGateway) {
    router.post('/runtime-model-gateway/:token/v1/:operation', (req, res) => runtimeModelGateway.handle(req, res));
  }

  // 2. Managed Web Auth public endpoints
  router.get('/auth/status', managedWebAuth.statusRoute);
  router.post('/auth/login', managedWebAuth.loginRoute);
  router.post('/auth/desktop-session', managedWebAuth.desktopSessionRoute);

  // 3. Security Protection Middleware
  router.use(managedWebAuth.protect);
  router.get('/session', localSecurity.sessionRoute);
  router.use(localSecurity.protect);

  // 4. Protected Auth endpoints
  router.post('/auth/logout', managedWebAuth.logoutRoute);
  router.put('/auth/password', (req, res) => void managedWebAuth.passwordRoute(req, res));

  // 5. System Health Check
  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'frakio-work-api',
      port,
      deploymentMode: isManagedWebMode ? 'managed-web' : isDesktopMode ? 'desktop' : 'source',
      apiProtocol: FRAKIO_SERVICE_PROTOCOL,
    });
  });

  // 6. App Update Status
  router.get('/app-update/status', async (req, res) => {
    try {
      const currentVersion = readFrakioPackageVersion ? await readFrakioPackageVersion() : '1.4.0';
      res.json(
        await appUpdateStatus({
          currentVersion,
          force: String(req.query.refresh || '') === '1',
          packaged: process.env.FRAKIO_WORK_PACKAGED === '1',
          platform: process.platform,
          arch: process.arch,
        }),
      );
    } catch (error) {
      res.status(500).json({ error: error.message || '获取更新状态失败。' });
    }
  });

  return router;
}
// wjz新建文件结束。
