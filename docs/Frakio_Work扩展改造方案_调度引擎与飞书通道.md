# Frakio Work 通用能力扩展改造方案（定时调度引擎 + 飞书双向网关）

> **文档定位**：本方案为 `Frakio Work` 平台的通用后端能力扩展设计规范。聚焦于**通用平台级能力升级**，不硬编码绑定任何特定业务逻辑。
> 改造完成后，任何本地业务工作区（Workspace）均可通过标准配置，获得**后台定时触发自动化（Scheduler）**与**外部 IM 通道双向交互（Feishu Gateway）**两大核心能力。

---

## 一、 架构与设计原则

### 1.1 核心设计理念
1. **平台与业务彻底解耦**：平台（Frakio Work）只提供**调度、通信网关、会话与多 Agent 协同运行时**；业务工作区（Workspace）只提供**规则文档、数据文件、任务词与知识库**。
2. **插件化/非侵入式扩展**：所有新增能力以独立服务模块（Service / Plugin）形式注入到 `apps/api`，不污染原有的核心路由与协作状态机。
3. **主控-分派-收口模型（Supervisor-Worker Pattern）**：
   * 定时任务触发或外部通道输入统一路由给指定的**主控 Agent（Supervisor）**。
   * 主控 Agent 可自主分派任务给专业 Subagent，并在最终阶段进行审查、整合，将结果统一投递回指定通道。

---

## 二、 目录结构设计

在 `apps/api` 下新增两个独立的服务目录：`scheduler`（调度引擎）与 `channels`（外部通道网关）。

```
apps/api/
├── scheduler/                           # 【新增】定时调度服务
│   ├── scheduler-service.mjs            # 调度生命周期管理器（启动/停止/重载）
│   ├── job-runner.mjs                   # 任务运行器（组装 Prompt，触发内部 Agent 会话）
│   └── jobs.config.json                 # 定时任务配置文件（支持动态加载）
├── channels/                            # 【新增】外部通信通道
│   ├── channel-manager.mjs              # 多通道收发路由器
│   └── feishu/                          # 飞书通道适配器
│       ├── feishu-gateway.mjs           # 飞书 WebSocket 长连接客户端
│       ├── message-formatter.mjs        # 消息格式转换器（Markdown 与飞书富文本/卡片互相转换）
│       └── feishu.config.json           # 飞书应用鉴权配置
└── lib/                                 # 现有库文件
    └── ...
```

---

## 三、 模块一：通用定时调度引擎（Scheduler Engine）

### 3.1 核心职责
* 在指定时间（基于 Cron 表达式）触发指定工作区（Workspace）中的特定 Agent。
* 支持以“内联文本（inline）”或“文件路径（file）”加载任务 Prompt。
* 将执行结果通过 `channel-manager` 广播至指定外部通道（如飞书/Web）。

### 3.2 依赖引入
在 `apps/api/package.json` 中添加：
```json
{
  "dependencies": {
    "node-cron": "^3.0.3"
  }
}
```

### 3.3 核心实现代码

#### 1. 任务配置文件：`apps/api/scheduler/jobs.config.json`
```json
[
  {
    "id": "job-example-cron",
    "name": "示例定时分析任务",
    "enabled": true,
    "cron": "0 30 8 * * 1-5",
    "workspaceId": "default-workspace",
    "targetAgent": "hermes",
    "promptType": "file",
    "promptPath": "prompts/daily_task.md",
    "channelNotify": ["feishu"]
  }
]
```

