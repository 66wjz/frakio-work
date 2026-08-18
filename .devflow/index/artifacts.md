<!-- wjz新建文件，新建原因：建立 .devflow 项目产出物索引清单 artifacts.md，修改时间：2026-08-18。 -->
# Frakio Work 项目产出物索引清单 (.devflow/index/artifacts.md)

> 所有阶段的技术规范、架构设计、组件手册与核心产物均在此登记。门禁审计时核对本清单。

---

## 1. 核心架构与二次开发文档

| 产出物名称 | 文件路径 | 状态 | 创建/归档时间 | 核心说明 |
| :--- | :--- | :--- | :--- | :--- |
| **二次开发指南** | [`docs/二次开发指南.md`](file:///e:/80-project_dev/16_frakio-work(waiting%20github%20update)/docs/二次开发指南.md) | `approved` | 2026-08-17 | 包含前后端领域解耦结构、路由挂载规范、常用工具函数与接入范式。 |
| **上游同步与二开管理指南** | [`docs/上游同步与二开版本管理指南.md`](file:///e:/80-project_dev/16_frakio-work(waiting%20github%20update)/docs/上游同步与二开版本管理指南.md) | `approved` | 2026-08-18 | 包含 Fork + Upstream 双源模型、原作者发版同步 3 步法与多内核沙箱隔离深度剖析。 |
| **前端设计规范与 Token 手册** | [`docs/前端设计规范与Token体系手册.md`](file:///e:/80-project_dev/16_frakio-work(waiting%20github%20update)/docs/前端设计规范与Token体系手册.md) | `approved` | 2026-08-18 | 规范 `--control-height-*`、`--control-radius-*`、`--z-*` 层级规范与禁止硬编码准则。 |
| **基础组件库使用指南** | [`apps/web/src/components/BASE_COMPONENTS_GUIDE.md`](file:///e:/80-project_dev/16_frakio-work(waiting%20github%20update)/apps/web/src/components/BASE_COMPONENTS_GUIDE.md) | `approved` | 2026-08-18 | 15 个 Base 原子组件与 6 个 Composite 复合组件的 Props 表、设计 Token 与代码范式。 |
| **扩展改造方案（调度引擎与飞书）** | [`docs/Frakio_Work扩展改造方案_调度引擎与飞书通道.md`](file:///e:/80-project_dev/16_frakio-work(waiting%20github%20update)/docs/Frakio_Work扩展改造方案_调度引擎与飞书通道.md) | `approved` | 2026-08-17 | 规划后续多 Agent 调度编排引擎、DAG 流水线与飞书 Bot 群聊打通方案。 |
| **变更审计记录** | [`docs/变更记录.md`](file:///e:/80-project_dev/16_frakio-work(waiting%20github%20update)/docs/变更记录.md) | `approved` | 2026-08-17 | 记录全阶段的代码重构、修复与功能演进审计日志。 |

---

## 2. 源代码工程产物

| 产出物类别 | 目录路径 | 状态 | 核心说明 |
| :--- | :--- | :--- | :--- |
| **前端 Base 组件库** | `apps/web/src/components/base/` | `approved` | 15 个原子组件：BaseButton, BaseInput, BaseSelect, BaseBadge, BaseCard, BaseModal, BaseTooltip, BaseIcon 等。 |
| **前端 Composite 组件库** | `apps/web/src/components/composite/` | `approved` | 6 个复合组件：BaseTabs, BaseSection, BaseToolbar, BaseSearchForm, BasePagination, BaseSettingsLayout。 |
| **前端解耦领域模块** | `apps/web/src/components/{chat,layout,settings,right-rail,collaboration,auth,qa}/` | `approved` | 解耦自 1.8 万行 `main.tsx` 的 8 大领域模块。 |
| **后端解耦领域路由** | `apps/api/routes/*.mjs` | `approved` | 解耦自 2.4 万行 `server.mjs` 的 8 大 Express Router 工厂。 |
<!-- wjz新建文件结束。 -->
