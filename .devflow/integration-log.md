<!-- wjz新建文件，新建原因：建立 .devflow 联调与集成审计日志 integration-log.md，修改时间：2026-08-18。 -->
# Frakio Work 联调与集成审计日志 (.devflow/integration-log.md)

---

## 1. 500 路由阴影排查与真机模型联调记录

- **联调时间**：2026-08-18 10:15
- **联调对象**：Hermes Agent 对话链路 + Kimi for Coding (`kimi-latest`) 真实模型提供商
- **测试环境**：本地开发环境（Web: 5173 / API: 8787 / Python Bridge: 3.10）
- **现象与成因**：
  - 前端控制台报 500，`apps/api/routes/workspaces-and-vaults.mjs` 中定义了空重定向的 `/spaces` 和 `/workspaces`，拦截了真正的 workspace 列表请求。
  - Python Bridge `bridge_runtime.py` 内部仅硬编码判定 Anthropic / OpenAI / Google，导致 Kimi 误走 Anthropic 认证。
- **修复方案**：
  1. 清理 `workspaces-and-vaults.mjs` 中的重复阴影路由。
  2. 在 `server.mjs` 补齐 `kimi-coding`、`zai`、`glm` 环境变量映射。
  3. 在 `bridge_runtime.py` 的 `_resolve_runtime` 中增加对 `cfg.providers` 自定义 Provider 的判定。
- **验证结果**：
  - 发起真实对话请求返回 `202 Accepted`。
  - 后端 Python 桥接成功调度 Kimi 模型，实时返回流式回答：`"Hi! 你好呀～ 很高兴见到你！ 😊"`。
  - 会话状态更新正常，控制台 0 报错。

---

## 2. 全量静态编译与语法检查审计

- **命令 1**：`npm run typecheck` (`tsc -b`)
  - **结果**：`0 errors`，全局类型严密对齐。
- **命令 2**：`npm run check:syntax`
  - **结果**：`node --check` 语法检查全部通过。
<!-- wjz新建文件结束。 -->
