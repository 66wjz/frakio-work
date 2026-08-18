<!-- wjz新建文件，新建原因：遵循 fullstack-dev-flow stage-2 标准规范编写 API 契约文档，修改时间：2026-08-18。 -->
# Frakio Work API 契约

> 创建时间：2026-08-18
> 状态：已确认
> 关联流程：fullstack-dev-flow stage-2
> 关联需求：[docs/需求规格.md](file:///e:/80-project_dev/16_frakio-work(waiting%20github%20update)/docs/需求规格.md)

---

## 一、通用约定

### 1.1 基础路径与鉴权
- **基础路径**：`/api`
- **鉴权方式**：Web 托管模式使用 Session Cookie 或 Header `X-Frakio-Request: 1`。

### 1.2 通用错误响应结构
```json
{
  "error": "错误说明信息",
  "code": 400
}
```

---

## 二、核心 API 清单

### 2.1 会话运行与推流 (`/api/threads`)

#### 1. 发起会话运行
- **路径**：`POST /api/threads/:threadId/runs`
- **入参**：
  ```json
  {
    "input": "用户输入的提示词",
    "agentId": "agent_abc",
    "attachments": []
  }
  ```
- **出参**：`202 Accepted`
  ```json
  {
    "runId": "run_123456",
    "threadId": "thread_abc",
    "status": "running"
  }
  ```

#### 2. SSE 流式实时推流
- **路径**：`GET /api/threads/:threadId/runs/:runId/stream`
- **响应格式**：`text/event-stream`
- **事件类型**：
  - `chunk`：打字机文本碎片
  - `tool_start` / `tool_end`：工具执行状态
  - `approval_required`：敏感操作中断审批

---

### 2.2 团队 Agent 管理 (`/api/agents`)

#### 1. 获取 Agent 列表
- **路径**：`GET /api/agents`
- **出参**：
  ```json
  {
    "agents": [
      {
        "id": "agent_main",
        "name": "Hermes Assistant",
        "role": "全能助理",
        "runtimeId": "hermes",
        "modelValue": "kimi-coding:kimi-latest",
        "color": "#0f766e"
      }
    ]
  }
  ```

#### 2. 保存 Agent 配置
- **路径**：`POST /api/agents`
- **入参**：包含 `id`, `name`, `role`, `runtimeId`, `modelValue`, `soul`, `avatarUrl` 等。

---

### 2.3 模型中心 (`/api/models`)

#### 1. 模型连通性测试
- **路径**：`POST /api/models/test`
- **入参**：
  ```json
  {
    "provider": "kimi-coding",
    "baseUrl": "https://api.moonshot.cn/v1",
    "apiKey": "sk-...",
    "model": "kimi-latest"
  }
  ```
- **出参**：
  ```json
  {
    "ok": true,
    "latencyMs": 342,
    "message": "Connection successful"
  }
  ```

---

## 三、需求 → API → 存储实体对应矩阵

| 需求功能点 | 涉及 API | 涉及存储结构 |
| :--- | :--- | :--- |
| **发送任务与多 Agent 协同** | `POST /api/threads/:id/runs`<br>`GET /api/threads/:id/runs/:runId/stream` | `state.threads[].runs` + Hermes SQLite |
| **敏感操作审批** | `POST /api/runs/:runId/approval` | `state.threads[].runs[].approval` |
| **Agent 配置与内核指派** | `GET /api/agents`<br>`POST /api/agents` | `state.agents[]` + `~/.hermes/profiles/` |
| **模型渠道与连通测速** | `GET /api/models`<br>`POST /api/models/test` | `state.models[]` + `server.mjs:providerEnvMap` |
| **资料库索引检索** | `GET /api/vaults`<br>`GET /api/vaults/:id/files` | 本地 Obsidian 目录与 Markdown 文件树 |
| **工作区主题定制** | `GET /api/workspaces`<br>`PUT /api/workspaces/:id` | `state.workspaces[]` |

---

## 四、变更记录

| 日期 | 变更内容 | 变更人 |
| :--- | :--- | :--- |
| 2026-08-18 | 基于 fullstack-dev-flow stage-2 规范初始建立 API 契约文档 | AI Lead + User |
<!-- wjz新建文件结束。 -->
