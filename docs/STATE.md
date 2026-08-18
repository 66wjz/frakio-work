# 项目流程状态锁 (STATE.md)

> 本文档用于跟踪 Frakio Work 代码库解耦重构与二次开发准备的阶段进度与门禁状态。

---

## 总体进度

- **当前阶段**：全部阶段（阶段 0 ~ 阶段 4）已圆满达成
- **当前步骤**：全流程交付就绪
- **门禁状态**：前端巨石（1.8万行）与后端巨石（2.4万行）彻底完成领域解耦，通用基础组件与设计 Token 标准化完毕，二次开发文档完备，全局语法检查与类型检查 0 error，测试全绿。

---

## 阶段门禁总览

| 阶段 | 名称 | 目标 | 门禁标准 | 状态 |
| :--- | :--- | :--- | :--- | :--- |
| **阶段 0** | 基线锁定与流程初始化 | 建立状态锁、变更记录与自动化测试基线 | 723项测试全绿，类型检查通过 | **已完成** |
| **阶段 1** | 前端巨石拆解 (`main.tsx`) | 拆分 1.8 万行单文件至领域组件与 Hooks 状态机 | `main.tsx` 组件完全模块化，UI 交互无损，构建通过 | **已完成** |
| **阶段 2** | 后端入口解耦 (`server.mjs`) | 拆解 2.4 万行单文件至 Express Router 模块 | 语法检查无错，类型检查 0 error，单元测试通过 | **已完成** |
| **阶段 3** | 前端组件规范化与样式 Token | 封装 `components/common/` 基础组件并提取 CSS 变量 | 无裸用原生组件，样式变量统一，无 emoji 图标 | **已完成** |
| **阶段 4** | 二开就绪与全链路验证 | 产出二开文档，完成全链路冒烟验收 | 冒烟测试全通过，二开接入指南完备 | **已完成** |

---

## 子步骤执行日志

- [x] **0.1 建立流程状态与变更审计日志**（`docs/STATE.md`, `docs/变更记录.md`）
- [x] **0.2 运行基线语法与类型检查**（`npm run typecheck`）
- [x] **1.1 抽离前端业务纯函数与 API 客户端**（`apps/web/src/utils/`）
- [x] **1.2 抽离前端设置、模型中心与主题模块**（`apps/web/src/components/settings/`, `theme-helpers.ts`）
- [x] **1.3 抽离监控中心、协作决策、团队组织、个人中心与通用组件**（`apps/web/src/components/`）
- [x] **1.4 抽离右侧工作区、协作卡片流与运行动态时间线组件**（`apps/web/src/components/right-rail/`, `chat/RunActivityViews.tsx`, `collaboration/CollaborationCards.tsx`）
- [x] **1.5 抽离消息流视图、提及输入框、顶栏控制、导航组件与认证门禁**（`components/chat/`, `components/layout/`, `components/auth/`, `components/qa/`）
- [x] **1.6 彻底精简 `main.tsx` 组装入口**（所有子组件函数 100% 移出，仅保留 `App` 顶层装配）
- [x] **2.1 抽离认证、安全会话与附件/文件系统路由**（`apps/api/routes/auth-and-system.mjs`, `routes/filesystem-and-attachments.mjs`）
- [x] **2.2 抽离用户与 Hermes Profile/Modules/Bootstrap 路由**（`apps/api/routes/user-and-profiles.mjs`）
- [x] **2.3 抽离模型中心、Provider 与能力探测路由**（`apps/api/routes/models-and-providers.mjs`）
- [x] **2.4 抽离工作区、知识库 Vaults 与代码审阅路由**（`apps/api/routes/workspaces-and-vaults.mjs`）
- [x] **2.5 抽离会话、消息流推流与多 Agent 协作工作流路由**（`apps/api/routes/threads-and-chat.mjs`, `routes/collaboration-and-kanban.mjs`, `routes/agents.mjs`）
- [x] **2.6 精简 `server.mjs` 引导入口**
- [x] **3.1 封装 `components/common/` 通用输入框、按钮、Badge、Modal、Select、Tooltip 基础组件**
- [x] **3.2 提取全局样式 Token（CSS 变量）并消除硬编码与 Emoji 图标**
- [x] **4.1 编写二次开发与架构扩展文档**（`docs/二次开发指南.md`）
- [x] **4.2 全链路功能与冒烟回归测试**（语法检查无错，类型检查 0 error，测试全绿）
