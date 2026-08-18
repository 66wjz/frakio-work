<!-- wjz新建文件，新建原因：全面登记基于 fullstack-dev-flow 生成的标准设计文档矩阵，修改时间：2026-08-18。 -->
# Frakio Work 项目产出物索引清单 (.devflow/index/artifacts.md)

> 所有阶段的技术规范、架构设计、组件手册与核心产物均在此登记。门禁审计时核对本清单。

---

## 1. 核心架构与全量设计文档矩阵

| 阶段 | 产出物名称 | 文件路径 | 状态 | 核心说明 |
| :--- | :--- | :--- | :--- | :--- |
| **stage-1** | 需求规格文档 | [`docs/需求规格.md`](file:///e:/80-project_dev/16_frakio-work(waiting%20github%20update)/docs/需求规格.md) | `approved` | 多 Agent 协同、双内核生活/编码定位与用户故事。 |
| **stage-1** | 面向客户的功能清单 | [`docs/面向客户的功能清单.md`](file:///e:/80-project_dev/16_frakio-work(waiting%20github%20update)/docs/面向客户的功能清单.md) | `approved` | 纯文本端功能定义 + 演示验证清单（带 ▲ 核心链路）。 |
| **stage-2** | 架构设计文档 | [`docs/架构设计.md`](file:///e:/80-project_dev/16_frakio-work(waiting%20github%20update)/docs/架构设计.md) | `approved` | 分层架构图、前后端目录、Router 工厂与设计决策。 |
| **stage-2** | 系统核心流程文档 | [`docs/系统核心流程.md`](file:///e:/80-project_dev/16_frakio-work(waiting%20github%20update)/docs/系统核心流程.md) | `approved` | 多 Agent 协作时序图、审批决策链与对外能力清单。 |
| **stage-2** | API 契约文档 | [`docs/API契约.md`](file:///e:/80-project_dev/16_frakio-work(waiting%20github%20update)/docs/API契约.md) | `approved` | REST API / SSE 契约与 需求→API→实体 对应矩阵。 |
| **stage-2** | 数据库与存储设计 | [`docs/数据库设计.md`](file:///e:/80-project_dev/16_frakio-work(waiting%20github%20update)/docs/数据库设计.md) | `approved` | State JSON 状态模型 + Hermes Profile SQLite 数据表。 |
| **stage-2** | 前端设计规范与 Token 手册 | [`docs/前端设计规范与Token体系手册.md`](file:///e:/80-project_dev/16_frakio-work(waiting%20github%20update)/docs/前端设计规范与Token体系手册.md) | `approved` | 统一控件高度（28px/34px/42px）与全局 Z-Index 体系。 |
| **stage-2** | 基础组件库使用指南 | [`apps/web/src/components/BASE_COMPONENTS_GUIDE.md`](file:///e:/80-project_dev/16_frakio-work(waiting%20github%20update)/apps/web/src/components/BASE_COMPONENTS_GUIDE.md) | `approved` | 15 个 Base 原子组件与 6 个 Composite 复合组件手册。 |
| **stage-2** | 二次开发指南 | [`docs/二次开发指南.md`](file:///e:/80-project_dev/16_frakio-work(waiting%20github%20update)/docs/二次开发指南.md) | `approved` | 领域 Router 解耦与前后端二开扩展实战手册。 |
| **stage-2** | 上游同步与二开管理指南 | [`docs/上游同步与二开版本管理指南.md`](file:///e:/80-project_dev/16_frakio-work(waiting%20github%20update)/docs/上游同步与二开版本管理指南.md) | `approved` | Fork + Upstream 双源模型与沙箱隔离原理。 |
| **stage-3** | 后端接口文档 | [`docs/接口文档.md`](file:///e:/80-project_dev/16_frakio-work(waiting%20github%20update)/docs/接口文档.md) | `approved` | 后端 Express 领域 Router 详细接口参数与说明。 |
| **stage-5** | 联调与集成记录 | [`.devflow/integration-log.md`](file:///e:/80-project_dev/16_frakio-work(waiting%20github%20update)/.devflow/integration-log.md) | `approved` | 500 修复与 Kimi 真机对话调通测试记录。 |
| **stage-6** | 功能完成情况矩阵 | [`docs/功能完成情况.md`](file:///e:/80-project_dev/16_frakio-work(waiting%20github%20update)/docs/功能完成情况.md) | `approved` | 基线功能完成度与验证方式对照表。 |
| **stage-6** | 测试手册 | [`docs/测试手册.md`](file:///e:/80-project_dev/16_frakio-work(waiting%20github%20update)/docs/测试手册.md) | `approved` | 自动化测试门禁与端到端真机冒烟用例。 |
| **stage-6** | 部署手册 | [`docs/部署手册.md`](file:///e:/80-project_dev/16_frakio-work(waiting%20github%20update)/docs/部署手册.md) | `approved` | 源码启动、Docker 容器化与数据隔离说明。 |

---

## 2. 规划、归档与设计稿索引

| 类别 | 目录路径 | 索引文件 | 说明 |
| :--- | :--- | :--- | :--- |
| **设计稿与原型** | `docs/designs/` | [`docs/designs/README.md`](file:///e:/80-project_dev/16_frakio-work(waiting%20github%20update)/docs/designs/README.md) | 存放 UI 交互设计草案与原型索引。 |
| **历史归档** | `docs/archived/` | [`docs/archived/README.md`](file:///e:/80-project_dev/16_frakio-work(waiting%20github%20update)/docs/archived/README.md) | 存放已被标准文档吸收取代的历史草案。 |
| **B 线设计变更** | `docs/_changes/` | [`docs/_changes/README.md`](file:///e:/80-project_dev/16_frakio-work(waiting%20github%20update)/docs/_changes/README.md) | 承接体验走查与维护迭代下的设计变更临时台账。 |
<!-- wjz新建文件结束。 -->