#### 2. 任务执行器：`apps/api/scheduler/job-runner.mjs`
```javascript
import fs from 'node:fs/promises';
import path from 'node:path';

export class JobRunner {
  constructor({ collaborationService, workspaceManager, channelManager }) {
    this.collaborationService = collaborationService;
    this.workspaceManager = workspaceManager;
    this.channelManager = channelManager;
  }

  async executeJob(jobConfig) {
    console.log(`[Scheduler] Executing job: ${jobConfig.name} (${jobConfig.id})`);
    
    try {
      // 1. 获取对应工作区根路径
      const workspace = await this.workspaceManager.getWorkspace(jobConfig.workspaceId);
      if (!workspace) {
        throw new Error(`Workspace not found: ${jobConfig.workspaceId}`);
      }

      // 2. 组装 Prompt 内容
      let promptContent = '';
      if (jobConfig.promptType === 'file') {
        const fullPath = path.isAbsolute(jobConfig.promptPath)
          ? jobConfig.promptPath
          : path.join(workspace.path, jobConfig.promptPath);
        promptContent = await fs.readFile(fullPath, 'utf-8');
      } else {
        promptContent = jobConfig.promptContent || '';
      }

      // 3. 构造注入消息，触发 Agent 会话 Run
      const runContext = {
        workspaceId: jobConfig.workspaceId,
        source: 'scheduler',
        jobId: jobConfig.id,
        targetAgent: jobConfig.targetAgent || 'hermes'
      };

      const result = await this.collaborationService.dispatchTriggerRun({
        workspaceId: jobConfig.workspaceId,
        agentId: jobConfig.targetAgent,
        content: promptContent,
        metadata: runContext
      });

      // 4. 将产出结果推送到指定通道
      if (jobConfig.channelNotify && jobConfig.channelNotify.length > 0) {
        for (const channelName of jobConfig.channelNotify) {
          await this.channelManager.sendMessage(channelName, {
            title: `【定时任务通知 · ${jobConfig.name}】`,
            content: result.outputContent || result.summary || '任务已执行完毕。',
            workspaceId: jobConfig.workspaceId,
            metadata: runContext
          });
        }
      }

      console.log(`[Scheduler] Job completed successfully: ${jobConfig.id}`);
    } catch (error) {
      console.error(`[Scheduler] Job failed: ${jobConfig.id}`, error);
    }
  }
}
```

#### 3. 调度管理器：`apps/api/scheduler/scheduler-service.mjs`
```javascript
import cron from 'node-cron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { JobRunner } from './job-runner.mjs';

export class SchedulerService {
  constructor(deps) {
    this.deps = deps;
    this.runner = new JobRunner(deps);
    this.scheduledTasks = new Map();
    this.configPath = path.join(process.cwd(), 'apps/api/scheduler/jobs.config.json');
  }

  async start() {
    console.log('[SchedulerService] Starting scheduler service...');
    await this.reload();
  }

  async reload() {
    // 停止现有任务
    for (const [id, task] of this.scheduledTasks.entries()) {
      task.stop();
      this.scheduledTasks.delete(id);
    }

    // 读取配置并注册
    try {
      const rawData = await fs.readFile(this.configPath, 'utf-8');
      const jobs = JSON.parse(rawData);

      for (const job of jobs) {
        if (!job.enabled) continue;

        if (!cron.validate(job.cron)) {
          console.warn(`[SchedulerService] Invalid cron format for job ${job.id}: ${job.cron}`);
          continue;
        }

        const task = cron.schedule(job.cron, async () => {
          await this.runner.executeJob(job);
        });

        this.scheduledTasks.set(job.id, task);
        console.log(`[SchedulerService] Registered job [${job.name}] with cron: ${job.cron}`);
      }
    } catch (err) {
      console.error('[SchedulerService] Failed to load jobs configuration:', err);
    }
  }

  stop() {
    for (const task of this.scheduledTasks.values()) {
      task.stop();
    }
    this.scheduledTasks.clear();
    console.log('[SchedulerService] Scheduler service stopped.');
  }
}
```

---

## 四、 模块二：飞书双向长连接网关（Feishu Gateway）

### 4.1 核心职责
* **免公网 IP / 免域名 / 免穿透**：基于 WebSocket 长连接实时监听飞书消息事件。
* **双向闭环**：
  1. 手机端在飞书发消息 -> 网关收到 -> 注入 Frakio 会话流 -> Agent 执行。
  2. Agent 处理完成 -> 网关收到响应事件 -> 推送富文本/Markdown 消息至飞书。

### 4.2 依赖引入
在 `apps/api/package.json` 中添加：
```json
{
  "dependencies": {
    "@larksuiteoapi/node-sdk": "^1.40.0"
  }
}
```

### 4.3 核心实现代码

