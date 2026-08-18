<!-- wjz新建文件，新建原因：建立 .devflow 经验总结与踩坑知识库，修改时间：2026-08-18。 -->
# Frakio Work 核心经验与踩坑知识库 (.devflow/experience/README.md)

> 本文档沉淀在 Frakio Work 架构治理、多内核调度、模型桥接与组件化过程中总结的高价值实战经验。

---

## 1. 架构与多内核隔离经验

1. **多内核沙箱隔离原则**：
   - Hermes 内核必须基于 `~/.hermes/profiles/<profile-name>/` 创建独立 Profile，禁止共用同一个 `config.yaml` 或 SQLite 数据库。
   - Pi / Codex / Claude Code 内核必须重定向 Home 路径到 `~/.frakio-work/runtime/homes/` 内部，避免污染用户电脑全局环境。
2. **Express 路由挂载顺序与阴影拦截 (Shadowing)**：
   - 避免在不同子路由文件中定义相同的父级路径，否则先匹配的 Router 会阻断后续合法请求导致 500/404。
   - 重构拆分 Router 时，路由工厂函数必须显式注入全部共享状态（`workspaces`, `threads`, `agents`, `stateFile`），保证单向依赖与解耦。

---

## 2. 模型桥接与 Provider 扩展经验

1. **Python Bridge 自定义 Provider 兼容性**：
   - Hermes 底层 Python Bridge（`bridge_runtime.py`）在 `_resolve_runtime` 时，不仅要检查内置的 `anthropic`、`openai`、`google`，还必须检查 `cfg.providers` 字典中的自定义 Provider（如 `kimi-coding`, `zai`, `glm`, `deepseek` 等），否则会错误回退到 Anthropic 导致 400 失败。
2. **Provider 环境变量映射**：
   - 任何新增模型提供商，必须同步在 `apps/api/server.mjs` 中的 `providerEnvMap` 注册对应的环境变量映射（如 `KIMI_API_KEY`, `GLM_API_KEY` 等），确保子进程可注入凭据。

---

## 3. 前端组件化与 Design Token 规范

1. **图标统一收拢至 BaseIcon**：
   - 禁止在业务页面中零散 `import` 几十个 `lucide-react` 图标或手写内联 SVG。统一使用 `<BaseIcon name="..." size={16} />`。
2. **控件高度像素级对齐**：
   - 同一行并排出现的 Input / Select / Button 必须严格绑定 `--control-height-md` (34px) 或对应尺寸变量，消除内边距差异导致的高低错位。
3. **全局层级防穿透**：
   - 弹窗必须使用 `--z-modal` (2000)，Tooltip 必须使用 `--z-tooltip` (3000)，Toast 必须使用 `--z-toast` (9999)，彻底消除魔法数字冲突。
<!-- wjz新建文件结束。 -->