#### 1. 飞书网关实现：`apps/api/channels/feishu/feishu-gateway.mjs`
```javascript
import * as Lark from '@larksuiteoapi/node-sdk';

export class FeishuGateway {
  constructor({ appId, appSecret, collaborationService, channelManager }) {
    this.appId = appId || process.env.FEISHU_APP_ID;
    this.appSecret = appSecret || process.env.FEISHU_APP_SECRET;
    this.collaborationService = collaborationService;
    this.channelManager = channelManager;
    this.client = null;
    this.wsClient = null;
  }

  async start() {
    if (!this.appId || !this.appSecret) {
      console.warn('[FeishuGateway] Missing FEISHU_APP_ID or FEISHU_APP_SECRET, gateway skipped.');
      return;
    }

    this.client = new Lark.Client({
      appId: this.appId,
      appSecret: this.appSecret,
      appType: Lark.AppType.SelfBuild,
      domain: Lark.Domain.Feishu,
    });

    // 建立 WebSocket 长连接监听
    this.wsClient = new Lark.WSClient({
      appId: this.appId,
      appSecret: this.appSecret,
      loggerLevel: Lark.LoggerLevel.info,
    });

    // 注册消息接收处理器
    const eventDispatcher = new Lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data) => {
        await this.handleIncomingMessage(data);
      },
    });

    await this.wsClient.start({ eventDispatcher });
    console.log('[FeishuGateway] WebSocket connected successfully.');
  }

  async handleIncomingMessage(data) {
    try {
      const message = data.message;
      if (!message || message.message_type !== 'text') return;

      const parsedContent = JSON.parse(message.content);
      const text = parsedContent.text?.trim();
      const senderId = data.sender?.sender_id?.open_id;

      console.log(`[FeishuGateway] Received message from ${senderId}: ${text}`);

      // 转发给协作服务处理 (将消息注入 Agent)
      const agentResponse = await this.collaborationService.handleExternalUserMessage({
        source: 'feishu',
        senderId,
        content: text,
      });

      // 回复飞书用户
      if (agentResponse && agentResponse.content) {
        await this.sendDirectMessage(senderId, agentResponse.content);
      }
    } catch (err) {
      console.error('[FeishuGateway] Error processing incoming message:', err);
    }
  }

  async sendDirectMessage(openId, textContent, title = '') {
    try {
      const contentPayload = title 
        ? `**${title}**\n\n${textContent}` 
        : textContent;

      await this.client.im.message.create({
        params: { receive_id_type: 'open_id' },
        data: {
          receive_id: openId,
          msg_type: 'text',
          content: JSON.stringify({ text: contentPayload }),
        },
      });
      console.log(`[FeishuGateway] Pushed message to user ${openId}`);
    } catch (err) {
      console.error('[FeishuGateway] Failed to send message to Feishu:', err);
    }
  }
}
```

#### 2. 通道管理器：`apps/api/channels/channel-manager.mjs`
```javascript
export class ChannelManager {
  constructor() {
    this.channels = new Map();
  }

  registerChannel(name, channelInstance) {
    this.channels.set(name, channelInstance);
    console.log(`[ChannelManager] Registered channel: ${name}`);
  }

  async sendMessage(channelName, payload) {
    const channel = this.channels.get(channelName);
    if (!channel) {
      console.warn(`[ChannelManager] Channel not found: ${channelName}`);
      return;
    }

    if (channelName === 'feishu') {
      // 从环境变量或配置读取绑定的默认接收人 OpenID
      const targetUser = process.env.FEISHU_TARGET_OPEN_ID;
      if (targetUser) {
        await channel.sendDirectMessage(targetUser, payload.content, payload.title);
      }
    }
  }
}
```

---

## 五、 主服务启动挂载集成

在 `apps/api/server.mjs`（或应用初始化入口处）注入这两个常驻服务：

```javascript
// ==================== 调度与通道服务初始化 ====================
import { SchedulerService } from './scheduler/scheduler-service.mjs';
import { ChannelManager } from './channels/channel-manager.mjs';
import { FeishuGateway } from './channels/feishu/feishu-gateway.mjs';

// 1. 初始化通道管理器
const channelManager = new ChannelManager();

// 2. 初始化飞书网关
const feishuGateway = new FeishuGateway({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  collaborationService, // 传入核心协作服务
  channelManager,
});
await feishuGateway.start();
channelManager.registerChannel('feishu', feishuGateway);

// 3. 初始化调度服务
const schedulerService = new SchedulerService({
  collaborationService,
  workspaceManager,
  channelManager,
});
await schedulerService.start();
// =============================================================
```

---

## 六、 实施与测试验证清单

1. **环境配置（`.env`）**：
   ```env
   FEISHU_APP_ID=cli_xxxxxxxxxxxx
   FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxx
   FEISHU_TARGET_OPEN_ID=ou_xxxxxxxxxxxx
   ```
2. **步骤验证**：
   * **Step 1（通道打通）**：启动 `apps/api`，检查控制台输出 `[FeishuGateway] WebSocket connected successfully.`。在飞书向机器人发一句“测试”，看是否能够收到回复。
   * **Step 2（调度测试）**：在 `jobs.config.json` 中配置一个 1 分钟后触发的 Cron 任务，验证定时触发后是否能自动将 Agent 输出推送到飞书。
   * **Step 3（工作区挂载）**：在 Frakio UI 中创建工作区，指向目标文件夹，配置任务词路径，验证完整自动化。
