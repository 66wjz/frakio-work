import cors from 'cors';
import express from 'express';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { access, appendFile, cp, lstat, mkdir, readlink, readdir, readFile, rename, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { createTelemetryClient } from './telemetry.mjs';
import { appUpdateStatus } from './lib/app-update.mjs';
import { resolveAppVersion } from './lib/app-version.mjs';
import { createAttachmentStore, MAX_ATTACHMENT_BYTES } from './lib/attachment-store.mjs';
import { createSerialJsonWriter, readJsonWithRecovery } from './lib/atomic-json-store.mjs';
import { probeResponsesCapabilities } from './lib/capability-probe.mjs';
import { createLocalSecurity } from './lib/local-security.mjs';
import { createManagedWebAuth } from './lib/managed-web-auth.mjs';
import { acquireManagedServiceLock, FRAKIO_SERVICE_PROTOCOL, removeServiceDescriptor, writeServiceDescriptor } from './lib/service-discovery.mjs';
import { isSystemHermesProfile, resolveDeletableHermesProfileDir, userVisibleHermesProfiles } from './lib/hermes-profile-safety.mjs';
import { isOfficialHermesReleaseTag, parseOfficialHermesReleaseTags } from './lib/hermes-runtime-releases.mjs';
import { resolveInsideRoot } from './lib/path-boundary.mjs';
import { resolveCommand as resolvePlatformCommand, runtimeNodeCandidate, runtimePlatformDir, runtimePythonCandidates, runtimePythonSitePackagesCandidates } from './lib/platform.mjs';
import { capabilitiesForModels, mapRunSettings, normalizeCapabilityOverrides, resolveModelCapability } from './lib/model-capabilities.mjs';
import { createModelRunDiagnostic, finishModelRunDiagnostic, markModelRunSent } from './lib/model-run-diagnostics.mjs';
import { isMentionNamePresent, mentionDepthAllows, normalizeAgentMentionMaxDepth, registerMentionEdge, resolveMentionedAgents, stripMentionRoutingTokens } from './lib/mention-routing.mjs';
import {
  CHAT_THINKING_FORMATS,
  candidateModelUrls,
  candidateProviderBaseUrls,
  directHttpRequestOverrides,
  isAnthropicLikeBaseUrl,
  normalizeProviderBaseUrl,
  providerInferenceUrl,
} from './lib/provider-adapters.mjs';
import { catalogStatus, flattenProviderCatalog, parseCatalogResponse, parseModelIds, readCatalogCache, recordActiveProbeCapability, recordCatalogError, updateProviderCatalog, verificationKey, writeCatalogCache } from './lib/model-catalog-store.mjs';
import { extractChatGptAccountId, fetchCodexOAuthCatalog } from './lib/oauth-provider-catalog.mjs';
import { runtimeStep, summarizeRuntimeAutoStart } from './lib/runtime-autostart.mjs';
import { appendCollaborationEvent, boardLifecycle, collaborationEventsAfter, diffCollaborationPlans, normalizeThreadCollaboration, taskStatusEvent, validateCollaborationPlan } from './lib/collaboration.mjs';
import { applyRunActivityToTranscript, normalizeRunActivityItem, normalizeRunTranscripts, summarizeActivityItems, upsertRunTranscript } from './lib/run-activity.mjs';
import { migrateSpaceTheme, SPACE_THEME_RENDER_VERSION } from './lib/space-theme.mjs';
import { normalizeWorkbenchSidebarPatch, normalizeWorkbenchSidebarSettings } from './lib/sidebar-width.mjs';
import { resolveRichPreviewFile } from './lib/rich-preview.mjs';
import { normalizeRepairedOutput, richContentRepairPrompt, validateRichContentOutput } from './lib/rich-content-output.mjs';
import { sanitizeGeneratedTitle, titleGenerationTranscript } from './lib/title-generation.mjs';
import {
  activePlanSession,
  autoResolvePlanQuestionBatch,
  cancelPlanQuestionBatch,
  cancelPlanSession,
  createPlanQuestionBatch,
  createPlanSession,
  latestPlanDraft,
  normalizeThreadPlans,
  publicPlanSession,
  resolvePlanQuestionBatch,
  submitPlanDraft,
} from './lib/plan-mode.mjs';
import { createRuntimeStore } from './runtime/store.mjs';
import { createRuntimeRegistry, normalizeRuntimePolicy, runtimeForAgent } from './runtime/registry.mjs';
import { modelNames as runtimeModelNames, modelSelectionValue, resolveModelSelection, resolveModelSelectionByPrecedence, splitModelSelection } from './runtime/model-selection.mjs';
import { createPiBridge } from './runtime/pi-bridge.mjs';
import { createCodexAppServerBridge } from './runtime/codex-app-server.mjs';
import { createClaudeAgentSdkBridge } from './runtime/claude-agent-sdk.mjs';
import { createGeminiAcpBridge } from './runtime/gemini-acp.mjs';
import { createWorkScheduler } from './runtime/work-scheduler.mjs';
import { createWorktreeManager } from './runtime/worktree-manager.mjs';
import { createKnowledgeGateway } from './knowledge/gateway.mjs';
import { createMemoryLedger } from './memory/ledger.mjs';

const app = express();
const port = Number(process.env.PORT || 8787);
const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const homeDir = os.homedir();
const frakioWorkHome = process.env.FRAKIO_WORK_HOME || path.join(homeDir, '.frakio-work');
const isDesktopMode = process.env.FRAKIO_WORK_DESKTOP === '1';
const isManagedWebMode = process.env.FRAKIO_WORK_DEPLOYMENT_MODE === 'managed-web';
const tlsCertPath = String(process.env.FRAKIO_WORK_TLS_CERT || '').trim();
const tlsKeyPath = String(process.env.FRAKIO_WORK_TLS_KEY || '').trim();
const tlsEnabled = Boolean(tlsCertPath && tlsKeyPath);
const appRoot = process.env.FRAKIO_WORK_APP_ROOT || projectRoot;
const statePath = process.env.FRAKIO_WORK_STATE_PATH || path.join(frakioWorkHome, 'data/workbench-state.json');
const secretsPath = process.env.FRAKIO_WORK_SECRETS_PATH || path.join(frakioWorkHome, 'data/model-secrets.json');
const telemetryPath = process.env.FRAKIO_WORK_TELEMETRY_PATH || path.join(frakioWorkHome, 'data/telemetry.json');
const modelCatalogCachePath = process.env.FRAKIO_WORK_MODEL_CATALOG_PATH || path.join(frakioWorkHome, 'data/model-catalog-cache.json');
const runtimeDatabasePath = process.env.FRAKIO_WORK_RUNTIME_DB_PATH || path.join(frakioWorkHome, 'data/frakio.db');
const defaultProjectsRoot = process.env.FRAKIO_WORK_PROJECTS_ROOT || path.join(frakioWorkHome, 'projects');
const serverDirectoryRoot = process.env.FRAKIO_WORK_PROJECTS_ROOT || homeDir;
const webDistPath = process.env.FRAKIO_WORK_WEB_DIST || path.join(appRoot, 'dist');
const hermesWebUiHome = String(process.env.HERMES_WEB_UI_HOME || '').trim();
const hermesHome = process.env.HERMES_HOME || path.join(homeDir, '.hermes');
const hermesWorkbenchApiHome = process.env.HERMES_WORKBENCH_API_HOME || path.join(frakioWorkHome, 'api-home');
const hermesWorkbenchRuntimeHome = process.env.HERMES_WORKBENCH_RUNTIME_HOME || path.join(frakioWorkHome, 'runtime');
const frakioBundledRuntimeHome = process.env.FRAKIO_WORK_RUNTIME_HOME || path.join(appRoot, 'runtime');
const frakioBundledHermesRuntimeRoot = path.join(frakioBundledRuntimeHome, 'hermes');
const frakioBundledBridgeRoot = path.join(frakioBundledRuntimeHome, 'agent-bridge', 'python');
const frakioManagedHermesRuntimeRoot = path.join(frakioWorkHome, 'runtimes', 'hermes');
const frakioRuntimeStagingRoot = path.join(frakioWorkHome, 'runtimes', '.staging');
const frakioRuntimeRegistryPath = path.join(frakioWorkHome, 'runtime', 'runtime-registry.json');
const sharedHermesModulesRoot = path.join(frakioWorkHome, 'shared');
const sharedHermesSkillsRoot = path.join(sharedHermesModulesRoot, 'skills');
const sharedHermesPluginsRoot = path.join(sharedHermesModulesRoot, 'plugins');
const hermesModuleProvenancePath = path.join(frakioWorkHome, 'module-provenance.json');
const hermesModuleArchiveRoot = path.join(frakioWorkHome, 'archive', 'modules');
const hermesAgentSourcePath = process.env.HERMES_AGENT_SOURCE || path.join(frakioWorkHome, 'sources', 'hermes-agent');
const hermesAgentBackupRoot = path.join(frakioWorkHome, 'backups', 'hermes-agent');
const attachmentRoot = path.join(frakioWorkHome, 'attachments');
const officialHermesAgentRepo = 'https://github.com/NousResearch/hermes-agent.git';
const frakioBridgeProtocolVersion = 3;
const workbenchCollaborationProtocolVersion = 3;
const requiredWorkbenchCollaborationTools = [
  'hermes_workbench_protocol_get',
  'hermes_workbench_plan_user_input_request',
  'hermes_workbench_plan_submit',
  'hermes_workbench_collaboration_plan_get',
  'hermes_workbench_collaboration_plan_publish',
  'hermes_workbench_collaboration_dependency_request',
  'hermes_workbench_collaboration_blocker_report',
  'hermes_workbench_collaboration_artifact_publish',
  'hermes_workbench_collaboration_task_complete',
];
const requiredWorkbenchPlanTools = [
  'hermes_workbench_protocol_get',
  'hermes_workbench_plan_user_input_request',
  'hermes_workbench_plan_submit',
];
const requiredAiohttpVersion = '3.14.1';
const requiredMcpVersion = '1.26.0';
const requiredStarletteVersion = '1.0.1';
const requiredDdgsVersion = '9.14.4';
const hermesDbPath = hermesWebUiHome ? path.join(hermesWebUiHome, 'hermes-web-ui.db') : '';
const telemetry = createTelemetryClient({
  filePath: telemetryPath,
  host: process.env.FRAKIO_WORK_UMAMI_HOST || 'https://data.madsgogo.com',
  websiteId: process.env.FRAKIO_WORK_UMAMI_WEBSITE_ID || '3fbceeb0-dffe-459c-9e5f-c6dff0c71708',
  hostname: 'com.frakio.work',
  runtimeEnabled: process.env.FRAKIO_WORK_PACKAGED === '1' || process.env.FRAKIO_WORK_TELEMETRY_FORCE === '1',
});
const writeStateJson = createSerialJsonWriter(statePath, { mode: 0o600 });
const writeSecretsJson = createSerialJsonWriter(secretsPath, { mode: 0o600 });
const attachmentStore = createAttachmentStore(attachmentRoot);
const modelCatalogCache = readCatalogCache(modelCatalogCachePath);
const runtimeStore = createRuntimeStore(runtimeDatabasePath);
const knowledgeGateway = createKnowledgeGateway({ store: runtimeStore });
const memoryLedger = createMemoryLedger({ store: runtimeStore });
const workScheduler = createWorkScheduler({ store: runtimeStore });
const worktreeManager = createWorktreeManager({
  root: path.join(frakioWorkHome, 'worktrees'),
  execFile: execFileAsync,
});
const runtimeRegistry = createRuntimeRegistry({
  resolveCommand: resolveRuntimeCommand,
  execFile: execFileAsync,
  piVersion: '0.83.0',
  hermesStatus: hermesRuntimeStatus,
});
const piBridge = createPiBridge({
  env: { FRAKIO_WORK_HOME: frakioWorkHome },
  toolHandler: handlePiToolRequest,
  credentialHandler: handlePiCredentialRequest,
});
const codexBridge = createCodexAppServerBridge({
  commandResolver: resolveRuntimeCommand,
});
const claudeBridge = createClaudeAgentSdkBridge({
  commandResolver: resolveRuntimeCommand,
});
const geminiBridge = createGeminiAcpBridge({
  commandResolver: resolveRuntimeCommand,
});
void attachmentStore.cleanupOrphans().catch(() => {});
let hermesApiProcess = null;
let hermesBridgeProcess = null;
const profileGatewayProcesses = new Set();
const agentDeletionPromises = new Map();
let hermesBridgeLastError = '';
const apiStartedAtMs = Date.now();
let hermesAutoStartPromise = null;
let hermesAutoStartState = {
  status: 'idle',
  startedAt: null,
  finishedAt: null,
  steps: [],
  logs: [],
  error: '',
  warnings: [],
};
let pendingHermes019UpgradeRollback = null;
const hermesBootstrapInstallSteps = [
  { id: 'verify-runtime', label: '验证内置运行环境' },
  { id: 'write-config', label: '初始化 Hermes 配置' },
  { id: 'start-runtime', label: '启动 Hermes Runtime' },
  { id: 'detect', label: '验证本地连接' },
];
let hermesBootstrapInstallJob = null;
const hermesBootstrapInstallListeners = new Set();
const providerEnvMap = {
  openai: { apiKey: 'OPENAI_API_KEY', baseUrl: 'OPENAI_BASE_URL' },
  anthropic: { apiKey: 'ANTHROPIC_API_KEY', baseUrl: 'ANTHROPIC_BASE_URL' },
  deepseek: { apiKey: 'DEEPSEEK_API_KEY', baseUrl: 'DEEPSEEK_BASE_URL' },
  openrouter: { apiKey: 'OPENROUTER_API_KEY', baseUrl: 'OPENROUTER_BASE_URL' },
  groq: { apiKey: 'GROQ_API_KEY', baseUrl: 'GROQ_BASE_URL' },
  gemini: { apiKey: 'GEMINI_API_KEY', baseUrl: 'GEMINI_BASE_URL' },
  moonshot: { apiKey: 'MOONSHOT_API_KEY', baseUrl: 'MOONSHOT_BASE_URL' },
  siliconflow: { apiKey: 'SILICONFLOW_API_KEY', baseUrl: 'SILICONFLOW_BASE_URL' },
  'openai-codex': { apiKey: 'OPENAI_API_KEY', baseUrl: 'OPENAI_BASE_URL' },
};
const hermesPlatformEnvMap = {
  TELEGRAM_BOT_TOKEN: ['telegram', 'token'],
  TELEGRAM_PROXY: ['telegram', 'proxy'],
  DISCORD_BOT_TOKEN: ['discord', 'token'],
  DISCORD_PROXY: ['discord', 'proxy'],
  SLACK_BOT_TOKEN: ['slack', 'token'],
  MATRIX_ACCESS_TOKEN: ['matrix', 'token'],
  MATRIX_PROXY: ['matrix', 'proxy'],
  MATRIX_HOMESERVER: ['matrix', 'extra.homeserver'],
  MATRIX_USER_ID: ['matrix', 'extra.user_id'],
  MATRIX_PASSWORD: ['matrix', 'extra.password'],
  FEISHU_APP_ID: ['feishu', 'extra.app_id'],
  FEISHU_APP_SECRET: ['feishu', 'extra.app_secret'],
  FEISHU_ENCRYPT_KEY: ['feishu', 'extra.encrypt_key'],
  FEISHU_VERIFICATION_TOKEN: ['feishu', 'extra.verification_token'],
  DINGTALK_CLIENT_ID: ['dingtalk', 'extra.client_id'],
  DINGTALK_CLIENT_SECRET: ['dingtalk', 'extra.client_secret'],
  DINGTALK_APP_KEY: ['dingtalk', 'extra.app_key'],
  DINGTALK_CARD_TEMPLATE_ID: ['dingtalk', 'extra.card_template_id'],
  DINGTALK_ALLOWED_USERS: ['dingtalk', 'allowed_users'],
  DINGTALK_ALLOW_ALL_USERS: ['dingtalk', 'allow_all_users'],
  QQ_APP_ID: ['qqbot', 'extra.app_id'],
  QQ_CLIENT_SECRET: ['qqbot', 'extra.client_secret'],
  QQ_ALLOWED_USERS: ['qqbot', 'allowed_users'],
  QQ_ALLOW_ALL_USERS: ['qqbot', 'allow_all_users'],
  WECOM_BOT_ID: ['wecom', 'extra.bot_id'],
  WECOM_SECRET: ['wecom', 'extra.secret'],
  WEIXIN_TOKEN: ['weixin', 'token'],
  WEIXIN_ACCOUNT_ID: ['weixin', 'extra.account_id'],
  WEIXIN_BASE_URL: ['weixin', 'extra.base_url'],
  WHATSAPP_ENABLED: ['whatsapp', 'enabled'],
};
const hermesPlatformEnvByPlatform = Object.entries(hermesPlatformEnvMap).reduce((acc, [envKey, [platform, cfgPath]]) => {
  acc[platform] = acc[platform] || {};
  acc[platform][cfgPath] = envKey;
  return acc;
}, {});
const weixinIlinkBase = 'https://ilinkai.weixin.qq.com';
const hermesProxyEnvKeys = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY'];
const hermesConfigSections = new Set(['display', 'agent', 'memory', 'skills', 'compression', 'session_reset', 'approvals', 'tts', 'stt', 'telegram', 'discord', 'slack', 'whatsapp', 'matrix', 'weixin', 'wecom', 'feishu', 'dingtalk', 'qqbot']);
const hermesPlatformSections = new Set(['telegram', 'discord', 'slack', 'whatsapp', 'matrix', 'weixin', 'wecom', 'feishu', 'dingtalk', 'qqbot']);
const auxiliaryModelTasks = [
  { key: 'vision', label: '视觉', default_timeout: 120, default_download_timeout: 30 },
  { key: 'compression', label: '压缩', default_timeout: 120 },
  { key: 'web_extract', label: '网页提取', default_timeout: 360 },
  { key: 'approval', label: '审批', default_timeout: 30 },
  { key: 'mcp', label: 'MCP', default_timeout: 30 },
  { key: 'title_generation', label: '标题生成', default_timeout: 30 },
  { key: 'tts_audio_tags', label: 'TTS 音频标签', default_timeout: 30 },
  { key: 'skills_hub', label: '技能中心', default_timeout: 30 },
  { key: 'triage_specifier', label: 'Triage 扩写', default_timeout: 120 },
  { key: 'kanban_decomposer', label: '看板拆解', default_timeout: 180 },
  { key: 'profile_describer', label: 'Profile 描述', default_timeout: 60 },
  { key: 'curator', label: '策展', default_timeout: 600 },
];
const auxiliaryModelTaskByKey = new Map(auxiliaryModelTasks.map((task) => [task.key, task]));
const auxiliaryEditableFields = ['provider', 'model', 'timeout', 'download_timeout', 'extra_body'];
const kanbanStatuses = new Set(['triage', 'todo', 'scheduled', 'ready', 'running', 'blocked', 'review', 'done', 'archived']);
const gatewayManagementModes = new Set(['auto', 'per_profile', 'unified']);
const externalProviderPresetSource = process.env.FRAKIO_WORK_PROVIDER_PRESETS || '';
const providerAuthTypeMap = {
  'claude-oauth': 'claude-pkce',
  'google-gemini-cli': 'gemini-loopback',
  'openai-codex': 'codex-device',
};
const compatibilityOnlyProviderKeys = new Set(['ikuncode', 'fun-codex', 'fun-claude']);
const fallbackProviderPresets = [
  { label: 'IkunCode', value: 'ikuncode', builtin: true, selectable: false, baseUrl: 'https://api.ikuncode.cc/v1', apiMode: 'codex_responses', models: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.5', 'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra'] },
  { label: 'Codex-apikey.fun', value: 'fun-codex', builtin: true, selectable: false, baseUrl: 'https://api.apikey.fun/v1', apiMode: 'codex_responses', models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3-codex-spark'] },
  { label: 'Claude-apikey.fun', value: 'fun-claude', builtin: true, selectable: false, baseUrl: 'https://api.apikey.fun', apiMode: 'anthropic_messages', models: ['claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'] },
  { label: 'LM Studio', value: 'lmstudio', builtin: true, baseUrl: 'http://127.0.0.1:1234/v1', apiMode: 'chat_completions', models: [] },
  { label: 'Anthropic', value: 'anthropic', builtin: true, baseUrl: 'https://api.anthropic.com', apiMode: 'anthropic_messages', models: ['claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'] },
  { label: 'Claude OAuth', value: 'claude-oauth', builtin: true, baseUrl: 'https://api.anthropic.com', apiMode: 'anthropic_messages', authType: 'claude-pkce', models: ['claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'] },
  { label: 'Google AI Studio', value: 'gemini', builtin: true, baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiMode: 'chat_completions', models: ['gemini-3.1-pro-preview', 'gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview'] },
  { label: 'Google Gemini OAuth', value: 'google-gemini-cli', builtin: true, baseUrl: 'cloudcode-pa://google', apiMode: 'chat_completions', authType: 'gemini-loopback', models: ['gemini-3.1-pro-preview', 'gemini-3-pro-preview', 'gemini-3-flash-preview'] },
  { label: 'DeepSeek', value: 'deepseek', builtin: true, baseUrl: 'https://api.deepseek.com', apiMode: 'chat_completions', models: ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'] },
  { label: 'Z.AI / GLM', value: 'zai', builtin: true, baseUrl: 'https://api.z.ai/api/paas/v4', apiMode: 'chat_completions', models: ['glm-5.1', 'glm-5', 'glm-5v-turbo', 'glm-5-turbo', 'glm-4.7', 'glm-4.5', 'glm-4.5-flash'] },
  { label: 'GLM-Coding-Plan', value: 'glm', builtin: true, baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', apiMode: 'chat_completions', models: ['glm-5.2', 'glm-5.1', 'glm-5v-turbo', 'glm-4.7'] },
  { label: 'Kimi for Coding', value: 'kimi-coding', builtin: true, baseUrl: 'https://api.kimi.com/coding/v1', apiMode: 'chat_completions', models: ['kimi-k2.6', 'kimi-k2.5', 'kimi-for-coding', 'kimi-k2-thinking', 'kimi-k2-thinking-turbo'] },
  { label: 'OpenRouter', value: 'openrouter', builtin: true, baseUrl: 'https://openrouter.ai/api/v1', apiMode: 'chat_completions', models: [] },
  { label: 'OpenAI API', value: 'openai-api', builtin: true, baseUrl: 'https://api.openai.com/v1', apiMode: 'codex_responses', models: ['gpt-5.5', 'gpt-5.5-pro', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.3-codex', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini'] },
  { label: 'OpenAI Codex', value: 'openai-codex', builtin: true, baseUrl: 'https://chatgpt.com/backend-api/codex', apiMode: 'codex_responses', authType: 'codex-device', models: ['gpt-5.5', 'gpt-5.4-mini'] },
];

const defaultSpaceTheme = {
  accentColor: '#dce8e3',
  sidebarBg: '#f3f7f5',
  opacity: 0.5,
  noise: 0.01,
  texture: 0.03,
  mode: 'soft',
  gradientColors: [{ id: 'primary', color: '#dce8e3', x: 0.5, y: 0.5, isPrimary: true }],
  colorMode: 'native',
  appearance: 'light',
  renderVersion: SPACE_THEME_RENDER_VERSION,
};
function normalizeProviderPreset(raw = {}) {
  const value = String(raw.value || '').trim();
  return {
    label: String(raw.label || value).trim(),
    value,
    builtin: raw.builtin !== false,
    selectable: raw.selectable !== false && !compatibilityOnlyProviderKeys.has(value),
    baseUrl: String(raw.baseUrl || raw.base_url || '').trim(),
    apiMode: normalizeApiMode(raw.apiMode || raw.api_mode || (value === 'openai-codex' ? 'codex_responses' : '')),
    ...(providerAuthTypeMap[value] ? { authType: providerAuthTypeMap[value] } : {}),
    models: Array.isArray(raw.models) ? raw.models.map((model) => String(model || '').trim()).filter(Boolean) : [],
  };
}
function withCompatibilityProviderPresets(rawPresets = []) {
  const presets = rawPresets.map(normalizeProviderPreset);
  const knownKeys = new Set(presets.map((preset) => preset.value));
  for (const fallback of fallbackProviderPresets) {
    if (!compatibilityOnlyProviderKeys.has(fallback.value) || knownKeys.has(fallback.value)) continue;
    presets.push(normalizeProviderPreset(fallback));
  }
  return presets;
}
function loadProviderPresets() {
  try {
    if (!externalProviderPresetSource) throw new Error('No external provider preset source configured.');
    const source = readFileSync(externalProviderPresetSource, 'utf8');
    const match = source.match(/export const PROVIDER_PRESETS: ProviderPreset\[] = (\[[\s\S]*?\n\])/);
    if (!match) throw new Error('PROVIDER_PRESETS not found');
    return withCompatibilityProviderPresets(Function(`return ${match[1]}`)());
  } catch {
    return withCompatibilityProviderPresets(fallbackProviderPresets);
  }
}
const oauthProviderKeys = new Set(Object.keys(providerAuthTypeMap));
const codexAuthSessions = new Map();
const claudeAuthSessions = new Map();
const geminiAuthSessions = new Map();
const oauthPollMaxMs = 15 * 60 * 1000;
const codexClientId = 'app_EMoamEEZ73f0CkXaXp7hrann';
const codexDeviceAuthUrl = 'https://auth.openai.com/api/accounts/deviceauth/usercode';
const codexDeviceTokenUrl = 'https://auth.openai.com/api/accounts/deviceauth/token';
const codexOAuthTokenUrl = 'https://auth.openai.com/oauth/token';
const codexRedirectUri = 'https://auth.openai.com/deviceauth/callback';
const codexVerificationUrl = 'https://auth.openai.com/codex/device';
const claudeClientId = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const claudeAuthorizeUrl = 'https://claude.ai/oauth/authorize';
const claudeTokenUrl = 'https://console.anthropic.com/v1/oauth/token';
const claudeRedirectUri = 'https://console.anthropic.com/oauth/code/callback';
const claudeScopes = 'org:create_api_key user:profile user:inference';
const geminiProviderKey = 'google-gemini-cli';
const geminiRedirectHost = '127.0.0.1';
const geminiCallbackBindHost = process.env.HERMES_WEB_UI_GEMINI_CALLBACK_BIND_HOST?.trim() || geminiRedirectHost;
const geminiRedirectPort = 8085;
const geminiRedirectPath = '/oauth2callback';
const googleAuthEndpoint = 'https://accounts.google.com/o/oauth2/v2/auth';
const googleTokenEndpoint = 'https://oauth2.googleapis.com/token';
const googleUserInfoEndpoint = 'https://www.googleapis.com/oauth2/v1/userinfo?alt=json';
const googleClientId = process.env.HERMES_GEMINI_CLIENT_ID?.trim() || `681255809395-${['oo8ft2opr', 'drnp9e3a', 'qf6av3h', 'mdib135j'].join('')}.apps.googleusercontent.com`;
const googleClientSecret = process.env.HERMES_GEMINI_CLIENT_SECRET?.trim() || '';
const googleScopes = ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'].join(' ');
const modelPricingDefaults = [
  { pattern: /gpt-5/i, input: 1.25, output: 10, cacheRead: 0.125, cacheCreation: 1.25 },
  { pattern: /gpt-4\.1|gpt-4o/i, input: 2.5, output: 10, cacheRead: 1.25, cacheCreation: 2.5 },
  { pattern: /o3|o4/i, input: 2, output: 8, cacheRead: 0.5, cacheCreation: 2 },
  { pattern: /claude.*opus/i, input: 15, output: 75, cacheRead: 1.5, cacheCreation: 18.75 },
  { pattern: /claude.*sonnet/i, input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75 },
  { pattern: /deepseek/i, input: 0.27, output: 1.1, cacheRead: 0.07, cacheCreation: 0.27 },
  { pattern: /gemini.*pro/i, input: 1.25, output: 10, cacheRead: 0.31, cacheCreation: 1.25 },
  { pattern: /gemini.*flash/i, input: 0.3, output: 2.5, cacheRead: 0.075, cacheCreation: 0.3 },
];

const defaultVaultPath =
  process.env.OBSIDIAN_VAULT ||
  defaultProjectsRoot;

const localSecurity = createLocalSecurity({ port, development: process.env.FRAKIO_WORK_PACKAGED !== '1', managedWeb: isManagedWebMode });
const managedWebAuth = createManagedWebAuth({
  enabled: isManagedWebMode,
  home: frakioWorkHome,
  secureCookies: tlsEnabled,
});
app.use(cors(localSecurity.corsOptions));
app.use(express.json({ limit: '10mb' }));
app.get('/api/auth/status', managedWebAuth.statusRoute);
app.post('/api/auth/login', managedWebAuth.loginRoute);
app.post('/api/auth/desktop-session', managedWebAuth.desktopSessionRoute);
app.use('/api', managedWebAuth.protect);
app.get('/api/session', localSecurity.sessionRoute);
app.use('/api', localSecurity.protect);
app.post('/api/auth/logout', managedWebAuth.logoutRoute);
app.put('/api/auth/password', (req, res) => void managedWebAuth.passwordRoute(req, res));

app.post('/api/attachments', express.raw({ type: () => true, limit: MAX_ATTACHMENT_BYTES }), async (req, res) => {
  try {
    const attachment = await attachmentStore.save({
      name: String(req.query.name || ''),
      mimeType: String(req.headers['content-type'] || ''),
      data: req.body,
    });
    res.status(201).json({ attachment });
  } catch (error) {
    res.status(error.status || 500).json({ error: String(error?.message || error), code: error.code || '' });
  }
});

app.get('/api/attachments/:id/content', async (req, res) => {
  try {
    const { metadata, filePath, inline } = await attachmentStore.content(req.params.id);
    res.type(metadata.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', String(metadata.size));
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(metadata.name)}`);
    await pipeline(createReadStream(filePath), res);
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    res.status(error.status || 500).json({ error: String(error?.message || error), code: error.code || '' });
  }
});

app.delete('/api/attachments/:id', async (req, res) => {
  try {
    await attachmentStore.removeDraft(req.params.id);
    res.json({ ok: true, deletedAttachmentId: req.params.id });
  } catch (error) {
    res.status(error.status || 500).json({ error: String(error?.message || error), code: error.code || '' });
  }
});

app.get('/api/filesystem/directories', async (req, res) => {
  try {
    const requested = String(req.query.path || serverDirectoryRoot).trim() || serverDirectoryRoot;
    const current = resolveInsideRoot(serverDirectoryRoot, requested);
    const info = await stat(current);
    if (!info.isDirectory()) return res.status(400).json({ error: '目标路径不是文件夹。' });
    const entries = (await readdir(current, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => ({ name: entry.name, path: path.join(current, entry.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    const parentCandidate = path.dirname(current);
    res.json({
      root: serverDirectoryRoot,
      current,
      parent: current === serverDirectoryRoot ? '' : resolveInsideRoot(serverDirectoryRoot, parentCandidate),
      entries,
    });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message || '无法读取文件夹。' });
  }
});

app.use('/api/attachments', (error, _req, res, next) => {
  if (error?.status === 413 || error?.type === 'entity.too.large') {
    return res.status(413).json({ error: '单个附件不能超过 32 MiB。', code: 'attachment_too_large' });
  }
  return next(error);
});

const legacyDemoAgents = [
  { id: 'iris', name: 'Iris', role: '书记官 / 默认入口', model: 'Hermes default', color: '#2563eb', soul: '冷静、细致，负责把混乱需求变成可执行 brief。', scope: '理解意图、整理 brief、记录结论、维护上下文。', source: 'demo' },
  { id: 'max', name: 'Max', role: 'CEO / 调度裁决', model: 'Hermes reasoning', color: '#111827', soul: '判断优先级，压住复杂度，只推动下一步可确认动作。', scope: '拆解目标、分派 Agent、处理冲突、形成最终裁决。', source: 'demo' },
  { id: 'nora', name: 'Nora', role: '电商总监', model: 'Hermes commerce', color: '#0f766e', soul: '站在生意结果看产品、用户、转化和售后。', scope: '选品、Listing、店铺运营、客服、产品商业判断。', source: 'demo' },
  { id: 'kai', name: 'Kai', role: '营销总监', model: 'Hermes growth', color: '#b45309', soul: '把商业判断转成内容、SEO、广告和传播角度。', scope: '内容、SEO、广告、红人、传播角度和用户洞察。', source: 'demo' },
  { id: 'leo', name: 'Leo', role: '设计总监', model: 'Hermes vision', color: '#7c3aed', soul: '负责让品牌视觉、商品图和视频 brief 可落地。', scope: '品牌、视觉、素材、图片和视频生成 brief。', source: 'demo' },
  { id: 'victor', name: 'Victor', role: '技术总监', model: 'Hermes technical', color: '#475569', soul: '守住技术边界，处理建站、自动化和发布风险。', scope: '建站、自动化、数据同步、Shopify 发布和技术风险。', source: 'demo' },
];

const legacyDefaultModels = [
  { id: 'model_default_deepseek_v4_flash', name: 'DeepSeek chat', provider: 'DeepSeek', kind: 'official', protocol: 'OpenAI Compatible', model: 'deepseek-chat', models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-pro', 'deepseek-v4-flash'], baseUrl: 'https://api.deepseek.com', apiKey: '', apiKeyState: '', source: 'default', pricing: { input: 0.27, output: 1.1, cacheRead: 0.07, cacheCreation: 0.27 } },
  { id: 'model_hermes_default', name: 'Hermes default', provider: 'Hermes', kind: 'official', protocol: 'OpenAI Compatible', model: 'hermes-default', baseUrl: '', apiKey: '', source: 'demo' },
  { id: 'model_hermes_reasoning', name: 'Hermes reasoning', provider: 'Hermes', kind: 'official', protocol: 'OpenAI Compatible', model: 'hermes-reasoning', baseUrl: '', apiKey: '', source: 'demo' },
  { id: 'model_hermes_commerce', name: 'Hermes commerce', provider: 'Hermes', kind: 'official', protocol: 'OpenAI Compatible', model: 'hermes-commerce', baseUrl: '', apiKey: '', source: 'demo' },
  { id: 'model_hermes_growth', name: 'Hermes growth', provider: 'Hermes', kind: 'official', protocol: 'OpenAI Compatible', model: 'hermes-growth', baseUrl: '', apiKey: '', source: 'demo' },
  { id: 'model_hermes_vision', name: 'Hermes vision', provider: 'Hermes', kind: 'official', protocol: 'OpenAI Compatible', model: 'hermes-vision', baseUrl: '', apiKey: '', source: 'demo' },
  { id: 'model_hermes_technical', name: 'Hermes technical', provider: 'Hermes', kind: 'official', protocol: 'OpenAI Compatible', model: 'hermes-technical', baseUrl: '', apiKey: '', source: 'demo' },
];

const workflows = {
  council: ['Iris 接收需求', 'Max 拆解任务', '相关 Agent 协作', '生成待确认动作'],
  knowledge: ['读取 Obsidian 规则', '检索项目资料', '回答并显示来源'],
};
const defaultCouncilWorkflowSignature = workflows.council.join('\u0000');
const legacyWelcomeMessages = [
  { id: 'start-iris', agentId: 'iris', agentName: 'Iris', role: '书记官 / 默认入口', content: 'Workspace 已开启。我会先把需求整理成可执行 brief，再交给 Max 判断是否需要更多 Agent 参与。' },
  { id: 'start-max', agentId: 'max', agentName: 'Max', role: 'CEO / 调度裁决', content: '第一版按简单原则运行：能用一个 Workspace 解决，就不新增实体。能用确认队列解决，就不把权限散到各功能里。' },
];

const defaultPinnedNav = {
  knowledge: true,
  channels: true,
  kanban: true,
  jobs: true,
  models: true,
  org: true,
};

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function uniquePathEntries(entries) {
  const seen = new Set();
  return entries
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .filter((entry) => {
      if (seen.has(entry)) return false;
      seen.add(entry);
      return true;
    });
}

function runtimePathEntries() {
  const nodeExecDir = process.execPath ? path.dirname(process.execPath) : '';
  const bundledRuntime = findFrakioHermesRuntimeSync();
  const bundledNodeDir = bundledRuntime?.node ? path.dirname(bundledRuntime.node) : '';
  const bundledPythonBin = bundledRuntime?.python ? path.dirname(bundledRuntime.python) : '';
  return uniquePathEntries([
    path.join(appRoot, 'node_modules', '.bin'),
    path.join(projectRoot, 'node_modules', '.bin'),
    bundledNodeDir,
    bundledPythonBin,
    nodeExecDir,
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    path.join(homeDir, '.local', 'bin'),
    path.join(homeDir, '.npm-global', 'bin'),
    ...String(process.env.PATH || '').split(path.delimiter),
  ]);
}

function runtimeEnv(extra = {}) {
  const extraPath = String(extra.PATH || '').split(path.delimiter);
  return {
    ...process.env,
    ...extra,
    PATH: uniquePathEntries([...runtimePathEntries(), ...extraPath]).join(path.delimiter),
  };
}

async function resolveRuntimeCommand(command) {
  const clean = String(command || '').trim();
  if (!clean) return '';
  if (path.isAbsolute(clean)) return await exists(clean) ? clean : '';
  if (clean.includes('/') || clean.includes('\\')) {
    const resolved = path.resolve(projectRoot, clean);
    return await exists(resolved) ? resolved : '';
  }
  return resolvePlatformCommand(clean, { cwd: projectRoot, env: runtimeEnv() });
}

function hermesRuntimePlatformDir() {
  return runtimePlatformDir();
}

function hermesPythonCandidates(runtimeDir) {
  return runtimePythonCandidates(runtimeDir);
}

function hermesNodeCandidate(runtimeDir) {
  return runtimeNodeCandidate(runtimeDir);
}

function defaultRuntimeRegistry() {
  return { schema: 1, activeVersion: '', previousVersion: '', runtimes: [], updatedAt: '' };
}

function readRuntimeRegistrySync() {
  try {
    const parsed = JSON.parse(readFileSync(frakioRuntimeRegistryPath, 'utf8'));
    return {
      ...defaultRuntimeRegistry(),
      ...parsed,
      runtimes: Array.isArray(parsed?.runtimes) ? parsed.runtimes : [],
    };
  } catch {
    return defaultRuntimeRegistry();
  }
}

async function writeRuntimeRegistry(registry) {
  await mkdir(path.dirname(frakioRuntimeRegistryPath), { recursive: true });
  const next = { ...defaultRuntimeRegistry(), ...registry, schema: 1, updatedAt: now() };
  const temporary = `${frakioRuntimeRegistryPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, frakioRuntimeRegistryPath);
  return next;
}

function readRuntimeManifestSync(runtimeDir) {
  try {
    return JSON.parse(readFileSync(path.join(runtimeDir, 'runtime-manifest.json'), 'utf8'));
  } catch {
    return null;
  }
}

function runtimeCandidateDirs(root) {
  const clean = String(root || '').trim();
  if (!clean) return [];
  const platformDir = hermesRuntimePlatformDir();
  const dirs = [];
  if (existsSync(hermesPythonCandidates(clean)[0]) || existsSync(hermesPythonCandidates(clean)[1])) dirs.push(clean);
  for (const version of versionedDirsSync(clean)) dirs.push(path.join(clean, version, platformDir));
  return Array.from(new Set(dirs));
}

function inspectHermesRuntimeDir(runtimeDir, source) {
  const python = hermesPythonCandidates(runtimeDir).find((candidate) => existsSync(candidate)) || '';
  if (!python) return null;
  const node = existsSync(hermesNodeCandidate(runtimeDir)) ? hermesNodeCandidate(runtimeDir) : '';
  const manifest = readRuntimeManifestSync(runtimeDir);
  const pythonLib = path.join(runtimeDir, 'python', 'lib');
  const sitePackages = runtimePythonSitePackagesCandidates(runtimeDir)
    .find((candidate) => existsSync(path.join(candidate, 'run_agent.py'))) || (existsSync(pythonLib)
    ? readdirSync(pythonLib, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('python'))
      .map((entry) => path.join(pythonLib, entry.name, 'site-packages'))
      .find((candidate) => existsSync(path.join(candidate, 'run_agent.py')))
    : '');
  return {
    source,
    runtimeDir,
    pythonRoot: sitePackages || path.join(runtimeDir, 'python'),
    python,
    node,
    version: String(manifest?.hermesAgentVersion || path.basename(path.dirname(runtimeDir))),
    platform: path.basename(runtimeDir),
    manifest,
    bridgeProtocolVersion: Number(manifest?.bridgeProtocolVersion || 1),
  };
}

let runtimeFallbackReason = '';

function findFrakioHermesRuntimeSync() {
  runtimeFallbackReason = '';
  for (const runtimeDir of runtimeCandidateDirs(process.env.FRAKIO_WORK_HERMES_RUNTIME)) {
    const runtime = inspectHermesRuntimeDir(runtimeDir, 'override');
    if (runtime) return runtime;
  }

  const registry = readRuntimeRegistrySync();
  if (registry.activeVersion) {
    const registered = registry.runtimes.find((item) => item?.version === registry.activeVersion && item?.platform === hermesRuntimePlatformDir());
    const candidates = uniquePathEntries([
      registered?.runtimeDir,
      path.join(frakioManagedHermesRuntimeRoot, registry.activeVersion, hermesRuntimePlatformDir()),
      path.join(frakioBundledHermesRuntimeRoot, registry.activeVersion, hermesRuntimePlatformDir()),
      path.join(projectRoot, 'runtime', 'hermes', registry.activeVersion, hermesRuntimePlatformDir()),
    ]);
    for (const runtimeDir of candidates) {
      const runtime = inspectHermesRuntimeDir(runtimeDir, 'managed');
      if (runtime && runtime.bridgeProtocolVersion === frakioBridgeProtocolVersion) return runtime;
    }
    runtimeFallbackReason = `用户 Runtime ${registry.activeVersion} 不可用或与当前 Bridge 不兼容，已回退到内置 Runtime。`;
  }

  const bundledRoots = uniquePathEntries([
    frakioBundledHermesRuntimeRoot,
    path.join(projectRoot, 'runtime', 'hermes'),
  ]);
  for (const root of bundledRoots) {
    for (const runtimeDir of runtimeCandidateDirs(root)) {
      const runtime = inspectHermesRuntimeDir(runtimeDir, 'bundled');
      if (runtime) return runtime;
    }
  }
  return null;
}

async function findFrakioHermesRuntime() {
  return findFrakioHermesRuntimeSync();
}

function findFrakioBridgeScriptSync() {
  const bundledCandidates = [
    path.join(frakioBundledBridgeRoot, 'hermes_bridge.py'),
    path.join(projectRoot, 'runtime', 'agent-bridge', 'python', 'hermes_bridge.py'),
  ];
  for (const candidate of bundledCandidates) {
    if (existsSync(candidate)) return { path: candidate, source: 'bundled' };
  }
  const override = process.env.HERMES_AGENT_BRIDGE_SCRIPT;
  if (override && existsSync(override)) return { path: override, source: 'override' };
  return null;
}

async function findFrakioBridgeScript() {
  return findFrakioBridgeScriptSync();
}

function redactRuntimeLog(value) {
  return String(value || '')
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, 'sk-***')
    .replace(/(api[_-]?key["'\s:=]+)([^"'\s,}]+)/gi, '$1***')
    .replace(/(authorization["'\s:=]+bearer\s+)([^"'\s,}]+)/gi, '$1***');
}

function pushRuntimeLog(logs, line) {
  const clean = redactRuntimeLog(line).replace(/\s+/g, ' ').trim();
  if (!clean) return;
  logs.push(clean);
  if (logs.length > 80) logs.splice(0, logs.length - 80);
}

function runtimeApiLogPath() {
  return path.join(frakioWorkHome, 'logs', 'runtime-api.log');
}

function attachRuntimeProcessLogs(child, logFile, logs) {
  mkdirSync(path.dirname(logFile), { recursive: true });
  const stream = createWriteStream(logFile, { flags: 'a' });
  const writeChunk = (source, chunk) => {
    const text = redactRuntimeLog(chunk);
    stream.write(text);
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) pushRuntimeLog(logs, `${source}: ${line}`);
    }
  };
  child.stdout?.on('data', (chunk) => writeChunk('stdout', chunk));
  child.stderr?.on('data', (chunk) => writeChunk('stderr', chunk));
  child.on('exit', (code, signal) => {
    const line = `Frakio Work Runtime API exited code=${code ?? ''} signal=${signal ?? ''}`;
    pushRuntimeLog(logs, line);
    stream.write(`${line}\n`);
    stream.end();
  });
  child.on('error', (error) => {
    const line = `Frakio Work Runtime API spawn failed: ${error.message}`;
    pushRuntimeLog(logs, line);
    stream.write(`${line}\n`);
  });
}

async function isTcpPortFree(portNumber, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(portNumber, host);
  });
}

async function findFreeTcpPort(startPort = 8642, host = '127.0.0.1') {
  for (let nextPort = Number(startPort) || 8642; nextPort <= 65535; nextPort += 1) {
    if (await isTcpPortFree(nextPort, host)) return nextPort;
  }
  throw new Error(`No free local TCP port found from ${startPort}.`);
}

async function runtimeToolDiagnostics() {
  const names = ['node', 'npm', 'npx', 'uv', 'python3'];
  const tools = {};
  for (const name of names) {
    const resolved = await resolveRuntimeCommand(name);
    tools[name] = { command: name, path: resolved, available: Boolean(resolved) };
  }
  return tools;
}

function workbenchMcpDiagnostics(profileName = 'default') {
  return {
    profileName,
    servers: {
      'hermes-workbench-api': publicMcpServer('hermes-workbench-api', workbenchMcpServerConfig('api', profileName)),
      'hermes-workbench-use': publicMcpServer('hermes-workbench-use', workbenchMcpServerConfig('use', profileName)),
    },
  };
}

function mcpCommandMissingMessage(profileName, serverName, command) {
  return `Hermes Profile「${profileName || 'default'}」的 MCP server「${serverName}」启动失败：找不到命令「${command}」。请安装 Node/npm，或把 MCP command 改成绝对路径。`;
}

async function findMissingMcpCommands(profileName = 'default') {
  const cleanProfile = slug(profileName || 'default');
  const config = await readYamlFile(mcpConfigPathForProfile(cleanProfile));
  const servers = config.mcp_servers && typeof config.mcp_servers === 'object' ? config.mcp_servers : {};
  const missing = [];
  for (const [name, serverConfig] of Object.entries(servers)) {
    if (!serverConfig || serverConfig.enabled === false || mcpTransportFromConfig(serverConfig) !== 'stdio') continue;
    const command = String(serverConfig.command || '').trim();
    if (!command) {
      missing.push({ profileName: cleanProfile, serverName: name, command: '', message: `Hermes Profile「${cleanProfile}」的 MCP server「${name}」缺少 command。` });
      continue;
    }
    const resolved = await resolveRuntimeCommand(command);
    if (!resolved) missing.push({ profileName: cleanProfile, serverName: name, command, message: mcpCommandMissingMessage(cleanProfile, name, command) });
  }
  return missing;
}

function enrichMissingExecutableError(message, profileName = 'default') {
  const text = String(message || '');
  const command = text.match(/No such file or directory:\s*['"]([^'"]+)['"]/i)?.[1]
    || text.match(/\[Errno 2\]\s*No such file or directory:\s*['"]([^'"]+)['"]/i)?.[1]
    || '';
  if (!command) return text;
  return `Hermes Profile「${profileName}」运行时找不到命令「${command}」。请安装对应依赖，或把 MCP command 改成绝对路径。\n\n原始错误：${text}`;
}

function hermesRuntimeErrorDetails(error, profileName = 'default') {
  const text = String(error?.message || error || '');
  const response = error?.response && typeof error.response === 'object' ? error.response : {};
  const command = text.match(/找不到命令「([^」]+)」/)?.[1]
    || text.match(/No such file or directory:\s*['"]([^'"]+)['"]/i)?.[1]
    || text.match(/\[Errno 2\]\s*No such file or directory:\s*['"]([^'"]+)['"]/i)?.[1]
    || '';
  const missingExecutable = Boolean(command || /No such file or directory|FileNotFoundError|\[Errno 2\]/i.test(text) || /FileNotFoundError/i.test(String(response.error_type || '')));
  return {
    profileName,
    command,
    serverName: error?.details?.serverName || '',
    bridgePid: null,
    errorType: response.error_type || error?.code || '',
    missingExecutable,
    raw: text,
  };
}

function normalizeUserProfile(value = {}) {
  const nickname = String(value.nickname || '').trim().slice(0, 80);
  const avatarUrl = String(value.avatarUrl || '').trim();
  return {
    avatarUrl,
    nickname,
    bio: String(value.bio || '').trim().slice(0, 1200),
    age: String(value.age || '').trim().slice(0, 40),
    hobbies: String(value.hobbies || '').trim().slice(0, 600),
    occupation: String(value.occupation || '').trim().slice(0, 600),
    defaultAgentAddress: String(value.defaultAgentAddress || '').trim().slice(0, 80),
    otherAgentAddress: String(value.otherAgentAddress || '').trim().slice(0, 80),
    completedAt: avatarUrl && nickname ? String(value.completedAt || now()) : '',
    updatedAt: String(value.updatedAt || ''),
  };
}

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function now() {
  return new Date().toISOString();
}

function captureTelemetry(eventName, properties = {}, options = {}) {
  void telemetry.capture(eventName, properties, options).catch(() => {});
}

function captureMeaningfulActivity(action) {
  void telemetry.captureMeaningfulActivity(action).catch(() => {});
}

function telemetryDurationBucket(startedAt) {
  const start = Date.parse(String(startedAt || ''));
  const ms = Number.isFinite(start) ? Math.max(0, Date.now() - start) : 0;
  if (ms < 10_000) return 'under_10s';
  if (ms < 60_000) return '10s_1m';
  if (ms < 300_000) return '1m_5m';
  if (ms < 1_800_000) return '5m_30m';
  return 'over_30m';
}

function telemetryErrorCode(error) {
  const explicit = String(error?.code || error?.details?.errorType || '').trim().toUpperCase();
  if (/^[A-Z0-9_]{2,48}$/.test(explicit)) return explicit.toLowerCase();
  const status = Number(error?.status || 0);
  if (status === 401 || status === 403) return 'authorization_failed';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'runtime_unavailable';
  return 'unknown_error';
}

function runTelemetryProperties(thread) {
  const workflow = Array.isArray(thread?.workflowState) ? thread.workflowState : [];
  return {
    duration_bucket: telemetryDurationBucket(thread?.activeRunStartedAt),
    tool_count: workflow.filter((step) => String(step?.source || '').toLowerCase().includes('tool')).length,
    approval_count: workflow.filter((step) => String(step?.source || '').toLowerCase().includes('approval')).length,
  };
}

function defaultState() {
  return {
    version: 6,
    features: {
      runtimeRouterV1: true,
      piRuntime: true,
      piOAuthProviders: true,
      piGeminiCodeAssistAdapter: false,
      runtimeNeutralWork: true,
      memoryLedger: true,
      externalCliChannels: true,
    },
    ui: { libraryCollapsed: false, pinnedNav: defaultPinnedNav, defaultAgentId: '', fallbackDecisionAgentId: '', defaultModel: '', density: 'comfortable', appearance: 'system', streamingResponses: true, showReasoning: true, richToolDescriptions: true, telemetryEnabled: false, telemetryNoticeSeenAt: '', agentMentionMaxDepth: 2, ...normalizeWorkbenchSidebarSettings() },
    userProfile: { avatarUrl: '', nickname: '', bio: '', age: '', hobbies: '', occupation: '', defaultAgentAddress: '', otherAgentAddress: '', completedAt: '', updatedAt: '' },
    observability: { modelUsage: [], modelRuns: [], systemEvents: [] },
    integrations: {
      hermesStudio: {
        detectedUrl: '',
        lastCheckedAt: null,
        selectedProfile: 'default',
        importedProfileNames: [],
        authMode: 'none',
      },
      hermesAgent: {
        installPath: hermesHome,
        sourcePath: hermesAgentSourcePath,
        apiBaseUrl: 'http://127.0.0.1:8642/v1',
        apiStatus: 'unknown',
        selectedProfile: 'default',
        lastCheckedAt: null,
        approvalMode: 'smart',
        gatewayAutoStart: { enabled: true, management: 'per_profile', include: [], exclude: [] },
      },
    },
    defaultVaultId: null,
    agents: [],
    models: [],
    spaces: [{ id: 'space_default', name: 'Frakio Work', iconKind: 'dot', iconValue: '', theme: defaultSpaceTheme, archivedAt: null, createdAt: now(), updatedAt: now(), lastOpenedAt: now() }],
    workspaces: [{ id: 'workspace_default', spaceId: 'space_default', name: 'Frakio Work', rootPath: defaultVaultPath, vaultId: null, primaryVaultId: null, sharedVaultIds: [], writableVaultIds: [], environment: 'local', activeThreadId: null, archivedAt: null, pinnedAt: null, createdAt: now(), updatedAt: now() }],
    vaults: [],
    threads: [],
  };
}

async function readState() {
  const stored = await readJsonWithRecovery(statePath, () => null);
  if (!stored) {
    const state = defaultState();
    await migrateHermes019ApprovalDefaults(state);
    await writeState(state);
    return state;
  }
  const state = normalizeState(stored);
  const sidebarSettingsChanged = ['sidebarWidth', 'macSidebarWidth', 'macSidebarWidthVersion']
    .some((key) => stored.ui?.[key] !== state.ui?.[key]);
  const removedConversationTransition = Object.prototype.hasOwnProperty.call(stored.ui || {}, 'conversationTransition');
  const approvalDefaultsChanged = await migrateHermes019ApprovalDefaults(state);
  const oauthMigrationChanged = await migrateProfileOAuthToFrakio(state);
  const oauthAccountBindingsChanged = await migrateModelOAuthAccountBindings(state);
  const oauthModelStateChanged = (state.models || []).some((model) => {
    if (!oauthProviderKeys.has(model.providerKey)) return false;
    const authenticated = Boolean(model.oauthAccountId && getOAuthCredentialSync(model.providerKey, model.oauthAccountId)?.access);
    const nextState = authenticated ? 'authorized' : '';
    if (model.apiKeyState === nextState) return false;
    model.apiKeyState = nextState;
    return true;
  });
  const runtimeSchemaChanged = Number(stored.version || 0) < 6;
  if (sidebarSettingsChanged || removedConversationTransition || approvalDefaultsChanged || oauthMigrationChanged || oauthAccountBindingsChanged || oauthModelStateChanged || runtimeSchemaChanged || (stored.spaces || []).some((space) => (Number(space?.theme?.renderVersion) || 0) < SPACE_THEME_RENDER_VERSION)) await writeState(state);
  return state;
}

async function readSecrets() {
  return readJsonWithRecovery(secretsPath, () => ({ models: {}, oauth: {}, oauthAccounts: {}, oauthMigrationVersion: 0 }));
}

async function writeSecrets(secrets) {
  await writeSecretsJson({
    models: secrets.models || {},
    oauth: secrets.oauth || {},
    oauthAccounts: secrets.oauthAccounts || {},
    oauthMigrationVersion: Number(secrets.oauthMigrationVersion || 0),
  });
}

function normalizeOAuthCredential(value = {}) {
  const access = String(value.access || value.accessToken || value.access_token || '').trim();
  const refresh = String(value.refresh || value.refreshToken || value.refresh_token || '').trim();
  const expires = Number(value.expires || value.expiresAt || value.expires_at_ms || 0) || 0;
  if (!access && !refresh) return null;
  return {
    id: String(value.id || value.accountId || value.account_id || '').trim(),
    type: 'oauth',
    access,
    refresh,
    expires,
    accountId: String(value.accountId || value.account_id || '').trim(),
    label: String(value.label || value.name || '').trim().slice(0, 80),
    email: String(value.email || '').trim(),
    codeAssist: value.codeAssist && typeof value.codeAssist === 'object' ? value.codeAssist : {},
    updatedAt: String(value.updatedAt || value.last_refresh || now()),
  };
}

function oauthAccountId(providerKey, credential = {}) {
  const supplied = String(credential.id || credential.accountId || credential.account_id || '').trim();
  if (supplied) return supplied;
  const identity = String(credential.email || credential.accountId || '').trim();
  const tokenIdentity = String(credential.access || credential.accessToken || credential.access_token || credential.refresh || credential.refreshToken || credential.refresh_token || '').trim();
  const source = identity || tokenIdentity;
  return `${providerKey}_${source ? createHash('sha256').update(source).digest('hex').slice(0, 12) : randomUUID().slice(0, 12)}`;
}

function oauthCredentialFingerprint(credential = {}) {
  const normalized = normalizeOAuthCredential(credential);
  if (!normalized) return '';
  const identity = normalized.access || normalized.refresh;
  return identity ? createHash('sha256').update(identity).digest('hex') : '';
}

function oauthAccountSummary(providerKey, credential = {}) {
  const normalized = normalizeOAuthCredential(credential) || {};
  const id = oauthAccountId(providerKey, normalized);
  const identity = normalized.email || normalized.accountId || id.slice(-8);
  return { id, providerKey, label: normalized.label || identity, identity, email: normalized.email || '', accountId: normalized.accountId || '', expiresAt: normalized.expires || 0, updatedAt: normalized.updatedAt || '', codeAssist: normalized.codeAssist || {} };
}

function migrateOAuthAccountsInSecrets(secrets, state = null) {
  secrets.oauthAccounts = { ...(secrets.oauthAccounts || {}) };
  let changed = false;
  for (const [providerKey, legacy] of Object.entries(secrets.oauth || {})) {
    const credential = normalizeOAuthCredential(legacy);
    if (!credential) continue;
    const accountId = oauthAccountId(providerKey, credential);
    const accounts = { ...(secrets.oauthAccounts[providerKey] || {}) };
    const existingAccountId = Object.entries(accounts)
      .find(([, existing]) => oauthCredentialFingerprint(existing) === oauthCredentialFingerprint(credential))?.[0];
    if (!accounts[accountId] && !existingAccountId) {
      accounts[accountId] = { ...credential, id: accountId, accountId: credential.accountId || accountId, label: credential.label || credential.email || credential.accountId || `${providerKey} 账户` };
      secrets.oauthAccounts[providerKey] = accounts;
      changed = true;
    }
  }
  if (state) {
    for (const [providerKey, accounts] of Object.entries(secrets.oauthAccounts || {})) {
      const canonicalByFingerprint = new Map();
      const redirects = new Map();
      for (const [accountId, account] of Object.entries(accounts || {})) {
        const fingerprint = oauthCredentialFingerprint(account);
        if (!fingerprint) continue;
        const canonicalId = canonicalByFingerprint.get(fingerprint);
        if (!canonicalId) {
          canonicalByFingerprint.set(fingerprint, accountId);
          continue;
        }
        redirects.set(accountId, canonicalId);
        delete accounts[accountId];
        changed = true;
      }
      if (redirects.size) {
        for (const model of state.models || []) {
          if (model.providerKey !== providerKey || !redirects.has(model.oauthAccountId)) continue;
          model.oauthAccountId = redirects.get(model.oauthAccountId);
          changed = true;
        }
      }
    }
  }
  return changed;
}

async function getOAuthCredential(providerKey, accountId = '') {
  const secrets = await readSecrets();
  migrateOAuthAccountsInSecrets(secrets);
  const accounts = secrets.oauthAccounts?.[providerKey] || {};
  const selected = String(accountId || '').trim();
  if (selected) return accounts[selected] ? normalizeOAuthCredential(accounts[selected]) : null;
  return normalizeOAuthCredential(secrets.oauth?.[providerKey]) || normalizeOAuthCredential(Object.values(accounts)[0]);
}

function getOAuthCredentialSync(providerKey, accountId = '') {
  try {
    const secrets = JSON.parse(readFileSync(secretsPath, 'utf8')) || {};
    migrateOAuthAccountsInSecrets(secrets);
    const accounts = secrets.oauthAccounts?.[providerKey] || {};
    if (accountId) return accounts[accountId] ? normalizeOAuthCredential(accounts[accountId]) : null;
    return normalizeOAuthCredential(secrets.oauth?.[providerKey]) || normalizeOAuthCredential(Object.values(accounts)[0]);
  } catch {
    return null;
  }
}

async function setOAuthCredential(providerKey, value, requestedAccountId = '') {
  const credential = normalizeOAuthCredential(value);
  if (!credential) throw new Error(`${providerKey} OAuth 凭据不完整。`);
  const secrets = await readSecrets();
  migrateOAuthAccountsInSecrets(secrets);
  const accountId = String(requestedAccountId || credential.id || credential.accountId || '').trim() || oauthAccountId(providerKey, credential);
  const current = normalizeOAuthCredential(secrets.oauthAccounts?.[providerKey]?.[accountId]) || {};
  const stored = { ...current, ...credential, id: accountId, accountId: credential.accountId || current.accountId || accountId, label: credential.label || current.label || credential.email || credential.accountId || `${providerKey} 账户` };
  secrets.oauthAccounts = { ...(secrets.oauthAccounts || {}), [providerKey]: { ...(secrets.oauthAccounts?.[providerKey] || {}), [accountId]: stored } };
  // Legacy mirror is retained only for old Hermes installs. New Frakio runs use
  // the account selected by the model configuration.
  secrets.oauth = { ...(secrets.oauth || {}), [providerKey]: stored };
  await writeSecrets(secrets);
  return stored;
}

async function deleteOAuthCredential(providerKey, accountId = '') {
  const secrets = await readSecrets();
  migrateOAuthAccountsInSecrets(secrets);
  if (accountId) {
    if (!secrets.oauthAccounts?.[providerKey]?.[accountId]) return;
    delete secrets.oauthAccounts[providerKey][accountId];
    const remaining = Object.values(secrets.oauthAccounts[providerKey] || {}).map(normalizeOAuthCredential).filter(Boolean);
    const mirror = normalizeOAuthCredential(secrets.oauth?.[providerKey]) || {};
    if (!remaining.length) delete secrets.oauth[providerKey];
    else if (oauthAccountId(providerKey, mirror) === accountId) secrets.oauth[providerKey] = remaining[0];
  } else if (secrets.oauth?.[providerKey]) delete secrets.oauth[providerKey];
  await writeSecrets(secrets);
}

async function listOAuthAccounts() {
  const secrets = await readSecrets();
  const changed = migrateOAuthAccountsInSecrets(secrets);
  if (changed) await writeSecrets(secrets);
  return Object.entries(secrets.oauthAccounts || {}).flatMap(([providerKey, accounts]) => Object.values(accounts || {}).map((credential) => oauthAccountSummary(providerKey, credential)));
}

async function migrateModelOAuthAccountBindings(state) {
  const accounts = await listOAuthAccounts();
  let changed = false;
  for (const model of state.models || []) {
    if (!oauthProviderKeys.has(model.providerKey) || model.oauthAccountId) continue;
    const candidates = accounts.filter((item) => item.providerKey === model.providerKey);
    if (candidates.length !== 1) continue;
    model.oauthAccountId = candidates[0].id;
    changed = true;
  }
  return changed;
}

async function getModelSecret(modelId) {
  const secrets = await readSecrets();
  return String(secrets.models?.[modelId]?.apiKey || '').trim();
}

async function getReusableModelSecret(selectedModel, models = []) {
  if (!selectedModel?.id) return '';
  const direct = await getModelSecret(selectedModel.id);
  if (direct) return direct;
  const sameBaseUrl = normalizeModels(models || []).find((model) => model.id !== selectedModel.id && model.baseUrl && model.baseUrl === selectedModel.baseUrl);
  return sameBaseUrl?.id ? await getModelSecret(sameBaseUrl.id) : '';
}

function runtimeModelApiMode(model, modelName = '') {
  return runtimeApiMode(model?.modelApiModes?.[modelName] || model?.apiMode || 'chat_completions') || 'chat_completions';
}

function runtimeSupportsModel(runtimeId, model, modelName = '') {
  const apiMode = runtimeModelApiMode(model, modelName);
  if (runtimeId === 'pi') return ['chat_completions', 'codex_responses', 'anthropic_messages'].includes(apiMode);
  if (runtimeId === 'hermes') return ['chat_completions', 'codex_responses', 'anthropic_messages', 'bedrock_converse'].includes(apiMode);
  return false;
}

function oauthCredentialProviderKey(model) {
  const key = String(model?.providerKey || '').trim();
  if (key === 'openai-codex' || key === 'claude-oauth' || key === geminiProviderKey) return key;
  return '';
}

function piOAuthProviderId(providerKey) {
  if (providerKey === 'openai-codex') return 'openai-codex';
  if (providerKey === 'claude-oauth') return 'anthropic';
  if (providerKey === geminiProviderKey) return 'frakio-gemini-code-assist';
  return '';
}

function modelCredentialNotRequired(model) {
  if (model?.kind === 'local') return true;
  return /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(String(model?.baseUrl || ''));
}

async function runtimeModelCredentialStatus(runtimeId, model, models = []) {
  if (modelCredentialNotRequired(model)) return 'not_required';
  if (await getReusableModelSecret(model, models)) return 'ready';
  const providerKey = oauthCredentialProviderKey(model);
  const oauth = providerKey ? await getOAuthCredential(providerKey, model?.oauthAccountId || '') : null;
  if (oauth?.access && (runtimeId === 'hermes' || runtimeId === 'pi')) return 'ready';
  return 'missing';
}

async function runtimeModelCompatibility(runtimeId, model, models = [], features = {}) {
  const names = runtimeModelNames(model);
  const supportedNames = names.filter((modelName) => runtimeSupportsModel(runtimeId, model, modelName));
  const unsupportedModelIds = names.filter((modelName) => !supportedNames.includes(modelName));
  const oauthProviderKey = oauthCredentialProviderKey(model);
  if (oauthProviderKey && !model?.oauthAccountId) {
    return {
      status: 'missing_credentials', credentialStatus: 'missing', usableModelIds: [], unsupportedModelIds,
      reason: '请在模型配置中选择一个 Frakio Work 授权账户。',
    };
  }
  const credentialStatus = await runtimeModelCredentialStatus(runtimeId, model, models);
  if (runtimeId === 'pi' && model?.providerKey === geminiProviderKey && !features.piGeminiCodeAssistAdapter) {
    return {
      status: 'unsupported',
      credentialStatus,
      usableModelIds: [],
      unsupportedModelIds: names,
      reason: 'Gemini Code Assist 的 Pi 适配器尚未开放。',
    };
  }
  if (!supportedNames.length) {
    return {
      status: 'unsupported',
      credentialStatus,
      usableModelIds: [],
      unsupportedModelIds,
      reason: `${runtimeId === 'pi' ? 'Pi' : 'Hermes'} 不支持该配置使用的 API 协议。`,
    };
  }
  if (credentialStatus === 'missing') {
    return {
      status: 'missing_credentials',
      credentialStatus,
      usableModelIds: [],
      unsupportedModelIds,
      reason: runtimeId === 'pi'
        ? '缺少可供 Pi 使用的模型凭据。请在 Frakio Model Center 完成该 Provider 授权。'
        : '缺少可供 Hermes 使用的模型凭据。',
    };
  }
  return {
    status: unsupportedModelIds.length ? 'partial' : 'ready',
    credentialStatus,
    usableModelIds: supportedNames,
    unsupportedModelIds,
    reason: unsupportedModelIds.length ? '部分模型的 API 协议不受当前运行时支持。' : '可直接使用 Frakio Model Center 配置。',
  };
}

async function setModelSecret(modelId, apiKey) {
  const clean = String(apiKey || '').trim();
  if (!clean) return;
  const secrets = await readSecrets();
  secrets.models = secrets.models || {};
  secrets.models[modelId] = { apiKey: clean, updatedAt: now() };
  await writeSecrets(secrets);
}

async function deleteModelSecret(modelId) {
  const secrets = await readSecrets();
  if (secrets.models?.[modelId]) {
    delete secrets.models[modelId];
    await writeSecrets(secrets);
  }
}

function resolveDefaultAgentId(state, agents = state.agents || []) {
  const ids = new Set((agents || []).map((agent) => agent.id));
  const preferred = state?.ui?.defaultAgentId;
  if (ids.has(preferred)) return preferred;
  if (ids.has('iris')) return 'iris';
  return agents[0]?.id || '';
}

function mixHexWithColor(hexValue, targetValue, targetRatio) {
  const hex = /^#[0-9a-fA-F]{6}$/;
  const source = hex.test(String(hexValue || '')) ? String(hexValue) : defaultSpaceTheme.accentColor;
  const target = hex.test(String(targetValue || '')) ? String(targetValue) : '#11131a';
  const ratio = Math.max(0, Math.min(1, Number(targetRatio) || 0));
  const read = (value, offset) => Number.parseInt(value.slice(offset, offset + 2), 16);
  const channel = (offset) => Math.round(read(source, offset) * (1 - ratio) + read(target, offset) * ratio).toString(16).padStart(2, '0');
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

function normalizeSpaceThemePalette(theme = {}, fallback = defaultSpaceTheme) {
  const hex = /^#[0-9a-fA-F]{6}$/;
  const accentColor = hex.test(String(theme.accentColor || '')) ? String(theme.accentColor) : fallback.accentColor;
  const sidebarBg = hex.test(String(theme.sidebarBg || '')) ? String(theme.sidebarBg) : fallback.sidebarBg;
  const sourceColors = Array.isArray(theme.gradientColors) ? theme.gradientColors : [];
  const gradientColors = sourceColors
    .filter((color) => hex.test(String(color?.color || '')))
    .slice(0, 3)
    .map((color, index) => ({
      id: String(color.id || `color_${index}`).slice(0, 32),
      color: String(color.color),
      x: Math.max(0, Math.min(1, Number.isFinite(Number(color.x)) ? Number(color.x) : (index === 0 ? 0.18 : index === 1 ? 0.62 : 0.38))),
      y: Math.max(0, Math.min(1, Number.isFinite(Number(color.y)) ? Number(color.y) : (index === 0 ? 0.72 : index === 1 ? 0.28 : 0.27))),
      isPrimary: Boolean(color.isPrimary),
    }));
  if (!gradientColors.length) gradientColors.push({ id: 'primary', color: accentColor, x: 0.18, y: 0.72, isPrimary: true });
  const primaryIndex = Math.max(0, gradientColors.findIndex((color) => color.isPrimary));
  const texture = Math.max(0, Math.min(1, Number(theme.texture ?? ((theme.noise ?? fallback.noise) / 0.35)) || 0));
  return {
    accentColor,
    sidebarBg,
    opacity: Math.max(0.3, Math.min(0.9, Number(theme.opacity ?? fallback.opacity) || fallback.opacity)),
    noise: Math.max(0, Math.min(0.35, Number(theme.noise ?? texture * 0.35) || 0)),
    texture,
    mode: theme.mode === 'crisp' ? 'crisp' : fallback.mode,
    gradientColors: gradientColors.map((color, index) => ({ ...color, isPrimary: index === primaryIndex })),
  };
}

function deriveDarkSpaceThemePalette(theme = defaultSpaceTheme) {
  const colors = (theme.gradientColors || defaultSpaceTheme.gradientColors).map((color) => ({
    ...color,
    color: mixHexWithColor(color.color, '#11131a', 0.46),
  }));
  const primary = colors.find((color) => color.isPrimary) || colors[0];
  return {
    ...theme,
    accentColor: primary?.color || mixHexWithColor(theme.accentColor, '#11131a', 0.46),
    sidebarBg: mixHexWithColor(theme.sidebarBg || theme.accentColor, '#12151c', 0.68),
    opacity: Math.max(theme.opacity || defaultSpaceTheme.opacity, 0.76),
    mode: 'crisp',
    gradientColors: colors,
  };
}

function normalizeSpaceTheme(theme = {}) {
  theme = migrateSpaceTheme(theme);
  const colorMode = theme.colorMode === 'native' ? 'native' : 'custom';
  const appearance = theme.appearance === 'auto' || theme.appearance === 'dark' || theme.appearance === 'light' ? theme.appearance : 'light';
  const legacyPalette = normalizeSpaceThemePalette(theme);
  const lightTheme = normalizeSpaceThemePalette(theme.lightTheme || legacyPalette, legacyPalette);
  const darkTheme = normalizeSpaceThemePalette(theme.darkTheme || deriveDarkSpaceThemePalette(lightTheme), deriveDarkSpaceThemePalette(lightTheme));
  const activePalette = appearance === 'dark' ? darkTheme : legacyPalette;
  return {
    ...activePalette,
    colorMode,
    appearance,
    lightTheme,
    darkTheme,
    renderVersion: SPACE_THEME_RENDER_VERSION,
  };
}

function normalizeSpace(space = {}, fallbackName = 'Frakio Work') {
  const iconKind = space.iconKind === 'icon' ? 'icon' : space.iconKind === 'emoji' ? 'emoji' : 'dot';
  return {
    id: space.id || id('space'),
    name: String(space.name || fallbackName).slice(0, 60),
    iconKind,
    iconValue: String(space.iconValue || '').slice(0, 16),
    theme: normalizeSpaceTheme(space.theme),
    archivedAt: space.archivedAt || null,
    createdAt: space.createdAt || now(),
    updatedAt: space.updatedAt || now(),
    lastOpenedAt: space.lastOpenedAt || null,
  };
}

function agentProfileRevision(agent = {}) {
  const runtimePolicy = normalizeRuntimePolicy(agent.runtimePolicy, { hasHermesProfile: Boolean(agent.profileName) });
  return createHash('sha256').update(JSON.stringify({
    name: String(agent.name || ''),
    role: String(agent.role || ''),
    soul: String(agent.soul || agent.scope || ''),
    scope: String(agent.scope || ''),
    userProfile: String(agent.userProfile || ''),
    runtimePolicy,
  })).digest('hex').slice(0, 20);
}

function agentProfileSnapshot(agent) {
  const runtimePolicy = normalizeRuntimePolicy(agent?.runtimePolicy, { hasHermesProfile: Boolean(agent?.profileName) });
  return {
    agentId: agent.id,
    revision: agentProfileRevision(agent),
    name: agent.name,
    role: agent.role || 'Agent',
    soul: agent.soul || agent.scope || '',
    scope: agent.scope || '',
    userProfile: agent.userProfile || '',
    runtimePolicy,
    createdAt: now(),
  };
}

function normalizeState(state) {
  const base = defaultState();
  const sidebarSettings = normalizeWorkbenchSidebarSettings(state?.ui || {});
  const { conversationTransition: _removedConversationTransition, ...uiWithoutConversationTransition } = state?.ui || {};
  const { divisions: _legacyDivisions, orgEdges: _legacyOrgEdges, ...stateWithoutDivisions } = state || {};
  const sourceAgents = Array.isArray(state.agents) ? state.agents : base.agents;
  const agents = sourceAgents.filter((agent) => !isSystemHermesProfile(agent.profileName, agent.id));
  const agentIds = new Set(agents.map((agent) => agent.id));
  const defaultAgentId = resolveDefaultAgentId(state, agents);
  const sourceVaults = Array.isArray(state.vaults) ? state.vaults : base.vaults;
  const sourceSpaces = state.spaces?.length ? state.spaces : base.spaces;
  const normalizedSpaces = sourceSpaces.map((space, index) => {
    const legacyDefault = space.id === 'space_default'
      && String(space.theme?.accentColor || '').toLowerCase() === '#8b8cf6'
      && String(space.theme?.sidebarBg || '').toLowerCase() === '#f3f4ff';
    return normalizeSpace(legacyDefault ? { ...space, theme: defaultSpaceTheme } : space, index === 0 ? 'Frakio Work' : 'Workspace');
  });
  const fallbackSpaceId = normalizedSpaces[0]?.id || 'space_default';
  const spaceIds = new Set(normalizedSpaces.map((space) => space.id));
  const activeSpaceId = spaceIds.has(state.ui?.activeSpaceId) ? state.ui.activeSpaceId : fallbackSpaceId;
  const sourceWorkspaces = state.workspaces?.length ? state.workspaces : base.workspaces;
  const normalizedWorkspaces = sourceWorkspaces.map((workspace) => {
    const hasVaultId = Object.prototype.hasOwnProperty.call(workspace, 'vaultId');
    const requestedVaultId = workspace.vaultId || workspace.defaultVaultId || workspace.vault_id;
    const vault = sourceVaults.find((item) => item.id === requestedVaultId)
      || (!hasVaultId ? sourceVaults.find((item) => item.id === state.defaultVaultId) || sourceVaults[0] : null);
    return {
      id: workspace.id || id('workspace'),
      spaceId: spaceIds.has(workspace.spaceId) ? workspace.spaceId : fallbackSpaceId,
      name: String(workspace.name || 'Frakio Work').slice(0, 60),
      rootPath: path.resolve(String(workspace.rootPath || workspace.path || vault?.path || projectRoot)),
      vaultId: hasVaultId ? (sourceVaults.some((item) => item.id === workspace.vaultId) ? workspace.vaultId : null) : vault?.id || null,
      primaryVaultId: sourceVaults.some((item) => item.id === (workspace.primaryVaultId || workspace.vaultId))
        ? (workspace.primaryVaultId || workspace.vaultId)
        : null,
      sharedVaultIds: Array.from(new Set(Array.isArray(workspace.sharedVaultIds) ? workspace.sharedVaultIds : []))
        .filter((vaultId) => sourceVaults.some((item) => item.id === vaultId)),
      writableVaultIds: Array.from(new Set([
        ...(Array.isArray(workspace.writableVaultIds) ? workspace.writableVaultIds : []),
        workspace.primaryVaultId || workspace.vaultId || '',
      ])).filter((vaultId) => sourceVaults.some((item) => item.id === vaultId)),
      environment: workspace.environment || 'local',
      activeThreadId: workspace.activeThreadId || null,
      archivedAt: workspace.archivedAt || null,
      pinnedAt: workspace.pinnedAt || null,
      createdAt: workspace.createdAt || now(),
      updatedAt: workspace.updatedAt || now(),
    };
  });
  const workspaceById = new Map(normalizedWorkspaces.map((workspace) => [workspace.id, workspace]));
  const normalizedModels = normalizeModels(Array.isArray(state.models) ? state.models : base.models).filter((model) => !isBadHermesStudioModel(model) && !isPlaceholderModel(model) && model.source !== 'hermes-profile');
  const defaultModel = normalizedModels.some((model) => model.id === state.ui?.defaultModel)
    ? state.ui.defaultModel
    : '';
  return {
    ...base,
    ...stateWithoutDivisions,
    version: 6,
    features: {
      ...base.features,
      ...(state.features || {}),
    },
    integrations: {
      ...base.integrations,
      ...(state.integrations || {}),
      hermesStudio: { ...base.integrations.hermesStudio, ...(state.integrations?.hermesStudio || {}) },
      hermesAgent: {
        ...base.integrations.hermesAgent,
        ...(state.integrations?.hermesAgent || {}),
        gatewayAutoStart: {
          ...base.integrations.hermesAgent.gatewayAutoStart,
          ...(state.integrations?.hermesAgent?.gatewayAutoStart || {}),
        },
      },
    },
    ui: {
      ...base.ui,
      ...uiWithoutConversationTransition,
      activeSpaceId,
      defaultAgentId,
      fallbackDecisionAgentId: agentIds.has(state.ui?.fallbackDecisionAgentId) ? state.ui.fallbackDecisionAgentId : (agentIds.has('iris') ? 'iris' : defaultAgentId),
      ...sidebarSettings,
      defaultModel,
      appearance: ['system', 'light', 'dark'].includes(state.ui?.appearance) ? state.ui.appearance : 'system',
      agentMentionMaxDepth: normalizeAgentMentionMaxDepth(state.ui?.agentMentionMaxDepth, 2),
      pinnedNav: { ...defaultPinnedNav, ...(state.ui?.pinnedNav || {}) },
    },
    userProfile: normalizeUserProfile(state.userProfile || base.userProfile),
    observability: {
      modelUsage: Array.isArray(state.observability?.modelUsage) ? state.observability.modelUsage.slice(-800) : [],
      modelRuns: Array.isArray(state.observability?.modelRuns) ? state.observability.modelRuns.slice(-200) : [],
      systemEvents: Array.isArray(state.observability?.systemEvents) ? state.observability.systemEvents.slice(-400) : [],
    },
    spaces: normalizedSpaces,
    workspaces: normalizedWorkspaces,
    models: normalizedModels,
    agents: agents.map((agent) => {
      const runtimePolicyInput = Number(state?.version || 0) < 5
        ? {
          ...(agent.runtimePolicy || {}),
          allowedRuntimeIds: Array.from(new Set([
            ...(Array.isArray(agent.runtimePolicy?.allowedRuntimeIds) ? agent.runtimePolicy.allowedRuntimeIds : []),
            'hermes', 'pi', 'codex', 'claude', 'gemini',
          ])),
        }
        : agent.runtimePolicy;
      const normalizedAgent = {
        ...agent,
      model: (() => {
        if (String(agent.model || '').trim()) {
          const resolved = resolveModelSelection(agent.model, normalizedModels);
          return resolved.selectionValue || String(agent.model).trim();
        }
        if (Number(state?.version || 0) >= 6) return '';
        const legacyValues = [
          agent.runtimePolicy?.defaultModelByRuntime?.hermes,
          agent.runtimePolicy?.defaultModelByRuntime?.pi,
        ].filter(Boolean);
        for (const legacyValue of legacyValues) {
          const resolved = resolveModelSelection(legacyValue, normalizedModels);
          if (resolved.selectedModel) return resolved.selectionValue;
        }
        return '';
      })(),
      soul: agent.soul || agent.scope || '',
      source: agent.source || 'demo',
      profileName: agent.profileName || '',
      gatewayStatus: agent.gatewayStatus || '',
      soulExcerpt: agent.soulExcerpt || '',
      userProfileExcerpt: agent.userProfileExcerpt || '',
      memoryExcerpt: agent.memoryExcerpt || '',
      userProfile: agent.userProfile || '',
      memory: agent.memory || '',
      providerSummary: Array.isArray(agent.providerSummary) ? agent.providerSummary : [],
      skills: Array.isArray(agent.skills) ? agent.skills : [],
      plugins: Array.isArray(agent.plugins) ? agent.plugins : [],
      avatarUrl: agent.avatarUrl || '',
      runtimePolicy: normalizeRuntimePolicy(runtimePolicyInput, { hasHermesProfile: Boolean(agent.profileName) }),
      };
      return { ...normalizedAgent, profileRevision: agentProfileRevision(normalizedAgent) };
    }),
    vaults: sourceVaults,
    threads: (Array.isArray(state.threads) ? state.threads : base.threads).map((thread) => {
      const hasVaultId = Object.prototype.hasOwnProperty.call(thread, 'vaultId');
      return {
      ...thread,
      spaceId: spaceIds.has(thread.spaceId)
        ? thread.spaceId
        : (workspaceById.get(thread.workspaceId)?.spaceId || activeSpaceId || fallbackSpaceId),
      mode: thread.mode || 'workspace',
      executionMode: thread.executionMode === 'work' ? 'work' : 'chat',
      ...normalizeThreadPlans(thread),
      workerOutputMode: thread.workerOutputMode === 'all' ? 'all' : 'summary',
      workspaceId: thread.mode === 'direct' ? null : (workspaceById.has(thread.workspaceId) ? thread.workspaceId : normalizedWorkspaces[0]?.id || null),
      primaryAgentId: agentIds.has(thread.primaryAgentId) ? thread.primaryAgentId : defaultAgentId,
      defaultAgentId: agentIds.has(thread.defaultAgentId) ? thread.defaultAgentId : defaultAgentId,
      activeAgentId: agentIds.has(thread.activeAgentId) ? thread.activeAgentId : (agentIds.has(thread.primaryAgentId) ? thread.primaryAgentId : defaultAgentId),
      followMode: thread.followMode === 'conversation' ? 'conversation' : 'default',
      vaultId: thread.mode === 'direct'
        ? null
        : hasVaultId
          ? (sourceVaults.some((item) => item.id === thread.vaultId) ? thread.vaultId : null)
          : (workspaceById.get(thread.workspaceId)?.vaultId || normalizedWorkspaces[0]?.vaultId || null),
      permissionMode: ['manual', 'smart', 'off'].includes(thread.permissionMode) ? thread.permissionMode : 'smart',
      selectedAgents: Array.isArray(thread.selectedAgents) ? thread.selectedAgents.filter((agentId) => agentIds.has(agentId)) : [],
      agentModelOverrides: normalizeAgentModelOverrides(thread.agentModelOverrides, agents, normalizedModels),
      agentRunOverrides: normalizeAgentRunOverrides(thread.agentRunOverrides, agents),
      agentRuntimeOverrides: normalizeAgentRuntimeOverrides(thread.agentRuntimeOverrides, agents),
      workflow: Array.isArray(thread.workflow) ? thread.workflow : [],
      proposals: Array.isArray(thread.proposals) ? thread.proposals : [],
      messages: Array.isArray(thread.messages) ? thread.messages : [],
      engine: ['simulate', 'hermes-studio', 'model-provider', 'workspace-group', 'hermes-agent'].includes(thread.engine) ? thread.engine : 'simulate',
      externalSessionId: thread.externalSessionId || null,
      runtimeId: String(thread.runtimeId || 'hermes'),
      runtimeSessionIds: thread.runtimeSessionIds && typeof thread.runtimeSessionIds === 'object' ? thread.runtimeSessionIds : {},
      activeWorkRuns: thread.activeWorkRuns && typeof thread.activeWorkRuns === 'object' ? thread.activeWorkRuns : {},
      artifacts: Array.isArray(thread.artifacts) ? thread.artifacts : [],
      workflowState: Array.isArray(thread.workflowState) ? thread.workflowState : [],
      runTranscripts: normalizeRunTranscripts(thread.runTranscripts),
      collaboration: normalizeCollaboration(thread.collaboration, { defaultAgentId, activeAgentId: thread.activeAgentId || thread.primaryAgentId }),
      runStatus: ['idle', 'running', 'failed'].includes(thread.runStatus) ? thread.runStatus : 'idle',
      archivedAt: thread.archivedAt || null,
      pinnedAt: thread.pinnedAt || null,
      updatedAt: thread.updatedAt || now(),
    };
    }),
  };
}

function normalizeCollaboration(collaboration = {}, fallback = {}) {
  const normalized = normalizeThreadCollaboration(collaboration, { ...fallback, kind: collaboration.kind || 'workspace-group-chat' });
  normalized.maxMentionDepth = normalizeAgentMentionMaxDepth(normalized.maxMentionDepth, 2);
  return normalized;
}

function normalizeAgentModelOverrides(overrides, agents = [], models = []) {
  const agentIds = new Set((agents || []).map((agent) => agent.id));
  const normalizedModels = normalizeModels(models || []);
  const normalized = [];
  for (const [agentId, rawSelection] of Object.entries(overrides || {})) {
    if (!agentIds.has(agentId)) continue;
    const { modelId, modelName } = splitModelSelection(String(rawSelection || ''));
    const model = normalizedModels.find((item) => item.id === modelId);
    if (!model) continue;
    const availableNames = normalizeModelNames(model.models, model.model);
    const selectedName = modelName || model.model || availableNames[0] || '';
    if (!selectedName || !availableNames.includes(selectedName)) continue;
    normalized.push([agentId, `${model.id}::${selectedName}`]);
  }
  return Object.fromEntries(normalized);
}

function normalizeAgentRunOverrides(overrides, agents = []) {
  const agentIds = new Set((agents || []).map((agent) => agent.id));
  const normalized = [];
  for (const [agentId, raw] of Object.entries(overrides && typeof overrides === 'object' ? overrides : {})) {
    if (!agentIds.has(agentId) || !raw || typeof raw !== 'object') continue;
    const reasoningEffortRaw = String(raw.reasoningEffort || '').trim().toLowerCase().slice(0, 40);
    const reasoningEffort = /^[a-z0-9_-]+$/.test(reasoningEffortRaw) && !['unsupported', 'unknown', 'default'].includes(reasoningEffortRaw) ? reasoningEffortRaw : '';
    const speedMode = String(raw.speedMode || raw.serviceTier || '').trim().toLowerCase().slice(0, 60);
    if (!reasoningEffort && !speedMode) continue;
    normalized.push([agentId, {
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(speedMode ? { speedMode } : {}),
    }]);
  }
  return Object.fromEntries(normalized);
}

function normalizeAgentRuntimeOverrides(overrides, agents = []) {
  const agentById = new Map((agents || []).map((agent) => [agent.id, agent]));
  return Object.fromEntries(Object.entries(overrides && typeof overrides === 'object' ? overrides : {})
    .map(([agentId, runtimeId]) => [agentId, String(runtimeId || '').trim()])
    .filter(([agentId, runtimeId]) => {
      const agent = agentById.get(agentId);
      if (!agent || !runtimeId) return false;
      return normalizeRuntimePolicy(agent.runtimePolicy, { hasHermesProfile: Boolean(agent.profileName) }).allowedRuntimeIds.includes(runtimeId);
    }));
}

function isStudioBaseUrl(baseUrl) {
  const value = String(baseUrl || '').replace('localhost', '127.0.0.1').replace(/\/$/, '');
  return /^http:\/\/127\.0\.0\.1:(8748|8648|8787)$/.test(value);
}

function isBadHermesStudioModel(model) {
  return model?.source === 'hermes-studio' && (isStudioBaseUrl(model.baseUrl) || String(model.id || '').startsWith('model_hermes_studio_'));
}

function isPlaceholderModel(model) {
  return String(model?.id || '').startsWith('model_hermes_') && !model?.baseUrl && ['Hermes', 'Custom'].includes(String(model?.provider || ''));
}

function comparableBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '').toLowerCase();
}

function verificationRoutePrefix(model) {
  return [String(model?.providerKey || '').trim(), String(model?.apiMode || '').trim(), comparableBaseUrl(model?.baseUrl)].join('::') + '::';
}

function credentialOrigin(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' ? url.origin.toLowerCase() : '';
  } catch {
    return '';
  }
}

function canReuseCredentialForBaseUrl(savedBaseUrl, requestedBaseUrl) {
  const savedOrigin = credentialOrigin(savedBaseUrl);
  return Boolean(savedOrigin && savedOrigin === credentialOrigin(requestedBaseUrl));
}

async function credentialForModelDraft(savedModel, requestedBaseUrl, explicitApiKey, models = []) {
  const provided = String(explicitApiKey || '').trim();
  if (provided) return provided;
  const reusable = await getReusableModelSecret(savedModel, models);
  if (!reusable) return '';
  if (!canReuseCredentialForBaseUrl(savedModel.baseUrl, requestedBaseUrl)) {
    throw Object.assign(new Error('Base URL 的地址已变化，请重新输入 API Key。'), { status: 400 });
  }
  return reusable;
}

function customProviderBaseName(model) {
  const provider = String(model?.provider || '').trim();
  const preferred = provider && !/^custom$/i.test(provider) ? provider : String(model?.name || '').trim();
  if (preferred) return slug(preferred);
  try {
    return slug(new URL(String(model?.baseUrl || '')).hostname.replace(/^api\./, ''));
  } catch {
    return slug(model?.id || 'provider');
  }
}

function normalizeApiModePreference(value, fallbackApiMode = '') {
  const clean = String(value || '').trim();
  if (['auto', 'chat_completions', 'openai_responses', 'anthropic_messages'].includes(clean)) return clean;
  const legacy = normalizeApiMode(fallbackApiMode);
  if (legacy === 'codex_responses' || legacy === 'openai_responses') return 'openai_responses';
  if (legacy === 'anthropic_messages') return 'anthropic_messages';
  return 'chat_completions';
}

function runtimeApiMode(value) {
  const clean = String(value || '').trim();
  return clean === 'openai_responses' ? 'codex_responses' : normalizeApiMode(clean);
}

function modelRuntimeRevision(model = {}) {
  const existing = String(model.runtimeRevision || '').trim();
  if (existing) return existing.slice(0, 100);
  return createHash('sha256').update(JSON.stringify({
    providerKey: model.providerKey || '',
    baseUrl: comparableBaseUrl(model.baseUrl),
    apiMode: runtimeApiMode(model.apiMode),
    apiModePreference: normalizeApiModePreference(model.apiModePreference, model.apiMode),
    model: model.model || '',
    modelApiModes: normalizeModelApiModes(model.modelApiModes),
    compat: normalizeModelCompat(model.compat),
    modelCompat: normalizeModelCompatMap(model.modelCompat),
    capabilityMode: model.capabilityMode === 'manual' ? 'manual' : 'auto',
    capabilityOverrides: normalizeCapabilityOverrides(model.capabilityOverrides),
  })).digest('hex').slice(0, 20);
}

function newRuntimeRevision() {
  return `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

function normalizeModels(models) {
  const normalized = models.map((model) => ({
    id: model.id || id('model'),
    name: String(model.name || model.model || '自定义模型').trim().slice(0, 60),
    provider: String(model.provider || 'Custom').trim().slice(0, 40),
    kind: ['official', 'relay', 'local'].includes(model.kind) ? model.kind : 'official',
    protocol: ['OpenAI Compatible', 'Anthropic Compatible', 'Custom'].includes(model.protocol) ? model.protocol : 'OpenAI Compatible',
    model: String(model.model || '').trim().slice(0, 100),
    models: normalizeModelNames(model.models, model.model),
    baseUrl: String(model.baseUrl || '').trim().slice(0, 240),
    apiKey: '',
    apiKeyState: model.apiKeyState || (String(model.apiKey || '').trim() ? 'provided' : ''),
    source: ['demo', 'hermes-studio', 'hermes-profile', 'manual'].includes(model.source) ? model.source : 'manual',
    profileName: String(model.profileName || '').trim().slice(0, 80),
    providerKey: String(model.providerKey || '').trim().slice(0, 120),
    oauthAccountId: String(model.oauthAccountId || '').trim().slice(0, 160),
    apiMode: runtimeApiMode(model.apiMode),
    apiModePreference: normalizeApiModePreference(model.apiModePreference, model.apiMode),
    modelsUrl: String(model.modelsUrl || '').trim().slice(0, 300),
    modelApiModes: normalizeModelApiModes(model.modelApiModes),
    compat: normalizeModelCompat(model.compat),
    modelCompat: normalizeModelCompatMap(model.modelCompat),
    contextLimit: Number.isFinite(Number(model.contextLimit)) ? Number(model.contextLimit) : null,
    capabilityMode: model.capabilityMode === 'manual' ? 'manual' : 'auto',
    capabilityOverrides: normalizeCapabilityOverrides(model.capabilityOverrides),
    pricing: normalizeModelPricing(model.pricing),
    runtimeRevision: '',
  }));
  const usedKeys = new Map();
  const presets = loadProviderPresets();
  for (const model of normalized) {
    if (comparableBaseUrl(model.baseUrl) === 'https://api.ikuncode.cc/v1') {
      model.providerKey = 'ikuncode';
      model.apiMode = 'codex_responses';
      model.protocol = 'OpenAI Compatible';
    }
    let providerKey = String(model.providerKey || '').trim();
    if (!providerKey && model.baseUrl) {
      const preset = presets.find((item) => comparableBaseUrl(item.baseUrl) === comparableBaseUrl(model.baseUrl));
      providerKey = preset?.value || `custom:${customProviderBaseName(model)}`;
    }
    if (providerKey) {
      const signature = `${comparableBaseUrl(model.baseUrl)}|${String(model.apiMode || '')}`;
      const existingSignature = usedKeys.get(providerKey);
      if (existingSignature && existingSignature !== signature && providerKey.startsWith('custom:')) {
        providerKey = `${providerKey}-${slug(model.id).slice(-6)}`;
      }
      usedKeys.set(providerKey, signature);
    }
    model.providerKey = providerKey.slice(0, 120);
    model.runtimeRevision = modelRuntimeRevision({ ...model, runtimeRevision: models.find((item) => item?.id === model.id)?.runtimeRevision });
  }
  return normalized;
}

function normalizeModelNames(models, fallback = '') {
  const rows = Array.isArray(models) ? models : [];
  const names = [...rows, fallback]
    .map((item) => String(item || '').trim().slice(0, 100))
    .filter(Boolean);
  return Array.from(new Set(names));
}

function normalizeModelPricing(pricing = {}) {
  const normalizePrice = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  return {
    input: normalizePrice(pricing.input),
    output: normalizePrice(pricing.output),
    cacheRead: normalizePrice(pricing.cacheRead),
    cacheCreation: normalizePrice(pricing.cacheCreation),
  };
}

function normalizeModelApiModes(value) {
  return Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {})
    .map(([modelId, apiMode]) => [String(modelId || '').trim().slice(0, 100), normalizeApiMode(apiMode)])
    .filter(([modelId, apiMode]) => modelId && apiMode));
}

function normalizeModelCompat(value = {}) {
  const thinkingFormat = CHAT_THINKING_FORMATS.includes(value.thinkingFormat) ? value.thinkingFormat : 'openai';
  const requestOverrides = {};
  for (const [key, raw] of Object.entries(value.requestOverrides && typeof value.requestOverrides === 'object' ? value.requestOverrides : {})) {
    const normalizedKey = String(key || '').trim().slice(0, 80);
    if (!normalizedKey || /^(authorization|api[-_]?key|x-api-key|host|content-length|stream|stream_options|transfer-encoding|connection|proxy-authorization|x-forwarded-)/i.test(normalizedKey)) continue;
    requestOverrides[normalizedKey] = raw;
  }
  return { thinkingFormat, requestOverrides };
}

function normalizeModelCompatMap(value) {
  return Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {})
    .map(([modelId, compat]) => [String(modelId || '').trim().slice(0, 100), normalizeModelCompat(compat)])
    .filter(([modelId]) => modelId));
}

function publicModel(model) {
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    kind: model.kind,
    protocol: model.protocol,
    model: model.model,
    models: model.models || normalizeModelNames([], model.model),
    baseUrl: model.baseUrl,
    hasApiKey: Boolean(model.apiKeyState),
    source: model.source || 'manual',
    profileName: model.profileName || '',
    providerKey: model.providerKey || '',
    oauthAccountId: model.oauthAccountId || '',
    oauthAccountBindingRequired: Boolean(oauthProviderKeys.has(model.providerKey) && !model.oauthAccountId),
    apiMode: model.apiMode || '',
    apiModePreference: normalizeApiModePreference(model.apiModePreference, model.apiMode),
    modelsUrl: model.modelsUrl || '',
    modelApiModes: normalizeModelApiModes(model.modelApiModes),
    compat: normalizeModelCompat(model.compat),
    modelCompat: normalizeModelCompatMap(model.modelCompat),
    contextLimit: model.contextLimit || null,
    capabilityMode: model.capabilityMode === 'manual' ? 'manual' : 'auto',
    capabilityOverrides: model.capabilityMode === 'manual' ? normalizeCapabilityOverrides(model.capabilityOverrides) : {},
    pricing: normalizeModelPricing(model.pricing),
    runtimeRevision: modelRuntimeRevision(model),
  };
}

function slug(value) {
  return String(value || 'default').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'default';
}

function titleCaseProfile(profile) {
  if (profile === 'default') return 'Hermes Default';
  return profile.split(/[-_]/).filter(Boolean).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(' ') || profile;
}

function compactText(raw, limit = 520) {
  return String(raw || '')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed === '---') return false;
      return !/(api[_-]?key|token|password|secret)\s*[:=]/i.test(trimmed);
    })
    .slice(0, 10)
    .join('\n')
    .slice(0, limit);
}

function fullProfileText(raw, limit = 12000) {
  return String(raw || '')
    .split('\n')
    .filter((line) => !/(api[_-]?key|token|password|secret)\s*[:=]/i.test(line.trim()))
    .join('\n')
    .trim()
    .slice(0, limit);
}

async function readProfileText(filePath, limit = 12000) {
  try {
    return fullProfileText(await readFile(filePath, 'utf8'), limit);
  } catch {
    return '';
  }
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

async function profileDirForName(profileName) {
  const clean = slug(profileName || '');
  if (!clean) return null;
  const candidates = clean === 'default'
    ? [path.join(hermesHome, 'profiles', 'default'), hermesHome]
    : [path.join(hermesHome, 'profiles', clean)];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (!isInside(hermesHome, resolved)) continue;
    if (await exists(resolved)) return resolved;
  }
  return null;
}

async function findProfileAvatar(dir, profileName) {
  const assetsDir = path.join(dir, 'assets');
  try {
    const entries = await readdir(assetsDir, { withFileTypes: true });
    const avatar = entries.find((entry) => entry.isFile() && /^avatar\.(png|jpe?g|webp|gif)$/i.test(entry.name));
    if (!avatar) return '';
    const avatarPath = path.join(assetsDir, avatar.name);
    const fileStat = await stat(avatarPath);
    return `/api/hermes-profiles/${encodeURIComponent(profileName)}/avatar?v=${Math.round(fileStat.mtimeMs)}`;
  } catch {
    return '';
  }
}

function compactOneLine(value, limit = 180) {
  return compactText(String(value || '').replace(/\s+/g, ' '), limit);
}

function isDefaultHermesSoul(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  return text.startsWith('You are Hermes Agent, an intelligent AI assistant created by Nous Research.');
}

function usefulProfileText(value) {
  const text = String(value || '').trim();
  return text && !isDefaultHermesSoul(text) ? text : '';
}

function profileTextOrExisting(profileValue, existingValue = '') {
  const text = usefulProfileText(profileValue);
  return text || String(existingValue || '').trim();
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) || {};
  } catch {
    return {};
  }
}

function splitSkillMarkdown(raw) {
  const text = String(raw || '');
  if (!text.startsWith('---')) return { meta: {}, body: text };
  const endIndex = text.indexOf('\n---', 3);
  if (endIndex < 0) return { meta: {}, body: text };
  const frontmatter = text.slice(3, endIndex).trim();
  const body = text.slice(endIndex + 4).trim();
  try {
    return { meta: YAML.parse(frontmatter) || {}, body };
  } catch {
    return { meta: {}, body };
  }
}

function skillDescriptionFromMarkdown(raw) {
  const { meta, body } = splitSkillMarkdown(raw);
  const description = meta.description || meta.summary || '';
  if (description) return compactOneLine(description);
  const firstParagraph = body
    .split(/\n\s*\n/)
    .map((part) => part.replace(/^#+\s+.*$/gm, '').trim())
    .find(Boolean);
  return compactOneLine(firstParagraph || '');
}

function skillNameFromMarkdown(raw, fallback) {
  const { meta } = splitSkillMarkdown(raw);
  return String(meta.name || fallback || '').trim() || fallback;
}

function skillCategoryFromName(name, filePath) {
  const relative = String(filePath || '').split('/skills/')[1] || '';
  const parts = relative.split('/').filter(Boolean);
  return parts.length > 2 ? parts[0] : 'local';
}

async function findFilesByName(root, fileName, maxDepth = 4) {
  const out = [];
  async function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.codex-plugin') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(fullPath, depth + 1);
      else if (entry.isFile() && entry.name === fileName) out.push(fullPath);
    }
  }
  await walk(root, 0);
  return out;
}

function disabledSkillsFromConfig(config) {
  return new Set(Array.isArray(config?.skills?.disabled) ? config.skills.disabled.map(String) : []);
}

function pluginStatusFromConfig(config, name) {
  const enabled = Array.isArray(config?.plugins?.enabled) ? config.plugins.enabled.map(String) : [];
  const disabled = Array.isArray(config?.plugins?.disabled) ? config.plugins.disabled.map(String) : [];
  if (disabled.includes(name)) return { enabled: false, status: 'disabled', statusLabel: '未启用' };
  if (enabled.includes(name)) return { enabled: true, status: 'enabled', statusLabel: '已启用' };
  return { enabled: false, status: 'installed', statusLabel: '已安装' };
}

async function editableSkillEntries(dir, config = {}) {
  const skillsDir = path.join(dir, 'skills');
  try {
    const skillFiles = await findFilesByName(skillsDir, 'SKILL.md', 4);
    const rows = [];
    const disabled = disabledSkillsFromConfig(config);
    const usage = await readJsonFile(path.join(skillsDir, '.usage.json'));
    for (const filePath of skillFiles) {
      const relative = path.relative(skillsDir, path.dirname(filePath));
      if (!relative || relative.startsWith('..') || relative.split(path.sep).some((part) => part.startsWith('.'))) continue;
      const raw = await readFile(filePath, 'utf8').catch(() => '');
      const name = skillNameFromMarkdown(raw, path.basename(path.dirname(filePath)));
      const usageRow = usage?.[name] || {};
      rows.push({
        name,
        file: `skills/${relative.split(path.sep).join('/')}/SKILL.md`,
        description: skillDescriptionFromMarkdown(raw),
        category: skillCategoryFromName(name, filePath),
        enabled: !disabled.has(name),
        source: 'profile',
        usage: {
          useCount: Number(usageRow.use_count || 0),
          viewCount: Number(usageRow.view_count || 0),
          patchCount: Number(usageRow.patch_count || 0),
          state: String(usageRow.state || ''),
          lastUsedAt: usageRow.last_used_at || null,
        },
      });
    }
    return rows
      .filter((row, index, arr) => arr.findIndex((item) => item.name === row.name) === index)
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 160);
  } catch {
    return [];
  }
}

async function editablePluginEntries(dir, profileName, config = {}) {
  const pluginRoots = [path.join(hermesHome, 'plugins'), path.join(dir, 'plugins')];
  const rows = [];
  for (const pluginsDir of pluginRoots) {
    try {
      const entries = await readdir(pluginsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const yamlPath = path.join(pluginsDir, entry.name, 'plugin.yaml');
        const jsonPath = path.join(pluginsDir, entry.name, 'plugin.json');
        const filePath = await exists(yamlPath) ? yamlPath : await exists(jsonPath) ? jsonPath : '';
        const relativeFile = filePath && isInside(dir, filePath)
          ? path.relative(dir, filePath)
          : filePath && isInside(hermesHome, filePath)
            ? path.relative(hermesHome, filePath)
            : '';
        const isProfileLocal = isInside(dir, path.join(pluginsDir, entry.name));
        rows.push({
          name: entry.name,
          file: relativeFile,
          source: isProfileLocal ? 'profile' : 'global',
          ...pluginStatusFromConfig(config, entry.name),
        });
      }
    } catch {
      // Plugins are optional for a profile.
    }
  }
  return rows
    .filter((row, index, arr) => arr.findIndex((item) => item.name === row.name) === index)
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 80);
}

let hermesModuleMutationQueue = Promise.resolve();

function managedModuleKind(value) {
  const kind = String(value || '').trim();
  if (!['skill', 'plugin'].includes(kind)) {
    const error = new Error('模块类型必须是 skill 或 plugin。');
    error.status = 400;
    throw error;
  }
  return kind;
}

function managedModuleScope(value) {
  const scope = String(value || '').trim();
  if (!['global', 'profile'].includes(scope)) {
    const error = new Error('模块范围必须是 global 或 profile。');
    error.status = 400;
    throw error;
  }
  return scope;
}

function sharedModuleRoot(kind) {
  return managedModuleKind(kind) === 'skill' ? sharedHermesSkillsRoot : sharedHermesPluginsRoot;
}

function profileModuleRoot(profileDir, kind) {
  return path.join(profileDir, managedModuleKind(kind) === 'skill' ? 'skills' : 'plugins');
}

function emptyModuleProvenance() {
  return { version: 1, skills: {}, plugins: {}, archives: [] };
}

function provenanceBucket(kind) {
  return managedModuleKind(kind) === 'skill' ? 'skills' : 'plugins';
}

async function readManagedModuleProvenance() {
  const raw = await readJsonFile(hermesModuleProvenancePath);
  return {
    version: 1,
    skills: raw?.skills && typeof raw.skills === 'object' ? raw.skills : {},
    plugins: raw?.plugins && typeof raw.plugins === 'object' ? raw.plugins : {},
    archives: Array.isArray(raw?.archives) ? raw.archives : [],
  };
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomBytes(5).toString('hex')}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, filePath);
}

async function writeYamlAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomBytes(5).toString('hex')}.tmp`;
  await writeFile(temporaryPath, YAML.stringify(value), { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, filePath);
}

async function moveDirectory(source, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await rename(source, destination);
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error;
    await cp(source, destination, { recursive: true, force: false, errorOnExist: true });
    await rm(source, { recursive: true, force: true });
  }
}

async function managedModuleEntries(root, kind) {
  const cleanKind = managedModuleKind(kind);
  if (!(await exists(root))) return [];
  const manifestFiles = cleanKind === 'skill'
    ? await findFilesByName(root, 'SKILL.md', 5)
    : [
        ...(await findFilesByName(root, 'plugin.yaml', 5)),
        ...(await findFilesByName(root, 'plugin.json', 5)),
      ];
  const rows = [];
  const seenDirs = new Set();
  for (const manifestPath of manifestFiles.sort()) {
    const moduleDir = path.dirname(manifestPath);
    if (seenDirs.has(moduleDir)) continue;
    seenDirs.add(moduleDir);
    const relativeDir = path.relative(root, moduleDir);
    if (!relativeDir || relativeDir.startsWith('..') || relativeDir.split(path.sep).some((part) => part.startsWith('.'))) continue;
    const moduleStat = await lstat(moduleDir).catch(() => null);
    if (!moduleStat || moduleStat.isSymbolicLink()) continue;
    const raw = await readFile(manifestPath, 'utf8').catch(() => '');
    let metadata = {};
    if (cleanKind === 'skill') {
      metadata = splitSkillMarkdown(raw).meta;
    } else if (path.extname(manifestPath).toLowerCase() === '.json') {
      try {
        metadata = JSON.parse(raw) || {};
      } catch {
        metadata = {};
      }
    } else {
      try {
        metadata = YAML.parse(raw) || {};
      } catch {
        metadata = {};
      }
    }
    const fallbackName = path.basename(moduleDir);
    const name = assertSafeModuleName(cleanKind === 'skill' ? skillNameFromMarkdown(raw, fallbackName) : metadata.name || fallbackName);
    rows.push({
      name,
      dir: moduleDir,
      manifestPath,
      relativeDir: relativeDir.split(path.sep).join('/'),
      file: `${relativeDir.split(path.sep).join('/')}/${path.basename(manifestPath)}`,
      description: cleanKind === 'skill'
        ? skillDescriptionFromMarkdown(raw)
        : compactOneLine(metadata.description || metadata.summary || ''),
      category: relativeDir.split(path.sep).length > 1 ? relativeDir.split(path.sep)[0] : 'local',
      hash: await hashDirectory(moduleDir),
    });
  }
  return rows
    .filter((row, index, all) => all.findIndex((item) => item.name === row.name) === index)
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function managedModuleOwnerRows() {
  const [configs, state] = await Promise.all([readHermesProfileConfigs(), readState()]);
  const agentByProfile = new Map((state.agents || []).map((agent) => [agent.profileName || agent.id, agent]));
  const rows = [];
  for (const row of configs) {
    const agent = agentByProfile.get(row.name) || null;
    const profileYaml = await readYamlFile(path.join(row.dir, 'profile.yaml'));
    rows.push({
      ...row,
      agentId: agent?.id || '',
      displayName: agent?.name || String(profileYaml?.name || profileYaml?.display_name || titleCaseProfile(row.name)),
      role: agent?.role || String(profileYaml?.role || ''),
      avatarUrl: agent?.avatarUrl || await findProfileAvatar(row.dir, row.name),
      color: agent?.color || profileColor(row.name),
      visible: Boolean(agent) || row.name !== 'default',
    });
  }
  return rows;
}

function managedAgentOwners(owners) {
  return owners.filter((owner) => owner.name !== 'default');
}

function managedModuleEnabled(kind, config, name) {
  if (managedModuleKind(kind) === 'skill') return !disabledSkillsFromConfig(config).has(name);
  return pluginStatusFromConfig(config, name).enabled;
}

async function readManagedHermesModules(kind) {
  const cleanKind = managedModuleKind(kind);
  const [owners, provenance, globalEntries] = await Promise.all([
    managedModuleOwnerRows(),
    readManagedModuleProvenance(),
    managedModuleEntries(sharedModuleRoot(cleanKind), cleanKind),
  ]);
  const agentOwners = managedAgentOwners(owners);
  const bucket = provenance[provenanceBucket(cleanKind)] || {};
  const ownerByName = new Map(owners.map((owner) => [owner.name, owner]));
  const profileItems = [];
  for (const owner of agentOwners) {
    const entries = await managedModuleEntries(profileModuleRoot(owner.dir, cleanKind), cleanKind);
    for (const entry of entries) {
      profileItems.push({
        kind: cleanKind,
        scope: 'profile',
        name: entry.name,
        profileName: owner.name,
        agentId: owner.agentId,
        agentName: owner.displayName,
        avatarUrl: owner.avatarUrl,
        color: owner.color,
        description: entry.description,
        category: entry.category,
        file: entry.file,
        hash: entry.hash,
        enabled: managedModuleEnabled(cleanKind, owner.config, entry.name),
        duplicateProfileNames: [],
      });
    }
  }
  for (const item of profileItems) {
    item.duplicateProfileNames = profileItems
      .filter((candidate) => candidate.name === item.name && candidate.hash === item.hash && candidate.profileName !== item.profileName)
      .map((candidate) => candidate.profileName);
  }
  const globalItems = globalEntries.map((entry) => {
    const origin = bucket[entry.name] || {};
    const owner = ownerByName.get(origin.originProfileName) || null;
    return {
      kind: cleanKind,
      scope: 'global',
      name: entry.name,
      profileName: '',
      originProfileName: String(origin.originProfileName || ''),
      originAgentId: owner?.agentId || '',
      originAgentName: owner?.displayName || '',
      originAvatarUrl: owner?.avatarUrl || '',
      originColor: owner?.color || '',
      description: entry.description,
      category: entry.category,
      file: entry.file,
      hash: entry.hash,
      enabled: true,
      promotedAt: origin.promotedAt || null,
      nativeGlobal: !origin.originProfileName,
      archivedDuplicateProfiles: Array.isArray(origin.archivedDuplicateProfiles) ? origin.archivedDuplicateProfiles : [],
    };
  });
  const visibleOwners = agentOwners.filter((owner) => owner.visible);
  return {
    kind: cleanKind,
    profiles: visibleOwners.map((owner) => ({
      profileName: owner.name,
      agentId: owner.agentId,
      name: owner.displayName,
      role: owner.role,
      avatarUrl: owner.avatarUrl,
      color: owner.color,
      inheritedGlobalCount: globalItems.length,
    })),
    global: globalItems,
    profile: profileItems.filter((item) => visibleOwners.some((owner) => owner.name === item.profileName)),
  };
}

async function findManagedProfileModule(owner, kind, name) {
  const cleanName = assertSafeModuleName(name);
  const entries = await managedModuleEntries(profileModuleRoot(owner.dir, kind), kind);
  return entries.find((entry) => entry.name === cleanName) || null;
}

async function findManagedGlobalModule(kind, name) {
  const cleanName = assertSafeModuleName(name);
  const entries = await managedModuleEntries(sharedModuleRoot(kind), kind);
  return entries.find((entry) => entry.name === cleanName) || null;
}

function nextModuleConfig(config, kind, name, enabled, { ensureSharedSkills = false } = {}) {
  const cleanKind = managedModuleKind(kind);
  const next = { ...(config || {}) };
  if (cleanKind === 'skill') {
    const skills = next.skills && typeof next.skills === 'object' && !Array.isArray(next.skills) ? { ...next.skills } : {};
    const disabled = new Set(Array.isArray(skills.disabled) ? skills.disabled.map(String) : []);
    if (enabled) disabled.delete(name);
    else disabled.add(name);
    skills.disabled = Array.from(disabled).sort();
    if (ensureSharedSkills) {
      const externalDirs = Array.isArray(skills.external_dirs)
        ? skills.external_dirs.map(String)
        : skills.external_dirs ? [String(skills.external_dirs)] : [];
      const sharedPath = path.resolve(sharedHermesSkillsRoot);
      if (!externalDirs.some((entry) => path.resolve(String(entry).replace(/^~/, homeDir)) === sharedPath)) externalDirs.push(sharedHermesSkillsRoot);
      skills.external_dirs = externalDirs;
    }
    next.skills = skills;
    return next;
  }
  const plugins = next.plugins && typeof next.plugins === 'object' && !Array.isArray(next.plugins) ? { ...next.plugins } : {};
  const enabledSet = new Set(Array.isArray(plugins.enabled) ? plugins.enabled.map(String) : []);
  const disabledSet = new Set(Array.isArray(plugins.disabled) ? plugins.disabled.map(String) : []);
  if (enabled) {
    enabledSet.add(name);
    disabledSet.delete(name);
  } else {
    enabledSet.delete(name);
    disabledSet.add(name);
  }
  plugins.enabled = Array.from(enabledSet).sort();
  plugins.disabled = Array.from(disabledSet).sort();
  next.plugins = plugins;
  return next;
}

function removeManagedModuleConfig(config, kind, name) {
  const cleanKind = managedModuleKind(kind);
  const next = { ...(config || {}) };
  if (cleanKind === 'skill') {
    const skills = next.skills && typeof next.skills === 'object' && !Array.isArray(next.skills) ? { ...next.skills } : {};
    skills.disabled = (Array.isArray(skills.disabled) ? skills.disabled : []).map(String).filter((item) => item !== name);
    next.skills = skills;
  } else {
    const plugins = next.plugins && typeof next.plugins === 'object' && !Array.isArray(next.plugins) ? { ...next.plugins } : {};
    plugins.enabled = (Array.isArray(plugins.enabled) ? plugins.enabled : []).map(String).filter((item) => item !== name);
    plugins.disabled = (Array.isArray(plugins.disabled) ? plugins.disabled : []).map(String).filter((item) => item !== name);
    next.plugins = plugins;
  }
  return next;
}

async function writeOwnerConfigs(owners, transform) {
  for (const owner of owners) {
    const configPath = path.join(owner.dir, 'config.yaml');
    const next = transform(owner.config, owner);
    await writeYamlAtomic(configPath, next);
    owner.config = next;
  }
}

async function isManagedPluginProjection(linkPath, expectedTarget = '') {
  const linkStat = await lstat(linkPath).catch(() => null);
  if (!linkStat?.isSymbolicLink()) return false;
  const rawTarget = await readlink(linkPath).catch(() => '');
  const resolvedTarget = path.resolve(path.dirname(linkPath), rawTarget);
  if (!isInside(sharedHermesPluginsRoot, resolvedTarget)) return false;
  return !expectedTarget || resolvedTarget === path.resolve(expectedTarget);
}

async function createManagedPluginProjection(owner, name, targetDir) {
  const pluginsRoot = profileModuleRoot(owner.dir, 'plugin');
  const linkPath = path.join(pluginsRoot, name);
  await mkdir(pluginsRoot, { recursive: true });
  if (await exists(linkPath)) {
    if (await isManagedPluginProjection(linkPath, targetDir)) return linkPath;
    const error = new Error(`Profile「${owner.displayName}」已经存在同名插件。`);
    error.status = 409;
    error.details = { profileName: owner.name, name };
    throw error;
  }
  await symlink(targetDir, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
  return linkPath;
}

async function removeManagedPluginProjection(owner, name, targetDir = '') {
  const linkPath = path.join(profileModuleRoot(owner.dir, 'plugin'), name);
  if (await isManagedPluginProjection(linkPath, targetDir)) await unlink(linkPath);
}

async function runningManagedProfiles(owners) {
  if (process.env.FRAKIO_WORK_DISABLE_AUTOSTART === '1') return [];
  const running = [];
  for (const owner of owners) {
    const status = await profileGatewayStatus(owner.name).catch(() => null);
    if (status?.running) running.push(owner.name);
  }
  return running;
}

async function reloadManagedSkills(profileNames) {
  if (process.env.FRAKIO_WORK_DISABLE_AUTOSTART === '1') return profileNames.map((profileName) => ({ profileName, ok: true, skipped: true }));
  const results = [];
  for (const profileName of profileNames) {
    try {
      const result = await requestHermesBridge({ action: 'skills_reload', profile: profileName }, { timeoutMs: 10000, retryMs: 500 });
      results.push({ profileName, ok: result?.ok !== false });
    } catch (error) {
      results.push({ profileName, ok: false, error: String(error?.message || error) });
    }
  }
  return results;
}

async function ensureManagedGlobalModulesForProfile(profileName) {
  const ownerDir = await profileDirForName(profileName);
  if (!ownerDir) return;
  const configPath = path.join(ownerDir, 'config.yaml');
  let config = await readYamlFile(configPath);
  if ((await managedModuleEntries(sharedHermesSkillsRoot, 'skill')).length) {
    config = nextModuleConfig(config, 'skill', '__frakio_shared_registration__', true, { ensureSharedSkills: true });
    config = removeManagedModuleConfig(config, 'skill', '__frakio_shared_registration__');
  }
  const globalPlugins = await managedModuleEntries(sharedHermesPluginsRoot, 'plugin');
  for (const plugin of globalPlugins) {
    config = nextModuleConfig(config, 'plugin', plugin.name, true);
    await createManagedPluginProjection({ name: profileName, displayName: profileName, dir: ownerDir }, plugin.name, plugin.dir);
  }
  await writeYamlAtomic(configPath, config);
}

async function promoteManagedModule(kind, name, sourceProfileName) {
  const cleanKind = managedModuleKind(kind);
  const cleanName = assertSafeModuleName(name);
  const owners = await managedModuleOwnerRows();
  const agentOwners = managedAgentOwners(owners);
  const sourceOwner = agentOwners.find((owner) => owner.name === slug(sourceProfileName || ''));
  if (!sourceOwner) {
    const error = new Error('来源 Agent 不存在。');
    error.status = 404;
    throw error;
  }
  const source = await findManagedProfileModule(sourceOwner, cleanKind, cleanName);
  if (!source) {
    const error = new Error('来源模块不存在。');
    error.status = 404;
    throw error;
  }
  if (await findManagedGlobalModule(cleanKind, cleanName)) {
    const error = new Error('已经存在同名全局模块。');
    error.status = 409;
    throw error;
  }
  const duplicates = [];
  const conflicts = [];
  for (const owner of agentOwners) {
    if (owner.name === sourceOwner.name) continue;
    const candidate = await findManagedProfileModule(owner, cleanKind, cleanName);
    if (!candidate) continue;
    if (candidate.hash === source.hash) duplicates.push({ owner, module: candidate });
    else conflicts.push({ profileName: owner.name, agentName: owner.displayName, hash: candidate.hash });
  }
  if (conflicts.length) {
    const error = new Error('其他 Agent 存在内容不同的同名模块，不能自动合并。');
    error.status = 409;
    error.details = { conflicts };
    throw error;
  }
  const operationId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`;
  const archiveDir = path.join(hermesModuleArchiveRoot, operationId);
  const destination = path.join(sharedModuleRoot(cleanKind), cleanName);
  const provenance = await readManagedModuleProvenance();
  const previousConfigs = new Map();
  const createdLinks = [];
  const moved = [];
  try {
    for (const owner of owners) {
      const configPath = path.join(owner.dir, 'config.yaml');
      previousConfigs.set(configPath, await readFile(configPath, 'utf8').catch(() => ''));
    }
    for (const duplicate of duplicates) {
      const relative = path.relative(profileModuleRoot(duplicate.owner.dir, cleanKind), duplicate.module.dir);
      const archived = path.join(archiveDir, 'duplicates', duplicate.owner.name, relative);
      await moveDirectory(duplicate.module.dir, archived);
      moved.push({ from: archived, to: duplicate.module.dir });
    }
    await mkdir(sharedModuleRoot(cleanKind), { recursive: true });
    await moveDirectory(source.dir, destination);
    moved.push({ from: destination, to: source.dir });
    if (cleanKind === 'plugin') {
      for (const owner of owners) createdLinks.push(await createManagedPluginProjection(owner, cleanName, destination));
    }
    await writeOwnerConfigs(owners, (config) => nextModuleConfig(config, cleanKind, cleanName, true, { ensureSharedSkills: cleanKind === 'skill' }));
    const bucketName = provenanceBucket(cleanKind);
    provenance[bucketName][cleanName] = {
      originProfileName: sourceOwner.name,
      promotedAt: now(),
      archivedDuplicateProfiles: duplicates.map((item) => item.owner.name),
      archiveDir: duplicates.length ? archiveDir : '',
    };
    if (duplicates.length) {
      provenance.archives.push({
        id: operationId,
        kind: cleanKind,
        name: cleanName,
        reason: 'identical-duplicates',
        profiles: duplicates.map((item) => item.owner.name),
        path: archiveDir,
        createdAt: now(),
      });
    }
    await writeJsonAtomic(hermesModuleProvenancePath, provenance);
  } catch (error) {
    for (const linkPath of createdLinks.reverse()) await unlink(linkPath).catch(() => null);
    for (const move of moved.reverse()) {
      if (await exists(move.from)) await moveDirectory(move.from, move.to).catch(() => null);
    }
    for (const [configPath, raw] of previousConfigs) {
      if (raw) await writeFile(configPath, raw, 'utf8').catch(() => null);
    }
    throw error;
  }
  const affectedProfiles = owners.map((owner) => owner.name);
  const reloads = cleanKind === 'skill' ? await reloadManagedSkills(affectedProfiles) : [];
  const restartRequiredProfiles = cleanKind === 'plugin' ? await runningManagedProfiles(owners) : [];
  return {
    modules: await readManagedHermesModules(cleanKind),
    originProfileName: sourceOwner.name,
    archivedDuplicateProfiles: duplicates.map((item) => item.owner.name),
    reloads,
    restartRequiredProfiles,
  };
}

async function demoteManagedModule(kind, name, targetProfileName = '') {
  const cleanKind = managedModuleKind(kind);
  const cleanName = assertSafeModuleName(name);
  const owners = await managedModuleOwnerRows();
  const agentOwners = managedAgentOwners(owners);
  const provenance = await readManagedModuleProvenance();
  const bucketName = provenanceBucket(cleanKind);
  const origin = provenance[bucketName][cleanName] || {};
  const destinationProfileName = slug(targetProfileName || origin.originProfileName || '');
  const targetOwner = agentOwners.find((owner) => owner.name === destinationProfileName);
  if (!targetOwner) {
    const error = new Error('需要选择接收该模块的 Agent。');
    error.status = 400;
    error.code = 'target_profile_required';
    throw error;
  }
  const source = await findManagedGlobalModule(cleanKind, cleanName);
  if (!source) {
    const error = new Error('全局模块不存在。');
    error.status = 404;
    throw error;
  }
  const existing = [];
  for (const owner of agentOwners) {
    const candidate = await findManagedProfileModule(owner, cleanKind, cleanName);
    if (candidate) existing.push(owner.displayName);
  }
  if (existing.length) {
    const error = new Error('Agent 中已经存在同名模块，不能取消全局。');
    error.status = 409;
    error.details = { conflicts: existing };
    throw error;
  }
  const destination = path.join(profileModuleRoot(targetOwner.dir, cleanKind), cleanName);
  if (cleanKind === 'plugin') {
    for (const owner of owners) await removeManagedPluginProjection(owner, cleanName, source.dir);
  }
  await moveDirectory(source.dir, destination);
  await writeOwnerConfigs(owners, (config, owner) => {
    if (cleanKind === 'plugin' && owner.name !== targetOwner.name) return removeManagedModuleConfig(config, cleanKind, cleanName);
    return nextModuleConfig(config, cleanKind, cleanName, true, { ensureSharedSkills: cleanKind === 'skill' });
  });
  delete provenance[bucketName][cleanName];
  await writeJsonAtomic(hermesModuleProvenancePath, provenance);
  const affectedProfiles = owners.map((owner) => owner.name);
  const reloads = cleanKind === 'skill' ? await reloadManagedSkills(affectedProfiles) : [];
  const restartRequiredProfiles = cleanKind === 'plugin' ? await runningManagedProfiles(owners) : [];
  return {
    modules: await readManagedHermesModules(cleanKind),
    targetProfileName: targetOwner.name,
    reloads,
    restartRequiredProfiles,
  };
}

async function deleteManagedModule(kind, name, scope, profileName = '') {
  const cleanKind = managedModuleKind(kind);
  const cleanScope = managedModuleScope(scope);
  const cleanName = assertSafeModuleName(name);
  const owners = await managedModuleOwnerRows();
  const agentOwners = managedAgentOwners(owners);
  const provenance = await readManagedModuleProvenance();
  let moduleEntry = null;
  let owner = null;
  if (cleanScope === 'global') moduleEntry = await findManagedGlobalModule(cleanKind, cleanName);
  else {
    owner = agentOwners.find((item) => item.name === slug(profileName || ''));
    if (owner) moduleEntry = await findManagedProfileModule(owner, cleanKind, cleanName);
  }
  if (!moduleEntry) {
    const error = new Error('模块不存在。');
    error.status = 404;
    throw error;
  }
  const operationId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`;
  const destination = path.join(hermesModuleArchiveRoot, operationId, cleanScope, owner?.name || 'global', cleanName);
  if (cleanScope === 'global' && cleanKind === 'plugin') {
    for (const item of owners) await removeManagedPluginProjection(item, cleanName, moduleEntry.dir);
  }
  await moveDirectory(moduleEntry.dir, destination);
  await writeOwnerConfigs(owners, (config, item) => {
    if (cleanScope === 'profile' && item.name !== owner.name) return config;
    return removeManagedModuleConfig(config, cleanKind, cleanName);
  });
  if (cleanScope === 'global') delete provenance[provenanceBucket(cleanKind)][cleanName];
  provenance.archives.push({
    id: operationId,
    kind: cleanKind,
    name: cleanName,
    scope: cleanScope,
    profileName: owner?.name || '',
    reason: 'deleted',
    path: destination,
    createdAt: now(),
  });
  await writeJsonAtomic(hermesModuleProvenancePath, provenance);
  const affectedOwners = cleanScope === 'global' ? owners : [owner];
  const affectedProfiles = affectedOwners.map((item) => item.name);
  const reloads = cleanKind === 'skill' ? await reloadManagedSkills(affectedProfiles) : [];
  const restartRequiredProfiles = cleanKind === 'plugin' ? await runningManagedProfiles(affectedOwners) : [];
  return {
    modules: await readManagedHermesModules(cleanKind),
    archivePath: destination,
    reloads,
    restartRequiredProfiles,
  };
}

async function updateManagedModuleState(kind, name, profileName, enabled) {
  const cleanKind = managedModuleKind(kind);
  const cleanName = assertSafeModuleName(name);
  const owners = managedAgentOwners(await managedModuleOwnerRows());
  const owner = owners.find((item) => item.name === slug(profileName || ''));
  if (!owner) {
    const error = new Error('Agent 不存在。');
    error.status = 404;
    throw error;
  }
  const moduleEntry = await findManagedProfileModule(owner, cleanKind, cleanName);
  if (!moduleEntry) {
    const error = new Error('Agent 模块不存在。');
    error.status = 404;
    throw error;
  }
  const config = nextModuleConfig(owner.config, cleanKind, cleanName, Boolean(enabled));
  await writeYamlAtomic(path.join(owner.dir, 'config.yaml'), config);
  const reloads = cleanKind === 'skill' ? await reloadManagedSkills([owner.name]) : [];
  const restartRequiredProfiles = cleanKind === 'plugin' ? await runningManagedProfiles([owner]) : [];
  return { modules: await readManagedHermesModules(cleanKind), reloads, restartRequiredProfiles };
}

async function resolveManagedModuleFile(kind, scope, name, profileName = '') {
  const cleanKind = managedModuleKind(kind);
  const cleanScope = managedModuleScope(scope);
  const cleanName = assertSafeModuleName(name);
  let moduleEntry = null;
  if (cleanScope === 'global') {
    moduleEntry = await findManagedGlobalModule(cleanKind, cleanName);
  } else {
    const owners = managedAgentOwners(await managedModuleOwnerRows());
    const owner = owners.find((item) => item.name === slug(profileName || ''));
    if (owner) moduleEntry = await findManagedProfileModule(owner, cleanKind, cleanName);
  }
  if (!moduleEntry) {
    const error = new Error('模块不存在。');
    error.status = 404;
    throw error;
  }
  const expectedRoot = cleanScope === 'global'
    ? sharedModuleRoot(cleanKind)
    : path.dirname(path.dirname(moduleEntry.manifestPath));
  if (!isInside(expectedRoot, moduleEntry.manifestPath)) {
    const error = new Error('模块文件路径不合法。');
    error.status = 403;
    throw error;
  }
  return moduleEntry;
}

function runHermesModuleMutation(operation) {
  const transaction = hermesModuleMutationQueue.then(operation);
  hermesModuleMutationQueue = transaction.catch(() => {});
  return transaction;
}

async function readProfileModules(dir, name, config = {}) {
  const skills = await editableSkillEntries(dir, config);
  const plugins = await editablePluginEntries(dir, name, config);
  return {
    skills,
    plugins,
  };
}

async function readYamlFile(filePath) {
  try {
    return YAML.parse(await readFile(filePath, 'utf8')) || {};
  } catch {
    return {};
  }
}

async function readEnvStatus(filePath) {
  const values = new Map();
  try {
    const raw = await readFile(filePath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const index = trimmed.indexOf('=');
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && value) values.set(key, true);
    }
  } catch {
    // Missing env files are normal for fresh Hermes profiles.
  }
  return values;
}

function providerLabel(providerKey) {
  const value = String(providerKey || '').trim();
  if (!value) return 'provider default';
  return value.startsWith('custom:') ? value.slice(7) : value;
}

function customProviderEntries(config) {
  const source = config?.custom_providers;
  if (Array.isArray(source)) {
    return source.map((providerConfig, index) => [
      String(providerConfig?.name || providerConfig?.key || providerConfig?.provider || providerConfig?.id || `custom-${index + 1}`),
      providerConfig || {},
    ]);
  }
  return Object.entries(source || {});
}

function hasInlineApiKey(config) {
  return Boolean(String(config?.api_key || config?.apiKey || '').trim());
}

function buildProviderSummaries(config, envValues) {
  const defaultModel = String(config?.model?.default || config?.model || '').trim();
  const defaultProvider = String(config?.model?.provider || config?.provider || '').trim();
  const summaries = [];
  const addSummary = (providerKey, providerConfig = {}, model = defaultModel) => {
    const cleanKey = String(providerKey || '').trim();
    if (!cleanKey) return;
    const builtinKey = cleanKey.replace(/^custom:/, '');
    const envMapping = providerEnvMap[cleanKey] || providerEnvMap[builtinKey] || {};
    const baseUrl = String(providerConfig?.base_url || providerConfig?.baseUrl || '').trim();
    const hasApiKey = hasInlineApiKey(providerConfig) || Boolean(envMapping.apiKey && envValues.has(envMapping.apiKey));
    summaries.push({
      providerKey: cleanKey,
      providerName: providerLabel(cleanKey),
      baseUrl: baseUrl || (envMapping.baseUrl && envValues.has(envMapping.baseUrl) ? '[env]' : ''),
      model: String(providerConfig?.model || model || '').trim(),
      hasApiKey,
      apiKeyState: hasApiKey ? 'stored' : 'missing',
    });
  };

  if (defaultProvider) {
    const source = selectedProviderConfig(config, defaultProvider);
    addSummary(defaultProvider, source || {}, defaultModel);
  }
  for (const [key, providerConfig] of customProviderEntries(config)) {
    addSummary(`custom:${key}`, providerConfig, providerConfig?.model || defaultModel);
  }
  return summaries.filter((item, index, arr) => arr.findIndex((other) => other.providerKey === item.providerKey) === index).slice(0, 8);
}

function envApiKeyNames(providerKey) {
  const cleanKey = String(providerKey || '').replace(/^custom:/, '');
  const mapped = providerEnvMap[providerKey] || providerEnvMap[cleanKey] || {};
  const upper = cleanKey.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return Array.from(new Set([mapped.apiKey, `${upper}_API_KEY`, 'OPENAI_API_KEY'].filter(Boolean)));
}

function readProviderApiKey(providerKey, providerConfig = {}, envRaw = {}) {
  const inline = String(providerConfig?.api_key || providerConfig?.apiKey || '').trim();
  if (inline) return inline;
  for (const name of envApiKeyNames(providerKey)) {
    const value = String(envRaw[name] || process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

async function readEnvValues(filePath) {
  const values = {};
  try {
    const raw = await readFile(filePath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const index = trimmed.indexOf('=');
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key) values[key] = value;
    }
  } catch {
    // Missing env files are normal before Hermes is initialized.
  }
  return values;
}

async function writeEnvValues(filePath, updates) {
  const current = await readEnvValues(filePath);
  for (const [key, value] of Object.entries(updates || {})) {
    const cleanKey = String(key || '').trim();
    if (!cleanKey) continue;
    const cleanValue = value === undefined || value === null ? '' : String(value).trim();
    if (cleanValue) current[cleanKey] = cleanValue;
    else delete current[cleanKey];
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  const lines = Object.entries(current)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value).replace(/\n/g, ' ')}`);
  await writeFile(filePath, `${lines.join('\n')}${lines.length ? '\n' : ''}`, { encoding: 'utf8', mode: 0o600 });
}

function setNestedValue(target, keyPath, value) {
  const parts = String(keyPath || '').split('.').filter(Boolean);
  if (!parts.length) return;
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}

function removeNestedValue(target, keyPath) {
  const parts = String(keyPath || '').split('.').filter(Boolean);
  if (!parts.length) return;
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    cursor = cursor?.[parts[index]];
    if (!cursor || typeof cursor !== 'object') return;
  }
  delete cursor[parts[parts.length - 1]];
}

function deepMerge(target, source) {
  const next = { ...(target || {}) };
  for (const [key, value] of Object.entries(source || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && next[key] && typeof next[key] === 'object' && !Array.isArray(next[key])) {
      next[key] = deepMerge(next[key], value);
    } else {
      next[key] = value;
    }
  }
  return next;
}

function profileConfigDir(profileName = 'default') {
  const clean = slug(profileName || 'default');
  return clean === 'default' ? hermesHome : path.join(hermesHome, 'profiles', clean);
}

function profileConfigPath(profileName = 'default') {
  return path.join(profileConfigDir(profileName), 'config.yaml');
}

function mcpConfigPathForProfile(profileName = 'default') {
  return profileConfigPath(profileName || 'default');
}

function profileEnvPath(profileName = 'default') {
  return path.join(profileConfigDir(profileName), '.env');
}

function requestedHermesProfile(req, fallback = 'default') {
  return slug(req.query?.profile || req.body?.profile || fallback || 'default');
}

async function requestedModelProfile(req) {
  const explicit = String(req.query?.profile || req.body?.profile || '').trim();
  if (explicit) return slug(explicit);
  try {
    const state = await readState();
    return slug(state.integrations?.hermesAgent?.selectedProfile || state.integrations?.hermesStudio?.selectedProfile || 'default');
  } catch {
    return 'default';
  }
}

async function updateProfileYaml(profileName, updater) {
  const configPath = profileConfigPath(profileName);
  await mkdir(path.dirname(configPath), { recursive: true });
  const config = await readYamlFile(configPath);
  const next = await updater(config || {});
  await writeFile(configPath, YAML.stringify(next || {}), 'utf8');
  return next || {};
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function configValidationError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function positiveInteger(value, field, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw configValidationError(`${field} 必须是正整数。`);
  return Math.floor(number);
}

function nullableNumber(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw configValidationError(`${field} 必须是数字或留空。`);
  return number;
}

function publicAuxiliarySettings(raw, task) {
  if (!isPlainRecord(raw)) return {};
  const settings = {};
  for (const field of ['provider', 'model', 'base_url']) {
    if (typeof raw[field] === 'string' && raw[field].trim()) settings[field] = raw[field].trim();
  }
  const timeout = Number(raw.timeout);
  if (Number.isFinite(timeout) && timeout > 0) settings.timeout = Math.floor(timeout);
  const downloadTimeout = Number(raw.download_timeout);
  if (task.key === 'vision' && Number.isFinite(downloadTimeout) && downloadTimeout > 0) settings.download_timeout = Math.floor(downloadTimeout);
  if (isPlainRecord(raw.extra_body) && Object.keys(raw.extra_body).length) settings.extra_body = raw.extra_body;
  return settings;
}

function normalizeAuxiliaryUpdate(raw, task) {
  if (!isPlainRecord(raw)) throw configValidationError(`${task.label}配置必须是对象。`);
  const provider = String(raw.provider || 'auto').trim() || 'auto';
  const model = String(raw.model || '').trim();
  if (!['auto', 'main'].includes(provider) && !model) throw configValidationError(`${task.label}指定 Provider 后必须选择模型。`);
  if (provider.toLowerCase() === 'moa') throw configValidationError('辅助模型不能使用 MoA Provider。');
  const settings = { provider };
  if (model && !['auto', 'main'].includes(provider)) settings.model = model;
  const timeout = positiveInteger(raw.timeout, `${task.label}超时`, task.default_timeout);
  if (timeout) settings.timeout = timeout;
  if (task.key === 'vision') {
    const downloadTimeout = positiveInteger(raw.download_timeout, '视觉下载超时', task.default_download_timeout);
    if (downloadTimeout) settings.download_timeout = downloadTimeout;
  }
  if (raw.extra_body !== undefined && raw.extra_body !== null && raw.extra_body !== '') {
    if (!isPlainRecord(raw.extra_body)) throw configValidationError(`${task.label} extra_body 必须是 JSON 对象。`);
    if (Object.keys(raw.extra_body).length) settings.extra_body = raw.extra_body;
  }
  return settings;
}

function modelProtocolFromApiMode(apiMode = '') {
  if (apiMode === 'anthropic_messages') return 'Anthropic Compatible';
  if (apiMode === 'openai_responses' || apiMode === 'codex_responses' || apiMode === 'chat_completions') return 'OpenAI Compatible';
  return apiMode ? 'Custom' : 'OpenAI Compatible';
}

function normalizeApiMode(value) {
  const clean = String(value || '').trim();
  return ['chat_completions', 'openai_responses', 'codex_responses', 'anthropic_messages', 'bedrock_converse', 'codex_app_server'].includes(clean) ? clean : '';
}

function providerPresetByKey(providerKey = '') {
  return loadProviderPresets().find((preset) => preset.value === providerKey);
}

function authJsonPathForProfile(profileName = 'default') {
  return path.join(profileConfigDir(profileName), 'auth.json');
}

function loadAuthJsonSync(authPath) {
  try {
    return JSON.parse(readFileSync(authPath, 'utf8')) || { version: 1 };
  } catch {
    return { version: 1 };
  }
}

function saveAuthJsonSync(authPath, data) {
  data.updated_at = new Date().toISOString();
  mkdirSync(path.dirname(authPath), { recursive: true });
  writeFileSync(authPath, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function updateHermesModelProviderConfig(profileName, providerKey, model) {
  return updateProfileYaml(profileName, (current) => {
    current.model = current.model && typeof current.model === 'object' && !Array.isArray(current.model) ? current.model : {};
    current.model.provider = providerKey;
    current.model.default = model || providerPresetByKey(providerKey)?.models?.[0] || '';
    delete current.model.base_url;
    delete current.model.api_key;
    return current;
  });
}

async function saveCodexOAuthTokens(profileName, accessToken, refreshToken, expiresAtMs = 0, accountId = '', accountRecordId = '', label = '') {
  await setOAuthCredential('openai-codex', {
    access: accessToken,
    refresh: refreshToken,
    expires: expiresAtMs,
    accountId,
    label,
    updatedAt: now(),
  }, accountRecordId);
  const authPath = authJsonPathForProfile(profileName);
  const auth = loadAuthJsonSync(authPath);
  auth.providers = auth.providers || {};
  auth.providers['openai-codex'] = { tokens: { access_token: accessToken, refresh_token: refreshToken }, last_refresh: new Date().toISOString(), auth_mode: 'chatgpt' };
  auth.credential_pool = auth.credential_pool || {};
  auth.credential_pool['openai-codex'] = [{ id: `openai-codex-${Date.now()}`, label: 'OpenAI Codex', base_url: providerPresetByKey('openai-codex')?.baseUrl || '', access_token: accessToken, last_status: null }];
  saveAuthJsonSync(authPath, auth);
}

function authEntryHasCredential(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(authEntryHasCredential);
  return Boolean(
    value.access_token || value.refresh_token || value.accessToken || value.refreshToken ||
    value.agent_key || value.tokens?.access_token || value.tokens?.refresh_token
  );
}

function oauthProviderAuthenticated(profileName, providerKey, accountId = '') {
  if (getOAuthCredentialSync(providerKey, accountId)) return true;
  if (accountId) return false;
  const auth = loadAuthJsonSync(authJsonPathForProfile(profileName));
  const aliases = providerKey === 'claude-oauth' ? ['claude-oauth', 'anthropic'] : [providerKey];
  return aliases.some((key) => authEntryHasCredential(auth.providers?.[key]) || authEntryHasCredential(auth.credential_pool?.[key]));
}

function oauthProviderAccessToken(profileName, providerKey, accountId = '') {
  // OAuth credentials are Frakio-wide. The Hermes Profile remains a compatibility
  // mirror for existing Hermes runtimes and old installations.
  const globalCredential = getOAuthCredentialSync(providerKey, accountId);
  if (globalCredential?.access) return globalCredential.access;
  if (accountId) return '';
  const auth = loadAuthJsonSync(authJsonPathForProfile(profileName));
  const aliases = providerKey === 'claude-oauth' ? ['claude-oauth', 'anthropic'] : [providerKey];
  for (const key of aliases) {
    const candidates = [auth.providers?.[key], ...(Array.isArray(auth.credential_pool?.[key]) ? auth.credential_pool[key] : [])];
    for (const entry of candidates) {
      const token = String(entry?.tokens?.access_token || entry?.access_token || entry?.accessToken || '').trim();
      if (token) return token;
    }
  }
  return '';
}

async function migrateProfileOAuthToFrakio(state) {
  const secrets = await readSecrets();
  let changed = migrateOAuthAccountsInSecrets(secrets, state);
  const profileNames = Array.from(new Set([
    ...((state.agents || []).map((agent) => String(agent.profileName || '').trim())),
    ...((state.models || []).map((model) => String(model.profileName || '').trim())),
    String(state.integrations?.hermesStudio?.selectedProfile || '').trim(),
  ].filter(Boolean)));
  for (const profileName of profileNames) {
    const auth = loadAuthJsonSync(authJsonPathForProfile(profileName));
    const sourceFor = (keys) => keys.flatMap((key) => [auth.providers?.[key], ...(Array.isArray(auth.credential_pool?.[key]) ? auth.credential_pool[key] : [])])
      .find((entry) => authEntryHasCredential(entry));
    for (const [providerKey, source] of Object.entries({
      'openai-codex': sourceFor(['openai-codex']),
      'claude-oauth': sourceFor(['claude-oauth', 'anthropic']),
      [geminiProviderKey]: sourceFor([geminiProviderKey]),
    })) {
      if (!source) continue;
      const access = String(source.tokens?.access_token || source.access_token || source.accessToken || '').trim();
      const credential = normalizeOAuthCredential({
        id: access ? `${providerKey}_${createHash('sha256').update(access).digest('hex').slice(0, 16)}` : '',
        access,
        refresh: source.tokens?.refresh_token || source.refresh_token || source.refreshToken,
        expires: source.tokens?.expires_at_ms || source.expires_at_ms || source.expiresAt,
        email: source.email,
        label: source.email || `${providerKey} 账户`,
        codeAssist: source.code_assist,
        updatedAt: source.last_refresh,
      });
      if (!credential) continue;
      const existingAccount = Object.entries(secrets.oauthAccounts?.[providerKey] || {})
        .find(([, item]) => normalizeOAuthCredential(item)?.access === credential.access);
      if (existingAccount) continue;
      const accountId = oauthAccountId(providerKey, credential);
      const current = normalizeOAuthCredential(secrets.oauthAccounts?.[providerKey]?.[accountId]);
      if (current?.access === credential.access) continue;
      secrets.oauthAccounts = { ...(secrets.oauthAccounts || {}), [providerKey]: { ...(secrets.oauthAccounts?.[providerKey] || {}), [accountId]: { ...credential, id: accountId } } };
      if (!secrets.oauth?.[providerKey]) secrets.oauth = { ...(secrets.oauth || {}), [providerKey]: { ...credential, id: accountId } };
      changed = true;
    }
  }
  if (Number(secrets.oauthMigrationVersion || 0) < 2) { secrets.oauthMigrationVersion = 2; changed = true; }
  if (changed) await writeSecrets(secrets);
  return changed;
}

async function handlePiCredentialRequest(operation, piProviderId, rawCredential, accountId = '') {
  const providerKey = piProviderId === 'openai-codex'
    ? 'openai-codex'
    : piProviderId === 'anthropic'
      ? 'claude-oauth'
      : piProviderId === 'frakio-gemini-code-assist'
        ? geminiProviderKey
        : '';
  if (!providerKey) throw new Error(`Pi 请求了不受 Frakio 管理的凭据：${String(piProviderId || '')}`);
  if (operation === 'read') return getOAuthCredential(providerKey, accountId);
  if (operation === 'write') {
    const current = await getOAuthCredential(providerKey, accountId);
    if (!rawCredential || rawCredential.type !== 'oauth') throw new Error('Pi OAuth 凭据格式无效。');
    return setOAuthCredential(providerKey, {
      ...current,
      access: rawCredential.access,
      refresh: rawCredential.refresh,
      expires: rawCredential.expires,
      updatedAt: now(),
    }, accountId);
  }
  if (operation === 'refresh') {
    if (providerKey !== geminiProviderKey) throw new Error('该 Pi Provider 不使用 Frakio 刷新流程。');
    const refreshToken = String(rawCredential?.refresh || rawCredential?.refresh_token || '').trim();
    if (!refreshToken) throw new Error('Gemini OAuth 缺少 refresh token，请重新授权。');
    const body = new URLSearchParams({
      client_id: googleClientId,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    if (googleClientSecret) body.set('client_secret', googleClientSecret);
    const response = await fetch(googleTokenEndpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    });
    const tokenData = await response.json().catch(() => ({}));
    if (!response.ok || !tokenData.access_token) throw new Error('Gemini OAuth 刷新失败，请重新授权。');
    const current = await getOAuthCredential(providerKey, accountId);
    return setOAuthCredential(providerKey, {
      ...current,
      access: tokenData.access_token,
      refresh: tokenData.refresh_token || refreshToken,
      expires: Date.now() + Math.max(60, Number(tokenData.expires_in || 3600)) * 1000,
      updatedAt: now(),
    }, accountId);
  }
  if (operation === 'delete') {
    // Pi owns neither the account nor its lifetime. A runtime-side logout must
    // not silently remove the Frakio-wide authorization record.
    return undefined;
  }
  throw new Error(`未知的 Pi 凭据操作：${String(operation || '')}`);
}

function oauthCatalogModel(providerKey, accountId = '') {
  const preset = providerPresetByKey(providerKey) || {};
  return { providerKey: accountId ? `${providerKey}::${accountId}` : providerKey, apiMode: preset.apiMode || '', baseUrl: preset.baseUrl || '' };
}

function oauthProviderState(profileName, providerKey, accountId = '') {
  const preset = providerPresetByKey(providerKey);
  const authenticated = Boolean(preset?.authType && oauthProviderAuthenticated(profileName, providerKey, accountId));
  const cached = catalogStatus(modelCatalogCache, oauthCatalogModel(providerKey, accountId));
  if (!authenticated) {
    return { authenticated: false, models: [], catalog: { ...cached, source: 'none', modelIds: [] } };
  }
  const cachedModels = cached.modelIds || [];
  const models = cachedModels.length ? cachedModels : providerKey === 'openai-codex' ? [] : [...(preset?.models || [])];
  return {
    authenticated: true,
    models,
    catalog: {
      ...cached,
      source: cachedModels.length ? cached.source : providerKey === 'openai-codex' ? 'none' : 'frakio_builtin',
      modelIds: models,
      rich: cachedModels.length ? cached.rich : false,
    },
  };
}

function oauthProviderPayload(profileName, providerKey, accountId = '') {
  const state = oauthProviderState(profileName, providerKey, accountId);
  const preset = providerPresetByKey(providerKey) || {};
  const capabilityModel = normalizeModels([{
    id: 'oauth-catalog', name: preset.label || providerKey, provider: preset.label || providerKey,
    providerKey, apiMode: preset.apiMode || '', baseUrl: preset.baseUrl || '',
    model: state.models[0] || '', models: state.models, capabilityMode: 'auto', capabilityOverrides: {},
  }])[0];
  return {
    ...state,
    capabilities: Object.fromEntries(state.models.map((modelId) => [modelId, resolveModelCapability(capabilityModel, modelId, { providerCatalog: flattenProviderCatalog(modelCatalogCache) })])),
  };
}

async function refreshCodexOAuthModels(accessToken, accountId = '') {
  const provider = oauthCatalogModel('openai-codex', accountId);
  try {
    const normalized = await fetchCodexOAuthCatalog({ accessToken, endpoint: process.env.FRAKIO_WORK_CODEX_MODELS_URL || undefined });
    const parsed = parseCatalogResponse(normalized, provider);
    parsed.ids = normalized.models.map((model) => model.id);
    await updateProviderCatalog(modelCatalogCachePath, modelCatalogCache, provider, parsed);
    return catalogStatus(modelCatalogCache, provider);
  } catch (error) {
    await recordCatalogError(modelCatalogCachePath, modelCatalogCache, provider, error);
    throw error;
  }
}

async function saveClaudeOAuthTokens(profileName, tokenData, accountRecordId = '', label = '') {
  const accessToken = String(tokenData.access_token || '').trim();
  const refreshToken = String(tokenData.refresh_token || '').trim();
  if (!accessToken) throw new Error('Claude OAuth 没有返回 access token。');
  const expiresAtMs = Date.now() + Math.max(60, Number(tokenData.expires_in || 3600)) * 1000;
  const lastRefresh = new Date().toISOString();
  await setOAuthCredential('claude-oauth', {
    access: accessToken,
    refresh: refreshToken,
    expires: expiresAtMs,
    label,
    updatedAt: lastRefresh,
  }, accountRecordId);
  const profileDir = profileConfigDir(profileName);
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(path.join(profileDir, '.anthropic_oauth.json'), `${JSON.stringify({ accessToken, refreshToken, expiresAt: expiresAtMs, tokenType: tokenData.token_type || 'Bearer', updatedAt: lastRefresh }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  const providerEntry = { tokens: { access_token: accessToken, refresh_token: refreshToken, expires_at_ms: expiresAtMs, token_type: tokenData.token_type || 'Bearer' }, last_refresh: lastRefresh, auth_mode: 'oauth_pkce', base_url: 'https://api.anthropic.com' };
  const poolEntry = { id: `claude-oauth-${Date.now()}`, label: 'Claude OAuth', auth_type: 'oauth', source: 'frakio_pkce', priority: 0, access_token: accessToken, refresh_token: refreshToken, expires_at_ms: expiresAtMs, base_url: 'https://api.anthropic.com' };
  const authPath = authJsonPathForProfile(profileName);
  const auth = loadAuthJsonSync(authPath);
  auth.providers = { ...(auth.providers || {}), 'claude-oauth': providerEntry, anthropic: providerEntry };
  auth.credential_pool = { ...(auth.credential_pool || {}), 'claude-oauth': [poolEntry], anthropic: [{ ...poolEntry, id: `anthropic-${Date.now()}`, label: 'Anthropic Claude OAuth' }] };
  saveAuthJsonSync(authPath, auth);
}

async function saveGeminiOAuthTokens(profileName, tokenData, email = '', accountRecordId = '', label = '') {
  const accessToken = String(tokenData.access_token || '').trim();
  const refreshToken = String(tokenData.refresh_token || '').trim();
  if (!accessToken || !refreshToken) throw new Error('Google OAuth 没有返回完整 token。');
  const expiresAtMs = Date.now() + Math.max(60, Number(tokenData.expires_in || 3600)) * 1000;
  const lastRefresh = new Date().toISOString();
  await setOAuthCredential(geminiProviderKey, {
    access: accessToken,
    refresh: refreshToken,
    expires: expiresAtMs,
    email,
    label,
    updatedAt: lastRefresh,
  }, accountRecordId);
  const googleAuthPath = path.join(profileConfigDir(profileName), 'auth', 'google_oauth.json');
  mkdirSync(path.dirname(googleAuthPath), { recursive: true });
  writeFileSync(googleAuthPath, `${JSON.stringify({ refresh: refreshToken, access: accessToken, expires: expiresAtMs, email }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  const authPath = authJsonPathForProfile(profileName);
  const auth = loadAuthJsonSync(authPath);
  auth.providers = auth.providers || {};
  auth.providers[geminiProviderKey] = { access_token: accessToken, refresh_token: refreshToken, expires_at_ms: expiresAtMs, email, last_refresh: lastRefresh, auth_mode: 'google_oauth_pkce', base_url: 'cloudcode-pa://google' };
  auth.credential_pool = auth.credential_pool || {};
  auth.credential_pool[geminiProviderKey] = [{ id: `${geminiProviderKey}-${Date.now()}`, label: 'Google Gemini OAuth', auth_type: 'oauth', source: 'loopback_pkce', priority: 0, access_token: accessToken, refresh_token: refreshToken, expires_at_ms: expiresAtMs, email, base_url: 'cloudcode-pa://google' }];
  saveAuthJsonSync(authPath, auth);
}

async function materializeOAuthCredentialForHermes(profileName, providerKey, accountRecordId = '') {
  const credential = await getOAuthCredential(providerKey, accountRecordId);
  if (!credential?.access) return false;
  const expiresIn = credential.expires
    ? Math.max(60, Math.floor((Number(credential.expires) - Date.now()) / 1000))
    : 3600;
  if (providerKey === 'openai-codex') {
    await saveCodexOAuthTokens(profileName, credential.access, credential.refresh, Number(credential.expires || 0), credential.accountId || '', accountRecordId, credential.label || '');
    return true;
  }
  if (providerKey === 'claude-oauth') {
    await saveClaudeOAuthTokens(profileName, {
      access_token: credential.access,
      refresh_token: credential.refresh,
      expires_in: expiresIn,
    }, accountRecordId, credential.label || '');
    return true;
  }
  if (providerKey === geminiProviderKey) {
    await saveGeminiOAuthTokens(profileName, {
      access_token: credential.access,
      refresh_token: credential.refresh,
      expires_in: expiresIn,
    }, credential.email || '', accountRecordId, credential.label || '');
    if (credential.codeAssist && Object.keys(credential.codeAssist).length) {
      saveGeminiCodeAssistState(profileName, credential.codeAssist);
    }
    return true;
  }
  return false;
}

function providerVerificationError(message, status = 400, code = 'provider_rejected') {
  return Object.assign(new Error(message), { status, code });
}

function officialOAuthBaseUrl(providerKey, requestedBaseUrl) {
  const expected = String(providerPresetByKey(providerKey)?.baseUrl || '').trim();
  if (!expected || comparableBaseUrl(expected) !== comparableBaseUrl(requestedBaseUrl)) {
    throw providerVerificationError('OAuth Provider 的官方 Base URL 不能修改。', 400, 'provider_rejected');
  }
  return expected;
}

function oauthTokenForVerification(profileName, providerKey, accountId = '') {
  const token = oauthProviderAccessToken(profileName, providerKey, accountId);
  if (!token) throw providerVerificationError('授权已失效，请重新授权。', 401, 'oauth_expired');
  return token;
}

function providerErrorMessage(result, fallback) {
  return String(result?.body?.error?.message || result?.body?.error?.status || result?.body?.message || fallback).slice(0, 500);
}

function throwNativeVerificationFailure(result, providerLabel) {
  if (result.status === 401) throw providerVerificationError(`${providerLabel} 授权已失效，请重新授权。`, 401, 'oauth_expired');
  if (result.status === 403) throw providerVerificationError(`${providerLabel} 拒绝了当前账号请求。`, 403, 'provider_rejected');
  throw providerVerificationError(`${providerLabel} 验证失败：${providerErrorMessage(result, `HTTP ${result.status || 502}`)}`, result.status || 502, 'provider_rejected');
}

async function verifyCodexOAuthProvider(profileName, modelId, accountId = '') {
  const accessToken = oauthTokenForVerification(profileName, 'openai-codex', accountId);
  let catalog;
  try {
    catalog = await refreshCodexOAuthModels(accessToken, accountId);
  } catch (error) {
    if (error?.status === 401) throw providerVerificationError('OpenAI Codex 授权已失效，请重新授权。', 401, 'oauth_expired');
    if (error?.status === 403) throw providerVerificationError('OpenAI Codex 拒绝了当前账号请求。', 403, 'provider_rejected');
    throw providerVerificationError(error?.message || 'OpenAI Codex 模型目录刷新失败。', error?.status || 502, error?.code || 'catalog_refresh_failed');
  }
  const modelIds = catalog.modelIds || [];
  if (!modelIds.includes(modelId)) {
    throw providerVerificationError('当前 ChatGPT 账号不可用此模型。', 400, 'model_not_entitled');
  }
  return { verificationKind: 'codex_oauth', usageConsumed: false, catalog };
}

async function verifyClaudeOAuthProvider(profileName, modelId, baseUrl, accountId = '') {
  const accessToken = oauthTokenForVerification(profileName, 'claude-oauth', accountId);
  const url = process.env.FRAKIO_WORK_CLAUDE_VERIFY_URL || providerInferenceUrl({ baseUrl, apiMode: 'anthropic_messages' });
  const result = await fetchExternalJson(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14,claude-code-20250219,oauth-2025-04-20',
      'User-Agent': 'claude-code/2.1.74 (external, cli)',
      'x-app': 'cli',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 8 }),
    timeoutMs: 30000,
  });
  if (!result.ok) throwNativeVerificationFailure(result, 'Claude OAuth');
  return { verificationKind: 'claude_oauth', usageConsumed: true };
}

function geminiClientMetadata(projectId = '') {
  const platform = process.platform === 'darwin'
    ? (process.arch === 'arm64' ? 'DARWIN_ARM64' : 'DARWIN_AMD64')
    : process.platform === 'win32' ? 'WINDOWS_AMD64' : (process.arch === 'arm64' ? 'LINUX_ARM64' : 'LINUX_AMD64');
  return { ideType: 'GEMINI_CLI', platform, pluginType: 'GEMINI', ...(projectId ? { duetProject: projectId } : {}) };
}

function savedGeminiCodeAssistState(profileName) {
  const auth = loadAuthJsonSync(authJsonPathForProfile(profileName));
  return auth.providers?.[geminiProviderKey]?.code_assist || {};
}

function saveGeminiCodeAssistState(profileName, metadata) {
  const authPath = authJsonPathForProfile(profileName);
  const auth = loadAuthJsonSync(authPath);
  const provider = { ...(auth.providers?.[geminiProviderKey] || {}), code_assist: metadata };
  auth.providers = { ...(auth.providers || {}), [geminiProviderKey]: provider };
  const pool = Array.isArray(auth.credential_pool?.[geminiProviderKey]) ? auth.credential_pool[geminiProviderKey] : [];
  auth.credential_pool = { ...(auth.credential_pool || {}), [geminiProviderKey]: pool.map((entry) => ({ ...entry, code_assist: metadata })) };
  saveAuthJsonSync(authPath, auth);
}

async function geminiCodeAssistRequest(accessToken, method, body, timeoutMs = 30000) {
  const base = String(process.env.FRAKIO_WORK_GEMINI_CODE_ASSIST_URL || 'https://cloudcode-pa.googleapis.com/v1internal').replace(/\/+$/, '');
  return fetchExternalJson(`${base}:${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'User-Agent': 'GeminiCLI/Frakio-Work' },
    body: JSON.stringify(body),
    timeoutMs,
  });
}

async function geminiCodeAssistOperation(accessToken, name) {
  const base = String(process.env.FRAKIO_WORK_GEMINI_CODE_ASSIST_URL || 'https://cloudcode-pa.googleapis.com/v1internal').replace(/\/+$/, '');
  return fetchExternalJson(`${base}/${String(name || '').replace(/^\/+/, '')}`, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'User-Agent': 'GeminiCLI/Frakio-Work' },
    timeoutMs: 15000,
  });
}

async function resolveGeminiCodeAssistAccount(profileName, accessToken, accountId = '') {
  const saved = getOAuthCredentialSync(geminiProviderKey, accountId)?.codeAssist || savedGeminiCodeAssistState(profileName);
  const requestedProject = String(saved.projectId || '').trim();
  const load = await geminiCodeAssistRequest(accessToken, 'loadCodeAssist', {
    ...(requestedProject ? { cloudaicompanionProject: requestedProject } : {}),
    metadata: geminiClientMetadata(requestedProject),
  });
  if (!load.ok) throwNativeVerificationFailure(load, 'Google Gemini OAuth');
  const payload = load.body || {};
  if (payload.currentTier) {
    const projectId = String(payload.cloudaicompanionProject || requestedProject || '').trim();
    if (!projectId) throw providerVerificationError('Google Gemini OAuth 账号尚未完成 Code Assist 初始化。', 400, 'oauth_setup_required');
    return { projectId, tierId: String(payload.paidTier?.id || payload.currentTier?.id || 'standard-tier'), tierName: String(payload.paidTier?.name || payload.currentTier?.name || '') };
  }
  const tier = (Array.isArray(payload.allowedTiers) ? payload.allowedTiers : []).find((item) => item?.isDefault)
    || (Array.isArray(payload.allowedTiers) ? payload.allowedTiers[0] : null);
  if (!tier?.id) throw providerVerificationError('Google Gemini OAuth 账号当前不能启用 Code Assist。', 400, 'oauth_setup_required');
  if (tier.userDefinedCloudaicompanionProject && !requestedProject) {
    throw providerVerificationError('Google Gemini OAuth 需要先配置 Google Cloud Project。', 400, 'oauth_setup_required');
  }
  let onboard = await geminiCodeAssistRequest(accessToken, 'onboardUser', {
    tierId: tier.id,
    ...(tier.userDefinedCloudaicompanionProject ? { cloudaicompanionProject: requestedProject } : {}),
    metadata: geminiClientMetadata(requestedProject),
  });
  if (!onboard.ok) throwNativeVerificationFailure(onboard, 'Google Gemini OAuth');
  for (let attempt = 0; !onboard.body?.done && onboard.body?.name && attempt < 6; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    onboard = await geminiCodeAssistOperation(accessToken, onboard.body.name);
    if (!onboard.ok) throwNativeVerificationFailure(onboard, 'Google Gemini OAuth');
  }
  if (!onboard.body?.done) throw providerVerificationError('Google Gemini OAuth 正在初始化，请稍后重新验证。', 409, 'oauth_setup_required');
  const projectId = String(onboard.body?.response?.cloudaicompanionProject?.id || requestedProject || '').trim();
  if (!projectId) throw providerVerificationError('Google Gemini OAuth 没有返回可用的 Code Assist Project。', 400, 'oauth_setup_required');
  return { projectId, tierId: String(tier.id), tierName: String(tier.name || '') };
}

async function verifyGeminiOAuthProvider(profileName, modelId, accountId = '') {
  const accessToken = oauthTokenForVerification(profileName, geminiProviderKey, accountId);
  const account = await resolveGeminiCodeAssistAccount(profileName, accessToken, accountId);
  const result = await geminiCodeAssistRequest(accessToken, 'generateContent', {
    model: modelId,
    project: account.projectId,
    user_prompt_id: randomUUID(),
    request: {
      contents: [{ role: 'user', parts: [{ text: 'Reply OK.' }] }],
      generationConfig: { maxOutputTokens: 8 },
      session_id: randomUUID(),
    },
  });
  if (!result.ok) {
    const message = providerErrorMessage(result, `HTTP ${result.status || 502}`);
    if (result.status === 400 && /model|not found|unsupported/i.test(message)) {
      throw providerVerificationError('当前 Google 账号不可用此模型。', 400, 'model_not_entitled');
    }
    throwNativeVerificationFailure(result, 'Google Gemini OAuth');
  }
  const verifiedAt = now();
  saveGeminiCodeAssistState(profileName, { projectId: account.projectId, tierId: account.tierId, tierName: account.tierName, verifiedAt });
  const credential = await getOAuthCredential(geminiProviderKey, accountId);
  if (credential) await setOAuthCredential(geminiProviderKey, {
    ...credential,
    codeAssist: { projectId: account.projectId, tierId: account.tierId, tierName: account.tierName, verifiedAt },
  }, accountId);
  return { verificationKind: 'gemini_code_assist', usageConsumed: true, verifiedAt };
}

function readPlatformEnvAsConfig(envValues) {
  const platforms = {};
  for (const [envKey, [platform, keyPath]] of Object.entries(hermesPlatformEnvMap)) {
    const raw = envValues[envKey];
    if (raw === undefined || raw === '') continue;
    platforms[platform] = platforms[platform] || {};
    const value = keyPath === 'enabled' || keyPath === 'allow_all_users' ? String(raw).toLowerCase() === 'true' : raw;
    setNestedValue(platforms[platform], keyPath, value);
  }
  return platforms;
}

function readProxyEnvAsConfig(envValues) {
  return Object.fromEntries(hermesProxyEnvKeys.filter((key) => envValues[key]).map((key) => [key, envValues[key]]));
}

function arrayFromMcpValue(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

function objectFromMcpPairs(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, String(val)]));
  if (typeof value !== 'string') return {};
  const pairs = {};
  for (const line of value.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    const val = trimmed.slice(index + 1).trim();
    if (key) pairs[key] = val;
  }
  return pairs;
}

function sanitizeMcpServerName(name) {
  const clean = String(name || '').trim();
  if (!clean || !/^[A-Za-z0-9_.-]+$/.test(clean)) throw Object.assign(new Error('MCP Server 名称只能包含字母、数字、点、短横线和下划线。'), { status: 400 });
  return clean;
}

function mcpTransportFromConfig(config = {}) {
  if (config.url) return 'http';
  return 'stdio';
}

function knownManagedMcpTools(serverName, config = {}) {
  const toolset = String(config?.env?.HERMES_MCP_TOOLSET || '').trim();
  const workbenchToolset = String(config?.env?.HERMES_WORKBENCH_MCP_TOOLSET || '').trim();
  if (serverName === 'hermes-workbench-api' || workbenchToolset === 'api') return ['hermes_workbench_api_catalog_get', 'hermes_workbench_api_request'];
  if (serverName === 'hermes-workbench-use' || workbenchToolset === 'use') return [
    'hermes_workbench_protocol_get',
    'hermes_workbench_use_threads_list',
    'hermes_workbench_use_thread_get',
    'hermes_workbench_use_projects_list',
    'hermes_workbench_use_agents_list',
    'hermes_workbench_use_models_list',
    'hermes_workbench_use_runtime_status',
    'hermes_workbench_use_mcp_servers_list',
    'hermes_workbench_use_user_profile_get',
    'hermes_workbench_plan_user_input_request',
    'hermes_workbench_plan_submit',
    'hermes_workbench_collaboration_workflow_create',
    'hermes_workbench_collaboration_context_resolve',
    'hermes_workbench_collaboration_root_create',
    'hermes_workbench_collaboration_plan_get',
    'hermes_workbench_collaboration_plan_publish',
    'hermes_workbench_collaboration_dependency_request',
    'hermes_workbench_collaboration_blocker_report',
    'hermes_workbench_collaboration_artifact_publish',
    'hermes_workbench_collaboration_task_complete',
  ];
  if (serverName === 'hermes-studio-api' || toolset === 'api') return ['hermes_studio_api_openapi_get', 'hermes_studio_api_request'];
  if (serverName === 'hermes-studio-devices' || toolset === 'devices') return [
    'hermes_studio_lan_devices_list',
    'hermes_studio_lan_devices_scan',
    'hermes_studio_lan_peer_connect',
    'hermes_studio_lan_peer_connections',
    'hermes_studio_lan_peer_disconnect',
    'hermes_studio_lan_terminal_create',
    'hermes_studio_lan_terminal_list',
    'hermes_studio_lan_terminal_input',
    'hermes_studio_lan_terminal_read',
    'hermes_studio_lan_terminal_resize',
    'hermes_studio_lan_terminal_close',
    'hermes_studio_lan_command_exec',
    'hermes_studio_lan_file_download',
    'hermes_studio_lan_file_upload',
  ];
  if (serverName === 'hermes-studio-use' || toolset === 'use') return [
    'hermes_studio_use_chat_run',
    'hermes_studio_use_sessions_list',
    'hermes_studio_use_sessions_count',
    'hermes_studio_use_usage_stats',
    'hermes_studio_use_session_get',
    'hermes_studio_use_session_messages',
    'hermes_studio_use_session_context',
    'hermes_studio_use_session_delete',
    'hermes_studio_use_session_rename',
    'hermes_studio_use_profiles_list',
    'hermes_studio_use_available_models',
    'hermes_studio_use_model_provider_get',
    'hermes_studio_use_provider_add',
    'hermes_studio_use_provider_delete',
    'hermes_studio_use_worker_status',
  ];
  if (serverName === 'agentmail' || String(config.command || '').includes('agentmail')) return [
    'list_inboxes',
    'get_inbox',
    'create_inbox',
    'delete_inbox',
    'list_threads',
    'get_thread',
    'get_attachment',
    'send_message',
    'reply_to_message',
    'forward_message',
    'update_message',
  ];
  return [];
}

function workbenchMcpServerConfig(toolset, profileName = 'default') {
  const cleanToolset = toolset === 'api' ? 'api' : 'use';
  const nodeCommand = findHermesNodeSync();
  return {
    command: nodeCommand,
    args: [path.join(projectRoot, 'bin', 'hermes-workbench-mcp.mjs'), cleanToolset],
    env: {
      HERMES_WORKBENCH_URL: `http://127.0.0.1:${port}`,
      HERMES_WORKBENCH_PROFILE: profileName,
      HERMES_WORKBENCH_MCP_TOOLSET: cleanToolset,
      HERMES_WORKBENCH_MCP_SERVER_NAME: `hermes-workbench-${cleanToolset}`,
      HERMES_WORKBENCH_PROTOCOL_VERSION: String(workbenchCollaborationProtocolVersion),
    },
    enabled: true,
  };
}

async function probeStdioMcpTools(serverConfig = {}) {
  const command = String(serverConfig.command || '').trim();
  if (!command) throw new Error('MCP server command is empty.');
  const resolvedCommand = await resolveRuntimeCommand(command);
  if (!resolvedCommand) {
    const error = new Error(`MCP server requires ${command}, but ${command} is not available in Frakio runtime PATH.`);
    error.code = 'ENOENT';
    throw error;
  }
  const args = Array.isArray(serverConfig.args) ? serverConfig.args.map(String) : [];
  const child = spawn(resolvedCommand, args, {
    cwd: projectRoot,
    env: runtimeEnv(serverConfig.env || {}),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
  child.stdin.end();
  const exitPromise = new Promise((resolve) => child.on('close', resolve));
  const timeoutPromise = new Promise((_, reject) => setTimeout(() => {
    child.kill('SIGTERM');
    reject(new Error('MCP stdio probe timed out.'));
  }, 7000));
  await Promise.race([exitPromise, timeoutPromise]);
  if (stderr.trim() && !stdout.trim()) throw new Error(stderr.trim());
  const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  const responses = lines.map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  const tools = responses.find((item) => item.id === 2)?.result?.tools || [];
  return tools.map((tool) => String(tool?.name || '')).filter(Boolean);
}

function isWorkbenchMcpServer(name, config = {}) {
  return String(name || '').startsWith('hermes-workbench-') || Boolean(config?.env?.HERMES_WORKBENCH_MCP_TOOLSET);
}

function normalizeMcpServerConfig(input = {}) {
  const transport = String(input.transport || (input.url ? 'http' : 'stdio')).toLowerCase() === 'http' ? 'http' : 'stdio';
  const next = {};
  if (transport === 'http') {
    const url = String(input.url || '').trim();
    if (!url) throw Object.assign(new Error('HTTP MCP Server 需要填写 URL。'), { status: 400 });
    next.url = url;
    const headers = objectFromMcpPairs(input.headers);
    if (Object.keys(headers).length) next.headers = headers;
    if (input.auth) next.auth = String(input.auth).trim();
  } else {
    const command = String(input.command || '').trim();
    if (!command) throw Object.assign(new Error('stdio MCP Server 需要填写 command。'), { status: 400 });
    next.command = command;
    const args = arrayFromMcpValue(input.args);
    if (args.length) next.args = args;
    const env = objectFromMcpPairs(input.env);
    if (Object.keys(env).length) next.env = env;
  }
  next.enabled = input.enabled !== false;
  const timeout = Number(input.timeout || 0);
  const connectTimeout = Number(input.connectTimeout || input.connect_timeout || 0);
  if (timeout > 0) next.timeout = timeout;
  if (connectTimeout > 0) next.connect_timeout = connectTimeout;
  if (input.supports_parallel_tool_calls !== undefined) next.supports_parallel_tool_calls = Boolean(input.supports_parallel_tool_calls);
  const tools = input.tools && typeof input.tools === 'object' ? input.tools : {};
  const normalizedTools = {};
  const include = arrayFromMcpValue(tools.include);
  const exclude = arrayFromMcpValue(tools.exclude);
  if (include.length) normalizedTools.include = include;
  if (exclude.length) normalizedTools.exclude = exclude;
  if (tools.resources !== undefined) normalizedTools.resources = Boolean(tools.resources);
  if (tools.prompts !== undefined) normalizedTools.prompts = Boolean(tools.prompts);
  if (Object.keys(normalizedTools).length) next.tools = normalizedTools;
  return next;
}

function preserveMaskedMcpSecrets(current = {}, next = {}) {
  for (const key of ['env', 'headers']) {
    if (!next[key] || typeof next[key] !== 'object') continue;
    const currentValues = current[key] && typeof current[key] === 'object' ? current[key] : {};
    for (const [itemKey, value] of Object.entries(next[key])) {
      if (String(value) === '••••••••' && currentValues[itemKey] !== undefined) next[key][itemKey] = currentValues[itemKey];
    }
  }
  return next;
}

function publicMcpServer(name, config = {}, extras = {}) {
  const tools = Array.isArray(extras.tools) ? extras.tools : knownManagedMcpTools(name, config);
  const enabled = config.enabled !== false;
  const connected = Boolean(enabled && tools.length && !extras.error);
  const env = config.env && typeof config.env === 'object' ? config.env : {};
  const headers = config.headers && typeof config.headers === 'object' ? config.headers : {};
  const maskRecord = (record) => Object.fromEntries(Object.entries(record).map(([key, value]) => {
    const sensitive = /token|key|secret|password|authorization/i.test(key);
    return [key, sensitive && value ? '••••••••' : String(value)];
  }));
  return {
    name,
    transport: mcpTransportFromConfig(config),
    command: config.command || '',
    args: Array.isArray(config.args) ? config.args : [],
    env: maskRecord(env),
    url: config.url || '',
    headers: maskRecord(headers),
    auth: config.auth || '',
    enabled,
    status: extras.status || (enabled ? (connected ? 'connected' : 'configured') : 'disabled'),
    statusLabel: extras.status === 'failed' ? '启动失败' : enabled ? (connected ? '已连接' : '待重载') : '已停用',
    tools,
    toolCount: tools.length,
    availableToolCount: tools.length,
    timeout: config.timeout || null,
    connectTimeout: config.connect_timeout || null,
    supportsParallelToolCalls: Boolean(config.supports_parallel_tool_calls),
    filter: config.tools || {},
    error: extras.error || '',
  };
}

async function readMcpConfig(profileName = 'default') {
  const cleanProfile = slug(profileName || 'default');
  await ensureWorkbenchMcpServers(cleanProfile);
  const configPath = mcpConfigPathForProfile(cleanProfile);
  const config = await readYamlFile(configPath);
  const servers = config.mcp_servers && typeof config.mcp_servers === 'object' ? config.mcp_servers : {};
  const missingCommands = await findMissingMcpCommands(cleanProfile);
  const missingByServer = new Map(missingCommands.map((item) => [item.serverName, item]));
  const publicServers = Object.entries(servers).map(([name, serverConfig]) => {
    const missing = missingByServer.get(name);
    return publicMcpServer(name, serverConfig, missing ? { status: 'failed', error: missing.message } : {});
  }).sort((a, b) => a.name.localeCompare(b.name));
  const stats = {
    total: publicServers.length,
    connected: publicServers.filter((server) => server.enabled && server.status === 'connected').length,
    disconnected: publicServers.filter((server) => !server.enabled || server.status !== 'connected').length,
    tools: publicServers.reduce((sum, server) => sum + server.toolCount, 0),
  };
  return {
    profile: cleanProfile,
    configPath,
    servers: publicServers,
    stats,
    runtime: { bridgeReady: Boolean(hermesBridgeProcess), lastError: hermesBridgeLastError || '' },
  };
}

async function ensureWorkbenchMcpServers(profileName = 'default') {
  const cleanProfile = slug(profileName || 'default');
  const configPath = mcpConfigPathForProfile(cleanProfile);
  await mkdir(path.dirname(configPath), { recursive: true });
  const config = await readYamlFile(configPath);
  const servers = config.mcp_servers && typeof config.mcp_servers === 'object' ? { ...config.mcp_servers } : {};
  let changed = false;
  for (const toolset of ['api', 'use']) {
    const name = `hermes-workbench-${toolset}`;
    const desired = workbenchMcpServerConfig(toolset, cleanProfile);
    if (!servers[name]) {
      servers[name] = desired;
      changed = true;
      continue;
    }
    const current = servers[name] || {};
    const next = {
      ...current,
      command: desired.command,
      args: desired.args,
      env: { ...(current.env || {}), ...desired.env },
      enabled: current.enabled !== false,
    };
    if (JSON.stringify(current) !== JSON.stringify(next)) {
      servers[name] = next;
      changed = true;
    }
  }
  if (!changed) return;
  config.mcp_servers = servers;
  await writeFile(configPath, YAML.stringify(config), 'utf8');
}

async function updateMcpServers(profileName, updater) {
  const cleanProfile = slug(profileName || 'default');
  const configPath = mcpConfigPathForProfile(cleanProfile);
  await mkdir(path.dirname(configPath), { recursive: true });
  const config = await readYamlFile(configPath);
  const servers = config.mcp_servers && typeof config.mcp_servers === 'object' ? { ...config.mcp_servers } : {};
  const nextServers = await updater(servers);
  if (nextServers && Object.keys(nextServers).length) config.mcp_servers = nextServers;
  else delete config.mcp_servers;
  await writeFile(configPath, YAML.stringify(config), 'utf8');
  return readMcpConfig(cleanProfile);
}

async function resolveHermesExecutable() {
  const candidates = [
    process.env.HERMES_BIN,
    path.join(hermesAgentSourcePath, '.venv', 'bin', 'hermes'),
    path.join(hermesAgentSourcePath, 'venv', 'bin', 'hermes'),
    path.join(hermesAgentSourcePath, 'hermes'),
    path.join(hermesHome, 'hermes-agent', '.venv', 'bin', 'hermes'),
    path.join(hermesHome, 'hermes-agent', 'venv', 'bin', 'hermes'),
    path.join(hermesHome, 'hermes-agent', 'hermes'),
    await resolveCommand('hermes'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return candidates[0] || '';
}

function parseHermesMcpTestTools(output = '') {
  const tools = [];
  for (const line of String(output || '').split('\n')) {
    const match = line.match(/\b([A-Za-z_][A-Za-z0-9_.-]{2,})\b/);
    if (!match) continue;
    const value = match[1];
    if (/^(Testing|Transport|Auth|Connection|Tools|Found|Server|Status)$/i.test(value)) continue;
    if (!tools.includes(value)) tools.push(value);
  }
  return tools.slice(0, 200);
}

function normalizeProfileList(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  const seen = new Set();
  const profiles = [];
  for (const item of source) {
    const clean = slug(item || '');
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    profiles.push(clean);
  }
  return profiles;
}

function gatewayManagementFromConfig(config) {
  const raw = config || {};
  if (raw.multiplex_profiles === true || raw.multiplex_profiles === 'true' || raw.gateway?.multiplex_profiles === true || raw.gateway?.multiplex_profiles === 'true') {
    return 'unified';
  }
  return 'per_profile';
}

function normalizeGatewayAutoStartConfig(value, defaultConfig = {}) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const management = gatewayManagementModes.has(String(raw.management || '')) ? String(raw.management) : gatewayManagementFromConfig(defaultConfig);
  return {
    enabled: raw.enabled !== false,
    management,
    include: normalizeProfileList(raw.include),
    exclude: normalizeProfileList(raw.exclude),
  };
}

async function readGatewayAutoStartConfig() {
  const state = await readState();
  const defaultConfig = await readYamlFile(profileConfigPath('default'));
  return normalizeGatewayAutoStartConfig(state.integrations?.hermesAgent?.gatewayAutoStart, defaultConfig);
}

async function writeGatewayAutoStartConfig(values = {}) {
  const state = await readState();
  const previous = normalizeGatewayAutoStartConfig(state.integrations?.hermesAgent?.gatewayAutoStart, await readYamlFile(profileConfigPath('default')));
  const next = normalizeGatewayAutoStartConfig({ ...previous, ...values });
  if ('management' in values) {
    await updateProfileYaml('default', (current) => {
      if (next.management === 'unified') current.multiplex_profiles = true;
      else {
        delete current.multiplex_profiles;
        if (current.gateway && typeof current.gateway === 'object' && !Array.isArray(current.gateway)) delete current.gateway.multiplex_profiles;
      }
      return current;
    });
  }
  state.integrations.hermesAgent = {
    ...(state.integrations.hermesAgent || {}),
    gatewayAutoStart: next,
    lastCheckedAt: now(),
  };
  await writeState(state);
  return next;
}

async function registerProfileGatewayAutoStart(profileName) {
  const clean = slug(profileName || '');
  const current = await readGatewayAutoStartConfig();
  if (!clean || current.management !== 'per_profile') return current;
  const include = current.include.length
    ? Array.from(new Set([...current.include, clean]))
    : ['default', clean];
  const exclude = current.exclude.filter((name) => name !== clean);
  return writeGatewayAutoStartConfig({ include, exclude });
}

function unregisterProfileGatewayAutoStart(profileName, state) {
  const current = normalizeGatewayAutoStartConfig(state.integrations?.hermesAgent?.gatewayAutoStart);
  const rawProfileName = String(profileName || '').trim();
  if (!rawProfileName) return current;
  const clean = slug(rawProfileName);
  const next = {
    ...current,
    include: current.include.filter((name) => name !== clean),
    exclude: current.exclude.filter((name) => name !== clean),
  };
  state.integrations.hermesAgent = {
    ...(state.integrations.hermesAgent || {}),
    gatewayAutoStart: next,
    lastCheckedAt: now(),
  };
  return next;
}

async function pruneMissingGatewayAutoStartProfiles(profiles) {
  const existing = new Set(profiles.map((profile) => profile.name));
  let removed = [];
  await updateState((state) => {
    const current = normalizeGatewayAutoStartConfig(state.integrations?.hermesAgent?.gatewayAutoStart);
    const stale = [...current.include, ...current.exclude]
      .filter((name) => name !== 'default' && !existing.has(name));
    removed = Array.from(new Set(stale));
    if (!removed.length) return;
    state.integrations.hermesAgent = {
      ...(state.integrations.hermesAgent || {}),
      gatewayAutoStart: {
        ...current,
        include: current.include.filter((name) => name === 'default' || existing.has(name)),
        exclude: current.exclude.filter((name) => name === 'default' || existing.has(name)),
      },
      lastCheckedAt: now(),
    };
  });
  return removed;
}

function normalizeJob(job) {
  const idValue = String(job?.job_id || job?.id || '').trim();
  const skills = Array.isArray(job?.skills) ? job.skills.map(String).filter(Boolean) : job?.skill ? [String(job.skill)] : [];
  const schedule = job?.schedule || '';
  const scheduleDisplay = job?.schedule_display || schedule?.display || schedule?.expr || schedule?.run_at || String(schedule || '');
  return {
    ...job,
    id: idValue,
    job_id: idValue,
    name: String(job?.name || job?.prompt || idValue || 'cron job').slice(0, 80),
    prompt: String(job?.prompt || ''),
    prompt_preview: String(job?.prompt || '').replace(/\s+/g, ' ').slice(0, 120),
    skills,
    skill: job?.skill || skills[0] || null,
    schedule,
    schedule_display: scheduleDisplay || '',
    repeat: job?.repeat || { times: null, completed: 0 },
    enabled: job?.enabled !== false,
    state: job?.state || (job?.enabled === false ? 'paused' : 'scheduled'),
    deliver: job?.deliver || 'local',
    next_run_at: job?.next_run_at || null,
    last_run_at: job?.last_run_at || null,
    last_status: job?.last_status || null,
    last_error: job?.last_error || null,
  };
}

function hermesCommandCandidates() {
  const candidates = [];
  if (process.env.HERMES_BIN) {
    const configuredHermesBin = process.env.HERMES_BIN;
    candidates.push(/\.(?:cjs|mjs|js)$/i.test(configuredHermesBin)
      ? { command: process.execPath, args: [configuredHermesBin], cwd: projectRoot }
      : { command: configuredHermesBin, args: [], cwd: projectRoot });
  }
  const frakioRuntime = findFrakioHermesRuntimeSync();
  if (frakioRuntime?.python) {
    candidates.push({ command: frakioRuntime.python, args: ['-m', 'hermes_cli.main'], cwd: hermesHome });
  }
  const sourceDirs = Array.from(new Set([
    hermesAgentSourcePath,
    path.join(hermesHome, 'hermes-agent'),
    path.join(homeDir, '.hermes', 'hermes-agent'),
  ]));
  for (const sourceDir of sourceDirs) {
    candidates.push({ command: path.join(sourceDir, 'hermes'), args: [], cwd: sourceDir });
  }
  candidates.push({ command: 'hermes', args: [], cwd: projectRoot });
  const uvCommands = Array.from(new Set(['uv', '/opt/homebrew/bin/uv', '/usr/local/bin/uv', path.join(homeDir, '.local', 'bin', 'uv')]));
  for (const uvCommand of uvCommands) {
    for (const sourceDir of sourceDirs) candidates.push({ command: uvCommand, args: ['run', 'hermes'], cwd: sourceDir });
  }
  return candidates;
}

async function runHermesCommand(args, options = {}) {
  const env = runtimeEnv({ HERMES_HOME: options.profile ? profileConfigDir(options.profile) : hermesHome });
  const errors = [];
  for (const candidate of hermesCommandCandidates()) {
    const commandArgs = [...candidate.args, ...args.map(String)];
    try {
      return await execFileAsync(candidate.command, commandArgs, {
        cwd: options.cwd || candidate.cwd,
        env,
        timeout: options.timeout || 60000,
        maxBuffer: options.maxBuffer || 50 * 1024 * 1024,
        windowsHide: true,
      });
    } catch (error) {
      const stderr = String(error?.stderr || '').trim();
      const stdout = String(error?.stdout || '').trim();
      const message = stderr || stdout || error?.message || 'Hermes command failed';
      errors.push(`${candidate.command} ${candidate.args.join(' ')}: ${message}`);
      if (error?.code === 'ENOENT') continue;
      if (process.env.HERMES_BIN) {
        const wrapped = new Error(message);
        wrapped.status = 500;
        throw wrapped;
      }
    }
  }
  const wrapped = new Error(errors.join('\n') || 'Hermes command is unavailable.');
  wrapped.status = 503;
  throw wrapped;
}

function kanbanBoard(value) {
  const board = slug(value || 'default');
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(board)) {
    const error = new Error('Invalid kanban board slug.');
    error.status = 400;
    throw error;
  }
  return board;
}

function parseHermesJson(stdout, fallback = null) {
  try {
    return JSON.parse(String(stdout || '').trim() || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function workflowById(thread, workflowId = '') {
  const workflows = thread?.collaboration?.workflows || [];
  const resolvedId = workflowId || thread?.collaboration?.activeWorkflowId || '';
  return workflows.find((workflow) => workflow.id === resolvedId) || null;
}

function agentProfileForId(state, agentId) {
  const agent = state.agents.find((item) => item.id === agentId);
  return String(agent?.profileName || agent?.id || '').trim();
}

function rememberIdempotent(collaboration, key, result) {
  const clean = String(key || '').trim().slice(0, 160);
  if (!clean) return;
  collaboration.idempotency = { ...(collaboration.idempotency || {}), [clean]: { result, createdAt: now() } };
  const entries = Object.entries(collaboration.idempotency).slice(-200);
  collaboration.idempotency = Object.fromEntries(entries);
}

function idempotentResult(collaboration, key) {
  const clean = String(key || '').trim().slice(0, 160);
  return clean ? collaboration?.idempotency?.[clean]?.result || null : null;
}

function appendThreadCollaborationEvent(thread, event) {
  return appendCollaborationEvent(thread.collaboration, event, () => id('collab_event'));
}

async function createCollaborationWorkflow(state, thread, input = {}) {
  const cached = idempotentResult(thread.collaboration, input.idempotencyKey);
  if (cached) return { ...cached, idempotent: true };
  const name = String(input.name || thread.title || '协作工作流').trim().slice(0, 120);
  const generatedSlug = `${slug(name).slice(0, 46) || 'workflow'}-${Date.now().toString(36).slice(-6)}`;
  const board = kanbanBoard(input.boardSlug || generatedSlug);
  const boardsResult = await runHermesCommand(['kanban', 'boards', 'list', '--json']);
  const boards = parseHermesJson(boardsResult.stdout, []);
  if (!boards.some((item) => item.slug === board)) {
    const args = ['kanban', 'boards', 'create', board, '--name', name];
    if (input.description) args.push('--description', String(input.description));
    await runHermesCommand(args);
  }
  const coordinatorAgentId = state.agents.some((agent) => agent.id === input.coordinatorAgentId)
    ? input.coordinatorAgentId
    : thread.activeAgentId || thread.defaultAgentId || resolveDefaultAgentId(state);
  const workflow = {
    id: id('workflow'),
    name,
    boardSlug: board,
    status: 'active',
    coordinatorAgentId,
    fallbackDecisionAgentId: state.ui?.fallbackDecisionAgentId || resolveDefaultAgentId(state),
    rootTaskIds: [],
    currentRootTaskId: '',
    planRevision: 0,
    plan: null,
    executionBindings: {},
    interventionQueue: [],
    control: { operationId: '', idempotencyKey: '', action: '', state: 'idle', affectedTaskIds: [], stoppedRuns: 0, blockedTasks: 0, preservedWaitingTasks: 0, failedTaskIds: [], heldInterventionCount: 0, startedAt: null, completedAt: null, error: '' },
    capability: { status: 'unknown', protocolVersion: 0, error: '' },
    createdAt: now(),
    updatedAt: now(),
    completedAt: null,
    pausedAt: null,
    cancelledAt: null,
    archivedAt: null,
  };
  thread.collaboration.workflows = [...(thread.collaboration.workflows || []), workflow];
  thread.collaboration.activeWorkflowId = workflow.id;
  const event = appendThreadCollaborationEvent(thread, { type: 'workflow.created', workflowId: workflow.id, actorAgentId: coordinatorAgentId, title: name, detail: `已绑定看板 ${board}` });
  const result = { workflow, event };
  rememberIdempotent(thread.collaboration, input.idempotencyKey, result);
  return result;
}

async function createCollaborationRoot(state, thread, workflow, input = {}) {
  const cached = idempotentResult(thread.collaboration, input.idempotencyKey);
  if (cached) return { ...cached, idempotent: true };
  const title = String(input.title || '').trim();
  if (!title) throw Object.assign(new Error('title is required.'), { status: 400 });
  const assignee = agentProfileForId(state, input.assigneeAgentId || workflow.coordinatorAgentId);
  const args = ['kanban', '--board', workflow.boardSlug, 'create', title, '--json', '--triage'];
  const rootBody = [String(input.body || '').trim(), `Frakio 协作上下文：threadId=${thread.id} workflowId=${workflow.id} boardSlug=${workflow.boardSlug}`].filter(Boolean).join('\n\n');
  if (rootBody) args.push('--body', rootBody);
  if (assignee) args.push('--assignee', assignee);
  if (input.idempotencyKey) args.push('--idempotency-key', String(input.idempotencyKey));
  const { stdout } = await runHermesCommand(args);
  const task = parseHermesJson(stdout, {});
  workflow.rootTaskIds = [...new Set([...(workflow.rootTaskIds || []), task.id].filter(Boolean))];
  workflow.currentRootTaskId = task.id || '';
  workflow.updatedAt = now();
  if (task.id) {
    const rootAgent = state.agents.find((item) => item.id === (input.assigneeAgentId || workflow.coordinatorAgentId));
    runtimeStore.upsertWorkTask({
      id: task.id,
      workflowId: workflow.id,
      title: task.title || title,
      description: rootBody,
      assigneeAgentId: input.assigneeAgentId || workflow.coordinatorAgentId,
      runtimeId: rootAgent ? runtimeForAgent(rootAgent, thread.agentRuntimeOverrides?.[rootAgent.id] || '') : 'hermes',
      dependencies: [],
      status: 'planned',
      attempt: 0,
      idempotencyKey: String(input.idempotencyKey || `root:${task.id}`),
      metadata: { root: true, hermesBoardSlug: workflow.boardSlug },
    });
  }
  const event = appendThreadCollaborationEvent(thread, { type: 'task.created', workflowId: workflow.id, taskId: task.id, actorAgentId: input.actorAgentId || workflow.coordinatorAgentId, title: task.title || title, detail: '协调 Agent 正在规划', payload: { root: true, planning: true } });
  const result = { task, event };
  rememberIdempotent(thread.collaboration, input.idempotencyKey, result);
  return result;
}

async function publishApprovedWorkPlan(state, thread, planSession, draft) {
  let workflow = workflowById(thread);
  if (!workflow || workflow.status === 'cancelled' || workflow.status === 'archived') {
    const created = await createCollaborationWorkflow(state, thread, {
      name: draft.title || thread.title || '协作工作流',
      coordinatorAgentId: planSession.authorAgentId,
      idempotencyKey: `approved-plan-workflow:${planSession.id}`,
    });
    workflow = created.workflow;
  }
  const existingRootId = workflow.approvedPlanId === planSession.id ? workflow.currentRootTaskId : '';
  let rootTask = existingRootId ? { id: existingRootId } : null;
  if (!rootTask?.id) {
    if (workflow.currentRootTaskId) {
      const detail = await readKanbanTaskDetail(workflow.boardSlug, workflow.currentRootTaskId).catch(() => null);
      const status = String(detail?.task?.status || detail?.status || '');
      if (status && !['done', 'archived', 'cancelled', 'failed'].includes(status)) {
        throw Object.assign(new Error('当前 Work 根任务仍未完成，不能发布新的批准计划。'), { status: 409, code: 'WORK_ROOT_ACTIVE' });
      }
    }
    workflow.coordinatorAgentId = planSession.authorAgentId || workflow.coordinatorAgentId;
    workflow.status = 'active';
    workflow.completedAt = null;
    workflow.plan = null;
    workflow.planRevision = 0;
    workflow.executionBindings = {};
    const rootResult = await createCollaborationRoot(state, thread, workflow, {
      title: draft.title,
      body: draft.summary,
      assigneeAgentId: workflow.coordinatorAgentId,
      actorAgentId: 'user',
      idempotencyKey: `approved-plan-root:${planSession.id}:${draft.revision}`,
    });
    rootTask = rootResult.task;
    workflow.approvedPlanId = planSession.id;
  }
  const rootTaskId = String(rootTask?.id || workflow.currentRootTaskId || '');
  const plan = validateCollaborationPlan({
    rootTaskId,
    baseRevision: 0,
    goal: draft.title,
    summary: draft.summary,
    tasks: draft.steps.map((step) => ({
      key: step.key,
      title: step.title,
      description: step.description,
      assigneeAgentId: step.assigneeAgentId,
      expectedResult: step.expectedResult,
      dependsOnKeys: step.dependsOnKeys,
    })),
  }, {
    agentIds: state.agents.map((agent) => agent.id),
    currentRevision: 0,
    rootTaskId,
  });
  const taskByKey = new Map();
  for (const task of plan.tasks) {
    const assignee = agentProfileForId(state, task.assigneeAgentId);
    const body = [
      task.description,
      task.expectedResult ? `预期结果：${task.expectedResult}` : '',
      `已批准 Frakio Plan：planId=${planSession.id} revision=${draft.revision}`,
      `Frakio 协作上下文：threadId=${thread.id} workflowId=${workflow.id} rootTaskId=${rootTaskId} taskKey=${task.key}`,
    ].filter(Boolean).join('\n\n');
    const args = [
      'kanban', '--board', workflow.boardSlug, 'create', task.title, '--json', '--body', body,
      '--idempotency-key', `approved-plan:${planSession.id}:${draft.revision}:${task.key}`,
    ];
    if (assignee) args.push('--assignee', assignee);
    const created = parseHermesJson((await runHermesCommand(args)).stdout, {});
    task.taskId = created.id;
    taskByKey.set(task.key, task);
    const taskAgent = state.agents.find((item) => item.id === task.assigneeAgentId);
    const taskRuntimeId = taskAgent
      ? runtimeForAgent(taskAgent, thread.agentRuntimeOverrides?.[taskAgent.id] || '')
      : 'hermes';
    runtimeStore.upsertWorkTask({
      id: created.id,
      workflowId: workflow.id,
      title: task.title,
      description: body,
      assigneeAgentId: task.assigneeAgentId,
      runtimeId: taskRuntimeId,
      dependencies: [],
      status: task.dependsOnKeys.length ? 'blocked' : 'ready',
      attempt: 0,
      idempotencyKey: `approved-plan:${planSession.id}:${draft.revision}:${task.key}`,
      metadata: { taskKey: task.key, approvedPlanId: planSession.id, hermesBoardSlug: workflow.boardSlug },
    });
    const alreadyRecorded = (thread.collaboration?.events || []).some((event) => event.type === 'task.created' && event.taskId === created.id);
    if (!alreadyRecorded) {
      appendThreadCollaborationEvent(thread, {
        type: 'task.created',
        workflowId: workflow.id,
        taskId: created.id,
        actorAgentId: workflow.coordinatorAgentId,
        title: task.title,
        detail: task.description || task.expectedResult,
        payload: { rootTaskId, taskKey: task.key, assigneeAgentId: task.assigneeAgentId, approvedPlanId: planSession.id },
      });
    }
  }
  for (const task of plan.tasks) {
    for (const dependencyKey of task.dependsOnKeys) {
      const dependency = taskByKey.get(dependencyKey);
      if (!dependency?.taskId || !task.taskId) continue;
      await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'link', dependency.taskId, task.taskId]);
      const mirroredTask = runtimeStore.getWorkTask(task.taskId);
      if (mirroredTask) {
        runtimeStore.upsertWorkTask({
          ...mirroredTask,
          dependencies: Array.from(new Set([...(mirroredTask.dependencies || []), dependency.taskId])),
          status: 'blocked',
          idempotencyKey: mirroredTask.idempotencyKey,
        });
      }
      const alreadyRecorded = (thread.collaboration?.events || []).some((event) => event.type === 'dependency.created' && event.workflowId === workflow.id && event.taskId === task.taskId && event.payload?.parentTaskId === dependency.taskId);
      if (!alreadyRecorded) {
        appendThreadCollaborationEvent(thread, {
          type: 'dependency.created',
          workflowId: workflow.id,
          taskId: task.taskId,
          actorAgentId: workflow.coordinatorAgentId,
          title: `${task.title} 等待 ${dependency.title}`,
          detail: '已批准计划依赖',
          payload: { parentTaskId: dependency.taskId, requesterTaskId: task.taskId, rootTaskId, approvedPlanId: planSession.id },
        });
      }
    }
  }
  const activeTasks = plan.tasks.filter((task) => task.taskId);
  for (const task of activeTasks) await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'link', task.taskId, rootTaskId]);
  if (activeTasks.length) {
    await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'comment', rootTaskId, '已批准计划已发布。所有父任务完成后，请读取父任务结果与交付物，生成面向用户的最终汇总，然后完成根任务。', '--author', 'Frakio Work']);
    await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'block', rootTaskId, '等待已批准计划中的任务完成', '--kind', 'dependency']);
  }
  const storedPlan = {
    ...plan,
    revision: 1,
    tasks: plan.tasks,
    publishedAt: now(),
    coordinatorAgentId: workflow.coordinatorAgentId,
    approvedPlanId: planSession.id,
    approvedPlanRevision: draft.revision,
  };
  workflow.plan = storedPlan;
  workflow.planRevision = 1;
  workflow.executionBindings = Object.fromEntries(plan.tasks.filter((task) => task.taskId).map((task) => [task.key, {
    taskId: task.taskId,
    agentId: task.assigneeAgentId,
    runtimeId: runtimeStore.getWorkTask(task.taskId)?.runtimeId || 'hermes',
    revision: 1,
    sessionId: `work-task-${task.taskId}-${task.assigneeAgentId}`,
    runId: '',
    status: 'ready',
  }]));
  workflow.updatedAt = now();
  const existingPublishEvent = (thread.collaboration?.events || []).find((event) => event.type === 'plan.published' && event.payload?.approvedPlanId === planSession.id);
  const event = existingPublishEvent || appendThreadCollaborationEvent(thread, {
    type: 'plan.published',
    workflowId: workflow.id,
    taskId: rootTaskId,
    actorAgentId: workflow.coordinatorAgentId,
    title: '已批准计划已发布',
    detail: draft.summary,
    payload: { revision: 1, taskCount: activeTasks.length, approvedPlanId: planSession.id, approvedPlanRevision: draft.revision },
  });
  for (const agentId of [...new Set(activeTasks.map((task) => task.assigneeAgentId))]) {
    const agent = state.agents.find((item) => item.id === agentId);
    const runtimeId = agent ? runtimeForAgent(agent, thread.agentRuntimeOverrides?.[agent.id] || '') : 'hermes';
    if (agent && runtimeId === 'hermes') await ensureWorkbenchMcpServers(await resolveHermesProfileNameForAgent(agent));
  }
  thread.updatedAt = now();
  await writeState(state);
  const dispatch = await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'dispatch', '--max', '32', '--json'])
    .then(({ stdout }) => parseHermesJson(stdout, {}))
    .catch((error) => ({ deferredToGateway: true, error: String(error?.message || error) }));
  return { workflow, rootTaskId, plan: storedPlan, event, dispatch, snapshot: await collaborationSnapshot(state, thread, workflow.id) };
}

function workbenchToolNames(response = {}) {
  return (response.results || []).flatMap((entry) => (entry.tools || []).map((tool) => String(tool.name || tool))).filter(Boolean);
}

async function ensureCollaborationRuntimeCapability(profileName = 'default', requiredTools = requiredWorkbenchCollaborationTools) {
  await ensureWorkbenchMcpServers(profileName);
  if (process.env.FRAKIO_WORK_SKIP_MCP_RUNTIME_CHECK === '1') {
    return { status: 'ready', protocolVersion: workbenchCollaborationProtocolVersion, tools: knownManagedMcpTools('hermes-workbench-use', workbenchMcpServerConfig('use', profileName)), reloaded: false };
  }
  let bridge = await probeHermesBridge({ timeoutMs: 1000 }).catch(() => null);
  if (!bridge?.ready) {
    const started = await startHermesBridge();
    bridge = started.bridge;
  }
  const inspect = () => requestHermesBridge({ action: 'mcp_tools_list', profile: profileName, server: 'hermes-workbench-use', raw: true }, { timeoutMs: 10000, retryMs: 1000 });
  let runtime = await inspect().catch(() => ({ results: [] }));
  let tools = workbenchToolNames(runtime);
  let missing = requiredTools.filter((tool) => !tools.includes(tool));
  let reloaded = false;
  let reloadStatus = null;
  if (missing.length) {
    reloadStatus = await requestHermesBridge({ action: 'mcp_reload', profile: profileName, server: 'hermes-workbench-use' }, { timeoutMs: 130000, retryMs: 1000 }).catch((error) => ({ ok: false, connected: false, error: String(error?.message || error), connectionErrors: {} }));
    reloaded = true;
    if (reloadStatus?.mcpAvailable === false) {
      const error = new Error('协作运行时缺少 MCP 支持。');
      error.status = 503;
      error.code = 'COLLABORATION_RUNTIME_DEPENDENCY_MISSING';
      error.details = { profileName, missingPythonPackages: ['mcp'], missingTools: [], reloadStatus: 'failed', connectionErrors: reloadStatus.connectionErrors || {} };
      throw error;
    }
    runtime = await inspect().catch(() => ({ results: [] }));
    tools = workbenchToolNames(runtime);
    missing = requiredTools.filter((tool) => !tools.includes(tool));
    if (missing.length && !reloadStatus?.connected) {
      const sessions = await requestHermesBridge({ action: 'list' }, { timeoutMs: 5000, retryMs: 500 }).catch(() => ({ sessions: [] }));
      const hasActiveProfileRun = (sessions.sessions || []).some((session) => session.profile === profileName && (session.running === true || session.status === 'running'));
      if (!hasActiveProfileRun) {
        await requestHermesBridge({ action: 'destroy_profile', profile: profileName }, { timeoutMs: 10000, retryMs: 500 }).catch(() => null);
        reloadStatus = await requestHermesBridge({ action: 'mcp_reload', profile: profileName, server: 'hermes-workbench-use' }, { timeoutMs: 130000, retryMs: 1000 }).catch((error) => ({ ok: false, connected: false, error: String(error?.message || error), connectionErrors: {} }));
        runtime = await inspect().catch(() => ({ results: [] }));
        tools = workbenchToolNames(runtime);
        missing = requiredTools.filter((tool) => !tools.includes(tool));
      }
    }
  }
  if (missing.length) {
    const error = new Error('协作运行时未准备好。');
    error.status = 503;
    error.code = 'COLLABORATION_CAPABILITY_MISSING';
    error.details = { profileName, missingPythonPackages: [], missingTools: missing, actualTools: tools, reloadStatus: reloadStatus?.connected ? 'connected' : 'failed', connectionErrors: reloadStatus?.connectionErrors || {}, bridge };
    throw error;
  }
  return { status: 'ready', protocolVersion: workbenchCollaborationProtocolVersion, tools, reloaded, reloadStatus, bridge };
}

async function ensurePlanRuntimeCapability(profileName = 'default') {
  return ensureCollaborationRuntimeCapability(profileName, requiredWorkbenchPlanTools);
}

async function initializeNewThreadWorkMode(state, thread, coordinatorAgentId, requestId = '') {
  const coordinator = state.agents.find((agent) => agent.id === coordinatorAgentId)
    || state.agents.find((agent) => agent.id === thread.defaultAgentId);
  const resolvedCoordinatorId = coordinator?.id || thread.defaultAgentId || resolveDefaultAgentId(state);
  const profileName = await resolveHermesProfileNameForAgent(coordinator || {});
  const capability = await ensureCollaborationRuntimeCapability(profileName);
  const created = await createCollaborationWorkflow(state, thread, {
    name: thread.title || '协作工作流',
    coordinatorAgentId: resolvedCoordinatorId,
    idempotencyKey: requestId ? `new-work:${requestId}` : `new-work:${thread.id}`,
  });
  created.workflow.capability = { status: 'ready', protocolVersion: capability.protocolVersion, checkedAt: now(), reloaded: Boolean(capability.reloaded), error: '' };
  thread.executionMode = 'work';
  thread.updatedAt = now();
  appendThreadCollaborationEvent(thread, { type: 'mode.changed', workflowId: created.workflow.id, actorAgentId: 'user', title: '已切换到 Work', detail: `协调 Agent：${coordinator?.name || resolvedCoordinatorId}`, payload: { mode: 'work', previousMode: 'chat', coordinatorAgentId: resolvedCoordinatorId } });
  return { workflow: created.workflow, capability };
}

async function queueWorkSteer(state, thread, workflow, { message, idempotencyKey = '', actorAgentId = 'user' } = {}) {
  const cleanMessage = String(message || '').trim();
  if (!cleanMessage) throw Object.assign(new Error('steer message is required.'), { status: 400 });
  const cached = idempotentResult(thread.collaboration, idempotencyKey);
  if (cached) return { ...cached, idempotent: true };
  const interventionId = id('intervention');
  const queuedAt = now();
  const coordinatorAgentId = workflow.coordinatorAgentId || thread.defaultAgentId || resolveDefaultAgentId(state);
  const sessionId = thread.activeRunAgentId === coordinatorAgentId && thread.activeSessionId
    ? thread.activeSessionId
    : hermesAgentSessionId(thread, coordinatorAgentId);
  let queueStatus = workflow.status === 'paused' || ['pausing', 'pause_failed'].includes(workflow.control?.state) ? 'held' : 'pending';
  let bridgeResult = null;
  if (queueStatus !== 'held') {
    try {
      bridgeResult = await requestHermesBridge({ action: 'steer', session_id: sessionId, text: cleanMessage }, { timeoutMs: 5000, retryMs: 500 });
      queueStatus = bridgeResult.accepted ? 'delivered' : 'pending';
    } catch {
      queueStatus = 'pending';
    }
  }
  const entry = { id: interventionId, message: cleanMessage, actorAgentId, coordinatorAgentId, sessionId, status: queueStatus, queuedAt, deliveredAt: queueStatus === 'delivered' ? now() : null, idempotencyKey };
  workflow.interventionQueue = [...(workflow.interventionQueue || []), entry].slice(-200);
  if (queueStatus === 'held') workflow.control = { ...(workflow.control || {}), heldInterventionCount: (workflow.interventionQueue || []).filter((item) => item.status === 'held').length };
  const event = appendThreadCollaborationEvent(thread, { type: 'intervention.sent', workflowId: workflow.id, taskId: workflow.currentRootTaskId || '', actorAgentId, title: queueStatus === 'held' ? '补充指令已暂存' : `已交给 ${state.agents.find((agent) => agent.id === coordinatorAgentId)?.name || coordinatorAgentId} 协调`, detail: cleanMessage, payload: { action: 'steer', interventionId, queueStatus, coordinatorAgentId } });
  const result = { interventionId, queueStatus, coordinatorAgentId, sessionId, event, bridgeResult };
  rememberIdempotent(thread.collaboration, idempotencyKey, result);
  workflow.updatedAt = now();
  thread.updatedAt = now();
  return result;
}

async function readKanbanTasks(board, options = {}) {
  const args = ['kanban', '--board', kanbanBoard(board), 'list', '--json'];
  if (options.includeArchived) args.push('--archived');
  const { stdout } = await runHermesCommand(args);
  return parseHermesJson(stdout, []);
}

async function readKanbanTaskDetail(board, taskId) {
  const { stdout } = await runHermesCommand(['kanban', '--board', kanbanBoard(board), 'show', String(taskId), '--json']);
  return parseHermesJson(stdout, {});
}

const workflowControlBusyStates = new Set(['pausing', 'resuming', 'cancelling']);
const waitForWorkflowControl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function workflowControlError(message, status, code, details = {}) {
  return Object.assign(new Error(message), { status, code, details });
}

function startWorkflowControl(workflow, action, idempotencyKey) {
  const current = workflow.control || {};
  if (workflowControlBusyStates.has(current.state) && current.idempotencyKey !== idempotencyKey) {
    throw workflowControlError('当前工作流正在执行其他控制操作。', 409, 'WORKFLOW_CONTROL_IN_PROGRESS', { action: current.action, state: current.state, operationId: current.operationId });
  }
  const operationId = current.idempotencyKey === idempotencyKey && current.operationId ? current.operationId : id('workflow_control');
  const continuingPause = action === 'pause' && current.action === 'pause' && ['pausing', 'paused', 'pause_failed'].includes(current.state);
  workflow.control = {
    operationId,
    idempotencyKey,
    action,
    state: action === 'pause' ? 'pausing' : action === 'resume' ? 'resuming' : 'cancelling',
    affectedTaskIds: action === 'pause' && !continuingPause ? [] : [...new Set(current.affectedTaskIds || [])],
    stoppedRuns: 0,
    blockedTasks: 0,
    preservedWaitingTasks: 0,
    failedTaskIds: [],
    heldInterventionCount: (workflow.interventionQueue || []).filter((entry) => entry.status === 'held').length,
    startedAt: now(),
    completedAt: null,
    error: '',
  };
  workflow.updatedAt = now();
  return workflow.control;
}

async function interruptThreadRunGroup(thread) {
  const runs = Object.values(thread.activeRunGroup?.activeRuns || {}).filter((run) => run?.runId || run?.sessionId);
  if (!runs.length && (thread.activeRunId || thread.activeSessionId)) runs.push({ runId: thread.activeRunId, sessionId: thread.activeSessionId });
  const uniqueRuns = [...new Map(runs.map((run) => [`${run.runId || ''}:${run.sessionId || ''}`, run])).values()];
  const results = await Promise.allSettled(uniqueRuns.map((run) => requestHermesBridge({ action: 'interrupt', session_id: String(run.sessionId || ''), run_id: run.runId || undefined, message: '用户暂停工作流。' }, { timeoutMs: 10000, retryMs: 1000 })));
  return results.filter((result) => result.status === 'fulfilled' && result.value?.resolved !== false).length;
}

async function blockWorkflowTask(boardSlug, task, operationId) {
  if (task.status === 'running') {
    await runHermesCommand(['kanban', '--board', boardSlug, 'reclaim', task.id, '--reason', `Frakio 工作流暂停 ${operationId}`]).catch(() => {});
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const detail = await readKanbanTaskDetail(boardSlug, task.id).catch(() => null);
    const status = String(detail?.task?.status || detail?.status || task.status);
    if (status === 'blocked') return true;
    if (!['running', 'ready'].includes(status)) return false;
    try {
      await runHermesCommand(['kanban', '--board', boardSlug, 'block', task.id, `Frakio 工作流暂停 ${operationId}`, '--kind', 'needs_input']);
      return true;
    } catch {
      if (attempt < 2) await waitForWorkflowControl(180);
    }
  }
  return false;
}

async function pauseCollaborationWorkflow(state, thread, workflow, idempotencyKey) {
  if (workflow.status === 'cancelled') throw workflowControlError('已结束的工作流不能暂停。', 409, 'WORKFLOW_CANCELLED');
  if (workflow.status === 'completed') throw workflowControlError('已完成的工作流不需要暂停。', 409, 'WORKFLOW_COMPLETED');
  const cached = idempotentResult(thread.collaboration, idempotencyKey);
  if (cached) return { ...cached, idempotent: true };
  const control = startWorkflowControl(workflow, 'pause', idempotencyKey);
  appendThreadCollaborationEvent(thread, { type: 'workflow.pause_started', workflowId: workflow.id, actorAgentId: 'user', title: '正在暂停全部任务', payload: { operationId: control.operationId } });
  await writeState(state);

  const stoppedRuns = await interruptThreadRunGroup(thread).catch(() => 0);
  const tasks = await readKanbanTasks(workflow.boardSlug, { includeArchived: true });
  const executable = tasks.filter((task) => ['running', 'ready'].includes(String(task.status)));
  const preservedWaitingTasks = tasks.filter((task) => !['running', 'ready', 'done', 'archived'].includes(String(task.status))).length;
  const results = await Promise.all(executable.map(async (task) => ({ taskId: task.id, blocked: await blockWorkflowTask(workflow.boardSlug, task, control.operationId) })));
  const affectedTaskIds = [...new Set([...(control.affectedTaskIds || []), ...results.filter((result) => result.blocked).map((result) => result.taskId)])];
  const failedTaskIds = results.filter((result) => !result.blocked).map((result) => result.taskId);
  const after = await readKanbanTasks(workflow.boardSlug, { includeArchived: true });
  for (const task of after.filter((item) => ['running', 'ready'].includes(String(item.status)))) if (!failedTaskIds.includes(task.id)) failedTaskIds.push(task.id);

  workflow.control = { ...control, state: failedTaskIds.length ? 'pause_failed' : 'paused', affectedTaskIds, stoppedRuns, blockedTasks: affectedTaskIds.length, preservedWaitingTasks, failedTaskIds, completedAt: now(), error: failedTaskIds.length ? `仍有 ${failedTaskIds.length} 个任务未能停止` : '' };
  workflow.status = failedTaskIds.length ? 'active' : 'paused';
  workflow.pausedAt = failedTaskIds.length ? null : now();
  workflow.updatedAt = now();
  thread.updatedAt = now();
  const event = appendThreadCollaborationEvent(thread, {
    type: failedTaskIds.length ? 'workflow.pause_failed' : 'workflow.paused',
    workflowId: workflow.id,
    actorAgentId: 'user',
    title: failedTaskIds.length ? '暂停未完全生效' : '工作流已暂停',
    detail: failedTaskIds.length ? `仍有 ${failedTaskIds.length} 个任务需要重试` : `${stoppedRuns} 个运行已停止，${affectedTaskIds.length} 个任务已保留现场`,
    payload: { operationId: control.operationId, stoppedRuns, blockedTasks: affectedTaskIds.length, preservedWaitingTasks, failedTaskIds },
  });
  const result = { ok: !failedTaskIds.length, workflowId: workflow.id, operationId: control.operationId, stoppedRuns, blockedTasks: affectedTaskIds.length, preservedWaitingTasks, failedTaskIds, event };
  if (!failedTaskIds.length) rememberIdempotent(thread.collaboration, idempotencyKey, result);
  await writeState(state);
  if (failedTaskIds.length) throw workflowControlError('工作流未能完全暂停，请重试。', 503, 'WORKFLOW_PAUSE_PARTIAL', result);
  return result;
}

async function resumeCollaborationWorkflow(state, thread, workflow, idempotencyKey) {
  if (workflow.status === 'cancelled') throw workflowControlError('已结束的工作流不能恢复。', 409, 'WORKFLOW_CANCELLED');
  if (workflow.status !== 'paused' && workflow.control?.state !== 'pause_failed') throw workflowControlError('当前工作流没有暂停。', 409, 'WORKFLOW_NOT_PAUSED');
  const cached = idempotentResult(thread.collaboration, idempotencyKey);
  if (cached) return { ...cached, idempotent: true };
  const previousControl = workflow.control || {};
  const pauseTaskIds = [...new Set(previousControl.affectedTaskIds || [])];
  const control = startWorkflowControl(workflow, 'resume', idempotencyKey);
  control.affectedTaskIds = pauseTaskIds;
  appendThreadCollaborationEvent(thread, { type: 'workflow.resume_started', workflowId: workflow.id, actorAgentId: 'user', title: '正在恢复全部任务', payload: { operationId: control.operationId } });
  await writeState(state);

  const held = (workflow.interventionQueue || []).filter((entry) => entry.status === 'held');
  if (held.length && workflow.currentRootTaskId) {
    const combined = held.map((entry) => entry.message).filter(Boolean).join('\n\n');
    if (combined) await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'comment', workflow.currentRootTaskId, `暂停期间的用户补充：\n${combined}`, '--author', 'user']).catch(() => {});
  }
  const failedTaskIds = [];
  let resumedTasks = 0;
  for (const taskId of pauseTaskIds) {
    const detail = await readKanbanTaskDetail(workflow.boardSlug, taskId).catch(() => null);
    const status = String(detail?.task?.status || detail?.status || '');
    if (status !== 'blocked') continue;
    try {
      await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'unblock', '--reason', '用户恢复工作流', taskId]);
      resumedTasks += 1;
    } catch {
      failedTaskIds.push(taskId);
    }
  }
  if (failedTaskIds.length) {
    workflow.control = { ...control, state: 'pause_failed', failedTaskIds, completedAt: now(), error: `仍有 ${failedTaskIds.length} 个任务未恢复` };
    workflow.status = 'paused';
    workflow.updatedAt = now();
    await writeState(state);
    throw workflowControlError('工作流未能完全恢复。', 503, 'WORKFLOW_RESUME_PARTIAL', { failedTaskIds });
  }
  workflow.interventionQueue = (workflow.interventionQueue || []).map((entry) => entry.status === 'held' ? { ...entry, status: 'pending', releasedAt: now() } : entry);
  workflow.status = 'active';
  workflow.pausedAt = null;
  workflow.control = { ...control, state: 'idle', affectedTaskIds: [], heldInterventionCount: 0, completedAt: now(), error: '' };
  workflow.updatedAt = now();
  thread.updatedAt = now();
  const event = appendThreadCollaborationEvent(thread, { type: 'workflow.resumed', workflowId: workflow.id, actorAgentId: 'user', title: '工作流已恢复', detail: `${resumedTasks} 个任务已恢复调度`, payload: { operationId: control.operationId, resumedTasks, heldInterventions: held.length } });
  const dispatch = await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'dispatch', '--max', '8', '--json']).then(({ stdout }) => parseHermesJson(stdout, {})).catch((error) => ({ deferredToGateway: true, error: String(error?.message || error) }));
  const result = { ok: true, workflowId: workflow.id, operationId: control.operationId, resumedTasks, heldInterventions: held.length, event, dispatch };
  rememberIdempotent(thread.collaboration, idempotencyKey, result);
  await writeState(state);
  return result;
}

async function cancelCollaborationWorkflow(state, thread, workflow, idempotencyKey) {
  const cached = idempotentResult(thread.collaboration, idempotencyKey);
  if (cached) return { ...cached, idempotent: true };
  if (workflow.status === 'cancelled') return { ok: true, workflowId: workflow.id, cancelledTasks: 0, idempotent: true };
  const control = startWorkflowControl(workflow, 'cancel', idempotencyKey);
  await writeState(state);
  const stoppedRuns = await interruptThreadRunGroup(thread).catch(() => 0);
  const tasks = await readKanbanTasks(workflow.boardSlug, { includeArchived: true });
  const unfinished = tasks.filter((task) => !['done', 'archived'].includes(String(task.status)));
  const failedTaskIds = [];
  for (const task of unfinished) {
    try {
      if (task.status === 'running') await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'reclaim', task.id, '--reason', '用户结束协作']).catch(() => {});
      await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'archive', task.id]);
    } catch {
      failedTaskIds.push(task.id);
    }
  }
  if (failedTaskIds.length) {
    workflow.control = { ...control, state: 'pause_failed', failedTaskIds, completedAt: now(), error: `仍有 ${failedTaskIds.length} 个任务未结束` };
    await writeState(state);
    throw workflowControlError('工作流未能完全结束。', 503, 'WORKFLOW_CANCEL_PARTIAL', { failedTaskIds });
  }
  if (workflow.plan?.tasks) workflow.plan = { ...workflow.plan, tasks: workflow.plan.tasks.map((task) => ({ ...task, cancelled: task.cancelled || unfinished.some((item) => item.id === task.taskId) })) };
  workflow.executionBindings = Object.fromEntries(Object.entries(workflow.executionBindings || {}).map(([key, binding]) => [key, { ...binding, status: binding.status === 'done' ? 'done' : 'cancelled' }]));
  workflow.interventionQueue = (workflow.interventionQueue || []).map((entry) => ['held', 'pending'].includes(entry.status) ? { ...entry, status: 'cancelled', cancelledAt: now() } : entry);
  workflow.status = 'cancelled';
  workflow.cancelledAt = now();
  workflow.pausedAt = null;
  workflow.control = { ...control, state: 'cancelled', affectedTaskIds: unfinished.map((task) => task.id), stoppedRuns, completedAt: now(), error: '' };
  workflow.updatedAt = now();
  thread.updatedAt = now();
  const event = appendThreadCollaborationEvent(thread, { type: 'workflow.cancelled', workflowId: workflow.id, actorAgentId: 'user', title: '协作已结束', detail: `${unfinished.length} 个未完成任务已取消`, payload: { operationId: control.operationId, stoppedRuns, cancelledTasks: unfinished.length } });
  const result = { ok: true, workflowId: workflow.id, operationId: control.operationId, stoppedRuns, cancelledTasks: unfinished.length, event };
  rememberIdempotent(thread.collaboration, idempotencyKey, result);
  await writeState(state);
  return result;
}

async function enforcePausedWorkflowBarrier(state, thread, workflow, tasks = null) {
  if (workflow.status !== 'paused') return tasks || readKanbanTasks(workflow.boardSlug, { includeArchived: true });
  const currentTasks = tasks || await readKanbanTasks(workflow.boardSlug, { includeArchived: true });
  const executable = currentTasks.filter((task) => ['running', 'ready'].includes(String(task.status)));
  if (!executable.length) return currentTasks;
  const operationId = workflow.control?.operationId || id('workflow_pause_barrier');
  const results = await Promise.all(executable.map(async (task) => ({ taskId: task.id, blocked: await blockWorkflowTask(workflow.boardSlug, task, operationId) })));
  const blockedIds = results.filter((result) => result.blocked).map((result) => result.taskId);
  const failedTaskIds = results.filter((result) => !result.blocked).map((result) => result.taskId);
  workflow.control = {
    ...(workflow.control || {}),
    operationId,
    state: failedTaskIds.length ? 'pause_failed' : 'paused',
    affectedTaskIds: [...new Set([...(workflow.control?.affectedTaskIds || []), ...blockedIds])],
    blockedTasks: Number(workflow.control?.blockedTasks || 0) + blockedIds.length,
    failedTaskIds,
    completedAt: now(),
    error: failedTaskIds.length ? `暂停屏障未能停止 ${failedTaskIds.length} 个任务` : '',
  };
  if (failedTaskIds.length) {
    workflow.status = 'active';
    appendThreadCollaborationEvent(thread, { type: 'workflow.pause_failed', workflowId: workflow.id, actorAgentId: 'system', title: '暂停屏障未完全生效', detail: `仍有 ${failedTaskIds.length} 个任务需要重试`, payload: { operationId, failedTaskIds } });
  }
  workflow.updatedAt = now();
  thread.updatedAt = now();
  await writeState(state);
  return readKanbanTasks(workflow.boardSlug, { includeArchived: true });
}

async function recoverWorkflowControls(state) {
  let changed = false;
  for (const thread of state.threads || []) {
    for (const workflow of thread.collaboration?.workflows || []) {
      if (workflow.status === 'paused') {
        await enforcePausedWorkflowBarrier(state, thread, workflow).catch(() => {});
      } else if (workflow.control?.state === 'pausing') {
        const key = workflow.control.idempotencyKey || `pause-recovery:${workflow.control.operationId || workflow.id}`;
        await pauseCollaborationWorkflow(state, thread, workflow, key).catch(() => {});
        changed = true;
      }
    }
  }
  if (changed) await writeState(state);
}

async function collaborationSnapshot(state, thread, requestedWorkflowId = '') {
  const workflows = thread.collaboration?.workflows || [];
  const selected = requestedWorkflowId ? workflows.filter((workflow) => workflow.id === requestedWorkflowId) : workflows;
  const hydrated = await Promise.all(selected.map(async (workflow) => {
    try {
      let tasks = await readKanbanTasks(workflow.boardSlug, { includeArchived: true });
      if (workflow.status === 'paused') tasks = await enforcePausedWorkflowBarrier(state, thread, workflow, tasks);
      const lifecycle = ['paused', 'cancelled', 'archived'].includes(workflow.status) ? workflow.status : boardLifecycle(tasks);
      return { ...workflow, status: lifecycle, tasks, error: '' };
    } catch (error) {
      return { ...workflow, tasks: [], error: String(error?.message || error) };
    }
  }));
  return {
    threadId: thread.id,
    mode: thread.executionMode === 'work' ? 'work' : 'chat',
    workerOutputMode: thread.workerOutputMode === 'all' ? 'all' : 'summary',
    activeWorkflowId: thread.collaboration?.activeWorkflowId || '',
    cursor: Number(thread.collaboration?.eventCursor || 0),
    workflows: hydrated,
    events: collaborationEventsAfter(thread.collaboration || {}, 0, requestedWorkflowId).slice(-200),
    fallbackDecisionAgentId: state.ui?.fallbackDecisionAgentId || resolveDefaultAgentId(state),
  };
}

function projectCollaborationTaskTransitions(thread, snapshot) {
  let changed = false;
  for (const hydrated of snapshot.workflows || []) {
    const workflow = workflowById(thread, hydrated.id);
    if (!workflow) continue;
    const previousById = workflow.taskStatusProjection || {};
    const nextById = {};
    for (const task of hydrated.tasks || []) {
      const previous = previousById[task.id];
      nextById[task.id] = { status: task.status, title: task.title || task.id };
      const rootCompleted = (workflow.rootTaskIds || []).includes(task.id) && task.status === 'done' && previous?.status !== 'done';
      const workerCompleted = !(workflow.rootTaskIds || []).includes(task.id) && task.status === 'done' && previous?.status !== 'done';
      if (rootCompleted) {
        const externalRunId = `kanban-root:${task.id}`;
        const summary = String(task.result || task.latest_summary || '').trim();
        if (summary && !(thread.messages || []).some((message) => message.externalRunId === externalRunId)) {
          const coordinatorName = [...(thread.messages || [])].reverse().find((message) => message.agentId === workflow.coordinatorAgentId)?.agentName || workflow.coordinatorAgentId || '协调 Agent';
          thread.messages = [...(thread.messages || []), { id: id('msg'), agentId: workflow.coordinatorAgentId || 'coordinator', agentName: coordinatorName, role: 'Work 协调汇总', content: summary, externalRunId }];
          changed = true;
        }
      }
      if (workerCompleted && thread.workerOutputMode === 'all') {
        const externalRunId = `kanban-task:${task.id}`;
        const summary = String(task.result || task.latest_summary || '').trim();
        if (summary && !(thread.messages || []).some((message) => message.externalRunId === externalRunId)) {
          const planTask = (workflow.plan?.tasks || []).find((item) => item.taskId === task.id);
          const agentId = planTask?.assigneeAgentId || String(task.assignee || 'worker');
          const agentName = [...(thread.messages || [])].reverse().find((message) => message.agentId === agentId)?.agentName || agentId;
          thread.messages = [...(thread.messages || []), { id: id('msg'), agentId, agentName, role: 'Work 成员交付', content: summary, externalRunId }];
          changed = true;
        }
      }
      if (!previous) {
        changed = true;
        continue;
      }
      const projected = taskStatusEvent(previous, task);
      if (projected) {
        appendThreadCollaborationEvent(thread, { ...projected, workflowId: workflow.id });
        changed = true;
      }
      if (previous.status !== 'done' && task.status === 'done') {
        const dependencies = (thread.collaboration.events || []).filter((event) => event.workflowId === workflow.id && event.type === 'dependency.created' && event.payload?.parentTaskId === task.id);
        for (const dependency of dependencies) {
          const alreadySatisfied = (thread.collaboration.events || []).some((event) => event.type === 'dependency.satisfied' && event.workflowId === workflow.id && event.payload?.parentTaskId === task.id && event.taskId === dependency.taskId);
          if (!alreadySatisfied) {
            appendThreadCollaborationEvent(thread, { type: 'dependency.satisfied', workflowId: workflow.id, taskId: dependency.taskId || '', title: `${task.title || task.id} 已完成交付`, detail: '等待任务将在所有父任务完成后自动恢复', payload: { parentTaskId: task.id } });
            changed = true;
          }
        }
      }
    }
    if (JSON.stringify(previousById) !== JSON.stringify(nextById)) {
      workflow.taskStatusProjection = nextById;
      workflow.updatedAt = now();
      changed = true;
    }
    if (!['paused', 'cancelled', 'archived'].includes(workflow.status) && !workflowControlBusyStates.has(workflow.control?.state)) {
      const lifecycle = boardLifecycle(hydrated.tasks || []);
      if (lifecycle !== workflow.status) {
        workflow.status = lifecycle;
        workflow.completedAt = lifecycle === 'completed' ? now() : null;
        if (lifecycle === 'completed') appendThreadCollaborationEvent(thread, { type: 'workflow.completed', workflowId: workflow.id, title: workflow.name });
        changed = true;
      }
    }
  }
  if (changed) {
    snapshot.cursor = Number(thread.collaboration.eventCursor || 0);
    snapshot.events = collaborationEventsAfter(thread.collaboration || {}, 0, snapshot.workflows.length === 1 ? snapshot.workflows[0].id : '').slice(-200);
    thread.updatedAt = now();
  }
  return changed;
}

function selectedProviderConfig(config, providerKey) {
  const clean = String(providerKey || '').trim();
  if (!clean) return {};
  if (clean.startsWith('custom:')) {
    const key = clean.slice(7);
    return Object.fromEntries(customProviderEntries(config))[key] || config?.providers?.[key] || {};
  }
  return config?.providers?.[clean] || {};
}

async function readHermesProfileConfigs() {
  const rows = [];
  const rootConfig = path.join(hermesHome, 'config.yaml');
  if (await exists(rootConfig)) rows.push({ name: 'default', dir: hermesHome, config: await readYamlFile(rootConfig), envRaw: await readEnvValues(path.join(hermesHome, '.env')) });
  const profilesRoot = path.join(hermesHome, 'profiles');
  try {
    const entries = await readdir(profilesRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(profilesRoot, entry.name);
      const configPath = path.join(dir, 'config.yaml');
      if (await exists(configPath)) rows.push({ name: entry.name, dir, config: await readYamlFile(configPath), envRaw: await readEnvValues(path.join(dir, '.env')) });
    }
  } catch {
    // Profiles are optional.
  }
  return rows;
}

async function ensureWorkbenchApiKey() {
  const envPath = path.join(hermesWorkbenchApiHome, '.env');
  const envValues = await readEnvValues(envPath);
  const existing = String(process.env.API_SERVER_KEY || envValues.API_SERVER_KEY || '').trim();
  if (existing) return existing;
  const key = `fw_${randomBytes(24).toString('hex')}`;
  await appendFile(envPath, `API_SERVER_KEY=${key}\n`, 'utf8');
  return key;
}

async function candidateHermesApiBaseUrls() {
  const envValues = await readEnvValues(path.join(hermesHome, '.env'));
  const apiConfig = await readYamlFile(path.join(hermesWorkbenchApiHome, 'config.yaml'));
  const configuredApi = apiConfig?.platforms?.api_server?.extra || {};
  const port = envValues.API_SERVER_PORT || process.env.API_SERVER_PORT || '8642';
  const host = envValues.API_SERVER_HOST || process.env.API_SERVER_HOST || '127.0.0.1';
  const configuredHost = configuredApi.host || host;
  const configuredPort = configuredApi.port || port;
  const rawCandidates = [
    process.env.HERMES_AGENT_API_URL,
    process.env.HERMES_API_BASE_URL,
    envValues.HERMES_AGENT_API_URL,
    envValues.HERMES_API_BASE_URL,
    configuredPort ? `http://${configuredHost}:${configuredPort}/v1` : '',
    `http://${host}:${port}/v1`,
    'http://127.0.0.1:8642/v1',
  ].filter(Boolean);
  return Array.from(new Set(rawCandidates.map((url) => String(url).replace(/\/+$/, '').replace('localhost', '127.0.0.1'))));
}

async function probeHermesAgentApi() {
  for (const baseUrl of await candidateHermesApiBaseUrls()) {
    const models = await fetchJson(`${baseUrl}/models`, { headers: hermesAgentHeaders(), timeoutMs: 1600 });
    if (models.ok) return { online: true, apiBaseUrl: baseUrl, apiStatus: models.status, models: parseModelIds(models.body), authMode: 'env-token' };
    const healthBase = baseUrl.replace(/\/v\d+$/i, '');
    const health = await fetchJson(`${healthBase}/health`, { headers: hermesAgentHeaders(), timeoutMs: 1200 });
    if (health.ok && !Object.keys(hermesAgentHeaders()).length) return { online: true, apiBaseUrl: baseUrl, apiStatus: health.status, models: [], authMode: 'health-only' };
  }
  return { online: false, apiBaseUrl: (await candidateHermesApiBaseUrls())[0] || 'http://127.0.0.1:8642/v1', apiStatus: 0, models: [], authMode: 'offline' };
}

async function configuredWorkbenchApiBaseUrl() {
  const apiConfig = await readYamlFile(path.join(hermesWorkbenchApiHome, 'config.yaml'));
  const extra = apiConfig?.platforms?.api_server?.extra || {};
  const configuredPort = extra.port;
  if (!configuredPort) return '';
  const configuredHost = extra.host || '127.0.0.1';
  return `http://${String(configuredHost).replace('localhost', '127.0.0.1')}:${configuredPort}/v1`;
}

async function probeConfiguredWorkbenchApi() {
  const baseUrl = await configuredWorkbenchApiBaseUrl();
  if (!baseUrl) return { online: false, apiBaseUrl: 'http://127.0.0.1:8642/v1', apiStatus: 0, models: [], authMode: 'offline' };
  const models = await fetchJson(`${baseUrl}/models`, { headers: hermesAgentHeaders(), timeoutMs: 1600 });
  if (models.ok) return { online: true, apiBaseUrl: baseUrl, apiStatus: models.status, models: parseModelIds(models.body), authMode: 'env-token' };
  const health = await fetchJson(`${baseUrl.replace(/\/v\d+$/i, '')}/health`, { headers: hermesAgentHeaders(), timeoutMs: 1200 });
  return { online: false, apiBaseUrl: baseUrl, apiStatus: models.status || health.status || 0, models: [], authMode: 'offline' };
}

async function startHermesAgentApi(logs = []) {
  const api = await probeConfiguredWorkbenchApi();
  if (api.online) return { ok: true, logs: ['Hermes Agent API already online.'], api };
  const runtime = await findFrakioHermesRuntime();
  if (!runtime) {
    const errorMessage = `未找到 Frakio Work 内置 Hermes runtime。请先运行 npm run prepare-runtime，或设置 FRAKIO_WORK_HERMES_RUNTIME 指向 Frakio Work 自己的 runtime。`;
    logs.push(errorMessage);
    return { ok: false, logs, api: await probeHermesAgentApi() };
  }
  const apiPort = await findFreeTcpPort(8642, '127.0.0.1');
  const apiHermesHome = await ensureWorkbenchApiHermesHome({ port: apiPort });
  const apiKey = await ensureWorkbenchApiKey();
  await cleanupStaleGatewayRuntimeFiles(apiHermesHome, logs);
  const args = ['-m', 'hermes_cli.main', 'gateway', 'run', '--replace', '--force'];
  const logFile = runtimeApiLogPath();
  pushRuntimeLog(logs, `using Frakio ${runtime.source} runtime: ${runtime.runtimeDir}`);
  pushRuntimeLog(logs, `starting: ${runtime.python} ${args.join(' ')} on http://127.0.0.1:${apiPort}/v1`);
  hermesApiProcess = spawn(runtime.python, args, {
    cwd: apiHermesHome,
    env: runtimeEnv({
      HERMES_HOME: apiHermesHome,
      HERMES_AGENT_ROOT: runtime.pythonRoot,
      API_SERVER_ENABLED: 'true',
      API_SERVER_KEY: apiKey,
      API_SERVER_HOST: '127.0.0.1',
      API_SERVER_PORT: String(apiPort),
      API_SERVER_CORS_ORIGINS: 'http://127.0.0.1:5173,http://127.0.0.1:5174,http://localhost:5173,http://localhost:5174,http://127.0.0.1:8787',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  attachRuntimeProcessLogs(hermesApiProcess, logFile, logs);
  if (process.platform !== 'win32') hermesApiProcess.unref();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const nextApi = await probeHermesAgentApi();
    if (nextApi.online) return { ok: true, logs, api: nextApi };
  }
  pushRuntimeLog(logs, `Runtime API did not become ready. See ${logFile}`);
  const finalApi = await probeHermesAgentApi();
  return { ok: finalApi.online, logs, api: finalApi };
}

function hermesAgentHeaders() {
  let envToken = '';
  for (const envPath of [path.join(hermesWorkbenchApiHome, '.env'), path.join(hermesHome, '.env')]) {
    try {
      const raw = readFileSync(envPath, 'utf8');
      envToken = raw.split(/\r?\n/).map((line) => line.match(/^API_SERVER_KEY=(.*)$/)?.[1]).find(Boolean) || envToken;
      if (envToken) break;
    } catch {
      // Missing env files are normal before runtime initialization.
    }
  }
  const token = String(process.env.API_SERVER_KEY || process.env.HERMES_AGENT_API_KEY || envToken || '').trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function hermesAgentRunHeaders(sessionId = '') {
  const headers = hermesAgentHeaders();
  if (sessionId && headers.Authorization) headers['X-Hermes-Session-Key'] = sessionId;
  return headers;
}

function hermesBridgeEndpoint() {
  if (process.env.HERMES_AGENT_BRIDGE_ENDPOINT) return process.env.HERMES_AGENT_BRIDGE_ENDPOINT;
  if (process.platform === 'win32') return 'tcp://127.0.0.1:18766';
  return `ipc://${path.join(hermesWorkbenchRuntimeHome, 'agent-bridge.sock')}`;
}

function hermesBridgeSocketTarget(endpoint = hermesBridgeEndpoint()) {
  if (endpoint.startsWith('ipc://')) return { kind: 'ipc', path: endpoint.slice('ipc://'.length) };
  if (endpoint.startsWith('tcp://')) {
    const url = new URL(endpoint);
    return { kind: 'tcp', host: url.hostname || '127.0.0.1', port: Number(url.port) };
  }
  throw new Error(`Unsupported Hermes Bridge endpoint: ${endpoint}`);
}

function connectHermesBridgeSocket(endpoint = hermesBridgeEndpoint()) {
  const target = hermesBridgeSocketTarget(endpoint);
  return target.kind === 'ipc'
    ? net.createConnection(target.path)
    : net.createConnection({ host: target.host, port: target.port });
}

function isRetryableBridgeError(error) {
  return ['ECONNREFUSED', 'ENOENT', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT'].includes(String(error?.code || ''));
}

async function requestHermesBridge(payload, options = {}) {
  const endpoint = options.endpoint || hermesBridgeEndpoint();
  const timeoutMs = options.timeoutMs || 120000;
  const retryMs = options.retryMs ?? 0;
  const deadline = Date.now() + Math.max(0, retryMs);
  for (;;) {
    try {
      return await new Promise((resolve, reject) => {
        const socket = connectHermesBridgeSocket(endpoint);
        let buffer = '';
        const timer = setTimeout(() => {
          socket.destroy();
          reject(new Error(`Hermes Bridge request timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        const cleanup = () => {
          clearTimeout(timer);
          socket.removeAllListeners();
        };
        socket.once('connect', () => socket.write(`${JSON.stringify(payload)}\n`));
        socket.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
          const lineEnd = buffer.indexOf('\n');
          if (lineEnd < 0) return;
          const line = buffer.slice(0, lineEnd).trim();
          cleanup();
          socket.end();
          try {
            const response = JSON.parse(line);
            if (!response?.ok) {
              const error = new Error(response?.error || 'Hermes Bridge request failed.');
              error.response = response;
              reject(error);
              return;
            }
            resolve(response);
          } catch (error) {
            reject(error);
          }
        });
        socket.once('error', (error) => {
          cleanup();
          socket.destroy();
          reject(error);
        });
        socket.once('close', () => {
          if (!buffer.trim()) {
            cleanup();
            reject(new Error('Hermes Bridge socket closed without a response.'));
          }
        });
      });
    } catch (error) {
      if (!isRetryableBridgeError(error) || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function processStartedAtMs(pid) {
  const cleanPid = Number(pid);
  if (!Number.isFinite(cleanPid) || cleanPid <= 0) return 0;
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'lstart=', '-p', String(cleanPid)], { timeout: 1500 });
    const text = String(stdout || '').trim();
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

async function bridgeProcessSummary(ping = {}) {
  const brokerPid = Number(ping?.broker?.pid || 0);
  const workerDetails = ping?.worker_details && typeof ping.worker_details === 'object' ? ping.worker_details : {};
  const brokerStartedAtMs = await processStartedAtMs(brokerPid);
  const ownedByThisApi = Boolean(hermesBridgeProcess?.pid && brokerPid === hermesBridgeProcess.pid);
  return {
    brokerPid: Number.isFinite(brokerPid) && brokerPid > 0 ? brokerPid : null,
    brokerStartedAt: brokerStartedAtMs ? new Date(brokerStartedAtMs).toISOString() : null,
    owner: ownedByThisApi ? 'frakio-current-api' : brokerPid ? 'external-or-stale' : 'unknown',
    ownedByThisApi,
    startedBeforeApi: Boolean(brokerStartedAtMs && brokerStartedAtMs < apiStartedAtMs - 1000),
    workers: ping?.workers || {},
    workerDetails,
  };
}

function collectBridgePids(ping = {}) {
  const pids = new Set();
  const brokerPid = Number(ping?.broker?.pid || 0);
  if (Number.isFinite(brokerPid) && brokerPid > 0) pids.add(brokerPid);
  const workerDetails = ping?.worker_details && typeof ping.worker_details === 'object' ? ping.worker_details : {};
  for (const detail of Object.values(workerDetails)) {
    const pid = Number(detail?.pid || 0);
    if (Number.isFinite(pid) && pid > 0) pids.add(pid);
  }
  return [...pids].filter((pid) => pid !== process.pid);
}

async function terminatePids(pids, logs, reason) {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
      logs?.push?.(`terminating ${reason} pid=${pid}`);
    } catch (error) {
      if (error?.code !== 'ESRCH') logs?.push?.(`failed to terminate ${reason} pid=${pid}: ${error.message || error}`);
    }
  }
  if (pids.length) await new Promise((resolve) => setTimeout(resolve, 600));
  for (const pid of pids) {
    try {
      process.kill(pid, 0);
    } catch {
      continue;
    }
    try {
      process.kill(pid, 'SIGKILL');
      logs?.push?.(`force killed ${reason} pid=${pid}`);
    } catch (error) {
      if (error?.code !== 'ESRCH') logs?.push?.(`failed to force kill ${reason} pid=${pid}: ${error.message || error}`);
    }
  }
}

async function cleanupStaleHermesBridge(current, logs = []) {
  const endpoint = current?.endpoint || hermesBridgeEndpoint();
  if (process.env.HERMES_AGENT_BRIDGE_ENDPOINT) return;
  const pids = collectBridgePids(current?.ping || {});
  await terminatePids(pids, logs, 'stale Hermes Bridge');
  if (endpoint.startsWith('ipc://')) await unlink(endpoint.slice('ipc://'.length)).catch(() => null);
}

async function probeHermesBridge(options = {}) {
  const endpoint = hermesBridgeEndpoint();
  try {
    const ping = await requestHermesBridge({ action: 'ping' }, { endpoint, timeoutMs: options.timeoutMs || 1200, retryMs: options.retryMs ?? 0 });
    const processInfo = await bridgeProcessSummary(ping);
    return { endpoint, running: true, ready: true, status: 'ready', error: '', ping, ...processInfo };
  } catch (error) {
    return { endpoint, running: false, ready: false, status: 'unreachable', error: String(error?.message || error) };
  }
}

function resolveExecutableSync(command) {
  if (!command) return '';
  if (path.isAbsolute(command) || command.includes('/') || command.includes('\\')) return existsSync(command) ? command : '';
  try {
    const resolver = process.platform === 'win32' ? 'where.exe' : '/usr/bin/which';
    return execFileSync(resolver, [command], { encoding: 'utf8', timeout: 2000, env: runtimeEnv() }).trim().split(/\r?\n/)[0] || '';
  } catch {
    return '';
  }
}

function versionedDirsSync(root) {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(compareVersionDesc);
  } catch {
    return [];
  }
}

function findHermesNodeSync() {
  const runtime = findFrakioHermesRuntimeSync();
  return [
    process.env.FRAKIO_WORK_MCP_NODE,
    runtime?.node,
    resolveExecutableSync('node'),
    process.execPath,
  ].filter(Boolean).find((candidate) => existsSync(candidate)) || process.execPath;
}

function compareVersionDesc(a, b) {
  const left = String(a || '').match(/\d+/g)?.map(Number) || [];
  const right = String(b || '').match(/\d+/g)?.map(Number) || [];
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (right[index] || 0) - (left[index] || 0);
    if (diff) return diff;
  }
  return String(b || '').localeCompare(String(a || ''));
}

async function versionedDirs(root) {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(compareVersionDesc);
  } catch {
    return [];
  }
}

async function firstExistingFile(candidates) {
  for (const candidate of candidates.filter(Boolean)) {
    if (await exists(candidate)) return candidate;
  }
  return '';
}

async function findHermesBridgeScript() {
  return (await findFrakioBridgeScript())?.path || '';
}

async function findHermesBridgePython() {
  return (await findFrakioHermesRuntime())?.python || '';
}

async function findHermesAgentRoot() {
  return (await findFrakioHermesRuntime())?.pythonRoot || '';
}

async function startHermesBridge() {
  const current = await probeHermesBridge({ timeoutMs: 1000 });
  const endpoint = hermesBridgeEndpoint();
  const logs = [];
  if (current.ready) {
    const owned = Boolean(current.ownedByThisApi);
    const stale = Boolean(!process.env.HERMES_AGENT_BRIDGE_ENDPOINT && (!owned || current.startedBeforeApi));
    if (!stale) return { bridge: current, logs: ['Hermes Bridge already ready.'] };
    logs.push(`found stale Hermes Bridge broker pid=${current.brokerPid || 'unknown'} owner=${current.owner || 'unknown'}`);
    await cleanupStaleHermesBridge(current, logs);
  }
  const script = await findHermesBridgeScript();
  const python = await findHermesBridgePython();
  const agentRoot = await findHermesAgentRoot();
  if (!script) throw new Error('未找到 Hermes Agent Bridge 脚本 hermes_bridge.py。');
  if (!python) throw new Error('未找到可用 Python runtime。');
  await mkdir(hermesWorkbenchRuntimeHome, { recursive: true });
  if (endpoint.startsWith('ipc://') && !process.env.HERMES_AGENT_BRIDGE_ENDPOINT) {
    await unlink(endpoint.slice('ipc://'.length)).catch(() => null);
  }
  const args = [script, '--endpoint', endpoint, '--hermes-home', hermesHome];
  if (agentRoot) args.push('--agent-root', agentRoot);
  logs.push(`starting bridge: ${python} ${args.join(' ')}`);
  hermesBridgeProcess = spawn(python, args, {
    env: runtimeEnv({
      HERMES_HOME: hermesHome,
      HERMES_AGENT_BRIDGE_ENDPOINT: endpoint,
      ...(agentRoot ? { HERMES_AGENT_ROOT: agentRoot } : {}),
    }),
    cwd: projectRoot,
    stdio: 'ignore',
    detached: process.platform !== 'win32',
  });
  hermesBridgeProcess.on('error', (error) => { hermesBridgeLastError = error.message; });
  hermesBridgeProcess.on('exit', (code, signal) => { hermesBridgeLastError = `Bridge exited code=${code} signal=${signal}`; });
  if (process.platform !== 'win32') hermesBridgeProcess.unref();
  const bridge = await probeHermesBridge({ timeoutMs: 1000, retryMs: 15000 });
  if (!bridge.ready) {
    hermesBridgeLastError = bridge.error || 'Bridge did not become ready.';
    throw new Error(hermesBridgeLastError);
  }
  hermesBridgeLastError = '';
  return { bridge, logs };
}

async function profileGatewayStatus(profileName) {
  const profileArg = profileName && profileName !== 'default' ? ['--profile', profileName] : [];
  const python = await findHermesBridgePython();
  if (!python) return { profileName, running: false, known: false, status: 'unknown', error: '未找到 Hermes runtime。' };
  try {
    const { stdout } = await execFileAsync(python, ['-m', 'hermes_cli.main', ...profileArg, 'gateway', 'status'], {
      timeout: 4000,
      env: runtimeEnv({ HERMES_HOME: hermesHome }),
    });
    const text = String(stdout || '').trim();
    const stopped = /\bnot\s+running\b|\bstopped\b|未运行|已停止/i.test(text);
    const running = !stopped && /running|运行中|"PID"\s*=|PID\s*[:=]|\bPID\s+\d+|✓\s+\S+/i.test(text);
    return { profileName, running, known: true, status: text || 'unknown', error: '' };
  } catch (error) {
    return { profileName, running: false, known: false, status: 'unknown', error: String(error?.stderr || error?.message || error).slice(0, 500) };
  }
}

async function startProfileGateway(profileName) {
  const python = await findHermesBridgePython();
  if (!python) throw new Error('未找到 Hermes runtime。');
  const profileArg = profileName && profileName !== 'default' ? ['--profile', profileName] : [];
  const child = spawn(python, ['-m', 'hermes_cli.main', ...profileArg, 'gateway', 'run', '--replace'], {
    env: runtimeEnv({ HERMES_HOME: hermesHome }),
    cwd: hermesHome,
    stdio: 'ignore',
    detached: process.platform !== 'win32',
  });
  profileGatewayProcesses.add(child);
  child.once('exit', () => profileGatewayProcesses.delete(child));
  let spawnError = '';
  child.on('error', (error) => {
    spawnError = error.message || String(error);
  });
  if (process.platform !== 'win32') child.unref();
  await new Promise((resolve) => setTimeout(resolve, 800));
  if (spawnError) return { profileName: profileName || 'default', running: false, status: 'unknown', error: spawnError };
  return profileGatewayStatus(profileName || 'default');
}

async function stopProfileGateway(profileName) {
  const clean = slug(profileName || 'default');
  const before = await profileGatewayStatus(clean);
  if (!before.known) throw new Error(`无法确认 Profile Gateway 状态：${before.error || before.status}`);
  if (!before.running) return { profileName: clean, stopped: true, wasRunning: false };
  const python = await findHermesBridgePython();
  if (!python) throw new Error('未找到 Hermes runtime，无法停止 Profile Gateway。');
  const profileArg = clean === 'default' ? [] : ['--profile', clean];
  try {
    await execFileAsync(python, ['-m', 'hermes_cli.main', ...profileArg, 'gateway', 'stop'], {
      timeout: 15_000,
      env: runtimeEnv({ HERMES_HOME: hermesHome }),
    });
  } catch (error) {
    throw new Error(`无法停止 Profile Gateway：${String(error?.stderr || error?.message || error).trim().slice(0, 500)}`);
  }
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const status = await profileGatewayStatus(clean);
    if (status.known && !status.running) return { profileName: clean, stopped: true, wasRunning: true };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Profile Gateway 未能在停止后退出；Agent 未删除。');
}

async function legacyProfileGatewayStatus(profileName) {
  const profileDir = resolveDeletableHermesProfileDir(hermesHome, profileName);
  if (!profileDir || !(await exists(profileDir))) return { profileName, running: false, known: true, status: 'not running', error: '' };
  const pid = readRuntimePidFile(path.join(profileDir, 'gateway.pid'));
  if (!pid || !isProcessAlive(pid)) return { profileName, running: false, known: true, status: 'not running', error: '' };
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'command=', '-p', String(pid)], { timeout: 1500 });
    const command = String(stdout || '').trim();
    const escaped = profileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const belongsToProfile = new RegExp(`(?:--profile[ =]+${escaped}\\b|HERMES_PROFILE[ =]+${escaped}\\b|profiles[\\/]+${escaped}\\b)`, 'i').test(command);
    if (/hermes/i.test(command) && belongsToProfile) return { profileName, running: true, known: true, status: command, error: '', pid };
    return { profileName, running: true, known: false, status: 'unknown', error: `无法确认 PID ${pid} 属于 Profile「${profileName}」，未执行终止。` };
  } catch {
    return { profileName, running: true, known: false, status: 'unknown', error: `无法读取 Profile「${profileName}」的 Gateway PID。` };
  }
}

async function stopLegacyProfileGateway(profileName) {
  const status = await legacyProfileGatewayStatus(profileName);
  if (!status.known) throw new Error(status.error || '无法确认历史 Profile Gateway 状态。');
  if (!status.running) return { profileName, stopped: true, wasRunning: false };
  try {
    process.kill(status.pid, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw new Error(`无法停止历史 Profile Gateway：${error.message || error}`);
  }
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (!isProcessAlive(status.pid)) return { profileName, stopped: true, wasRunning: true };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('历史 Profile Gateway 未能在停止后退出；未继续执行操作。');
}

async function stopOrVerifyProfileGateway(profileName) {
  if (hermesReservedProfileNames.has(slug(profileName))) return stopLegacyProfileGateway(profileName);
  return stopProfileGateway(profileName);
}

function resetHermesAutoStartState(status = 'starting') {
  hermesAutoStartState = {
    status,
    startedAt: now(),
    finishedAt: null,
    steps: [],
    logs: [],
    error: '',
    warnings: [],
  };
}

function addHermesAutoStartStep(id, label, status, detail = '', severity = 'standard') {
  const existingIndex = hermesAutoStartState.steps.findIndex((step) => step.id === id);
  const step = { ...runtimeStep(id, label, status, detail, severity), updatedAt: now() };
  if (existingIndex >= 0) hermesAutoStartState.steps[existingIndex] = { ...hermesAutoStartState.steps[existingIndex], ...step };
  else hermesAutoStartState.steps.push(step);
  if (detail) hermesAutoStartState.logs.push(`${label}: ${detail}`);
}

function gatewayAutoStartTargets(profiles, config) {
  if (!config.enabled) return [];
  const profileNames = profiles.map((profile) => profile.name).filter(Boolean);
  if (!profileNames.length) return ['default'];
  if (config.management === 'unified') return [profileNames.includes('default') ? 'default' : profileNames[0]];
  const included = config.include.length ? profileNames.filter((name) => config.include.includes(name)) : profileNames.filter((name) => name === 'default');
  const filtered = included.filter((name) => !config.exclude.includes(name));
  return filtered.length ? filtered : profileNames.includes('default') && !config.exclude.includes('default') ? ['default'] : [];
}

async function ensureHermesRuntimeReady({ force = false } = {}) {
  if (hermesAutoStartPromise && !force) return hermesAutoStartPromise;
  const run = (async () => {
    resetHermesAutoStartState('starting');
    try {
      addHermesAutoStartStep('home', '初始化 Hermes Home', 'running', '', 'core');
      await ensureHermesBaseConfig(hermesAutoStartState.logs);
      addHermesAutoStartStep('home', '初始化 Hermes Home', 'ready', hermesHome, 'core');

      addHermesAutoStartStep('profiles', '读取本地 Hermes Profiles', 'running');
      const profiles = await readHermesProfiles();
      addHermesAutoStartStep('profiles', '读取本地 Hermes Profiles', profiles.length ? 'ready' : 'skipped', profiles.length ? `${profiles.length} profiles` : '未发现 profile');
      const removedAutoStartProfiles = await pruneMissingGatewayAutoStartProfiles(profiles);
      if (removedAutoStartProfiles.length) hermesAutoStartState.logs.push(`已清理不存在 Profile 的 Gateway 自动启动项：${removedAutoStartProfiles.join(', ')}`);

      addHermesAutoStartStep('bridge', '启动 Frakio Work Bridge', 'running', '', 'core');
      try {
        const startedBridge = await startHermesBridge();
        hermesAutoStartState.logs.push(...(startedBridge.logs || []));
        addHermesAutoStartStep('bridge', '启动 Frakio Work Bridge', startedBridge.bridge?.ready ? 'ready' : 'failed', startedBridge.bridge?.endpoint || '', 'core');
      } catch (error) {
        addHermesAutoStartStep('bridge', '启动 Frakio Work Bridge', 'failed', String(error?.message || error), 'core');
      }

      addHermesAutoStartStep('api', '启动外部兼容 API', 'running', '', 'optional');
      try {
        const apiLogs = [];
        const startedApi = await startHermesAgentApi(apiLogs);
        hermesAutoStartState.logs.push(...(startedApi.logs || apiLogs));
        const apiDetail = startedApi.api?.online
          ? startedApi.api?.apiBaseUrl
          : (startedApi.logs || apiLogs).slice(-8).join('\n') || startedApi.api?.apiBaseUrl || 'Runtime API 未启动';
        addHermesAutoStartStep('api', '启动外部兼容 API', startedApi.api?.online ? 'ready' : 'warning', apiDetail || 'http://127.0.0.1:8642/v1', 'optional');
      } catch (error) {
        addHermesAutoStartStep('api', '启动外部兼容 API', 'warning', String(error?.message || error), 'optional');
      }

      addHermesAutoStartStep('gateways', '启动 Profile Gateway', 'running');
      try {
        const config = await readGatewayAutoStartConfig();
        const targets = gatewayAutoStartTargets(profiles, config);
        if (!config.enabled) {
          addHermesAutoStartStep('gateways', '启动 Profile Gateway', 'skipped', 'Gateway 自动启动已关闭');
        } else if (!targets.length) {
          addHermesAutoStartStep('gateways', '启动 Profile Gateway', 'skipped', '没有匹配的 profile');
        } else {
          const failed = [];
          for (const profileName of targets) {
            const gateway = await startProfileGateway(profileName);
            if (!gateway.running) failed.push(`${profileName}: ${gateway.error || gateway.status || '未运行'}`);
          }
          addHermesAutoStartStep('gateways', '启动 Profile Gateway', failed.length ? 'failed' : 'ready', failed.length ? failed.join('; ') : targets.join(', '));
        }
      } catch (error) {
        addHermesAutoStartStep('gateways', '启动 Profile Gateway', 'failed', String(error?.message || error));
      }

      const summary = summarizeRuntimeAutoStart(hermesAutoStartState.steps);
      hermesAutoStartState.status = summary.status;
      hermesAutoStartState.error = summary.error;
      hermesAutoStartState.warnings = summary.warnings;
      hermesAutoStartState.finishedAt = now();
      return hermesAutoStartState;
    } catch (error) {
      hermesAutoStartState.status = 'failed';
      hermesAutoStartState.error = String(error?.message || error);
      hermesAutoStartState.finishedAt = now();
      return hermesAutoStartState;
    } finally {
      hermesAutoStartPromise = null;
    }
  })();
  hermesAutoStartPromise = run;
  return run;
}

async function hermesRuntimeStatus() {
  const bridge = await probeHermesBridge({ timeoutMs: 1000 });
  const profiles = await readHermesProfiles();
  const tools = await runtimeToolDiagnostics();
  const runtime = await findFrakioHermesRuntime();
  const manager = await runtimeManagerStatus();
  const gateways = [];
  for (const profile of profiles.slice(0, 24)) {
    gateways.push(await profileGatewayStatus(profile.name));
  }
  return {
    bridge,
    profiles,
    gateways,
    hermesHome,
    frakioWorkHome,
    agentRoot: runtime?.pythonRoot || '',
    runtime: runtimePublicInfo(runtime),
    manager,
    tools,
    workbenchMcp: workbenchMcpDiagnostics(profiles.find((profile) => profile.name === 'iris') ? 'iris' : profiles[0]?.name || 'default'),
    lastError: hermesBridgeLastError,
    autoStart: hermesAutoStartState,
    checkedAt: now(),
  };
}

async function hermesRuntimeDiagnostics() {
  const [profiles, bridge, runtimeApi, bridgeScript, python, agentRoot, tools, runtime, appVersion, serverFileStat] = await Promise.all([
    readHermesProfiles(),
    probeHermesBridge({ timeoutMs: 1000 }),
    probeHermesAgentApi(),
    findHermesBridgeScript(),
    findHermesBridgePython(),
    findHermesAgentRoot(),
    runtimeToolDiagnostics(),
    findFrakioHermesRuntime(),
    readFrakioPackageVersion(),
    stat(fileURLToPath(import.meta.url)).catch(() => null),
  ]);
  const buildTime = String(process.env.FRAKIO_WORK_BUILD_TIME || serverFileStat?.mtime?.toISOString?.() || '');
  const buildFingerprint = createHash('sha256').update(`${appVersion}|${buildTime}|${appRoot}`).digest('hex').slice(0, 12);
  const profileGateways = [];
  for (const profile of profiles.slice(0, 24)) {
    profileGateways.push(await profileGatewayStatus(profile.name));
  }
  return {
    checkedAt: now(),
    workbenchApi: {
      online: true,
      url: `http://127.0.0.1:${port}`,
      pid: process.pid,
      port,
      version: appVersion,
      buildTime,
      buildFingerprint,
      packaged: process.env.FRAKIO_WORK_PACKAGED === '1',
    },
    frakioWorkHome: {
      path: frakioWorkHome,
      exists: await exists(frakioWorkHome),
      apiHome: hermesWorkbenchApiHome,
      runtimeHome: hermesWorkbenchRuntimeHome,
    },
    hermesHome: {
      path: hermesHome,
      exists: await exists(hermesHome),
      configExists: await exists(path.join(hermesHome, 'config.yaml')),
      profileCount: profiles.length,
      profileNames: profiles.map((profile) => profile.name),
    },
    agentRoot: {
      path: agentRoot,
      exists: Boolean(agentRoot),
    },
    runtime: runtime ? {
      source: runtime.source,
      runtimeDir: runtime.runtimeDir,
      pythonRoot: runtime.pythonRoot,
      python: runtime.python,
      node: runtime.node,
      version: runtime.version,
      platform: runtime.platform,
      bridgeProtocolVersion: runtime.bridgeProtocolVersion,
      manifest: runtime.manifest || null,
    } : null,
    bridgeScript: {
      path: bridgeScript,
      exists: Boolean(bridgeScript),
    },
    python: {
      path: python,
      exists: Boolean(python),
    },
    tools,
    workbenchMcp: workbenchMcpDiagnostics(profiles.find((profile) => profile.name === 'iris') ? 'iris' : profiles[0]?.name || 'default'),
    bridge,
    runtimeApi,
    profileGateways,
    autoStart: hermesAutoStartState,
  };
}

function compactString(value, max = 180) {
  const text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

function firstString(...values) {
  for (const value of values) {
    const text = compactString(value);
    if (text) return text;
  }
  return '';
}

function collectToolPaths(event) {
  const candidates = [
    event?.path,
    event?.file,
    event?.filepath,
    event?.file_path,
    event?.target,
    event?.cwd,
    ...(Array.isArray(event?.paths) ? event.paths : []),
    ...(Array.isArray(event?.files) ? event.files : []),
  ];
  const paths = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate === 'string') paths.push(candidate);
    else if (typeof candidate === 'object') paths.push(candidate.path || candidate.file || candidate.name || '');
  }
  return Array.from(new Set(paths.map((item) => compactString(item, 220)).filter(Boolean))).slice(0, 6);
}

function toolDisplayFromEvent(event, fallbackTitle) {
  const toolName = firstString(event?.toolName, event?.tool_name, event?.tool, event?.name, event?.function_name, event?.skill);
  const skillName = firstString(event?.skillName, event?.skill_name, event?.skill);
  const paths = collectToolPaths(event);
  const fileCount = Number(event?.fileCount || event?.file_count || event?.files_count || (paths.length ? paths.length : 0)) || undefined;
  const argsPreview = firstString(event?.argsPreview, event?.args_preview, event?.arguments, event?.args, event?.input, event?.command, event?.command_preview);
  const resultPreview = firstString(event?.resultPreview, event?.result_preview, event?.output_preview, event?.result, event?.output, event?.preview);
  const detail = firstString(
    event?.detail,
    paths.length ? paths.join(' · ') : '',
    fileCount ? `${fileCount} 个文件` : '',
    argsPreview,
    resultPreview,
  );
  const rawTitle = firstString(event?.title, event?.label, event?.preview);
  const title = rawTitle && rawTitle !== toolName ? rawTitle : toolName ? `调用 ${toolName}` : fallbackTitle;
  return {
    toolName,
    skillName,
    title,
    label: title,
    detail,
    paths,
    fileCount,
    argsPreview,
    resultPreview,
    callId: firstString(event?.callId, event?.call_id, event?.tool_call_id, event?.id, event?.run_step_id, `${toolName}:${rawTitle || argsPreview || detail}`),
  };
}

function normalizeBridgeEvent(event) {
  const eventName = String(event?.event || event?.type || '');
  if (/clarify.*resolved|clarify.*responded/i.test(eventName)) {
    return { event: 'clarify.responded', clarifyId: event.clarify_id || event.clarifyId || event.id || '', skipped: Boolean(event.skipped), resolved: event.resolved, error: event.error || '', raw: event };
  }
  if (/clarify.*request/i.test(eventName) || event?.clarify_id) {
    return { event: 'clarify.request', clarifyId: event.clarify_id || event.clarifyId || event.id || '', question: event.question || event.title || '需要你补充一个选择', choices: Array.isArray(event.choices) ? event.choices : [], timeoutMs: Number(event.timeout_ms || event.timeoutMs || 0) || undefined, raw: event };
  }
  if (/approval.*resolved|approval.*responded/i.test(eventName)) {
    return {
      event: 'approval.responded',
      approvalId: event.approval_id || event.approvalId || event.id || '',
      choice: event.choice || '',
      resolved: event.resolved,
      error: event.error || '',
      raw: event,
    };
  }
  if (/approval.*request/i.test(eventName) || event?.approval_id) {
    return {
      event: 'approval.request',
      approvalId: event.approval_id || event.id || '',
      title: event.title || event.description || '需要确认',
      command: event.command || event.command_preview || event.preview || '',
      cwd: event.cwd || '',
      tool: event.tool || event.tool_name || '',
      choices: Array.isArray(event.choices) ? event.choices : undefined,
      allowPermanent: event.allow_permanent,
      smartDenied: Boolean(event.smart_denied),
    };
  }
  if (/tool.*start|tool.*running/i.test(eventName)) {
    const display = toolDisplayFromEvent(event, '正在调用工具');
    return { event: 'tool.running', tool: display.toolName || event.tool || event.name || '', ...display, raw: event };
  }
  if (/tool.*complete|tool.*end|tool.*result/i.test(eventName)) {
    const display = toolDisplayFromEvent(event, '工具调用完成');
    return { event: 'tool.completed', tool: display.toolName || event.tool || event.name || '', ...display, duration: event.duration || 0, error: Boolean(event.error), raw: event };
  }
  return null;
}

function approvalModeFromConfig(config) {
  const mode = String(config?.approvals?.mode || config?.approval?.mode || '').trim();
  return ['manual', 'smart', 'off'].includes(mode) ? mode : 'smart';
}

async function readApprovalConfig(profileName = 'default') {
  const targetDir = profileName && profileName !== 'default' ? path.join(hermesHome, 'profiles', profileName) : hermesHome;
  const configPath = path.join(targetDir, 'config.yaml');
  const config = await readYamlFile(configPath);
  return { profileName: profileName || 'default', configPath, mode: approvalModeFromConfig(config), raw: config?.approvals || {} };
}

async function writeApprovalMode(profileName, mode) {
  if (!['manual', 'smart', 'off'].includes(mode)) {
    const error = new Error('Unsupported approval mode.');
    error.status = 400;
    throw error;
  }
  const targetDir = profileName && profileName !== 'default' ? path.join(hermesHome, 'profiles', profileName) : hermesHome;
  await mkdir(targetDir, { recursive: true });
  const configPath = path.join(targetDir, 'config.yaml');
  const config = await readYamlFile(configPath);
  config.approvals = { ...(config.approvals || {}), mode };
  await writeFile(configPath, YAML.stringify(config), 'utf8');
  return { profileName: profileName || 'default', configPath, mode };
}

function activeHermesSupports019Defaults() {
  const version = String(findFrakioHermesRuntimeSync()?.version || '');
  const match = version.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 0 || minor >= 19;
}

function previousBundledHermesRuntime(currentVersion) {
  const candidates = [];
  for (const root of uniquePathEntries([
    frakioBundledHermesRuntimeRoot,
    path.join(projectRoot, 'runtime', 'hermes'),
  ])) {
    for (const runtimeDir of runtimeCandidateDirs(root)) {
      const runtime = inspectHermesRuntimeDir(runtimeDir, 'bundled');
      if (!runtime || runtime.bridgeProtocolVersion !== frakioBridgeProtocolVersion) continue;
      if (runtime.version === currentVersion || compareVersionDesc(runtime.version, currentVersion) <= 0) continue;
      candidates.push(runtime);
    }
  }
  candidates.sort((left, right) => compareVersionDesc(left.version, right.version));
  return candidates[0] || null;
}

async function migrateHermes019ApprovalDefaults(state) {
  if (!activeHermesSupports019Defaults()) return false;
  const migrationKey = 'hermes019ApprovalDefaults';
  if (state.runtimeMigrations?.[migrationKey]) return false;
  const activeRuntime = findFrakioHermesRuntimeSync();
  const previousRuntime = previousBundledHermesRuntime(activeRuntime?.version || '');
  if (
    process.env.FRAKIO_WORK_DISABLE_AUTOSTART !== '1'
    && existsSync(statePath)
    && previousRuntime
    && !pendingHermes019UpgradeRollback
  ) {
    const logs = [];
    const manifest = await createHermesRollbackPoint('hermes-019-upgrade', logs);
    pendingHermes019UpgradeRollback = {
      manifest,
      previousVersion: previousRuntime.version,
      targetVersion: activeRuntime?.version || '0.19.0',
      logs,
    };
    await updateHermesRollbackPoint(manifest, {
      status: 'pending-runtime-verification',
      beforeRuntimeVersion: previousRuntime.version,
      targetRuntimeVersion: activeRuntime?.version || '0.19.0',
    });
  }

  const agentProfiles = new Map((state.agents || []).map((agent) => [
    agent.id,
    String(agent.profileName || agent.id || 'default').trim() || 'default',
  ]));
  const profileNames = new Set(['default', ...agentProfiles.values()]);
  const migratedProfiles = new Set();
  const profileModes = new Map();

  for (const profileName of profileNames) {
    const targetDir = profileName === 'default' ? hermesHome : path.join(hermesHome, 'profiles', profileName);
    const configPath = path.join(targetDir, 'config.yaml');
    const config = await readYamlFile(configPath);
    const configuredMode = String(config?.approvals?.mode || config?.approval?.mode || '').trim();
    if (['manual', 'smart', 'off'].includes(configuredMode)) {
      profileModes.set(profileName, configuredMode);
    } else {
      await mkdir(targetDir, { recursive: true });
      config.approvals = { ...(config.approvals || {}), mode: 'smart' };
      await writeFile(configPath, YAML.stringify(config), 'utf8');
      migratedProfiles.add(profileName);
      profileModes.set(profileName, 'smart');
    }
  }

  for (const thread of state.threads || []) {
    const agentId = thread.activeAgentId || thread.primaryAgentId || thread.defaultAgentId || '';
    const profileName = agentProfiles.get(agentId) || 'default';
    thread.permissionMode = profileModes.get(profileName) || 'smart';
  }

  state.runtimeMigrations = {
    ...(state.runtimeMigrations || {}),
    [migrationKey]: {
      version: 1,
      migratedAt: now(),
      profiles: Array.from(migratedProfiles),
    },
  };
  return true;
}

async function firstExistingDir(candidates) {
  for (const candidate of candidates) {
    if (candidate && await exists(candidate)) return candidate;
  }
  return '';
}

async function hashDirectory(dir) {
  const files = [];
  async function walk(current) {
    let entries = [];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  }
  await walk(dir);
  const hasher = createHash('md5');
  for (const filePath of files.sort()) {
    hasher.update(path.relative(dir, filePath));
    hasher.update(await readFile(filePath).catch(() => Buffer.from('')));
  }
  return hasher.digest('hex');
}

async function syncBundledSkillsDisabled() {
  const sourceRoot = await firstExistingDir([
    path.join(hermesAgentSourcePath, 'skills'),
    path.join(hermesHome, 'hermes-agent', 'skills'),
    path.join(homeDir, '.hermes', 'hermes-agent', 'skills'),
  ]);
  if (!sourceRoot) return { sourceRoot: '', copied: [], skipped: [], disabled: [], totalBundled: 0 };
  const destRoot = path.join(hermesHome, 'skills');
  await mkdir(destRoot, { recursive: true });
  const manifestPath = path.join(destRoot, '.bundled_manifest');
  const skillFiles = await findFilesByName(sourceRoot, 'SKILL.md', 6);
  const copied = [];
  const skipped = [];
  const disabled = new Set(disabledSkillsFromConfig(await readYamlFile(path.join(hermesHome, 'config.yaml'))));

  for (const skillFile of skillFiles) {
    const sourceDir = path.dirname(skillFile);
    const raw = await readFile(skillFile, 'utf8').catch(() => '');
    const skillName = skillNameFromMarkdown(raw, path.basename(sourceDir));
    const relative = path.relative(sourceRoot, sourceDir);
    const destDir = path.join(destRoot, relative);
    if (await exists(destDir)) {
      skipped.push(skillName);
    } else {
      await mkdir(path.dirname(destDir), { recursive: true });
      await cp(sourceDir, destDir, { recursive: true, force: false, errorOnExist: false });
      copied.push(skillName);
      disabled.add(skillName);
    }
  }

  const configPath = path.join(hermesHome, 'config.yaml');
  const config = await readYamlFile(configPath);
  config.skills = { ...(typeof config.skills === 'object' && config.skills ? config.skills : {}), disabled: Array.from(disabled).sort() };
  await writeFile(configPath, YAML.stringify(config), 'utf8');

  const manifestRows = [];
  for (const skillFile of skillFiles) {
    const sourceDir = path.dirname(skillFile);
    const raw = await readFile(skillFile, 'utf8').catch(() => '');
    const skillName = skillNameFromMarkdown(raw, path.basename(sourceDir));
    manifestRows.push(`${skillName}:${await hashDirectory(sourceDir)}`);
  }
  await writeFile(manifestPath, `${manifestRows.sort().join('\n')}\n`, 'utf8');
  return { sourceRoot, copied, skipped, disabled: Array.from(disabled).sort(), totalBundled: skillFiles.length };
}

const gatewayPlatformConfigKeys = new Set([
  'platforms',
  'telegram',
  'discord',
  'whatsapp',
  'slack',
  'signal',
  'mattermost',
  'matrix',
  'homeassistant',
  'email',
  'sms',
  'dingtalk',
  'webhook',
  'msgraph_webhook',
  'feishu',
  'wecom',
  'wecom_callback',
  'weixin',
  'bluebubbles',
  'qqbot',
  'yuanbao',
]);

async function ensureSymlink(target, linkPath) {
  await mkdir(path.dirname(linkPath), { recursive: true });
  try {
    const existing = await stat(linkPath);
    if (existing) return;
  } catch {
    await symlink(target, linkPath, 'dir');
  }
}

function readRuntimePidFile(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf8').trim();
    if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);
    const data = JSON.parse(raw);
    const pid = typeof data?.pid === 'number' ? data.pid : Number.parseInt(String(data?.pid || ''), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function cleanupStaleGatewayRuntimeFiles(profileDir, logs = []) {
  const runtimeFiles = ['gateway.pid', 'gateway.lock', 'gateway_state.json'];
  for (const fileName of runtimeFiles) {
    const filePath = path.join(profileDir, fileName);
    if (!(await exists(filePath))) continue;
    const pid = readRuntimePidFile(filePath);
    if (!pid) {
      pushRuntimeLog(logs, `preserved unverified runtime file: ${filePath}`);
      continue;
    }
    if (pid && isProcessAlive(pid)) continue;
    await rm(filePath, { force: true }).catch(() => null);
    pushRuntimeLog(logs, `removed stale runtime file: ${filePath}`);
  }
}

async function ensureWorkbenchApiHermesHome(options = {}) {
  const apiPort = Number(options.port || 8642);
  await mkdir(hermesWorkbenchApiHome, { recursive: true });
  for (const dirName of ['profiles', 'skills', 'plugins', 'sessions', 'logs', 'checkpoints']) {
    const sourceDir = path.join(hermesHome, dirName);
    if (await exists(sourceDir)) await ensureSymlink(sourceDir, path.join(hermesWorkbenchApiHome, dirName));
  }
  for (const fileName of ['auth.json', 'auth.lock', 'models.json']) {
    const sourceFile = path.join(hermesHome, fileName);
    const destFile = path.join(hermesWorkbenchApiHome, fileName);
    if ((await exists(sourceFile)) && !(await exists(destFile))) {
      await symlink(sourceFile, destFile);
    }
  }
  const activeProfilePath = path.join(hermesWorkbenchApiHome, 'active_profile');
  if (await exists(activeProfilePath)) await rm(activeProfilePath, { force: true });
  await writeFile(activeProfilePath, 'default\n', 'utf8');

  const sourceConfig = await readYamlFile(path.join(hermesHome, 'config.yaml'));
  const previousApiConfig = await readYamlFile(path.join(hermesWorkbenchApiHome, 'config.yaml'));
  const apiConfig = {};
  for (const [key, value] of Object.entries(sourceConfig)) {
    if (!gatewayPlatformConfigKeys.has(key)) apiConfig[key] = value;
  }
  if (previousApiConfig?.model && Object.keys(previousApiConfig.model).length) {
    apiConfig.model = previousApiConfig.model;
  }
  if (previousApiConfig?.providers && Object.keys(previousApiConfig.providers).length) {
    apiConfig.providers = previousApiConfig.providers;
  }
  try {
    const state = await readState();
    const defaultModelId = state.ui?.defaultModel || 'model_default_deepseek_v4_flash';
    const workbenchModel = state.models.find((model) => model.id === defaultModelId) || state.models.find((model) => model.id === 'model_default_deepseek_v4_flash');
    const apiKey = workbenchModel?.id ? await getModelSecret(workbenchModel.id) : '';
    if (workbenchModel?.baseUrl && workbenchModel?.model && apiKey) {
      apiConfig.model = { default: workbenchModel.model, provider: 'custom:workbench-default' };
      apiConfig.providers = {
        ...(apiConfig.providers || {}),
        'custom:workbench-default': {
          provider: 'openai',
          name: workbenchModel.name || 'Frakio Work Default',
          base_url: workbenchModel.baseUrl,
          api_key: apiKey,
          model: workbenchModel.model,
        },
      };
    }
  } catch (error) {
    console.warn('Failed to sync Frakio Work default model into Hermes API runtime:', error?.message || error);
  }
  apiConfig.platforms = {
    api_server: {
      enabled: true,
      extra: {
        host: '127.0.0.1',
        port: apiPort,
        cors_origins: [
          'http://127.0.0.1:5173',
          'http://127.0.0.1:5174',
          'http://localhost:5173',
          'http://localhost:5174',
          'http://127.0.0.1:8787',
        ],
      },
    },
  };
  await writeFile(path.join(hermesWorkbenchApiHome, 'config.yaml'), YAML.stringify(apiConfig), 'utf8');
  return hermesWorkbenchApiHome;
}

async function discoverHermesBootstrap() {
  const installed = await exists(hermesHome);
  const rootConfigExists = await exists(path.join(hermesHome, 'config.yaml'));
  const sourceExists = await exists(path.join(hermesAgentSourcePath, '.git'));
  const profiles = await readHermesProfiles();
  const profileConfigs = await readHermesProfileConfigs();
  const api = await probeHermesAgentApi();
  const selectedProfile = profiles.find((profile) => profile.name === 'default')?.name || profiles[0]?.name || 'default';
  const approval = await readApprovalConfig(selectedProfile);
  const status = api.online ? 'connected' : installed || rootConfigExists || profiles.length ? 'installed' : 'missing';
  return {
    status,
    installed,
    installPath: hermesHome,
    sourcePath: hermesAgentSourcePath,
    sourceExists,
    rootConfigExists,
    api,
    profiles,
    profileConfigCount: profileConfigs.length,
    approval,
    checkedAt: now(),
    nextAction: status === 'missing' ? 'install' : api.online ? 'import' : 'start',
  };
}

async function backupAndWriteProfileText(filePath, nextText, stamp) {
  await mkdir(path.dirname(filePath), { recursive: true });
  if (await exists(filePath)) {
    const current = await readFile(filePath, 'utf8').catch(() => '');
    if (current.trim() === String(nextText || '').trim()) return false;
    const backupPath = `${filePath}.frakio-backup-${stamp}`;
    await writeFile(backupPath, current, 'utf8');
  }
  await writeFile(filePath, `${String(nextText || '').trim()}\n`, 'utf8');
  return true;
}

async function repairHermesProfilesFromState(state) {
  const repaired = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const agent of state.agents || []) {
    const profileName = slug(agent.profileName || agent.id || '');
    if (!profileName || isSystemHermesProfile(profileName, agent.id)) continue;
    const dir = await profileDirForName(profileName);
    if (!dir) continue;

    const soul = usefulProfileText(agent.soul);
    if (soul) {
      const soulPath = path.join(dir, 'SOUL.md');
      const currentSoul = await readFile(soulPath, 'utf8').catch(() => '');
      if (!currentSoul.trim() || isDefaultHermesSoul(currentSoul)) {
        if (await backupAndWriteProfileText(soulPath, soul, stamp)) repaired.push({ profileName, file: 'SOUL.md' });
      }
    }

    const userProfile = String(agent.userProfile || '').trim();
    if (userProfile) {
      const userPath = path.join(dir, 'memories', 'USER.md');
      const currentUser = await readFile(userPath, 'utf8').catch(() => '');
      if (!currentUser.trim()) {
        if (await backupAndWriteProfileText(userPath, userProfile, stamp)) repaired.push({ profileName, file: 'memories/USER.md' });
      }
    }

    const memory = String(agent.memory || '').trim();
    if (memory) {
      const memoryPath = path.join(dir, 'memories', 'MEMORY.md');
      const currentMemory = await readFile(memoryPath, 'utf8').catch(() => '');
      if (!currentMemory.trim()) {
        if (await backupAndWriteProfileText(memoryPath, memory, stamp)) repaired.push({ profileName, file: 'memories/MEMORY.md' });
      }
    }

  }
  return repaired;
}

async function syncHermesProfilesToState(state, discovery = null) {
  const repair = await repairHermesProfilesFromState(state);
  const bootstrap = discovery || await discoverHermesBootstrap();
  const importedProfileNames = new Set(
    (state.integrations.hermesAgent?.importedProfileNames || state.integrations.hermesStudio?.importedProfileNames || [])
      .filter((name) => !isSystemHermesProfile(name)),
  );
  const visibleProfiles = userVisibleHermesProfiles(bootstrap.profiles);

  for (const profile of visibleProfiles) {
    const canonicalAgentId = profile.name === 'default' ? 'hermes-default' : slug(profile.name);
    const existingAgent = state.agents.find((agent) => agent.profileName === profile.name || agent.id === canonicalAgentId || agent.id === slug(profile.name));
    const nextAgent = { ...agentFromProfile(profile, existingAgent), source: 'hermes-profile' };
    const existingAgentIndex = state.agents.findIndex((agent) => agent.id === nextAgent.id);
    if (existingAgentIndex >= 0) state.agents[existingAgentIndex] = { ...state.agents[existingAgentIndex], ...nextAgent };
    else state.agents.push(nextAgent);

    importedProfileNames.add(profile.name);
  }

  if (!state.agents.some((agent) => agent.id === state.ui?.defaultAgentId)) {
    state.ui = { ...(state.ui || {}), defaultAgentId: resolveDefaultAgentId(state) };
  }

  state.integrations.hermesAgent = {
    ...(state.integrations.hermesAgent || {}),
    installPath: bootstrap.installPath,
    sourcePath: bootstrap.sourcePath,
    apiBaseUrl: bootstrap.api.apiBaseUrl,
    apiStatus: bootstrap.api.online ? 'connected' : 'offline',
    selectedProfile: bootstrap.approval.profileName || bootstrap.profiles[0]?.name || 'default',
    lastCheckedAt: bootstrap.checkedAt,
    approvalMode: bootstrap.approval.mode,
    importedProfileNames: Array.from(importedProfileNames).sort(),
  };
  bootstrap.repair = repair;
  return { state, importedProfiles: visibleProfiles.map((profile) => profile.name), bootstrap, repair };
}

function profileColor(profile) {
  const palette = ['#111827', '#0f766e', '#7c3aed', '#b45309', '#2563eb', '#475569', '#be123c', '#0369a1'];
  const total = String(profile || '').split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return palette[total % palette.length];
}

function hermesHeaders() {
  const token = String(process.env.HERMES_STUDIO_TOKEN || process.env.HERMES_WEB_UI_TOKEN || '').trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readRecentStudioUrls() {
  if (!hermesWebUiHome) return [];
  const logs = [
    path.join(hermesWebUiHome, 'logs/server.log'),
    path.join(hermesWebUiHome, 'server.log'),
    path.join(hermesWebUiHome, 'launchd-stdout.log'),
  ];
  const urls = [];
  for (const logPath of logs) {
    try {
      const raw = await readFile(logPath, 'utf8');
      for (const match of raw.matchAll(/Server:\s*(http:\/\/(?:localhost|127\.0\.0\.1):\d+)/g)) urls.push(match[1].replace('localhost', '127.0.0.1'));
    } catch {
      // Missing logs are expected on first run or after cleanup.
    }
  }
  return urls.reverse();
}

async function readMonitoringLogs(limit = 120) {
  const logFiles = [
    { source: 'Hermes Web UI', file: path.join(hermesWebUiHome, 'logs/server.log') },
    { source: 'Hermes Web UI', file: path.join(hermesWebUiHome, 'server.log') },
    { source: 'Hermes launchd', file: path.join(hermesWebUiHome, 'launchd-stdout.log') },
    { source: 'Hermes Agent', file: path.join(hermesHome, 'logs/hermes.log') },
  ];
  const rows = [];
  for (const item of logFiles) {
    try {
      const raw = await readFile(item.file, 'utf8');
      const lines = raw.split(/\r?\n/).filter(Boolean).slice(-Math.ceil(limit / 2));
      for (const line of lines) {
        rows.push({
          source: item.source,
          file: item.file,
          level: /error|fail|fatal/i.test(line) ? 'error' : /warn/i.test(line) ? 'warn' : 'info',
          message: line.slice(0, 1000),
        });
      }
    } catch {
      // Missing logs are normal when Hermes has not produced that file yet.
    }
  }
  return rows.slice(-limit).reverse();
}

function dayKey(value) {
  return String(value || now()).slice(0, 10);
}

function numberFromUsage(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function configuredPricingForRow(row = {}, models = []) {
  const normalizedId = String(row.modelId || '').toLowerCase();
  const normalizedName = String(row.modelName || '').toLowerCase();
  const normalizedProvider = String(row.provider || '').toLowerCase();
  const matched = models.find((model) => {
    const ids = [model.id, model.model, model.name].map((value) => String(value || '').toLowerCase()).filter(Boolean);
    const provider = String(model.provider || '').toLowerCase();
    return ids.includes(normalizedId) || ids.includes(normalizedName) || (provider === normalizedProvider && ids.some((value) => normalizedId.includes(value) || normalizedName.includes(value)));
  });
  if (!matched) return null;
  const pricing = normalizeModelPricing(matched.pricing);
  if ([pricing.input, pricing.output, pricing.cacheRead, pricing.cacheCreation].every((value) => value == null)) return null;
  return {
    input: pricing.input ?? 0,
    output: pricing.output ?? 0,
    cacheRead: pricing.cacheRead ?? 0,
    cacheCreation: pricing.cacheCreation ?? 0,
  };
}

function pricingForModel(row = {}, models = []) {
  const configured = configuredPricingForRow(row, models);
  if (configured) return { ...configured, source: 'configured' };
  const signature = `${row.provider || ''} ${row.modelId || ''} ${row.modelName || ''}`;
  const matched = modelPricingDefaults.find((item) => item.pattern.test(signature));
  return matched ? { input: matched.input, output: matched.output, cacheRead: matched.cacheRead, cacheCreation: matched.cacheCreation, source: 'default' } : { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, source: 'none' };
}

function costForUsage(row = {}, models = []) {
  const pricing = pricingForModel(row, models);
  if (Number.isFinite(Number(row.totalCost))) {
    return { inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheCreationCost: 0, totalCost: Number(row.totalCost), pricing };
  }
  const inputCost = (Number(row.inputTokens || 0) / 1_000_000) * pricing.input;
  const outputCost = (Number(row.outputTokens || 0) / 1_000_000) * pricing.output;
  const cacheReadCost = (Number(row.cacheReadTokens || 0) / 1_000_000) * pricing.cacheRead;
  const cacheCreationCost = (Number(row.cacheCreationTokens || 0) / 1_000_000) * pricing.cacheCreation;
  return { inputCost, outputCost, cacheReadCost, cacheCreationCost, totalCost: inputCost + outputCost + cacheReadCost + cacheCreationCost, pricing };
}

function aggregateModelUsage(rows = [], models = []) {
  const byModel = new Map();
  const byDay = new Map();
  const byProfile = new Map();
  for (const row of rows) {
    const modelKey = `${row.provider || 'unknown'}:${row.modelId || row.modelName || 'unknown'}`;
    const cacheReadTokens = Number(row.cacheReadTokens || 0);
    const cacheCreationTokens = Number(row.cacheCreationTokens || 0);
    const realTotalTokens = Number(row.realTotalTokens ?? (Number(row.totalTokens || 0) + cacheReadTokens + cacheCreationTokens));
    const cost = costForUsage({ ...row, cacheReadTokens, cacheCreationTokens }, models);
    const current = byModel.get(modelKey) || {
      key: modelKey,
      provider: row.provider || 'unknown',
      modelId: row.modelId || '',
      modelName: row.modelName || row.modelId || 'unknown',
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      realTotalTokens: 0,
      totalCost: 0,
      pricing: cost.pricing,
      pricingSource: cost.pricing.source,
      estimatedRequests: 0,
      lastUsedAt: row.createdAt,
      dataSources: {},
    };
    current.requests += 1;
    current.inputTokens += Number(row.inputTokens || 0);
    current.outputTokens += Number(row.outputTokens || 0);
    current.cacheReadTokens += cacheReadTokens;
    current.cacheCreationTokens += cacheCreationTokens;
    current.totalTokens += Number(row.totalTokens || 0);
    current.realTotalTokens += realTotalTokens;
    current.totalCost += cost.totalCost;
    current.pricing = cost.pricing;
    current.pricingSource = cost.pricing.source;
    current.estimatedRequests += row.estimated ? 1 : 0;
    current.lastUsedAt = String(row.createdAt || '').localeCompare(String(current.lastUsedAt || '')) > 0 ? row.createdAt : current.lastUsedAt;
    current.dataSources[row.dataSource || row.provider || 'Frakio Work'] = (current.dataSources[row.dataSource || row.provider || 'Frakio Work'] || 0) + 1;
    byModel.set(modelKey, current);

    const day = dayKey(row.createdAt);
    const dayRow = byDay.get(day) || { day, requests: 0, totalTokens: 0, realTotalTokens: 0, totalCost: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
    dayRow.requests += 1;
    dayRow.totalTokens += Number(row.totalTokens || 0);
    dayRow.realTotalTokens += realTotalTokens;
    dayRow.totalCost += cost.totalCost;
    dayRow.inputTokens += Number(row.inputTokens || 0);
    dayRow.outputTokens += Number(row.outputTokens || 0);
    dayRow.cacheReadTokens += cacheReadTokens;
    dayRow.cacheCreationTokens += cacheCreationTokens;
    byDay.set(day, dayRow);

    const profileName = row.profileName || row.agentNames?.[0] || 'default';
    const profileRow = byProfile.get(profileName) || { profileName, requests: 0, totalTokens: 0, realTotalTokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalCost: 0 };
    profileRow.requests += 1;
    profileRow.totalTokens += Number(row.totalTokens || 0);
    profileRow.realTotalTokens += realTotalTokens;
    profileRow.inputTokens += Number(row.inputTokens || 0);
    profileRow.outputTokens += Number(row.outputTokens || 0);
    profileRow.cacheReadTokens += cacheReadTokens;
    profileRow.cacheCreationTokens += cacheCreationTokens;
    profileRow.totalCost += cost.totalCost;
    byProfile.set(profileName, profileRow);
  }
  const configuredModels = models.map((model) => {
    const key = `${model.provider || 'unknown'}:${model.model || model.name}`;
    const pricing = pricingForModel({ provider: model.provider, modelId: model.model, modelName: model.name }, models);
    return byModel.get(key) || {
      key,
      provider: model.provider,
      modelId: model.model,
      modelName: model.name,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      realTotalTokens: 0,
      totalCost: 0,
      pricing,
      pricingSource: pricing.source,
      estimatedRequests: 0,
      lastUsedAt: null,
      dataSources: {},
    };
  });
  const merged = [...configuredModels, ...Array.from(byModel.values()).filter((row) => !configuredModels.some((model) => model.key === row.key))];
  const inputTokens = rows.reduce((sum, row) => sum + Number(row.inputTokens || 0), 0);
  const outputTokens = rows.reduce((sum, row) => sum + Number(row.outputTokens || 0), 0);
  const cacheReadTokens = rows.reduce((sum, row) => sum + Number(row.cacheReadTokens || 0), 0);
  const cacheCreationTokens = rows.reduce((sum, row) => sum + Number(row.cacheCreationTokens || 0), 0);
  const totalTokens = rows.reduce((sum, row) => sum + Number(row.totalTokens || 0), 0);
  const realTotalTokens = rows.reduce((sum, row) => sum + Number(row.realTotalTokens ?? (Number(row.totalTokens || 0) + Number(row.cacheReadTokens || 0) + Number(row.cacheCreationTokens || 0))), 0);
  const totalCost = rows.reduce((sum, row) => sum + costForUsage(row, models).totalCost, 0);
  const bySource = Array.from(rows.reduce((map, row) => {
    const source = row.dataSource || row.provider || 'Frakio Work';
    const current = map.get(source) || { source, requests: 0, totalTokens: 0, realTotalTokens: 0, totalCost: 0 };
    current.requests += 1;
    current.totalTokens += Number(row.totalTokens || 0);
    current.realTotalTokens += Number(row.realTotalTokens ?? (Number(row.totalTokens || 0) + Number(row.cacheReadTokens || 0) + Number(row.cacheCreationTokens || 0)));
    current.totalCost += costForUsage(row, models).totalCost;
    map.set(source, current);
    return map;
  }, new Map()).values()).sort((a, b) => b.realTotalTokens - a.realTotalTokens);
  const cacheableInput = inputTokens + cacheReadTokens;
  return {
    totalRequests: rows.length,
    totalTokens,
    realTotalTokens,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalCost,
    cacheHitRate: cacheableInput > 0 ? cacheReadTokens / cacheableInput : 0,
    estimatedRequests: rows.filter((row) => row.estimated).length,
    byModel: merged.sort((a, b) => b.realTotalTokens - a.realTotalTokens),
    byDay: Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day)).slice(-14),
    bySource,
    byProfile: Array.from(byProfile.values()).sort((a, b) => b.realTotalTokens - a.realTotalTokens),
    entries: rows.map((row) => {
      const cost = costForUsage(row, models);
      return {
        ...row,
        realTotalTokens: Number(row.realTotalTokens ?? (Number(row.totalTokens || 0) + Number(row.cacheReadTokens || 0) + Number(row.cacheCreationTokens || 0))),
        totalCost: cost.totalCost,
        pricing: cost.pricing,
        pricingSource: cost.pricing.source,
      };
    }),
    recent: rows.slice(-20).reverse(),
  };
}

function collectModuleUsage(state, kind) {
  const entries = [];
  for (const agent of state.agents || []) {
    const modules = kind === 'skills' ? agent.skills || [] : agent.plugins || [];
    for (const item of modules) {
      const name = typeof item === 'string' ? item : item.name;
      if (!name) continue;
      const usage = typeof item === 'string' ? {} : item.usage || {};
      entries.push({
        name,
        profile: agent.profileName || agent.name,
        agentName: agent.name,
        category: typeof item === 'string' ? '' : item.category || item.source || '',
        enabled: typeof item === 'string' ? true : item.enabled !== false && item.status !== 'disabled',
        useCount: Number(usage.useCount || 0),
        viewCount: Number(usage.viewCount || 0),
        patchCount: Number(usage.patchCount || 0),
        lastUsedAt: usage.lastUsedAt || null,
      });
    }
  }
  const byName = new Map();
  for (const entry of entries) {
    const current = byName.get(entry.name) || {
      name: entry.name,
      category: entry.category,
      profiles: 0,
      enabledProfiles: 0,
      useCount: 0,
      viewCount: 0,
      patchCount: 0,
      lastUsedAt: null,
    };
    current.profiles += 1;
    current.enabledProfiles += entry.enabled ? 1 : 0;
    current.useCount += entry.useCount;
    current.viewCount += entry.viewCount;
    current.patchCount += entry.patchCount;
    current.lastUsedAt = entry.lastUsedAt && (!current.lastUsedAt || String(entry.lastUsedAt).localeCompare(String(current.lastUsedAt)) > 0) ? entry.lastUsedAt : current.lastUsedAt;
    byName.set(entry.name, current);
  }
  return {
    total: entries.length,
    enabled: entries.filter((entry) => entry.enabled).length,
    byName: Array.from(byName.values()).sort((a, b) => (b.useCount + b.viewCount + b.patchCount) - (a.useCount + a.viewCount + a.patchCount)).slice(0, 24),
    entries: entries.sort((a, b) => (b.useCount + b.viewCount + b.patchCount) - (a.useCount + a.viewCount + a.patchCount)).slice(0, 80),
  };
}

function collectAgentUsage(state) {
  const byId = new Map();
  const agentLookup = new Map((state.agents || []).map((agent) => [agent.id, agent]));

  function ensureAgent(agentId, fallbackName = '') {
    if (!agentId || agentId === 'user') return null;
    const agent = agentLookup.get(agentId);
    const key = agent?.id || agentId;
    const current = byId.get(key) || {
      id: key,
      name: agent?.name || fallbackName || agentId,
      role: agent?.role || '',
      color: agent?.color || '#0f766e',
      avatarUrl: agent?.avatarUrl || '',
      profileName: agent?.profileName || '',
      conversationCount: 0,
      messageCount: 0,
      lastUsedAt: null,
    };
    byId.set(key, current);
    return current;
  }

  for (const thread of state.threads || []) {
    const threadAgents = new Set([
      ...(Array.isArray(thread.selectedAgents) ? thread.selectedAgents : []),
      thread.primaryAgentId,
      thread.defaultAgentId,
      thread.activeAgentId,
    ].filter(Boolean));

    for (const message of thread.messages || []) {
      if (message.agentId && message.agentId !== 'user') {
        threadAgents.add(message.agentId);
        const row = ensureAgent(message.agentId, message.agentName);
        if (row) {
          row.messageCount += 1;
          row.lastUsedAt = thread.updatedAt && (!row.lastUsedAt || String(thread.updatedAt).localeCompare(String(row.lastUsedAt)) > 0) ? thread.updatedAt : row.lastUsedAt;
        }
      }
    }

    for (const agentId of threadAgents) {
      const row = ensureAgent(agentId);
      if (row) {
        row.conversationCount += 1;
        row.lastUsedAt = thread.updatedAt && (!row.lastUsedAt || String(thread.updatedAt).localeCompare(String(row.lastUsedAt)) > 0) ? thread.updatedAt : row.lastUsedAt;
      }
    }
  }

  return Array.from(byId.values()).sort((a, b) => b.conversationCount - a.conversationCount || b.messageCount - a.messageCount || a.name.localeCompare(b.name));
}

async function candidateStudioUrls() {
  const candidates = [
    process.env.HERMES_STUDIO_URL,
    ...(await readRecentStudioUrls()),
  ].filter(Boolean).map((url) => String(url).replace(/\/$/, '').replace('localhost', '127.0.0.1'));
  return Array.from(new Set(candidates));
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 1600);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { ok: res.ok, status: res.status, body };
  } catch (error) {
    return { ok: false, status: 0, error: String(error?.message || error) };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchExternalJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function probeStudio() {
  for (const url of await candidateStudioUrls()) {
    const health = await fetchJson(`${url}/health`);
    if (!health.ok) continue;
    const authProbe = await fetchJson(`${url}/api/hermes/profiles`, { headers: hermesHeaders(), timeoutMs: 1600 });
    return {
      url,
      online: true,
      health: health.body || null,
      authMode: authProbe.ok ? 'env-token' : authProbe.status === 401 ? 'unauthorized' : 'unknown',
      apiAuthorized: Boolean(authProbe.ok),
      apiStatus: authProbe.status,
    };
  }
  return { url: '', online: false, health: null, authMode: 'none', apiAuthorized: false, apiStatus: 0 };
}

async function readHermesProfiles() {
  const dirs = new Map();
  const rootConfig = path.join(hermesHome, 'config.yaml');
  if (await exists(rootConfig)) dirs.set('default', hermesHome);
  const profilesRoot = path.join(hermesHome, 'profiles');
  try {
    const entries = await readdir(profilesRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const profileDir = path.join(profilesRoot, entry.name);
      dirs.set(entry.name, profileDir);
    }
  } catch {
    // Profiles are optional. Root Hermes installs may only have ~/.hermes/config.yaml.
  }

  const profiles = [];
  for (const [name, dir] of dirs) {
    const configPath = path.join(dir, 'config.yaml');
    const hasConfig = await exists(configPath);
    const config = await readYamlFile(configPath);
    const envValues = await readEnvStatus(path.join(dir, '.env'));
    const profileYaml = await readYamlFile(path.join(dir, 'profile.yaml'));
    const providerSummaries = buildProviderSummaries(config, envValues);
    const modelName = String(config?.model?.default || config?.model || '').trim();
    const providerKey = String(config?.model?.provider || config?.provider || '').trim();
    const providerConfig = providerKey && config?.providers && typeof config.providers === 'object' ? config.providers[providerKey] : null;
    const contextLimit = Number(providerConfig?.context_limit || providerConfig?.context_window || 0) || null;
    const soulText = await readProfileText(path.join(dir, 'SOUL.md'), 16000);
    const userText = await readProfileText(path.join(dir, 'memories/USER.md'), 10000);
    const memoryText = await readProfileText(path.join(dir, 'memories/MEMORY.md'), 10000);
    const modules = await readProfileModules(dir, name, config);
    const avatarUrl = await findProfileAvatar(dir, name);
    profiles.push({
      name,
      path: dir,
      displayName: String(profileYaml?.name || profileYaml?.display_name || titleCaseProfile(name)).trim(),
      model: modelName || 'provider default',
      provider: providerKey || 'provider default',
      contextLimit,
      hasConfig,
      hasEnv: await exists(path.join(dir, '.env')),
      hasAuth: await exists(path.join(dir, 'auth.json')),
      soul: soulText,
      soulExcerpt: compactText(soulText, 700),
      userProfile: userText,
      userExcerpt: compactText(userText, 600),
      memory: memoryText,
      memoryExcerpt: compactText(memoryText, 600),
      providers: providerSummaries,
      skills: modules.skills,
      plugins: modules.plugins,
      avatarUrl,
    });
  }
  return profiles.sort((a, b) => a.name.localeCompare(b.name));
}

async function sqliteQuery(sql) {
  if (!(await exists(hermesDbPath))) return [];
  try {
    const { stdout } = await execFileAsync('sqlite3', ['-readonly', '-separator', '\t', hermesDbPath, sql], { timeout: 2000, maxBuffer: 1024 * 256 });
    return stdout.trim().split('\n').filter(Boolean).map((line) => line.split('\t'));
  } catch {
    return [];
  }
}

async function sqliteJsonQuery(sql) {
  if (!(await exists(hermesDbPath))) return [];
  try {
    const { stdout } = await execFileAsync('sqlite3', ['-readonly', '-json', hermesDbPath, sql], { timeout: 2500, maxBuffer: 1024 * 512 });
    return stdout.trim() ? JSON.parse(stdout) : [];
  } catch {
    return [];
  }
}

async function sqliteJsonQueryFile(dbPath, sql) {
  if (!(await exists(dbPath))) return [];
  try {
    const { stdout } = await execFileAsync('sqlite3', ['-readonly', '-json', dbPath, sql], { timeout: 3000, maxBuffer: 1024 * 1024 });
    return stdout.trim() ? JSON.parse(stdout) : [];
  } catch {
    return [];
  }
}

async function sqliteScalarFile(dbPath, sql) {
  if (!(await exists(dbPath))) return '';
  try {
    const { stdout } = await execFileAsync('sqlite3', ['-readonly', '-noheader', dbPath, sql], { timeout: 1500, maxBuffer: 1024 * 64 });
    return stdout.trim();
  } catch {
    return '';
  }
}

async function discoverHermesAgentStateDbs() {
  const items = [];
  const rootDb = path.join(hermesHome, 'state.db');
  if (await exists(rootDb)) items.push({ profileName: 'default', dbPath: rootDb });
  const profilesRoot = path.join(hermesHome, 'profiles');
  try {
    const entries = await readdir(profilesRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dbPath = path.join(profilesRoot, entry.name, 'state.db');
      if (await exists(dbPath)) items.push({ profileName: entry.name, dbPath });
    }
  } catch {
    // Profiles are optional.
  }
  return items;
}

async function readHermesDbSummary() {
  const rooms = (await sqliteQuery('select id,name,totalTokens,tailMessageCount,maxHistoryTokens from gc_rooms order by rowid desc limit 8;'))
    .map(([idValue, name, totalTokens, tailMessageCount, maxHistoryTokens]) => ({
      id: idValue,
      name,
      totalTokens: Number(totalTokens || 0),
      tailMessageCount: Number(tailMessageCount || 0),
      maxHistoryTokens: Number(maxHistoryTokens || 0),
    }));
  const sessions = (await sqliteQuery("select profile,model,provider,title,message_count,last_active from sessions order by last_active desc limit 8;"))
    .map(([profile, model, provider, title, messageCount, lastActive]) => ({
      profile,
      model,
      provider,
      title,
      messageCount: Number(messageCount || 0),
      lastActive: Number(lastActive || 0),
    }));
  return { exists: await exists(hermesDbPath), path: hermesDbPath, rooms, sessions };
}

async function readHermesSessionUsageRows() {
  const { rows } = await readHermesAgentUsageRows();
  return rows;
}

async function readHermesAgentUsageRows() {
  const dbs = await discoverHermesAgentStateDbs();
  const rows = [];
  const profiles = [];
  for (const item of dbs) {
    const hasSessions = await sqliteScalarFile(item.dbPath, "select count(*) from sqlite_master where type='table' and name='sessions';");
    if (hasSessions !== '1') continue;
    const profileRows = await sqliteJsonQueryFile(item.dbPath, `
      select
        id,
        coalesce(nullif(model, ''), 'unknown') as model,
        coalesce(nullif(billing_provider, ''), 'Hermes Agent') as provider,
        coalesce(title, '') as title,
        coalesce(input_tokens, 0) as input_tokens,
        coalesce(output_tokens, 0) as output_tokens,
        coalesce(cache_read_tokens, 0) as cache_read_tokens,
        coalesce(cache_write_tokens, 0) as cache_write_tokens,
        coalesce(reasoning_tokens, 0) as reasoning_tokens,
        coalesce(api_call_count, 0) as api_call_count,
        coalesce(actual_cost_usd, estimated_cost_usd, 0) as cost_usd,
        started_at
      from sessions
      where (coalesce(input_tokens, 0) + coalesce(output_tokens, 0) + coalesce(cache_read_tokens, 0) + coalesce(cache_write_tokens, 0) + coalesce(reasoning_tokens, 0)) > 0
      order by started_at asc
      limit 10000;
    `);
    profiles.push({ profileName: item.profileName, dbPath: item.dbPath, sessionCount: profileRows.length });
    for (const row of profileRows) {
      const inputTokens = Number(row.input_tokens || 0);
      const outputTokens = Number(row.output_tokens || 0);
      const reasoningTokens = Number(row.reasoning_tokens || 0);
      const cacheReadTokens = Number(row.cache_read_tokens || 0);
      const cacheCreationTokens = Number(row.cache_write_tokens || 0);
      const startedAt = Number(row.started_at || 0);
      const modelName = String(row.model || 'unknown');
      rows.push({
        id: `hermes-agent-state-${item.profileName}-${row.id}`,
        createdAt: startedAt > 0 ? new Date(startedAt * 1000).toISOString() : now(),
        provider: String(row.provider || 'Hermes Agent'),
        modelId: modelName,
        modelName,
        threadId: String(row.id || ''),
        threadTitle: String(row.title || ''),
        workspaceId: null,
        agentIds: [item.profileName],
        agentNames: [item.profileName],
        profileName: item.profileName,
        inputTokens,
        outputTokens: outputTokens + reasoningTokens,
        cacheReadTokens,
        cacheCreationTokens,
        totalTokens: inputTokens + outputTokens + reasoningTokens,
        realTotalTokens: inputTokens + outputTokens + reasoningTokens + cacheReadTokens,
        totalCost: Number(row.cost_usd || 0),
        apiCallCount: Number(row.api_call_count || 0),
        estimated: false,
        dataSource: 'Hermes Agent state.db',
      });
    }
  }
  return {
    rows,
    meta: {
      databaseCount: profiles.length,
      profiles,
      usageRowCount: rows.length,
      usageSource: 'Hermes Agent state.db',
    },
  };
}

function agentFromProfile(profile, existing = null) {
  const idValue = profile.name === 'default' ? 'hermes-default' : slug(profile.name);
  const modelName = existing?.model || '';
  const providerName = profile.providers?.[0]?.providerName || providerLabel(profile.provider);
  const soul = profileTextOrExisting(profile.soul || profile.soulExcerpt, existing?.soul);
  const userProfile = String(profile.userProfile || '').trim() || String(existing?.userProfile || '').trim();
  const memory = String(profile.memory || '').trim() || String(existing?.memory || '').trim();
  const providers = profile.providers?.length ? profile.providers : existing?.providerSummary || [];
  return {
    id: existing?.id || idValue,
    name: existing?.name || profile.displayName || titleCaseProfile(profile.name),
    role: existing?.role || `Hermes Profile / ${profile.name}`,
    model: modelName,
    color: existing?.color || profileColor(profile.name),
    soul: soul || `从本机 Hermes 的 ${profile.name} Profile 导入。`,
    scope: existing?.scope || `本机 Profile: ${profile.name}。原始 provider 为 ${providerName}，原始模型为 ${profile.model}。模型 API 需要在 Frakio Work 模型中心单独配置。`,
    source: 'hermes-profile',
    profileName: profile.name,
    gatewayStatus: '',
    soulExcerpt: usefulProfileText(profile.soulExcerpt) || compactText(soul, 700) || existing?.soulExcerpt || '',
    userProfileExcerpt: profile.userExcerpt || compactText(userProfile, 600) || existing?.userProfileExcerpt || '',
    memoryExcerpt: profile.memoryExcerpt || compactText(memory, 600) || existing?.memoryExcerpt || '',
    userProfile,
    memory,
    providerSummary: providers,
    skills: profile.skills?.length ? profile.skills : existing?.skills || [],
    plugins: profile.plugins?.length ? profile.plugins : existing?.plugins || [],
    avatarUrl: profile.avatarUrl || existing?.avatarUrl || '',
  };
}

async function discoverHermesStudio() {
  const [studio, profiles, database] = await Promise.all([probeStudio(), readHermesProfiles(), readHermesDbSummary()]);
  return {
    studio,
    profiles,
    database,
    checkedAt: now(),
    paths: {
      webUiHome: hermesWebUiHome,
      hermesHome,
    },
  };
}

async function runHermesStudioChat(discovery, state, thread, message) {
  const profileName = state.integrations?.hermesStudio?.selectedProfile || 'default';
  const profile = (await readHermesProfiles()).find((item) => item.name === profileName) || (await readHermesProfiles())[0];
  const model = profile?.model && profile.model !== 'provider default' ? profile.model : state.models.find((item) => item.source === 'hermes-studio' && item.profileName === profileName)?.model;
  if (!discovery.studio.url || !model) throw new Error('Hermes Studio model is not available for chat.');
  const payload = {
    model,
    messages: [
      { role: 'system', content: 'You are connected from Frakio Work. Answer in Chinese unless the user asks otherwise.' },
      ...thread.messages.slice(-8).map((event) => ({ role: event.agentId === 'user' ? 'user' : 'assistant', content: event.content })),
      { role: 'user', content: message },
    ],
    stream: false,
  };
  const result = await fetchJson(`${discovery.studio.url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...hermesHeaders() },
    body: JSON.stringify(payload),
    timeoutMs: 45000,
  });
  if (!result.ok) throw new Error(`Hermes Studio chat failed with HTTP ${result.status}`);
  const content = result.body?.choices?.[0]?.message?.content || result.body?.output_text || '';
  if (!content) throw new Error('Hermes Studio chat returned an empty response.');
  return { content, profileName, model };
}

function chatCompletionsUrl(baseUrl) {
  const clean = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!clean) throw new Error('模型 Base URL 为空。');
  const parsed = new URL(clean);
  parsed.pathname = parsed.pathname
    .replace(/\/models\/?$/i, '')
    .replace(/\/responses\/?$/i, '')
    .replace(/\/chat\/completions\/?$/i, '');
  const normalized = parsed.toString().replace(/\/+$/, '');
  return /\/v\d+$/i.test(parsed.pathname) ? `${normalized}/chat/completions` : `${normalized}/v1/chat/completions`;
}

async function findUsableModelForThread(state, thread, selectedAgentIds = []) {
  const selectedAgents = state.agents.filter((agent) => selectedAgentIds.includes(agent.id));
  const overrides = normalizeAgentModelOverrides(thread?.agentModelOverrides || {}, state.agents, state.models);
  const overrideSelections = selectedAgentIds
    .map((agentId) => resolveModelSelection(overrides[agentId], state.models))
    .filter(({ selectedModel }) => Boolean(selectedModel));
  const overrideModelIds = overrideSelections.map(({ selectedModel }) => selectedModel.id);
  const overrideModelNames = overrideSelections.map(({ selectedName }) => selectedName);
  const preferredNames = [
    ...overrideModelNames,
    state.ui?.defaultModel,
    ...selectedAgents.flatMap((agent) => [agent.model, agent.providerSummary?.[0]?.model]),
  ].filter(Boolean).map((value) => String(value));
  const models = state.models.filter((model) => model.baseUrl && model.model);
  const ranked = [
    ...models.filter((model) => overrideModelIds.includes(model.id)),
    ...models.filter((model) => preferredNames.some((name) => name === model.id || name === model.name || name === model.model || name.includes(model.model))),
    ...models,
  ].filter((model, index, arr) => arr.findIndex((item) => item.id === model.id) === index);
  for (const model of ranked) {
    const apiKey = await getModelSecret(model.id);
    if (apiKey) return { model, apiKey, selectedAgents };
  }
  return { model: null, apiKey: '', selectedAgents };
}

function agentSystemPrompt(agents) {
  const selected = agents.length ? agents : [];
  if (!selected.length) return '你是 Frakio Work 里的团队 Agent。请用中文回答，保持清晰、可执行。';
  const profiles = selected.map((agent) => {
    const parts = [
      `Agent: ${agent.name}`,
      `Role: ${agent.role}`,
      agent.soul ? `Soul:\n${String(agent.soul).slice(0, 8000)}` : '',
      agent.userProfile ? `User profile:\n${String(agent.userProfile).slice(0, 3000)}` : '',
      agent.memory ? `Memory:\n${String(agent.memory).slice(0, 3000)}` : '',
    ].filter(Boolean);
    return parts.join('\n');
  }).join('\n\n---\n\n');
  return `你正在 Frakio Work 中扮演被选中的 Hermes Profile。请用中文回答，遵守对应 Soul 和记忆。\n\n${profiles}`;
}

async function runConfiguredModelChat(state, thread, message, selectedAgentIds = []) {
  const { model, apiKey, selectedAgents } = await findUsableModelForThread(state, thread, selectedAgentIds);
  if (!model || !apiKey) throw new Error('没有可用的模型 API Key。请在模型中心保存 Base URL、模型 ID 和 API Key。');
  const payload = {
    model: model.model,
    messages: [
      { role: 'system', content: agentSystemPrompt(selectedAgents) },
      ...thread.messages.slice(-10).map((event) => ({ role: event.agentId === 'user' ? 'user' : 'assistant', content: event.content })),
      { role: 'user', content: message },
    ],
    stream: false,
  };
  const result = await fetchJson(chatCompletionsUrl(model.baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
    timeoutMs: 60000,
  });
  if (!result.ok) {
    const providerMessage = typeof result.body?.error?.message === 'string' ? `：${result.body.error.message.slice(0, 180)}` : '';
    throw new Error(`模型调用失败，HTTP ${result.status || 'network'}${providerMessage}`);
  }
  const content = result.body?.choices?.[0]?.message?.content || result.body?.output_text || '';
  if (!content) throw new Error('模型返回为空。');
  recordModelUsage(state, model, result.body, selectedAgents, thread, message, content);
  return {
    content,
    modelName: model.name,
    provider: model.provider,
    modelId: model.model,
    agentName: selectedAgents.length === 1 ? selectedAgents[0].name : 'Hermes Profiles',
    role: selectedAgents.length === 1 ? selectedAgents[0].role : selectedAgents.map((agent) => agent.name).join(' / '),
  };
}

function modelUsageFromResponse(body, prompt, completion) {
  const usage = body?.usage || body?.response?.usage || {};
  const cacheReadTokens = numberFromUsage(usage.cache_read_input_tokens, usage.cached_input_tokens, usage.input_tokens_details?.cached_tokens, usage.prompt_tokens_details?.cached_tokens);
  const cacheCreationTokens = numberFromUsage(usage.cache_creation_input_tokens, usage.cache_creation?.input_tokens, usage.input_tokens_details?.cache_creation_tokens);
  const rawInputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? usage.inputTokenCount ?? 0);
  const inputTokens = Math.max(0, rawInputTokens - cacheReadTokens - cacheCreationTokens);
  const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? usage.outputTokenCount ?? 0);
  const totalTokens = Number(usage.total_tokens ?? usage.totalTokens ?? inputTokens + outputTokens);
  if (totalTokens > 0) return { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, totalTokens };
  const estimatedInput = Math.ceil(String(prompt || '').length / 3);
  const estimatedOutput = Math.ceil(String(completion || '').length / 3);
  return { inputTokens: estimatedInput, outputTokens: estimatedOutput, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: estimatedInput + estimatedOutput, estimated: true };
}

function recordModelUsage(state, model, body, selectedAgents, thread, prompt, completion) {
  const usage = modelUsageFromResponse(body, prompt, completion);
  state.observability = state.observability || { modelUsage: [], systemEvents: [] };
  state.observability.modelUsage = Array.isArray(state.observability.modelUsage) ? state.observability.modelUsage : [];
  state.observability.modelUsage.push({
    id: id('usage'),
    createdAt: now(),
    provider: model.provider,
    modelId: model.model,
    modelName: model.name,
    threadId: thread?.id || null,
    threadTitle: thread?.title || '',
    workspaceId: thread?.workspaceId || null,
    agentIds: selectedAgents.map((agent) => agent.id),
    agentNames: selectedAgents.map((agent) => agent.name),
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    totalTokens: usage.totalTokens,
    estimated: Boolean(usage.estimated),
    dataSource: 'Frakio Work',
  });
  state.observability.modelUsage = state.observability.modelUsage.slice(-800);
}

async function writeState(state) {
  await writeStateJson(state);
}

let stateTransactionQueue = Promise.resolve();

async function updateState(mutator) {
  const transaction = stateTransactionQueue.then(async () => {
    const state = await readState();
    const result = await mutator(state);
    await writeState(state);
    return result;
  });
  stateTransactionQueue = transaction.catch(() => {});
  return transaction;
}

async function walkMarkdown(root, limit = 2000) {
  const out = [];
  async function walk(dir) {
    if (out.length >= limit) return;
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (entry.name.startsWith('.') && entry.name !== '.space') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const s = await stat(full);
        out.push({ path: full, relativePath: path.relative(root, full), name: entry.name, size: s.size, mtimeMs: s.mtimeMs });
      }
    }
  }
  await walk(root);
  return out;
}

function classifyDoc(doc) {
  const rel = doc.relativePath;
  if (rel.includes('00_团队索引')) return '团队规则';
  if (rel.includes('04_Agent档案')) return 'Agent 档案';
  if (rel.includes('03_团队进化与经验沉淀/SOP')) return 'SOP';
  if (rel.includes('01_产品文档')) return '产品文档';
  if (rel.includes('Frakio博客')) return '博客项目';
  if (rel.includes('01_会议记录')) return '会议记录';
  return '项目资料';
}

async function excerpt(doc) {
  try {
    const raw = await readFile(doc.path, 'utf8');
    return raw
      .split('\n')
      .filter((line) => line.trim() && !line.trim().startsWith('---'))
      .slice(0, 8)
      .join('\n')
      .slice(0, 700);
  } catch {
    return '';
  }
}

function vaultNameFromPath(vaultPath) {
  return path.basename(vaultPath.replace(/\/$/, '')) || 'Obsidian Vault';
}

async function buildVaultIndex(vaultPath) {
  const vaultExists = await exists(vaultPath);
  if (!vaultExists) {
    const error = new Error('路径不存在，无法添加仓库。');
    error.status = 400;
    throw error;
  }

  const docs = await walkMarkdown(vaultPath);
  const categories = docs.reduce((acc, doc) => {
    const category = classifyDoc(doc);
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});

  const highSignalNames = [
    'Agent 协作规则.md',
    '文档关系与同步机制.md',
    '团队文档与资产管理规范.md',
    '2026-06-24_Frakio博客工作总控SOP_Max.md',
    '00_Frakio_25篇博客项目总控_Max.md',
    '_项目导航.md',
  ];

  const highSignal = docs
    .filter((doc) => highSignalNames.some((name) => doc.relativePath.endsWith(name)))
    .slice(0, 12);

  const productDocs = docs.filter((doc) => doc.relativePath.includes('01_产品文档/'));
  const ruleDocs = docs.filter((doc) => doc.relativePath.includes('00_团队索引/')).slice(0, 20);
  const sopDocs = docs.filter((doc) => doc.relativePath.includes('SOP/')).slice(0, 20);
  const latestMtimeMs = docs.reduce((max, doc) => Math.max(max, doc.mtimeMs || 0), 0);

  return {
    documentCount: docs.length,
    productCount: productDocs.length,
    categories,
    latestMtimeMs,
    products: productDocs.map((doc) => doc.name.replace(/\.md$/, '')),
    highSignal: await Promise.all(highSignal.map(async (doc) => ({ ...publicDoc(doc), excerpt: await excerpt(doc) }))),
    ruleDocs: ruleDocs.map(publicDoc),
    sopDocs: sopDocs.map(publicDoc),
  };
}

function publicDoc(doc) {
  return {
    relativePath: doc.relativePath,
    name: doc.name,
    category: classifyDoc(doc),
    size: doc.size,
    mtimeMs: doc.mtimeMs,
  };
}

async function markRefreshStatus(vault) {
  if (vault?.status === 'not_indexed' && vault.path && (await exists(vault.path))) {
    const index = await buildVaultIndex(vault.path);
    return {
      ...vault,
      status: 'indexed',
      documentCount: index.documentCount,
      productCount: index.productCount,
      lastIndexedAt: now(),
      needsRefresh: false,
      index,
    };
  }
  if (!vault?.index || !vault.path || !(await exists(vault.path))) return { ...vault, needsRefresh: Boolean(vault?.index) };
  const docs = await walkMarkdown(vault.path, 2200);
  const latestMtimeMs = docs.reduce((max, doc) => Math.max(max, doc.mtimeMs || 0), 0);
  return {
    ...vault,
    needsRefresh: docs.length !== vault.documentCount || latestMtimeMs > (vault.index.latestMtimeMs || 0),
  };
}

function publicVault(vault) {
  return {
    id: vault.id,
    name: vault.name,
    path: vault.path,
    status: vault.status,
    documentCount: vault.documentCount,
    productCount: vault.productCount,
    lastIndexedAt: vault.lastIndexedAt,
    needsRefresh: Boolean(vault.needsRefresh),
  };
}

function publicSpace(space) {
  return {
    id: space.id,
    name: space.name,
    iconKind: space.iconKind,
    iconValue: space.iconValue,
    theme: normalizeSpaceTheme(space.theme),
    archivedAt: space.archivedAt || null,
    createdAt: space.createdAt,
    updatedAt: space.updatedAt,
    lastOpenedAt: space.lastOpenedAt || null,
  };
}

function publicWorkspace(workspace, state) {
  const activeThread = state.threads.find((thread) => thread.id === workspace.activeThreadId && !thread.archivedAt);
  const threads = state.threads
    .filter((thread) => thread.workspaceId === workspace.id && thread.mode !== 'direct' && !thread.archivedAt)
    .sort(sortPinnedThenUpdated)
    .map((thread) => summarizeThread(thread, state));
  return { ...workspace, activeThread: activeThread ? summarizeThread(activeThread, state) : threads[0] || null, threads };
}

function sortPinnedThenUpdated(a, b) {
  const aPinned = a.pinnedAt || '';
  const bPinned = b.pinnedAt || '';
  if (aPinned || bPinned) {
    if (!aPinned) return 1;
    if (!bPinned) return -1;
    return String(bPinned).localeCompare(String(aPinned));
  }
  return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
}

function artifactKind(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.md') && /(plan|方案|report|报告|任务)/i.test(fileName)) return 'plan';
  if (lower.endsWith('.md')) return 'document';
  if (lower.endsWith('.json')) return 'data';
  if (lower.endsWith('.py') || lower.endsWith('.mjs') || lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'script';
  if (lower.endsWith('.pdf')) return 'pdf';
  return 'file';
}

const workspaceBrowserSkipDirs = new Set(['node_modules', '.git', 'dist', 'build', '.vite']);
const workspacePreviewExtensions = new Set(['.md', '.markdown', '.txt', '.json', '.py', '.mjs', '.js', '.ts', '.tsx', '.css', '.html', '.yml', '.yaml', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif']);
const workspaceTextExtensions = new Set(['.md', '.markdown', '.txt', '.json', '.py', '.mjs', '.js', '.ts', '.tsx', '.css', '.html', '.yml', '.yaml']);

function workspaceFileMimeKind(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (ext === '.txt') return 'text';
  if (ext === '.json') return 'json';
  if (['.py', '.mjs', '.js', '.ts', '.tsx', '.css', '.html', '.yml', '.yaml'].includes(ext)) return 'code';
  if (ext === '.pdf') return 'pdf';
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) return 'image';
  return 'binary';
}

async function listWorkspaceFiles(rootPath, relativeDir = '') {
  const root = path.resolve(rootPath);
  const targetDir = assertInsideWorkspace(root, path.join(root, relativeDir || ''));
  const info = await stat(targetDir).catch(() => null);
  if (!info?.isDirectory()) {
    const error = new Error('目标路径不是文件夹。');
    error.status = 400;
    throw error;
  }
  const entries = await readdir(targetDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && workspaceBrowserSkipDirs.has(entry.name)) continue;
    const full = assertInsideWorkspace(root, path.join(targetDir, entry.name));
    const fileStat = await stat(full).catch(() => null);
    if (!fileStat) continue;
    const ext = path.extname(entry.name).toLowerCase();
    files.push({
      name: entry.name,
      relativePath: path.relative(root, full),
      kind: entry.isDirectory() ? 'directory' : 'file',
      size: entry.isFile() ? fileStat.size : undefined,
      updatedAt: new Date(fileStat.mtimeMs).toISOString(),
      previewable: entry.isFile() && workspacePreviewExtensions.has(ext),
    });
  }
  return files.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  });
}

async function readWorkspaceFileContent(rootPath, relativeFilePath) {
  const root = path.resolve(rootPath);
  const target = assertInsideWorkspace(root, path.join(root, relativeFilePath || ''));
  const fileStat = await stat(target).catch(() => null);
  if (!fileStat?.isFile()) {
    const error = new Error('目标路径不是文件。');
    error.status = 400;
    throw error;
  }
  const mimeKind = workspaceFileMimeKind(target);
  const limit = 1024 * 1024;
  let content = '';
  let truncated = false;
  if (workspaceTextExtensions.has(path.extname(target).toLowerCase())) {
    const buffer = await readFile(target);
    truncated = buffer.length > limit;
    content = buffer.subarray(0, limit).toString('utf8');
  }
  return {
    name: path.basename(target),
    relativePath: path.relative(root, target),
    mimeKind,
    content,
    size: fileStat.size,
    updatedAt: new Date(fileStat.mtimeMs).toISOString(),
    truncated,
  };
}

async function collectWorkspaceArtifacts(rootPath, limit = 12) {
  const root = path.resolve(rootPath);
  if (!(await exists(root))) return [];
  const out = [];
  const allowed = new Set(['.md', '.json', '.py', '.mjs', '.js', '.ts', '.tsx', '.pdf', '.txt']);
  const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', '.vite']);
  async function walk(dir, depth = 0) {
    if (depth > 4 || out.length > 240) return;
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.space') continue;
      if (entry.isDirectory() && skipDirs.has(entry.name)) continue;
      const full = assertInsideWorkspace(root, path.join(dir, entry.name));
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile() && allowed.has(path.extname(entry.name).toLowerCase())) {
        const info = await stat(full).catch(() => null);
        if (!info) continue;
        out.push({
          name: entry.name,
          relativePath: path.relative(root, full),
          path: full,
          kind: artifactKind(entry.name),
          size: info.size,
          updatedAt: new Date(info.mtimeMs).toISOString(),
        });
      }
    }
  }
  await walk(root);
  return out
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, limit);
}

function assertInsideWorkspace(rootPath, targetPath) {
  return resolveInsideRoot(rootPath, targetPath);
}

async function ensureDirectory(targetPath) {
  const rawPath = String(targetPath || '').trim();
  if (!rawPath) {
    const error = new Error('文件夹路径不能为空。');
    error.status = 400;
    throw error;
  }
  const resolved = path.resolve(rawPath);
  await mkdir(resolved, { recursive: true });
  const info = await stat(resolved);
  if (!info.isDirectory()) {
    const error = new Error('目标路径不是文件夹。');
    error.status = 400;
    throw error;
  }
  return resolved;
}

async function ensureVaultForRoot(state, rootPath, name) {
  const resolved = path.resolve(rootPath);
  const existing = state.vaults.find((vault) => path.resolve(vault.path) === resolved);
  if (existing) return existing;
  const index = await buildVaultIndex(resolved);
  const vault = {
    id: id('vault'),
    name: String(name || vaultNameFromPath(resolved)).slice(0, 60),
    path: resolved,
    status: 'indexed',
    documentCount: index.documentCount,
    productCount: index.productCount,
    lastIndexedAt: now(),
    needsRefresh: false,
    index,
  };
  state.vaults.push(vault);
  return vault;
}

function summaryFromVault(vault) {
  if (!vault?.index) {
    return {
      vaultRoot: vault?.path || '',
      vaultExists: false,
      documentCount: 0,
      categories: {},
      products: [],
      highSignal: [],
      ruleDocs: [],
      sopDocs: [],
      status: vault?.status || 'none',
      needsRefresh: false,
    };
  }
  return {
    vaultRoot: vault.path,
    vaultExists: true,
    documentCount: vault.documentCount,
    categories: vault.index.categories,
    products: vault.index.products,
    highSignal: vault.index.highSignal,
    ruleDocs: vault.index.ruleDocs,
    sopDocs: vault.index.sopDocs,
    status: vault.status,
    lastIndexedAt: vault.lastIndexedAt,
    needsRefresh: Boolean(vault.needsRefresh),
  };
}

function assertSafeModuleName(name) {
  const clean = String(name || '').trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(clean)) {
    const error = new Error('模块名称不合法。');
    error.status = 400;
    throw error;
  }
  return clean;
}

async function resolveProfileTextFile(profileName, kind, moduleName = '') {
  const dir = await profileDirForName(profileName);
  if (!dir) {
    const error = new Error('未找到可编辑的 Hermes Profile。');
    error.status = 404;
    throw error;
  }
  const cleanKind = String(kind || '').trim();
  let target = '';
  if (cleanKind === 'notes') target = path.join(dir, 'memories', 'MEMORY.md');
  if (cleanKind === 'user') target = path.join(dir, 'memories', 'USER.md');
  if (cleanKind === 'soul') target = path.join(dir, 'SOUL.md');
  if (cleanKind === 'skill') {
    const cleanName = assertSafeModuleName(moduleName);
    target = path.join(dir, 'skills', cleanName, 'SKILL.md');
  }
  if (cleanKind === 'plugin') {
    const cleanName = assertSafeModuleName(moduleName);
    const profileYaml = path.join(dir, 'plugins', cleanName, 'plugin.yaml');
    const profileJson = path.join(dir, 'plugins', cleanName, 'plugin.json');
    const globalYaml = path.join(hermesHome, 'plugins', cleanName, 'plugin.yaml');
    const globalJson = path.join(hermesHome, 'plugins', cleanName, 'plugin.json');
    if (await exists(profileYaml)) target = profileYaml;
    else if (await exists(profileJson)) target = profileJson;
    else if (profileName === 'default' && await exists(globalYaml)) target = globalYaml;
    else if (profileName === 'default' && await exists(globalJson)) target = globalJson;
    else target = profileYaml;
  }
  if (!target) {
    const error = new Error('不支持的 Profile 文件类型。');
    error.status = 400;
    throw error;
  }
  const root = cleanKind === 'plugin' && isInside(hermesHome, target) ? hermesHome : dir;
  if (!isInside(root, target)) {
    const error = new Error('目标文件超出 Hermes Profile。');
    error.status = 403;
    throw error;
  }
  return { dir, target };
}

async function syncProfileAgent(profileName) {
  if (isSystemHermesProfile(profileName)) return { profile: null, agent: null };
  const profiles = await readHermesProfiles();
  const profile = profiles.find((item) => item.name === profileName);
  if (!profile) return { profile: null, agent: null };
  const state = await readState();
  const canonicalId = profile.name === 'default' ? 'hermes-default' : slug(profile.name);
  const index = state.agents.findIndex((agent) => agent.profileName === profile.name || agent.id === canonicalId || agent.id === slug(profile.name));
  if (index < 0) return { profile, agent: null };
  state.agents[index] = { ...state.agents[index], ...agentFromProfile(profile, state.agents[index]) };
  await writeState(state);
  return { profile, agent: state.agents[index] };
}

const userProfileBlockStart = '<!-- WORKBENCH_USER_PROFILE_START -->';
const userProfileBlockEnd = '<!-- WORKBENCH_USER_PROFILE_END -->';

function buildWorkbenchUserProfileBlock(userProfile, agent, defaultAgentId) {
  const isDefault = agent?.id === defaultAgentId;
  const address = isDefault ? userProfile.defaultAgentAddress : userProfile.otherAgentAddress;
  const rows = [
    '# Frakio Work User Profile',
    '',
    '这段资料由 Frakio Work 同步。用于让 Agent 快速理解用户，不要把它当成一次性任务记录。',
    '',
    `- 用户名/昵称：${userProfile.nickname || '未填写'}`,
    userProfile.bio ? `- 个人简介：${userProfile.bio}` : '',
    userProfile.age ? `- 年龄：${userProfile.age}` : '',
    userProfile.hobbies ? `- 爱好：${userProfile.hobbies}` : '',
    userProfile.occupation ? `- 职业信息：${userProfile.occupation}` : '',
    address ? `- 你对用户的默认称呼：${address}` : '',
    `- 当前默认 Agent：${isDefault ? '是' : '否'}`,
  ].filter(Boolean);
  return `${userProfileBlockStart}\n${rows.join('\n')}\n${userProfileBlockEnd}`;
}

function replaceWorkbenchUserProfileBlock(existing, block) {
  const text = String(existing || '');
  const pattern = new RegExp(`${userProfileBlockStart}[\\s\\S]*?${userProfileBlockEnd}\\n?`, 'm');
  const nextBlock = `${block}\n\n`;
  if (pattern.test(text)) return text.replace(pattern, nextBlock);
  return `${nextBlock}${text.replace(/^\s+/, '')}`;
}

async function syncUserProfileToHermesProfiles(state, userProfile) {
  const profiles = await readHermesProfiles();
  const agents = state.agents || [];
  const defaultAgentId = resolveDefaultAgentId(state, agents);
  for (const profile of profiles) {
    const agent = agents.find((item) => item.profileName === profile.name || (profile.name !== 'default' && item.id === slug(profile.name)) || (profile.name === 'default' && item.id === 'hermes-default'));
    const dir = await profileDirForName(profile.name);
    if (!dir || !isInside(hermesHome, dir)) continue;
    const target = path.join(dir, 'memories', 'USER.md');
    await mkdir(path.dirname(target), { recursive: true });
    const existing = await readFile(target, 'utf8').catch(() => '');
    const block = buildWorkbenchUserProfileBlock(userProfile, agent || { id: profile.name, name: profile.displayName || profile.name }, defaultAgentId);
    await writeFile(target, replaceWorkbenchUserProfileBlock(existing, block), 'utf8');
    await syncProfileAgent(profile.name);
  }
}

async function uniqueProfileName(name, reservedIds = []) {
  const base = slug(name) || 'agent';
  let candidate = base;
  let index = 2;
  const reserved = new Set(reservedIds);
  while (reserved.has(candidate) || await profileDirForName(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

const hermesReservedProfileNames = new Set(['hermes', 'default', 'test', 'tmp', 'root', 'sudo']);

function profileNameFromAgentName(name) {
  const clean = slug(name);
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(clean) || hermesReservedProfileNames.has(clean)) {
    const error = new Error(`「${String(name || '').trim() || clean}」不能作为 Hermes Profile 名称。请使用不与 Hermes 或系统命令冲突的英文字母、数字、连字符或下划线名称。`);
    error.status = 400;
    throw error;
  }
  return clean;
}

async function assertProfileNameAvailable(profileName, agentId = '') {
  const state = await readState();
  const occupiedByAgent = (state.agents || []).some((agent) => agent.id !== agentId && agent.profileName === profileName);
  if (occupiedByAgent || await profileDirForName(profileName)) {
    const error = new Error(`目标 Hermes Profile「${profileName}」已存在，请换一个名称。`);
    error.status = 409;
    throw error;
  }
}

function replaceProfileNameInState(state, oldName, nextName) {
  for (const agent of state.agents || []) {
    if (agent.profileName === oldName) agent.profileName = nextName;
  }
  for (const model of state.models || []) {
    if (model.profileName === oldName) model.profileName = nextName;
  }
  const autoStart = normalizeGatewayAutoStartConfig(state.integrations?.hermesAgent?.gatewayAutoStart);
  const replace = (items) => Array.from(new Set(items.map((item) => item === oldName ? nextName : item)));
  state.integrations.hermesAgent = {
    ...(state.integrations.hermesAgent || {}),
    gatewayAutoStart: { ...autoStart, include: replace(autoStart.include), exclude: replace(autoStart.exclude) },
    ...(state.integrations?.hermesAgent?.selectedProfile === oldName ? { selectedProfile: nextName } : {}),
    lastCheckedAt: now(),
  };
  if (state.integrations?.hermesStudio?.selectedProfile === oldName) {
    state.integrations.hermesStudio = { ...(state.integrations.hermesStudio || {}), selectedProfile: nextName };
  }
}

async function createHermesProfileFiles(profileName, payload) {
  const dir = path.join(hermesHome, 'profiles', profileName);
  if (!isInside(hermesHome, dir)) {
    const error = new Error('Profile 路径不合法。');
    error.status = 400;
    throw error;
  }
  await mkdir(path.join(dir, 'memories'), { recursive: true });
  await mkdir(path.join(dir, 'skills'), { recursive: true });
  const displayName = String(payload.name || titleCaseProfile(profileName)).trim();
  const model = String(payload.model || '').trim();
  const role = String(payload.role || '新 Agent').trim();
  const soul = String(payload.soul || `# SOUL.md — ${displayName}\n\n## 基础身份\n你叫 ${displayName}。\n\n## 角色定位\n${role}\n`).trim();
  const userProfile = String(payload.userProfile || '').trim();
  const memory = String(payload.memory || '').trim();
  const config = {
    providers: {},
    approvals: { mode: 'smart' },
    skills: { disabled: [] },
    plugins: { enabled: [], disabled: [] },
  };
  if (model) config.model = { provider: 'custom', default: model };
  await writeFile(path.join(dir, 'profile.yaml'), YAML.stringify({ name: displayName, display_name: displayName, role }), 'utf8');
  await writeFile(path.join(dir, 'config.yaml'), YAML.stringify(config), 'utf8');
  await writeFile(path.join(dir, 'SOUL.md'), `${soul}\n`, 'utf8');
  await writeFile(path.join(dir, 'memories', 'USER.md'), `${userProfile}\n`, 'utf8');
  await writeFile(path.join(dir, 'memories', 'MEMORY.md'), `${memory}\n`, 'utf8');
  return dir;
}

async function updateHermesProfileDefaultModel(profileName, modelValue, models = []) {
  const dir = await profileDirForName(profileName);
  if (!dir) return;
  if (!isInside(hermesHome, dir)) {
    const error = new Error('Profile 路径超出 Hermes Home。');
    error.status = 403;
    throw error;
  }
  const { selectedModel, selectedName } = resolveModelSelection(modelValue, models);
  if (!selectedModel) {
    const error = new Error('没有找到对应的模型配置。');
    error.status = 400;
    throw error;
  }
  return ensureModelProviderForProfile(profileName, selectedModel, selectedName, models, { setDefault: true });
}

function providerConfigStorageKey(providerKey) {
  return String(providerKey || '').replace(/^custom:/, '');
}

function runtimeProviderType(model) {
  if (model?.apiMode === 'anthropic_messages') return 'anthropic';
  if (model?.apiMode === 'bedrock_converse') return 'bedrock';
  return 'openai';
}

async function ensureModelProviderForProfile(profileName, rawModel, requestedModelName, models = [], options = {}) {
  const dir = await profileDirForName(profileName);
  if (!dir || !isInside(hermesHome, dir)) {
    const error = new Error(dir ? 'Profile 路径超出 Hermes Home。' : '未找到可编辑的 Hermes Profile。');
    error.status = dir ? 403 : 404;
    throw error;
  }
  const selectedModel = normalizeModels([rawModel])[0];
  const availableNames = normalizeModelNames(selectedModel.models, selectedModel.model);
  const modelName = availableNames.includes(String(requestedModelName || '').trim())
    ? String(requestedModelName).trim()
    : selectedModel.model || availableNames[0] || '';
  if (!selectedModel.providerKey || !modelName) {
    const error = new Error('模型缺少可用的 Provider 或模型 ID。');
    error.status = 400;
    throw error;
  }
  if (oauthProviderKeys.has(selectedModel.providerKey)) {
    await materializeOAuthCredentialForHermes(profileName, selectedModel.providerKey, selectedModel.oauthAccountId || '');
  }
  const configPath = path.join(dir, 'config.yaml');
  const config = await readYamlFile(configPath);
  const storageKey = providerConfigStorageKey(selectedModel.providerKey);
  const reusableApiKey = selectedModel.id ? await getReusableModelSecret(selectedModel, models) : '';
  const preset = !String(selectedModel.providerKey).startsWith('custom:') ? providerPresetByKey(selectedModel.providerKey) : null;
  const envMapping = providerEnvMap[selectedModel.providerKey] || {};
  if (preset && (Object.keys(envMapping).length || oauthProviderKeys.has(selectedModel.providerKey))) {
    const envPath = profileEnvPath(profileName);
    const currentEnv = await readEnvValues(envPath);
    const apiKey = reusableApiKey
      || (envMapping.apiKey ? String(currentEnv[envMapping.apiKey] || process.env[envMapping.apiKey] || '').trim() : '');
    const isLocalEndpoint = /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(selectedModel.baseUrl || preset.baseUrl || '');
    const requiresApiKey = Boolean(envMapping.apiKey) && !oauthProviderKeys.has(selectedModel.providerKey) && !isLocalEndpoint;
    if (requiresApiKey && !apiKey) {
      throw configValidationError(`${preset.label || selectedModel.name || providerLabel(selectedModel.providerKey)} 尚未配置 API Key。`);
    }
    const envUpdates = {};
    if (envMapping.apiKey && apiKey) envUpdates[envMapping.apiKey] = apiKey;
    if (envMapping.baseUrl && (selectedModel.baseUrl || preset.baseUrl)) envUpdates[envMapping.baseUrl] = selectedModel.baseUrl || preset.baseUrl;
    if (Object.keys(envUpdates).length) await writeEnvValues(envPath, envUpdates);
    if (options.setDefault) {
      const nextConfig = {
        ...config,
        model: {
          ...(isPlainRecord(config.model) ? config.model : {}),
          provider: selectedModel.providerKey,
          default: modelName,
        },
      };
      await mkdir(dir, { recursive: true });
      await writeFile(configPath, YAML.stringify(nextConfig), 'utf8');
    }
    return { profileName: profileName || 'default', configPath, provider: selectedModel.providerKey, model: modelName, hasApiKey: Boolean(apiKey), runtimeRevision: selectedModel.runtimeRevision };
  }
  const existingProvider = isPlainRecord(config.providers?.[storageKey]) ? config.providers[storageKey] : {};
  const providerConfig = selectedModel.baseUrl
    ? {
        ...existingProvider,
        provider: runtimeProviderType(selectedModel),
        name: selectedModel.name || selectedModel.provider || storageKey,
        base_url: selectedModel.baseUrl,
        ...(reusableApiKey ? { api_key: reusableApiKey } : {}),
        model: modelName,
        api_mode: runtimeApiMode(selectedModel.modelApiModes?.[modelName] || selectedModel.apiMode) || 'chat_completions',
      }
    : existingProvider;
  const nextConfig = {
    ...config,
    providers: selectedModel.baseUrl ? { ...(config.providers || {}), [storageKey]: providerConfig } : (config.providers || {}),
  };
  if (options.setDefault) {
    nextConfig.model = {
      ...(isPlainRecord(config.model) ? config.model : {}),
      provider: selectedModel.providerKey,
      default: modelName,
    };
  }
  await mkdir(dir, { recursive: true });
  await writeFile(configPath, YAML.stringify(nextConfig), 'utf8');
  return { profileName: profileName || 'default', configPath, provider: selectedModel.providerKey, model: modelName, hasApiKey: Boolean(reusableApiKey || existingProvider.api_key || existingProvider.apiKey), runtimeRevision: selectedModel.runtimeRevision };
}

async function runModelScopeMigration() {
  const migrationRoot = path.join(frakioWorkHome, 'backups', 'model-scope-migration');
  const markerPath = path.join(migrationRoot, 'v1-complete.json');
  if (await exists(markerPath)) return;
  const raw = JSON.parse(await readFile(statePath, 'utf8').catch(() => 'null'));
  if (!raw || !Array.isArray(raw.models)) return;
  const normalizedModels = normalizeModels(raw.models);
  const rawById = new Map(raw.models.map((model) => [model.id, model]));
  const stateUpdates = normalizedModels.filter((model) => String(rawById.get(model.id)?.providerKey || '') !== model.providerKey);
  const profilePlans = [];
  const profiles = await readHermesProfiles();
  for (const profile of profiles) {
    const candidates = normalizedModels.filter((model) => normalizeModelNames(model.models, model.model).includes(profile.model));
    if (candidates.length !== 1) continue;
    const selectedModel = candidates[0];
    if (!selectedModel.providerKey) continue;
    const dir = await profileDirForName(profile.name);
    if (!dir) continue;
    const configPath = path.join(dir, 'config.yaml');
    const config = await readYamlFile(configPath);
    const currentProvider = String(config?.model?.provider || config?.provider || '').trim();
    const currentConfig = selectedProviderConfig(config, currentProvider);
    const providerMismatch = currentProvider !== selectedModel.providerKey;
    const endpointMismatch = selectedModel.baseUrl && comparableBaseUrl(currentConfig?.base_url || currentConfig?.baseUrl) !== comparableBaseUrl(selectedModel.baseUrl);
    if (providerMismatch || endpointMismatch) profilePlans.push({ profileName: profile.name, configPath, model: selectedModel, modelName: profile.model, fromProvider: currentProvider });
  }
  const backupNeeded = stateUpdates.length || profilePlans.length;
  const backupDir = path.join(migrationRoot, new Date().toISOString().replace(/[:.]/g, '-'));
  if (backupNeeded) {
    await mkdir(backupDir, { recursive: true });
    await cp(statePath, path.join(backupDir, 'workbench-state.json'));
    for (const plan of profilePlans) {
      const target = path.join(backupDir, 'profiles', plan.profileName, 'config.yaml');
      await mkdir(path.dirname(target), { recursive: true });
      await cp(plan.configPath, target);
    }
  }
  if (stateUpdates.length) {
    const nextModels = raw.models.map((model) => {
      const normalized = normalizedModels.find((item) => item.id === model.id);
      return normalized?.providerKey ? { ...model, providerKey: normalized.providerKey } : model;
    });
    await writeFile(statePath, `${JSON.stringify({ ...raw, models: nextModels }, null, 2)}\n`, 'utf8');
  }
  for (const plan of profilePlans) {
    await ensureModelProviderForProfile(plan.profileName, plan.model, plan.modelName, normalizedModels, { setDefault: true });
  }
  await mkdir(migrationRoot, { recursive: true });
  await writeFile(markerPath, `${JSON.stringify({
    version: 1,
    completedAt: now(),
    backupDir: backupNeeded ? backupDir : '',
    modelProviderKeys: stateUpdates.map((model) => ({ modelId: model.id, providerKey: model.providerKey })),
    profiles: profilePlans.map((plan) => ({ profileName: plan.profileName, fromProvider: plan.fromProvider, toProvider: plan.model.providerKey, model: plan.modelName })),
  }, null, 2)}\n`, 'utf8');
}

async function runPresetProviderCredentialMigration() {
  const migrationRoot = path.join(frakioWorkHome, 'backups', 'model-scope-migration');
  const markerPath = path.join(migrationRoot, 'v2-preset-credentials-complete.json');
  if (await exists(markerPath)) return;
  const raw = JSON.parse(await readFile(statePath, 'utf8').catch(() => 'null'));
  if (!raw || !Array.isArray(raw.models)) return;
  const normalizedModels = normalizeModels(raw.models);
  const profiles = await readHermesProfiles();
  const plans = [];
  const skipped = [];
  for (const profile of profiles) {
    const dir = await profileDirForName(profile.name);
    if (!dir) continue;
    const configPath = path.join(dir, 'config.yaml');
    const config = await readYamlFile(configPath);
    const providerKey = String(config?.model?.provider || config?.provider || '').trim();
    if (!providerKey || providerKey.startsWith('custom:') || !providerPresetByKey(providerKey)) continue;
    const candidates = normalizedModels.filter((model) => model.providerKey === providerKey && normalizeModelNames(model.models, model.model).includes(profile.model));
    if (candidates.length !== 1) {
      skipped.push({ profileName: profile.name, provider: providerKey, reason: candidates.length ? 'ambiguous_model' : 'model_not_found' });
      continue;
    }
    const model = candidates[0];
    const envMapping = providerEnvMap[providerKey] || {};
    const apiKey = await getReusableModelSecret(model, normalizedModels);
    const currentEnv = await readEnvValues(profileEnvPath(profile.name));
    const hasExistingKey = Boolean(envMapping.apiKey && String(currentEnv[envMapping.apiKey] || '').trim());
    if (envMapping.apiKey && !apiKey && !hasExistingKey) {
      skipped.push({ profileName: profile.name, provider: providerKey, reason: 'missing_api_key' });
      continue;
    }
    const expectedBaseUrl = model.baseUrl || providerPresetByKey(providerKey)?.baseUrl || '';
    const baseUrlMatches = !envMapping.baseUrl || !expectedBaseUrl || comparableBaseUrl(currentEnv[envMapping.baseUrl]) === comparableBaseUrl(expectedBaseUrl);
    const keyMatches = !envMapping.apiKey || !apiKey || String(currentEnv[envMapping.apiKey] || '').trim() === apiKey;
    if (baseUrlMatches && keyMatches) continue;
    plans.push({ profileName: profile.name, configPath, envPath: profileEnvPath(profile.name), provider: providerKey, model, modelName: profile.model });
  }
  const backupDir = path.join(migrationRoot, new Date().toISOString().replace(/[:.]/g, '-'), 'preset-provider-credentials');
  if (plans.length) {
    for (const plan of plans) {
      const targetDir = path.join(backupDir, 'profiles', plan.profileName);
      await mkdir(targetDir, { recursive: true });
      await cp(plan.configPath, path.join(targetDir, 'config.yaml'));
      if (await exists(plan.envPath)) await cp(plan.envPath, path.join(targetDir, '.env'));
      await ensureModelProviderForProfile(plan.profileName, plan.model, plan.modelName, normalizedModels, { setDefault: false });
    }
  }
  await mkdir(migrationRoot, { recursive: true });
  await writeFile(markerPath, `${JSON.stringify({
    version: 2,
    completedAt: now(),
    backupDir: plans.length ? backupDir : '',
    profiles: plans.map((plan) => ({ profileName: plan.profileName, provider: plan.provider, model: plan.modelName, hasApiKey: true })),
    skipped,
  }, null, 2)}\n`, 'utf8');
}

function matchesLegacyFields(value, legacy, keys) {
  if (!value || !legacy) return false;
  return keys.every((key) => JSON.stringify(value[key] ?? null) === JSON.stringify(legacy[key] ?? null));
}

function isUntouchedLegacyAgent(agent) {
  const legacy = legacyDemoAgents.find((item) => item.id === agent?.id);
  if (!legacy || !matchesLegacyFields(agent, legacy, ['id', 'name', 'role', 'model', 'color', 'soul', 'scope', 'source'])) return false;
  return !String(agent.profileName || '').trim()
    && !String(agent.userProfile || '').trim()
    && !String(agent.memory || '').trim()
    && !String(agent.avatarUrl || '').trim()
    && !(agent.skills || []).length
    && !(agent.plugins || []).length;
}

function isUntouchedLegacyModel(model) {
  const legacy = legacyDefaultModels.find((item) => item.id === model?.id);
  return Boolean(legacy && matchesLegacyFields(model, legacy, ['id', 'name', 'provider', 'kind', 'protocol', 'model', 'models', 'baseUrl', 'source', 'pricing']));
}

function isUntouchedLegacyWelcomeThread(thread) {
  if (thread?.id !== 'thread_default' || thread?.title !== '欢迎使用 Frakio Work') return false;
  if (JSON.stringify(thread.messages || []) !== JSON.stringify(legacyWelcomeMessages)) return false;
  return thread.workspaceId === 'workspace_default'
    && thread.mode === 'workspace'
    && thread.primaryAgentId === 'iris'
    && thread.defaultAgentId === 'iris'
    && JSON.stringify(thread.selectedAgents || []) === JSON.stringify(['iris', 'max']);
}

function isUntouchedLegacyVault(vault) {
  return vault?.id === 'vault_creative_ai_team'
    && vault?.name === '示例知识库'
    && vault?.status === 'not_indexed'
    && Number(vault?.documentCount || 0) === 0
    && Number(vault?.productCount || 0) === 0
    && !vault?.lastIndexedAt
    && !vault?.index;
}

function modelIsReferenced(state, model, remainingAgents, remainingThreads, secrets) {
  const names = new Set([model.id, model.name, model.model].filter(Boolean));
  if (remainingAgents.some((agent) => names.has(agent.model))) return true;
  if (remainingThreads.some((thread) => Object.values(thread.agentModelOverrides || {}).some((value) => names.has(String(value || '').split('::')[0]) || names.has(String(value || '').split('::')[1])))) return true;
  if (String(secrets.models?.[model.id]?.apiKey || '').trim()) return true;
  return (state.observability?.modelUsage || []).some((usage) => names.has(usage?.modelId) || names.has(usage?.model) || names.has(usage?.modelName));
}

async function runLegacyDemoDataCleanupMigration() {
  const migrationRoot = path.join(frakioWorkHome, 'backups', 'demo-data-cleanup');
  const markerPath = path.join(migrationRoot, 'v1-complete.json');
  if (await exists(markerPath)) return;
  const raw = JSON.parse(await readFile(statePath, 'utf8').catch(() => 'null'));
  if (!raw) return;
  const secrets = await readSecrets();
  const removedAgents = (raw.agents || []).filter(isUntouchedLegacyAgent);
  const remainingAgents = (raw.agents || []).filter((agent) => !removedAgents.includes(agent));
  const removedThreads = (raw.threads || []).filter(isUntouchedLegacyWelcomeThread);
  const remainingThreads = (raw.threads || []).filter((thread) => !removedThreads.includes(thread));
  const removedVaults = (raw.vaults || []).filter((vault) => isUntouchedLegacyVault(vault) && !remainingThreads.some((thread) => thread.vaultId === vault.id));
  const remainingVaults = (raw.vaults || []).filter((vault) => !removedVaults.includes(vault));
  const removedModels = (raw.models || []).filter((model) => isUntouchedLegacyModel(model) && !modelIsReferenced(raw, model, remainingAgents, remainingThreads, secrets));
  const remainingModels = (raw.models || []).filter((model) => !removedModels.includes(model));
  const removedAgentIds = new Set(removedAgents.map((agent) => agent.id));
  const removedThreadIds = new Set(removedThreads.map((thread) => thread.id));
  const removedVaultIds = new Set(removedVaults.map((vault) => vault.id));
  const removedModelIds = new Set(removedModels.map((model) => model.id));
  const next = {
    ...raw,
    agents: remainingAgents,
    models: remainingModels,
    threads: remainingThreads,
    vaults: remainingVaults,
    defaultVaultId: removedVaultIds.has(raw.defaultVaultId) ? null : raw.defaultVaultId || null,
    ui: {
      ...(raw.ui || {}),
      defaultAgentId: removedAgentIds.has(raw.ui?.defaultAgentId) ? '' : raw.ui?.defaultAgentId || '',
      defaultModel: removedModelIds.has(raw.ui?.defaultModel) ? '' : raw.ui?.defaultModel || '',
    },
    workspaces: (raw.workspaces || []).map((workspace) => ({
      ...workspace,
      activeThreadId: removedThreadIds.has(workspace.activeThreadId) ? null : workspace.activeThreadId || null,
      vaultId: removedVaultIds.has(workspace.vaultId) ? null : workspace.vaultId || null,
    })),
  };
  const changed = removedAgents.length || removedModels.length || removedThreads.length || removedVaults.length;
  let backupPath = '';
  if (changed) {
    await mkdir(migrationRoot, { recursive: true });
    backupPath = path.join(migrationRoot, `workbench-state-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await cp(statePath, backupPath);
    await writeFile(statePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  }
  await mkdir(migrationRoot, { recursive: true });
  await writeFile(markerPath, `${JSON.stringify({
    version: 1,
    completedAt: now(),
    backupPath,
    removedAgentIds: [...removedAgentIds],
    removedModelIds: [...removedModelIds],
    removedThreadIds: [...removedThreadIds],
    removedVaultIds: [...removedVaultIds],
  }, null, 2)}\n`, 'utf8');
}

async function updateHermesProfileSkillState(profileName, skillName, enabled) {
  const dir = await profileDirForName(profileName);
  if (!dir) {
    const error = new Error('未找到可编辑的 Hermes Profile。');
    error.status = 404;
    throw error;
  }
  if (!isInside(hermesHome, dir)) {
    const error = new Error('Profile 路径超出 Hermes Home。');
    error.status = 403;
    throw error;
  }
  const cleanName = assertSafeModuleName(skillName);
  const configPath = path.join(dir, 'config.yaml');
  const config = await readYamlFile(configPath);
  const disabled = disabledSkillsFromConfig(config);
  if (enabled) disabled.delete(cleanName);
  else disabled.add(cleanName);
  const nextConfig = {
    ...config,
    skills: {
      ...(typeof config.skills === 'object' && config.skills ? config.skills : {}),
      disabled: Array.from(disabled).sort(),
    },
  };
  await writeFile(configPath, YAML.stringify(nextConfig), 'utf8');
  return { profileName, skillName: cleanName, enabled };
}

app.get('/api/hermes-profiles/:profileName/avatar', async (req, res) => {
  const dir = await profileDirForName(req.params.profileName);
  if (!dir) return res.status(404).send('Profile not found');
  const assetsDir = path.join(dir, 'assets');
  try {
    const entries = await readdir(assetsDir, { withFileTypes: true });
    const avatar = entries.find((entry) => entry.isFile() && /^avatar\.(png|jpe?g|webp|gif)$/i.test(entry.name));
    if (!avatar) return res.status(404).send('Avatar not found');
    const avatarPath = path.join(assetsDir, avatar.name);
    const ext = path.extname(avatar.name).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
    res.type(contentType).send(await readFile(avatarPath));
  } catch {
    res.status(404).send('Avatar not found');
  }
});

app.get('/api/user-profile/avatar', async (_req, res) => {
  try {
    const assetsDir = path.join(hermesWorkbenchRuntimeHome, 'assets');
    const entries = await readdir(assetsDir, { withFileTypes: true }).catch(() => []);
    const avatar = entries.find((entry) => entry.isFile() && /^user-avatar\.(png|jpe?g|webp|gif)$/i.test(entry.name));
    if (!avatar) return res.status(404).send('Avatar not found');
    const avatarPath = path.join(assetsDir, avatar.name);
    const ext = path.extname(avatar.name).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
    res.type(contentType).send(await readFile(avatarPath));
  } catch {
    res.status(404).send('Avatar not found');
  }
});

app.get('/api/user-profile', async (_req, res) => {
  const state = await readState();
  res.json({ userProfile: state.userProfile || normalizeUserProfile() });
});

app.post('/api/user-profile/avatar', async (req, res) => {
  try {
    const mime = String(req.body?.mimeType || '');
    const data = String(req.body?.data || '');
    const match = data.match(/^data:([^;]+);base64,(.+)$/);
    const rawBase64 = match ? match[2] : data;
    const detectedMime = match ? match[1] : mime;
    const supported = /image\/(png|webp|gif|jpeg|jpg)/i.test(detectedMime);
    if (!supported) return res.status(400).json({ error: '仅支持 png、jpg、webp、gif 头像。' });
    const buffer = Buffer.from(rawBase64, 'base64');
    if (!buffer.length || buffer.length > 3 * 1024 * 1024) return res.status(400).json({ error: '头像大小需小于 3MB。' });
    const assetsDir = path.join(hermesWorkbenchRuntimeHome, 'assets');
    await mkdir(assetsDir, { recursive: true });
    const existing = await readdir(assetsDir, { withFileTypes: true }).catch(() => []);
    await Promise.all(existing.filter((entry) => entry.isFile() && /^user-avatar\.(png|jpe?g|webp|gif)$/i.test(entry.name)).map((entry) => unlink(path.join(assetsDir, entry.name)).catch(() => null)));
    const avatarPath = path.join(assetsDir, 'user-avatar.png');
    if (!isInside(assetsDir, avatarPath)) return res.status(403).json({ error: '头像路径不合法。' });
    await writeFile(avatarPath, buffer);
    const fileStat = await stat(avatarPath);
    res.json({ avatarUrl: `/api/user-profile/avatar?v=${Math.round(fileStat.mtimeMs)}` });
  } catch (error) {
    res.status(500).json({ error: error.message || '头像保存失败。' });
  }
});

app.put('/api/user-profile', async (req, res) => {
  try {
    const state = await readState();
    const previous = state.userProfile || {};
    const next = normalizeUserProfile({ ...previous, ...(req.body?.userProfile || req.body || {}), updatedAt: now() });
    if (next.avatarUrl && next.nickname) next.completedAt = next.completedAt || now();
    state.userProfile = next;
    await writeState(state);
    await syncUserProfileToHermesProfiles(state, next);
    const refreshed = await readState();
    res.json({ userProfile: refreshed.userProfile, agents: refreshed.agents });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '用户资料保存失败。' });
  }
});

app.post('/api/hermes-profiles/:profileName/avatar', async (req, res) => {
  try {
    const dir = await profileDirForName(req.params.profileName);
    if (!dir) return res.status(404).json({ error: '未找到可编辑的 Hermes Profile。' });
    const mimeType = String(req.body?.mimeType || '').toLowerCase();
    if (!/image\/(png|webp|gif|jpeg|jpg)/i.test(mimeType)) return res.status(400).json({ error: '只支持 PNG、JPG、WEBP、GIF 头像。' });
    const rawData = String(req.body?.data || '').replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
    const buffer = Buffer.from(rawData, 'base64');
    if (!buffer.length || buffer.length > 5 * 1024 * 1024) return res.status(400).json({ error: '头像文件为空或超过 5MB。' });
    const assetsDir = path.join(dir, 'assets');
    await mkdir(assetsDir, { recursive: true });
    const entries = await readdir(assetsDir, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries
      .filter((entry) => entry.isFile() && /^avatar\.(png|jpe?g|webp|gif)$/i.test(entry.name))
      .map((entry) => rm(path.join(assetsDir, entry.name), { force: true })));
    const avatarPath = path.join(assetsDir, 'avatar.png');
    if (!isInside(dir, avatarPath)) return res.status(403).json({ error: '头像路径超出 Hermes Profile。' });
    await writeFile(avatarPath, buffer);
    const synced = await syncProfileAgent(req.params.profileName);
    res.json({ avatarUrl: await findProfileAvatar(dir, req.params.profileName), agent: synced.agent, profile: synced.profile });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '头像保存失败。' });
  }
});

app.get('/api/hermes-profiles/:profileName/file', async (req, res) => {
  try {
    const { target } = await resolveProfileTextFile(req.params.profileName, req.query.kind, req.query.name);
    const content = await readFile(target, 'utf8').catch(() => '');
    res.json({ content, file: target });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '读取 Profile 文件失败。' });
  }
});

app.put('/api/hermes-profiles/:profileName/file', async (req, res) => {
  try {
    const moduleKind = String(req.body?.kind || '').trim();
    const { target } = await resolveProfileTextFile(req.params.profileName, moduleKind, req.body?.name);
    const content = String(req.body?.content || '').slice(0, 250000);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
    const synced = await syncProfileAgent(req.params.profileName);
    if (moduleKind === 'skill' || moduleKind === 'plugin') {
      captureTelemetry('feature_used', { feature: moduleKind === 'skill' ? 'skill_synced' : 'plugin_synced', outcome: 'completed' });
      captureMeaningfulActivity('feature_used');
    }
    res.json({ ok: true, file: target, agent: synced.agent, profile: synced.profile });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '保存 Profile 文件失败。' });
  }
});

app.put('/api/hermes-profiles/:profileName/skill-state', async (req, res) => {
  try {
    const result = await updateHermesProfileSkillState(req.params.profileName, req.body?.name, Boolean(req.body?.enabled));
    const synced = await syncProfileAgent(req.params.profileName);
    captureTelemetry('feature_used', { feature: 'skill_synced', outcome: 'completed' });
    captureMeaningfulActivity('feature_used');
    res.json({ ok: true, ...result, agent: synced.agent, profile: synced.profile });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '技能状态保存失败。' });
  }
});

app.get('/api/hermes-modules', async (req, res) => {
  try {
    res.json(await readManagedHermesModules(req.query.kind));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '模块读取失败。', ...(error.code ? { code: error.code } : {}), ...(error.details ? { details: error.details } : {}) });
  }
});

app.get('/api/hermes-modules/file', async (req, res) => {
  try {
    const moduleEntry = await resolveManagedModuleFile(req.query.kind, req.query.scope, req.query.name, req.query.profileName);
    res.json({
      content: await readFile(moduleEntry.manifestPath, 'utf8').catch(() => ''),
      file: moduleEntry.file,
      name: moduleEntry.name,
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '模块文件读取失败。', ...(error.code ? { code: error.code } : {}) });
  }
});

app.put('/api/hermes-modules/file', async (req, res) => {
  try {
    const result = await runHermesModuleMutation(async () => {
      const cleanKind = managedModuleKind(req.body?.kind);
      const moduleEntry = await resolveManagedModuleFile(cleanKind, req.body?.scope, req.body?.name, req.body?.profileName);
      const content = String(req.body?.content || '').slice(0, 250000);
      await writeFile(moduleEntry.manifestPath, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
      const reloads = cleanKind === 'skill'
        ? await reloadManagedSkills(req.body?.scope === 'global'
          ? (await managedModuleOwnerRows()).map((owner) => owner.name)
          : [slug(req.body?.profileName || '')])
        : [];
      const restartRequiredProfiles = cleanKind === 'plugin'
        ? await runningManagedProfiles(req.body?.scope === 'global'
          ? await managedModuleOwnerRows()
          : (await managedModuleOwnerRows()).filter((owner) => owner.name === slug(req.body?.profileName || '')))
        : [];
      return { modules: await readManagedHermesModules(cleanKind), reloads, restartRequiredProfiles };
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '模块文件保存失败。', ...(error.code ? { code: error.code } : {}), ...(error.details ? { details: error.details } : {}) });
  }
});

app.put('/api/hermes-modules/state', async (req, res) => {
  try {
    const result = await runHermesModuleMutation(() => updateManagedModuleState(req.body?.kind, req.body?.name, req.body?.profileName, Boolean(req.body?.enabled)));
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '模块状态保存失败。', ...(error.code ? { code: error.code } : {}), ...(error.details ? { details: error.details } : {}) });
  }
});

app.post('/api/hermes-modules/scope', async (req, res) => {
  try {
    const action = String(req.body?.action || '').trim();
    if (!['promote', 'demote'].includes(action)) return res.status(400).json({ error: '范围操作必须是 promote 或 demote。' });
    const result = await runHermesModuleMutation(() => action === 'promote'
      ? promoteManagedModule(req.body?.kind, req.body?.name, req.body?.profileName)
      : demoteManagedModule(req.body?.kind, req.body?.name, req.body?.targetProfileName));
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '模块范围保存失败。', ...(error.code ? { code: error.code } : {}), ...(error.details ? { details: error.details } : {}) });
  }
});

app.delete('/api/hermes-modules', async (req, res) => {
  try {
    const result = await runHermesModuleMutation(() => deleteManagedModule(req.body?.kind, req.body?.name, req.body?.scope, req.body?.profileName));
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '模块删除失败。', ...(error.code ? { code: error.code } : {}), ...(error.details ? { details: error.details } : {}) });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'frakio-work-api',
    port,
    deploymentMode: isManagedWebMode ? 'managed-web' : isDesktopMode ? 'desktop' : 'source',
    apiProtocol: FRAKIO_SERVICE_PROTOCOL,
  });
});

app.get('/api/hermes-local/status', async (_req, res) => {
  const discovery = await discoverHermesStudio();
  const state = await readState();
  state.integrations.hermesStudio = {
    ...state.integrations.hermesStudio,
    detectedUrl: discovery.studio.url || state.integrations.hermesStudio.detectedUrl || '',
    lastCheckedAt: discovery.checkedAt,
    authMode: discovery.studio.authMode,
  };
  await writeState(state);
  res.json(discovery);
});

app.get('/api/hermes/network-status', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const profileDir = await profileDirForName(profile);
    if (!profileDir) return res.status(404).json({ error: `Hermes Profile「${profile}」不存在。` });
    const status = await requestHermesBridge(
      { action: 'network_status', profile },
      { timeoutMs: 15000, retryMs: 1000 },
    );
    res.json({
      profile: String(status.profile || profile),
      onlineReadReady: Boolean(status.online_read_ready),
      search: {
        enabled: Boolean(status.search?.enabled),
        ready: Boolean(status.search?.ready),
        provider: status.search?.provider || null,
        source: status.search?.source || 'unconfigured',
        detail: status.search?.detail || 'provider_probe_failed',
      },
      extract: {
        enabled: Boolean(status.extract?.enabled),
        ready: Boolean(status.extract?.ready),
        provider: status.extract?.provider || null,
        detail: status.extract?.detail || 'provider_probe_failed',
      },
      browser: {
        enabled: Boolean(status.browser?.enabled),
        ready: Boolean(status.browser?.ready),
        chromiumReady: Boolean(status.browser?.chromium_ready),
        detail: status.browser?.detail || 'browser_cli_missing',
      },
      checkedAt: status.checked_at || now(),
    });
  } catch (error) {
    res.status(error.status || 503).json({
      error: error.message || 'Hermes 联网能力检测失败。',
      code: 'hermes_network_status_unavailable',
    });
  }
});

app.post('/api/hermes-local/import', async (req, res) => {
  const discovery = await discoverHermesStudio();
  const requested = Array.isArray(req.body?.profiles) && req.body.profiles.length ? new Set(req.body.profiles.map(String)) : null;
  const profiles = userVisibleHermesProfiles(discovery.profiles).filter((profile) => !requested || requested.has(profile.name));
  const state = await readState();
  const importedProfileNames = new Set((state.integrations.hermesStudio.importedProfileNames || []).filter((name) => !isSystemHermesProfile(name)));
  state.models = normalizeModels(state.models).filter((model) => !isBadHermesStudioModel(model) && model.source !== 'hermes-profile');

  for (const profile of profiles) {
    await ensureManagedGlobalModulesForProfile(profile.name);
    const canonicalAgentId = profile.name === 'default' ? 'hermes-default' : slug(profile.name);
    const existingAgent = state.agents.find((agent) => agent.profileName === profile.name || agent.id === canonicalAgentId || agent.id === slug(profile.name));
    const nextAgent = agentFromProfile(profile, existingAgent);
    const existingAgentIndex = state.agents.findIndex((agent) => agent.id === nextAgent.id);
    if (existingAgentIndex >= 0) state.agents[existingAgentIndex] = { ...state.agents[existingAgentIndex], ...nextAgent };
    else state.agents.push(nextAgent);
    importedProfileNames.add(profile.name);
  }

  state.integrations.hermesStudio = {
    ...state.integrations.hermesStudio,
    detectedUrl: discovery.studio.url,
    lastCheckedAt: discovery.checkedAt,
    selectedProfile: req.body?.selectedProfile || state.integrations.hermesStudio.selectedProfile || profiles[0]?.name || 'default',
    importedProfileNames: Array.from(importedProfileNames).sort(),
    authMode: discovery.studio.authMode,
  };
  await writeState(state);
  res.json({
    importedProfiles: profiles.map((profile) => profile.name),
    agents: state.agents,
    hermesStudio: state.integrations.hermesStudio,
    discovery,
  });
});

async function commandExists(command) {
  return Boolean(await resolveCommand(command));
}

async function resolveCommand(command) {
  try {
    return await resolveRuntimeCommand(command);
  } catch {
    return '';
  }
}

async function runLoggedCommand(command, args, options = {}, logs = []) {
  logs.push(`$ ${[command, ...args].join(' ')}`);
  if (Object.prototype.hasOwnProperty.call(options, 'input')) {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: runtimeEnv(options.env || {}),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        stderr += `\nCommand timed out after ${options.timeout || 120000}ms.`;
      }, options.timeout || 120000);
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        logs.push(String(error?.message || error));
        resolve(false);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (stdout.trim()) logs.push(stdout.trim());
        if (stderr.trim()) logs.push(stderr.trim());
        resolve(code === 0);
      });
      child.stdin.end(options.input || '');
    });
  }
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: options.timeout || 120000,
      maxBuffer: 1024 * 1024,
      cwd: options.cwd,
      env: runtimeEnv(options.env || {}),
    });
    if (stdout.trim()) logs.push(stdout.trim());
    if (stderr.trim()) logs.push(stderr.trim());
    return true;
  } catch (error) {
    logs.push(String(error?.stderr || error?.message || error));
    return false;
  }
}

function tailInstallLogs(logs, maxLines = 80) {
  return logs.slice(Math.max(0, logs.length - maxLines));
}

async function commandOutput(command, args, options = {}) {
  const { stdout } = await execFileAsync(command, args, {
    timeout: options.timeout || 120000,
    maxBuffer: options.maxBuffer || 1024 * 1024,
    cwd: options.cwd,
    env: runtimeEnv(options.env || {}),
  });
  return String(stdout || '').trim();
}

async function gitOutput(repoPath, args, options = {}) {
  return commandOutput('git', ['-C', repoPath, ...args], options);
}

async function gitCommand(repoPath, args, options = {}, logs = []) {
  return runLoggedCommand('git', ['-C', repoPath, ...args], options, logs);
}

async function readFrakioPackageVersion() {
  return resolveAppVersion({
    envVersion: process.env.FRAKIO_WORK_APP_VERSION,
    packagePath: path.join(projectRoot, 'package.json'),
    readFileImpl: readFile,
  });
}

async function readHermesAgentPackageInfo(repoPath = hermesAgentSourcePath) {
  const pyprojectPath = path.join(repoPath, 'pyproject.toml');
  const initPath = path.join(repoPath, 'hermes_cli', '__init__.py');
  const info = { version: '', releaseDate: '' };
  try {
    const raw = await readFile(pyprojectPath, 'utf8');
    info.version = raw.match(/^version\s*=\s*"([^"]+)"/m)?.[1] || '';
  } catch {}
  try {
    const raw = await readFile(initPath, 'utf8');
    info.version = info.version || raw.match(/__version__\s*=\s*"([^"]+)"/)?.[1] || '';
    info.releaseDate = raw.match(/__release_date__\s*=\s*"([^"]+)"/)?.[1] || '';
  } catch {}
  return info;
}

function versionLabel(info = {}) {
  if (!info.version) return '';
  return `v${info.version}${info.releaseDate ? ` (${info.releaseDate})` : ''}`;
}

async function latestHermesReleaseInfo(repoPath = hermesAgentSourcePath) {
  const info = { tag: '', version: '', releaseDate: '', label: '', url: '', commit: '' };
  try {
    const raw = await commandOutput('git', ['ls-remote', '--tags', '--sort=-version:refname', officialHermesAgentRepo], { timeout: 20000, maxBuffer: 1024 * 1024 });
    const latest = parseOfficialHermesReleaseTags(raw, { limit: 1 })[0];
    if (latest) {
      info.tag = latest.tag;
      info.commit = latest.commit;
    }
  } catch {}
  if (info.tag) {
    info.releaseDate = info.tag.replace(/^v/, '');
    info.url = `https://github.com/NousResearch/hermes-agent/releases/tag/${info.tag}`;
  }
  try {
    if (info.tag) {
      const response = await fetch(`https://raw.githubusercontent.com/NousResearch/hermes-agent/${encodeURIComponent(info.tag)}/pyproject.toml`, { signal: AbortSignal.timeout(15000) });
      if (response.ok) {
        const remotePyproject = await response.text();
        info.version = remotePyproject.match(/^version\s*=\s*"([^"]+)"/m)?.[1] || '';
      }
    }
  } catch {}
  info.label = info.version ? `v${info.version}${info.releaseDate ? ` (${info.releaseDate})` : ''}` : info.tag;
  return info;
}

let officialHermesReleaseCache = { checkedAt: 0, value: null };
let officialHermesReleasesCache = { checkedAt: 0, value: [] };

async function cachedOfficialHermesRelease({ force = false } = {}) {
  if (!force && officialHermesReleaseCache.value && Date.now() - officialHermesReleaseCache.checkedAt < 5 * 60 * 1000) {
    return officialHermesReleaseCache.value;
  }
  const value = await latestHermesReleaseInfo();
  officialHermesReleaseCache = { checkedAt: Date.now(), value };
  return value;
}

async function officialHermesReleases({ force = false, limit = 20 } = {}) {
  if (!force && officialHermesReleasesCache.value.length && Date.now() - officialHermesReleasesCache.checkedAt < 5 * 60 * 1000) {
    return officialHermesReleasesCache.value.slice(0, limit);
  }
  const raw = await commandOutput('git', ['ls-remote', '--tags', '--sort=-version:refname', officialHermesAgentRepo], {
    timeout: 20000,
    maxBuffer: 1024 * 1024,
  });
  const parsed = parseOfficialHermesReleaseTags(raw, { limit: 12 });
  const value = await Promise.all(parsed.map(async (release) => {
    try {
      const response = await fetch(`https://raw.githubusercontent.com/NousResearch/hermes-agent/${encodeURIComponent(release.tag)}/pyproject.toml`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return release;
      const remotePyproject = await response.text();
      const version = remotePyproject.match(/^version\s*=\s*"([^"]+)"/m)?.[1] || '';
      return version
        ? { ...release, version, label: `v${version} · ${release.tag}` }
        : release;
    } catch {
      return release;
    }
  }));
  officialHermesReleasesCache = { checkedAt: Date.now(), value };
  return value.slice(0, limit);
}

function findBundledHermesRuntimeSync() {
  for (const root of uniquePathEntries([frakioBundledHermesRuntimeRoot, path.join(projectRoot, 'runtime', 'hermes')])) {
    for (const runtimeDir of runtimeCandidateDirs(root)) {
      const runtime = inspectHermesRuntimeDir(runtimeDir, 'bundled');
      if (runtime) return runtime;
    }
  }
  return null;
}

function runtimePublicInfo(runtime, extra = {}) {
  if (!runtime) return null;
  return {
    source: runtime.source,
    runtimeDir: runtime.runtimeDir,
    pythonRoot: runtime.pythonRoot,
    python: runtime.python,
    node: runtime.node,
    version: runtime.version,
    platform: runtime.platform,
    bridgeProtocolVersion: runtime.bridgeProtocolVersion,
    manifest: runtime.manifest || null,
    ...extra,
  };
}

function managedHermesRuntimesSync() {
  const registry = readRuntimeRegistrySync();
  const runtimes = [];
  for (const runtimeDir of runtimeCandidateDirs(frakioManagedHermesRuntimeRoot)) {
    const runtime = inspectHermesRuntimeDir(runtimeDir, 'managed');
    if (!runtime) continue;
    const registered = registry.runtimes.find((item) => item?.version === runtime.version && item?.platform === runtime.platform) || {};
    runtimes.push(runtimePublicInfo(runtime, {
      active: registry.activeVersion === runtime.version,
      installedAt: registered.installedAt || runtime.manifest?.builtAt || '',
      verified: registered.verified !== false,
      compatible: runtime.bridgeProtocolVersion === frakioBridgeProtocolVersion,
    }));
  }
  return runtimes.sort((a, b) => compareVersionDesc(a.version, b.version));
}

async function runtimeManagerStatus({ refreshOfficial = false } = {}) {
  const activeRuntime = findFrakioHermesRuntimeSync();
  const bundledRuntime = findBundledHermesRuntimeSync();
  const registry = readRuntimeRegistrySync();
  const officialLatest = await cachedOfficialHermesRelease({ force: refreshOfficial });
  return {
    activeRuntime: runtimePublicInfo(activeRuntime),
    bundledRuntime: runtimePublicInfo(bundledRuntime),
    managedRuntimes: managedHermesRuntimesSync(),
    officialLatest,
    registryPath: frakioRuntimeRegistryPath,
    managedRoot: frakioManagedHermesRuntimeRoot,
    sourcePath: hermesAgentSourcePath,
    activeVersion: registry.activeVersion || '',
    previousVersion: registry.previousVersion || '',
    bridgeProtocolVersion: frakioBridgeProtocolVersion,
    fallbackReason: runtimeFallbackReason,
  };
}

async function ensureManagedHermesSource(tag, logs) {
  await mkdir(path.dirname(hermesAgentSourcePath), { recursive: true });
  if (!(await exists(path.join(hermesAgentSourcePath, '.git')))) {
    await requireLoggedCommand('git', ['clone', '--filter=blob:none', '--no-checkout', officialHermesAgentRepo, hermesAgentSourcePath], {
      timeout: 240000,
      errorMessage: '下载 Hermes Agent 官方仓库失败。',
    }, logs);
  } else {
    const remote = await gitOutput(hermesAgentSourcePath, ['remote', 'get-url', 'origin'], { timeout: 5000 }).catch(() => '');
    if (managedHermesInstallKind(remote) !== 'managed') {
      const error = new Error('Frakio Work 的 Hermes Agent 源码缓存不是 NousResearch 官方仓库。');
      error.status = 409;
      throw error;
    }
  }
  await requireLoggedCommand('git', ['-C', hermesAgentSourcePath, 'fetch', 'origin', '--tags', '--prune'], {
    timeout: 240000,
    errorMessage: '获取 Hermes Agent 官方版本失败。',
  }, logs);
  await requireLoggedCommand('git', ['-C', hermesAgentSourcePath, 'checkout', '--detach', '--force', tag], {
    timeout: 120000,
    errorMessage: `无法切换到 Hermes Agent ${tag}。`,
  }, logs);
  return gitOutput(hermesAgentSourcePath, ['rev-parse', 'HEAD'], { timeout: 5000 });
}

async function repairPortablePythonLinks(runtimeDir) {
  if (process.platform === 'win32') return;
  const binDir = path.join(runtimeDir, 'python', 'bin');
  const entries = await readdir(binDir, { withFileTypes: true });
  const executable = entries
    .filter((entry) => entry.isFile() && /^python3\.\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort(compareVersionDesc)[0];
  if (!executable) throw new Error('Runtime 中缺少可移植的 Python 可执行文件。');
  for (const name of ['python', 'python3']) {
    const target = path.join(binDir, name);
    await rm(target, { force: true });
    await symlink(executable, target);
  }
}

async function repairPortableNodeLinks(runtimeDir) {
  if (process.platform === 'win32') return;
  const binDir = path.join(runtimeDir, 'node', 'bin');
  for (const [name, target] of [
    ['npm', '../lib/node_modules/npm/bin/npm-cli.js'],
    ['npx', '../lib/node_modules/npm/bin/npx-cli.js'],
  ]) {
    const entry = path.join(binDir, name);
    await rm(entry, { force: true });
    await symlink(target, entry);
  }
}

async function rewritePortablePythonEntrypoints(runtimeDir) {
  if (process.platform === 'win32') return;
  const binDir = path.join(runtimeDir, 'python', 'bin');
  const entries = await readdir(binDir, { withFileTypes: true });
  const launcher = `#!/bin/sh\n'''exec' "$(dirname "$0")/python3" "$0" "$@"\n' '''`;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(binDir, entry.name);
    const raw = await readFile(filePath, 'utf8').catch(() => '');
    if (!raw.startsWith('#!')) continue;
    let next = raw;
    if (raw.startsWith("#!/bin/sh\n'''exec' ")) {
      next = raw.replace(/^#!\/bin\/sh\n'''exec' [^\n]+\n' '''/, launcher);
    } else if (/^#![^\n]*python[^\n]*\n/.test(raw)) {
      next = raw.replace(/^#![^\n]*python[^\n]*\n/, `${launcher}\n`);
    }
    if (next !== raw) await writeFile(filePath, next, { encoding: 'utf8', mode: 0o755 });
  }
}

async function verifyManagedRuntime(runtimeDir, expectedVersion, logs) {
  const runtime = inspectHermesRuntimeDir(runtimeDir, 'managed');
  if (!runtime) throw new Error('安装后的 Runtime 缺少 Python。');
  const versionOutput = await commandOutput(runtime.python, ['-m', 'hermes_cli.main', '--version'], {
    cwd: runtimeDir,
    timeout: 30000,
    env: { HERMES_HOME: hermesHome, HERMES_AGENT_ROOT: runtime.pythonRoot },
  });
  logs.push(versionOutput);
  if (expectedVersion && !versionOutput.includes(expectedVersion)) {
    throw new Error(`Runtime 版本验证失败：期望 ${expectedVersion}，实际为 ${versionOutput || '未知'}。`);
  }
  await requireLoggedCommand(runtime.python, ['-c', `import aiohttp, ddgs, hermes_cli, hermes_cli.main, importlib.metadata as metadata, mcp, starlette; assert aiohttp.__version__ == "${requiredAiohttpVersion}"; assert metadata.version("mcp") == "${requiredMcpVersion}"; assert starlette.__version__ == "${requiredStarletteVersion}"; assert metadata.version("ddgs") == "${requiredDdgsVersion}"; from tools.web_tools import _ensure_web_plugins_loaded; _ensure_web_plugins_loaded(); from agent.web_search_registry import get_provider; provider = get_provider("ddgs"); assert provider is not None and provider.is_available() and provider.supports_search(); print("Hermes, aiohttp, MCP and DDGS imports ready")`], {
    cwd: runtimeDir,
    timeout: 30000,
    env: { HERMES_HOME: hermesHome, HERMES_AGENT_ROOT: runtime.pythonRoot },
    errorMessage: 'Hermes Agent 或 MCP 模块导入失败。',
  }, logs);

  const bridgeScript = (await findFrakioBridgeScript())?.path;
  if (!bridgeScript) throw new Error('Frakio Work Bridge 不存在。');
  const endpointPath = path.join(os.tmpdir(), `frakio-bridge-${randomUUID().slice(0, 8)}.sock`);
  const endpoint = `ipc://${endpointPath}`;
  const child = spawn(runtime.python, [bridgeScript, '--endpoint', endpoint, '--hermes-home', hermesHome, '--agent-root', runtime.pythonRoot], {
    cwd: projectRoot,
    env: runtimeEnv({ HERMES_HOME: hermesHome, HERMES_AGENT_ROOT: runtime.pythonRoot, HERMES_AGENT_BRIDGE_ENDPOINT: endpoint }),
    stdio: 'ignore',
  });
  try {
    const ping = await requestHermesBridge({ action: 'ping' }, { endpoint, timeoutMs: 1500, retryMs: 15000 });
    if (!ping?.ok) throw new Error('Frakio Work Bridge 自检没有返回 ready。');
    logs.push('Frakio Work Bridge protocol check passed.');
  } finally {
    child.kill('SIGTERM');
    await unlink(endpointPath).catch(() => null);
  }
  return { runtime, versionOutput };
}

async function installManagedHermesRuntime({ tag = '' } = {}, logs = []) {
  const official = await cachedOfficialHermesRelease({ force: true });
  const targetTag = String(tag || official.tag || '').trim();
  if (!targetTag || !isOfficialHermesReleaseTag(targetTag)) {
    const error = new Error('没有找到可安装的 Hermes Agent 官方稳定版本。');
    error.status = 409;
    throw error;
  }
  const commit = await ensureManagedHermesSource(targetTag, logs);
  const packageInfo = await readHermesAgentPackageInfo(hermesAgentSourcePath);
  if (!packageInfo.version) throw new Error(`无法读取 ${targetTag} 的 Hermes Agent 版本。`);
  const platform = hermesRuntimePlatformDir();
  const destination = path.join(frakioManagedHermesRuntimeRoot, packageInfo.version, platform);
  const existing = inspectHermesRuntimeDir(destination, 'managed');
  if (existing && existing.manifest?.sourceCommit === commit) {
    logs.push(`Hermes Agent ${packageInfo.version} 已安装。`);
    return runtimePublicInfo(existing);
  }

  const bundled = findBundledHermesRuntimeSync();
  if (!bundled) throw new Error('缺少内置 Runtime，无法创建用户 Runtime。');
  const staging = path.join(frakioRuntimeStagingRoot, `hermes-${packageInfo.version}-${randomUUID()}`);
  await mkdir(frakioRuntimeStagingRoot, { recursive: true });
  await rm(staging, { recursive: true, force: true });
  try {
    logs.push(`creating isolated runtime from bundled base: ${bundled.runtimeDir}`);
    await cp(bundled.runtimeDir, staging, { recursive: true, dereference: true, preserveTimestamps: true });
    await repairPortablePythonLinks(staging);
    await repairPortableNodeLinks(staging);
    const stagingRuntime = inspectHermesRuntimeDir(staging, 'managed');
    await requireLoggedCommand(stagingRuntime.python, ['-m', 'pip', 'install', '--upgrade', '--force-reinstall', '--no-cache-dir', `${hermesAgentSourcePath}[mcp]`, `aiohttp==${requiredAiohttpVersion}`, `mcp==${requiredMcpVersion}`, `starlette==${requiredStarletteVersion}`, `ddgs==${requiredDdgsVersion}`], {
      cwd: hermesAgentSourcePath,
      timeout: 30 * 60 * 1000,
      env: { HERMES_HOME: hermesHome, HERMES_AGENT_ROOT: stagingRuntime.pythonRoot },
      errorMessage: `Hermes Agent ${packageInfo.version} 安装失败。`,
    }, logs);
    await rewritePortablePythonEntrypoints(staging);
    const manifest = {
      schema: 1,
      platform,
      targetOs: process.platform,
      targetArch: process.arch,
      hermesAgentVersion: packageInfo.version,
      sourceRepo: officialHermesAgentRepo,
      sourceTag: targetTag,
      sourceCommit: commit,
      pythonDependencies: { aiohttp: requiredAiohttpVersion, mcp: requiredMcpVersion, starlette: requiredStarletteVersion, ddgs: requiredDdgsVersion },
      builtAt: now(),
      bridgeProtocolVersion: frakioBridgeProtocolVersion,
    };
    await writeFile(path.join(staging, 'runtime-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await verifyManagedRuntime(staging, packageInfo.version, logs);
    await mkdir(path.dirname(destination), { recursive: true });
    await rm(destination, { recursive: true, force: true });
    await rename(staging, destination);
    const registry = readRuntimeRegistrySync();
    const entry = { version: packageInfo.version, platform, runtimeDir: destination, installedAt: now(), verified: true, sourceTag: targetTag, sourceCommit: commit, bridgeProtocolVersion: frakioBridgeProtocolVersion };
    await writeRuntimeRegistry({ ...registry, runtimes: [...registry.runtimes.filter((item) => !(item?.version === entry.version && item?.platform === entry.platform)), entry] });
    return runtimePublicInfo(inspectHermesRuntimeDir(destination, 'managed'), { installedAt: entry.installedAt, verified: true, compatible: true });
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => null);
    throw error;
  }
}

async function stopOwnedHermesRuntime(logs = []) {
  const bridge = await probeHermesBridge({ timeoutMs: 700 });
  if (bridge.ready && !process.env.HERMES_AGENT_BRIDGE_ENDPOINT) {
    await terminatePids(collectBridgePids(bridge.ping || {}), logs, 'Hermes Bridge');
    const endpoint = hermesBridgeEndpoint();
    if (endpoint.startsWith('ipc://')) await unlink(endpoint.slice('ipc://'.length)).catch(() => null);
  }
  hermesBridgeProcess = null;
  if (hermesApiProcess?.pid) await terminatePids([hermesApiProcess.pid], logs, 'Hermes Runtime API');
  hermesApiProcess = null;
}

async function activateManagedHermesRuntime(version, logs = []) {
  const cleanVersion = String(version || '').trim();
  const runtimeDir = path.join(frakioManagedHermesRuntimeRoot, cleanVersion, hermesRuntimePlatformDir());
  const runtime = inspectHermesRuntimeDir(runtimeDir, 'managed');
  if (!runtime) {
    const error = new Error(`Hermes Agent Runtime ${cleanVersion} 未安装。`);
    error.status = 404;
    throw error;
  }
  if (runtime.bridgeProtocolVersion !== frakioBridgeProtocolVersion) {
    const error = new Error(`Runtime Bridge 协议 ${runtime.bridgeProtocolVersion} 与 Frakio Work ${frakioBridgeProtocolVersion} 不兼容。`);
    error.status = 409;
    throw error;
  }
  await verifyManagedRuntime(runtimeDir, cleanVersion, logs);
  const registry = readRuntimeRegistrySync();
  const previousVersion = registry.activeVersion || '';
  const rollbackPoint = await createHermesRollbackPoint('runtime-activation', logs);
  try {
    await stopOwnedRuntimeProcesses();
    await writeRuntimeRegistry({ ...registry, activeVersion: cleanVersion, previousVersion });
    await readState();
    const autoStart = await ensureHermesRuntimeReady({ force: true });
    if (autoStart.status === 'failed') {
      throw new Error(autoStart.error || `Runtime ${cleanVersion} 启动失败。`);
    }
    await updateHermesRollbackPoint(rollbackPoint, {
      status: 'ready',
      after: {
        version: cleanVersion,
        sourceTag: runtime.manifest?.sourceTag || '',
        sourceCommit: runtime.manifest?.sourceCommit || '',
      },
    });
  } catch (activationError) {
    await stopOwnedRuntimeProcesses().catch(() => null);
    await writeRuntimeRegistry({ ...readRuntimeRegistrySync(), activeVersion: previousVersion, previousVersion: cleanVersion });
    await restoreHermesConfigSnapshot(rollbackPoint.path, {
      profiles: true,
      mcp: true,
      channels: true,
      models: true,
    });
    await restoreHermesDatabaseSnapshots(rollbackPoint.path, rollbackPoint.databaseFiles, logs);
    const restored = await ensureHermesRuntimeReady({ force: true }).catch(() => null);
    await updateHermesRollbackPoint(rollbackPoint, {
      status: 'restored-after-failure',
      note: String(activationError?.message || activationError),
    });
    const suffix = restored?.status === 'failed' ? ` 旧 Runtime 恢复后仍未就绪：${restored.error || '未知错误'}` : '';
    const error = new Error(`Runtime ${cleanVersion} 启动失败，已恢复原 Runtime。${suffix}`);
    error.status = 500;
    throw error;
  }
  return runtimePublicInfo(findFrakioHermesRuntimeSync());
}

async function activateBundledHermesRuntime(logs = []) {
  const registry = readRuntimeRegistrySync();
  await writeRuntimeRegistry({ ...registry, activeVersion: '', previousVersion: registry.activeVersion || registry.previousVersion || '' });
  await stopOwnedHermesRuntime(logs);
  await ensureHermesRuntimeReady({ force: true });
  return runtimePublicInfo(findFrakioHermesRuntimeSync());
}

function managedHermesInstallKind(remoteUrl = '') {
  const normalized = String(remoteUrl || '').toLowerCase();
  if (!normalized) return 'unknown';
  if (normalized.includes('github.com/nousresearch/hermes-agent')) return 'managed';
  return 'external';
}

function parsePorcelainFile(line = '') {
  const raw = String(line || '').trim();
  if (!raw) return '';
  if (raw.includes(' -> ')) return raw.split(' -> ').pop().trim();
  if (raw.startsWith('?? ')) return raw.slice(3).trim();
  if (/^[A-Z?]{1,2}\s+/.test(raw)) return raw.replace(/^[A-Z?]{1,2}\s+/, '').trim();
  return raw.slice(3).trim();
}

async function directorySize(target) {
  let total = 0;
  async function walk(current) {
    let entries = [];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else {
        try { total += (await stat(full)).size; } catch {}
      }
    }
  }
  try {
    const s = await stat(target);
    if (s.isDirectory()) await walk(target);
    else total += s.size;
  } catch {}
  return total;
}

async function copyIfExists(source, target) {
  if (!(await exists(source))) return false;
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, force: true, errorOnExist: false });
  return true;
}

async function copyHermesConfigSnapshot(snapshotDir) {
  const configDir = path.join(snapshotDir, 'config');
  const copied = [];
  const candidates = [
    ['hermes/config.yaml', path.join(hermesHome, 'config.yaml')],
    ['hermes/.env', path.join(hermesHome, '.env')],
    ['hermes/profiles', path.join(hermesHome, 'profiles')],
    ['hermes/mcp_servers.json', path.join(hermesHome, 'mcp_servers.json')],
    ['hermes/mcp.json', path.join(hermesHome, 'mcp.json')],
    ['hermes/channels.yaml', path.join(hermesHome, 'channels.yaml')],
    ['hermes/channels.json', path.join(hermesHome, 'channels.json')],
    ['hermes/models.yaml', path.join(hermesHome, 'models.yaml')],
    ['hermes/models.json', path.join(hermesHome, 'models.json')],
    ['frakio/workbench-state.json', statePath],
    ['frakio/model-secrets.json', secretsPath],
  ];
  for (const [relative, source] of candidates) {
    if (await copyIfExists(source, path.join(configDir, relative))) copied.push(relative);
  }
  const copiedProfilesDir = path.join(configDir, 'hermes/profiles');
  if (await exists(copiedProfilesDir)) {
    const stack = [copiedProfilesDir];
    while (stack.length) {
      const current = stack.pop();
      for (const entry of await readdir(current, { withFileTypes: true }).catch(() => [])) {
        const target = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(target);
        else if (/^state\.db(?:-(?:wal|shm))?$/.test(entry.name)) await rm(target, { force: true });
      }
    }
  }
  return copied;
}

async function hermesStateDatabases() {
  const databases = [];
  const rootDb = path.join(hermesHome, 'state.db');
  if (await exists(rootDb)) databases.push({ profileName: 'default', source: rootDb, relative: 'default/state.db' });
  const profilesRoot = path.join(hermesHome, 'profiles');
  for (const entry of await readdir(profilesRoot, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const source = path.join(profilesRoot, entry.name, 'state.db');
    if (await exists(source)) databases.push({ profileName: entry.name, source, relative: `profiles/${entry.name}/state.db` });
  }
  return databases;
}

async function createHermesDatabaseSnapshots(snapshotDir, logs = []) {
  const runtime = findFrakioHermesRuntimeSync() || findBundledHermesRuntimeSync();
  if (!runtime?.python) throw new Error('缺少可用于数据库一致性备份的内置 Python Runtime。');
  const databases = await hermesStateDatabases();
  const snapshotRoot = path.join(snapshotDir, 'databases');
  const script = [
    'import sqlite3, sys',
    'source_path, target_path = sys.argv[1], sys.argv[2]',
    'source = sqlite3.connect(f"file:{source_path}?mode=ro", uri=True)',
    'target = sqlite3.connect(target_path)',
    'source.backup(target)',
    'target.execute("PRAGMA wal_checkpoint(TRUNCATE)")',
    'target.close()',
    'source.close()',
  ].join('; ');
  const snapshots = [];
  for (const database of databases) {
    const target = path.join(snapshotRoot, database.relative);
    await mkdir(path.dirname(target), { recursive: true });
    await requireLoggedCommand(runtime.python, ['-c', script, database.source, target], {
      timeout: 30000,
      env: { HERMES_HOME: hermesHome, HERMES_AGENT_ROOT: runtime.pythonRoot },
      errorMessage: `无法备份 ${database.profileName} 的 Hermes 会话数据库。`,
    }, logs);
    snapshots.push({ profileName: database.profileName, relative: database.relative });
  }
  return snapshots;
}

async function restoreHermesDatabaseSnapshots(snapshotDir, snapshots = [], logs = []) {
  for (const snapshot of snapshots) {
    const profileName = String(snapshot?.profileName || '').trim();
    const source = path.join(snapshotDir, 'databases', String(snapshot?.relative || ''));
    if (!profileName || !(await exists(source))) continue;
    const target = profileName === 'default'
      ? path.join(hermesHome, 'state.db')
      : path.join(hermesHome, 'profiles', profileName, 'state.db');
    if (!isInside(hermesHome, target)) throw new Error(`数据库恢复路径无效：${profileName}`);
    await mkdir(path.dirname(target), { recursive: true });
    await rm(`${target}-wal`, { force: true });
    await rm(`${target}-shm`, { force: true });
    await cp(source, target);
    logs.push(`restored Hermes session database: ${profileName}`);
  }
}

async function restoreHermesConfigSnapshot(snapshotDir, scopes = {}) {
  const configDir = path.join(snapshotDir, 'config');
  const restored = [];
  const includeProfiles = scopes.profiles === true;
  const includeMcp = scopes.mcp === true;
  const includeChannels = scopes.channels === true;
  const includeModels = scopes.models === true;
  const candidates = [
    ['hermes/config.yaml', path.join(hermesHome, 'config.yaml'), true],
    ['hermes/.env', path.join(hermesHome, '.env'), true],
    ['hermes/profiles', path.join(hermesHome, 'profiles'), includeProfiles],
    ['hermes/mcp_servers.json', path.join(hermesHome, 'mcp_servers.json'), includeMcp],
    ['hermes/mcp.json', path.join(hermesHome, 'mcp.json'), includeMcp],
    ['hermes/channels.yaml', path.join(hermesHome, 'channels.yaml'), includeChannels],
    ['hermes/channels.json', path.join(hermesHome, 'channels.json'), includeChannels],
    ['hermes/models.yaml', path.join(hermesHome, 'models.yaml'), includeModels],
    ['hermes/models.json', path.join(hermesHome, 'models.json'), includeModels],
    ['frakio/workbench-state.json', statePath, includeModels || includeProfiles || includeMcp || includeChannels],
    ['frakio/model-secrets.json', secretsPath, includeModels],
  ];
  for (const [relative, target, enabled] of candidates) {
    if (!enabled) continue;
    const source = path.join(configDir, relative);
    if (await copyIfExists(source, target)) restored.push(relative);
  }
  return restored;
}

async function createHermesRollbackPoint(reason = 'manual', logs = [], options = {}) {
  await mkdir(hermesAgentBackupRoot, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const idValue = `${timestamp}-${reason.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}-${randomUUID().slice(0, 8)}`;
  const backupDir = path.join(hermesAgentBackupRoot, idValue);
  const filesDir = path.join(backupDir, 'untracked-files');
  await mkdir(backupDir, { recursive: true });
  const repoStatus = await gitRepoStatus(hermesAgentSourcePath);
  const packageInfo = await readHermesAgentPackageInfo();
  const dirtyFiles = repoStatus.dirtyFiles || [];
  let tagDescription = '';
  try { tagDescription = await gitOutput(hermesAgentSourcePath, ['describe', '--tags', '--always', '--dirty'], { timeout: 5000 }); } catch {}
  let patchSaved = false;
  try {
    const patch = await gitOutput(hermesAgentSourcePath, ['diff', '--binary'], { timeout: 20000, maxBuffer: 30 * 1024 * 1024 });
    if (patch) {
      await writeFile(path.join(backupDir, 'tracked-changes.patch'), patch, 'utf8');
      patchSaved = true;
    }
  } catch (error) {
    logs.push(`patch backup skipped: ${error.message || error}`);
  }
  const untracked = dirtyFiles.filter((line) => line.startsWith('?? ')).map(parsePorcelainFile).filter(Boolean);
  const copiedUntracked = [];
  for (const relative of untracked) {
    const source = path.join(hermesAgentSourcePath, relative);
    const target = path.join(filesDir, relative);
    if (await copyIfExists(source, target)) copiedUntracked.push(relative);
  }
  const configFiles = await copyHermesConfigSnapshot(backupDir);
  const databaseFiles = await createHermesDatabaseSnapshots(backupDir, logs);
  const manifest = {
    id: idValue,
    createdAt: now(),
    reason,
    status: 'ready',
    path: backupDir,
    repoPath: hermesAgentSourcePath,
    before: {
      commit: repoStatus.currentCommit || '',
      branch: repoStatus.currentBranch || '',
      tagDescription,
      version: packageInfo.version,
      releaseDate: packageInfo.releaseDate,
      displayVersion: versionLabel(packageInfo),
    },
    after: options.after || null,
    dirtyFiles,
    patchSaved,
    untrackedFiles: copiedUntracked,
    configFiles,
    databaseFiles,
    scopes: ['runtime', 'profiles', 'mcp', 'channels', 'models'],
  };
  await writeFile(path.join(backupDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  manifest.size = await directorySize(backupDir);
  await writeFile(path.join(backupDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  logs.push(`created rollback point: ${backupDir}`);
  return manifest;
}

async function updateHermesRollbackPoint(manifest, updates = {}) {
  if (!manifest?.path) return manifest;
  const next = { ...manifest, ...updates };
  next.size = await directorySize(manifest.path);
  await writeFile(path.join(manifest.path, 'manifest.json'), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

async function completePendingHermes019Upgrade() {
  const pending = pendingHermes019UpgradeRollback;
  if (!pending?.manifest) return;
  await updateHermesRollbackPoint(pending.manifest, {
    status: 'ready',
    after: {
      version: pending.targetVersion,
      sourceTag: findFrakioHermesRuntimeSync()?.manifest?.sourceTag || '',
      sourceCommit: findFrakioHermesRuntimeSync()?.manifest?.sourceCommit || '',
    },
  });
  pendingHermes019UpgradeRollback = null;
}

async function rollbackPendingHermes019Upgrade(reason) {
  const pending = pendingHermes019UpgradeRollback;
  if (!pending?.manifest || !pending.previousVersion) return null;
  const logs = pending.logs || [];
  await stopOwnedRuntimeProcesses().catch(() => null);
  const registry = readRuntimeRegistrySync();
  await writeRuntimeRegistry({
    ...registry,
    activeVersion: pending.previousVersion,
    previousVersion: pending.targetVersion,
  });
  await restoreHermesConfigSnapshot(pending.manifest.path, {
    profiles: true,
    mcp: true,
    channels: true,
    models: true,
  });
  await restoreHermesDatabaseSnapshots(pending.manifest.path, pending.manifest.databaseFiles, logs);
  const restored = await ensureHermesRuntimeReady({ force: true }).catch((error) => ({
    status: 'failed',
    error: String(error?.message || error),
  }));
  await updateHermesRollbackPoint(pending.manifest, {
    status: 'restored-after-failure',
    note: String(reason?.message || reason || 'Hermes 0.19 startup verification failed.'),
    restoredRuntimeVersion: pending.previousVersion,
  });
  pendingHermes019UpgradeRollback = null;
  return restored;
}

async function listHermesBackups() {
  await mkdir(hermesAgentBackupRoot, { recursive: true });
  const entries = await readdir(hermesAgentBackupRoot, { withFileTypes: true }).catch(() => []);
  const backups = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const backupDir = path.join(hermesAgentBackupRoot, entry.name);
    try {
      const manifest = JSON.parse(await readFile(path.join(backupDir, 'manifest.json'), 'utf8'));
      backups.push({ ...manifest, path: backupDir, size: await directorySize(backupDir) });
    } catch {}
  }
  backups.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return backups;
}

async function readHermesBackup(idValue) {
  const backups = await listHermesBackups();
  return backups.find((backup) => backup.id === idValue) || null;
}

async function cleanHermesCheckout(logs = []) {
  await requireLoggedCommand('git', ['-C', hermesAgentSourcePath, 'reset', '--hard', 'HEAD'], {
    timeout: 120000,
    errorMessage: '恢复 Hermes Agent tracked 文件失败。',
  }, logs);
  await requireLoggedCommand('git', ['-C', hermesAgentSourcePath, 'clean', '-fd'], {
    timeout: 120000,
    errorMessage: '清理 Hermes Agent 未跟踪文件失败。',
  }, logs);
}

async function gitRepoStatus(repoPath, options = {}) {
  const status = {
    path: repoPath,
    isGitRepo: false,
    installKind: 'unknown',
    currentCommit: '',
    currentBranch: '',
    currentTagDescription: '',
    displayVersion: '',
    version: '',
    releaseDate: '',
    latestVersion: '',
    latestReleaseTag: '',
    latestReleaseUrl: '',
    remoteUrl: '',
    upstreamCommit: '',
    dirtyFiles: [],
    dirtyKind: 'none',
    updateAvailable: false,
    canFastForward: false,
    blockedReason: '',
    packageVersion: options.packageVersion || undefined,
  };
  if (!(await exists(repoPath))) {
    status.blockedReason = '路径不存在。';
    return status;
  }
  try {
    const inside = await gitOutput(repoPath, ['rev-parse', '--is-inside-work-tree'], { timeout: 5000 });
    status.isGitRepo = inside === 'true';
  } catch {
    status.blockedReason = options.notGitReason || '当前路径不是 git 仓库，无法自动更新。';
    return status;
  }
  if (!status.isGitRepo) {
    status.blockedReason = options.notGitReason || '当前路径不是 git 仓库，无法自动更新。';
    return status;
  }
  try { status.currentCommit = await gitOutput(repoPath, ['rev-parse', 'HEAD'], { timeout: 5000 }); } catch {}
  try { status.currentBranch = await gitOutput(repoPath, ['branch', '--show-current'], { timeout: 5000 }); } catch {}
  try { status.currentTagDescription = await gitOutput(repoPath, ['describe', '--tags', '--always', '--dirty'], { timeout: 5000 }); } catch {}
  try { status.remoteUrl = await gitOutput(repoPath, ['remote', 'get-url', 'origin'], { timeout: 5000 }); } catch {}
  status.installKind = options.installKind || managedHermesInstallKind(status.remoteUrl);
  if (options.hermesAgent) {
    const packageInfo = await readHermesAgentPackageInfo(repoPath);
    const latest = await latestHermesReleaseInfo(repoPath);
    status.version = packageInfo.version;
    status.releaseDate = packageInfo.releaseDate;
    status.displayVersion = versionLabel(packageInfo) || status.currentTagDescription;
    status.latestVersion = latest.label;
    status.latestReleaseTag = latest.tag;
    status.latestReleaseUrl = latest.url;
  }
  try {
    const dirty = await gitOutput(repoPath, ['status', '--porcelain'], { timeout: 5000 });
    status.dirtyFiles = dirty ? dirty.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 80) : [];
  } catch {}
  if (status.dirtyFiles.length) {
    const tracked = status.dirtyFiles.filter((line) => !line.startsWith('?? ')).map(parsePorcelainFile).filter(Boolean);
    const untracked = status.dirtyFiles.filter((line) => line.startsWith('?? '));
    if (tracked.length === 1 && tracked[0] === 'uv.lock' && !untracked.length) status.dirtyKind = 'install-artifact';
    else if (tracked.length || untracked.length) status.dirtyKind = 'source-or-files';
  }
  const upstreamRefs = ['@{u}', 'origin/main', 'origin/master'];
  for (const ref of upstreamRefs) {
    try {
      status.upstreamCommit = await gitOutput(repoPath, ['rev-parse', ref], { timeout: 5000 });
      if (status.upstreamCommit) break;
    } catch {}
  }
  status.updateAvailable = Boolean(status.currentCommit && status.upstreamCommit && status.currentCommit !== status.upstreamCommit);
  if (status.currentCommit && status.upstreamCommit) {
    status.canFastForward = await gitCommand(repoPath, ['merge-base', '--is-ancestor', 'HEAD', status.upstreamCommit], { timeout: 5000 }, []);
  }
  if (!status.remoteUrl) status.blockedReason = '缺少 origin remote，无法检查远端更新。';
  else if (status.dirtyFiles.length && options.blockDirty !== false) status.blockedReason = `有本地改动，更新前会先备份并恢复官方状态：${status.dirtyFiles.slice(0, 3).join('、')}${status.dirtyFiles.length > 3 ? ' 等' : ''}`;
  else if (status.updateAvailable && !status.canFastForward) status.blockedReason = '远端更新不能 fast-forward，需要手动处理分支差异。';
  return status;
}

async function updatesStatus() {
  const backups = await listHermesBackups();
  const packageVersion = await readFrakioPackageVersion();
  const [hermesAgent, release] = await Promise.all([
    gitRepoStatus(hermesAgentSourcePath, { hermesAgent: true, blockDirty: false, notGitReason: 'Hermes Agent 不是 git checkout，无法自动更新。' }),
    appUpdateStatus({
      currentVersion: packageVersion,
      packaged: process.env.FRAKIO_WORK_PACKAGED === '1',
      platform: process.platform,
      arch: process.arch,
    }),
  ]);
  const frakioWork = {
    path: release.installMode === 'desktop-release'
      ? (process.platform === 'win32' ? '当前 Windows 安装包' : '当前 macOS 安装包')
      : projectRoot,
    isGitRepo: true,
    installKind: release.installMode,
    currentCommit: '',
    currentBranch: '',
    currentTagDescription: `v${packageVersion}`,
    displayVersion: `v${packageVersion}`,
    version: packageVersion,
    latestVersion: release.latestVersion ? `v${release.latestVersion}` : '',
    latestReleaseUrl: release.releaseUrl,
    remoteUrl: release.repositoryUrl,
    upstreamCommit: '',
    dirtyFiles: [],
    dirtyKind: 'none',
    updateAvailable: Boolean(release.updateAvailable),
    canFastForward: true,
    blockedReason: release.error || '',
    packageVersion,
    release,
  };
  return { checkedAt: now(), hermesAgent, frakioWork, backups, backupRoot: hermesAgentBackupRoot };
}

async function fetchUpdateStatus(target, logs) {
  const repoPath = target === 'hermes-agent' ? hermesAgentSourcePath : projectRoot;
  await requireLoggedCommand('git', ['-C', repoPath, 'fetch', 'origin', '--tags', '--prune'], {
    timeout: 180000,
    errorMessage: '检查远端更新失败。',
  }, logs);
  return updatesStatus();
}

function assertUpdateAllowed(target, status) {
  const item = target === 'hermes-agent' ? status.hermesAgent : status.frakioWork;
  if (!item?.isGitRepo) {
    const error = new Error(item?.blockedReason || '当前路径不是 git 仓库，无法自动更新。');
    error.status = 409;
    throw error;
  }
  if (item.dirtyFiles?.length) {
    const error = new Error(item.blockedReason || '有本地改动，无法自动更新。');
    error.status = 409;
    throw error;
  }
  if (!item.updateAvailable) {
    const error = new Error('当前已经是最新版本。');
    error.status = 409;
    throw error;
  }
  if (!item.canFastForward) {
    const error = new Error(item.blockedReason || '远端更新不能 fast-forward，需要手动处理。');
    error.status = 409;
    throw error;
  }
}

function assertUpdatePreflight(target, status) {
  const item = target === 'hermes-agent' ? status.hermesAgent : status.frakioWork;
  if (!item?.isGitRepo) {
    const error = new Error(item?.blockedReason || '当前路径不是 git 仓库，无法自动更新。');
    error.status = 409;
    throw error;
  }
  if (item.dirtyFiles?.length) {
    const error = new Error(item.blockedReason || '有本地改动，无法自动更新。');
    error.status = 409;
    throw error;
  }
}

async function requireLoggedCommand(command, args, options = {}, logs = []) {
  if (await runLoggedCommand(command, args, options, logs)) return;
  throw new Error(options.errorMessage || `${command} ${args.join(' ')} failed.`);
}

async function verifyHermesCli(logs = []) {
  const candidate = await resolveHermesExecutable();
  if (!candidate) throw new Error('Hermes CLI 未创建成功。');
  const args = ['--help'];
  logs.push(`verifying hermes cli: ${candidate}`);
  const ok = await runLoggedCommand(candidate, args, { timeout: 30000 }, logs);
  if (!ok) throw new Error('Hermes CLI 无法执行。');
  return candidate;
}

async function runOfficialHermesSetup(logs = []) {
  const setupScript = path.join(hermesAgentSourcePath, 'setup-hermes.sh');
  const installScript = path.join(hermesAgentSourcePath, 'scripts', 'install.sh');
  const env = {
    HERMES_HOME: hermesHome,
    CI: '1',
    NONINTERACTIVE: '1',
    PATH: `${path.join(homeDir, '.local', 'bin')}:${path.join(homeDir, '.cargo', 'bin')}:${process.env.PATH || ''}`,
  };
  if (await exists(setupScript)) {
    await requireLoggedCommand('/bin/bash', [setupScript], {
      cwd: hermesAgentSourcePath,
      timeout: 900000,
      env,
      input: 'n\nn\n',
      errorMessage: '官方 setup-hermes.sh 执行失败。',
    }, logs);
    return;
  }
  if (await exists(installScript)) {
    await requireLoggedCommand('/bin/bash', [installScript], {
      cwd: hermesAgentSourcePath,
      timeout: 900000,
      env,
      input: 'n\nn\n',
      errorMessage: '官方 scripts/install.sh 执行失败。',
    }, logs);
    return;
  }
  await requireLoggedCommand('/bin/sh', ['-lc', 'curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/setup-hermes.sh | bash'], {
    cwd: hermesHome,
    timeout: 900000,
    env,
    input: 'n\nn\n',
    errorMessage: '官方远程安装脚本执行失败。',
  }, logs);
}

async function ensureHermesBaseConfig(logs) {
  await mkdir(hermesHome, { recursive: true });
  const configPath = path.join(hermesHome, 'config.yaml');
  if (!(await exists(configPath))) {
    await writeFile(configPath, '{}\n', { encoding: 'utf8', mode: 0o600 });
    logs.push(`created empty Hermes config: ${configPath}`);
  } else {
    logs.push(`preserved existing Hermes config and credentials: ${hermesHome}`);
  }
}

app.get('/api/hermes-bootstrap/status', async (_req, res) => {
  try {
    const bootstrap = await discoverHermesBootstrap();
    const state = await readState();
    state.integrations.hermesAgent = {
      ...(state.integrations.hermesAgent || {}),
      installPath: bootstrap.installPath,
      sourcePath: bootstrap.sourcePath,
      apiBaseUrl: bootstrap.api.apiBaseUrl,
      apiStatus: bootstrap.api.online ? 'connected' : bootstrap.status,
      selectedProfile: bootstrap.approval.profileName,
      lastCheckedAt: bootstrap.checkedAt,
      approvalMode: bootstrap.approval.mode,
    };
    await writeState(state);
    res.json(bootstrap);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Hermes bootstrap status failed.' });
  }
});

function publicHermesBootstrapInstallJob(job = hermesBootstrapInstallJob) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    currentStepId: job.currentStepId,
    steps: job.steps.map((step) => ({ ...step })),
    error: job.error,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    bootstrap: job.bootstrap || null,
    runtime: job.runtime || null,
  };
}

function emitHermesBootstrapInstallJob() {
  const snapshot = publicHermesBootstrapInstallJob();
  if (!snapshot) return;
  for (const listener of hermesBootstrapInstallListeners) listener(snapshot);
}

function updateHermesBootstrapInstallStep(stepId, status, detail = '') {
  if (!hermesBootstrapInstallJob) return;
  hermesBootstrapInstallJob.currentStepId = stepId;
  hermesBootstrapInstallJob.steps = hermesBootstrapInstallJob.steps.map((step) => (
    step.id === stepId ? { ...step, status, detail: String(detail || '') } : step
  ));
  emitHermesBootstrapInstallJob();
}

async function runHermesBootstrapInstallJob(jobId) {
  const logs = [];
  try {
    updateHermesBootstrapInstallStep('verify-runtime', 'running');
    const runtime = findFrakioHermesRuntimeSync();
    if (!runtime) {
      const error = new Error('Frakio Work 安装包缺少内置 Hermes Runtime。');
      error.phase = 'verify-runtime';
      throw error;
    }
    logs.push(`using ${runtime.source} runtime ${runtime.version}: ${runtime.runtimeDir}`);
    updateHermesBootstrapInstallStep('verify-runtime', 'ready', runtime.version ? `内置版本 ${runtime.version}` : '内置运行环境可用');

    updateHermesBootstrapInstallStep('write-config', 'running');
    await ensureHermesBaseConfig(logs);
    updateHermesBootstrapInstallStep('write-config', 'ready', 'Hermes Home 已准备');

    updateHermesBootstrapInstallStep('start-runtime', 'running');
    const started = await startHermesAgentApi(logs);
    if (!started?.ok) {
      const error = new Error('Hermes Runtime 未能启动。');
      error.phase = 'start-runtime';
      throw error;
    }
    updateHermesBootstrapInstallStep('start-runtime', 'ready', '本地 Runtime 已启动');

    updateHermesBootstrapInstallStep('detect', 'running');
    const bootstrap = await discoverHermesBootstrap();
    if (!bootstrap.api?.online) {
      const error = new Error('Hermes 本地连接尚未就绪。');
      error.phase = 'detect';
      throw error;
    }
    const runtimeStatus = await hermesRuntimeStatus();
    updateHermesBootstrapInstallStep('detect', 'ready', '本地连接正常');
    if (!hermesBootstrapInstallJob || hermesBootstrapInstallJob.id !== jobId) return;
    hermesBootstrapInstallJob = {
      ...hermesBootstrapInstallJob,
      status: 'ready',
      currentStepId: '',
      error: '',
      finishedAt: now(),
      bootstrap,
      runtime: runtimeStatus,
    };
    emitHermesBootstrapInstallJob();
  } catch (error) {
    if (!hermesBootstrapInstallJob || hermesBootstrapInstallJob.id !== jobId) return;
    const phase = hermesBootstrapInstallSteps.some((step) => step.id === error?.phase)
      ? error.phase
      : hermesBootstrapInstallJob.currentStepId || 'verify-runtime';
    const message = String(error?.message || 'Hermes Agent 安装失败。').slice(0, 500);
    updateHermesBootstrapInstallStep(phase, 'failed', message);
    hermesBootstrapInstallJob = {
      ...hermesBootstrapInstallJob,
      status: 'failed',
      currentStepId: phase,
      error: message,
      finishedAt: now(),
    };
    emitHermesBootstrapInstallJob();
  }
}

function startHermesBootstrapInstallJob() {
  if (hermesBootstrapInstallJob?.status === 'running') {
    return { job: publicHermesBootstrapInstallJob(), reused: true };
  }
  const startedAt = now();
  hermesBootstrapInstallJob = {
    id: randomUUID(),
    status: 'running',
    currentStepId: 'verify-runtime',
    steps: hermesBootstrapInstallSteps.map((step) => ({ ...step, status: 'pending', detail: '' })),
    error: '',
    startedAt,
    finishedAt: null,
    bootstrap: null,
    runtime: null,
  };
  const jobId = hermesBootstrapInstallJob.id;
  queueMicrotask(() => void runHermesBootstrapInstallJob(jobId));
  return { job: publicHermesBootstrapInstallJob(), reused: false };
}

app.post('/api/hermes-bootstrap/install', async (_req, res) => {
  const result = startHermesBootstrapInstallJob();
  res.status(202).json(result);
});

app.get('/api/hermes-bootstrap/install/:jobId', (req, res) => {
  const job = publicHermesBootstrapInstallJob();
  if (!job || job.id !== req.params.jobId) return res.status(404).json({ error: 'Hermes 安装任务不存在。' });
  res.json({ job });
});

app.get('/api/hermes-bootstrap/install/:jobId/events', (req, res) => {
  const initial = publicHermesBootstrapInstallJob();
  if (!initial || initial.id !== req.params.jobId) return res.status(404).json({ error: 'Hermes 安装任务不存在。' });
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  const send = (snapshot) => {
    if (snapshot.id !== req.params.jobId) return;
    res.write(`event: install.snapshot\ndata: ${JSON.stringify({ job: snapshot })}\n\n`);
  };
  send(initial);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
  hermesBootstrapInstallListeners.add(send);
  req.on('close', () => {
    clearInterval(heartbeat);
    hermesBootstrapInstallListeners.delete(send);
  });
});

app.post('/api/hermes-bootstrap/start', async (_req, res) => {
  const logs = [];
  try {
    await startHermesAgentApi(logs);
    const bootstrap = await discoverHermesBootstrap();
    res.json({ ok: bootstrap.api.online, logs, bootstrap });
  } catch (error) {
    logs.push(String(error?.message || error));
    res.status(500).json({ error: error.message || 'Hermes bootstrap start failed.', logs });
  }
});

app.post('/api/hermes-bootstrap/import', async (_req, res) => {
  try {
    const state = await readState();
    for (const profile of await readHermesProfiles()) await ensureManagedGlobalModulesForProfile(profile.name);
    const moduleSync = { skipped: true, reason: 'Profile import completed; managed global module roots were registered separately.' };
    const result = await syncHermesProfilesToState(state);
    await writeState(result.state);
    res.json({
      importedProfiles: result.importedProfiles,
      agents: result.state.agents,
      hermesAgent: result.state.integrations.hermesAgent,
      bootstrap: result.bootstrap,
      moduleSync,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Hermes profile import failed.' });
  }
});

app.get('/api/app-update/status', async (req, res) => {
  res.json(await appUpdateStatus({
    currentVersion: await readFrakioPackageVersion(),
    force: String(req.query.refresh || '') === '1',
    packaged: process.env.FRAKIO_WORK_PACKAGED === '1',
    platform: process.platform,
    arch: process.arch,
  }));
});

app.get('/api/updates/status', async (_req, res) => {
  try {
    res.json(await updatesStatus());
  } catch (error) {
    res.status(500).json({ error: error.message || 'Update status failed.' });
  }
});

app.post('/api/updates/check', async (_req, res) => {
  const logs = [];
  let phase = 'fetch-remote';
  try {
    const status = await updatesStatus();
    if (status.hermesAgent.isGitRepo) await fetchUpdateStatus('hermes-agent', logs).catch((error) => logs.push(`Hermes Agent: ${error.message || error}`));
    phase = 'status';
    res.json({ ok: true, target: 'all', phase, logs: tailInstallLogs(logs), status: await updatesStatus() });
  } catch (error) {
    logs.push(String(error?.message || error));
    res.status(error.status || 500).json({ error: error.message || 'Update check failed.', target: 'all', phase, logs: tailInstallLogs(logs), status: await updatesStatus().catch(() => null) });
  }
});

app.post('/api/updates/hermes-agent', async (_req, res) => {
  const target = 'hermes-agent';
  const logs = [];
  let phase = 'fetch-remote';
  let rollbackPoint = null;
  try {
    let status = await updatesStatus();
    if (!status.hermesAgent?.isGitRepo) {
      const error = new Error(status.hermesAgent?.blockedReason || 'Hermes Agent 不是 git checkout，无法自动更新。');
      error.status = 409;
      throw error;
    }
    if (status.hermesAgent.installKind !== 'managed') {
      const error = new Error('当前 Hermes Agent 不是 Frakio Work 管理的官方 checkout。请先接管后再自动恢复和更新。');
      error.status = 409;
      throw error;
    }
    phase = 'backup';
    rollbackPoint = await createHermesRollbackPoint('update', logs);
    if (status.hermesAgent.dirtyFiles?.length) {
      phase = 'restore-clean';
      await cleanHermesCheckout(logs);
    }
    phase = 'fetch-remote';
    await fetchUpdateStatus(target, logs);
    status = await updatesStatus();
    if (!status.hermesAgent.updateAvailable) {
      await updateHermesRollbackPoint(rollbackPoint, { status: 'ready', note: 'created before update check; no update was available' });
      const error = new Error('当前已经是最新版本。');
      error.status = 409;
      throw error;
    }
    if (!status.hermesAgent.canFastForward) {
      const error = new Error(status.hermesAgent.blockedReason || '远端更新不能 fast-forward，需要手动处理分支差异。');
      error.status = 409;
      throw error;
    }

    phase = 'pull';
    await requireLoggedCommand('git', ['-C', hermesAgentSourcePath, 'pull', '--ff-only'], {
      timeout: 180000,
      errorMessage: 'Hermes Agent 更新失败。',
    }, logs);

    phase = 'setup-runtime';
    await runOfficialHermesSetup(logs);

    phase = 'verify-cli';
    await verifyHermesCli(logs);

    phase = 'write-config';
    await ensureHermesBaseConfig(logs);

    phase = 'restart-runtime';
    await startHermesAgentApi(logs);
    const bootstrap = await discoverHermesBootstrap();
    status = await updatesStatus();
    const afterInfo = await readHermesAgentPackageInfo();
    const afterStatus = status.hermesAgent;
    if (rollbackPoint) {
      rollbackPoint = await updateHermesRollbackPoint(rollbackPoint, {
        status: 'ready',
        after: {
          commit: afterStatus.currentCommit || '',
          branch: afterStatus.currentBranch || '',
          tagDescription: afterStatus.currentTagDescription || '',
          version: afterInfo.version,
          releaseDate: afterInfo.releaseDate,
          displayVersion: versionLabel(afterInfo),
        },
      });
    }
    captureTelemetry('feature_used', { feature: 'update_completed', outcome: 'completed' });
    captureMeaningfulActivity('feature_used');
    res.json({ ok: true, target, phase, logs: tailInstallLogs(logs), status: await updatesStatus(), backup: rollbackPoint, bootstrap, runtime: await hermesRuntimeStatus() });
  } catch (error) {
    logs.push(String(error?.message || error));
    res.status(error.status || 500).json({ error: error.message || 'Hermes Agent update failed.', target, phase, logs: tailInstallLogs(logs), status: await updatesStatus().catch(() => null) });
  }
});

app.post('/api/updates/hermes-agent/backup', async (req, res) => {
  const logs = [];
  try {
    const reason = String(req.body?.reason || 'manual');
    const backup = await createHermesRollbackPoint(reason, logs);
    captureTelemetry('feature_used', { feature: 'backup_created', outcome: 'completed' });
    captureMeaningfulActivity('feature_used');
    res.json({ ok: true, target: 'hermes-agent', phase: 'backup', logs: tailInstallLogs(logs), backup, status: await updatesStatus() });
  } catch (error) {
    logs.push(String(error?.message || error));
    res.status(500).json({ error: error.message || 'Hermes Agent backup failed.', target: 'hermes-agent', phase: 'backup', logs: tailInstallLogs(logs), status: await updatesStatus().catch(() => null) });
  }
});

app.post('/api/updates/hermes-agent/backups/:id/rollback', async (req, res) => {
  const logs = [];
  let phase = 'backup-current';
  try {
    const backup = await readHermesBackup(req.params.id);
    if (!backup) {
      const error = new Error('找不到这个回滚点。');
      error.status = 404;
      throw error;
    }
    const status = await updatesStatus();
    if (!status.hermesAgent?.isGitRepo || status.hermesAgent.installKind !== 'managed') {
      const error = new Error('当前 Hermes Agent 不是 Frakio Work 管理的官方 checkout，无法自动回滚。');
      error.status = 409;
      throw error;
    }
    const currentBackup = await createHermesRollbackPoint('pre-rollback', logs, { after: backup.before || null });
    if (status.hermesAgent.dirtyFiles?.length) await cleanHermesCheckout(logs);

    phase = 'checkout-version';
    const targetCommit = backup.before?.commit || '';
    if (!targetCommit) {
      const error = new Error('回滚点缺少更新前 commit。');
      error.status = 409;
      throw error;
    }
    await requireLoggedCommand('git', ['-C', hermesAgentSourcePath, 'fetch', 'origin', '--tags', '--prune'], {
      timeout: 180000,
      errorMessage: '刷新 Hermes Agent 远端信息失败。',
    }, logs);
    await requireLoggedCommand('git', ['-C', hermesAgentSourcePath, 'checkout', targetCommit], {
      timeout: 120000,
      errorMessage: '切换 Hermes Agent 版本失败。',
    }, logs);
    await cleanHermesCheckout(logs);

    phase = 'restore-config';
    const restoredConfig = await restoreHermesConfigSnapshot(backup.path, req.body?.scopes || {});
    logs.push(`restored config files: ${restoredConfig.length}`);

    phase = 'setup-runtime';
    await runOfficialHermesSetup(logs);
    phase = 'verify-cli';
    await verifyHermesCli(logs);
    phase = 'restart-runtime';
    await startHermesAgentApi(logs);
    const bootstrap = await discoverHermesBootstrap();
    captureTelemetry('feature_used', { feature: 'rollback_completed', outcome: 'completed' });
    captureMeaningfulActivity('feature_used');
    res.json({ ok: true, target: 'hermes-agent', phase, logs: tailInstallLogs(logs), backup, currentBackup, restoredConfig, status: await updatesStatus(), bootstrap, runtime: await hermesRuntimeStatus() });
  } catch (error) {
    logs.push(String(error?.message || error));
    res.status(error.status || 500).json({ error: error.message || 'Hermes Agent rollback failed.', target: 'hermes-agent', phase, logs: tailInstallLogs(logs), status: await updatesStatus().catch(() => null) });
  }
});

app.delete('/api/updates/hermes-agent/backups/:id', async (req, res) => {
  try {
    const backup = await readHermesBackup(req.params.id);
    if (!backup) return res.status(404).json({ error: '找不到这个备份。', status: await updatesStatus() });
    await rm(backup.path, { recursive: true, force: true });
    res.json({ ok: true, target: 'hermes-agent', phase: 'delete-backup', deleted: backup.id, status: await updatesStatus() });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Delete backup failed.', status: await updatesStatus().catch(() => null) });
  }
});

app.post('/api/updates/hermes-agent/backups/cleanup', async (req, res) => {
  try {
    const mode = req.body?.mode === 'older-than-30-days' ? 'older-than-30-days' : 'keep-latest-10';
    const backups = await listHermesBackups();
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const targets = mode === 'older-than-30-days'
      ? backups.filter((backup) => new Date(backup.createdAt || 0).getTime() < cutoff)
      : backups.slice(10);
    for (const backup of targets) await rm(backup.path, { recursive: true, force: true });
    res.json({ ok: true, target: 'hermes-agent', phase: 'cleanup-backups', mode, deleted: targets.map((backup) => backup.id), status: await updatesStatus() });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Cleanup backups failed.', status: await updatesStatus().catch(() => null) });
  }
});

app.post('/api/updates/frakio-work', async (_req, res) => {
  const status = await appUpdateStatus({ currentVersion: await readFrakioPackageVersion(), force: true, packaged: process.env.FRAKIO_WORK_PACKAGED === '1' });
  res.status(410).json({
    error: '已停用在安装目录执行 git pull 的更新方式，请从 GitHub Releases 下载新版。',
    target: 'frakio-work',
    phase: 'release-download',
    releaseUrl: status.releaseUrl,
    asset: status.asset,
  });
});

app.get('/api/hermes-runtime/status', async (_req, res) => {
  try {
    res.json(await hermesRuntimeStatus());
  } catch (error) {
    res.status(500).json({ error: error.message || 'Hermes runtime status failed.' });
  }
});

app.post('/api/hermes-runtime/check-update', async (_req, res) => {
  try {
    res.json({ ok: true, manager: await runtimeManagerStatus({ refreshOfficial: true }), runtime: await hermesRuntimeStatus() });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Hermes Runtime update check failed.' });
  }
});

app.get('/api/hermes-runtime/releases', async (_req, res) => {
  try {
    res.json({
      releases: await officialHermesReleases(),
      repositoryUrl: 'https://github.com/NousResearch/hermes-agent',
    });
  } catch (error) {
    res.status(502).json({ error: error.message || 'Hermes Runtime releases could not be loaded.', releases: [] });
  }
});

app.post('/api/hermes-runtime/install', async (req, res) => {
  const logs = [];
  let phase = 'check-release';
  try {
    phase = 'install-runtime';
    const installed = await installManagedHermesRuntime({ tag: req.body?.tag }, logs);
    res.json({ ok: true, phase, installed, logs: tailInstallLogs(logs), manager: await runtimeManagerStatus(), runtime: await hermesRuntimeStatus() });
  } catch (error) {
    logs.push(String(error?.message || error));
    res.status(error.status || 500).json({ error: error.message || 'Hermes Runtime install failed.', phase, logs: tailInstallLogs(logs), manager: await runtimeManagerStatus().catch(() => null) });
  }
});

app.post('/api/hermes-runtime/activate', async (req, res) => {
  const logs = [];
  try {
    const active = await activateManagedHermesRuntime(req.body?.version, logs);
    res.json({ ok: true, active, logs: tailInstallLogs(logs), manager: await runtimeManagerStatus(), runtime: await hermesRuntimeStatus() });
  } catch (error) {
    logs.push(String(error?.message || error));
    res.status(error.status || 500).json({ error: error.message || 'Hermes Runtime activation failed.', logs: tailInstallLogs(logs), manager: await runtimeManagerStatus().catch(() => null), runtime: await hermesRuntimeStatus().catch(() => null) });
  }
});

app.post('/api/hermes-runtime/use-bundled', async (_req, res) => {
  const logs = [];
  try {
    const active = await activateBundledHermesRuntime(logs);
    res.json({ ok: true, active, logs: tailInstallLogs(logs), manager: await runtimeManagerStatus(), runtime: await hermesRuntimeStatus() });
  } catch (error) {
    logs.push(String(error?.message || error));
    res.status(500).json({ error: error.message || 'Bundled Hermes Runtime activation failed.', logs: tailInstallLogs(logs), runtime: await hermesRuntimeStatus().catch(() => null) });
  }
});

app.delete('/api/hermes-runtime/versions/:version', async (req, res) => {
  try {
    const version = String(req.params.version || '').trim();
    const registry = readRuntimeRegistrySync();
    if (registry.activeVersion === version) return res.status(409).json({ error: '正在使用的 Runtime 不能删除，请先切换到内置 Runtime。' });
    const runtimeDir = path.join(frakioManagedHermesRuntimeRoot, version, hermesRuntimePlatformDir());
    if (!isInside(frakioManagedHermesRuntimeRoot, runtimeDir)) return res.status(403).json({ error: 'Runtime 路径无效。' });
    if (!(await exists(runtimeDir))) return res.status(404).json({ error: 'Runtime 不存在。' });
    await rm(path.join(frakioManagedHermesRuntimeRoot, version), { recursive: true, force: true });
    await writeRuntimeRegistry({ ...registry, runtimes: registry.runtimes.filter((item) => item?.version !== version), previousVersion: registry.previousVersion === version ? '' : registry.previousVersion });
    res.json({ ok: true, deleted: version, manager: await runtimeManagerStatus(), runtime: await hermesRuntimeStatus() });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Hermes Runtime delete failed.' });
  }
});

app.get('/api/hermes-runtime/diagnostics', async (_req, res) => {
  try {
    res.json(await hermesRuntimeDiagnostics());
  } catch (error) {
    res.status(500).json({ error: error.message || 'Hermes runtime diagnostics failed.' });
  }
});

app.post('/api/hermes-runtime/start', async (_req, res) => {
  try {
    const autoStart = await ensureHermesRuntimeReady({ force: true });
    res.json({ ok: autoStart.status === 'ready', autoStart, runtime: await hermesRuntimeStatus() });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Hermes Runtime start failed.', runtime: await hermesRuntimeStatus().catch(() => null) });
  }
});

app.post('/api/hermes-runtime/profiles/:name/gateway/start', async (req, res) => {
  try {
    const gateway = await startProfileGateway(req.params.name || 'default');
    captureTelemetry('feature_used', { feature: 'channel_connected', outcome: 'completed' });
    captureMeaningfulActivity('feature_used');
    res.json({ ok: true, gateway, runtime: await hermesRuntimeStatus() });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Hermes profile gateway start failed.' });
  }
});

app.post('/api/hermes-runtime/profiles/:name/gateway/stop', async (req, res) => {
  try {
    const gateway = await stopOrVerifyProfileGateway(req.params.name || 'default');
    res.json({ ok: true, gateway, runtime: await hermesRuntimeStatus() });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes profile gateway stop failed.' });
  }
});

app.patch('/api/hermes-runtime/profiles/:name/model', async (req, res) => {
  try {
    const state = await readState();
    const modelValue = String(req.body?.modelId || req.body?.modelValue || '').trim();
    if (!modelValue) return res.status(400).json({ error: '模型不能为空。' });
    const profileName = req.params.name || 'default';
    const updated = await updateHermesProfileDefaultModel(profileName, modelValue, state.models || []);
    const { selectedModel, selectedName } = resolveModelSelection(modelValue, state.models || []);
    const agentModel = selectedModel?.name || selectedName || modelValue;
    for (const agent of state.agents || []) {
      if (agent.profileName === profileName || agent.id === slug(profileName) || (profileName === 'default' && agent.id === 'hermes-default')) agent.model = agentModel;
    }
    const synced = await syncHermesProfilesToState(state);
    await writeState(synced.state);
    const profile = synced.bootstrap.profiles.find((item) => item.name === profileName) || null;
    const agent = synced.state.agents.find((item) => item.profileName === profileName || item.id === slug(profileName)) || null;
    res.json({
      ok: true,
      updated,
      profile,
      agent,
      agents: synced.state.agents,
      models: synced.state.models.map(publicModel),
      bootstrap: synced.bootstrap,
      runtime: await hermesRuntimeStatus(),
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes Profile 模型更新失败。' });
  }
});

app.post('/api/hermes-bootstrap/sync-modules', async (_req, res) => {
  try {
    const moduleSync = await syncBundledSkillsDisabled();
    const state = await readState();
    const result = await syncHermesProfilesToState(state);
    await writeState(result.state);
    res.json({
      ok: true,
      moduleSync,
      importedProfiles: result.importedProfiles,
      agents: result.state.agents,
      hermesAgent: result.state.integrations.hermesAgent,
      bootstrap: result.bootstrap,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Hermes module sync failed.' });
  }
});

app.patch('/api/hermes-bootstrap/approvals', async (req, res) => {
  try {
    const state = await readState();
    const profileName = String(req.body?.profileName || state.integrations.hermesAgent?.selectedProfile || 'default');
    const mode = String(req.body?.mode || '');
    const approval = await writeApprovalMode(profileName, mode);
    state.integrations.hermesAgent = {
      ...(state.integrations.hermesAgent || {}),
      selectedProfile: profileName,
      approvalMode: approval.mode,
      lastCheckedAt: now(),
    };
    await writeState(state);
    res.json({ approval, hermesAgent: state.integrations.hermesAgent });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Approval mode update failed.' });
  }
});

app.get('/api/hermes/config', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const config = await readYamlFile(profileConfigPath(profile));
    const envValues = await readEnvValues(profileEnvPath(profile));
    const platformConfig = readPlatformEnvAsConfig(envValues);
    const proxy = readProxyEnvAsConfig(envValues);
    const gatewayAutoStart = await readGatewayAutoStartConfig();
    const mergedPlatforms = { ...(config.platforms || {}) };
    for (const [platform, values] of Object.entries(platformConfig)) {
      mergedPlatforms[platform] = deepMerge(mergedPlatforms[platform] || {}, values);
    }
    const body = { ...config, platforms: mergedPlatforms, proxy, gatewayAutoStart };
    const sections = String(req.query?.sections || '').split(',').map((item) => item.trim()).filter(Boolean);
    if (sections.length) {
      return res.json(Object.fromEntries(sections.map((section) => [section, hermesPlatformSections.has(section) ? body.platforms?.[section] || {} : body[section] || {}])));
    }
    res.json(body);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Hermes config read failed.' });
  }
});

app.put('/api/hermes/config', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const section = String(req.body?.section || '').trim();
    const values = req.body?.values && typeof req.body.values === 'object' && !Array.isArray(req.body.values) ? req.body.values : null;
    if (!section || !values) return res.status(400).json({ error: 'section and values are required.' });
    if (section === 'proxy') {
      await writeEnvValues(profileEnvPath(profile), Object.fromEntries(hermesProxyEnvKeys.map((key) => [key, values[key] || ''])));
      return res.json({ success: true });
    }
    if (section === 'gatewayAutoStart') {
      const gatewayAutoStart = await writeGatewayAutoStartConfig(values);
      return res.json({ success: true, gatewayAutoStart });
    }
    if (!hermesConfigSections.has(section)) return res.status(400).json({ error: `Unsupported Hermes config section: ${section}` });
    const config = await updateProfileYaml(profile, (current) => {
      if (hermesPlatformSections.has(section)) {
        current.platforms = current.platforms || {};
        current.platforms[section] = deepMerge(current.platforms[section] || {}, values);
      } else {
        current[section] = deepMerge(current[section] || {}, values);
      }
      return current;
    });
    const gateway = hermesPlatformSections.has(section) ? await startProfileGateway(profile) : null;
    res.json({ success: true, [section]: hermesPlatformSections.has(section) ? config.platforms?.[section] || {} : config[section] || {}, gateway });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes config update failed.' });
  }
});

app.get('/api/hermes/config/auxiliary-models', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const config = await readYamlFile(profileConfigPath(profile));
    const auxiliary = isPlainRecord(config.auxiliary) ? config.auxiliary : {};
    res.json({
      tasks: auxiliaryModelTasks,
      auxiliary: Object.fromEntries(auxiliaryModelTasks.map((task) => [task.key, publicAuxiliarySettings(auxiliary[task.key], task)])),
    });
  } catch (error) {
    res.status(500).json({ error: error.message || '辅助模型配置读取失败。' });
  }
});

app.put('/api/hermes/config/auxiliary-models', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const state = await readState();
    const input = req.body?.auxiliary;
    if (!isPlainRecord(input)) return res.status(400).json({ error: 'auxiliary 配置不能为空。' });
    const updates = {};
    for (const [taskKey, value] of Object.entries(input)) {
      const task = auxiliaryModelTaskByKey.get(taskKey);
      if (!task) continue;
      updates[taskKey] = normalizeAuxiliaryUpdate(value, task);
    }
    for (const settings of Object.values(updates)) {
      if (['auto', 'main'].includes(settings.provider)) continue;
      const configuredModels = normalizeModels(state.models || []);
      let selectedModel = configuredModels.find((model) => model.providerKey === settings.provider && normalizeModelNames(model.models, model.model).includes(settings.model));
      if (!selectedModel) {
        const preset = providerPresetByKey(settings.provider);
        if (preset && (preset.models.includes(settings.model) || !preset.models.length)) {
          selectedModel = normalizeModels([{
            id: `preset-${preset.value}`,
            name: preset.label,
            provider: preset.label,
            providerKey: preset.value,
            model: settings.model,
            models: preset.models.length ? preset.models : [settings.model],
            baseUrl: preset.baseUrl,
            apiMode: preset.apiMode,
            source: 'manual',
          }])[0];
        }
      }
      if (!selectedModel) throw configValidationError(`找不到 Provider「${settings.provider}」下的模型「${settings.model}」。`);
      await ensureModelProviderForProfile(profile, selectedModel, settings.model, state.models || [], { setDefault: false });
    }
    const config = await updateProfileYaml(profile, (current) => {
      const auxiliary = isPlainRecord(current.auxiliary) ? { ...current.auxiliary } : {};
      for (const [taskKey, settings] of Object.entries(updates)) {
        const previous = isPlainRecord(auxiliary[taskKey]) ? { ...auxiliary[taskKey] } : {};
        for (const field of auxiliaryEditableFields) delete previous[field];
        auxiliary[taskKey] = { ...previous, ...settings };
      }
      current.auxiliary = auxiliary;
      return current;
    });
    const auxiliary = isPlainRecord(config.auxiliary) ? config.auxiliary : {};
    res.json({
      success: true,
      auxiliary: Object.fromEntries(auxiliaryModelTasks.map((task) => [task.key, publicAuxiliarySettings(auxiliary[task.key], task)])),
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '辅助模型配置保存失败。' });
  }
});

app.put('/api/hermes/config/credentials', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const platform = String(req.body?.platform || '').trim();
    const values = req.body?.values && typeof req.body.values === 'object' && !Array.isArray(req.body.values) ? req.body.values : null;
    const envMap = hermesPlatformEnvByPlatform[platform];
    if (!platform || !values || !envMap) return res.status(400).json({ error: 'valid platform and values are required.' });
    const flatValues = {};
    for (const [key, value] of Object.entries(values)) {
      if (key === 'extra' && value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [subKey, subValue] of Object.entries(value)) flatValues[`extra.${subKey}`] = subValue;
      } else {
        flatValues[key] = value;
      }
    }
    const envUpdates = {};
    await updateProfileYaml(profile, (current) => {
      current.platforms = current.platforms || {};
      current.platforms[platform] = current.platforms[platform] || {};
      for (const [keyPath, value] of Object.entries(flatValues)) {
        const envKey = envMap[keyPath];
        if (!envKey) continue;
        envUpdates[envKey] = value;
        removeNestedValue(current.platforms[platform], keyPath);
      }
      if (Object.keys(current.platforms[platform] || {}).length === 0) delete current.platforms[platform];
      if (Object.keys(current.platforms || {}).length === 0) delete current.platforms;
      return current;
    });
    await writeEnvValues(profileEnvPath(profile), envUpdates);
    const gateway = await startProfileGateway(profile);
    res.json({ success: true, gateway });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes credentials update failed.' });
  }
});

app.get('/api/hermes/weixin/qrcode', async (req, res) => {
  try {
    const url = new URL('/ilink/bot/get_bot_qrcode', weixinIlinkBase);
    url.searchParams.set('bot_type', '3');
    const response = await fetchExternalJson(url, { timeoutMs: 15000 });
    if (!response.ok) return res.status(response.status || 502).json({ error: response.body?.error || 'Failed to get Weixin QR code.' });
    const data = response.body || {};
    if (!data.qrcode) return res.status(502).json({ error: 'Failed to get Weixin QR code.' });
    res.json({ qrcode: data.qrcode, qrcode_url: data.qrcode_img_content || data.qrcode_url || '' });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to connect to Weixin iLink API.' });
  }
});

app.get('/api/hermes/weixin/qrcode/status', async (req, res) => {
  const qrcode = String(req.query?.qrcode || '').trim();
  if (!qrcode) return res.status(400).json({ error: 'Missing qrcode parameter.' });
  try {
    const url = new URL('/ilink/bot/get_qrcode_status', weixinIlinkBase);
    url.searchParams.set('qrcode', qrcode);
    const response = await fetchExternalJson(url, { timeoutMs: 35000 });
    if (!response.ok) return res.status(response.status || 502).json({ error: response.body?.error || 'Failed to poll Weixin QR status.' });
    const data = response.body || {};
    const status = data.status || 'wait';
    if (status === 'confirmed') {
      return res.json({ status, account_id: data.ilink_bot_id, token: data.bot_token, base_url: data.baseurl });
    }
    res.json({ status });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to poll Weixin QR status.' });
  }
});

app.post('/api/hermes/weixin/save', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const accountId = String(req.body?.account_id || '').trim();
    const token = String(req.body?.token || '').trim();
    const baseUrl = String(req.body?.base_url || '').trim();
    if (!accountId || !token) return res.status(400).json({ error: 'Missing account_id or token.' });
    const entries = { WEIXIN_ACCOUNT_ID: accountId, WEIXIN_TOKEN: token };
    if (baseUrl) entries.WEIXIN_BASE_URL = baseUrl;
    await updateProfileYaml(profile, (current) => {
      if (current.platforms?.weixin) {
        removeNestedValue(current.platforms.weixin, 'token');
        removeNestedValue(current.platforms.weixin, 'extra.account_id');
        removeNestedValue(current.platforms.weixin, 'extra.base_url');
        if (Object.keys(current.platforms.weixin || {}).length === 0) delete current.platforms.weixin;
        if (Object.keys(current.platforms || {}).length === 0) delete current.platforms;
      }
      return current;
    });
    await writeEnvValues(profileEnvPath(profile), entries);
    const gateway = await startProfileGateway(profile);
    captureTelemetry('feature_used', { feature: 'channel_connected', outcome: 'completed' });
    captureMeaningfulActivity('feature_used');
    res.json({ success: true, gateway });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes Weixin credentials save failed.' });
  }
});

app.get('/api/hermes/mcp/servers', async (req, res) => {
  try {
    res.json(await readMcpConfig(requestedHermesProfile(req, 'default')));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'MCP servers read failed.' });
  }
});

app.post('/api/hermes/mcp/servers', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const name = sanitizeMcpServerName(req.body?.name);
    const serverConfig = normalizeMcpServerConfig(req.body || {});
    const payload = await updateMcpServers(profile, (servers) => {
      if (servers[name]) throw Object.assign(new Error('这个 MCP Server 已存在。'), { status: 409 });
      return { ...servers, [name]: serverConfig };
    });
    res.json(payload);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'MCP server create failed.' });
  }
});

app.patch('/api/hermes/mcp/servers/:name', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const name = sanitizeMcpServerName(req.params.name);
    const payload = await updateMcpServers(profile, (servers) => {
      if (!servers[name]) throw Object.assign(new Error('未找到这个 MCP Server。'), { status: 404 });
      const current = servers[name] || {};
      const next = req.body?.config ? preserveMaskedMcpSecrets(current, normalizeMcpServerConfig(req.body.config)) : { ...current };
      if ('enabled' in (req.body || {})) next.enabled = Boolean(req.body.enabled);
      for (const key of ['timeout', 'connect_timeout', 'supports_parallel_tool_calls', 'tools']) {
        if (key in (req.body || {})) next[key] = req.body[key];
      }
      return { ...servers, [name]: next };
    });
    res.json(payload);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'MCP server update failed.' });
  }
});

app.delete('/api/hermes/mcp/servers/:name', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const name = sanitizeMcpServerName(req.params.name);
    const payload = await updateMcpServers(profile, (servers) => {
      if (!servers[name]) throw Object.assign(new Error('未找到这个 MCP Server。'), { status: 404 });
      const next = { ...servers };
      delete next[name];
      return next;
    });
    res.json(payload);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'MCP server delete failed.' });
  }
});

app.post('/api/hermes/mcp/servers/:name/test', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const name = sanitizeMcpServerName(req.params.name);
    const config = await readYamlFile(mcpConfigPathForProfile(profile));
    const serverConfig = config?.mcp_servers?.[name];
    if (!serverConfig) return res.status(404).json({ error: '未找到这个 MCP Server。' });
    if (isWorkbenchMcpServer(name, serverConfig)) {
      try {
        const tools = await probeStdioMcpTools(serverConfig);
        return res.json({ ok: true, server: publicMcpServer(name, serverConfig, { tools, status: 'connected' }), tools, output: `Frakio Work MCP connected · ${tools.length} tools` });
      } catch (error) {
        const output = String(error?.message || error);
        const tools = knownManagedMcpTools(name, serverConfig);
        return res.status(500).json({ ok: false, error: output, server: publicMcpServer(name, serverConfig, { tools, status: 'failed', error: output }), output });
      }
    }
    const hermesBin = await resolveHermesExecutable();
    if (!hermesBin) return res.status(500).json({ error: '未找到 Hermes CLI。' });
    try {
      const { stdout, stderr } = await execFileAsync(hermesBin, ['mcp', 'test', name], {
        cwd: profileConfigDir(profile),
        env: runtimeEnv({ HERMES_HOME: profileConfigDir(profile) }),
        timeout: 45000,
        maxBuffer: 1024 * 1024,
      });
      const output = `${stdout || ''}\n${stderr || ''}`.trim();
      const parsedTools = parseHermesMcpTestTools(output);
      const tools = parsedTools.length ? parsedTools : knownManagedMcpTools(name, serverConfig);
      res.json({ ok: true, server: publicMcpServer(name, serverConfig, { tools, status: 'connected' }), tools, output });
    } catch (error) {
      const output = String(`${error.stdout || ''}\n${error.stderr || ''}`.trim() || error.message || error);
      const tools = knownManagedMcpTools(name, serverConfig);
      res.status(500).json({ ok: false, error: output, server: publicMcpServer(name, serverConfig, { tools, status: 'failed', error: output }), output });
    }
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'MCP server test failed.' });
  }
});

app.post('/api/hermes/mcp/workbench/install', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const payload = await updateMcpServers(profile, (servers) => ({
      ...servers,
      'hermes-workbench-api': workbenchMcpServerConfig('api', profile),
      'hermes-workbench-use': workbenchMcpServerConfig('use', profile),
    }));
    res.json(payload);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Frakio Work 内置 MCP 安装失败。' });
  }
});

app.post('/api/hermes/mcp/reload', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const server = String(req.query?.server || req.body?.server || '').trim();
    let bridge = await probeHermesBridge({ timeoutMs: 1000 });
    if (bridge.ready) {
      const message = server ? `/reload-mcp ${server}` : '/reload-mcp';
      await requestHermesBridge({ action: 'chat', session_id: `mcp-reload-${profile}`, profile, message, source: 'frakio-workbench' }, { timeoutMs: 30000, retryMs: 1000 });
      return res.json({ ok: true, profile, server, runtime: await readMcpConfig(profile) });
    }
    res.json({ ok: false, profile, server, error: hermesBridgeLastError || '本机 Hermes Bridge 未连接，配置已保存，下一次 Hermes 会话启动或手动 reload 后生效。', runtime: await readMcpConfig(profile) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'MCP reload failed.' });
  }
});

app.get('/api/hermes/jobs', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const jobsPath = path.join(profileConfigDir(profile), 'cron', 'jobs.json');
    const parsed = await readJsonFile(jobsPath);
    const rawJobs = Array.isArray(parsed) ? parsed : Array.isArray(parsed.jobs) ? parsed.jobs : [];
    const includeDisabled = String(req.query?.include_disabled || '').toLowerCase() === 'true';
    const jobs = rawJobs.map(normalizeJob).filter((job) => includeDisabled || job.enabled !== false);
    res.json({ jobs });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Hermes jobs read failed.' });
  }
});

app.post('/api/hermes/jobs', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const schedule = String(req.body?.schedule || '').trim();
    const prompt = String(req.body?.prompt || '').trim();
    if (!schedule) return res.status(400).json({ error: 'schedule is required.' });
    const before = await readJsonFile(path.join(profileConfigDir(profile), 'cron', 'jobs.json'));
    const beforeIds = new Set((Array.isArray(before) ? before : before.jobs || []).map((job) => job.job_id || job.id));
    const args = ['cron', 'create', '--profile', profile];
    if (req.body?.name) args.push('--name', String(req.body.name));
    if (req.body?.deliver) args.push('--deliver', String(req.body.deliver));
    if (req.body?.repeat !== undefined && req.body.repeat !== null && req.body.repeat !== '') args.push('--repeat', String(req.body.repeat));
    for (const skill of Array.isArray(req.body?.skills) ? req.body.skills : []) args.push('--skill', String(skill));
    args.push(schedule);
    if (prompt) args.push(prompt);
    await runHermesCommand(args, { profile });
    const after = await readJsonFile(path.join(profileConfigDir(profile), 'cron', 'jobs.json'));
    const jobs = (Array.isArray(after) ? after : after.jobs || []).map(normalizeJob);
    const job = jobs.find((item) => !beforeIds.has(item.job_id || item.id)) || jobs[0] || null;
    res.json({ job });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes job create failed.' });
  }
});

app.patch('/api/hermes/jobs/:id', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const args = ['cron', 'edit', '--profile', profile, req.params.id];
    if (req.body?.schedule !== undefined) args.push('--schedule', String(req.body.schedule));
    if (req.body?.prompt !== undefined) args.push('--prompt', String(req.body.prompt));
    if (req.body?.name !== undefined) args.push('--name', String(req.body.name));
    if (req.body?.deliver !== undefined) args.push('--deliver', String(req.body.deliver));
    if (req.body?.repeat !== undefined) args.push('--repeat', req.body.repeat === null || req.body.repeat === '' ? '0' : String(req.body.repeat));
    if (Array.isArray(req.body?.skills)) {
      if (!req.body.skills.length) args.push('--clear-skills');
      for (const skill of req.body.skills) args.push('--skill', String(skill));
    }
    await runHermesCommand(args, { profile });
    const parsed = await readJsonFile(path.join(profileConfigDir(profile), 'cron', 'jobs.json'));
    const jobs = (Array.isArray(parsed) ? parsed : parsed.jobs || []).map(normalizeJob);
    const job = jobs.find((item) => item.job_id === req.params.id || item.id === req.params.id);
    res.json({ job });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes job update failed.' });
  }
});

for (const [routeAction, cliAction] of [['delete', 'remove'], ['pause', 'pause'], ['resume', 'resume'], ['run', 'run']]) {
  const method = routeAction === 'delete' ? 'delete' : 'post';
  const route = routeAction === 'delete' ? '/api/hermes/jobs/:id' : `/api/hermes/jobs/:id/${routeAction}`;
  app[method](route, async (req, res) => {
    try {
      const profile = requestedHermesProfile(req, 'default');
      await runHermesCommand(['cron', cliAction, '--profile', profile, req.params.id], { profile });
      if (routeAction === 'delete') return res.json({ ok: true });
      const parsed = await readJsonFile(path.join(profileConfigDir(profile), 'cron', 'jobs.json'));
      const jobs = (Array.isArray(parsed) ? parsed : parsed.jobs || []).map(normalizeJob);
      const job = jobs.find((item) => item.job_id === req.params.id || item.id === req.params.id);
      res.json({ job });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message || `Hermes job ${routeAction} failed.` });
    }
  });
}

app.get('/api/hermes/kanban/boards', async (req, res) => {
  try {
    const args = ['kanban', 'boards', 'list', '--json'];
    if (String(req.query?.includeArchived || '').toLowerCase() === 'true') args.push('--all');
    const { stdout } = await runHermesCommand(args);
    res.json({ boards: JSON.parse(stdout || '[]') });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes kanban boards read failed.' });
  }
});

app.post('/api/hermes/kanban/boards', async (req, res) => {
  try {
    const board = kanbanBoard(req.body?.slug);
    const args = ['kanban', 'boards', 'create', board];
    if (req.body?.name) args.push('--name', String(req.body.name));
    if (req.body?.description) args.push('--description', String(req.body.description));
    if (req.body?.icon) args.push('--icon', String(req.body.icon));
    if (req.body?.color) args.push('--color', String(req.body.color));
    await runHermesCommand(args);
    res.json({ ok: true, board });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes kanban board create failed.' });
  }
});

app.get('/api/hermes/kanban/tasks', async (req, res) => {
  try {
    const board = kanbanBoard(req.query?.board || 'default');
    const args = ['kanban', '--board', board, 'list', '--json'];
    if (req.query?.status) args.push('--status', String(req.query.status));
    if (req.query?.assignee) args.push('--assignee', String(req.query.assignee));
    if (String(req.query?.includeArchived || '').toLowerCase() === 'true') args.push('--archived');
    const { stdout } = await runHermesCommand(args);
    res.json({ tasks: JSON.parse(stdout || '[]') });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes kanban tasks read failed.' });
  }
});

app.post('/api/hermes/kanban/tasks', async (req, res) => {
  try {
    const board = kanbanBoard(req.body?.board || req.query?.board || 'default');
    const title = String(req.body?.title || '').trim();
    if (!title) return res.status(400).json({ error: 'title is required.' });
    const args = ['kanban', '--board', board, 'create', title, '--json'];
    if (req.body?.body) args.push('--body', String(req.body.body));
    if (req.body?.assignee) args.push('--assignee', String(req.body.assignee));
    if (req.body?.priority !== undefined) args.push('--priority', String(req.body.priority));
    if (req.body?.tenant) args.push('--tenant', String(req.body.tenant));
    if (req.body?.workspace) args.push('--workspace', String(req.body.workspace));
    if (req.body?.triage) args.push('--triage');
    for (const skill of Array.isArray(req.body?.skills) ? req.body.skills : []) args.push('--skill', String(skill));
    const { stdout } = await runHermesCommand(args);
    res.json({ task: JSON.parse(stdout || '{}') });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes kanban task create failed.' });
  }
});

app.patch('/api/hermes/kanban/tasks/:id', async (req, res) => {
  try {
    const board = kanbanBoard(req.body?.board || req.query?.board || 'default');
    const status = String(req.body?.status || '').trim();
    const assignee = req.body?.assignee;
    if (assignee !== undefined) await runHermesCommand(['kanban', '--board', board, 'assign', req.params.id, String(assignee || 'none')]);
    if (status) {
      if (!kanbanStatuses.has(status)) return res.status(400).json({ error: 'invalid status.' });
      if (status === 'done') await runHermesCommand(['kanban', '--board', board, 'complete', req.params.id, '--summary', String(req.body?.summary || 'Completed from Frakio Work')]);
      else if (status === 'blocked') await runHermesCommand(['kanban', '--board', board, 'block', req.params.id, String(req.body?.reason || 'Blocked from Frakio Work')]);
      else if (status === 'ready') await runHermesCommand(['kanban', '--board', board, 'unblock', req.params.id]);
      else if (status === 'archived') await runHermesCommand(['kanban', '--board', board, 'archive', req.params.id]);
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes kanban task update failed.' });
  }
});

app.get('/api/hermes/kanban/stats', async (req, res) => {
  try {
    const board = kanbanBoard(req.query?.board || 'default');
    const { stdout } = await runHermesCommand(['kanban', '--board', board, 'stats', '--json']);
    res.json({ stats: JSON.parse(stdout || '{}') });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes kanban stats read failed.' });
  }
});

app.get('/api/hermes/kanban/capabilities', async (_req, res) => {
  try {
    const [{ stdout: kanbanOut, stderr: kanbanErr }, { stdout: boardsOut, stderr: boardsErr }] = await Promise.all([
      runHermesCommand(['kanban', '--help']),
      runHermesCommand(['kanban', 'boards', '--help']),
    ]);
    const help = `${kanbanOut || ''}\n${kanbanErr || ''}`;
    const boardHelp = `${boardsOut || ''}\n${boardsErr || ''}`;
    const has = (command) => new RegExp(`(?:^|\\s)${command}(?:\\s|$)`, 'm').test(help);
    res.json({ capabilities: { source: 'hermes-cli', available: true, supports: { boards: /list|create/.test(boardHelp), boardArchive: /\brm\b|remove|delete/.test(boardHelp), taskDetail: has('show'), links: has('link'), comments: has('comment'), attachments: has('attach'), runs: has('show'), logs: has('log'), diagnostics: has('diagnostics'), reclaim: has('reclaim'), reassign: has('reassign'), collaborationSse: true } } });
  } catch (error) {
    res.json({ capabilities: { source: 'hermes-cli', available: false, supports: {}, error: String(error?.message || error) } });
  }
});

app.delete('/api/hermes/kanban/boards/:slug', async (req, res) => {
  try {
    const board = kanbanBoard(req.params.slug);
    if (board === 'default') return res.status(400).json({ error: 'The default board cannot be archived.' });
    await runHermesCommand(['kanban', 'boards', 'rm', board]);
    res.json({ ok: true, board });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes kanban board archive failed.' });
  }
});

app.get('/api/hermes/kanban/tasks/:id', async (req, res) => {
  try {
    const detail = await readKanbanTaskDetail(req.query?.board || 'default', req.params.id);
    res.json({ detail });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes kanban task detail failed.' });
  }
});

app.post('/api/hermes/kanban/tasks/:id/comments', async (req, res) => {
  try {
    const board = kanbanBoard(req.body?.board || req.query?.board || 'default');
    const body = String(req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'body is required.' });
    const args = ['kanban', '--board', board, 'comment', req.params.id, body];
    if (req.body?.author) args.push('--author', String(req.body.author));
    await runHermesCommand(args);
    res.json({ ok: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes kanban comment failed.' });
  }
});

app.post('/api/hermes/kanban/links', async (req, res) => {
  try {
    const board = kanbanBoard(req.body?.board || 'default');
    const parentId = String(req.body?.parentId || req.body?.parent_id || '').trim();
    const childId = String(req.body?.childId || req.body?.child_id || '').trim();
    if (!parentId || !childId) return res.status(400).json({ error: 'parentId and childId are required.' });
    await runHermesCommand(['kanban', '--board', board, 'link', parentId, childId]);
    res.json({ ok: true, parentId, childId });
  } catch (error) {
    const message = String(error.message || 'Hermes kanban link failed.');
    res.status(error.status || (/cycle/i.test(message) ? 409 : 500)).json({ error: message, code: /cycle/i.test(message) ? 'KANBAN_DEPENDENCY_CYCLE' : undefined });
  }
});

app.delete('/api/hermes/kanban/links', async (req, res) => {
  try {
    const board = kanbanBoard(req.body?.board || req.query?.board || 'default');
    const parentId = String(req.body?.parentId || req.query?.parentId || '').trim();
    const childId = String(req.body?.childId || req.query?.childId || '').trim();
    if (!parentId || !childId) return res.status(400).json({ error: 'parentId and childId are required.' });
    await runHermesCommand(['kanban', '--board', board, 'unlink', parentId, childId]);
    res.json({ ok: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes kanban unlink failed.' });
  }
});

app.get('/api/hermes/kanban/tasks/:id/log', async (req, res) => {
  try {
    const board = kanbanBoard(req.query?.board || 'default');
    const tail = Math.max(100, Math.min(100000, Number(req.query?.tail || 20000)));
    const { stdout } = await runHermesCommand(['kanban', '--board', board, 'log', req.params.id, '--tail', String(tail)]);
    res.json({ log: String(stdout || '') });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes kanban log failed.' });
  }
});

app.get('/api/hermes/kanban/diagnostics', async (req, res) => {
  try {
    const board = kanbanBoard(req.query?.board || 'default');
    const args = ['kanban', '--board', board, 'diagnostics', '--json'];
    if (req.query?.task) args.push('--task', String(req.query.task));
    if (req.query?.severity) args.push('--severity', String(req.query.severity));
    const { stdout } = await runHermesCommand(args);
    res.json({ diagnostics: parseHermesJson(stdout, []) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes kanban diagnostics failed.' });
  }
});

app.post('/api/hermes/kanban/tasks/:id/reclaim', async (req, res) => {
  try {
    const board = kanbanBoard(req.body?.board || 'default');
    const args = ['kanban', '--board', board, 'reclaim', req.params.id];
    if (req.body?.reason) args.push('--reason', String(req.body.reason));
    await runHermesCommand(args);
    res.json({ ok: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes kanban reclaim failed.' });
  }
});

app.post('/api/hermes/kanban/tasks/:id/reassign', async (req, res) => {
  try {
    const board = kanbanBoard(req.body?.board || 'default');
    const assignee = String(req.body?.assignee || '').trim();
    if (!assignee) return res.status(400).json({ error: 'assignee is required.' });
    const args = ['kanban', '--board', board, 'reassign', req.params.id, assignee];
    if (req.body?.reclaim) args.push('--reclaim');
    if (req.body?.reason) args.push('--reason', String(req.body.reason));
    await runHermesCommand(args);
    res.json({ ok: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes kanban reassign failed.' });
  }
});

app.post('/api/hermes/kanban/tasks/:id/attachments', async (req, res) => {
  try {
    const board = kanbanBoard(req.body?.board || 'default');
    const filePath = path.resolve(String(req.body?.path || ''));
    if (!req.body?.path || !(await exists(filePath))) return res.status(400).json({ error: 'A readable attachment path is required.' });
    await runHermesCommand(['kanban', '--board', board, 'attach', req.params.id, filePath]);
    res.json({ ok: true, path: filePath });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes kanban attachment failed.' });
  }
});

app.get('/api/threads/:id/collaboration', async (req, res) => {
  try {
    const state = await readState();
    const thread = state.threads.find((item) => item.id === req.params.id);
    if (!thread) return res.status(404).json({ error: 'Thread not found.' });
    const snapshot = await collaborationSnapshot(state, thread, String(req.query?.workflowId || ''));
    if (projectCollaborationTaskTransitions(thread, snapshot)) await writeState(state);
    res.json({ snapshot });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Collaboration snapshot failed.' });
  }
});

app.get('/api/collaboration/overview', async (_req, res) => {
  try {
    const state = await readState();
    const entries = [];
    for (const thread of state.threads.filter((item) => !item.archivedAt)) {
      const snapshot = await collaborationSnapshot(state, thread);
      for (const workflow of snapshot.workflows) entries.push({ ...workflow, threadId: thread.id, threadTitle: thread.title });
    }
    res.json({ workflows: entries, checkedAt: now() });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Collaboration overview failed.' });
  }
});

app.get('/api/collaboration/resolve', async (req, res) => {
  try {
    const state = await readState();
    const taskId = String(req.query?.taskId || '').trim();
    const boardSlug = String(req.query?.boardSlug || '').trim();
    if (!taskId && !boardSlug) return res.status(400).json({ error: 'taskId or boardSlug is required.' });
    for (const thread of state.threads) {
      for (const workflow of thread.collaboration?.workflows || []) {
        if (boardSlug && workflow.boardSlug !== boardSlug) continue;
        if (taskId) {
          try {
            const detail = await readKanbanTaskDetail(workflow.boardSlug, taskId);
            if (!detail?.task?.id) continue;
          } catch {
            continue;
          }
        }
        return res.json({ threadId: thread.id, workflowId: workflow.id, boardSlug: workflow.boardSlug, coordinatorAgentId: workflow.coordinatorAgentId, fallbackDecisionAgentId: workflow.fallbackDecisionAgentId, taskId });
      }
    }
    res.status(404).json({ error: 'No collaboration workflow owns this task or board.' });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Collaboration context resolve failed.' });
  }
});

app.post('/api/threads/:id/collaboration/workflows', async (req, res) => {
  try {
    const state = await readState();
    const thread = state.threads.find((item) => item.id === req.params.id);
    if (!thread) return res.status(404).json({ error: 'Thread not found.' });
    const result = await createCollaborationWorkflow(state, thread, req.body || {});
    thread.updatedAt = now();
    await writeState(state);
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Collaboration workflow create failed.' });
  }
});

app.patch('/api/threads/:id/collaboration/workflows/:workflowId', async (req, res) => {
  try {
    const state = await readState();
    const thread = state.threads.find((item) => item.id === req.params.id);
    const workflow = workflowById(thread, req.params.workflowId);
    if (!thread || !workflow) return res.status(404).json({ error: 'Workflow not found.' });
    if (req.body?.active === true) thread.collaboration.activeWorkflowId = workflow.id;
    if (['active', 'completed', 'archived'].includes(req.body?.status)) {
      workflow.status = req.body.status;
      workflow.updatedAt = now();
      if (workflow.status === 'completed') workflow.completedAt = now();
      if (workflow.status === 'archived') {
        workflow.archivedAt = now();
        if (workflow.boardSlug !== 'default') await runHermesCommand(['kanban', 'boards', 'rm', workflow.boardSlug]);
      }
      if (workflow.status === 'completed' || workflow.status === 'archived') {
        appendThreadCollaborationEvent(thread, { type: `workflow.${workflow.status}`, workflowId: workflow.id, title: workflow.name });
      }
    }
    thread.updatedAt = now();
    await writeState(state);
    res.json({ workflow });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Collaboration workflow update failed.' });
  }
});

for (const action of ['pause', 'resume', 'cancel']) {
  app.post(`/api/threads/:id/collaboration/workflows/:workflowId/${action}`, async (req, res) => {
    try {
      const state = await readState();
      const thread = state.threads.find((item) => item.id === req.params.id);
      const workflow = workflowById(thread, req.params.workflowId);
      if (!thread || !workflow) return res.status(404).json({ error: 'Workflow not found.', code: 'WORKFLOW_NOT_FOUND' });
      const idempotencyKey = String(req.body?.idempotencyKey || '').trim();
      if (!idempotencyKey) return res.status(400).json({ error: 'idempotencyKey is required.', code: 'IDEMPOTENCY_KEY_REQUIRED' });
      const result = action === 'pause'
        ? await pauseCollaborationWorkflow(state, thread, workflow, idempotencyKey)
        : action === 'resume'
          ? await resumeCollaborationWorkflow(state, thread, workflow, idempotencyKey)
          : await cancelCollaborationWorkflow(state, thread, workflow, idempotencyKey);
      const snapshot = await collaborationSnapshot(state, thread, workflow.id);
      res.json({ ...result, workflow, snapshot });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message || `Workflow ${action} failed.`, code: error.code, details: error.details });
    }
  });
}

app.post('/api/threads/:id/collaboration/roots', async (req, res) => {
  try {
    const state = await readState();
    const thread = state.threads.find((item) => item.id === req.params.id);
    const workflow = workflowById(thread, req.body?.workflowId);
    if (!thread || !workflow) return res.status(404).json({ error: 'Workflow not found.' });
    const result = await createCollaborationRoot(state, thread, workflow, req.body || {});
    thread.updatedAt = now();
    await writeState(state);
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Collaboration root task create failed.' });
  }
});

app.get('/api/threads/:id/collaboration/plans/:rootTaskId', async (req, res) => {
  try {
    const state = await readState();
    const thread = state.threads.find((item) => item.id === req.params.id);
    const workflow = workflowById(thread, String(req.query?.workflowId || ''));
    if (!thread || !workflow) return res.status(404).json({ error: 'Workflow not found.' });
    if (workflow.currentRootTaskId && workflow.currentRootTaskId !== req.params.rootTaskId) return res.status(404).json({ error: 'Root task is not active in this workflow.' });
    res.json({ threadId: thread.id, workflowId: workflow.id, rootTaskId: req.params.rootTaskId, planRevision: Number(workflow.planRevision || 0), plan: workflow.plan || null, executionBindings: workflow.executionBindings || {} });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Collaboration plan read failed.', code: error.code || '' });
  }
});

app.post('/api/threads/:id/collaboration/plans', async (req, res) => {
  try {
    const state = await readState();
    const thread = state.threads.find((item) => item.id === req.params.id);
    if (thread?.collaborationMode === 'plan' && activePlanSession(thread)) {
      return res.status(409).json({ error: 'Plan 模式中不能发布 Work 执行方案。请先由用户批准计划。', code: 'PLAN_MUTATION_BLOCKED' });
    }
    const workflow = workflowById(thread, req.body?.workflowId);
    if (!thread || !workflow) return res.status(404).json({ error: 'Workflow not found.' });
    const cached = idempotentResult(thread.collaboration, req.body?.idempotencyKey);
    if (cached) return res.json({ ...cached, idempotent: true });
    const rootTaskId = String(req.body?.rootTaskId || workflow.currentRootTaskId || '').trim();
    if (!rootTaskId) return res.status(400).json({ error: 'rootTaskId is required.' });
    const plan = validateCollaborationPlan(req.body || {}, {
      agentIds: state.agents.map((agent) => agent.id),
      currentRevision: Number(workflow.planRevision || 0),
      rootTaskId,
    });
    const previousPlan = workflow.plan || { tasks: [] };
    const diff = diffCollaborationPlans(previousPlan, plan);
    const previousByKey = new Map((previousPlan.tasks || []).map((task) => [task.key, task]));
    const taskByKey = new Map();

    for (const task of plan.tasks) {
      const previous = previousByKey.get(task.key);
      if (previous?.taskId) {
        task.taskId = previous.taskId;
        taskByKey.set(task.key, task);
        const taskDetail = await readKanbanTaskDetail(workflow.boardSlug, task.taskId).catch(() => ({}));
        const currentTask = taskDetail?.task || taskDetail || {};
        const currentStatus = String(currentTask.status || '');
        const currentRun = Array.isArray(taskDetail?.runs) ? taskDetail.runs.at(-1) || {} : {};
        const contentChanged = previous.title !== task.title || previous.description !== task.description || previous.expectedResult !== task.expectedResult;
        const dependenciesChanged = JSON.stringify(previous.dependsOnKeys || []) !== JSON.stringify(task.dependsOnKeys || []);
        if (currentStatus === 'done' && !task.cancelled && (contentChanged || dependenciesChanged || previous.assigneeAgentId !== task.assigneeAgentId)) {
          const completedTaskId = task.taskId;
          const assignee = agentProfileForId(state, task.assigneeAgentId);
          const revisionNumber = Number(workflow.planRevision || 0) + 1;
          const body = [task.description, task.expectedResult ? `预期结果：${task.expectedResult}` : '', `这是已完成任务 ${completedTaskId} 的第 ${revisionNumber} 版修订任务。`, `Frakio 协作上下文：threadId=${thread.id} workflowId=${workflow.id} rootTaskId=${rootTaskId} taskKey=${task.key}`].filter(Boolean).join('\n\n');
          const args = ['kanban', '--board', workflow.boardSlug, 'create', `修订：${task.title}`, '--json', '--body', body, '--idempotency-key', `plan-revision:${workflow.id}:${rootTaskId}:${task.key}:${revisionNumber}`];
          if (assignee) args.push('--assignee', assignee);
          const revisionTask = parseHermesJson((await runHermesCommand(args)).stdout, {});
          task.taskId = revisionTask.id;
          task.revisionOfTaskId = completedTaskId;
          taskByKey.set(task.key, task);
          await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'link', completedTaskId, revisionTask.id]);
          appendThreadCollaborationEvent(thread, { type: 'task.created', workflowId: workflow.id, taskId: revisionTask.id, actorAgentId: workflow.coordinatorAgentId, title: `修订：${task.title}`, detail: `基于已完成任务 ${completedTaskId} 创建修订任务`, payload: { rootTaskId, taskKey: task.key, revisionOfTaskId: completedTaskId, assigneeAgentId: task.assigneeAgentId } });
        } else if (task.cancelled && !previous.cancelled && currentStatus !== 'done') {
          if (currentStatus === 'running') await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'reclaim', task.taskId, '--reason', '方案修订已取消任务']).catch(() => {});
          await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'archive', task.taskId]).catch(async () => {
            await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'block', task.taskId, '方案修订已取消该任务', '--kind', 'needs_input']);
          });
        } else if (!task.cancelled && JSON.stringify(previous) !== JSON.stringify(task)) {
          if (previous.assigneeAgentId !== task.assigneeAgentId) {
            const assignee = agentProfileForId(state, task.assigneeAgentId);
            if (assignee) await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'reassign', task.taskId, assignee, '--reclaim', '--reason', '执行方案修订']);
          }
          await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'comment', task.taskId, `PLAN REVISION ${Number(workflow.planRevision || 0) + 1}: ${task.description || task.expectedResult || task.title}`, '--author', 'Frakio Work']);
          if (currentStatus === 'running' && previous.assigneeAgentId === task.assigneeAgentId && contentChanged && !dependenciesChanged) {
            const sessionId = String(currentRun.session_id || currentRun.sessionId || workflow.executionBindings?.[task.key]?.sessionId || '');
            let steered = false;
            if (sessionId) {
              const steer = await requestHermesBridge({ action: 'steer', session_id: sessionId, text: `执行方案已修订：${task.description || task.expectedResult || task.title}` }, { timeoutMs: 3000, retryMs: 0 }).catch(() => null);
              steered = Boolean(steer?.accepted);
            }
            if (!steered) await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'reclaim', task.taskId, '--reason', '任务内容修订，安全重启当前 worker']).catch(() => {});
          } else if (currentStatus === 'running' && dependenciesChanged && previous.assigneeAgentId === task.assigneeAgentId) {
            await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'reclaim', task.taskId, '--reason', '新增依赖，在安全点暂停']).catch(() => {});
          }
        }
        continue;
      }
      const assignee = agentProfileForId(state, task.assigneeAgentId);
      const body = [task.description, task.expectedResult ? `预期结果：${task.expectedResult}` : '', `Frakio 协作上下文：threadId=${thread.id} workflowId=${workflow.id} rootTaskId=${rootTaskId} taskKey=${task.key}`].filter(Boolean).join('\n\n');
      const args = ['kanban', '--board', workflow.boardSlug, 'create', task.title, '--json', '--body', body, '--idempotency-key', `plan:${workflow.id}:${rootTaskId}:${task.key}`];
      if (assignee) args.push('--assignee', assignee);
      const created = parseHermesJson((await runHermesCommand(args)).stdout, {});
      task.taskId = created.id;
      taskByKey.set(task.key, task);
      appendThreadCollaborationEvent(thread, { type: 'task.created', workflowId: workflow.id, taskId: created.id, actorAgentId: workflow.coordinatorAgentId, title: task.title, detail: task.description || task.expectedResult, payload: { rootTaskId, taskKey: task.key, assigneeAgentId: task.assigneeAgentId } });
    }

    for (const task of plan.tasks.filter((item) => !item.cancelled)) {
      const previous = previousByKey.get(task.key);
      for (const removedDependencyKey of (previous?.dependsOnKeys || []).filter((key) => !task.dependsOnKeys.includes(key))) {
        const previousDependency = previousByKey.get(removedDependencyKey);
        if (previousDependency?.taskId && task.taskId) await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'unlink', previousDependency.taskId, task.taskId]).catch(() => {});
      }
      for (const dependencyKey of task.dependsOnKeys) {
        const dependency = taskByKey.get(dependencyKey);
        if (!dependency?.taskId || !task.taskId) continue;
        await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'link', dependency.taskId, task.taskId]);
        const alreadyRecorded = (thread.collaboration.events || []).some((event) => event.type === 'dependency.created' && event.workflowId === workflow.id && event.taskId === task.taskId && event.payload?.parentTaskId === dependency.taskId);
        if (!alreadyRecorded) appendThreadCollaborationEvent(thread, { type: 'dependency.created', workflowId: workflow.id, taskId: task.taskId, actorAgentId: workflow.coordinatorAgentId, title: `${task.title} 等待 ${dependency.title}`, detail: '执行方案依赖', payload: { parentTaskId: dependency.taskId, requesterTaskId: task.taskId, rootTaskId } });
      }
    }

    const activePlanTasks = plan.tasks.filter((task) => !task.cancelled && task.taskId);
    for (const task of activePlanTasks) await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'link', task.taskId, rootTaskId]);
    if (activePlanTasks.length) {
      await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'comment', rootTaskId, '执行方案已发布。所有父任务完成并自动恢复后，请读取父任务结果与交付物，生成面向用户的最终汇总，然后完成根任务。不要再次拆解同一批任务。', '--author', 'Frakio Work']);
      await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'block', rootTaskId, '等待执行方案中的任务完成', '--kind', 'dependency']);
    }

    const nextRevision = Number(workflow.planRevision || 0) + 1;
    const storedPlan = { ...plan, revision: nextRevision, tasks: plan.tasks, publishedAt: now(), coordinatorAgentId: workflow.coordinatorAgentId };
    workflow.plan = storedPlan;
    workflow.planRevision = nextRevision;
    workflow.executionBindings = Object.fromEntries(plan.tasks.filter((task) => task.taskId).map((task) => [task.key, {
      ...(workflow.executionBindings?.[task.key] || {}),
      taskId: task.taskId,
      agentId: task.assigneeAgentId,
      revision: nextRevision,
      sessionId: workflow.executionBindings?.[task.key]?.sessionId || `work-task-${task.taskId}-${task.assigneeAgentId}`,
      runId: workflow.executionBindings?.[task.key]?.runId || '',
      status: task.cancelled ? 'cancelled' : workflow.executionBindings?.[task.key]?.status || 'ready',
    }]));
    workflow.updatedAt = now();
    const eventType = nextRevision === 1 ? 'plan.published' : 'plan.revised';
    const event = appendThreadCollaborationEvent(thread, {
      type: eventType,
      workflowId: workflow.id,
      taskId: rootTaskId,
      actorAgentId: workflow.coordinatorAgentId,
      title: nextRevision === 1 ? '执行方案已发布' : `执行方案已更新至第 ${nextRevision} 版`,
      detail: plan.summary || plan.goal,
      payload: { revision: nextRevision, taskCount: activePlanTasks.length, agentIds: [...new Set(activePlanTasks.map((task) => task.assigneeAgentId))], diff },
    });
    const result = { workflowId: workflow.id, rootTaskId, plan: storedPlan, planRevision: nextRevision, diff, event };
    rememberIdempotent(thread.collaboration, req.body?.idempotencyKey, result);
    thread.updatedAt = now();
    for (const agentId of [...new Set(activePlanTasks.map((task) => task.assigneeAgentId))]) {
      const agent = state.agents.find((item) => item.id === agentId);
      if (agent) await ensureWorkbenchMcpServers(await resolveHermesProfileNameForAgent(agent));
    }
    await writeState(state);
    let dispatch = null;
    try {
      dispatch = parseHermesJson((await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'dispatch', '--max', '32', '--json'])).stdout, {});
    } catch (error) {
      dispatch = { deferredToGateway: true, error: String(error?.message || error) };
    }
    res.json({ ...result, dispatch });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Collaboration plan publish failed.', code: error.code || '' });
  }
});

app.post('/api/threads/:id/collaboration/dependencies', async (req, res) => {
  try {
    const state = await readState();
    const thread = state.threads.find((item) => item.id === req.params.id);
    const workflow = workflowById(thread, req.body?.workflowId);
    if (!thread || !workflow) return res.status(404).json({ error: 'Workflow not found.' });
    const cached = idempotentResult(thread.collaboration, req.body?.idempotencyKey);
    if (cached) return res.json({ ...cached, idempotent: true });
    const requesterTaskId = String(req.body?.requesterTaskId || '').trim();
    const title = String(req.body?.title || '').trim();
    if (!requesterTaskId || !title) return res.status(400).json({ error: 'requesterTaskId and title are required.' });
    if (req.body?.targetAgentId && !state.agents.some((agent) => agent.id === req.body.targetAgentId)) return res.status(400).json({ error: 'targetAgentId must reference an available Agent.' });
    const requesterDetail = await readKanbanTaskDetail(workflow.boardSlug, requesterTaskId).catch(() => ({}));
    const requesterTitle = requesterDetail?.task?.title || requesterTaskId;
    const assignee = agentProfileForId(state, req.body?.targetAgentId);
    const createArgs = ['kanban', '--board', workflow.boardSlug, 'create', title, '--json'];
    if (req.body?.body) createArgs.push('--body', String(req.body.body));
    if (assignee) createArgs.push('--assignee', assignee);
    if (req.body?.idempotencyKey) createArgs.push('--idempotency-key', String(req.body.idempotencyKey));
    const created = await runHermesCommand(createArgs);
    const dependencyTask = parseHermesJson(created.stdout, {});
    await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'link', dependencyTask.id, requesterTaskId]);
    const reason = String(req.body?.reason || `等待 ${dependencyTask.title || dependencyTask.id} 交付`).trim();
    await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'block', requesterTaskId, reason, '--kind', 'dependency']);
    const event = appendThreadCollaborationEvent(thread, { type: 'dependency.created', workflowId: workflow.id, taskId: requesterTaskId, actorAgentId: req.body?.actorAgentId || '', title: `${requesterTitle} 等待 ${dependencyTask.title || dependencyTask.id}`, detail: reason, payload: { parentTaskId: dependencyTask.id, requesterTaskId, targetAgentId: req.body?.targetAgentId || '' } });
    appendThreadCollaborationEvent(thread, { type: 'task.waiting', workflowId: workflow.id, taskId: requesterTaskId, title: `${requesterTitle} 正在等待`, detail: reason, payload: { blockKind: 'dependency', parentTaskId: dependencyTask.id } });
    const result = { dependencyTask, requesterTaskId, event };
    rememberIdempotent(thread.collaboration, req.body?.idempotencyKey, result);
    thread.updatedAt = now();
    await writeState(state);
    const dispatch = await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'dispatch', '--max', '8', '--json']).then(({ stdout }) => parseHermesJson(stdout, {})).catch((error) => ({ deferredToGateway: true, error: String(error?.message || error) }));
    res.json({ ...result, dispatch });
  } catch (error) {
    const message = String(error.message || 'Collaboration dependency request failed.');
    res.status(error.status || (/cycle/i.test(message) ? 409 : 500)).json({ error: message, code: /cycle/i.test(message) ? 'KANBAN_DEPENDENCY_CYCLE' : undefined });
  }
});

app.post('/api/threads/:id/collaboration/blockers', async (req, res) => {
  try {
    const state = await readState();
    const thread = state.threads.find((item) => item.id === req.params.id);
    const workflow = workflowById(thread, req.body?.workflowId);
    if (!thread || !workflow) return res.status(404).json({ error: 'Workflow not found.' });
    const kind = ['dependency', 'needs_input', 'capability', 'transient'].includes(req.body?.kind) ? req.body.kind : 'needs_input';
    if (kind === 'dependency') return res.status(400).json({ error: 'Use the dependency request endpoint for dependency blockers.' });
    const cached = idempotentResult(thread.collaboration, req.body?.idempotencyKey);
    if (cached) return res.json({ ...cached, idempotent: true });
    const taskId = String(req.body?.taskId || '').trim();
    const evidence = String(req.body?.evidence || req.body?.reason || '').trim();
    if (!taskId || !evidence) return res.status(400).json({ error: 'taskId and evidence are required.' });
    if (kind === 'transient') {
      const priorFailures = (thread.collaboration.events || []).filter((event) => event.workflowId === workflow.id && event.taskId === taskId && event.type === 'task.failed' && event.payload?.blockKind === 'transient').length;
      if (priorFailures < 2) {
        await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'block', taskId, evidence, '--kind', 'transient']);
        await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'unblock', '--reason', `临时故障自动重试 ${priorFailures + 1}/2`, taskId]);
        const event = appendThreadCollaborationEvent(thread, { type: 'task.failed', workflowId: workflow.id, taskId, actorAgentId: req.body?.actorAgentId || '', title: '任务遇到临时故障', detail: evidence, payload: { blockKind: kind, retryAttempt: priorFailures + 1, retryLimit: 2 } });
        appendThreadCollaborationEvent(thread, { type: 'task.resumed', workflowId: workflow.id, taskId, actorAgentId: 'system', title: `正在进行第 ${priorFailures + 1} 次自动重试`, detail: evidence, payload: { blockKind: kind, retryAttempt: priorFailures + 1 } });
        const result = { taskId, kind, retryScheduled: true, retryAttempt: priorFailures + 1, event };
        rememberIdempotent(thread.collaboration, req.body?.idempotencyKey, result);
        await writeState(state);
        const dispatch = await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'dispatch', '--max', '4', '--json']).then(({ stdout }) => parseHermesJson(stdout, {})).catch((error) => ({ deferredToGateway: true, error: String(error?.message || error) }));
        return res.json({ ...result, dispatch });
      }
    }
    const actorAgentId = String(req.body?.actorAgentId || '');
    const decisionAgentId = actorAgentId === workflow.coordinatorAgentId
      ? workflow.fallbackDecisionAgentId
      : workflow.coordinatorAgentId;
    const isFallback = decisionAgentId === workflow.fallbackDecisionAgentId;
    const priorEscalations = (thread.collaboration.events || []).filter((event) => event.workflowId === workflow.id && event.taskId === taskId && event.type === 'escalation.started').length;
    const decisionAgentAvailable = state.agents.some((agent) => agent.id === decisionAgentId);
    const mustAskHuman = Boolean(req.body?.requiresUserApproval) || !decisionAgentAvailable || actorAgentId === workflow.fallbackDecisionAgentId || decisionAgentId === actorAgentId;
    if (!decisionAgentId || priorEscalations >= 2 || mustAskHuman) {
      await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'block', taskId, evidence, '--kind', kind]);
      const event = appendThreadCollaborationEvent(thread, { type: 'human.required', workflowId: workflow.id, taskId, actorAgentId, title: '需要人工介入', detail: evidence, payload: { blockKind: kind, attempts: priorEscalations, requiresUserApproval: Boolean(req.body?.requiresUserApproval) } });
      const result = { taskId, kind, humanRequired: true, event };
      rememberIdempotent(thread.collaboration, req.body?.idempotencyKey, result);
      await writeState(state);
      return res.json(result);
    }
    const decisionTitle = `解决阻塞：${String(req.body?.taskTitle || taskId).slice(0, 80)}`;
    const decisionBody = `来源任务：${taskId}\n阻塞类型：${kind}\n证据：${evidence}\n请提出可执行解决方案；能解决则完成本任务并写明决定，无法解决则调用请求决策工具继续升级。`;
    const assignee = agentProfileForId(state, decisionAgentId);
    const createArgs = ['kanban', '--board', workflow.boardSlug, 'create', decisionTitle, '--json', '--body', decisionBody];
    if (assignee) createArgs.push('--assignee', assignee);
    if (req.body?.idempotencyKey) createArgs.push('--idempotency-key', `${req.body.idempotencyKey}:decision`);
    const created = await runHermesCommand(createArgs);
    const decisionTask = parseHermesJson(created.stdout, {});
    await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'link', decisionTask.id, taskId]);
    await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'block', taskId, evidence, '--kind', 'dependency']);
    const event = appendThreadCollaborationEvent(thread, { type: 'escalation.started', workflowId: workflow.id, taskId, actorAgentId: req.body?.actorAgentId || '', title: isFallback ? '已升级给全局决策 Agent' : '已交给工作流协调 Agent', detail: evidence, payload: { blockKind: kind, decisionTaskId: decisionTask.id, decisionAgentId, level: isFallback ? 'fallback' : 'coordinator' } });
    const result = { taskId, kind, decisionTask, decisionAgentId, event };
    rememberIdempotent(thread.collaboration, req.body?.idempotencyKey, result);
    thread.updatedAt = now();
    await writeState(state);
    const dispatch = await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'dispatch', '--max', '4', '--json']).then(({ stdout }) => parseHermesJson(stdout, {})).catch((error) => ({ deferredToGateway: true, error: String(error?.message || error) }));
    res.json({ ...result, dispatch });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Collaboration blocker report failed.' });
  }
});

app.post('/api/threads/:id/collaboration/tasks/:taskId/artifacts', async (req, res) => {
  try {
    const state = await readState();
    const thread = state.threads.find((item) => item.id === req.params.id);
    const workflow = workflowById(thread, req.body?.workflowId);
    if (!thread || !workflow) return res.status(404).json({ error: 'Workflow not found.' });
    const summary = String(req.body?.summary || '').trim();
    if (!summary && !req.body?.path) return res.status(400).json({ error: 'summary or path is required.' });
    if (summary) await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'comment', req.params.taskId, `ARTIFACT: ${summary}`, '--author', String(req.body?.author || 'Frakio Work')]);
    if (req.body?.path) await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'attach', req.params.taskId, path.resolve(String(req.body.path))]);
    const event = appendThreadCollaborationEvent(thread, { type: 'artifact.published', workflowId: workflow.id, taskId: req.params.taskId, actorAgentId: req.body?.actorAgentId || '', title: req.body?.name || '已发布交付物', detail: summary, payload: { path: req.body?.path || '' } });
    await writeState(state);
    res.json({ ok: true, event });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Collaboration artifact publish failed.' });
  }
});

app.post('/api/threads/:id/collaboration/tasks/:taskId/complete', async (req, res) => {
  try {
    const state = await readState();
    const thread = state.threads.find((item) => item.id === req.params.id);
    const workflow = workflowById(thread, req.body?.workflowId);
    if (!thread || !workflow) return res.status(404).json({ error: 'Workflow not found.' });
    const summary = String(req.body?.summary || 'Completed from Frakio Work');
    await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'complete', req.params.taskId, '--summary', summary]);
    const event = appendThreadCollaborationEvent(thread, { type: 'task.completed', workflowId: workflow.id, taskId: req.params.taskId, actorAgentId: req.body?.actorAgentId || '', title: req.body?.title || '任务已完成', detail: summary });
    for (const dependency of (thread.collaboration.events || []).filter((item) => item.workflowId === workflow.id && item.type === 'dependency.created' && item.payload?.parentTaskId === req.params.taskId)) {
      const alreadySatisfied = (thread.collaboration.events || []).some((item) => item.type === 'dependency.satisfied' && item.workflowId === workflow.id && item.taskId === dependency.taskId && item.payload?.parentTaskId === req.params.taskId);
      if (!alreadySatisfied) appendThreadCollaborationEvent(thread, { type: 'dependency.satisfied', workflowId: workflow.id, taskId: dependency.taskId || '', title: `${req.body?.title || req.params.taskId} 已完成交付`, detail: '等待任务将在所有父任务完成后自动恢复', payload: { parentTaskId: req.params.taskId } });
    }
    workflow.taskStatusProjection = { ...(workflow.taskStatusProjection || {}), [req.params.taskId]: { status: 'done', title: req.body?.title || req.params.taskId } };
    await writeState(state);
    const dispatch = await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'dispatch', '--max', '8', '--json']).then(({ stdout }) => parseHermesJson(stdout, {})).catch((error) => ({ deferredToGateway: true, error: String(error?.message || error) }));
    res.json({ ok: true, event, dispatch });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Collaboration task complete failed.' });
  }
});

app.post('/api/threads/:id/collaboration/interventions', async (req, res) => {
  try {
    const state = await readState();
    const thread = state.threads.find((item) => item.id === req.params.id);
    const workflow = workflowById(thread, req.body?.workflowId);
    if (!thread || !workflow) return res.status(404).json({ error: 'Workflow not found.' });
    const taskId = String(req.body?.taskId || (req.body?.action === 'steer' ? workflow.currentRootTaskId : '') || '').trim();
    const action = String(req.body?.action || 'message');
    const detail = String(req.body?.message || req.body?.reason || '').trim();
    if (!taskId) return res.status(400).json({ error: 'taskId is required.' });
    if (workflow.status === 'paused' && ['pause', 'resume', 'reassign', 'human_required'].includes(action)) {
      return res.status(409).json({ error: '工作流已全局暂停，请先恢复工作流。', code: 'WORKFLOW_PAUSED' });
    }
    if (action === 'steer') {
      const result = await queueWorkSteer(state, thread, workflow, { message: detail, idempotencyKey: req.body?.idempotencyKey || `intervention:${req.body?.interventionId || id('steer')}`, actorAgentId: 'user' });
      await writeState(state);
      return res.json({ ok: true, ...result });
    }
    if (action === 'pause') await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'block', taskId, detail || '用户暂停', '--kind', 'needs_input']);
    else if (action === 'resume') await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'unblock', '--reason', detail || '用户恢复', taskId]);
    else if (action === 'reassign') {
      const assignee = agentProfileForId(state, req.body?.targetAgentId);
      if (!assignee) return res.status(400).json({ error: 'targetAgentId is required for reassign.' });
      const args = ['kanban', '--board', workflow.boardSlug, 'reassign', taskId, assignee, '--reason', detail || '用户转交'];
      if (req.body?.reclaim) args.push('--reclaim');
      await runHermesCommand(args);
    } else if (action === 'human_required') {
      await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'block', taskId, detail || '需要人工介入', '--kind', 'needs_input']);
    } else if (detail) {
      await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'comment', taskId, detail, '--author', 'user']);
      const taskDetail = await readKanbanTaskDetail(workflow.boardSlug, taskId).catch(() => ({}));
      const task = taskDetail?.task || taskDetail || {};
      if (task.status === 'blocked' || task.status === 'scheduled') {
        await runHermesCommand(['kanban', '--board', workflow.boardSlug, 'unblock', '--reason', '收到用户补充指令', taskId]);
        workflow.taskStatusProjection = { ...(workflow.taskStatusProjection || {}), [taskId]: { ...task, status: 'ready' } };
        appendThreadCollaborationEvent(thread, { type: 'task.resumed', workflowId: workflow.id, taskId, actorAgentId: 'user', title: `${task.title || taskId} 已恢复`, detail: '收到用户补充指令后自动恢复执行' });
      }
    }
    const type = action === 'human_required' ? 'human.required' : 'intervention.sent';
    const event = appendThreadCollaborationEvent(thread, { type, workflowId: workflow.id, taskId, actorAgentId: 'user', title: `用户${action === 'message' ? '发送了指令' : action}`, detail, payload: { action, targetAgentId: req.body?.targetAgentId || '' } });
    await writeState(state);
    res.json({ ok: true, event });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Collaboration intervention failed.' });
  }
});

app.get('/api/threads/:id/collaboration/events', async (req, res) => {
  const state = await readState();
  const thread = state.threads.find((item) => item.id === req.params.id);
  if (!thread) return res.status(404).json({ error: 'Thread not found.' });
  const workflowId = String(req.query?.workflowId || '');
  const afterCursor = Number(req.query?.afterCursor || req.headers['last-event-id'] || 0);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.write('retry: 2000\n\n');
  for (const event of collaborationEventsAfter(thread.collaboration || {}, afterCursor, workflowId)) {
    res.write(`id: ${event.cursor}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }
  let lastSnapshot = '';
  const pushSnapshot = async () => {
    try {
      const currentState = await readState();
      const currentThread = currentState.threads.find((item) => item.id === thread.id);
      if (!currentThread) return;
      const snapshot = await collaborationSnapshot(currentState, currentThread, workflowId);
      if (projectCollaborationTaskTransitions(currentThread, snapshot)) await writeState(currentState);
      const serialized = JSON.stringify(snapshot);
      if (serialized !== lastSnapshot) {
        lastSnapshot = serialized;
        res.write(`event: collaboration.snapshot\ndata: ${serialized}\n\n`);
      } else {
        res.write(': heartbeat\n\n');
      }
    } catch (error) {
      res.write(`event: collaboration.error\ndata: ${JSON.stringify({ error: String(error?.message || error) })}\n\n`);
    }
  };
  await pushSnapshot();
  const timer = setInterval(() => void pushSnapshot(), 1500);
  req.on('close', () => {
    clearInterval(timer);
  });
});

app.get('/api/agents', (_req, res) => {
  readState().then((state) => res.json({ agents: state.agents }));
});

app.get('/api/runtimes', async (_req, res) => {
  try {
    const runtimes = runtimeRegistry.snapshot();
    void runtimeRegistry.refresh().catch(() => {});
    res.json({ runtimes, databasePath: runtimeDatabasePath });
  } catch (error) {
    res.status(500).json({ error: error.message || '运行时状态读取失败。' });
  }
});

app.post('/api/runtimes/:id/detect', async (req, res) => {
  try {
    const runtime = await runtimeRegistry.refresh(req.params.id);
    if (!runtime) return res.status(404).json({ error: 'Runtime not found.' });
    return res.json({ runtime });
  } catch (error) {
    return res.status(502).json({ error: error.message || '运行时检测失败。' });
  }
});

app.get('/api/runtimes/:id/models', async (req, res) => {
  try {
    if (req.params.id === 'codex') return res.json({ runtimeId: 'codex', models: await codexBridge.listModels(), source: 'native-account' });
    if (req.params.id === 'pi' || req.params.id === 'hermes') {
      const state = await readState();
      const models = await Promise.all(state.models.map(async (model) => ({
        id: model.id,
        name: model.name,
        provider: model.provider,
        defaultModelId: model.model,
        models: model.models || [model.model].filter(Boolean),
        compatibility: await runtimeModelCompatibility(req.params.id, model, state.models, state.features),
      })));
      return res.json({
        runtimeId: req.params.id,
        source: 'frakio-model-center',
        models,
        usableModelCount: models.reduce((total, model) => total + model.compatibility.usableModelIds.length, 0),
      });
    }
    return res.status(409).json({ error: '该运行时尚未提供模型目录。', code: 'RUNTIME_MODELS_UNAVAILABLE' });
  } catch (error) {
    return res.status(502).json({ error: error.message || '运行时模型读取失败。' });
  }
});

app.get('/api/runtime-sessions', (req, res) => {
  res.json({
    sessions: runtimeStore.listSessions({
      threadId: String(req.query.threadId || ''),
      agentId: String(req.query.agentId || ''),
      runtimeId: String(req.query.runtimeId || ''),
      limit: Number(req.query.limit || 100),
    }),
  });
});

app.post('/api/runtime-sessions', async (req, res) => {
  const state = await readState();
  const thread = state.threads.find((item) => item.id === req.body?.threadId);
  const agent = state.agents.find((item) => item.id === req.body?.agentId);
  if (!thread || !agent) return res.status(404).json({ error: '会话或 Agent 不存在。' });
  const runtimeId = String(req.body?.runtimeId || runtimeForAgent(agent));
  const policy = normalizeRuntimePolicy(agent.runtimePolicy, { hasHermesProfile: Boolean(agent.profileName) });
  if (!policy.allowedRuntimeIds.includes(runtimeId)) return res.status(409).json({ error: 'Agent 没有启用该运行时。', code: 'RUNTIME_NOT_ALLOWED' });
  const session = runtimeStore.upsertSession({
    runtimeId,
    threadId: thread.id,
    agentId: agent.id,
    workspaceId: thread.workspaceId || '',
    profileRevision: agentProfileRevision(agent),
    status: 'idle',
    metadata: { createdBy: 'runtime-api' },
  });
  res.status(201).json({ session });
});

app.post('/api/runtime-sessions/:id/runs', async (req, res) => {
  const session = runtimeStore.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: '运行会话不存在。' });
  return startRuntimeRunRequest({
    ...req,
    params: { id: session.threadId },
    body: { ...(req.body || {}), targetAgentId: session.agentId, runtimeId: session.runtimeId },
  }, res);
});

app.post('/api/runtime-runs/:id/steer', async (req, res) => {
  try {
    const run = runtimeStore.getRun(req.params.id);
    const session = run ? runtimeStore.getSession(run.sessionId) : null;
    if (!run || !session) return res.status(404).json({ error: '运行不存在。' });
    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ error: '指令不能为空。' });
    if (run.runtimeId === 'pi') await piBridge.steer(session.id, message);
    else if (run.runtimeId === 'codex') await codexBridge.steer(session.id, message);
    else if (run.runtimeId === 'claude') await claudeBridge.steer(session.id, message);
    else if (run.runtimeId === 'gemini') await geminiBridge.steer(session.id, message);
    else if (run.runtimeId === 'hermes') {
      await requestHermesBridge({ action: 'steer', session_id: session.nativeSessionId, run_id: run.id, message }, { timeoutMs: 10000, retryMs: 1000 });
    } else return res.status(409).json({ error: '该外部通道尚未启用 steering。' });
    res.json({ ok: true });
  } catch (error) {
    res.status(502).json({ error: error.message || '运行指令发送失败。' });
  }
});

app.post('/api/runtime-runs/:id/cancel', async (req, res) => {
  try {
    const run = runtimeStore.getRun(req.params.id);
    const session = run ? runtimeStore.getSession(run.sessionId) : null;
    if (!run || !session) return res.status(404).json({ error: '运行不存在。' });
    if (run.runtimeId === 'pi') await piBridge.cancel(session.id);
    else if (run.runtimeId === 'codex') await codexBridge.cancel(session.id);
    else if (run.runtimeId === 'claude') await claudeBridge.cancel(session.id);
    else if (run.runtimeId === 'gemini') await geminiBridge.cancel(session.id);
    else if (run.runtimeId === 'hermes') {
      await requestHermesBridge({ action: 'interrupt', session_id: session.nativeSessionId, run_id: run.id, message: '用户请求停止。' }, { timeoutMs: 10000, retryMs: 1000 });
    } else return res.status(409).json({ error: '该外部通道尚未启用取消操作。' });
    res.json({ ok: true, resolved: true });
  } catch (error) {
    res.status(502).json({ error: error.message || '停止运行失败。', resolved: false });
  }
});

app.post('/api/runtime-runs/:id/approve', async (req, res) => {
  try {
    const run = runtimeStore.getRun(req.params.id);
    const session = run ? runtimeStore.getSession(run.sessionId) : null;
    if (!run || !session) return res.status(404).json({ error: '运行不存在。' });
    const approvalId = String(req.body?.approvalId || '').trim();
    if (!approvalId) return res.status(400).json({ error: 'approvalId 不能为空。' });
    if (run.runtimeId === 'codex') {
      const result = await codexBridge.resolveApproval(approvalId, req.body?.decision || 'approve_once');
      return res.json({ ok: true, result });
    }
    if (run.runtimeId === 'claude') {
      const result = await claudeBridge.resolveApproval(approvalId, req.body?.decision || 'approve_once');
      return res.json({ ok: true, result });
    }
    if (run.runtimeId === 'gemini') {
      const result = await geminiBridge.resolveApproval(approvalId, req.body?.decision || 'approve_once');
      return res.json({ ok: true, result });
    }
    if (run.runtimeId !== 'hermes') return res.status(409).json({ error: '该运行时没有待处理的原生审批。' });
    const result = await requestHermesBridge({
      action: 'approval_respond',
      approval_id: approvalId,
      decision: req.body?.decision || 'approve_once',
      session_id: session.nativeSessionId,
      run_id: run.id,
    }, { timeoutMs: 10000, retryMs: 1000 });
    res.json({ ok: true, result });
  } catch (error) {
    res.status(502).json({ error: error.message || '审批响应失败。' });
  }
});

app.get('/api/runtime-runs/:id/events', (req, res) => {
  const run = runtimeStore.getRun(req.params.id);
  if (!run) return res.status(404).json({ error: '运行不存在。' });
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  let cursor = Math.max(0, Number(req.query.cursor || req.headers['last-event-id'] || 0) || 0);
  const send = () => {
    for (const event of runtimeStore.eventsAfter(run.id, cursor)) {
      cursor = event.cursor;
      res.write(`id: ${event.cursor}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }
    const latest = runtimeStore.getRun(run.id);
    if (['completed', 'failed', 'cancelled'].includes(latest?.status)) {
      clearInterval(timer);
      res.end();
    }
  };
  const timer = setInterval(send, 350);
  send();
  req.on('close', () => clearInterval(timer));
});

app.get('/api/workflows/:id/tasks', (req, res) => {
  res.json({ tasks: runtimeStore.listWorkTasks(req.params.id) });
});

app.post('/api/workflows/:id/dispatch', async (req, res) => {
  try {
    const state = await readState();
    const thread = state.threads.find((item) => (item.collaboration?.workflows || []).some((workflow) => workflow.id === req.params.id));
    if (!thread) return res.status(404).json({ error: 'Workflow 不存在。' });
    const reconciliation = workScheduler.reconcile(req.params.id);
    const concurrency = Math.max(1, Math.min(8, Number(req.body?.concurrency || 2)));
    const candidates = workScheduler.runnable(req.params.id, {
      concurrency,
      runtimeLimits: {
        pi: Math.max(1, Math.min(8, Number(req.body?.piConcurrency || concurrency))),
        codex: Math.max(1, Math.min(8, Number(req.body?.codexConcurrency || concurrency))),
        claude: Math.max(1, Math.min(8, Number(req.body?.claudeConcurrency || concurrency))),
        gemini: Math.max(1, Math.min(8, Number(req.body?.geminiConcurrency || concurrency))),
        hermes: 1,
      },
    });
    const deferredToHermesGateway = candidates.filter((task) => task.runtimeId === 'hermes').map((task) => task.id);
    const deferredToExternalChannels = candidates
      .filter((task) => !['hermes', 'pi', 'codex', 'claude', 'gemini'].includes(task.runtimeId))
      .map((task) => ({ taskId: task.id, runtimeId: task.runtimeId }));
    const workspace = state.workspaces.find((item) => item.id === thread.workspaceId) || null;
    const dispatched = [];
    const failed = [];
    for (const candidate of candidates.filter((task) => ['pi', 'codex', 'claude', 'gemini'].includes(task.runtimeId))) {
      let task = candidate;
      const needsWorktree = ['code', 'git'].includes(String(task.metadata?.outputKind || task.metadata?.artifactType || '').toLowerCase());
      if (needsWorktree && workspace?.rootPath) {
        try {
          const isolated = await worktreeManager.create({
            repositoryPath: workspace.rootPath,
            workspaceId: workspace.id,
            taskId: task.id,
          });
          task = runtimeStore.upsertWorkTask({
            ...task,
            worktreePath: isolated.worktreePath,
            idempotencyKey: task.idempotencyKey,
            metadata: { ...task.metadata, worktreeBranch: isolated.branch },
          });
        } catch (error) {
          failed.push({ taskId: task.id, error: error.message || String(error), code: 'WORKTREE_CREATE_FAILED' });
          continue;
        }
      }
      task = workScheduler.claim(task.id, { worktreePath: task.worktreePath });
      if (!task) continue;
      const outcome = await new Promise((resolve) => {
        let statusCode = 200;
        const response = {
          status(code) { statusCode = code; return this; },
          json(payload) { resolve({ status: statusCode, payload }); return this; },
        };
        void startRuntimeRunRequest({
          params: { id: thread.id },
          body: {
            message: task.description || task.title,
            turnId: `task-${task.id}-${Date.now()}`,
            targetAgentId: task.assigneeAgentId,
            runtimeId: task.runtimeId,
            taskId: task.id,
            taskDispatch: true,
          },
          query: {},
          headers: {},
        }, response);
      });
      if (outcome.status >= 400) {
        runtimeStore.upsertWorkTask({ ...task, status: 'failed', leaseExpiresAt: null, idempotencyKey: task.idempotencyKey });
        failed.push({ taskId: task.id, ...outcome.payload });
      } else {
        dispatched.push({ taskId: task.id, worktreePath: task.worktreePath, ...outcome.payload });
      }
    }
    res.status(dispatched.length ? 202 : 200).json({
      dispatched,
      failed,
      deferredToHermesGateway,
      deferredToExternalChannels,
      recovered: reconciliation.recovered.map((task) => task.id),
      promoted: reconciliation.promoted.map((task) => task.id),
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Workflow 调度失败。' });
  }
});

app.get('/api/memory', (req, res) => {
  res.json({
    entries: runtimeStore.listMemory({
      scope: String(req.query.scope || ''),
      subjectId: String(req.query.subjectId || ''),
      status: String(req.query.status || ''),
      query: String(req.query.query || ''),
      limit: Number(req.query.limit || 100),
    }),
  });
});

app.post('/api/memory', (req, res) => {
  try {
    const entry = memoryLedger.propose({
      scope: req.body?.scope,
      subjectId: req.body?.subjectId,
      fact: req.body?.fact,
      confidence: req.body?.confidence,
      validFrom: req.body?.validFrom || null,
      validUntil: req.body?.validUntil || null,
      provenance: [{ source: 'user', threadId: req.body?.threadId || '' }],
    });
    res.status(201).json({ entry });
  } catch (error) {
    res.status(400).json({ error: error.message || '记忆候选创建失败。' });
  }
});

app.patch('/api/memory/:id', (req, res) => {
  const action = String(req.body?.action || '');
  const entry = action === 'accept'
    ? memoryLedger.accept(req.params.id, { confidence: req.body?.confidence, supersedesId: req.body?.supersedesId })
    : action === 'reject'
      ? memoryLedger.reject(req.params.id)
      : runtimeStore.updateMemory(req.params.id, req.body || {});
  if (!entry) return res.status(404).json({ error: '记忆不存在。' });
  res.json({ entry });
});

app.post('/api/workspaces/:id/knowledge/initialize', async (req, res) => {
  try {
    const state = await readState();
    const workspace = state.workspaces.find((item) => item.id === req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Workspace 不存在。' });
    const vault = state.vaults.find((item) => item.id === (workspace.primaryVaultId || workspace.vaultId));
    if (!vault) return res.status(409).json({ error: 'Workspace 尚未绑定主 Vault。' });
    const initialized = await knowledgeGateway.initializeVault(vault);
    const index = await knowledgeGateway.index(vault);
    vault.index = { ...(vault.index || {}), ...index };
    workspace.primaryVaultId = vault.id;
    workspace.vaultId = vault.id;
    workspace.writableVaultIds = Array.from(new Set([...(workspace.writableVaultIds || []), vault.id]));
    workspace.updatedAt = now();
    await writeState(state);
    res.json({ workspace, vault, initialized, index });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Knowledge Vault 初始化失败。' });
  }
});

app.get('/api/workspaces/:id/knowledge', async (req, res) => {
  try {
    const state = await readState();
    const workspace = state.workspaces.find((item) => item.id === req.params.id);
    const vault = state.vaults.find((item) => item.id === (workspace?.primaryVaultId || workspace?.vaultId));
    if (!workspace || !vault) return res.status(404).json({ error: 'Workspace 或主 Vault 不存在。' });
    const index = await knowledgeGateway.index(vault);
    res.json({
      workspace: {
        id: workspace.id,
        name: workspace.name,
        primaryVaultId: workspace.primaryVaultId || workspace.vaultId,
        sharedVaultIds: workspace.sharedVaultIds || [],
        writableVaultIds: workspace.writableVaultIds || [],
      },
      vault,
      index,
      commits: runtimeStore.listKnowledgeCommits(workspace.id, Number(req.query.limit || 100)),
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Knowledge 状态读取失败。' });
  }
});

app.post('/api/workspaces/:id/knowledge/index', async (req, res) => {
  try {
    const state = await readState();
    const workspace = state.workspaces.find((item) => item.id === req.params.id);
    const vault = state.vaults.find((item) => item.id === (workspace?.primaryVaultId || workspace?.vaultId));
    if (!workspace || !vault) return res.status(404).json({ error: 'Workspace 或主 Vault 不存在。' });
    const index = await knowledgeGateway.index(vault);
    vault.index = { ...(vault.index || {}), ...index };
    await writeState(state);
    res.json({ index });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Knowledge 索引失败。' });
  }
});

app.post('/api/workspaces/:id/knowledge/drafts', async (req, res) => {
  try {
    const state = await readState();
    const workspace = state.workspaces.find((item) => item.id === req.params.id);
    const vault = state.vaults.find((item) => item.id === (workspace?.primaryVaultId || workspace?.vaultId));
    if (!workspace || !vault) return res.status(404).json({ error: 'Workspace 或主 Vault 不存在。' });
    if (!(workspace.writableVaultIds || [workspace.primaryVaultId || workspace.vaultId]).includes(vault.id)) {
      return res.status(403).json({ error: '主 Vault 当前是只读绑定。' });
    }
    const runId = String(req.body?.runId || `manual-${randomUUID()}`);
    const draft = await knowledgeGateway.draftWrite({
      workspace,
      vault,
      runId,
      relativePath: req.body?.path,
      content: req.body?.content,
    });
    res.status(201).json({ runId, draft });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message || 'Knowledge 草稿写入失败。' });
  }
});

app.post('/api/workspaces/:id/knowledge/publish', async (req, res) => {
  try {
    const state = await readState();
    const workspace = state.workspaces.find((item) => item.id === req.params.id);
    const vault = state.vaults.find((item) => item.id === (workspace?.primaryVaultId || workspace?.vaultId));
    if (!workspace || !vault) return res.status(404).json({ error: 'Workspace 或主 Vault 不存在。' });
    if (!(workspace.writableVaultIds || [workspace.primaryVaultId || workspace.vaultId]).includes(vault.id)) {
      return res.status(403).json({ error: '主 Vault 当前是只读绑定。' });
    }
    const published = await knowledgeGateway.publish({
      workspace,
      vault,
      runId: String(req.body?.runId || ''),
      draftPath: req.body?.draftPath,
      targetPath: req.body?.targetPath || '',
    });
    res.json({ published });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message || 'Knowledge 发布失败。' });
  }
});

app.get('/api/workspaces/:id/knowledge/search', async (req, res) => {
  try {
    const state = await readState();
    const workspace = state.workspaces.find((item) => item.id === req.params.id);
    const vault = state.vaults.find((item) => item.id === (workspace?.primaryVaultId || workspace?.vaultId));
    if (!workspace || !vault) return res.status(404).json({ error: 'Workspace 或主 Vault 不存在。' });
    const readableVaults = [vault, ...(workspace.sharedVaultIds || []).map((vaultId) => state.vaults.find((item) => item.id === vaultId)).filter(Boolean)];
    const groups = await Promise.all(readableVaults.map(async (readableVault) => ({
      vaultId: readableVault.id,
      vaultName: readableVault.name,
      results: await knowledgeGateway.search(readableVault, req.query.q, { limit: req.query.limit }),
    })));
    res.json({
      results: groups.flatMap((group) => group.results.map((result) => ({ ...result, vaultId: group.vaultId, vaultName: group.vaultName }))),
      commits: runtimeStore.listKnowledgeCommits(workspace.id, 30),
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '知识检索失败。' });
  }
});

app.get('/api/models', async (_req, res) => {
  const state = await readState();
  res.json({ models: state.models.map(publicModel) });
});

app.get('/api/oauth-accounts', async (_req, res) => {
  const state = await readState();
  const accounts = await listOAuthAccounts();
  res.json({ accounts: accounts.map((account) => ({
    ...account,
    models: state.models.filter((model) => model.providerKey === account.providerKey && model.oauthAccountId === account.id)
      .map((model) => ({ id: model.id, name: model.name })),
  })) });
});

app.patch('/api/oauth-accounts/:accountId', async (req, res) => {
  const providerKey = String(req.body?.providerKey || '').trim();
  const accountId = String(req.params.accountId || '').trim();
  const label = String(req.body?.label || '').trim().slice(0, 80);
  if (!oauthProviderKeys.has(providerKey) || !accountId || !label) return res.status(400).json({ error: '授权账户参数无效。' });
  const credential = await getOAuthCredential(providerKey, accountId);
  if (!credential) return res.status(404).json({ error: '授权账户不存在。' });
  const stored = await setOAuthCredential(providerKey, { ...credential, label }, accountId);
  res.json({ account: oauthAccountSummary(providerKey, stored) });
});

app.delete('/api/oauth-accounts/:accountId', async (req, res) => {
  const providerKey = String(req.query?.providerKey || '').trim();
  const accountId = String(req.params.accountId || '').trim();
  if (!oauthProviderKeys.has(providerKey) || !accountId) return res.status(400).json({ error: '授权账户参数无效。' });
  const state = await readState();
  const linkedModels = state.models.filter((model) => model.providerKey === providerKey && model.oauthAccountId === accountId)
    .map((model) => ({ id: model.id, name: model.name }));
  if (linkedModels.length) return res.status(409).json({ error: '请先将关联模型迁移到其他账户，或删除这些模型配置。', code: 'OAUTH_ACCOUNT_IN_USE', models: linkedModels });
  await deleteOAuthCredential(providerKey, accountId);
  res.json({ deletedAccountId: accountId });
});

app.get('/api/model-capabilities', async (_req, res) => {
  const state = await readState();
  const providerCatalog = flattenProviderCatalog(modelCatalogCache);
  const runtime = findFrakioHermesRuntimeSync();
  res.json({
    runtimeVersion: runtime?.version || '',
    capabilities: capabilitiesForModels(state.models, { providerCatalog }),
    providers: Object.fromEntries(state.models.map((model) => [model.id, catalogStatus(modelCatalogCache, model)])),
  });
});

app.get('/api/model-providers/presets', async (req, res) => {
  const profile = await requestedModelProfile(req);
  const selectablePresets = loadProviderPresets().filter((preset) => preset.selectable);
  const codexPreset = selectablePresets.find((preset) => preset.value === 'openai-codex');
  if (codexPreset && oauthProviderAuthenticated(profile, codexPreset.value) && catalogStatus(modelCatalogCache, oauthCatalogModel(codexPreset.value)).stale) {
    const accessToken = oauthProviderAccessToken(profile, codexPreset.value);
    if (accessToken) await refreshCodexOAuthModels(accessToken).catch(() => {});
  }
  const providers = selectablePresets.map((preset) => {
    const { selectable: _selectable, ...publicPreset } = preset;
    if (!preset.authType) return { ...publicPreset, authenticated: false };
    const state = oauthProviderState(profile, preset.value);
    return { ...publicPreset, models: state.models, authenticated: state.authenticated, catalog: state.catalog };
  });
  res.json({ profile, providers });
});

async function fetchProviderModelsForRequest(body) {
  const apiKey = String(body?.apiKey || body?.api_key || '').trim();
  const provider = {
    providerKey: String(body?.providerKey || '').trim(), apiMode: runtimeApiMode(body?.apiMode),
    baseUrl: String(body?.baseUrl || body?.base_url || '').trim(), modelsUrl: String(body?.modelsUrl || '').trim(),
  };
  const urls = candidateModelUrls(provider);
  if (!urls.length) throw Object.assign(new Error('Base URL 格式不正确。'), { status: 400 });
  const anthropicHeaders = provider.apiMode === 'anthropic_messages' || isAnthropicLikeBaseUrl(provider.baseUrl);
  const headers = !apiKey ? {} : anthropicHeaders
    ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    : { Authorization: `Bearer ${apiKey}` };
  let lastError = null;
  for (const url of urls) {
    const result = await fetchJson(url, { method: 'GET', headers, timeoutMs: 9000 });
    if (!result.ok) {
      const providerMessage = typeof result.body?.error?.message === 'string' ? `：${result.body.error.message.slice(0, 180)}` : '';
      lastError = Object.assign(new Error(result.status === 401 || result.status === 403
        ? `API Key 未授权，或供应商拒绝访问模型列表${providerMessage}。`
        : `模型列表获取失败，HTTP ${result.status || 'network'}${providerMessage}。`), { status: result.status || 502 });
      if ([401, 403].includes(result.status)) break;
      continue;
    }
    const parsed = parseCatalogResponse(result.body, provider);
    if (!parsed.ids.length) {
      lastError = Object.assign(new Error('供应商返回了响应，但没有识别到模型 ID。'), { status: 502 });
      continue;
    }
    await updateProviderCatalog(modelCatalogCachePath, modelCatalogCache, provider, parsed);
    return { models: parsed.ids, records: parsed.records, rich: parsed.rich, provider, url };
  }
  await recordCatalogError(modelCatalogCachePath, modelCatalogCache, provider, lastError || '模型目录不可用。');
  throw lastError || Object.assign(new Error('模型列表获取失败。'), { status: 502 });
}

function userProtocolLabel(apiMode) {
  if (apiMode === 'codex_responses' || apiMode === 'openai_responses') return 'OpenAI Responses';
  if (apiMode === 'anthropic_messages') return 'Anthropic Messages';
  return 'OpenAI Chat Completions';
}

function protocolModesForDetection(preference, baseUrl) {
  if (preference !== 'auto') return [runtimeApiMode(preference)];
  return isAnthropicLikeBaseUrl(baseUrl)
    ? ['anthropic_messages', 'codex_responses', 'chat_completions']
    : ['codex_responses', 'chat_completions', 'anthropic_messages'];
}

function providerProbeBody(apiMode, modelId, requestOverrides = {}) {
  const tool = {
    name: 'frakio_connection_probe',
    description: 'A harmless tool used to verify Agent tool-call compatibility.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  };
  if (apiMode === 'anthropic_messages') {
    return {
      model: modelId,
      messages: [{ role: 'user', content: 'Reply with OK. Do not call the tool.' }],
      max_tokens: 16,
      tools: [tool],
      ...requestOverrides,
    };
  }
  if (apiMode === 'codex_responses' || apiMode === 'openai_responses') {
    return {
      model: modelId,
      input: 'Reply with OK. Do not call the tool.',
      max_output_tokens: 16,
      tools: [{ type: 'function', ...tool }],
      ...requestOverrides,
    };
  }
  return {
    model: modelId,
    messages: [{ role: 'user', content: 'Reply with OK. Do not call the tool.' }],
    max_tokens: 16,
    tools: [{ type: 'function', function: tool }],
    ...requestOverrides,
  };
}

function chatCapabilityProbeCandidates(model = {}) {
  const providerKey = String(model.providerKey || '').toLowerCase();
  const baseUrl = String(model.baseUrl || '').toLowerCase();
  const modelId = String(model.model || '').toLowerCase();
  const preferred = [];
  if (providerKey.includes('openrouter') || baseUrl.includes('openrouter')) preferred.push('openrouter');
  if (providerKey.includes('deepseek') || baseUrl.includes('deepseek') || modelId.includes('deepseek')) preferred.push('deepseek');
  if (providerKey.includes('qwen') || baseUrl.includes('dashscope') || modelId.includes('qwen')) preferred.push('qwen', 'chat_template');
  if (providerKey.includes('zai') || baseUrl.includes('bigmodel') || /(?:^|[/_-])glm/.test(modelId)) preferred.push('zai');
  return Array.from(new Set([...preferred, 'openai', 'openrouter', 'deepseek', 'qwen', 'chat_template', 'zai'])).map((format) => {
    if (format === 'openrouter') return { format, off: { reasoning: { effort: 'none' } }, on: { reasoning: { effort: 'high' } }, effort: 'high' };
    if (format === 'deepseek') return { format, off: { thinking: { type: 'disabled' } }, on: { thinking: { type: 'enabled' }, reasoning_effort: 'high' }, effort: 'high' };
    if (format === 'qwen') return { format, off: { enable_thinking: false }, on: { enable_thinking: true }, effort: 'high' };
    if (format === 'chat_template') return { format, off: { chat_template_kwargs: { enable_thinking: false } }, on: { chat_template_kwargs: { enable_thinking: true } }, effort: 'high' };
    if (format === 'zai') return { format, off: { thinking: { type: 'disabled' } }, on: { thinking: { type: 'enabled' } }, effort: 'high' };
    return { format: 'openai', off: { reasoning_effort: 'none' }, on: { reasoning_effort: 'low' }, effort: 'low' };
  });
}

function safeProviderError(result, apiMode, requestUrl, stage = 'connection') {
  const providerMessage = String(result?.body?.error?.message || result?.body?.message || result?.error || '').slice(0, 300);
  const status = Number(result?.status || 0);
  let message = providerMessage || (status ? `HTTP ${status}` : '无法连接供应商。');
  if (status === 401) message = `API Key 未授权${providerMessage ? `：${providerMessage}` : ''}`;
  else if (status === 403) message = `供应商拒绝请求${providerMessage ? `：${providerMessage}` : ''}`;
  else if (status === 404) message = `接口路径不可用${providerMessage ? `：${providerMessage}` : ''}`;
  let pathname = '';
  try { pathname = new URL(requestUrl).pathname; } catch {}
  return {
    stage,
    protocol: userProtocolLabel(apiMode),
    path: pathname,
    status,
    providerMessage,
    message,
  };
}

async function verifyProviderProtocol({ baseUrl, apiMode, modelId, apiKey, requestOverrides = {}, timeoutMs = 30000 }) {
  const requestUrl = providerInferenceUrl({ baseUrl, apiMode });
  const headers = apiMode === 'anthropic_messages'
    ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
    : { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  let result;
  try {
    result = await fetchExternalJson(requestUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(providerProbeBody(apiMode, modelId, requestOverrides)),
      timeoutMs,
    });
  } catch (error) {
    result = { ok: false, status: 0, error: error?.name === 'AbortError' ? '请求超时' : String(error?.message || error) };
  }
  return result.ok
    ? { ok: true, baseUrl, apiMode, requestUrl, result }
    : { ok: false, baseUrl, apiMode, requestUrl, result, diagnostic: safeProviderError(result, apiMode, requestUrl) };
}

async function detectProviderConfiguration(body, savedModel = null, stateModels = [], onStage = () => {}) {
  const preference = normalizeApiModePreference(body?.apiModePreference, body?.apiMode);
  const rawBaseUrl = String(body?.baseUrl || body?.base_url || '').trim();
  const normalizedInput = normalizeProviderBaseUrl(rawBaseUrl, preference === 'auto' ? '' : runtimeApiMode(preference));
  if (!normalizedInput) throw Object.assign(new Error('Base URL 格式不正确。'), { status: 400, stage: 'models' });
  const apiKey = savedModel
    ? await credentialForModelDraft(savedModel, normalizedInput, body?.apiKey || body?.api_key, stateModels)
    : String(body?.apiKey || body?.api_key || '').trim();
  if (!apiKey && !/^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(normalizedInput)) {
    throw Object.assign(new Error('检测需要可用的 API Key。'), { status: 400, stage: 'models' });
  }

  const catalogMode = preference === 'auto'
    ? (isAnthropicLikeBaseUrl(normalizedInput) ? 'anthropic_messages' : 'chat_completions')
    : runtimeApiMode(preference);
  let fetched;
  try {
    onStage('正在获取模型');
    fetched = await fetchProviderModelsForRequest({ ...body, baseUrl: normalizedInput, apiMode: catalogMode, apiKey });
  } catch (error) {
    error.stage = 'models';
    throw error;
  }
  const modelId = String(body?.model || body?.modelId || '').trim();
  const selectedModel = fetched.models.includes(modelId) ? modelId : fetched.models[0];
  let lastFailure = null;
  let verified = null;
  onStage('正在验证连接');
  for (const apiMode of protocolModesForDetection(preference, normalizedInput)) {
    onStage(`正在识别 API 协议 · ${userProtocolLabel(apiMode)}`);
    for (const baseUrl of candidateProviderBaseUrls(normalizedInput, apiMode)) {
      const attempt = await verifyProviderProtocol({ baseUrl, apiMode, modelId: selectedModel, apiKey });
      if (attempt.ok) {
        verified = attempt;
        break;
      }
      lastFailure = attempt;
    }
    if (verified) break;
  }
  if (!verified) {
    const diagnostic = lastFailure?.diagnostic || { stage: 'connection', protocol: userProtocolLabel(runtimeApiMode(preference)), path: '', status: 0, message: '连接验证失败。' };
    throw Object.assign(new Error(diagnostic.message), { status: diagnostic.status || 502, code: 'provider_rejected', diagnostic });
  }

  const detectedModel = normalizeModels([{
    ...body,
    id: savedModel?.id || 'detected',
    providerKey: body?.providerKey || savedModel?.providerKey || '',
    baseUrl: verified.baseUrl,
    apiMode: verified.apiMode,
    apiModePreference: preference,
    model: selectedModel,
    models: fetched.models,
    capabilityMode: 'auto',
  }])[0];
  let capability = resolveModelCapability(detectedModel, selectedModel, { providerCatalog: flattenProviderCatalog(modelCatalogCache) });
  let probeResults = [];
  if ((verified.apiMode === 'codex_responses' || verified.apiMode === 'openai_responses') && ['unknown', 'verification_failed'].includes(capability.status)) {
    const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    const discovery = await probeResponsesCapabilities({
      modelId: selectedModel,
      request: async (requestBody) => {
        try {
          return await fetchExternalJson(verified.requestUrl, { method: 'POST', headers, body: JSON.stringify(requestBody), timeoutMs: 12000 });
        } catch (error) {
          return { ok: false, status: 0, error: String(error?.name === 'AbortError' ? '请求超时' : error?.message || error) };
        }
      },
      onStage,
    });
    capability = discovery.capability;
    probeResults = discovery.probeResults;
    await recordActiveProbeCapability(modelCatalogCachePath, modelCatalogCache, detectedModel, capability);
  } else if (verified.apiMode === 'chat_completions' && capability.status === 'unknown') {
    onStage('正在探测推理档位');
    let acceptedFormat = null;
    for (const candidate of chatCapabilityProbeCandidates(detectedModel)) {
      const disabled = await verifyProviderProtocol({
        baseUrl: verified.baseUrl,
        apiMode: verified.apiMode,
        modelId: selectedModel,
        apiKey,
        requestOverrides: candidate.off,
        timeoutMs: 12000,
      });
      probeResults.push({ kind: 'reasoning', option: 'off', mappedValue: 'none', status: disabled.ok ? 'accepted' : disabled.result?.status === 400 || disabled.result?.status === 422 ? 'unsupported' : 'unknown', ...(disabled.diagnostic?.providerMessage ? { error: disabled.diagnostic.providerMessage } : {}) });
      if (!disabled.ok) continue;
      const enabled = await verifyProviderProtocol({
        baseUrl: verified.baseUrl,
        apiMode: verified.apiMode,
        modelId: selectedModel,
        apiKey,
        requestOverrides: candidate.on,
        timeoutMs: 12000,
      });
      probeResults.push({ kind: 'reasoning', option: candidate.effort, mappedValue: candidate.effort, status: enabled.ok ? 'accepted' : enabled.result?.status === 400 || enabled.result?.status === 422 ? 'unsupported' : 'unknown', ...(enabled.diagnostic?.providerMessage ? { error: enabled.diagnostic.providerMessage } : {}) });
      if (enabled.ok) {
        acceptedFormat = candidate;
        break;
      }
    }
    if (acceptedFormat) {
      capability = {
        ...capability,
        modelId: selectedModel,
        reasoning: true,
        reasoningType: 'binary',
        reasoningEfforts: ['off', acceptedFormat.effort],
        reasoningMap: { off: 'none', [acceptedFormat.effort]: acceptedFormat.effort },
        defaultReasoning: acceptedFormat.effort,
        thinkingFormat: acceptedFormat.format,
        source: 'active_probe',
        confidence: 'inferred',
        status: 'confirmed',
        reasoningStatus: 'confirmed',
        updatedAt: now(),
      };
    }
    onStage('正在检测快速模式');
    const priorityAttempt = await verifyProviderProtocol({
      baseUrl: verified.baseUrl,
      apiMode: verified.apiMode,
      modelId: selectedModel,
      apiKey,
      requestOverrides: { service_tier: 'priority' },
      timeoutMs: 12000,
    });
    probeResults.push({ kind: 'service_tier', option: 'priority', mappedValue: 'priority', status: priorityAttempt.ok ? 'accepted' : priorityAttempt.result?.status === 400 || priorityAttempt.result?.status === 422 ? 'unsupported' : 'unknown', ...(priorityAttempt.diagnostic?.providerMessage ? { error: priorityAttempt.diagnostic.providerMessage } : {}) });
    if (priorityAttempt.ok) {
      capability = {
        ...capability,
        serviceTiers: [{ id: 'priority', name: '快速', description: '中转线路接受 Priority 服务层', requestValue: 'priority', billingNotice: '厂商可能额外计费' }],
        speedModes: ['standard', 'priority'],
        fastMode: 'openai_priority',
        serviceTierStatus: 'confirmed',
        source: 'active_probe',
        confidence: 'inferred',
        status: 'confirmed',
        updatedAt: now(),
      };
    }
    if (capability.status === 'confirmed') await recordActiveProbeCapability(modelCatalogCachePath, modelCatalogCache, detectedModel, capability);
  }
  const inputComparable = comparableBaseUrl(normalizedInput);
  const autoCompletedV1 = inputComparable !== comparableBaseUrl(verified.baseUrl) && /\/v1$/i.test(verified.baseUrl);
  return {
    baseUrl: verified.baseUrl,
    apiMode: verified.apiMode,
    apiModePreference: preference,
    protocol: modelProtocolFromApiMode(verified.apiMode),
    model: selectedModel,
    models: fetched.models,
    capability,
    probeResults,
    catalog: { source: fetched.rich ? 'provider_catalog' : 'model_ids', rich: fetched.rich, url: fetched.url, ...catalogStatus(modelCatalogCache, fetched.provider) },
    autoCompletedV1,
    diagnostic: { stage: 'complete', protocol: userProtocolLabel(verified.apiMode), path: new URL(verified.requestUrl).pathname, status: verified.result.status },
  };
}

async function refreshStaleProviderCatalogs() {
  const state = await readState();
  const seen = new Set();
  for (const model of state.models) {
    const signature = `${model.providerKey}|${model.apiMode}|${comparableBaseUrl(model.baseUrl)}`;
    if (seen.has(signature) || !model.baseUrl || !catalogStatus(modelCatalogCache, model).stale) continue;
    seen.add(signature);
    const apiKey = await getReusableModelSecret(model, state.models);
    const local = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/i.test(model.baseUrl);
    if (!apiKey && !local) continue;
    await fetchProviderModelsForRequest({ ...model, apiKey }).catch(() => {});
  }
}

app.post('/api/models/fetch', async (req, res) => {
  try {
    const state = await readState();
    const savedModel = req.body?.modelId ? state.models.find((item) => item.id === req.body.modelId) : null;
    if (req.body?.modelId && !savedModel) return res.status(404).json({ error: '模型不存在。' });
    const requestedBaseUrl = String(req.body?.baseUrl || req.body?.base_url || '').trim();
    const apiKey = savedModel
      ? await credentialForModelDraft(savedModel, requestedBaseUrl, req.body?.apiKey || req.body?.api_key, state.models)
      : String(req.body?.apiKey || req.body?.api_key || '').trim();
    const fetched = await fetchProviderModelsForRequest({ ...req.body, apiKey });
    const models = fetched.models;
    const capabilityModel = normalizeModels([{
      id: 'fetched',
      name: req.body?.provider || req.body?.providerKey || 'Provider',
      provider: req.body?.provider || 'Custom',
      providerKey: req.body?.providerKey || '',
      apiMode: req.body?.apiMode || '',
      baseUrl: req.body?.baseUrl || '',
      model: models[0],
      models,
      capabilityMode: req.body?.capabilityMode,
      capabilityOverrides: req.body?.capabilityOverrides,
    }])[0];
    captureTelemetry('feature_used', { feature: 'model_connected', outcome: 'completed' });
    captureMeaningfulActivity('feature_used');
    res.json({
      models,
      capabilities: Object.fromEntries(models.map((modelName) => [modelName, resolveModelCapability(capabilityModel, modelName, { providerCatalog: flattenProviderCatalog(modelCatalogCache) })])),
      catalog: { source: fetched.rich ? 'provider_catalog' : 'model_ids', rich: fetched.rich, url: fetched.url, ...catalogStatus(modelCatalogCache, fetched.provider) },
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '模型列表获取失败。' });
  }
});

app.post('/api/model-providers/detect', async (req, res) => {
  const stream = req.body?.stream === true;
  const writeEvent = (event) => {
    if (!stream || res.writableEnded) return;
    res.write(`${JSON.stringify(event)}\n`);
  };
  if (stream) {
    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
  }
  try {
    const state = await readState();
    const savedModel = req.body?.modelId ? state.models.find((item) => item.id === req.body.modelId) : null;
    if (req.body?.modelId && !savedModel) throw Object.assign(new Error('模型不存在。'), { status: 404, stage: 'models' });
    const detection = await detectProviderConfiguration(req.body, savedModel, state.models, (stage) => writeEvent({ type: 'stage', stage }));
    captureTelemetry('feature_used', { feature: 'model_connected', outcome: 'completed' });
    captureMeaningfulActivity('feature_used');
    const payload = { detected: true, ...detection };
    if (stream) {
      writeEvent({ type: 'result', data: payload });
      res.end();
    } else {
      res.json(payload);
    }
  } catch (error) {
    const diagnostic = error?.diagnostic || {};
    const payload = {
      error: error.message || 'Provider 检测失败。',
      code: error.code || '',
      stage: diagnostic.stage || error.stage || 'connection',
      protocol: diagnostic.protocol || '',
      path: diagnostic.path || '',
      status: diagnostic.status || error.status || 0,
      providerMessage: diagnostic.providerMessage || '',
    };
    if (stream) {
      writeEvent({ type: 'error', ...payload });
      res.end();
    } else {
      res.status(error.status || 500).json(payload);
    }
  }
});

app.post('/api/model-providers/fetch', async (req, res) => {
  try {
    const fetched = await fetchProviderModelsForRequest(req.body);
    const models = fetched.models;
    captureTelemetry('feature_used', { feature: 'model_connected', outcome: 'completed' });
    captureMeaningfulActivity('feature_used');
    res.json({ models, catalog: { source: fetched.rich ? 'provider_catalog' : 'model_ids', rich: fetched.rich, url: fetched.url, ...catalogStatus(modelCatalogCache, fetched.provider) } });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '模型列表获取失败。' });
  }
});

function verificationModelFromRequest(savedModel, body = {}) {
  const configuration = body?.configuration && typeof body.configuration === 'object' ? body.configuration : null;
  const modelId = String(configuration?.model || body?.modelId || savedModel.model || '').trim().slice(0, 100);
  if (!configuration) return { ...savedModel, model: modelId, models: normalizeModelNames(savedModel.models, modelId) };
  const next = { ...savedModel, model: modelId, models: normalizeModelNames(savedModel.models, modelId) };
  if ('name' in configuration) {
    const name = String(configuration.name || '').trim();
    if (!name) throw Object.assign(new Error('模型名称不能为空。'), { status: 400 });
    next.name = name.slice(0, 60);
  }
  if ('provider' in configuration) next.provider = String(configuration.provider || 'Custom').trim().slice(0, 40);
  if ('kind' in configuration && ['official', 'relay', 'local'].includes(configuration.kind)) next.kind = configuration.kind;
  if ('models' in configuration) next.models = normalizeModelNames(configuration.models, modelId);
  if ('baseUrl' in configuration) {
    const baseUrl = String(configuration.baseUrl || '').trim().slice(0, 240);
    try {
      const parsed = new URL(baseUrl);
      const isGeminiOAuthRoute = savedModel.providerKey === geminiProviderKey && baseUrl === 'cloudcode-pa://google';
      if (!['http:', 'https:'].includes(parsed.protocol) && !isGeminiOAuthRoute) throw new Error('unsupported protocol');
    } catch {
      throw Object.assign(new Error('Base URL 格式不正确。'), { status: 400 });
    }
    next.baseUrl = baseUrl;
  }
  if ('apiMode' in configuration) {
    const apiMode = runtimeApiMode(configuration.apiMode);
    if (!apiMode) throw Object.assign(new Error('API 协议不受支持。'), { status: 400 });
    next.apiMode = apiMode;
    next.protocol = modelProtocolFromApiMode(apiMode);
  }
  if ('apiModePreference' in configuration) next.apiModePreference = normalizeApiModePreference(configuration.apiModePreference, next.apiMode);
  if ('modelApiModes' in configuration) next.modelApiModes = normalizeModelApiModes(configuration.modelApiModes);
  if ('compat' in configuration) next.compat = normalizeModelCompat(configuration.compat);
  if ('modelCompat' in configuration) next.modelCompat = normalizeModelCompatMap(configuration.modelCompat);
  if ('modelsUrl' in configuration) next.modelsUrl = String(configuration.modelsUrl || '').trim().slice(0, 300);
  if ('contextLimit' in configuration) next.contextLimit = Number.isFinite(Number(configuration.contextLimit)) && Number(configuration.contextLimit) > 0 ? Number(configuration.contextLimit) : null;
  if ('pricing' in configuration) next.pricing = normalizeModelPricing(configuration.pricing);
  if ('capabilityMode' in configuration) next.capabilityMode = configuration.capabilityMode === 'manual' ? 'manual' : 'auto';
  if ('capabilityOverrides' in configuration) next.capabilityOverrides = normalizeCapabilityOverrides(configuration.capabilityOverrides);
  return next;
}

async function persistVerifiedModelDraft(state, savedModel, verifiedModel, explicitApiKey) {
  for (const key of ['name', 'provider', 'kind', 'protocol', 'model', 'models', 'baseUrl', 'apiMode', 'apiModePreference', 'modelsUrl', 'modelApiModes', 'compat', 'modelCompat', 'contextLimit', 'capabilityMode', 'capabilityOverrides', 'pricing']) {
    savedModel[key] = verifiedModel[key];
  }
  const provided = String(explicitApiKey || '').trim();
  if (provided) {
    savedModel.apiKeyState = 'provided';
    await setModelSecret(savedModel.id, provided);
  }
  savedModel.apiKey = '';
  savedModel.runtimeRevision = newRuntimeRevision();
  await writeState(state);
}

app.post('/api/models/:id/verify', async (req, res) => {
  let verificationContext = null;
  try {
    const state = await readState();
    const model = state.models.find((item) => item.id === req.params.id);
    if (!model) return res.status(404).json({ error: '模型不存在。' });
    const savedRoutePrefix = verificationRoutePrefix(model);
    const verificationModel = verificationModelFromRequest(model, req.body);
    const modelId = verificationModel.model;
    verificationContext = { model: verificationModel, modelId, recordFailure: !oauthProviderKeys.has(model.providerKey) };
    const capability = resolveModelCapability(verificationModel, modelId, { providerCatalog: flattenProviderCatalog(modelCatalogCache) });
    const saveOnSuccess = req.body?.saveOnSuccess === true && Boolean(req.body?.configuration);
    if (oauthProviderKeys.has(model.providerKey)) {
      const profileName = model.profileName || await requestedModelProfile(req);
      const officialBaseUrl = officialOAuthBaseUrl(model.providerKey, verificationModel.baseUrl);
      let nativeVerification;
      if (model.providerKey === 'openai-codex') nativeVerification = await verifyCodexOAuthProvider(profileName, modelId, model.oauthAccountId || '');
      else if (model.providerKey === 'claude-oauth') nativeVerification = await verifyClaudeOAuthProvider(profileName, modelId, officialBaseUrl, model.oauthAccountId || '');
      else if (model.providerKey === geminiProviderKey) nativeVerification = await verifyGeminiOAuthProvider(profileName, modelId, model.oauthAccountId || '');
      else throw providerVerificationError('当前 OAuth Provider 暂不支持原生验证。', 400, 'provider_rejected');
      if (saveOnSuccess) {
        await persistVerifiedModelDraft(state, model, verificationModel, '');
        await updateHermesModelProviderConfig(profileName, model.providerKey, model.model);
        const verifiedRoutePrefix = verificationRoutePrefix(verificationModel);
        if (savedRoutePrefix !== verifiedRoutePrefix) {
          modelCatalogCache.verifications = Object.fromEntries(Object.entries(modelCatalogCache.verifications || {}).filter(([key]) => !key.startsWith(savedRoutePrefix)));
        }
      }
      const verifiedAt = nativeVerification.verifiedAt || now();
      modelCatalogCache.verifications = modelCatalogCache.verifications || {};
      modelCatalogCache.verifications[verificationKey(verificationModel, modelId)] = {
        status: 'confirmed', modelId, verifiedAt,
        reasoning: capability.defaultReasoning || 'default',
        serviceTier: capability.serviceTiers?.[0]?.id || 'standard',
        verificationKind: nativeVerification.verificationKind,
      };
      await writeCatalogCache(modelCatalogCachePath, modelCatalogCache);
      return res.json({
        verified: true, mode: 'connection', modelId,
        requestedReasoning: capability.defaultReasoning || 'default', effectiveReasoning: capability.defaultReasoning || 'default',
        requestedServiceTier: capability.serviceTiers?.[0]?.id || 'standard', effectiveServiceTier: capability.serviceTiers?.[0]?.id || 'standard',
        capabilitySource: capability.source, capability, probeResults: [], verifiedAt,
        verificationKind: nativeVerification.verificationKind, usageConsumed: nativeVerification.usageConsumed,
        ...(nativeVerification.catalog ? { catalog: nativeVerification.catalog } : {}),
        saved: saveOnSuccess,
        ...(saveOnSuccess ? { model: publicModel(model), models: state.models.map(publicModel) } : {}),
      });
    }
    const apiKey = await credentialForModelDraft(model, verificationModel.baseUrl, req.body?.apiKey, state.models);
    if (!apiKey) return res.status(400).json({ error: '验证需要可用的 API Key。' });
    const headers = verificationModel.apiMode === 'anthropic_messages'
      ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
      : { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    const mode = req.body?.mode === 'discover' ? 'discover' : 'connection';
    const canDiscover = verificationModel.capabilityMode !== 'manual'
      && String(verificationModel.providerKey || '').startsWith('custom:')
      && (verificationModel.apiMode === 'codex_responses' || verificationModel.apiMode === 'openai_responses')
      && ['unknown', 'verification_failed'].includes(capability.status);
    if (mode === 'discover' && !canDiscover) {
      const reason = verificationModel.capabilityMode === 'manual'
        ? '当前使用手动能力设置。'
        : !String(verificationModel.providerKey || '').startsWith('custom:')
          ? '只有自定义中转站支持主动探测。'
          : !['codex_responses', 'openai_responses'].includes(verificationModel.apiMode)
            ? '主动探测需要 OpenAI Responses 或 OpenAI Codex Responses 协议。'
            : '当前线路已有明确能力记录。';
      return res.status(400).json({ error: reason });
    }

    if (mode === 'discover') {
      const discovery = await probeResponsesCapabilities({
        modelId,
        request: async (body) => {
          try {
            return await fetchExternalJson(providerInferenceUrl(verificationModel), { method: 'POST', headers, body: JSON.stringify(body), timeoutMs: 12000 });
          } catch (error) {
            return { ok: false, status: 0, error: String(error?.name === 'AbortError' ? '请求超时' : error?.message || error) };
          }
        },
      });
      if (saveOnSuccess) {
        await persistVerifiedModelDraft(state, model, verificationModel, req.body?.apiKey);
        const verifiedRoutePrefix = verificationRoutePrefix(verificationModel);
        if (savedRoutePrefix !== verifiedRoutePrefix) {
          modelCatalogCache.verifications = Object.fromEntries(Object.entries(modelCatalogCache.verifications || {}).filter(([key]) => !key.startsWith(savedRoutePrefix)));
        }
      }
      await recordActiveProbeCapability(modelCatalogCachePath, modelCatalogCache, verificationModel, discovery.capability);
      modelCatalogCache.verifications = modelCatalogCache.verifications || {};
      modelCatalogCache.verifications[verificationKey(verificationModel, modelId)] = {
        status: 'confirmed', modelId, verifiedAt: discovery.verifiedAt,
        reasoning: discovery.capability.defaultReasoning || 'default',
        serviceTier: discovery.capability.serviceTiers[0]?.id || 'standard',
        probeResults: discovery.probeResults,
      };
      await writeCatalogCache(modelCatalogCachePath, modelCatalogCache);
      return res.json({
        verified: true, mode, modelId,
        requestedReasoning: 'discover', effectiveReasoning: discovery.capability.defaultReasoning || 'default',
        requestedServiceTier: 'discover', effectiveServiceTier: discovery.capability.serviceTiers[0]?.id || 'standard',
        capabilitySource: discovery.capability.source,
        capability: discovery.capability,
        probeResults: discovery.probeResults,
        verifiedAt: discovery.verifiedAt,
        verificationKind: 'api_key',
        usageConsumed: true,
        saved: saveOnSuccess,
        ...(saveOnSuccess ? { model: publicModel(model), models: state.models.map(publicModel) } : {}),
      });
    }

    const mapped = mapRunSettings(verificationModel, capability, { reasoningEffort: req.body?.reasoningEffort, serviceTier: req.body?.serviceTier || req.body?.speedMode });
    const requestOverrides = mapped.runtimeOverrides.request_overrides || {};
    const expandedRequestOverrides = directHttpRequestOverrides(requestOverrides);
    let body;
    if (verificationModel.apiMode === 'anthropic_messages') body = { model: modelId, messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 8, ...expandedRequestOverrides };
    else if (verificationModel.apiMode === 'codex_responses' || verificationModel.apiMode === 'openai_responses') body = { model: modelId, input: 'Reply OK.', max_output_tokens: 8, ...(mapped.runtimeOverrides.reasoning_config ? { reasoning: mapped.runtimeOverrides.reasoning_config } : {}), ...(mapped.runtimeOverrides.service_tier ? { service_tier: mapped.runtimeOverrides.service_tier } : {}), ...expandedRequestOverrides };
    else body = { model: modelId, messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 8, ...expandedRequestOverrides };
    const result = await fetchExternalJson(providerInferenceUrl(verificationModel), { method: 'POST', headers, body: JSON.stringify(body), timeoutMs: 30000 });
    if (!result.ok) {
      const message = String(result.body?.error?.message || `HTTP ${result.status}`).slice(0, 500);
      throw Object.assign(new Error(`配置验证失败：${message}`), { status: result.status || 502, code: 'provider_rejected' });
    }
    modelCatalogCache.verifications = modelCatalogCache.verifications || {};
    if (saveOnSuccess) {
      await persistVerifiedModelDraft(state, model, verificationModel, req.body?.apiKey);
      const verifiedRoutePrefix = verificationRoutePrefix(verificationModel);
      if (savedRoutePrefix !== verifiedRoutePrefix) {
        modelCatalogCache.verifications = Object.fromEntries(Object.entries(modelCatalogCache.verifications || {}).filter(([key]) => !key.startsWith(savedRoutePrefix)));
      }
    }
    const key = verificationKey(verificationModel, modelId);
    const verifiedAt = now();
    modelCatalogCache.verifications[key] = { status: 'confirmed', modelId, verifiedAt, reasoning: mapped.effectiveReasoning, serviceTier: mapped.effectiveServiceTier };
    await writeCatalogCache(modelCatalogCachePath, modelCatalogCache);
    res.json({ verified: true, mode, modelId, requestedReasoning: mapped.requestedReasoning, effectiveReasoning: mapped.effectiveReasoning, requestedServiceTier: mapped.requestedServiceTier, effectiveServiceTier: mapped.effectiveServiceTier, capabilitySource: capability.source, capability, probeResults: [], verifiedAt, verificationKind: 'api_key', usageConsumed: true, saved: saveOnSuccess, ...(saveOnSuccess ? { model: publicModel(model), models: state.models.map(publicModel) } : {}) });
  } catch (error) {
    if (verificationContext?.recordFailure) {
      modelCatalogCache.verifications = modelCatalogCache.verifications || {};
      modelCatalogCache.verifications[verificationKey(verificationContext.model, verificationContext.modelId)] = { status: 'verification_failed', modelId: verificationContext.modelId, verifiedAt: now(), error: String(error.message || error).slice(0, 500) };
      await writeCatalogCache(modelCatalogCachePath, modelCatalogCache).catch(() => {});
    }
    res.status(error.status || 500).json({ error: error.message || '配置验证失败。', ...(error.code ? { code: error.code } : {}) });
  }
});

function cleanupAuthSessions(store) {
  const cutoff = Date.now() - oauthPollMaxMs - 60000;
  for (const [sessionId, session] of store.entries()) {
    if (session.createdAt < cutoff) {
      if (session.server) {
        try { session.server.close(); } catch {}
      }
      store.delete(sessionId);
    }
  }
}

function base64Url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makePkcePair(size = 32) {
  const verifier = randomBytes(size).toString('base64url');
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

async function codexLoginWorker(session) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < oauthPollMaxMs) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    if (session.status !== 'pending') return;
    try {
      const pollRes = await fetch(codexDeviceTokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_auth_id: session.deviceAuthId, user_code: session.userCode }),
        signal: AbortSignal.timeout(10000),
      });
      if (pollRes.status === 403 || pollRes.status === 404) continue;
      if (!pollRes.ok) {
        session.status = 'error';
        session.error = `Codex 轮询失败：HTTP ${pollRes.status}`;
        return;
      }
      const pollData = await pollRes.json();
      const tokenRes = await fetch(codexOAuthTokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: pollData.authorization_code,
          redirect_uri: codexRedirectUri,
          client_id: codexClientId,
          code_verifier: pollData.code_verifier,
        }).toString(),
        signal: AbortSignal.timeout(15000),
      });
      if (!tokenRes.ok) {
        session.status = 'error';
        session.error = `Codex token 交换失败：HTTP ${tokenRes.status}`;
        return;
      }
      const tokenData = await tokenRes.json();
      await saveCodexOAuthTokens(
        session.profile,
        tokenData.access_token,
        tokenData.refresh_token || '',
        Date.now() + Math.max(60, Number(tokenData.expires_in || 3600)) * 1000,
        extractChatGptAccountId(tokenData.access_token),
        session.accountId || '',
        session.accountLabel || '',
      );
      try {
        await refreshCodexOAuthModels(tokenData.access_token, session.accountId || '');
      } catch {}
      const providerState = oauthProviderPayload(session.profile, 'openai-codex', session.accountId || '');
      session.models = providerState.models;
      session.catalog = providerState.catalog;
      session.capabilities = providerState.capabilities;
      session.status = 'approved';
      return;
    } catch (error) {
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') continue;
      session.status = 'error';
      session.error = error?.message || String(error);
      return;
    }
  }
  session.status = 'expired';
}

app.post('/api/auth/codex/start', async (req, res) => {
  try {
    cleanupAuthSessions(codexAuthSessions);
    const response = await fetch(codexDeviceAuthUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'node-fetch' },
      body: JSON.stringify({ client_id: codexClientId }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      let body = {};
      try { body = await response.json(); } catch {}
      const message = body?.error?.code === 'unsupported_country_region_territory'
        ? 'OpenAI 当前不支持你的网络区域。'
        : `Codex 授权码获取失败：HTTP ${response.status}`;
      return res.status(502).json({ error: message, code: body?.error?.code || '' });
    }
    const data = await response.json();
    const session = { id: randomUUID(), profile: await requestedModelProfile(req), accountId: String(req.body?.accountId || '').trim(), accountLabel: String(req.body?.accountLabel || '').trim().slice(0, 80), userCode: data.user_code, deviceAuthId: data.device_auth_id, status: 'pending', createdAt: Date.now(), error: '' };
    codexAuthSessions.set(session.id, session);
    codexLoginWorker(session).catch((error) => {
      session.status = 'error';
      session.error = error?.message || String(error);
    });
    res.json({ session_id: session.id, user_code: session.userCode, verification_url: codexVerificationUrl, expires_in: 900 });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Codex 授权启动失败。' });
  }
});

app.get('/api/auth/codex/:sessionId', (req, res) => {
  const session = codexAuthSessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: '授权会话不存在。' });
  res.json({ status: session.status, error: session.error || null, authenticated: session.status === 'approved', models: session.models || [], catalog: session.catalog || null, capabilities: session.capabilities || {} });
});

app.post('/api/auth/codex/catalog', async (req, res) => {
  const profile = await requestedModelProfile(req);
  const accountId = String(req.body?.accountId || '').trim();
  const accessToken = oauthProviderAccessToken(profile, 'openai-codex', accountId);
  if (!accessToken) return res.status(401).json({ error: '请先完成 OpenAI Codex 授权。', authenticated: false, models: [] });
  try {
    await refreshCodexOAuthModels(accessToken, accountId);
    const state = oauthProviderPayload(profile, 'openai-codex', accountId);
    res.json(state);
  } catch (error) {
    const state = oauthProviderPayload(profile, 'openai-codex', accountId);
    res.status(state.models.length ? 200 : 502).json({ ...state, error: error.message || 'Codex 模型目录获取失败。' });
  }
});

app.post('/api/auth/claude/start', async (req, res) => {
  try {
    cleanupAuthSessions(claudeAuthSessions);
    const { verifier, challenge } = makePkcePair();
    const state = randomBytes(32).toString('base64url');
    const params = new URLSearchParams({
      code: 'true',
      client_id: claudeClientId,
      response_type: 'code',
      redirect_uri: claudeRedirectUri,
      scope: claudeScopes,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    });
    const session = { id: randomUUID(), profile: await requestedModelProfile(req), accountId: String(req.body?.accountId || '').trim(), accountLabel: String(req.body?.accountLabel || '').trim().slice(0, 80), verifier, state, status: 'pending', createdAt: Date.now(), error: '' };
    claudeAuthSessions.set(session.id, session);
    res.json({ session_id: session.id, authorization_url: `${claudeAuthorizeUrl}?${params.toString()}`, expires_in: 900 });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Claude 授权启动失败。' });
  }
});

app.post('/api/auth/claude/:sessionId/submit', async (req, res) => {
  const session = claudeAuthSessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: '授权会话不存在。' });
  if (Date.now() - session.createdAt > oauthPollMaxMs) {
    session.status = 'expired';
    return res.json({ status: session.status, error: null });
  }
  const rawCode = String(req.body?.code || '').trim();
  const [code, receivedState = ''] = rawCode.split('#', 2);
  if (!code) return res.status(400).json({ error: '请输入 Claude 返回的授权 code。' });
  if (receivedState && receivedState !== session.state) {
    session.status = 'error';
    session.error = 'OAuth state 不匹配。';
    return res.status(400).json({ status: session.status, error: session.error });
  }
  try {
    const response = await fetch(claudeTokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'frakio-work/0.1' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: claudeClientId,
        code: code.trim(),
        state: receivedState || session.state,
        redirect_uri: claudeRedirectUri,
        code_verifier: session.verifier,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Claude token 交换失败：HTTP ${response.status}${text ? ` ${text.slice(0, 160)}` : ''}`);
    }
    await saveClaudeOAuthTokens(session.profile, await response.json(), session.accountId || '', session.accountLabel || '');
    session.status = 'approved';
    const providerState = oauthProviderPayload(session.profile, 'claude-oauth', session.accountId || '');
    res.json({ status: session.status, error: null, ...providerState });
  } catch (error) {
    session.status = 'error';
    session.error = error.message || String(error);
    res.status(502).json({ status: session.status, error: session.error });
  }
});

async function fetchGoogleEmail(accessToken) {
  try {
    const response = await fetch(googleUserInfoEndpoint, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return '';
    const body = await response.json();
    return String(body.email || '').trim();
  } catch {
    return '';
  }
}

async function exchangeGeminiCode(session, code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: session.verifier,
    client_id: googleClientId,
    redirect_uri: session.redirectUri,
  });
  if (googleClientSecret) body.set('client_secret', googleClientSecret);
  const response = await fetch(googleTokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Google token 交换失败：HTTP ${response.status}${text ? ` ${text.slice(0, 160)}` : ''}`);
  }
  const tokenData = await response.json();
  await saveGeminiOAuthTokens(session.profile, tokenData, await fetchGoogleEmail(tokenData.access_token), session.accountId || '', session.accountLabel || '');
}

function startGeminiCallbackServer(sessionId, preferredPort = geminiRedirectPort) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      void (async () => {
        const session = geminiAuthSessions.get(sessionId);
        const url = new URL(req.url || '/', `http://${geminiRedirectHost}`);
        if (!session || url.pathname !== geminiRedirectPath) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        try {
          if (url.searchParams.get('state') !== session.state) throw new Error('OAuth state 不匹配。');
          const code = url.searchParams.get('code') || '';
          const denied = url.searchParams.get('error') || '';
          if (denied) throw new Error(`Google 拒绝授权：${denied}`);
          if (!code) throw new Error('Google 回调没有返回 code。');
          await exchangeGeminiCode(session, code);
          session.status = 'approved';
          try { server.close(); } catch {}
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<!doctype html><meta charset="utf-8"><title>Frakio Work</title><body style="font:16px system-ui;text-align:center;margin-top:10vh"><h1>Google Gemini 授权完成</h1><p>可以关闭这个页面，回到 Frakio Work。</p></body>');
        } catch (error) {
          session.status = 'error';
          session.error = error.message || String(error);
          try { server.close(); } catch {}
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!doctype html><meta charset="utf-8"><title>Frakio Work</title><body style="font:16px system-ui;text-align:center;margin-top:10vh"><h1>授权失败</h1><p>${String(session.error).replace(/[<>&]/g, '')}</p></body>`);
        }
      })();
    });
    server.on('error', reject);
    server.listen(preferredPort, geminiCallbackBindHost, () => {
      const address = server.address();
      const portValue = typeof address === 'object' && address ? address.port : preferredPort;
      resolve({ server, redirectUri: `http://${geminiRedirectHost}:${portValue}${geminiRedirectPath}` });
    });
  });
}

app.post('/api/auth/gemini/start', async (req, res) => {
  try {
    cleanupAuthSessions(geminiAuthSessions);
    const { verifier, challenge } = makePkcePair(64);
    const state = randomBytes(32).toString('base64url');
    const session = { id: randomUUID(), profile: await requestedModelProfile(req), accountId: String(req.body?.accountId || '').trim(), accountLabel: String(req.body?.accountLabel || '').trim().slice(0, 80), verifier, state, status: 'pending', createdAt: Date.now(), error: '', server: null, redirectUri: '' };
    geminiAuthSessions.set(session.id, session);
    const callback = await startGeminiCallbackServer(session.id);
    session.server = callback.server;
    session.redirectUri = callback.redirectUri;
    const params = new URLSearchParams({
      client_id: googleClientId,
      response_type: 'code',
      redirect_uri: session.redirectUri,
      scope: googleScopes,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    res.json({ session_id: session.id, authorization_url: `${googleAuthEndpoint}?${params.toString()}`, expires_in: 900 });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Google Gemini 授权启动失败。' });
  }
});

app.get('/api/auth/gemini/:sessionId', (req, res) => {
  const session = geminiAuthSessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: '授权会话不存在。' });
  if (Date.now() - session.createdAt > oauthPollMaxMs && session.status === 'pending') {
    session.status = 'expired';
    try { session.server?.close(); } catch {}
  }
  const providerState = session.status === 'approved' ? oauthProviderPayload(session.profile, geminiProviderKey, session.accountId || '') : null;
  res.json({ status: session.status, error: session.error || null, ...(providerState || {}) });
});

app.post('/api/models', async (req, res) => {
  const state = await readState();
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: '模型名称不能为空。' });
  const providerKey = String(req.body?.providerKey || '').trim().slice(0, 120);
  const apiMode = runtimeApiMode(req.body?.apiMode);
  const apiModePreference = normalizeApiModePreference(req.body?.apiModePreference, apiMode);
  if (providerKey.startsWith('custom:') && !apiMode) return res.status(400).json({ error: '自定义 Provider 必须选择 API 协议。' });
  const profileName = await requestedModelProfile(req);
  const oauthAccountId = String(req.body?.oauthAccountId || '').trim().slice(0, 160);
  const oauthAuthenticated = oauthProviderKeys.has(providerKey) && oauthProviderAuthenticated(profileName, providerKey, oauthAccountId);
  if (oauthProviderKeys.has(providerKey) && !oauthAccountId) return res.status(400).json({ error: '请选择一个 Frakio Work 授权账户。' });
  if (oauthProviderKeys.has(providerKey) && !oauthAuthenticated) return res.status(400).json({ error: '请先完成 Provider 授权。' });
  const hasCredential = String(req.body?.apiKey || '').trim() || oauthAuthenticated;
  const modelNames = normalizeModelNames(req.body?.models, req.body?.model);
  if (!modelNames.length) return res.status(400).json({ error: '请先获取或填写至少一个模型。' });
  const defaultModel = modelNames.includes(String(req.body?.model || '').trim()) ? String(req.body.model).trim() : modelNames[0];
  const model = {
    id: id('model'),
    name: name.slice(0, 60),
    provider: String(req.body?.provider || 'Custom').trim().slice(0, 40),
    kind: ['official', 'relay', 'local'].includes(req.body?.kind) ? req.body.kind : 'official',
    protocol: ['OpenAI Compatible', 'Anthropic Compatible', 'Custom'].includes(req.body?.protocol) ? req.body.protocol : modelProtocolFromApiMode(apiMode),
    model: defaultModel.slice(0, 100),
    models: modelNames,
    baseUrl: String(req.body?.baseUrl || '').trim().slice(0, 240),
    apiKey: '',
    apiKeyState: hasCredential ? (oauthProviderKeys.has(providerKey) ? 'authorized' : 'provided') : '',
    source: 'manual',
    profileName: '',
    providerKey,
    oauthAccountId,
    apiMode,
    apiModePreference,
    modelsUrl: String(req.body?.modelsUrl || '').trim().slice(0, 300),
    modelApiModes: normalizeModelApiModes(req.body?.modelApiModes),
    compat: normalizeModelCompat(req.body?.compat),
    modelCompat: normalizeModelCompatMap(req.body?.modelCompat),
    contextLimit: Number.isFinite(Number(req.body?.contextLimit)) && Number(req.body.contextLimit) > 0 ? Number(req.body.contextLimit) : null,
    capabilityMode: req.body?.capabilityMode === 'manual' ? 'manual' : 'auto',
    capabilityOverrides: normalizeCapabilityOverrides(req.body?.capabilityOverrides),
    pricing: normalizeModelPricing(req.body?.pricing),
    runtimeRevision: newRuntimeRevision(),
  };
  model.providerKey = normalizeModels([...state.models, model]).find((item) => item.id === model.id)?.providerKey || providerKey;
  state.models.push(model);
  await setModelSecret(model.id, req.body?.apiKey);
  await writeState(state);
  if (oauthProviderKeys.has(providerKey)) await updateHermesModelProviderConfig(profileName, providerKey, defaultModel);
  res.json({ model: publicModel(model), models: state.models.map(publicModel) });
});

app.delete('/api/models/:id', async (req, res) => {
  const state = await readState();
  const model = state.models.find((item) => item.id === req.params.id);
  if (!model) return res.status(404).json({ error: '模型不存在。' });
  state.models = state.models.filter((item) => item.id !== req.params.id);
  await deleteModelSecret(req.params.id);
  for (const agent of state.agents) {
    if (agent.model === model.name) agent.model = '';
  }
  await writeState(state);
  res.json({ deletedModelId: req.params.id, models: state.models.map(publicModel), agents: state.agents });
});

app.patch('/api/models/:id', async (req, res) => {
  const state = await readState();
  const model = state.models.find((item) => item.id === req.params.id);
  if (!model) return res.status(404).json({ error: '模型不存在。' });
  const previousVerificationPrefix = verificationRoutePrefix(model);
  const previousConnectionFingerprint = modelRuntimeRevision({ ...model, runtimeRevision: '' });
  const hadExplicitApiKey = Boolean(String(req.body?.apiKey || '').trim());
  if ('name' in req.body) {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: '模型名称不能为空。' });
    model.name = name.slice(0, 60);
  }
  if ('provider' in req.body) model.provider = String(req.body.provider || 'Custom').trim().slice(0, 40);
  if ('kind' in req.body && ['official', 'relay', 'local'].includes(req.body.kind)) model.kind = req.body.kind;
  if ('protocol' in req.body && ['OpenAI Compatible', 'Anthropic Compatible', 'Custom'].includes(req.body.protocol)) model.protocol = req.body.protocol;
  if ('models' in req.body) model.models = normalizeModelNames(req.body.models, model.model);
  if ('model' in req.body) {
    const modelName = String(req.body.model || '').trim().slice(0, 100);
    model.model = modelName;
    model.models = normalizeModelNames(model.models, modelName);
  }
  if ('baseUrl' in req.body) model.baseUrl = String(req.body.baseUrl || '').trim().slice(0, 240);
  if ('providerKey' in req.body) model.providerKey = String(req.body.providerKey || '').trim().slice(0, 120);
  if ('oauthAccountId' in req.body) model.oauthAccountId = String(req.body.oauthAccountId || '').trim().slice(0, 160);
  if ('apiMode' in req.body) {
    model.apiMode = runtimeApiMode(req.body.apiMode);
    if (!('protocol' in req.body)) model.protocol = modelProtocolFromApiMode(model.apiMode);
  }
  if ('apiModePreference' in req.body) model.apiModePreference = normalizeApiModePreference(req.body.apiModePreference, model.apiMode);
  if ('modelsUrl' in req.body) model.modelsUrl = String(req.body.modelsUrl || '').trim().slice(0, 300);
  if ('modelApiModes' in req.body) model.modelApiModes = normalizeModelApiModes(req.body.modelApiModes);
  if ('compat' in req.body) model.compat = normalizeModelCompat(req.body.compat);
  if ('modelCompat' in req.body) model.modelCompat = normalizeModelCompatMap(req.body.modelCompat);
  if ('contextLimit' in req.body) model.contextLimit = Number.isFinite(Number(req.body.contextLimit)) && Number(req.body.contextLimit) > 0 ? Number(req.body.contextLimit) : null;
  if ('capabilityMode' in req.body) model.capabilityMode = req.body.capabilityMode === 'manual' ? 'manual' : 'auto';
  if ('capabilityOverrides' in req.body) model.capabilityOverrides = normalizeCapabilityOverrides(req.body.capabilityOverrides);
  if ('pricing' in req.body) model.pricing = normalizeModelPricing(req.body.pricing);
  if (oauthProviderKeys.has(model.providerKey)) {
    if (!model.oauthAccountId || !oauthProviderAuthenticated(model.profileName || await requestedModelProfile(req), model.providerKey, model.oauthAccountId)) return res.status(400).json({ error: '请选择一个有效的 Frakio Work 授权账户。' });
    model.apiKeyState = 'authorized';
  }
  if (String(req.body?.apiKey || '').trim()) {
    model.apiKeyState = 'provided';
    await setModelSecret(model.id, req.body.apiKey);
  }
  model.providerKey = normalizeModels(state.models).find((item) => item.id === model.id)?.providerKey || model.providerKey;
  const nextConnectionFingerprint = modelRuntimeRevision({ ...model, runtimeRevision: '' });
  if (hadExplicitApiKey || previousConnectionFingerprint !== nextConnectionFingerprint) model.runtimeRevision = newRuntimeRevision();
  else model.runtimeRevision = modelRuntimeRevision(model);
  model.apiKey = '';
  await writeState(state);
  if (oauthProviderKeys.has(model.providerKey) && model.model) {
    await updateHermesModelProviderConfig(model.profileName || await requestedModelProfile(req), model.providerKey, model.model);
  }
  const nextVerificationPrefix = verificationRoutePrefix(model);
  modelCatalogCache.verifications = Object.fromEntries(Object.entries(modelCatalogCache.verifications || {})
    .filter(([key]) => !key.startsWith(previousVerificationPrefix) && !key.startsWith(nextVerificationPrefix)));
  await writeCatalogCache(modelCatalogCachePath, modelCatalogCache).catch(() => {});
  res.json({ model: publicModel(model), models: state.models.map(publicModel) });
});

app.post('/api/agents', async (req, res) => {
  try {
    const state = await readState();
    const requestId = String(req.body?.requestId || '').trim().slice(0, 120);
    const previousAgentId = requestId ? state.integrations?.hermesAgent?.agentCreationRequests?.[requestId]?.agentId : '';
    const previousAgent = previousAgentId ? state.agents.find((item) => item.id === previousAgentId) : null;
    if (previousAgent) {
      const runtime = await hermesRuntimeStatus().catch(() => null);
      const profileName = previousAgent.profileName || previousAgent.id;
      const gateway = runtime?.gateways?.find((item) => item.profileName === profileName) || null;
      return res.json({ agent: previousAgent, agents: state.agents, gateway, runtime, idempotentReplay: true });
    }
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Agent 名称不能为空。' });
    const requestedPolicy = normalizeRuntimePolicy(req.body?.runtimePolicy, { hasHermesProfile: true });
    const requestedModelValue = String(req.body?.model || '').trim();
    const requestedModelSelection = requestedModelValue ? resolveModelSelection(requestedModelValue, state.models) : null;
    if (requestedModelValue && !requestedModelSelection?.selectedModel) {
      return res.status(400).json({ error: 'Agent 默认模型不在 Frakio Model Center 中。' });
    }
    const needsHermesProfile = requestedPolicy.allowedRuntimeIds.includes('hermes');
    const profileName = needsHermesProfile ? profileNameFromAgentName(name) : '';
    if (profileName) await assertProfileNameAvailable(profileName);
    const agentId = profileName || await uniqueProfileName(name, state.agents.map((item) => item.id));
    if (profileName) {
      await createHermesProfileFiles(profileName, { ...(req.body || {}), model: '' });
      await ensureManagedGlobalModulesForProfile(profileName);
      if (requestedModelSelection?.selectedModel) {
        await ensureModelProviderForProfile(profileName, requestedModelSelection.selectedModel, requestedModelSelection.selectedName, state.models, { setDefault: true });
      }
    }
    const profile = profileName ? (await readHermesProfiles()).find((item) => item.name === profileName) : null;
    const agent = {
      id: agentId,
      name: name.slice(0, 32),
      role: String(req.body?.role || '新 Agent').trim().slice(0, 60),
      model: String(requestedModelSelection?.selectionValue || '').slice(0, 240),
      color: String(req.body?.color || profileColor(agentId)).trim().slice(0, 20),
      soul: profile?.soul || String(req.body?.soul || req.body?.scope || '待定义 Soul。').trim(),
      scope: String(req.body?.scope || req.body?.role || '待定义职责范围。').trim().slice(0, 300),
      source: 'frakio-agent',
      profileName,
      gatewayStatus: '',
      soulExcerpt: profile?.soulExcerpt || '',
      userProfileExcerpt: profile?.userExcerpt || '',
      memoryExcerpt: profile?.memoryExcerpt || '',
      userProfile: profile?.userProfile || '',
      memory: profile?.memory || '',
      providerSummary: profile?.providers || [],
      skills: profile?.skills || [],
      plugins: profile?.plugins || [],
      avatarUrl: profile?.avatarUrl || '',
      runtimePolicy: requestedPolicy,
    };
    agent.profileRevision = agentProfileRevision(agent);
    const firstAgent = state.agents.length === 0;
    state.agents.push(agent);
    if (firstAgent || !state.agents.some((item) => item.id === state.ui?.defaultAgentId)) {
      state.ui = { ...(state.ui || {}), defaultAgentId: agent.id };
    }
    if (requestId) {
      const previousRequests = Object.entries(state.integrations?.hermesAgent?.agentCreationRequests || {}).slice(-99);
      state.integrations.hermesAgent = {
        ...(state.integrations.hermesAgent || {}),
        agentCreationRequests: Object.fromEntries([...previousRequests, [requestId, { agentId: agent.id, createdAt: now() }]]),
      };
    }
    await writeState(state);
    const warnings = [];
    if (profileName) {
      try {
        await registerProfileGatewayAutoStart(profileName);
      } catch (error) {
        warnings.push(`自动启动配置保存失败：${error?.message || error}`);
      }
    }
    let gateway = null;
    if (profileName) {
      try {
        gateway = await startProfileGateway(profileName);
        if (!gateway?.running) warnings.push(gateway?.error || gateway?.status || '网关未能启动。');
      } catch (error) {
        warnings.push(`网关启动失败：${error?.message || error}`);
      }
    }
    const runtime = await hermesRuntimeStatus().catch(() => null);
    res.json({ agent, agents: state.agents, profile, gateway, runtime, ...(warnings.length ? { gatewayWarning: warnings.join('\n') } : {}) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Agent 创建失败。' });
  }
});

async function deleteAgentLifecycle(agentId) {
  if (isSystemHermesProfile('', agentId)) {
    throw Object.assign(new Error('Hermes Default 是受保护的系统 Profile。'), { status: 409, code: 'system_profile_protected' });
  }
  const initialState = await readState();
  const agent = initialState.agents.find((item) => item.id === agentId);
  if (!agent) throw Object.assign(new Error('Agent 不存在。'), { status: 404 });
  const profileName = agent.profileName || '';
  if (isSystemHermesProfile(profileName, agent.id)) {
    throw Object.assign(new Error('Hermes Default 是受保护的系统 Profile。'), { status: 409, code: 'system_profile_protected' });
  }

  const originalHermesAgent = structuredClone(initialState.integrations?.hermesAgent || {});
  const originalHermesStudio = structuredClone(initialState.integrations?.hermesStudio || {});
  const originalUi = {
    defaultAgentId: initialState.ui?.defaultAgentId || '',
    fallbackDecisionAgentId: initialState.ui?.fallbackDecisionAgentId || '',
  };
  const profileDir = profileName ? resolveDeletableHermesProfileDir(hermesHome, profileName) : null;
  const stagingDir = profileDir ? path.join(path.dirname(profileDir), `.${path.basename(profileDir)}.deleting-${randomUUID()}`) : null;
  let staged = false;
  let stateCommitted = false;
  let gateway = null;

  try {
    gateway = profileName ? await stopOrVerifyProfileGateway(profileName) : { stopped: true, wasRunning: false };
    if (profileDir && await exists(profileDir)) {
      await rename(profileDir, stagingDir);
      staged = true;
    }
    const agents = await updateState((state) => {
      const currentAgent = state.agents.find((item) => item.id === agent.id);
      if (!currentAgent) throw Object.assign(new Error('Agent 已被删除。'), { status: 404 });
      state.agents = state.agents.filter((item) => item.id !== agent.id);
      unregisterProfileGatewayAutoStart(profileName, state);
      const requests = state.integrations?.hermesAgent?.agentCreationRequests || {};
      state.integrations.hermesAgent = {
        ...(state.integrations.hermesAgent || {}),
        agentCreationRequests: Object.fromEntries(Object.entries(requests).filter(([, value]) => value?.agentId !== agent.id)),
        ...(state.integrations?.hermesAgent?.selectedProfile === profileName ? { selectedProfile: 'default' } : {}),
      };
      if (state.integrations?.hermesStudio?.selectedProfile === profileName) {
        state.integrations.hermesStudio = { ...(state.integrations.hermesStudio || {}), selectedProfile: 'default' };
      }
      if (state.ui?.defaultAgentId === agent.id || state.ui?.fallbackDecisionAgentId === agent.id) {
        const nextDefaultAgentId = resolveDefaultAgentId(state);
        state.ui = {
          ...(state.ui || {}),
          ...(state.ui?.defaultAgentId === agent.id ? { defaultAgentId: nextDefaultAgentId } : {}),
          ...(state.ui?.fallbackDecisionAgentId === agent.id ? { fallbackDecisionAgentId: nextDefaultAgentId } : {}),
        };
      }
      return state.agents;
    });
    stateCommitted = true;
    if (staged) await rm(stagingDir, { recursive: true, force: false });
    return {
      ok: true,
      deletedAgentId: agent.id,
      deletedProfileName: profileName,
      gateway: { stopped: true, wasRunning: gateway.wasRunning },
      autoStart: { removed: Boolean(profileName) },
      agents,
    };
  } catch (error) {
    if (staged && stagingDir && profileDir && await exists(stagingDir) && !(await exists(profileDir))) {
      await rename(stagingDir, profileDir).catch(() => null);
    }
    if (stateCommitted) {
      await updateState((state) => {
        if (!state.agents.some((item) => item.id === agent.id)) state.agents.push(agent);
        state.integrations.hermesAgent = {
          ...(state.integrations.hermesAgent || {}),
          ...originalHermesAgent,
        };
        state.integrations.hermesStudio = { ...(state.integrations.hermesStudio || {}), ...originalHermesStudio };
        state.ui = { ...(state.ui || {}), ...originalUi };
      }).catch(() => null);
    }
    if (gateway?.wasRunning && profileName) await startProfileGateway(profileName).catch(() => null);
    throw error;
  }
}

async function renameAgentHermesProfile(agentId, nextDisplayName) {
  const initialState = await readState();
  const agent = initialState.agents.find((item) => item.id === agentId);
  if (!agent) throw Object.assign(new Error('Agent 不存在。'), { status: 404 });
  const oldName = agent.profileName;
  if (!oldName) return { agent: { ...agent, name: nextDisplayName }, gatewayWarning: '' };
  const nextName = profileNameFromAgentName(nextDisplayName);
  if (nextName === oldName) return { agent: { ...agent, name: nextDisplayName }, gatewayWarning: '' };
  await assertProfileNameAvailable(nextName, agentId);

  const oldDir = resolveDeletableHermesProfileDir(hermesHome, oldName);
  const nextDir = resolveDeletableHermesProfileDir(hermesHome, nextName);
  if (!oldDir || !(await exists(oldDir)) || !nextDir) throw Object.assign(new Error(`找不到 Hermes Profile「${oldName}」的目录。`), { status: 404 });
  if (await exists(nextDir)) throw Object.assign(new Error(`目标 Hermes Profile「${nextName}」已存在，请换一个名称。`), { status: 409 });

  const gateway = await stopOrVerifyProfileGateway(oldName);
  const legacyProfile = hermesReservedProfileNames.has(slug(oldName));
  let renamed = false;
  let stateCommitted = false;
  let gatewayWarning = '';
  try {
    if (legacyProfile) {
      await rename(oldDir, nextDir);
    } else {
      const python = await findHermesBridgePython();
      if (!python) throw new Error('未找到 Hermes runtime，无法重命名 Profile。');
      await execFileAsync(python, ['-m', 'hermes_cli.main', 'profile', 'rename', oldName, nextName], {
        timeout: 20_000,
        env: runtimeEnv({ HERMES_HOME: hermesHome }),
      });
    }
    renamed = true;
    const updated = await updateState((state) => {
      const current = state.agents.find((item) => item.id === agentId);
      if (!current) throw Object.assign(new Error('Agent 已被删除。'), { status: 404 });
      current.name = nextDisplayName;
      replaceProfileNameInState(state, oldName, nextName);
      current.profileRevision = agentProfileRevision(current);
      return structuredClone(current);
    });
    stateCommitted = true;
    if (gateway.wasRunning) {
      const restarted = await startProfileGateway(nextName);
      if (!restarted?.running) gatewayWarning = restarted?.error || restarted?.status || 'Profile 已改名，但新名称下的 Gateway 未能重新启动。';
    }
    return { agent: updated, gatewayWarning };
  } catch (error) {
    if (renamed && !stateCommitted) {
      if (legacyProfile) await rename(nextDir, oldDir).catch(() => null);
      else {
        const python = await findHermesBridgePython();
        if (python) await execFileAsync(python, ['-m', 'hermes_cli.main', 'profile', 'rename', nextName, oldName], { timeout: 20_000, env: runtimeEnv({ HERMES_HOME: hermesHome }) }).catch(() => null);
      }
    }
    if (gateway.wasRunning) await startProfileGateway(oldName).catch(() => null);
    throw error;
  }
}

app.delete('/api/agents/:id', async (req, res) => {
  const agentId = req.params.id;
  let deletion = agentDeletionPromises.get(agentId);
  if (!deletion) {
    deletion = deleteAgentLifecycle(agentId);
    agentDeletionPromises.set(agentId, deletion);
    void deletion.finally(() => agentDeletionPromises.delete(agentId)).catch(() => {});
  }
  try {
    res.json(await deletion);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Agent 删除失败。', ...(error.code ? { code: error.code } : {}) });
  }
});

app.patch('/api/agents/:id', async (req, res) => {
  const state = await readState();
  const agent = state.agents.find((item) => item.id === req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent 不存在。' });
  if ('name' in req.body) {
    const nextName = String(req.body.name || agent.name).trim().slice(0, 32);
    if (!nextName) return res.status(400).json({ error: 'Agent 名称不能为空。' });
    if (agent.profileName && nextName !== agent.name) {
      try {
        const result = await renameAgentHermesProfile(agent.id, nextName);
        return res.json({ agent: result.agent, agents: (await readState()).agents, ...(result.gatewayWarning ? { gatewayWarning: result.gatewayWarning } : {}) });
      } catch (error) {
        return res.status(error.status || 500).json({ error: error.message || 'Hermes Profile 重命名失败。' });
      }
    }
    agent.name = nextName;
  }
  if ('role' in req.body) agent.role = String(req.body.role || agent.role).trim().slice(0, 60);
  if ('model' in req.body) {
    const requestedModel = String(req.body.model || '').trim();
    const { selectedModel, selectedName, selectionValue } = resolveModelSelection(requestedModel, state.models);
    if (!selectedModel) return res.status(400).json({ error: 'Agent 默认模型不在 Frakio Model Center 中。' });
    if (agent.profileName) {
      await updateHermesProfileDefaultModel(agent.profileName, selectionValue, state.models);
    }
    agent.model = String(selectionValue || modelSelectionValue(selectedModel, selectedName)).trim().slice(0, 240);
  }
  if ('color' in req.body) agent.color = String(req.body.color || agent.color).trim().slice(0, 20);
  if ('soul' in req.body) agent.soul = String(req.body.soul || agent.soul || agent.scope || '').trim().slice(0, 500);
  if ('scope' in req.body) agent.scope = String(req.body.scope || agent.scope).trim().slice(0, 300);
  if ('runtimePolicy' in req.body) {
    const nextPolicy = normalizeRuntimePolicy(req.body.runtimePolicy, { hasHermesProfile: Boolean(agent.profileName) });
    if (nextPolicy.allowedRuntimeIds.includes('hermes') && !agent.profileName) {
      const profileName = await uniqueProfileName(agent.name || agent.id, state.agents.map((item) => item.profileName).filter(Boolean));
      await createHermesProfileFiles(profileName, agent);
      await ensureManagedGlobalModulesForProfile(profileName);
      agent.profileName = profileName;
    }
    agent.runtimePolicy = nextPolicy;
  }
  agent.profileRevision = agentProfileRevision(agent);
  await writeState(state);
  res.json({ agent, agents: state.agents });
});

app.get('/api/state', async (_req, res) => {
  const state = await readState();
  res.json({
    version: state.version,
    features: state.features,
    ui: state.ui,
    defaultVaultId: state.defaultVaultId,
    spaces: state.spaces.map(publicSpace),
    workspaces: state.workspaces,
    integrations: state.integrations,
  });
});

app.patch('/api/state/ui', async (req, res) => {
  const state = await readState();
  const next = normalizeWorkbenchSidebarPatch(req.body || {});
  if ('defaultAgentId' in next && !state.agents.some((agent) => agent.id === next.defaultAgentId)) delete next.defaultAgentId;
  if ('activeSpaceId' in next && !state.spaces.some((space) => space.id === next.activeSpaceId && !space.archivedAt)) delete next.activeSpaceId;
  if ('telemetryEnabled' in next) next.telemetryEnabled = Boolean(next.telemetryEnabled);
  if ('richToolDescriptions' in next) next.richToolDescriptions = Boolean(next.richToolDescriptions);
  if ('appearance' in next && !['system', 'light', 'dark'].includes(next.appearance)) next.appearance = 'system';
  if ('conversationTransition' in next) delete next.conversationTransition;
  if ('telemetryNoticeSeenAt' in next) next.telemetryNoticeSeenAt = String(next.telemetryNoticeSeenAt || '').slice(0, 40);
  if ('agentMentionMaxDepth' in next) next.agentMentionMaxDepth = normalizeAgentMentionMaxDepth(next.agentMentionMaxDepth, 2);
  state.ui = { ...state.ui, ...next };
  await writeState(state);
  if ('telemetryEnabled' in next) await telemetry.setEnabled(next.telemetryEnabled);
  res.json({ ui: state.ui });
});

app.get('/api/telemetry/status', async (_req, res) => {
  await telemetry.initialize();
  res.json(telemetry.status());
});

app.post('/api/telemetry/onboarding-completed', async (req, res) => {
  const importResult = ['completed', 'skipped', 'failed'].includes(req.body?.importResult) ? req.body.importResult : 'skipped';
  captureTelemetry('onboarding_completed', { hermes_source: process.env.FRAKIO_WORK_HERMES_SOURCE || 'unknown', import_result: importResult });
  res.json({ ok: true });
});

app.get('/api/user-profile/summary', async (_req, res) => {
  try {
    const state = await readState();
    const hermesUsage = await readHermesAgentUsageRows();
    const hermesUsageRows = hermesUsage.rows;
    const workbenchUsageRows = (state.observability?.modelUsage || [])
      .filter((row) => row.dataSource !== 'Hermes Agent' && row.provider !== 'Hermes Agent')
      .map((row) => ({ ...row, dataSource: row.dataSource || 'Frakio Work local usage' }));
    const usageRows = [...hermesUsageRows, ...workbenchUsageRows];
    const usage = aggregateModelUsage(usageRows, state.models || []);
    const peakDay = (usage.byDay || []).reduce((peak, row) => Number(row.realTotalTokens || row.totalTokens || 0) > Number(peak.realTotalTokens || peak.totalTokens || 0) ? row : peak, { day: '', totalTokens: 0, realTotalTokens: 0 });
    const agents = collectAgentUsage(state);
    const skills = collectModuleUsage(state, 'skills');
    const plugins = collectModuleUsage(state, 'plugins');
    res.json({
      checkedAt: now(),
      userProfile: state.userProfile,
      stats: {
        totalTokens: Number(usage.realTotalTokens || usage.totalTokens || 0),
        peakDayTokens: Number(peakDay.realTotalTokens || peakDay.totalTokens || 0),
        peakDay: peakDay.day || '',
        requests: Number(usage.totalRequests || 0),
        conversations: (state.threads || []).length,
        activeAgents: agents.filter((agent) => agent.conversationCount > 0 || agent.messageCount > 0).length,
      },
      usage: {
        byDay: usage.byDay || [],
        entries: usage.entries || [],
      },
      hermesAgent: hermesUsage.meta,
      agents,
      modules: { skills, plugins },
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: String(error?.message || error) });
  }
});

app.get('/api/monitoring/summary', async (_req, res) => {
  try {
    const state = await readState();
    const logs = await readMonitoringLogs(160);
    const hermesDb = await readHermesDbSummary();
    const hermesUsage = await readHermesAgentUsageRows();
    const hermesUsageRows = hermesUsage.rows;
    const workbenchUsageRows = (state.observability?.modelUsage || [])
      .filter((row) => row.dataSource !== 'Hermes Agent' && row.provider !== 'Hermes Agent')
      .map((row) => ({ ...row, dataSource: row.dataSource || 'Frakio Work local usage' }));
    const usageRows = [...hermesUsageRows, ...workbenchUsageRows];
    res.json({
      checkedAt: now(),
      logs,
      modelRuns: (state.observability?.modelRuns || []).slice(-200).reverse(),
      usage: aggregateModelUsage(usageRows, state.models || []),
      hermesStudio: { databaseExists: hermesDb.exists, roomCount: hermesDb.rooms.length, sessionCount: hermesDb.sessions.length, usageRowCount: hermesUsageRows.length, usageSource: 'legacy hermes-web-ui db' },
      hermesAgent: hermesUsage.meta,
      modules: {
        skills: collectModuleUsage(state, 'skills'),
        plugins: collectModuleUsage(state, 'plugins'),
      },
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: String(error?.message || error) });
  }
});

app.get('/api/vaults', async (_req, res) => {
  const state = await readState();
  const vaults = await Promise.all(state.vaults.map(markRefreshStatus));
  state.vaults = vaults;
  await writeState(state);
  res.json({ vaults: vaults.map(publicVault), defaultVaultId: state.defaultVaultId });
});

app.post('/api/vaults', async (req, res) => {
  try {
    const vaultPath = path.resolve(String(req.body?.path || '').trim());
    if (!vaultPath) return res.status(400).json({ error: '请输入 Obsidian 仓库路径。' });
    const state = await readState();
    const existing = state.vaults.find((vault) => path.resolve(vault.path) === vaultPath);
    const index = await buildVaultIndex(vaultPath);
    const vault = existing || { id: id('vault'), name: String(req.body?.name || '').trim() || vaultNameFromPath(vaultPath), path: vaultPath };
    Object.assign(vault, {
      name: String(req.body?.name || '').trim() || vault.name || vaultNameFromPath(vaultPath),
      path: vaultPath,
      status: 'indexed',
      documentCount: index.documentCount,
      productCount: index.productCount,
      lastIndexedAt: now(),
      needsRefresh: false,
      index,
    });
    if (!existing) state.vaults.push(vault);
    state.defaultVaultId = vault.id;
    await writeState(state);
    captureTelemetry('feature_used', { feature: 'vault_indexed', outcome: 'completed' });
    captureMeaningfulActivity('vault_indexed');
    res.json({ vault: publicVault(vault), summary: summaryFromVault(vault) });
  } catch (error) {
    res.status(error.status || 500).json({ error: String(error?.message || error) });
  }
});

app.post('/api/vaults/:id/index', async (req, res) => {
  try {
    const state = await readState();
    const vault = state.vaults.find((item) => item.id === req.params.id);
    if (!vault) return res.status(404).json({ error: '仓库不存在。' });
    const index = await buildVaultIndex(vault.path);
    Object.assign(vault, {
      status: 'indexed',
      documentCount: index.documentCount,
      productCount: index.productCount,
      lastIndexedAt: now(),
      needsRefresh: false,
      index,
    });
    await writeState(state);
    captureTelemetry('feature_used', { feature: 'vault_indexed', outcome: 'completed' });
    captureMeaningfulActivity('vault_indexed');
    res.json({ vault: publicVault(vault), summary: summaryFromVault(vault) });
  } catch (error) {
    res.status(error.status || 500).json({ error: String(error?.message || error) });
  }
});

app.delete('/api/vaults/:id', async (req, res) => {
  const state = await readState();
  const vault = state.vaults.find((item) => item.id === req.params.id);
  if (!vault) return res.status(404).json({ error: '仓库不存在，可能已经被移除。' });

  const detachedWorkspaceIds = state.workspaces
    .filter((workspace) => workspace.vaultId === vault.id)
    .map((workspace) => workspace.id);
  const detachedThreadIds = state.threads
    .filter((thread) => thread.vaultId === vault.id)
    .map((thread) => thread.id);

  state.workspaces.forEach((workspace) => {
    if (workspace.vaultId === vault.id) {
      workspace.vaultId = null;
      workspace.updatedAt = now();
    }
  });
  state.threads.forEach((thread) => {
    if (thread.vaultId === vault.id) {
      thread.vaultId = null;
      thread.updatedAt = now();
    }
  });
  state.vaults = state.vaults.filter((item) => item.id !== vault.id);
  if (state.defaultVaultId === vault.id) state.defaultVaultId = state.vaults[0]?.id || null;

  await writeState(state);
  res.json({
    ok: true,
    deletedVaultId: vault.id,
    defaultVaultId: state.defaultVaultId,
    detachedWorkspaceIds,
    detachedThreadIds,
  });
});

app.get('/api/vaults/:id/summary', async (req, res) => {
  const state = await readState();
  const vault = state.vaults.find((item) => item.id === req.params.id);
  if (!vault) return res.status(404).json({ error: '仓库不存在。' });
  res.json(summaryFromVault(await markRefreshStatus(vault)));
});

app.get('/api/vault/summary', async (_req, res) => {
  const state = await readState();
  const vault = state.vaults.find((item) => item.id === state.defaultVaultId) || state.vaults[0];
  res.json(summaryFromVault(await markRefreshStatus(vault)));
});

app.get('/api/spaces', async (_req, res) => {
  const state = await readState();
  const includeArchived = String(_req.query?.includeArchived || '').toLowerCase() === 'true';
  const spaces = state.spaces
    .filter((space) => includeArchived || !space.archivedAt)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    .map(publicSpace);
  res.json({ spaces, activeSpaceId: state.ui.activeSpaceId || spaces[0]?.id || null });
});

app.post('/api/spaces', async (req, res) => {
  const state = await readState();
  const name = String(req.body?.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: '工作区名称不能为空。' });
  const space = normalizeSpace({
    id: id('space'),
    name,
    iconKind: req.body?.iconKind,
    iconValue: req.body?.iconValue,
    theme: req.body?.theme || defaultSpaceTheme,
    lastOpenedAt: now(),
  }, name);
  state.spaces.push(space);
  state.ui.activeSpaceId = space.id;
  await writeState(state);
  res.json({ space: publicSpace(space), activeSpaceId: space.id });
});

app.patch('/api/spaces/:id', async (req, res) => {
  const state = await readState();
  const space = state.spaces.find((item) => item.id === req.params.id);
  if (!space) return res.status(404).json({ error: '工作区不存在。' });
  if ('name' in req.body) space.name = String(req.body.name || space.name).slice(0, 60);
  if ('iconKind' in req.body) space.iconKind = req.body.iconKind === 'icon' ? 'icon' : req.body.iconKind === 'emoji' ? 'emoji' : 'dot';
  if ('iconValue' in req.body) space.iconValue = String(req.body.iconValue || space.iconValue || '').slice(0, 16);
  if ('theme' in req.body) space.theme = normalizeSpaceTheme({ ...(space.theme || {}), ...(req.body.theme || {}) });
  if ('active' in req.body && req.body.active) {
    space.lastOpenedAt = now();
    state.ui.activeSpaceId = space.id;
  }
  space.updatedAt = now();
  await writeState(state);
  res.json({ space: publicSpace(space), activeSpaceId: state.ui.activeSpaceId });
});

app.get('/api/workspaces', async (_req, res) => {
  const state = await readState();
  const includeArchived = String(_req.query?.includeArchived || '').toLowerCase() === 'true';
  res.json({ workspaces: state.workspaces.filter((workspace) => includeArchived || !workspace.archivedAt).sort(sortPinnedThenUpdated).map((workspace) => publicWorkspace(workspace, state)) });
});

app.post('/api/workspaces', async (req, res) => {
  try {
    const state = await readState();
    const defaultAgentId = resolveDefaultAgentId(state);
    const name = String(req.body?.name || '').trim().slice(0, 60);
    const mode = req.body?.mode === 'existing' ? 'existing' : 'create';
    if (mode === 'create' && !name) return res.status(400).json({ error: '项目名称不能为空。' });
    if (mode === 'existing' && !String(req.body?.rootPath || '').trim()) return res.status(400).json({ error: '请选择或输入已有文件夹路径。' });
    const parentPath = await ensureDirectory(req.body?.parentPath || defaultProjectsRoot);
    const requestedSpaceId = state.spaces.some((space) => space.id === req.body?.spaceId && !space.archivedAt) ? req.body.spaceId : state.ui.activeSpaceId || state.spaces[0]?.id || null;
    const requestedRoot = mode === 'existing'
      ? String(req.body?.rootPath || '').trim()
      : path.join(parentPath, slug(name) || 'new-project');
    const rootPath = await ensureDirectory(requestedRoot);
    const existingWorkspace = state.workspaces.find((workspace) => path.resolve(workspace.rootPath) === rootPath);
    if (existingWorkspace) return res.status(409).json({ error: '这个文件夹已经绑定到一个项目。', workspace: publicWorkspace(existingWorkspace, state) });
    const workspaceName = name || vaultNameFromPath(rootPath);
    const vault = await ensureVaultForRoot(state, rootPath, workspaceName);
    await knowledgeGateway.initializeVault(vault);
    const workspace = {
      id: id('workspace'),
      spaceId: requestedSpaceId,
      name: workspaceName,
      rootPath,
      vaultId: vault.id,
      primaryVaultId: vault.id,
      sharedVaultIds: [],
      writableVaultIds: [vault.id],
      environment: 'local',
      activeThreadId: null,
      archivedAt: null,
      pinnedAt: null,
      createdAt: now(),
      updatedAt: now(),
    };
    const thread = createThreadRecord({
      spaceId: workspace.spaceId,
      workspaceId: workspace.id,
      title: workspace.name,
      vaultId: vault.id,
      selectedAgents: Array.from(new Set([defaultAgentId, 'max'].filter(Boolean))),
      mode: 'workspace',
      primaryAgentId: defaultAgentId,
      defaultAgentId,
    });
    workspace.activeThreadId = thread.id;
    state.workspaces.push(workspace);
    state.threads.unshift(thread);
    state.defaultVaultId = vault.id;
    if (requestedSpaceId) state.ui.activeSpaceId = requestedSpaceId;
    await writeState(state);
    captureTelemetry('project_created', { mode });
    captureMeaningfulActivity('project_created');
    res.json({ workspace: publicWorkspace(workspace, state), vault: publicVault(vault), thread });
  } catch (error) {
    res.status(error.status || 500).json({ error: String(error?.message || error) });
  }
});

app.patch('/api/workspaces/:id', async (req, res) => {
  const result = await updateState(async (state) => {
    const workspace = state.workspaces.find((item) => item.id === req.params.id);
    if (!workspace) return null;
    if ('name' in req.body) workspace.name = String(req.body.name || workspace.name).slice(0, 60);
    if ('archived' in req.body) workspace.archivedAt = req.body.archived ? now() : null;
    if ('pinned' in req.body) workspace.pinnedAt = req.body.pinned ? now() : null;
    workspace.updatedAt = now();
    return { workspace: publicWorkspace(workspace, state) };
  });
  if (!result) return res.status(404).json({ error: 'Workspace 不存在。' });
  res.json(result);
});

app.delete('/api/workspaces/:id', async (req, res) => {
  const result = await updateState(async (state) => {
    const workspace = state.workspaces.find((item) => item.id === req.params.id);
    if (!workspace) return null;
    const deletedThreadIds = state.threads.filter((thread) => thread.workspaceId === workspace.id).map((thread) => thread.id);
    state.threads = state.threads.filter((thread) => thread.workspaceId !== workspace.id);
    state.workspaces = state.workspaces.filter((item) => item.id !== workspace.id);
    if (state.defaultVaultId === workspace.vaultId) state.defaultVaultId = state.vaults.find((vault) => state.workspaces.some((item) => item.vaultId === vault.id))?.id || state.vaults[0]?.id || null;
    return { deletedWorkspaceId: workspace.id, deletedThreadIds };
  });
  if (!result) return res.status(404).json({ error: 'Workspace 不存在。' });
  await attachmentStore.removeForThreads(result.deletedThreadIds);
  res.json({ ok: true, ...result });
});

app.get('/api/conversations', async (_req, res) => {
  const state = await readState();
  await healStaleRunningThreads(state);
  const conversations = state.threads
    .filter((thread) => thread.mode === 'direct' && !thread.archivedAt)
    .sort(sortPinnedThenUpdated)
    .map((thread) => summarizeThread(thread, state));
  res.json({ conversations });
});

app.get('/api/threads/archived', async (_req, res) => {
  const state = await readState();
  const threads = state.threads
    .filter((thread) => thread.archivedAt)
    .sort((a, b) => String(b.archivedAt || '').localeCompare(String(a.archivedAt || '')))
    .map((thread) => summarizeThread(thread, state));
  res.json({ threads });
});

app.post('/api/conversations', async (req, res) => {
  try {
    const result = await updateState(async (state) => {
      const defaultAgentId = resolveDefaultAgentId(state);
      const spaceId = state.spaces.some((space) => space.id === req.body?.spaceId && !space.archivedAt) ? req.body.spaceId : state.ui.activeSpaceId || state.spaces[0]?.id || null;
      const requestedCoordinatorId = state.agents.some((agent) => agent.id === req.body?.coordinatorAgentId) ? req.body.coordinatorAgentId : '';
      const primaryAgentId = state.agents.some((agent) => agent.id === req.body?.primaryAgentId) ? req.body.primaryAgentId : requestedCoordinatorId || defaultAgentId;
      const primaryAgent = state.agents.find((agent) => agent.id === primaryAgentId);
      const selectedAgents = Array.from(new Set([primaryAgentId || defaultAgentId].filter(Boolean)));
      const executionMode = req.body?.executionMode === 'work' ? 'work' : 'chat';
      const thread = createThreadRecord({
        spaceId,
        workspaceId: null,
        title: String(req.body?.title || (primaryAgent ? `${primaryAgent.name} 对话` : '新的对话')).slice(0, 60),
        vaultId: null,
        selectedAgents,
        agentModelOverrides: normalizeAgentModelOverrides(req.body?.agentModelOverrides, state.agents, state.models),
        agentRuntimeOverrides: normalizeAgentRuntimeOverrides(req.body?.agentRuntimeOverrides, state.agents),
        agentRunOverrides: normalizeAgentRunOverrides(req.body?.agentRunOverrides, state.agents),
        mode: 'direct',
        executionMode,
        primaryAgentId,
        defaultAgentId: primaryAgentId,
      });
      let work = null;
      if (executionMode === 'work') work = await initializeNewThreadWorkMode(state, thread, requestedCoordinatorId || primaryAgentId, String(req.body?.requestId || ''));
      if (req.body?.collaborationMode === 'plan') {
        if (executionMode === 'chat') await ensurePlanRuntimeCapability(await resolveHermesProfileNameForAgent(primaryAgent || {}));
        createPlanSession(thread, { authorAgentId: requestedCoordinatorId || primaryAgentId, targetExecutionMode: executionMode, at: now() });
      }
      state.threads.unshift(thread);
      if (spaceId) state.ui.activeSpaceId = spaceId;
      const snapshot = work ? await collaborationSnapshot(state, thread, work.workflow.id) : null;
      return { state, thread, work, snapshot, executionMode };
    });
    captureTelemetry('conversation_created', { kind: 'direct', executionMode: result.executionMode });
    captureMeaningfulActivity('conversation_created');
    res.json({ thread: result.thread, conversation: summarizeThread(result.thread, result.state), workflow: result.work?.workflow || null, capability: result.work?.capability || null, snapshot: result.snapshot });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '新对话创建失败。', code: error.code || '', details: error.details || {} });
  }
});

app.get('/api/workspaces/:id/threads', async (req, res) => {
  const state = await readState();
  await healStaleRunningThreads(state);
  const threads = state.threads
    .filter((thread) => thread.workspaceId === req.params.id && thread.mode !== 'direct' && !thread.archivedAt)
    .sort(sortPinnedThenUpdated)
    .map((thread) => summarizeThread(thread, state));
  res.json({ threads });
});

app.get('/api/workspaces/:id/artifacts', async (req, res) => {
  try {
    const state = await readState();
    const workspace = state.workspaces.find((item) => item.id === req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Workspace 不存在。' });
    const artifacts = await collectWorkspaceArtifacts(workspace.rootPath);
    res.json({ artifacts });
  } catch (error) {
    res.status(error.status || 500).json({ error: String(error?.message || error) });
  }
});

app.get('/api/workspaces/:id/files', async (req, res) => {
  try {
    const state = await readState();
    const workspace = state.workspaces.find((item) => item.id === req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Workspace 不存在。' });
    const entries = await listWorkspaceFiles(workspace.rootPath, String(req.query.dir || ''));
    res.json({ rootPath: workspace.rootPath, dir: String(req.query.dir || ''), entries });
  } catch (error) {
    res.status(error.status || 500).json({ error: String(error?.message || error) });
  }
});

app.get('/api/workspaces/:id/files/content', async (req, res) => {
  try {
    const state = await readState();
    const workspace = state.workspaces.find((item) => item.id === req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Workspace 不存在。' });
    const file = await readWorkspaceFileContent(workspace.rootPath, String(req.query.path || ''));
    res.json({ file });
  } catch (error) {
    res.status(error.status || 500).json({ error: String(error?.message || error) });
  }
});

app.get('/api/rich-preview', async (req, res) => {
  try {
    const state = await readState();
    const threadId = String(req.query.threadId || '');
    const workspaceId = String(req.query.workspaceId || '');
    const thread = threadId ? state.threads.find((item) => item.id === threadId) : null;
    const resolvedWorkspaceId = workspaceId || thread?.workspaceId || '';
    const workspace = resolvedWorkspaceId ? state.workspaces.find((item) => item.id === resolvedWorkspaceId) : null;
    const preview = await resolveRichPreviewFile(String(req.query.path || ''), [
      workspace?.rootPath,
      attachmentRoot,
      frakioWorkHome,
      os.tmpdir(),
    ]);
    res.setHeader('Content-Type', preview.mimeType);
    res.setHeader('Content-Length', String(preview.size));
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(preview.fileName)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    await pipeline(preview.stream(), res);
  } catch (error) {
    if (!res.headersSent) res.status(error.status || 500).json({ error: error.message || '文件预览失败。', code: error.code || 'RICH_PREVIEW_FAILED' });
  }
});

app.post('/api/threads/:threadId/messages/:messageId/rich-content/repair', async (req, res) => {
  try {
    const state = await readState();
    const thread = state.threads.find((item) => item.id === req.params.threadId);
    const message = thread?.messages?.find((item) => item.id === req.params.messageId);
    if (!thread || !message) return res.status(404).json({ error: '消息不存在。', code: 'RICH_CONTENT_MESSAGE_NOT_FOUND' });
    if (message.agentId === 'user' || message.agentId === 'system') return res.status(400).json({ error: '只能修复 Agent 富内容回复。', code: 'RICH_CONTENT_MESSAGE_NOT_AGENT' });
    const validation = validateRichContentOutput(message.content);
    if (validation.valid) return res.json({ repaired: false, thread });
    const result = await repairRichContentFinalOutput(thread.id, message.externalRunId || `message-${message.id}`, message.content);
    if (!result.repaired) return res.status(422).json({ error: '富内容自动修复失败，已保留原消息。', code: 'RICH_CONTENT_REPAIR_FAILED', issues: result.issues });
    const updatedThread = await updateState(async (latest) => {
      const currentThread = latest.threads.find((item) => item.id === thread.id);
      const currentMessage = currentThread?.messages?.find((item) => item.id === message.id);
      if (!currentThread || !currentMessage) return null;
      currentMessage.content = result.output;
      currentMessage.richContentRepairedAt = now();
      currentThread.updatedAt = now();
      return currentThread;
    });
    res.json({ repaired: true, thread: updatedThread });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '富内容修复失败。', code: error.code || 'RICH_CONTENT_REPAIR_FAILED' });
  }
});

app.post('/api/workspaces/:id/threads', async (req, res) => {
  try {
    const result = await updateState(async (state) => {
      const workspace = state.workspaces.find((item) => item.id === req.params.id);
      if (!workspace) return null;
      const defaultAgentId = resolveDefaultAgentId(state);
      const coordinatorAgentId = state.agents.some((agent) => agent.id === req.body?.coordinatorAgentId) ? req.body.coordinatorAgentId : defaultAgentId;
      const executionMode = req.body?.executionMode === 'work' ? 'work' : 'chat';
      const thread = createThreadRecord({
        spaceId: workspace.spaceId || state.ui.activeSpaceId || state.spaces[0]?.id || null,
        workspaceId: workspace.id,
        title: String(req.body?.title || '新的团队议事').slice(0, 40),
        vaultId: workspace.vaultId || null,
        selectedAgents: Array.from(new Set([defaultAgentId, coordinatorAgentId, 'max'].filter(Boolean))),
        agentModelOverrides: normalizeAgentModelOverrides(req.body?.agentModelOverrides, state.agents, state.models),
        agentRuntimeOverrides: normalizeAgentRuntimeOverrides(req.body?.agentRuntimeOverrides, state.agents),
        agentRunOverrides: normalizeAgentRunOverrides(req.body?.agentRunOverrides, state.agents),
        mode: 'workspace',
        executionMode,
        primaryAgentId: defaultAgentId,
        defaultAgentId,
      });
      let work = null;
      if (executionMode === 'work') work = await initializeNewThreadWorkMode(state, thread, coordinatorAgentId, String(req.body?.requestId || ''));
      if (req.body?.collaborationMode === 'plan') {
        if (executionMode === 'chat') {
          const coordinator = state.agents.find((agent) => agent.id === coordinatorAgentId || agent.id === defaultAgentId);
          await ensurePlanRuntimeCapability(await resolveHermesProfileNameForAgent(coordinator || {}));
        }
        createPlanSession(thread, { authorAgentId: coordinatorAgentId || defaultAgentId, targetExecutionMode: executionMode, at: now() });
      }
      state.threads.unshift(thread);
      workspace.activeThreadId = thread.id;
      workspace.updatedAt = now();
      if (thread.spaceId) state.ui.activeSpaceId = thread.spaceId;
      const snapshot = work ? await collaborationSnapshot(state, thread, work.workflow.id) : null;
      return { thread, work, snapshot, executionMode };
    });
    if (!result) return res.status(404).json({ error: 'Workspace 不存在。' });
    captureTelemetry('conversation_created', { kind: 'workspace', executionMode: result.executionMode });
    captureMeaningfulActivity('conversation_created');
    res.json({ thread: result.thread, workflow: result.work?.workflow || null, capability: result.work?.capability || null, snapshot: result.snapshot });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '新项目对话创建失败。', code: error.code || '', details: error.details || {} });
  }
});

app.get('/api/threads/:id', async (req, res) => {
  const state = await readState();
  await healStaleRunningThreads(state);
  const thread = state.threads.find((item) => item.id === req.params.id);
  if (!thread) return res.status(404).json({ error: '会话不存在。' });
  res.json({ thread });
});

app.post('/api/threads/:threadId/branches', async (req, res) => {
  let createdThreadId = '';
  try {
    const messageId = String(req.body?.messageId || '').trim();
    if (!messageId) return res.status(400).json({ error: 'messageId 不能为空。', code: 'BRANCH_MESSAGE_REQUIRED' });
    const result = await updateState(async (state) => {
      const sourceThread = state.threads.find((thread) => thread.id === req.params.threadId);
      if (!sourceThread) return { error: { status: 404, message: '会话不存在。', code: 'BRANCH_THREAD_NOT_FOUND' } };
      const targetMessage = (sourceThread.messages || []).find((message) => message.id === messageId);
      if (!targetMessage) return { error: { status: 404, message: '分支消息不存在。', code: 'BRANCH_MESSAGE_NOT_FOUND' } };
      if (!isPersistedAgentMessage(targetMessage)) {
        return { error: { status: 400, message: '只能从已完成的 Agent 回复创建分支。', code: 'BRANCH_MESSAGE_NOT_AGENT' } };
      }
      const targetTranscript = normalizeRunTranscripts(sourceThread.runTranscripts)
        .find((transcript) => transcript.messageId === targetMessage.id || (targetMessage.externalRunId && transcript.runId === targetMessage.externalRunId));
      const targetPlan = targetMessage.planId ? (sourceThread.planSessions || []).find((plan) => plan.id === targetMessage.planId) : null;
      const targetPlanDraft = targetPlan?.drafts?.find((draft) => Number(draft.revision) === Number(targetMessage.planRevision));
      const targetRunId = targetMessage.externalRunId || targetPlanDraft?.submittedByRunId || '';
      if (targetTranscript?.status === 'running' || (targetRunId && targetRunId === sourceThread.activeRunId)) {
        return { error: { status: 409, message: '这条回复仍在生成，完成后才能创建分支。', code: 'BRANCH_MESSAGE_RUNNING' } };
      }

      const title = branchTreeTitle(state, sourceThread);
      const thread = createThreadRecord({
        spaceId: sourceThread.spaceId,
        workspaceId: sourceThread.workspaceId || null,
        title,
        vaultId: sourceThread.vaultId || null,
        selectedAgents: [...(sourceThread.selectedAgents || [])],
        agentModelOverrides: structuredClone(sourceThread.agentModelOverrides || {}),
        agentRunOverrides: structuredClone(sourceThread.agentRunOverrides || {}),
        mode: sourceThread.mode || (sourceThread.workspaceId ? 'workspace' : 'direct'),
        executionMode: sourceThread.executionMode === 'work' ? 'work' : 'chat',
        primaryAgentId: sourceThread.primaryAgentId,
        defaultAgentId: sourceThread.defaultAgentId,
        followMode: sourceThread.followMode,
      });
      createdThreadId = thread.id;
      const history = await cloneThreadHistoryForBranch(sourceThread, targetMessage, thread.id);
      thread.messages = history.messages;
      thread.runTranscripts = history.runTranscripts;
      thread.planSessions = history.planSessions;
      thread.activePlanId = '';
      thread.collaborationMode = 'default';
      thread.workerOutputMode = sourceThread.workerOutputMode === 'all' ? 'all' : 'summary';
      thread.activeAgentId = sourceThread.activeAgentId || sourceThread.defaultAgentId || sourceThread.primaryAgentId;
      thread.permissionMode = ['manual', 'smart', 'off'].includes(sourceThread.permissionMode) ? sourceThread.permissionMode : 'smart';
      thread.engine = sourceThread.engine || 'hermes-agent';
      thread.externalSessionId = null;
      thread.runStatus = 'idle';
      thread.workflow = [];
      thread.workflowState = [];
      thread.proposals = [];
      thread.artifacts = [];
      thread.contextPacket = null;
      thread.forkedFromThreadId = sourceThread.id;
      thread.forkedFromMessageId = targetMessage.id;
      thread.branchRootThreadId = sourceThread.branchRootThreadId || sourceThread.id;
      thread.collaboration = normalizeCollaboration({
        kind: thread.mode === 'workspace' ? 'workspace-group-chat' : 'direct-chat',
        activeAgentId: thread.activeAgentId,
        maxMentionDepth: sourceThread.collaboration?.maxMentionDepth,
      }, { defaultAgentId: thread.defaultAgentId, activeAgentId: thread.activeAgentId });

      let work = null;
      if (thread.executionMode === 'work') {
        work = await initializeNewThreadWorkMode(state, thread, thread.activeAgentId || thread.defaultAgentId, `branch:${thread.id}`);
      }
      state.threads.unshift(thread);
      if (thread.spaceId) state.ui.activeSpaceId = thread.spaceId;
      const workspace = thread.workspaceId ? state.workspaces.find((item) => item.id === thread.workspaceId) : null;
      if (workspace) {
        workspace.activeThreadId = thread.id;
        workspace.updatedAt = now();
      }
      const snapshot = work ? await collaborationSnapshot(state, thread, work.workflow.id) : null;
      return { state, thread, work, snapshot };
    });
    if (result?.error) {
      return res.status(result.error.status).json({ error: result.error.message, code: result.error.code });
    }
    res.status(201).json({
      thread: result.thread,
      conversation: summarizeThread(result.thread, result.state),
      workflow: result.work?.workflow || null,
      capability: result.work?.capability || null,
      snapshot: result.snapshot,
    });
  } catch (error) {
    if (createdThreadId) await attachmentStore.removeForThreads([createdThreadId]).catch(() => {});
    res.status(error.status || 500).json({ error: error.message || '创建分支失败。', code: error.code || 'BRANCH_CREATE_FAILED' });
  }
});

app.patch('/api/threads/:threadId/messages/:messageId/feedback', async (req, res) => {
  const value = req.body?.value;
  if (!['up', 'down', null].includes(value)) {
    return res.status(400).json({ error: '反馈值无效。', code: 'MESSAGE_FEEDBACK_INVALID' });
  }
  const result = await updateState(async (state) => {
    const thread = state.threads.find((item) => item.id === req.params.threadId);
    if (!thread) return { error: { status: 404, message: '会话不存在。', code: 'MESSAGE_FEEDBACK_THREAD_NOT_FOUND' } };
    const message = (thread.messages || []).find((item) => item.id === req.params.messageId);
    if (!message) return { error: { status: 404, message: '消息不存在。', code: 'MESSAGE_FEEDBACK_MESSAGE_NOT_FOUND' } };
    if (!isPersistedAgentMessage(message)) {
      return { error: { status: 400, message: '只能评价 Agent 回复。', code: 'MESSAGE_FEEDBACK_NOT_AGENT' } };
    }
    message.feedback = value;
    thread.updatedAt = now();
    return { thread, message };
  });
  if (result.error) return res.status(result.error.status).json({ error: result.error.message, code: result.error.code });
  res.json(result);
});

app.patch('/api/threads/:id/mode', async (req, res) => {
  try {
    const targetMode = String(req.body?.mode || '').toLowerCase();
    if (!['chat', 'work'].includes(targetMode)) return res.status(400).json({ error: 'mode must be chat or work.' });
    const state = await readState();
    const thread = state.threads.find((item) => item.id === req.params.id);
    if (!thread) return res.status(404).json({ error: '会话不存在。' });
    if (thread.collaborationMode === 'plan' && activePlanSession(thread)) {
      return res.status(409).json({ error: '计划模式进行中，需先执行或取消当前计划。', code: 'PLAN_EXECUTION_MODE_LOCKED' });
    }
    const previousMode = thread.executionMode === 'work' ? 'work' : 'chat';
    if (targetMode === 'chat') {
      thread.executionMode = 'chat';
      thread.updatedAt = now();
      if (previousMode !== 'chat') appendThreadCollaborationEvent(thread, { type: 'mode.changed', workflowId: thread.collaboration?.activeWorkflowId || '', actorAgentId: 'user', title: '已切换到 Chat', detail: '后台 Work 任务会继续运行', payload: { mode: 'chat', previousMode } });
      await writeState(state);
      return res.json({ thread, mode: 'chat', workflow: workflowById(thread), backgroundWorkContinues: true });
    }

    const coordinatorAgentId = state.agents.some((agent) => agent.id === req.body?.agentId)
      ? req.body.agentId
      : thread.activeAgentId || thread.defaultAgentId || resolveDefaultAgentId(state);
    const coordinatorAgent = state.agents.find((agent) => agent.id === coordinatorAgentId);
    const profileName = await resolveHermesProfileNameForAgent(coordinatorAgent || {});
    const reusableWorkflowStatuses = new Set(['active', 'paused']);
    let workflow = (thread.collaboration?.workflows || []).find((item) => item.id === thread.collaboration?.activeWorkflowId && reusableWorkflowStatuses.has(item.status))
      || (thread.collaboration?.workflows || []).find((item) => reusableWorkflowStatuses.has(item.status));
    let capability;
    try {
      capability = await ensureCollaborationRuntimeCapability(profileName);
    } catch (error) {
      if (workflow) {
        workflow.capability = { status: 'blocked', protocolVersion: 0, checkedAt: now(), error: String(error.message || error) };
        appendThreadCollaborationEvent(thread, { type: 'capability.blocked', workflowId: workflow.id, actorAgentId: 'system', title: '协作工具未加载', detail: String(error.message || error), payload: { profileName, missingTools: error.details?.missingTools || [] } });
        thread.updatedAt = now();
        await writeState(state);
      }
      error.details = { ...(error.details || {}), mode: 'chat', requestedMode: 'work' };
      throw error;
    }
    if (!workflow) {
      const created = await createCollaborationWorkflow(state, thread, {
        name: thread.title || '协作工作流',
        coordinatorAgentId,
        idempotencyKey: `mode-work:${thread.id}`,
      });
      workflow = created.workflow;
    } else {
      workflow.coordinatorAgentId = coordinatorAgentId;
      workflow.updatedAt = now();
      thread.collaboration.activeWorkflowId = workflow.id;
    }
    workflow.capability = { status: 'ready', protocolVersion: capability.protocolVersion, checkedAt: now(), reloaded: Boolean(capability.reloaded), error: '' };
    thread.executionMode = 'work';
    thread.updatedAt = now();
    if (previousMode !== 'work') appendThreadCollaborationEvent(thread, { type: 'mode.changed', workflowId: workflow.id, actorAgentId: 'user', title: '已切换到 Work', detail: `协调 Agent：${coordinatorAgent?.name || coordinatorAgentId}`, payload: { mode: 'work', previousMode, coordinatorAgentId } });
    await writeState(state);
    const snapshot = await collaborationSnapshot(state, thread, workflow.id);
    res.json({ thread, mode: 'work', workflow, snapshot, capability });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '对话模式切换失败。', code: error.code || '', details: error.details || {} });
  }
});

app.patch('/api/threads/:id/collaboration-mode', async (req, res) => {
  try {
    const requestedMode = req.body?.mode === 'plan' ? 'plan' : req.body?.mode === 'default' ? 'default' : '';
    if (!requestedMode) return res.status(400).json({ error: 'mode must be default or plan.' });
    const state = await readState();
    const thread = state.threads.find((item) => item.id === req.params.id);
    if (!thread) return res.status(404).json({ error: '会话不存在。' });
    const current = activePlanSession(thread);
    if (requestedMode === 'default') {
      if (current) cancelPlanSession(thread, current, now());
      else {
        thread.collaborationMode = 'default';
        thread.activePlanId = '';
        thread.updatedAt = now();
      }
      await writeState(state);
      captureTelemetry('plan_cancelled', { source: 'mode_control' });
      return res.json({ thread, plan: current ? publicPlanSession(current) : null });
    }
    if (thread.runStatus === 'running') return res.status(409).json({ error: '当前运行结束后才能开启计划模式。', code: 'THREAD_RUN_ACTIVE' });
    if (current) return res.json({ thread, plan: publicPlanSession(current), idempotent: true });
    const workflow = workflowById(thread);
    if (workflow?.currentRootTaskId) {
      const detail = await readKanbanTaskDetail(workflow.boardSlug, workflow.currentRootTaskId).catch(() => null);
      const rootStatus = String(detail?.task?.status || detail?.status || '');
      if (rootStatus && !['done', 'archived', 'cancelled', 'failed'].includes(rootStatus)) {
        return res.status(409).json({ error: '当前 Work 任务仍在执行，完成或取消后才能开启计划模式。', code: 'WORK_ROOT_ACTIVE' });
      }
    }
    const authorAgentId = state.agents.some((agent) => agent.id === req.body?.authorAgentId)
      ? req.body.authorAgentId
      : workflow?.coordinatorAgentId || thread.activeAgentId || thread.defaultAgentId || resolveDefaultAgentId(state);
    const author = state.agents.find((agent) => agent.id === authorAgentId);
    const profileName = await resolveHermesProfileNameForAgent(author || {});
    await ensurePlanRuntimeCapability(profileName);
    const plan = createPlanSession(thread, {
      authorAgentId,
      targetExecutionMode: thread.executionMode === 'work' ? 'work' : 'chat',
      at: now(),
    });
    await writeState(state);
    captureTelemetry('plan_enabled', { target_mode: plan.targetExecutionMode });
    res.json({ thread, plan: publicPlanSession(plan) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '计划模式切换失败。', code: error.code || '', details: error.details || {} });
  }
});

app.get('/api/threads/:id/plans/events', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  let lastDigest = '';
  let closed = false;
  req.on('close', () => { closed = true; });
  while (!closed) {
    try {
      const state = await readState();
      const thread = state.threads.find((item) => item.id === req.params.id);
      if (!thread) {
        res.write(`data: ${JSON.stringify({ event: 'plan.not_found' })}\n\n`);
        break;
      }
      const plan = activePlanSession(thread);
      let autoResolved = false;
      if (plan) {
        for (const batch of plan.questions || []) {
          if (batch.status === 'pending' && batch.autoResolutionMs) {
            const before = batch.status;
            autoResolvePlanQuestionBatch(plan, batch.id, now());
            if (before !== batch.status) autoResolved = true;
          }
        }
      }
      if (autoResolved) await writeState(state);
      const payload = {
        event: 'plan.snapshot',
        collaborationMode: thread.collaborationMode,
        activePlanId: thread.activePlanId || '',
        plan: publicPlanSession(plan),
      };
      const digest = createHash('sha1').update(JSON.stringify(payload)).digest('hex');
      if (digest !== lastDigest) {
        lastDigest = digest;
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } else {
        res.write(': keep-alive\n\n');
      }
    } catch (error) {
      res.write(`data: ${JSON.stringify({ event: 'plan.error', error: String(error?.message || error) })}\n\n`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  res.end();
});

app.post('/api/threads/:id/plans/:planId/questions', async (req, res) => {
  try {
    const result = await updateState(async (state) => {
      const thread = state.threads.find((item) => item.id === req.params.id);
      const plan = thread?.planSessions?.find((item) => item.id === req.params.planId);
      if (!thread || !plan) return null;
      if (thread.activePlanId !== plan.id || thread.collaborationMode !== 'plan') throw Object.assign(new Error('Plan session is not active.'), { status: 409, code: 'PLAN_NOT_ACTIVE' });
      const batch = createPlanQuestionBatch(plan, req.body || {}, now());
      thread.updatedAt = now();
      return { batch, plan: publicPlanSession(plan) };
    });
    if (!result) return res.status(404).json({ error: 'Plan session not found.' });
    captureTelemetry('plan_question_requested', { question_count: result.batch.questions.length, auto_resolve: Boolean(result.batch.autoResolutionMs) });
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Plan question request failed.', code: error.code || '', details: error.details || {} });
  }
});

app.get('/api/threads/:id/plans/:planId/questions/:requestId', async (req, res) => {
  try {
    const state = await readState();
    const thread = state.threads.find((item) => item.id === req.params.id);
    const plan = thread?.planSessions?.find((item) => item.id === req.params.planId);
    if (!thread || !plan) return res.status(404).json({ error: 'Plan session not found.' });
    const batch = autoResolvePlanQuestionBatch(plan, req.params.requestId, now());
    if (!batch) return res.status(404).json({ error: 'Plan question request not found.' });
    if (batch.status === 'auto_resolved') await writeState(state);
    res.json({ batch, planStatus: plan.status });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Plan question read failed.', code: error.code || '' });
  }
});

app.post('/api/threads/:id/plans/:planId/questions/:requestId/answer', async (req, res) => {
  try {
    const result = await updateState(async (state) => {
      const thread = state.threads.find((item) => item.id === req.params.id);
      const plan = thread?.planSessions?.find((item) => item.id === req.params.planId);
      if (!thread || !plan) return null;
      const batch = resolvePlanQuestionBatch(plan, req.params.requestId, req.body?.answers || {}, now());
      thread.updatedAt = now();
      return { batch, plan: publicPlanSession(plan) };
    });
    if (!result) return res.status(404).json({ error: 'Plan session not found.' });
    captureTelemetry('plan_question_answered', { question_count: result.batch.questions.length });
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Plan answer failed.', code: error.code || '', details: error.details || {} });
  }
});

app.post('/api/threads/:id/plans/:planId/questions/:requestId/cancel', async (req, res) => {
  try {
    const result = await updateState(async (state) => {
      const thread = state.threads.find((item) => item.id === req.params.id);
      const plan = thread?.planSessions?.find((item) => item.id === req.params.planId);
      if (!thread || !plan) return null;
      if (thread.activePlanId !== plan.id || thread.collaborationMode !== 'plan') {
        throw Object.assign(new Error('Plan session is not active.'), { status: 409, code: 'PLAN_NOT_ACTIVE' });
      }
      const batch = cancelPlanQuestionBatch(plan, req.params.requestId, now());
      thread.updatedAt = now();
      return { batch, plan: publicPlanSession(plan) };
    });
    if (!result) return res.status(404).json({ error: 'Plan session not found.' });
    captureTelemetry('plan_question_cancelled', { question_count: result.batch.questions.length });
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Plan question cancel failed.', code: error.code || '', details: error.details || {} });
  }
});

app.post('/api/threads/:id/plans/:planId/submit', async (req, res) => {
  try {
    const result = await updateState(async (state) => {
      const thread = state.threads.find((item) => item.id === req.params.id);
      const plan = thread?.planSessions?.find((item) => item.id === req.params.planId);
      if (!thread || !plan) return null;
      if (thread.activePlanId !== plan.id || thread.collaborationMode !== 'plan') throw Object.assign(new Error('Plan session is not active.'), { status: 409, code: 'PLAN_NOT_ACTIVE' });
      const submittedByRunId = String(req.body?.submittedByRunId || thread.activeRunId || plan.sourceRunId || '').trim();
      const previousRevision = Number(plan.currentRevision || 0);
      const draft = submitPlanDraft(plan, req.body || {}, { agentIds: state.agents.map((agent) => agent.id), submittedByRunId }, now());
      const messageExists = (thread.messages || []).some((message) => message.planId === plan.id && Number(message.planRevision) === draft.revision);
      if (!messageExists) {
        thread.messages = [...(thread.messages || []), {
          id: id('msg'),
          agentId: plan.authorAgentId || thread.activeAgentId,
          agentName: state.agents.find((agent) => agent.id === (plan.authorAgentId || thread.activeAgentId))?.name || 'Agent',
          role: 'Plan',
          content: draft.summary,
          contentType: 'plan',
          planId: plan.id,
          planRevision: draft.revision,
          createdAt: now(),
        }];
      }
      thread.updatedAt = now();
      return { draft, plan: publicPlanSession(plan), revised: previousRevision > 0 };
    });
    if (!result) return res.status(404).json({ error: 'Plan session not found.' });
    captureTelemetry(result.revised ? 'plan_revised' : 'plan_submitted', { target_mode: result.plan.targetExecutionMode });
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Plan submit failed.', code: error.code || '', details: error.details || {} });
  }
});

app.post('/api/threads/:id/plans/:planId/feedback', async (req, res) => {
  try {
    const feedback = String(req.body?.feedback || '').trim();
    if (!feedback) return res.status(400).json({ error: 'feedback is required.' });
    const result = await updateState(async (state) => {
      const thread = state.threads.find((item) => item.id === req.params.id);
      const plan = thread?.planSessions?.find((item) => item.id === req.params.planId);
      if (!thread || !plan) return null;
      if (plan.status !== 'waiting_approval') throw Object.assign(new Error('Plan is not waiting for approval.'), { status: 409, code: 'PLAN_NOT_WAITING_APPROVAL' });
      const message = { id: id('msg'), agentId: 'user', agentName: '你', role: 'Workspace Owner', content: feedback, contentType: 'plan_feedback', planId: plan.id, createdAt: now() };
      thread.messages = [...(thread.messages || []), message];
      plan.status = 'drafting';
      plan.error = '';
      plan.updatedAt = now();
      thread.updatedAt = now();
      return { message, plan: publicPlanSession(plan), thread };
    });
    if (!result) return res.status(404).json({ error: 'Plan session not found.' });
    captureTelemetry('plan_feedback_submitted', { target_mode: result.plan.targetExecutionMode });
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Plan feedback failed.', code: error.code || '', details: error.details || {} });
  }
});

app.post('/api/threads/:id/plans/:planId/cancel', async (req, res) => {
  try {
    const state = await readState();
    const thread = state.threads.find((item) => item.id === req.params.id);
    const plan = thread?.planSessions?.find((item) => item.id === req.params.planId);
    if (!thread || !plan) return res.status(404).json({ error: 'Plan session not found.' });
    if (thread.runStatus === 'running' && thread.activeRunId) {
      await requestHermesBridge({ action: 'interrupt', session_id: thread.activeSessionId || '', run_id: thread.activeRunId, message: '用户取消了计划。' }, { timeoutMs: 10000, retryMs: 1000 }).catch(() => null);
    }
    cancelPlanSession(thread, plan, now());
    await writeState(state);
    captureTelemetry('plan_cancelled', { source: String(req.body?.source || 'plan_card') });
    res.json({ thread, plan: publicPlanSession(plan) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Plan cancel failed.', code: error.code || '' });
  }
});

app.post('/api/threads/:id/plans/:planId/execute', async (req, res) => {
  try {
    const state = await readState();
    const thread = state.threads.find((item) => item.id === req.params.id);
    const plan = thread?.planSessions?.find((item) => item.id === req.params.planId);
    if (!thread || !plan) return res.status(404).json({ error: 'Plan session not found.' });
    const retryingFailedExecution = plan.status === 'failed';
    if ((!retryingFailedExecution && thread.activePlanId !== plan.id) || !['waiting_approval', 'failed'].includes(plan.status)) return res.status(409).json({ error: 'Plan is not waiting for approval.', code: 'PLAN_NOT_WAITING_APPROVAL' });
    const draft = latestPlanDraft(plan);
    if (!draft) return res.status(409).json({ error: 'Plan has no submitted draft.', code: 'PLAN_DRAFT_MISSING' });
    plan.status = 'approved';
    plan.updatedAt = now();
    if (plan.targetExecutionMode === 'work') {
      try {
        const published = await publishApprovedWorkPlan(state, thread, plan, draft);
        plan.status = 'executing';
        plan.executionRunId = `work:${published.workflow.id}:${published.rootTaskId}`;
        plan.error = '';
        plan.updatedAt = now();
        thread.collaborationMode = 'default';
        thread.activePlanId = '';
        thread.updatedAt = now();
        await writeState(state);
        captureTelemetry('plan_approved', { target_mode: 'work' });
        captureTelemetry('plan_execution_started', { target_mode: 'work' });
        return res.json({
          kind: 'work-dispatch',
          plan: publicPlanSession(plan),
          draft,
          workflow: published.workflow,
          rootTaskId: published.rootTaskId,
          dispatch: published.dispatch,
          snapshot: published.snapshot,
          thread,
        });
      } catch (error) {
        plan.status = 'failed';
        plan.error = String(error?.message || error).slice(0, 1000);
        plan.updatedAt = now();
        thread.collaborationMode = 'default';
        thread.activePlanId = '';
        thread.updatedAt = now();
        await writeState(state);
        captureTelemetry('plan_execution_failed', { target_mode: 'work', error_code: telemetryErrorCode(error) });
        throw error;
      }
    }
    thread.collaborationMode = 'default';
    thread.activePlanId = '';
    thread.updatedAt = now();
    await writeState(state);
    captureTelemetry('plan_approved', { target_mode: plan.targetExecutionMode });
    res.json({
      kind: plan.targetExecutionMode === 'work' ? 'work-dispatch-pending' : 'chat-run',
      plan: publicPlanSession(plan),
      draft,
      targetAgentId: plan.authorAgentId,
      thread,
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Plan execute failed.', code: error.code || '', details: error.details || {} });
  }
});

app.post('/api/threads/:id/title-generation', async (req, res) => {
  const applyTitle = req.body?.apply === true;
  try {
    const state = await readState();
    const thread = state.threads.find((item) => item.id === req.params.id);
    if (!thread) return res.status(404).json({ error: '会话不存在。' });
    const transcript = titleGenerationTranscript(thread);
    if (!transcript) return res.status(409).json({ error: '当前对话还没有足够的内容生成标题。', code: 'TITLE_CONTEXT_EMPTY' });
    const agent = resolveThreadDefaultAgent(state, thread);
    if (!agent) return res.status(409).json({ error: '当前对话没有可用的 Agent。', code: 'TITLE_AGENT_MISSING' });
    const profile = await resolveHermesProfileNameForAgent(agent);
    await startHermesBridge();
    const generated = await requestHermesBridge({
      action: 'title_generate',
      profile,
      transcript,
      timeout: 30,
    }, { timeoutMs: 45000, retryMs: 1000 });
    const title = sanitizeGeneratedTitle(generated?.title);
    if (!title) {
      const error = new Error('标题模型没有返回有效内容。');
      error.status = 502;
      error.code = 'TITLE_OUTPUT_EMPTY';
      throw error;
    }
    if (!applyTitle) {
      captureTelemetry('title_generation_generated', { apply: false });
      return res.json({ title });
    }
    const result = await updateState(async (latestState) => {
      const latestThread = latestState.threads.find((item) => item.id === req.params.id);
      if (!latestThread) return null;
      latestThread.title = title;
      latestThread.updatedAt = now();
      return { thread: latestThread };
    });
    if (!result) return res.status(404).json({ error: '会话不存在。' });
    captureTelemetry('title_generation_applied', { apply: true });
    return res.json({ title, thread: result.thread });
  } catch (error) {
    captureTelemetry('title_generation_failed', { error_code: telemetryErrorCode(error), apply: applyTitle });
    return res.status(error.status || 503).json({
      error: error.message || '自动生成标题失败。',
      code: error.code || 'TITLE_GENERATION_FAILED',
    });
  }
});

app.patch('/api/threads/:id', async (req, res) => {
  const result = await updateState(async (state) => {
    const thread = state.threads.find((item) => item.id === req.params.id);
    if (!thread) return null;
    if ('title' in req.body) thread.title = String(req.body.title || thread.title).slice(0, 60);
    if ('vaultId' in req.body && thread.mode !== 'workspace') thread.vaultId = req.body.vaultId || null;
    if (Array.isArray(req.body.selectedAgents)) thread.selectedAgents = req.body.selectedAgents;
    if ('agentModelOverrides' in req.body) thread.agentModelOverrides = normalizeAgentModelOverrides(req.body.agentModelOverrides, state.agents, state.models);
    if ('agentRunOverrides' in req.body) thread.agentRunOverrides = normalizeAgentRunOverrides(req.body.agentRunOverrides, state.agents);
    if ('agentRuntimeOverrides' in req.body) thread.agentRuntimeOverrides = normalizeAgentRuntimeOverrides(req.body.agentRuntimeOverrides, state.agents);
    if ('mode' in req.body && ['workspace', 'direct'].includes(req.body.mode)) thread.mode = req.body.mode;
    if ('primaryAgentId' in req.body && state.agents.some((agent) => agent.id === req.body.primaryAgentId)) thread.primaryAgentId = req.body.primaryAgentId;
    if ('defaultAgentId' in req.body && state.agents.some((agent) => agent.id === req.body.defaultAgentId)) thread.defaultAgentId = req.body.defaultAgentId;
    if ('activeAgentId' in req.body && state.agents.some((agent) => agent.id === req.body.activeAgentId)) thread.activeAgentId = req.body.activeAgentId;
    if ('followMode' in req.body && ['default', 'conversation'].includes(req.body.followMode)) thread.followMode = req.body.followMode;
    if ('permissionMode' in req.body && ['manual', 'smart', 'off'].includes(req.body.permissionMode)) thread.permissionMode = req.body.permissionMode;
    if ('workerOutputMode' in req.body && ['summary', 'all'].includes(req.body.workerOutputMode)) thread.workerOutputMode = req.body.workerOutputMode;
    if ('archived' in req.body) thread.archivedAt = req.body.archived ? now() : null;
    if ('pinned' in req.body) thread.pinnedAt = req.body.pinned ? now() : null;
    thread.collaboration = normalizeCollaboration({ ...(thread.collaboration || {}), activeAgentId: thread.activeAgentId }, { defaultAgentId: thread.defaultAgentId });
    thread.updatedAt = now();
    if (thread.workspaceId && 'archived' in req.body) {
      const workspace = state.workspaces.find((item) => item.id === thread.workspaceId);
      if (workspace?.activeThreadId === thread.id && thread.archivedAt) {
        const nextThread = state.threads
          .filter((item) => item.workspaceId === thread.workspaceId && item.id !== thread.id && item.mode !== 'direct' && !item.archivedAt)
          .sort(sortPinnedThenUpdated)[0] || null;
        workspace.activeThreadId = nextThread?.id || null;
        workspace.updatedAt = now();
      } else if (workspace && !thread.archivedAt && !workspace.activeThreadId) {
        workspace.activeThreadId = thread.id;
        workspace.updatedAt = now();
      }
    }
    return { thread };
  });
  if (!result) return res.status(404).json({ error: '会话不存在。' });
  res.json(result);
});

app.delete('/api/threads/:id', async (req, res) => {
  const result = await updateState(async (state) => {
    const thread = state.threads.find((item) => item.id === req.params.id);
    if (!thread) return null;
    state.threads = state.threads.filter((item) => item.id !== thread.id);
    let nextThread = null;
    if (thread.workspaceId) {
      const workspace = state.workspaces.find((item) => item.id === thread.workspaceId);
      const remaining = state.threads
        .filter((item) => item.workspaceId === thread.workspaceId && item.mode !== 'direct' && !item.archivedAt)
        .sort(sortPinnedThenUpdated);
      nextThread = remaining[0] || null;
      if (workspace) {
        workspace.activeThreadId = nextThread?.id || null;
        workspace.updatedAt = now();
      }
    } else {
      nextThread = state.threads
        .filter((item) => item.mode === 'direct' && !item.archivedAt)
        .sort(sortPinnedThenUpdated)[0] || null;
    }
    return { ok: true, deletedThreadId: thread.id, nextThreadId: nextThread?.id || null, nextThread: nextThread ? summarizeThread(nextThread, state) : null };
  });
  if (!result) return res.status(404).json({ error: '会话不存在。' });
  await attachmentStore.removeForThreads([result.deletedThreadId]);
  res.json(result);
});

app.post('/api/threads/:id/convert-to-workspace', async (req, res) => {
  try {
    const state = await readState();
    const thread = state.threads.find((item) => item.id === req.params.id);
    if (!thread) return res.status(404).json({ error: '会话不存在。' });
    if (thread.mode === 'workspace' && thread.workspaceId) {
      const workspace = state.workspaces.find((item) => item.id === thread.workspaceId);
      return res.json({ workspace: workspace ? publicWorkspace(workspace, state) : null, thread });
    }
    const name = String(req.body?.name || thread.title || '').trim().slice(0, 60);
    const mode = req.body?.mode === 'existing' ? 'existing' : 'create';
    const requestedSpaceId = state.spaces.some((space) => space.id === req.body?.spaceId && !space.archivedAt) ? req.body.spaceId : thread.spaceId || state.ui.activeSpaceId || state.spaces[0]?.id || null;
    if (mode === 'create' && !name) return res.status(400).json({ error: '项目名称不能为空。' });
    if (mode === 'existing' && !String(req.body?.rootPath || '').trim()) return res.status(400).json({ error: '请选择或输入已有文件夹路径。' });
    const parentPath = await ensureDirectory(req.body?.parentPath || defaultProjectsRoot);
    const requestedRoot = mode === 'existing'
      ? String(req.body?.rootPath || '').trim()
      : path.join(parentPath, slug(name) || 'new-project');
    const rootPath = await ensureDirectory(requestedRoot);
    const existingWorkspace = state.workspaces.find((workspace) => path.resolve(workspace.rootPath) === rootPath);
    if (existingWorkspace) {
      existingWorkspace.spaceId = existingWorkspace.spaceId || requestedSpaceId;
      thread.spaceId = existingWorkspace.spaceId || requestedSpaceId;
      thread.workspaceId = existingWorkspace.id;
      thread.mode = 'workspace';
      thread.vaultId = existingWorkspace.vaultId || null;
      existingWorkspace.archivedAt = null;
      existingWorkspace.activeThreadId = thread.id;
      existingWorkspace.updatedAt = now();
      thread.updatedAt = now();
      thread.messages = [...thread.messages, { id: id('msg'), agentId: 'system', agentName: 'Frakio Work', role: 'System', content: `临时对话已转为项目：${existingWorkspace.name}。项目目录是 ${existingWorkspace.rootPath}。` }];
      await writeState(state);
      return res.json({ workspace: publicWorkspace(existingWorkspace, state), thread });
    }
    const workspaceName = name || vaultNameFromPath(rootPath);
    const vault = await ensureVaultForRoot(state, rootPath, workspaceName);
    await knowledgeGateway.initializeVault(vault);
    const workspace = {
      id: id('workspace'),
      spaceId: requestedSpaceId,
      name: workspaceName,
      rootPath,
      vaultId: vault.id,
      primaryVaultId: vault.id,
      sharedVaultIds: [],
      writableVaultIds: [vault.id],
      environment: 'local',
      activeThreadId: thread.id,
      archivedAt: null,
      pinnedAt: null,
      createdAt: now(),
      updatedAt: now(),
    };
    thread.workspaceId = workspace.id;
    thread.spaceId = workspace.spaceId;
    thread.mode = 'workspace';
    thread.vaultId = vault.id;
    thread.updatedAt = now();
    thread.messages = [...thread.messages, { id: id('msg'), agentId: 'system', agentName: 'Frakio Work', role: 'System', content: `临时对话已转为项目：${workspace.name}。项目目录是 ${workspace.rootPath}。` }];
    state.workspaces.push(workspace);
    state.defaultVaultId = vault.id;
    if (workspace.spaceId) state.ui.activeSpaceId = workspace.spaceId;
    await writeState(state);
    res.json({ workspace: publicWorkspace(workspace, state), vault: publicVault(vault), thread });
  } catch (error) {
    res.status(error.status || 500).json({ error: String(error?.message || error) });
  }
});

function createThreadRecord({ spaceId, workspaceId, title, vaultId, selectedAgents, agentModelOverrides = {}, agentRunOverrides = {}, agentRuntimeOverrides = {}, mode, executionMode = 'chat', primaryAgentId, defaultAgentId, followMode = 'default' }) {
  const threadDefaultAgentId = defaultAgentId || primaryAgentId || selectedAgents?.[0] || 'iris';
  return {
    id: id('thread'),
    spaceId: spaceId || null,
    workspaceId,
    mode,
    executionMode: executionMode === 'work' ? 'work' : 'chat',
    collaborationMode: 'default',
    activePlanId: '',
    planSessions: [],
    workerOutputMode: 'summary',
    primaryAgentId: primaryAgentId || threadDefaultAgentId,
    defaultAgentId: threadDefaultAgentId,
    activeAgentId: threadDefaultAgentId,
    followMode: followMode === 'conversation' ? 'conversation' : 'default',
    title,
    vaultId,
    selectedAgents,
    agentModelOverrides,
    agentRunOverrides,
    agentRuntimeOverrides,
    permissionMode: 'smart',
    archivedAt: null,
    pinnedAt: null,
    updatedAt: now(),
    workflow: [],
    workflowState: [],
    runTranscripts: [],
    proposals: [],
    artifacts: [],
    contextPacket: null,
    collaboration: normalizeCollaboration({ kind: mode === 'workspace' ? 'workspace-group-chat' : 'direct-chat', activeAgentId: threadDefaultAgentId }, { defaultAgentId: threadDefaultAgentId }),
    messages: [],
    engine: 'simulate',
    externalSessionId: null,
    runStatus: 'idle',
  };
}

function isSyntheticThreadIntroMessage(message) {
  const content = String(message?.content || '');
  return /^(已开启普通对话|已开启与 .+ 的单 Agent 对话|已开启临时对话|项目已创建|新项目对话已创建|Workspace 已开启)/.test(content);
}

function isPersistedAgentMessage(message) {
  return Boolean(message?.id && message.agentId && !['user', 'system'].includes(message.agentId) && !isSyntheticThreadIntroMessage(message));
}

function branchTreeTitle(state, sourceThread) {
  const rootId = sourceThread.branchRootThreadId || sourceThread.id;
  const rootThread = state.threads.find((thread) => thread.id === rootId) || sourceThread;
  const baseTitle = String(rootThread.title || sourceThread.title || '新对话').replace(/\s+\(\d+\)$/, '').trim() || '新对话';
  const used = new Set([1]);
  for (const thread of state.threads) {
    const threadRootId = thread.branchRootThreadId || thread.id;
    if (threadRootId !== rootId) continue;
    const title = String(thread.title || '');
    if (thread.id === rootId || title === baseTitle) {
      used.add(1);
      continue;
    }
    const match = title.match(/\s+\((\d+)\)$/);
    if (match) used.add(Number(match[1]));
  }
  let branchNumber = 2;
  while (used.has(branchNumber)) branchNumber += 1;
  const suffix = ` (${branchNumber})`;
  return `${baseTitle.slice(0, Math.max(1, 60 - suffix.length))}${suffix}`;
}

async function cloneThreadHistoryForBranch(sourceThread, targetMessage, newThreadId) {
  const targetIndex = (sourceThread.messages || []).findIndex((message) => message.id === targetMessage.id);
  const sourceMessages = sourceThread.messages.slice(0, targetIndex + 1).filter((message) => !isSyntheticThreadIntroMessage(message));
  const messageIdMap = new Map(sourceMessages.map((message) => [message.id, id('msg')]));
  const messages = [];
  for (const sourceMessage of sourceMessages) {
    const nextMessageId = messageIdMap.get(sourceMessage.id);
    const nextMessage = {
      ...structuredClone(sourceMessage),
      id: nextMessageId,
      parentMessageId: sourceMessage.parentMessageId ? messageIdMap.get(sourceMessage.parentMessageId) || '' : sourceMessage.parentMessageId,
    };
    if (Array.isArray(sourceMessage.attachments) && sourceMessage.attachments.length) {
      nextMessage.attachments = await attachmentStore.cloneMany(
        sourceMessage.attachments.map((attachment) => attachment.id),
        newThreadId,
        nextMessageId,
      );
    }
    messages.push(nextMessage);
  }
  const copiedMessageIds = new Set(messageIdMap.keys());
  const copiedRunIds = new Set(sourceMessages.map((message) => message.externalRunId).filter(Boolean));
  const runTranscripts = normalizeRunTranscripts(sourceThread.runTranscripts)
    .filter((transcript) => copiedMessageIds.has(transcript.messageId) || copiedRunIds.has(transcript.runId))
    .map((transcript) => {
      const sourceMessage = sourceMessages.find((message) => message.id === transcript.messageId || message.externalRunId === transcript.runId);
      return {
        ...structuredClone(transcript),
        messageId: sourceMessage ? messageIdMap.get(sourceMessage.id) : '',
      };
    });
  const copiedPlanIds = new Set(messages.map((message) => message.planId).filter(Boolean));
  const planSessions = (sourceThread.planSessions || [])
    .filter((plan) => copiedPlanIds.has(plan.id))
    .map((plan) => ({
      ...structuredClone(plan),
      readOnly: true,
      questions: (plan.questions || []).map((batch) => batch.status === 'pending'
        ? { ...batch, status: 'cancelled', resolvedAt: now() }
        : batch),
    }));
  return { messages, runTranscripts, planSessions };
}

function summarizeThread(thread, state) {
  const vault = state.vaults.find((item) => item.id === thread.vaultId);
  const workspace = state.workspaces.find((item) => item.id === thread.workspaceId);
  const primaryAgent = state.agents.find((agent) => agent.id === thread.primaryAgentId);
  const validAgentIds = new Set(state.agents.map((agent) => agent.id));
  const participantAgentIds = [...new Set([
    thread.defaultAgentId,
    thread.activeAgentId,
    ...(Array.isArray(thread.selectedAgents) ? thread.selectedAgents : []),
    thread.primaryAgentId,
  ].filter((agentId) => agentId && validAgentIds.has(agentId)))];
  const last = [...(thread.messages || [])].reverse().find((message) => !isSyntheticThreadIntroMessage(message));
  return {
    id: thread.id,
    title: thread.title,
    spaceId: thread.spaceId || null,
    workspaceId: thread.workspaceId || null,
    workspaceRootPath: workspace?.rootPath || '',
    mode: thread.mode || 'workspace',
    executionMode: thread.executionMode === 'work' ? 'work' : 'chat',
    collaborationMode: thread.collaborationMode === 'plan' ? 'plan' : 'default',
    activePlanId: thread.activePlanId || '',
    workerOutputMode: thread.workerOutputMode === 'all' ? 'all' : 'summary',
    primaryAgentId: thread.primaryAgentId || null,
    defaultAgentId: thread.defaultAgentId || null,
    activeAgentId: thread.activeAgentId || null,
    participantAgentIds,
    followMode: thread.followMode || 'default',
    primaryAgentName: primaryAgent?.name || '',
    permissionMode: thread.permissionMode || 'smart',
    agentModelOverrides: thread.agentModelOverrides || {},
    agentRunOverrides: thread.agentRunOverrides || {},
    agentRuntimeOverrides: thread.agentRuntimeOverrides || {},
    runtimeId: thread.runtimeId || 'hermes',
    vaultId: thread.vaultId,
    vaultName: vault?.name || '未连接资料库',
    updatedAt: thread.updatedAt,
    preview: last?.content?.slice(0, 80) || '',
    engine: thread.engine || 'simulate',
    artifactCount: Array.isArray(thread.artifacts) ? thread.artifacts.length : 0,
    lastArtifactName: Array.isArray(thread.artifacts) ? thread.artifacts[0]?.name || '' : '',
    workflowState: shouldKeepWorkflowForThread(thread) ? thread.workflowState : [],
    runStatus: thread.runStatus || 'idle',
    archivedAt: thread.archivedAt || null,
    pinnedAt: thread.pinnedAt || null,
    forkedFromThreadId: thread.forkedFromThreadId || null,
    forkedFromMessageId: thread.forkedFromMessageId || null,
    branchRootThreadId: thread.branchRootThreadId || null,
  };
}

function workflowStateFromWorkflow(workflow = workflows.council, runStatus = 'idle', activeIndex = -1) {
  const items = Array.isArray(workflow) && workflow.length ? workflow : workflows.council;
  const completedIndex = runStatus === 'idle' ? items.length - 1 : Math.max(0, activeIndex - 1);
  return items.map((title, index) => ({
    title,
    status: runStatus === 'running' && index === activeIndex ? 'running' : index <= completedIndex ? 'completed' : 'pending',
    source: 'simulation',
    updatedAt: now(),
  }));
}

function isDefaultCouncilWorkflow(workflow = []) {
  return Array.isArray(workflow) && workflow.join('\u0000') === defaultCouncilWorkflowSignature;
}

function shouldKeepWorkflowForThread(thread) {
  if (!Array.isArray(thread?.workflowState) || !thread.workflowState.length) return false;
  if (!isDefaultCouncilWorkflow(thread.workflow || [])) return true;
  return thread.workflowState.some((step) => step?.source || step?.detail || step?.agentName);
}

function taskStepsForMessage(taskType, message, status = 'completed') {
  const source = 'run';
  const taskHints = {
    council: [
      '理解用户意图',
      '选择响应 Agent',
      '生成回复',
    ],
    knowledge: [
      '检索资料库',
      '筛选相关来源',
      '生成带来源回答',
    ],
  };
  const steps = taskHints[taskType] || taskHints.council;
  const hasSubstantiveTask = taskType !== 'council' || /检查|优化|生成|执行|创建|写|整理|分析|计划|方案|项目|文件|任务|调研|搜索|读取|改|修|review|build|create|write|analy/i.test(message);
  if (!hasSubstantiveTask) return [];
  return steps.map((title, index) => ({
    title,
    status,
    source,
    detail: index === 0 ? String(message || '').slice(0, 80) : '',
    updatedAt: now(),
  }));
}

function detectTaskType(_message) {
  return 'council';
}

function isAllAgentsMentioned(message) {
  return isMentionNamePresent(message, 'all');
}

function matchMentionedAgents(message, agents, selectedAgentIds = [], fallbackAgentId = '') {
  return resolveMentionedAgents(message, agents, { selectedAgentIds, fallbackAgentId });
}

function agentEvent(agent, content, extra = {}) {
  return {
    id: id('msg'),
    agentId: agent.id,
    agentName: agent.name,
    role: agent.role,
    content,
    createdAt: now(),
    ...extra,
  };
}

function resolveThreadDefaultAgent(state, thread) {
  const fallbackId = resolveDefaultAgentId(state);
  return state.agents.find((agent) => agent.id === thread?.defaultAgentId)
    || state.agents.find((agent) => agent.id === thread?.primaryAgentId)
    || state.agents.find((agent) => agent.id === fallbackId)
    || state.agents[0]
    || null;
}

function resolveRunTargetAgent(state, thread, targetAgentId, selectedAgents = []) {
  const cleanTargetAgentId = String(targetAgentId || '').trim();
  if (cleanTargetAgentId) {
    const targetAgent = state.agents.find((agent) => agent.id === cleanTargetAgentId);
    if (!targetAgent) {
      const error = new Error('目标 Agent 不存在。');
      error.status = 400;
      throw error;
    }
    return targetAgent;
  }
  return selectedAgents[0] || resolveThreadDefaultAgent(state, thread) || state.agents[0] || null;
}

async function resolveThreadRunModelConfig(state, thread, agent, profileName) {
  const selection = await runtimeModelSelection(state, thread, agent, 'hermes');
  const materialized = await ensureModelProviderForProfile(profileName, selection.selectedModel, selection.selectedName, state.models || [], { setDefault: false });
  if (agent && !agent.model) agent.model = selection.selectionValue;
  return {
    model: materialized.model,
    provider: materialized.provider,
    source: selection.source,
    modelProfile: selection.selectedModel,
  };
}

async function resolveHermesProfileNameForAgent(agent) {
  const profiles = await readHermesProfiles();
  if (agent?.profileName) {
    if (profiles.some((profile) => profile.name === agent.profileName)) return agent.profileName;
    const error = new Error(`Agent Profile「${agent.profileName}」配置缺失。`);
    error.status = 409;
    error.code = 'agent_profile_missing';
    throw error;
  }
  if (agent?.id && profiles.some((profile) => profile.name === agent.id)) return agent.id;
  const normalizedName = String(agent?.name || '').trim().toLowerCase();
  const byName = profiles.find((profile) => profile.name.toLowerCase() === normalizedName);
  if (byName) return byName.name;
  return profiles.some((profile) => profile.name === 'default') ? 'default' : profiles[0]?.name || 'default';
}

function resolveInitialRoomAgent(state, thread, message, collaboration, selectedAgentIds = []) {
  const defaultAgent = resolveThreadDefaultAgent(state, thread);
  const mentionedAgents = matchMentionedAgents(message, state.agents, selectedAgentIds, defaultAgent?.id || resolveDefaultAgentId(state));
  if (mentionedAgents.length) return { agent: mentionedAgents[0], mentionedAgents, reason: 'user_mention' };
  if (thread?.followMode === 'conversation' && thread?.activeAgentId) {
    const activeAgent = state.agents.find((agent) => agent.id === thread.activeAgentId);
    if (activeAgent) return { agent: activeAgent, mentionedAgents, reason: 'conversation_follow' };
  }
  if (thread?.followMode === 'conversation' && collaboration?.activeAgentId) {
    const activeAgent = state.agents.find((agent) => agent.id === collaboration.activeAgentId);
    if (activeAgent) return { agent: activeAgent, mentionedAgents, reason: 'conversation_follow' };
  }
  return { agent: defaultAgent, mentionedAgents, reason: 'default_agent' };
}

async function runCouncilSimulation(req, res, options = {}) {
  const startedAt = Date.now();
  const state = await readState();
  const message = String(req.body?.message || '').trim();
  const thread = state.threads.find((item) => item.id === req.body?.threadId) || state.threads[0];
  const selected = Array.isArray(req.body?.selectedAgents) ? req.body.selectedAgents : thread.selectedAgents || ['iris', 'max'];
  const vaultId = 'vaultId' in req.body ? req.body.vaultId : thread.vaultId;
  const vault = vaultId ? state.vaults.find((item) => item.id === vaultId) : null;
  const summary = vault?.index ? summaryFromVault(vault) : null;

  const mentionedAgents = matchMentionedAgents(message, state.agents, selected, resolveDefaultAgentId(state));
  const activeAgentIds = Array.from(
    new Set([
      'iris',
      ...(thread.mode === 'direct' ? [] : ['max']),
      ...selected,
      ...mentionedAgents.map((a) => a.id),
    ]),
  );

  const taskType = detectTaskType(message);

  const activeAgents = state.agents.filter((agent) => activeAgentIds.includes(agent.id));
  const userMessage = { id: id('msg'), agentId: 'user', agentName: '你', role: 'Workspace Owner', content: message, createdAt: now() };
  const events = activeAgents.map((agent, index) => ({
    id: `${Date.now()}-${agent.id}-${index}`,
    agentId: agent.id,
    agentName: agent.name,
    role: agent.role,
    content: buildAgentReply(agent.id, message, taskType, summary),
    processingDurationMs: Math.max(1, Date.now() - startedAt),
    createdAt: now(),
  }));
  const internalNotice = options.notice || '';

  const proposals = [
    {
      id: id('proposal'),
      type: 'task_report',
      title: '生成运行记录',
      risk: 'low',
      target: '当前对话',
      status: 'needs_review',
    },
  ];

  const contextPacket = compressContext(message, [...thread.messages.slice(-8), userMessage, ...events], summary, selected);
  const runSteps = taskStepsForMessage(taskType, message, options.runStatus === 'running' ? 'running' : 'completed');
  Object.assign(thread, {
    vaultId: vaultId || null,
    selectedAgents: activeAgentIds,
    updatedAt: now(),
    workflow: runSteps.map((step) => step.title),
    workflowState: runSteps,
    proposals,
    artifacts: artifactsFromThreadOutputs(taskType, proposals, thread),
    contextPacket,
    messages: [...thread.messages, userMessage, ...events],
    engine: options.engine || 'simulate',
    externalSessionId: options.externalSessionId || thread.externalSessionId || null,
    runStatus: options.runStatus || 'idle',
  });

  if (thread.title === '新的团队议事' || thread.title === '新的对话' || thread.title === 'Frakio 博客优化') thread.title = message.slice(0, 24) || thread.title;
  await writeState(state);

  res.json({ taskType, thread, contextPacket, events, proposals, workflow: workflows[taskType], vaultSummary: summary, notice: internalNotice });
}

app.post('/api/council/simulate', async (req, res) => {
  await runCouncilSimulation(req, res);
});

async function runAgentRoomChat(req, res) {
  const state = await readState();
  const message = String(req.body?.message || '').trim();
  const thread = state.threads.find((item) => item.id === req.body?.threadId) || state.threads[0];
  if (!thread) return res.status(404).json({ error: '会话不存在。' });
  const selected = Array.isArray(req.body?.selectedAgents) ? req.body.selectedAgents : thread.selectedAgents || [resolveDefaultAgentId(state)];
  const vaultId = 'vaultId' in req.body ? req.body.vaultId : thread.vaultId;
  const vault = vaultId ? state.vaults.find((item) => item.id === vaultId) : null;
  const summary = vault?.index ? summaryFromVault(vault) : null;
  const taskType = detectTaskType(message);
  const collaboration = normalizeCollaboration(thread.collaboration, { defaultAgentId: thread.defaultAgentId, activeAgentId: thread.activeAgentId });
  const initialRoute = resolveInitialRoomAgent(state, thread, message, collaboration, selected);
  const activeAgentIds = Array.from(new Set([
    ...selected,
    initialRoute.agent?.id,
    ...initialRoute.mentionedAgents.map((agent) => agent.id),
  ].filter(Boolean))).filter((agentId) => state.agents.some((agent) => agent.id === agentId));
  const userMessage = { id: id('msg'), agentId: 'user', agentName: '你', role: 'Workspace Owner', content: message };
  const workflow = workflows[taskType] || workflows.council;
  const runSteps = taskStepsForMessage(taskType, message);
  const events = [];
  let engine = 'workspace-group';
  let providerNotice = '';
  const turnId = id('turn');
  const maxMentionDepth = normalizeAgentMentionMaxDepth(state.ui?.agentMentionMaxDepth, 2);
  const routedEdges = new Set();
  let totalRoutedRuns = 0;
  let routeLimitReached = false;

  async function invokeAgent(agent, prompt, routeLabel = '', mentionDepth = 0, parentMessageId = userMessage.id, routeReason = initialRoute.reason) {
    if (!agent || totalRoutedRuns >= 64) {
      routeLimitReached = true;
      return null;
    }
    totalRoutedRuns += 1;
    const invokedAt = Date.now();
    let event;
    try {
      const reply = await runConfiguredModelChat(state, { ...thread, messages: [...thread.messages, userMessage, ...events] }, prompt, [agent.id]);
      event = agentEvent(agent, reply.content, { role: `${agent.role}${routeLabel} / ${reply.provider} / ${reply.modelId}`, turnId, mentionDepth, parentMessageId, routeReason, processingDurationMs: Math.max(1, Date.now() - invokedAt) });
    } catch (error) {
      providerNotice ||= String(error?.message || error);
      event = agentEvent(agent, buildAgentReply(agent.id, prompt, taskType, summary), { role: `${agent.role}${routeLabel}`, turnId, mentionDepth, parentMessageId, routeReason, processingDurationMs: Math.max(1, Date.now() - invokedAt) });
      engine = 'simulate';
    }
    events.push(event);
    if (!activeAgentIds.includes(agent.id)) activeAgentIds.push(agent.id);
    return event;
  }

  const initialAgents = initialRoute.mentionedAgents.length ? initialRoute.mentionedAgents : [initialRoute.agent].filter(Boolean);
  let currentWave = (await Promise.all(initialAgents.map((agent) => invokeAgent(agent, message)))).filter(Boolean);
  let handoffDepth = 1;
  while (currentWave.length && mentionDepthAllows(handoffDepth, maxMentionDepth) && totalRoutedRuns < 64) {
    const nextByAgentId = new Map();
    for (const sourceEvent of currentWave) {
      const targets = resolveMentionedAgents(sourceEvent.content, state.agents, {
        senderAgentId: sourceEvent.agentId,
        selectedAgentIds: activeAgentIds,
        fallbackAgentId: resolveDefaultAgentId(state),
      });
      for (const target of targets) {
        if (!registerMentionEdge(routedEdges, sourceEvent.agentId, target.id)) continue;
        nextByAgentId.set(target.id, { target, sourceEvent });
      }
    }
    if (!nextByAgentId.size) break;
    currentWave = (await Promise.all([...nextByAgentId.values()].map(({ target, sourceEvent }) => {
      const routedText = stripMentionRoutingTokens(sourceEvent.content, target) || sourceEvent.content;
      const relayMessage = `群聊系统：${sourceEvent.agentName} 在对话中提及了你（${target.name}），请基于当前上下文直接回复。\n\n原始消息：${routedText}`;
      return invokeAgent(target, relayMessage, ' / agent @ routing', handoffDepth, sourceEvent.id, 'agent_mention');
    }))).filter(Boolean);
    handoffDepth += 1;
  }
  if (totalRoutedRuns >= 64) routeLimitReached = true;
  if (routeLimitReached) {
    events.push({ id: id('msg'), agentId: 'system', agentName: '系统', role: 'System', content: '本轮 Agent @ 路由已达到 64 次安全上限，后续提及已停止。', turnId, routeReason: 'mention_limit' });
  }

  const proposals = [
    {
      id: id('proposal'),
      type: 'task_report',
      title: '生成运行记录',
      risk: 'low',
      target: '当前对话',
      status: 'needs_review',
    },
  ];
  const artifacts = artifactsFromThreadOutputs(taskType, proposals, thread);
  const contextPacket = compressContext(message, [...thread.messages.slice(-8), userMessage, ...events], summary, activeAgentIds);
  const lastRespondingAgent = events.length ? state.agents.find((agent) => agent.id === events.at(-1)?.agentId) : initialRoute.agent;
  const nextActiveAgent = thread.followMode === 'conversation' ? (lastRespondingAgent || initialRoute.agent) : resolveThreadDefaultAgent(state, thread);
  const lastMentioned = initialRoute.mentionedAgents[0] || (lastRespondingAgent?.id !== initialRoute.agent?.id ? lastRespondingAgent : null);
  Object.assign(thread, {
    vaultId: vaultId || null,
    selectedAgents: activeAgentIds,
    primaryAgentId: thread.primaryAgentId || resolveThreadDefaultAgent(state, thread)?.id || null,
    defaultAgentId: thread.defaultAgentId || resolveDefaultAgentId(state),
    activeAgentId: nextActiveAgent?.id || thread.activeAgentId || thread.defaultAgentId || null,
    updatedAt: now(),
    workflow: runSteps.map((step) => step.title),
    workflowState: runSteps,
    proposals,
    artifacts,
    contextPacket,
    messages: [...thread.messages, userMessage, ...events],
    engine,
    externalSessionId: thread.externalSessionId || null,
    providerError: providerNotice || '',
    collaboration: normalizeCollaboration({
      ...collaboration,
      maxMentionDepth,
      activeAgentId: nextActiveAgent?.id || collaboration.activeAgentId,
      lastMentionedAgentId: lastMentioned?.id || collaboration.lastMentionedAgentId,
      lastMentionedAgentName: lastMentioned?.name || collaboration.lastMentionedAgentName,
      lastRoutedAt: now(),
      lastRouteReason: initialRoute.reason,
    }),
    runStatus: 'idle',
  });

  if (thread.title === '新的团队议事' || thread.title === '新的对话' || thread.title === 'Frakio 博客优化') thread.title = message.slice(0, 24) || thread.title;
  await writeState(state);
  res.json({ taskType, turnId, thread, contextPacket, events, proposals, workflow, vaultSummary: summary, notice: providerNotice ? `${providerNotice}。已回退到本地 Agent 编排。` : '' });
}

async function threadHistoryForHermes(thread, targetAgent = null) {
  const messages = (thread.messages || [])
    .filter((message) => message.agentId !== 'system' && !isSyntheticThreadIntroMessage(message) && (message.content || message.attachments?.length))
    .slice(-20);
  return Promise.all(messages.map(async (message) => {
    const attachments = await Promise.all((message.attachments || []).map(async (attachment) => {
      try {
        const { filePath } = await attachmentStore.content(attachment.id);
        return { ...attachment, path: filePath };
      } catch {
        return attachment;
      }
    }));
    const storedContent = hermesStoredMessageContent(message.content, attachments);
    if (message.agentId === targetAgent?.id) return { role: 'assistant', content: storedContent };
    if (message.agentId === 'user') return { role: 'user', content: `[用户]\n${storedContent}` };
    return { role: 'user', content: `[Agent ${message.agentName || message.agentId || '未知'}]\n${storedContent}` };
  }));
}

function agentIdentityRunInstruction(agent, agents = []) {
  const roster = agents
    .filter((item) => item?.id && item.id !== agent?.id)
    .map((item) => `${item.name}（${item.role || 'Agent'}）`)
    .join('、');
  return [
    `群聊身份规则：你是 ${agent?.name || '当前 Agent'}（${agent?.role || 'Agent'}）。`,
    '只能以你自己的身份发言。不得替其他 Agent 写台词，不得使用“某某说：”模拟其他成员已经回复，也不得声称其他 Agent 已经在线或已经说过某句话。',
    '如果需要其他 Agent 接话，只输出一条简短交接，并在正文中写出准确的 @AgentName。系统会真正唤醒对方并以对方自己的头像发送独立消息。',
    `当前可交接成员：${roster || '无'}。`,
    '当用户用“叫/让/请某位 Agent 出来、回答、打招呼”等自然语言要求你召唤明确成员时，不要代答；请直接使用 @AgentName 交接。',
  ].join('\n');
}

function planRunInstruction(thread, agent) {
  const plan = activePlanSession(thread);
  if (!plan) return '';
  const latestDraft = latestPlanDraft(plan);
  const resolvedQuestions = (plan.questions || [])
    .filter((batch) => batch.status === 'resolved' || batch.status === 'auto_resolved')
    .map((batch) => ({
      questions: batch.questions.map((question) => ({ id: question.id, question: question.question })),
      answers: batch.answers,
    }));
  const lines = [
    '当前处于 Frakio Plan 模式。你可以读取本地资料和实时网络资料；用户批准前不得修改项目、创建任务、启动执行、发布内容或改变任何外部状态。',
    `当前 threadId：${thread.id}。当前 planId：${plan.id}。锁定的目标执行模式：${plan.targetExecutionMode}。你的 Agent id：${agent?.id || plan.authorAgentId}。`,
    '按三个阶段工作：先只读检查当前环境与源码；再确认目标、范围和会改变方案的取舍；最后确认接口、数据流、失败处理和测试。能够从源码、文档或只读查询得到的事实禁止询问用户。',
    '实时信息优先调用 web_search；搜索后端失败时改用只读 browser_navigate、browser_snapshot 等浏览工具。单个搜索服务限流、目标网站拒绝或超时，都不能推断 Frakio、Hermes 或本机无法联网。查询天气不要求安装天气 Skill。',
    '只在答案会明显改变实施方案时提问。优先一次问一个问题，最多三个。必须调用 hermes_workbench_plan_user_input_request，并为每个问题提供短标题、两到三个互斥选项和一句取舍说明。推荐项放在第一位。不要调用普通 clarify。',
    '完成后必须调用 hermes_workbench_plan_submit 提交结构化方案。不得用普通 Markdown 编号代替提交。提交后停止继续规划，等待用户批准。',
    '步骤必须包含稳定 key、标题、具体说明、涉及文件、预期结果和依赖。测试与假设单独列出。',
  ];
  if (plan.targetExecutionMode === 'work') {
    lines.push('这是 Work 计划。每个步骤必须指定当前 Frakio Agent 列表中的 assigneeAgentId，并形成无环依赖 DAG。不得调用 collaboration_plan_publish、root_create、workflow_create、dependency_request、artifact_publish 或 task_complete。');
  } else {
    lines.push('这是 Chat 计划。由你本人在批准后执行；步骤可以省略 assigneeAgentId。计划正文中的 @Agent 名称只作为文字，不会触发其他 Agent。');
  }
  if (latestDraft) lines.push(`上一版计划（revision ${latestDraft.revision}）：\n${JSON.stringify(latestDraft)}`);
  if (resolvedQuestions.length) lines.push(`已经确认的结构化问答：\n${JSON.stringify(resolvedQuestions)}`);
  return lines.join('\n');
}

function approvedPlanExecutionInstruction(plan, draft) {
  return [
    '用户已经明确批准下面的 Frakio Plan。现在进入执行阶段。',
    '严格按照已批准步骤实施。遇到会改变范围的情况时先停下说明，不要自行扩大计划。',
    '方案涉及天气等实时信息时，执行阶段必须重新联网获取，不能沿用规划阶段的旧数据。',
    `planId：${plan.id}；revision：${draft.revision}；目标模式：${plan.targetExecutionMode}。`,
    JSON.stringify(draft),
  ].join('\n');
}

function collaborationRunInstruction(thread, agent) {
  if (thread.collaborationMode === 'plan' && activePlanSession(thread)) return planRunInstruction(thread, agent);
  if (thread.executionMode !== 'work') {
    return [
      '当前对话处于 Chat 模式。按普通多人聊天方式回复；不要创建协作工作流、看板任务或执行方案。需要其他成员接话时继续使用普通 @Agent 路由。',
      '需要实时信息时优先调用 web_search；搜索后端失败时改用只读浏览器。单个服务限流、网站拒绝或超时不能被描述成 Frakio、Hermes 或本机无法联网。天气查询不要求安装天气 Skill。',
    ].join('\n');
  }
  const workflow = workflowById(thread);
  const lines = [
    '当前对话处于 Work 模式。忽略上方关于使用正文 @Agent 交接的群聊规则。你是本根任务的协调 Agent。必须先理解目标，再使用结构化工具发布完整执行方案；不得用正文里的 @Agent 触发实际调度。',
    `当前 Frakio 对话 threadId：${thread.id}。`,
  ];
  if (workflow) {
    lines.push(`当前工作流 workflowId：${workflow.id}；名称：${workflow.name}；看板：${workflow.boardSlug}；协调 Agent：${workflow.coordinatorAgentId || '未指定'}。`);
    lines.push(`当前根任务 rootTaskId：${workflow.currentRootTaskId || '未创建'}；当前方案 revision：${Number(workflow.planRevision || 0)}。`);
    lines.push('根任务已经由 Frakio 创建。不要再次创建 workflow 或 root。先调用 hermes_workbench_collaboration_plan_get，再调用 hermes_workbench_collaboration_plan_publish，提交目标、摘要、稳定 task key、负责人、预期结果和 dependsOnKeys。首次发布 baseRevision 为 0；重规划使用读取到的 revision。发布成功后用简洁自然语言概括方案。');
    lines.push('用户补充消息中的 @Agent 只表示调整意图。由你决定是否改派、增加任务或修改依赖，并通过新 revision 落地；不要直接唤醒被提及者。');
  } else {
    lines.push('协作工作流缺失。这是 capability 阻塞，不得退回普通聊天计划。调用 blocker 工具报告问题。');
  }
  lines.push(`你自己的 Agent id：${agent?.id || ''}。所有写操作都使用稳定且唯一的 idempotencyKey。`);
  lines.push('dependency 类型会自动恢复。needs_input 或 capability 必须调用 hermes_workbench_collaboration_blocker_report，系统会先交给工作流协调 Agent，再升级给全局决策 Agent，最后才请求人工。支付、授权、删除和外部发布不得由决策 Agent 代替用户批准。');
  return lines.join('\n');
}

function richContentRunInstruction() {
  return [
    '这是 Frakio 应用级最终输出协议，优先于任何 Skill、SOUL 或参考文档中的图表和预览格式建议。',
    'Frakio 支持标准 Markdown 与以下富内容围栏。只有内容确实适合交互或可视化时才使用，不要为了装饰滥用。',
    '流程、架构、UML、BPMN、时序与关系图一律使用 ```mermaid；禁止输出 plantuml、puml、vega 或其他图表围栏。必须输出合法 Mermaid，节点含标点时用双引号包裹标签。',
    '结构化记录使用 ```datatable 或 ```spreadsheet，内容为严格 JSON。推荐列定义：{ "columns": [{"key":"name","label":"名称","type":"text"}], "rows": [{"name":"值"}] }。也兼容字符串列与数组行。数据量很小时优先使用普通 Markdown 表格。',
    '补丁使用 ```diff；可折叠对象使用 ```json；公式使用 $...$、$$...$$ 或 ```math。',
    '本地文件预览使用 ```image-preview、```pdf-preview、```markdown-preview 或 ```html-preview，内容为 { "src": "/绝对路径", "title": "可选标题" }；多个文件使用 { "title":"标题", "items":[{"src":"/绝对路径","label":"标签"}] }。只能引用当前项目、Frakio 附件、应用数据或临时目录中的真实文件。',
    '所有富内容围栏都必须完整闭合。无法确认语法或文件存在时，改用普通 Markdown 或普通代码块。',
  ].join('\n');
}

function hermesAgentSessionId(thread, agentId) {
  return String(thread?.agentSessionIds?.[agentId] || `workbench-${thread.id}-${agentId}`);
}

function attachmentPromptLine(attachment) {
  return `[Attached ${attachment.kind || 'file'}: ${attachment.name} (${attachment.mimeType || 'application/octet-stream'}, ${attachment.size || 0} bytes) at ${attachment.path || attachment.contentUrl || ''}]`;
}

function hermesStoredMessageContent(content, attachments = []) {
  const text = String(content || '').trim();
  const lines = (attachments || []).map(attachmentPromptLine);
  return [text, ...lines].filter(Boolean).join('\n\n') || '请查看并处理这些附件。';
}

function trimLeadingBlankLines(text) {
  return String(text || '').replace(/^\s*\n+/, '').trimStart();
}

function stepFromHermesEvent(event) {
  const eventName = String(event?.event || '');
  if (eventName === 'tool.running') {
    return { title: event.title || event.label || event.toolName || event.tool || '正在调用工具', status: 'running', source: 'tool', detail: event.detail || toolStepDetail(event), updatedAt: now(), callId: event.callId || '' };
  }
  if (eventName === 'tool.completed') {
    return { title: event.title || event.label || event.toolName || event.tool || '工具调用完成', status: event.error ? 'failed' : 'completed', source: 'tool', detail: event.detail || toolStepDetail(event), updatedAt: now(), callId: event.callId || '' };
  }
  if (eventName === 'approval.request') {
    return { title: event.title || '等待用户确认', status: 'running', source: 'approval', detail: event.tool || event.command || '', updatedAt: now() };
  }
  if (eventName === 'clarify.request') {
    return { title: '等待你的选择', status: 'running', source: 'clarify', detail: event.question || '', updatedAt: now(), callId: event.clarifyId || '' };
  }
  if (eventName === 'clarify.responded') {
    return { title: '等待你的选择', status: 'completed', source: 'clarify', detail: event.skipped ? '用户已跳过' : '用户已回答', updatedAt: now(), callId: event.clarifyId || '' };
  }
  if (eventName === 'run.failed') return { title: event.error || '运行失败', status: 'failed', source: 'run', updatedAt: now() };
  if (eventName === 'run.completed') return { title: '生成最终回复', status: 'completed', source: 'run', updatedAt: now() };
  return null;
}

function mergeWorkflowStep(steps = [], nextStep) {
  if (!nextStep) return steps;
  const key = nextStep.callId ? `${nextStep.source || ''}:${nextStep.callId}` : `${nextStep.source || ''}:${nextStep.title}`;
  const index = steps.findIndex((step) => {
    const stepKey = step.callId ? `${step.source || ''}:${step.callId}` : `${step.source || ''}:${step.title}`;
    return stepKey === key;
  });
  if (index < 0) return [...steps, nextStep];
  return steps.map((step, stepIndex) => stepIndex === index ? { ...step, ...nextStep } : step);
}

function toolStepDetail(event) {
  const parts = [];
  if (Array.isArray(event?.paths) && event.paths.length) parts.push(event.paths.slice(0, 3).join(' · '));
  if (event?.fileCount) parts.push(`${event.fileCount} 个文件`);
  if (event?.skillName) parts.push(event.skillName);
  if (event?.duration) parts.push(`${Math.round(Number(event.duration) * 10) / 10}s`);
  if (event?.resultPreview && !parts.length) parts.push(event.resultPreview);
  if (event?.argsPreview && !parts.length) parts.push(event.argsPreview);
  return parts.filter(Boolean).join(' · ');
}

function closeOpenWorkflowSteps(steps = [], status = 'completed') {
  return steps.map((step) => step?.status === 'running' ? { ...step, status, updatedAt: now() } : step);
}

function normalizeHermesRunEvent(event) {
  const name = String(event?.event || '');
  if (name === 'tool.started' || name === 'tool.running') {
    const display = toolDisplayFromEvent(event, '正在调用工具');
    const activity = normalizeRunActivityItem(event, 'running');
    return {
      event: 'tool.running',
      runId: event.run_id || '',
      tool: display.toolName || event.tool || '',
      ...display,
      activity,
      raw: event,
      timestamp: event.timestamp || Date.now() / 1000,
    };
  }
  if (name === 'tool.completed') {
    const display = toolDisplayFromEvent(event, '工具调用完成');
    const activity = normalizeRunActivityItem(event, event.error || event.is_error ? 'failed' : 'completed');
    return {
      event: 'tool.completed',
      runId: event.run_id || '',
      tool: display.toolName || event.tool || '',
      ...display,
      duration: event.duration || 0,
      error: Boolean(event.error || event.is_error),
      activity,
      raw: event,
      timestamp: event.timestamp || Date.now() / 1000,
    };
  }
  if (name === 'message.delta' || name === 'stream.delta') {
    return { event: 'message.delta', runId: event.run_id || '', delta: event.delta || '', timestamp: event.timestamp || Date.now() / 1000 };
  }
  if (name === 'thinking.delta' || name === 'reasoning.delta' || name === 'status') {
    return { event: 'agent.event', runId: event.run_id || '', title: event.title || event.status || event.message || '', detail: event.delta || event.detail || event.message || '', raw: event, timestamp: event.timestamp || Date.now() / 1000 };
  }
  if (name === 'approval.request' || name === 'approval.requested') {
    const choices = Array.isArray(event.choices)
      ? event.choices.map((choice) => String(choice)).filter((choice) => ['once', 'session', 'always', 'deny'].includes(choice))
      : ['once', 'session', 'always', 'deny'];
    return {
      event: 'approval.request',
      runId: event.run_id || '',
      approvalId: event.approvalId || event.approval_id || event.id || '',
      title: event.title || event.description || '需要确认',
      command: event.command || event.command_preview || event.preview || '',
      cwd: event.cwd || '',
      tool: event.tool || event.tool_name || '',
      choices,
      allowPermanent: event.allowPermanent ?? event.allow_permanent,
      smartDenied: Boolean(event.smartDenied ?? event.smart_denied),
      timestamp: event.timestamp || Date.now() / 1000,
    };
  }
  if (name === 'approval.responded' || name === 'approval.resolved') return { event: 'approval.responded', runId: event.run_id || '', approvalId: event.approvalId || event.approval_id || event.id || '', choice: event.choice || '', resolved: event.resolved, error: event.error || '', timestamp: event.timestamp || Date.now() / 1000 };
  if (name === 'clarify.request' || name === 'clarify.requested') {
    return {
      event: 'clarify.request',
      runId: event.run_id || '',
      clarifyId: event.clarifyId || event.clarify_id || event.id || '',
      question: event.question || event.title || '需要你补充一个选择',
      choices: Array.isArray(event.choices) ? event.choices.map((choice) => String(choice)).filter(Boolean) : [],
      timeoutMs: Number(event.timeoutMs || event.timeout_ms || 0) || undefined,
      timestamp: event.timestamp || Date.now() / 1000,
    };
  }
  if (name === 'clarify.responded' || name === 'clarify.resolved') return { event: 'clarify.responded', runId: event.run_id || '', clarifyId: event.clarifyId || event.clarify_id || event.id || '', skipped: Boolean(event.skipped), resolved: event.resolved, error: event.error || '', timestamp: event.timestamp || Date.now() / 1000 };
  if (name === 'run.completed') return { event: 'run.completed', runId: event.run_id || '', output: trimLeadingBlankLines(event.output || ''), usage: event.usage || {}, timestamp: event.timestamp || Date.now() / 1000 };
  if (name === 'run.failed') return { event: 'run.failed', runId: event.run_id || '', error: enrichMissingExecutableError(event.error || 'Hermes run failed', event.profile || event.profileName || 'default'), timestamp: event.timestamp || Date.now() / 1000 };
  if (name === 'run.cancelled') return { event: 'run.cancelled', runId: event.run_id || '', timestamp: event.timestamp || Date.now() / 1000 };
  return { event: name || 'run.event', runId: event?.run_id || '', raw: event, timestamp: event?.timestamp || Date.now() / 1000 };
}

function normalizeHermesBridgeChunkEvent(rawEvent) {
  const direct = normalizeHermesRunEvent(rawEvent);
  if (direct.event && direct.event !== 'run.event') return direct;
  const bridged = normalizeBridgeEvent(rawEvent);
  return bridged ? normalizeHermesRunEvent(bridged) : direct;
}

async function mergeHermesWorkflowEvent(threadId, event) {
  const nextStep = stepFromHermesEvent(event);
  if (!nextStep || event.event === 'run.completed') return;
  await updateState(async (state) => {
    const thread = state.threads.find((item) => item.id === threadId);
    if (!thread) return;
    thread.workflowState = mergeWorkflowStep(thread.workflowState || [], nextStep);
    thread.workflow = thread.workflowState.map((step) => step.title);
    thread.updatedAt = now();
  });
}

function runTranscriptForOutput(thread, runId, outputState) {
  if (outputState.transcript) return outputState.transcript;
  const stored = normalizeRunTranscripts(thread?.runTranscripts).find((item) => item.runId === runId);
  outputState.transcript = stored || {
    runId,
    turnId: thread?.activeRunTurnId || runId,
    messageId: '',
    agentId: thread?.activeRunAgentId || '',
    status: 'running',
    groups: [],
    partialContent: '',
    createdAt: now(),
    updatedAt: now(),
  };
  return outputState.transcript;
}

function finalizeStoredRunTranscript(thread, runId, status, partialContent = '', messageId = '') {
  const transcript = normalizeRunTranscripts(thread?.runTranscripts).find((item) => item.runId === runId);
  if (!transcript) return null;
  transcript.status = status;
  transcript.messageId = messageId || transcript.messageId || '';
  transcript.partialContent = status === 'completed' ? '' : String(partialContent || '').slice(0, 20000);
  transcript.updatedAt = now();
  transcript.groups = transcript.groups.map((group) => {
    const items = group.items.map((item) => item.status === 'running'
      ? { ...item, status: status === 'failed' ? 'failed' : status === 'cancelled' ? 'cancelled' : 'completed', updatedAt: now() }
      : item);
    const groupStatus = items.some((item) => item.status === 'failed') ? 'failed'
      : items.some((item) => item.status === 'cancelled') ? 'cancelled' : 'completed';
    return { ...group, items, status: groupStatus, summary: summarizeActivityItems(items), updatedAt: now() };
  });
  return upsertRunTranscript(thread, transcript);
}

async function recordRunActivity(threadId, runId, outputState, event) {
  return updateState(async (state) => {
    const thread = state.threads.find((item) => item.id === threadId);
    if (!thread) return event;
    const transcript = runTranscriptForOutput(thread, runId, outputState);
    const activity = event.activity || normalizeRunActivityItem(event.raw || event, event.event === 'tool.completed' ? (event.error ? 'failed' : 'completed') : 'running');
    const applied = applyRunActivityToTranscript(transcript, activity, { contentOffset: outputState.text.length, groupOpen: outputState.activityGroupOpen });
    outputState.transcript = applied.transcript;
    outputState.activityGroupOpen = applied.groupOpen;
    upsertRunTranscript(thread, applied.transcript);
    thread.updatedAt = now();
    return { ...event, activity, groupId: applied.group.id, contentOffset: applied.group.contentOffset, groupSummary: applied.group.summary, groupStatus: applied.group.status };
  });
}

function writeHermesRunSse(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function ensureModelRunDiagnostics(state) {
  state.observability = state.observability || { modelUsage: [], modelRuns: [], systemEvents: [] };
  state.observability.modelRuns = Array.isArray(state.observability.modelRuns) ? state.observability.modelRuns : [];
  return state.observability.modelRuns;
}

function appendModelRunDiagnostic(state, record) {
  const records = ensureModelRunDiagnostics(state);
  records.push(record);
  state.observability.modelRuns = records.slice(-200);
  return record;
}

function updateModelRunDiagnostic(state, { diagnosticId = '', runId = '', threadId = '' }, update) {
  const records = ensureModelRunDiagnostics(state);
  let index = diagnosticId ? records.findIndex((record) => record.id === diagnosticId) : -1;
  if (index < 0 && runId) index = records.findIndex((record) => record.runId === runId);
  if (index < 0 && threadId) {
    for (let cursor = records.length - 1; cursor >= 0; cursor -= 1) {
      if (records[cursor].threadId === threadId && ['starting', 'sent'].includes(records[cursor].status)) {
        index = cursor;
        break;
      }
    }
  }
  if (index < 0) return null;
  records[index] = update(records[index]);
  state.observability.modelRuns = records.slice(-200);
  return records[index];
}

function finishStoredModelRun(state, { diagnosticId = '', runId = '', threadId = '', status, usage = {}, error = '' }) {
  const completedAt = now();
  return updateModelRunDiagnostic(state, { diagnosticId, runId, threadId }, (record) => finishModelRunDiagnostic(record, { status, completedAt, usage, error }));
}

function clearHermesRunState(thread) {
  thread.activeRunId = '';
  thread.activeSessionId = '';
  thread.activeRunStartedAt = '';
  thread.activeRunAgentId = '';
  thread.activeRunMentionedAgentId = '';
  thread.activeRunRouteReason = '';
  thread.activeRunMentionDepth = 0;
  thread.activeRunParentMessageId = '';
  thread.activeRunSourceAgentId = '';
  thread.activeRunTurnId = '';
  thread.activeRuntimeId = '';
}

function finishActiveRunGroupChild(thread, runId, status = 'completed') {
  if (!thread?.activeRunGroup) return;
  const activeRuns = { ...(thread.activeRunGroup.activeRuns || {}) };
  delete activeRuns[runId];
  const hasActiveRuns = Object.keys(activeRuns).length > 0;
  thread.activeRunGroup = {
    ...thread.activeRunGroup,
    activeRuns,
    status: hasActiveRuns ? 'running' : status,
    updatedAt: now(),
    ...(hasActiveRuns ? {} : { completedAt: now() }),
  };
}

function hermesChunkError(chunk) {
  const result = chunk?.result;
  if (result?.failed && result?.error) return String(result.error);
  if (chunk?.error) return String(chunk.error);
  const statusEvent = Array.isArray(chunk?.events)
    ? chunk.events.find((event) => String(event?.event || event?.type || '') === 'status' && event.text)
    : null;
  if (statusEvent?.text && /error|failed|HTTP\s+\d+|❌|失败|invalid|unauthorized|auth/i.test(String(statusEvent.text))) {
    return String(statusEvent.text);
  }
  return '';
}

async function repairRichContentFinalOutput(threadId, runId, output) {
  const validation = validateRichContentOutput(output);
  if (validation.valid) return { output, repaired: false, issues: [] };
  const state = await readState().catch(() => null);
  const thread = state?.threads?.find((item) => item.id === threadId);
  const diagnostic = state?.observability?.modelRuns?.find((item) => item.runId === runId);
  const repairSessionId = `frakio-rich-repair-${runId}`;
  try {
    const response = await requestHermesBridge({
      action: 'chat',
      wait: true,
      timeout: 150,
      ephemeral: true,
      session_id: repairSessionId,
      message: richContentRepairPrompt(output, validation.issues),
      storage_message: '',
      conversation_history: [],
      profile: diagnostic?.profileName || thread?.profileName || 'default',
      model: diagnostic?.model || undefined,
      provider: diagnostic?.providerKey || undefined,
      runtime_overrides: { disable_tools: true, rich_tool_descriptions: false },
      instructions: '你是 Frakio 富内容格式修复器。只能输出修复后的完整正文，不得解释、调用工具或增加新内容。',
      source: 'frakio-rich-content-repair',
    }, { timeoutMs: 180000, retryMs: 1000 });
    const candidate = normalizeRepairedOutput(extractHermesOutput('', response.output, response.result));
    const repairedValidation = validateRichContentOutput(candidate);
    if (candidate && repairedValidation.valid) {
      captureTelemetry('rich_content_repaired', { issue_count: validation.issues.length, issue_codes: validation.issues.map((issue) => issue.code).join(',') });
      return { output: candidate, repaired: true, issues: validation.issues };
    }
    captureTelemetry('rich_content_repair_failed', { issue_count: validation.issues.length, remaining_count: repairedValidation.issues.length });
  } catch (error) {
    captureTelemetry('rich_content_repair_failed', { issue_count: validation.issues.length, error_code: telemetryErrorCode(error) });
  } finally {
    await requestHermesBridge({ action: 'destroy', session_id: repairSessionId }, { timeoutMs: 5000 }).catch(() => {});
  }
  return { output, repaired: false, issues: validation.issues };
}

async function completeHermesRunFromOutput(threadId, runId, output, usage, res, outputState = {}) {
  const telemetryState = await readState().catch(() => null);
  const telemetryThread = telemetryState?.threads?.find((item) => item.id === threadId);
  const structuredPlanSubmitted = (telemetryThread?.planSessions || []).some((plan) => (plan.drafts || []).some((draft) => draft.submittedByRunId === runId));
  if (!output && !structuredPlanSubmitted) {
    const error = 'Hermes 已结束但没有返回最终文本。';
    const thread = await failHermesRun(threadId, runId, error, 'Hermes Agent 返回空回复');
    captureTelemetry('agent_run_failed', { stage: 'empty_output', error_code: 'empty_output' });
    writeHermesRunSse(res, { event: 'run.failed', runId, error, thread, timestamp: Date.now() / 1000 });
    return { completed: true, failed: true, thread };
  }
  const richResult = output ? await repairRichContentFinalOutput(threadId, runId, output) : { output: '', repaired: false, issues: [] };
  const finalOutput = richResult.output;
  const streamedText = String(outputState.text || '');
  const contentOffsetShift = streamedText.length - trimLeadingBlankLines(streamedText).length;
  const thread = await appendHermesRunResult(threadId, finalOutput, runId, usage || {}, contentOffsetShift);
  const completedMessage = thread?.messages?.find((message) => message.externalRunId === runId);
  captureTelemetry('agent_run_completed', runTelemetryProperties(telemetryThread));
  writeHermesRunSse(res, {
    event: 'run.completed',
    runId,
    output: finalOutput,
    richContentRepaired: richResult.repaired,
    thread,
    turnId: completedMessage?.turnId || runId,
    agentId: completedMessage?.agentId || '',
    agentName: completedMessage?.agentName || '',
    mentionDepth: Number(completedMessage?.mentionDepth || 0),
    parentMessageId: completedMessage?.parentMessageId || '',
    timestamp: Date.now() / 1000,
  });
  return { completed: true, failed: false, thread };
}

async function failHermesRunFromChunk(threadId, runId, errorMessage, res, outputState = {}) {
  const details = hermesRuntimeErrorDetails(errorMessage || 'Hermes Bridge run failed', 'default');
  const event = { event: 'run.failed', runId, error: enrichMissingExecutableError(errorMessage || 'Hermes Bridge run failed', 'default'), details, timestamp: Date.now() / 1000 };
  let telemetryProperties = {};
  const thread = await updateState(async (state) => {
    const currentThread = state.threads.find((item) => item.id === threadId);
    telemetryProperties = runTelemetryProperties(currentThread);
    if (!currentThread) return null;
    markPlanRunFailed(currentThread, runId, event.error);
    currentThread.runStatus = 'failed';
    finalizeStoredRunTranscript(currentThread, runId, 'failed', outputState.text || '');
    finishStoredModelRun(state, { runId, threadId, status: 'failed', error: event.error });
    finishActiveRunGroupChild(currentThread, runId, 'failed');
    clearHermesRunState(currentThread);
    currentThread.workflowState = mergeWorkflowStep(closeOpenWorkflowSteps(currentThread.workflowState || [], 'failed'), stepFromHermesEvent(event));
    currentThread.workflow = currentThread.workflowState.map((step) => step.title);
    currentThread.updatedAt = now();
    return currentThread;
  });
  if (thread) event.thread = thread;
  captureTelemetry('agent_run_failed', { stage: 'runtime', error_code: telemetryErrorCode({ message: errorMessage }), ...telemetryProperties });
  writeHermesRunSse(res, event);
  return { completed: true, failed: true, thread };
}

async function processHermesBridgeChunk({ threadId, runId, chunk, res, outputState }) {
  let sawStreamDeltaEvent = false;
  for (const rawEvent of Array.isArray(chunk.events) ? chunk.events : []) {
    const rawName = String(rawEvent?.event || rawEvent?.type || '');
    if (rawName === 'stream.delta') {
      sawStreamDeltaEvent = true;
      const delta = String(rawEvent.delta || '');
      if (delta) {
        outputState.text += delta;
        outputState.activityGroupOpen = false;
        writeHermesRunSse(res, { event: 'message.delta', runId, delta, timestamp: Date.now() / 1000 });
      }
      continue;
    }

    const event = normalizeHermesBridgeChunkEvent(rawEvent);
    if (event.event === 'message.delta') {
      const delta = String(event.delta || '');
      if (delta) {
        outputState.text += delta;
        outputState.activityGroupOpen = false;
        writeHermesRunSse(res, { ...event, runId: event.runId || runId, delta });
      }
      continue;
    }

    if (event.event === 'run.completed') {
      const output = extractHermesOutput(outputState.text, event.output, chunk.output, chunk.result);
      return completeHermesRunFromOutput(threadId, runId, output, event.usage || chunk.usage || {}, res, outputState);
    }

    if (event.event === 'run.failed' || event.event === 'run.cancelled') {
      let telemetryProperties = {};
      const thread = await updateState(async (state) => {
        const currentThread = state.threads.find((item) => item.id === threadId);
        telemetryProperties = runTelemetryProperties(currentThread);
        if (!currentThread) return null;
        markPlanRunFailed(currentThread, runId, event.error || (event.event === 'run.cancelled' ? '用户已停止运行。' : 'Plan run failed.'));
        currentThread.runStatus = event.event === 'run.failed' ? 'failed' : 'idle';
        finalizeStoredRunTranscript(currentThread, runId, event.event === 'run.failed' ? 'failed' : 'cancelled', outputState.text || '');
        finishStoredModelRun(state, {
          runId,
          threadId,
          status: event.event === 'run.failed' ? 'failed' : 'cancelled',
          error: event.error || (event.event === 'run.cancelled' ? '用户已停止运行。' : ''),
        });
        finishActiveRunGroupChild(currentThread, runId, event.event === 'run.failed' ? 'failed' : 'cancelled');
        clearHermesRunState(currentThread);
        currentThread.workflowState = closeOpenWorkflowSteps(currentThread.workflowState || [], event.event === 'run.failed' ? 'failed' : 'completed');
        currentThread.workflow = currentThread.workflowState.map((step) => step.title);
        currentThread.updatedAt = now();
        return currentThread;
      });
      if (thread) event.thread = thread;
      if (event.event === 'run.failed') captureTelemetry('agent_run_failed', { stage: 'runtime', error_code: 'bridge_failed', ...telemetryProperties });
      writeHermesRunSse(res, event);
      return { completed: true, failed: event.event === 'run.failed', thread };
    }

    const outgoingEvent = event.event === 'tool.running' || event.event === 'tool.completed'
      ? await recordRunActivity(threadId, runId, outputState, event)
      : event;
    if (outgoingEvent.event !== 'tool.running' && outgoingEvent.event !== 'tool.completed') {
      await mergeHermesWorkflowEvent(threadId, outgoingEvent);
    }
    if (outgoingEvent.event !== 'agent.event' || outgoingEvent.title || outgoingEvent.detail) writeHermesRunSse(res, outgoingEvent);
  }

  if (chunk.delta && !sawStreamDeltaEvent) {
    const delta = String(chunk.delta || '');
    outputState.text += delta;
    outputState.activityGroupOpen = false;
    writeHermesRunSse(res, { event: 'message.delta', runId, delta, timestamp: Date.now() / 1000 });
  }

  if (chunk.done || ['complete', 'completed', 'interrupted', 'error', 'failed'].includes(String(chunk.status || '').toLowerCase())) {
    const status = String(chunk.status || '').toLowerCase();
    const terminalError = hermesChunkError(chunk);
    if (status === 'error' || status === 'failed' || terminalError) return failHermesRunFromChunk(threadId, runId, terminalError || 'Hermes Bridge run failed', res, outputState);
    const output = extractHermesOutput(outputState.text, chunk.output, chunk.result);
    return completeHermesRunFromOutput(threadId, runId, output, chunk.usage || {}, res, outputState);
  }

  return { completed: false };
}

async function appendHermesRunResult(threadId, output, runId, usage = {}, contentOffsetShift = 0, runtimeId = 'hermes', modelId = '', profileRevision = '') {
  return updateState(async (state) => {
    const thread = state.threads.find((item) => item.id === threadId);
    if (!thread) return null;
    const agent = state.agents.find((item) => item.id === thread.activeRunAgentId)
    || resolveThreadDefaultAgent(state, thread)
    || state.agents[0]
    || { id: 'iris', name: 'Iris', role: 'Agent' };
  const runtimeLabel = runtimeId === 'pi' ? 'Pi' : runtimeId === 'hermes' ? 'Hermes Agent' : runtimeId;
  const defaultAgent = resolveThreadDefaultAgent(state, thread) || agent;
  const explicitlyMentionedAgent = state.agents.find((item) => item.id === thread.activeRunMentionedAgentId) || null;
  const collaboration = normalizeCollaboration(thread.collaboration, { defaultAgentId: thread.defaultAgentId, activeAgentId: thread.activeAgentId });
  const nextActiveAgent = thread.followMode === 'conversation' ? agent : defaultAgent;
  const runSessionId = thread.activeSessionId || hermesAgentSessionId(thread, agent.id);
  const runTurnId = thread.activeRunTurnId || runId;
  const finalOutput = trimLeadingBlankLines(output);
  const runStartedAtMs = Date.parse(thread.activeRunStartedAt || '');
  const processingDurationMs = Number.isFinite(runStartedAtMs) ? Math.max(1, Date.now() - runStartedAtMs) : undefined;
  const submittedPlan = (thread.planSessions || []).find((plan) => (plan.drafts || []).some((draft) => draft.submittedByRunId === runId));
  const executingPlan = (thread.planSessions || []).find((plan) => plan.executionRunId === runId);
  if (finalOutput && !submittedPlan && !(thread.messages || []).some((message) => message.externalRunId === runId)) {
    thread.messages = [
      ...(thread.messages || []),
      agentEvent(agent, finalOutput, {
        role: `${agent.role || 'Agent'} / ${runtimeLabel}`,
        runtimeId,
        runtimeName: runtimeLabel,
        modelId: modelId || agent.model || '',
        profileRevision: profileRevision || agentProfileRevision(agent),
        externalRunId: runId,
        turnId: runTurnId,
        mentionDepth: Number(thread.activeRunMentionDepth || 0),
        parentMessageId: thread.activeRunParentMessageId || '',
        routeReason: thread.activeRunRouteReason || '',
        ...(processingDurationMs ? { processingDurationMs } : {}),
      }),
    ];
  }
  let completedRunMessage = (thread.messages || []).find((message) => message.externalRunId === runId);
  if (!completedRunMessage && submittedPlan) {
    const submittedDraft = (submittedPlan.drafts || []).find((draft) => draft.submittedByRunId === runId);
    completedRunMessage = (thread.messages || []).find((message) => message.planId === submittedPlan.id && Number(message.planRevision) === Number(submittedDraft?.revision));
    if (completedRunMessage) {
      completedRunMessage.externalRunId = runId;
      if (processingDurationMs) completedRunMessage.processingDurationMs = processingDurationMs;
    }
  }
  if (contentOffsetShift > 0) {
    const transcript = normalizeRunTranscripts(thread.runTranscripts).find((item) => item.runId === runId);
    if (transcript) {
      transcript.groups = transcript.groups.map((group) => ({ ...group, contentOffset: Math.max(0, group.contentOffset - contentOffsetShift) }));
      upsertRunTranscript(thread, transcript);
    }
  }
  finalizeStoredRunTranscript(thread, runId, 'completed', '', completedRunMessage?.id || '');
  thread.updatedAt = now();
  thread.runStatus = 'idle';
  clearHermesRunState(thread);
  thread.activeAgentId = nextActiveAgent?.id || thread.defaultAgentId || agent.id;
  thread.collaboration = normalizeCollaboration({
    ...collaboration,
    activeAgentId: nextActiveAgent?.id || collaboration.activeAgentId,
    lastMentionedAgentId: explicitlyMentionedAgent?.id || collaboration.lastMentionedAgentId,
    lastMentionedAgentName: explicitlyMentionedAgent?.name || collaboration.lastMentionedAgentName,
    lastRoutedAt: now(),
    lastRouteReason: explicitlyMentionedAgent ? 'user_mention' : thread.followMode === 'conversation' ? 'conversation_follow' : 'default_agent',
  }, { defaultAgentId: thread.defaultAgentId, activeAgentId: nextActiveAgent?.id });
  thread.engine = runtimeId === 'hermes' ? 'hermes-agent' : 'model-provider';
  thread.runtimeId = runtimeId;
  if (executingPlan) {
    executingPlan.status = 'completed';
    executingPlan.error = '';
    executingPlan.updatedAt = now();
    captureTelemetry('plan_execution_completed', { target_mode: executingPlan.targetExecutionMode });
  }
  if (runtimeId === 'hermes') {
    thread.agentSessionIds = { ...(thread.agentSessionIds || {}), [agent.id]: runSessionId };
    thread.externalSessionId = thread.externalSessionId || hermesAgentSessionId(thread, defaultAgent.id);
  }
  thread.runtimeSessionIds = { ...(thread.runtimeSessionIds || {}), [`${agent.id}:${runtimeId}`]: runSessionId };
  if (thread.activeRunGroup?.turnId === runTurnId) {
    finishActiveRunGroupChild(thread, runId, 'completed');
  }
  const activeWorkflow = thread.executionMode === 'work' ? workflowById(thread) : null;
  if (activeWorkflow?.currentRootTaskId && activeWorkflow.coordinatorAgentId === agent.id && activeWorkflow.plan?.tasks?.length) {
    const planTasks = activeWorkflow.plan.tasks.filter((task) => !task.cancelled && task.taskId);
    const taskDetails = await Promise.all(planTasks.map((task) => readKanbanTaskDetail(activeWorkflow.boardSlug, task.taskId).catch(() => null)));
    const allPlanTasksFinished = planTasks.length > 0 && taskDetails.every((detail) => ['done', 'archived', 'cancelled'].includes(String(detail?.task?.status || detail?.status || '')));
    if (allPlanTasksFinished) {
      const rootDetail = await readKanbanTaskDetail(activeWorkflow.boardSlug, activeWorkflow.currentRootTaskId).catch(() => null);
      const rootStatus = String(rootDetail?.task?.status || rootDetail?.status || '');
      const rootCompletionRecorded = (thread.collaboration?.events || []).some((event) => event.workflowId === activeWorkflow.id && event.taskId === activeWorkflow.currentRootTaskId && event.type === 'task.completed');
      if (!rootCompletionRecorded && !['done', 'archived', 'cancelled'].includes(rootStatus)) {
        await runHermesCommand(['kanban', '--board', activeWorkflow.boardSlug, 'complete', activeWorkflow.currentRootTaskId, '--summary', finalOutput]);
        appendThreadCollaborationEvent(thread, { type: 'task.completed', workflowId: activeWorkflow.id, taskId: activeWorkflow.currentRootTaskId, actorAgentId: agent.id, title: rootDetail?.task?.title || thread.title, detail: finalOutput, payload: { root: true } });
      }
      if (activeWorkflow.status !== 'completed') {
        activeWorkflow.status = 'completed';
        activeWorkflow.completedAt = now();
        activeWorkflow.updatedAt = now();
        appendThreadCollaborationEvent(thread, { type: 'workflow.completed', workflowId: activeWorkflow.id, actorAgentId: agent.id, title: activeWorkflow.name, detail: '根任务和执行方案已经完成' });
      }
      const approvedPlanSession = (thread.planSessions || []).find((plan) => plan.id === activeWorkflow.approvedPlanId);
      if (approvedPlanSession && approvedPlanSession.status !== 'completed') {
        approvedPlanSession.status = 'completed';
        approvedPlanSession.error = '';
        approvedPlanSession.updatedAt = now();
        captureTelemetry('plan_execution_completed', { target_mode: 'work' });
      }
    }
  }
  thread.workflowState = mergeWorkflowStep(closeOpenWorkflowSteps(thread.workflowState || [], 'completed'), { title: '生成最终回复', status: 'completed', source: 'run', updatedAt: now() });
  thread.workflow = thread.workflowState.map((step) => step.title);
  finishStoredModelRun(state, { runId, threadId, status: 'completed', usage });
  if (usage?.total_tokens) {
    state.observability = state.observability || { modelUsage: [], systemEvents: [] };
    state.observability.modelUsage = Array.isArray(state.observability.modelUsage) ? state.observability.modelUsage : [];
    state.observability.modelUsage.push({
      id: id('usage'),
      createdAt: now(),
      provider: runtimeLabel,
      modelId: runtimeId,
      modelName: runtimeLabel,
      threadId: thread.id,
      threadTitle: thread.title,
      workspaceId: thread.workspaceId,
      agentIds: [agent.id],
      agentNames: [agent.name],
      inputTokens: Number(usage.input_tokens || 0),
      outputTokens: Number(usage.output_tokens || 0),
      cacheReadTokens: numberFromUsage(usage.cache_read_input_tokens, usage.cached_input_tokens, usage.input_tokens_details?.cached_tokens, usage.prompt_tokens_details?.cached_tokens),
      cacheCreationTokens: numberFromUsage(usage.cache_creation_input_tokens, usage.input_tokens_details?.cache_creation_tokens),
      totalTokens: Number(usage.total_tokens || 0),
      estimated: false,
      dataSource: 'Hermes Agent',
    });
    state.observability.modelUsage = state.observability.modelUsage.slice(-800);
  }
    return thread;
  });
}

function extractHermesOutput(...sources) {
  const seen = new Set();
  function visit(value) {
    if (value == null) return '';
    if (typeof value === 'string') return trimLeadingBlankLines(value);
    if (typeof value !== 'object') return '';
    if (seen.has(value)) return '';
    seen.add(value);
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) {
        const text = visit(value[index]);
        if (text) return text;
      }
      return '';
    }
    for (const key of ['output', 'final_output', 'finalOutput', 'final_response', 'finalResponse', 'response', 'content', 'text']) {
      const text = visit(value[key]);
      if (text) return text;
    }
    const messageText = visit(value.message?.content || value.message);
    if (messageText) return messageText;
    if (value.result) return visit(value.result);
    return '';
  }
  for (const source of sources) {
    const text = visit(source);
    if (text) return text;
  }
  return '';
}

function markPlanRunFailed(thread, runId, errorMessage) {
  const plan = (thread?.planSessions || []).find((item) => item.sourceRunId === runId || item.executionRunId === runId);
  if (!plan || ['cancelled', 'completed', 'waiting_approval'].includes(plan.status)) return null;
  plan.status = 'failed';
  plan.error = String(errorMessage || 'Plan run failed.').slice(0, 1000);
  plan.updatedAt = now();
  captureTelemetry('plan_execution_failed', { target_mode: plan.targetExecutionMode });
  return plan;
}

async function failHermesRun(threadId, runId, errorMessage, title = 'Hermes Agent 运行失败') {
  return updateState(async (state) => {
    const thread = state.threads.find((item) => item.id === threadId);
    if (!thread) return null;
    markPlanRunFailed(thread, runId, errorMessage);
    thread.runStatus = 'failed';
    finishStoredModelRun(state, { runId, threadId, status: 'failed', error: errorMessage });
    finishActiveRunGroupChild(thread, runId, 'failed');
    clearHermesRunState(thread);
    thread.workflowState = mergeWorkflowStep(closeOpenWorkflowSteps(thread.workflowState || [], 'failed'), { title, status: 'failed', source: 'run', detail: String(errorMessage || '').slice(0, 200), updatedAt: now() });
    thread.workflow = thread.workflowState.map((step) => step.title);
    thread.updatedAt = now();
    return thread;
  });
}

const hermesTurnRuntime = new Map();
const hermesRunConsumers = new Map();
const hermesTurnEventLimit = 1200;

function turnRuntime(threadId, turnId) {
  const cleanThreadId = String(threadId || '').trim();
  const cleanTurnId = String(turnId || '').trim();
  if (!cleanThreadId || !cleanTurnId) return null;
  const runtimeKey = `${cleanThreadId}:${cleanTurnId}`;
  let runtime = hermesTurnRuntime.get(runtimeKey);
  if (!runtime) {
    runtime = { cursor: 0, events: [], subscribers: new Set(), completed: false };
    hermesTurnRuntime.set(runtimeKey, runtime);
  }
  return runtime;
}

function emitHermesTurnEvent(threadId, turnId, event = {}) {
  const runtime = turnRuntime(threadId, turnId);
  if (!runtime) return null;
  const next = {
    ...event,
    threadId,
    turnId,
    cursor: ++runtime.cursor,
    timestamp: event.timestamp || Date.now() / 1000,
  };
  runtime.events.push(next);
  if (runtime.events.length > hermesTurnEventLimit) runtime.events.splice(0, runtime.events.length - hermesTurnEventLimit);
  if (next.event === 'turn.completed' || next.event === 'turn.failed' || next.event === 'turn.cancelled') runtime.completed = true;
  for (const subscriber of runtime.subscribers) subscriber(next);
  return next;
}

function hermesTurnEventSink(threadId, turnId, runMeta = {}) {
  return {
    write(chunk) {
      for (const line of String(chunk || '').split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        try {
          const event = JSON.parse(line.slice(5).trim());
          const runtimeRunId = event.runId || runMeta.runId || '';
          const storedRun = runtimeRunId ? runtimeStore.getRun(runtimeRunId) : null;
          if (storedRun) {
            const canonicalType = event.event === 'tool.running' ? 'tool.started'
              : event.event === 'approval.request' ? 'approval.requested'
                : event.event === 'approval.responded' ? 'approval.resolved'
                  : event.event;
            if (['run.started', 'message.delta', 'reasoning.summary', 'tool.started', 'tool.updated', 'tool.completed', 'approval.requested', 'approval.resolved', 'artifact.published', 'run.completed', 'run.failed', 'run.cancelled'].includes(canonicalType)) {
              runtimeStore.appendEvent({ runId: runtimeRunId, type: canonicalType, payload: event });
            }
            if (event.event === 'run.completed') runtimeStore.updateRun(runtimeRunId, { status: 'completed' });
            if (event.event === 'run.failed') runtimeStore.updateRun(runtimeRunId, { status: 'failed', error: event.error || '' });
            if (event.event === 'run.cancelled') runtimeStore.updateRun(runtimeRunId, { status: 'cancelled' });
          }
          emitHermesTurnEvent(threadId, turnId, {
            ...event,
            runId: event.runId || runMeta.runId || '',
            agentId: event.agentId || runMeta.agentId || '',
            agentName: event.agentName || runMeta.agentName || '',
            mentionDepth: Number(event.mentionDepth ?? runMeta.mentionDepth ?? 0),
            parentMessageId: event.parentMessageId || runMeta.parentMessageId || '',
          });
        } catch {
          // Ignore malformed compatibility output; the Bridge consumer remains authoritative.
        }
      }
    },
  };
}

async function invokeInternalHermesRun(threadId, body) {
  return new Promise((resolve) => {
    let statusCode = 200;
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolve({ status: statusCode, payload: payload || {} });
    };
    const res = {
      status(code) {
        statusCode = Number(code) || 200;
        return this;
      },
      json(payload) {
        finish(payload);
        return this;
      },
    };
    Promise.resolve(startHermesRunRequest({ params: { id: threadId }, body: body || {}, query: {}, headers: {} }, res))
      .then(() => { if (!settled) finish({}); })
      .catch((error) => {
        statusCode = Number(error?.status || 500);
        finish({ error: String(error?.message || error), code: error?.code || '' });
      });
  });
}

function mentionRouteRecord({ turnId, sourceAgentId, sourceAgentName, sourceMessageId, target, depth, text }) {
  const edge = `${sourceAgentId}->${target.id}`;
  return {
    id: `${turnId}:${edge}`,
    edge,
    sourceAgentId,
    sourceAgentName,
    sourceMessageId,
    targetAgentId: target.id,
    targetAgentName: target.name,
    mentionDepth: depth,
    text,
    status: 'pending',
    runId: '',
    error: '',
    createdAt: now(),
    updatedAt: now(),
  };
}

async function collectHermesMentionRoutes(threadId, turnId, completedRunId) {
  return updateState(async (state) => {
    const thread = state.threads.find((item) => item.id === threadId);
    if (!thread || thread.executionMode === 'work' || thread.collaborationMode === 'plan') return [];
    const group = thread.activeRunGroup?.turnId === turnId ? thread.activeRunGroup : null;
    if (!group) return [];
    const completedMessage = (thread.messages || []).find((message) => message.externalRunId === completedRunId);
    if (!completedMessage) return [];
    const routes = Array.isArray(group.routes) ? [...group.routes] : [];
    const knownEdges = new Set([...(group.routedEdges || []), ...routes.map((route) => route.edge)]);
    const queuedRouteCount = routes.filter((route) => route.status === 'pending' || route.status === 'starting').length;
    const maxDepth = group.maxMentionDepth ?? normalizeAgentMentionMaxDepth(state.ui?.agentMentionMaxDepth, 2);
    const additions = [];
    const appendTargets = (source, targets, depth, relayTextForTarget) => {
      if (!mentionDepthAllows(depth, maxDepth)) return;
      for (const target of targets) {
        const edge = `${source.agentId}->${target.id}`;
        if (knownEdges.has(edge) || Number(group.totalRoutedRuns || 0) + queuedRouteCount + additions.length >= 64) continue;
        knownEdges.add(edge);
        additions.push(mentionRouteRecord({
          turnId,
          sourceAgentId: source.agentId,
          sourceAgentName: source.agentName,
          sourceMessageId: source.id,
          target,
          depth,
          text: relayTextForTarget(target),
        }));
      }
    };

    if (Number(completedMessage.mentionDepth || 0) === 0 && completedMessage.routeReason !== 'agent_mention') {
      const completedIndex = (thread.messages || []).findIndex((message) => message.id === completedMessage.id);
      const userMessage = [...(thread.messages || []).slice(0, Math.max(0, completedIndex))].reverse().find((message) => message.agentId === 'user');
      if (userMessage) {
        const targets = resolveMentionedAgents(userMessage.content, state.agents, {
          senderAgentId: 'user',
          selectedAgentIds: thread.selectedAgents || [],
          fallbackAgentId: resolveDefaultAgentId(state),
        }).filter((target) => target.id !== completedMessage.agentId);
        appendTargets(userMessage, targets, 0, () => userMessage.content);
      }
    }

    const nextDepth = Number(completedMessage.mentionDepth || 0) + 1;
    const targets = resolveMentionedAgents(completedMessage.content, state.agents, {
      senderAgentId: completedMessage.agentId,
      selectedAgentIds: thread.selectedAgents || [],
      fallbackAgentId: resolveDefaultAgentId(state),
    });
    appendTargets(completedMessage, targets, nextDepth, (target) => {
      const routedText = stripMentionRoutingTokens(completedMessage.content, target) || completedMessage.content;
      return `群聊系统：${completedMessage.agentName} 在对话中提及了你（${target.name}），请基于当前上下文直接回复。\n\n原始消息：${routedText}`;
    });

    group.routes = [...routes.map((route) => route.runId === completedRunId && route.status === 'running'
      ? { ...route, status: 'completed', updatedAt: now() }
      : route), ...additions];
    group.status = additions.length || group.routes.some((route) => route.status === 'pending') ? 'routing' : group.status;
    group.updatedAt = now();
    thread.updatedAt = now();
    return additions;
  });
}

async function appendMentionRouteFailure(threadId, turnId, route, errorMessage) {
  return updateState(async (state) => {
    const thread = state.threads.find((item) => item.id === threadId);
    const group = thread?.activeRunGroup?.turnId === turnId ? thread.activeRunGroup : null;
    if (!thread || !group) return null;
    group.routes = (group.routes || []).map((item) => item.id === route.id
      ? { ...item, status: 'failed', error: errorMessage, updatedAt: now() }
      : item);
    const duplicate = (thread.messages || []).some((message) => message.routeId === route.id && message.routeReason === 'mention_route_failed');
    if (!duplicate) {
      thread.messages = [...(thread.messages || []), {
        id: id('msg'),
        agentId: 'system',
        agentName: '系统',
        role: 'System',
        content: `未能唤醒 ${route.targetAgentName}：${String(errorMessage || '启动失败').slice(0, 180)}`,
        turnId,
        mentionDepth: route.mentionDepth,
        parentMessageId: route.sourceMessageId,
        routeReason: 'mention_route_failed',
        routeId: route.id,
        createdAt: now(),
      }];
    }
    thread.updatedAt = now();
    return thread;
  });
}

async function completeHermesTurnIfIdle(threadId, turnId) {
  const thread = await updateState(async (state) => {
    const current = state.threads.find((item) => item.id === threadId);
    const group = current?.activeRunGroup?.turnId === turnId ? current.activeRunGroup : null;
    if (!current || !group) return null;
    const hasPending = (group.routes || []).some((route) => route.status === 'pending' || route.status === 'starting' || route.status === 'running');
    const hasActive = Object.keys(group.activeRuns || {}).length > 0;
    if (hasPending || hasActive) return null;
    group.status = (group.routes || []).some((route) => route.status === 'failed') ? 'completed_with_errors' : 'completed';
    group.updatedAt = now();
    group.completedAt = group.completedAt || now();
    current.runStatus = 'idle';
    current.updatedAt = now();
    return current;
  });
  if (thread) emitHermesTurnEvent(threadId, turnId, { event: 'turn.completed', thread });
  return thread;
}

async function startNextHermesMentionRoute(threadId, turnId) {
  const snapshot = await readState();
  const thread = snapshot.threads.find((item) => item.id === threadId);
  const group = thread?.activeRunGroup?.turnId === turnId ? thread.activeRunGroup : null;
  if (!thread || !group) return completeHermesTurnIfIdle(threadId, turnId);
  const route = (group.routes || []).find((item) => item.status === 'pending');
  if (!route) return completeHermesTurnIfIdle(threadId, turnId);
  await updateState(async (state) => {
    const current = state.threads.find((item) => item.id === threadId);
    const currentGroup = current?.activeRunGroup?.turnId === turnId ? current.activeRunGroup : null;
    if (!currentGroup) return;
    currentGroup.routes = (currentGroup.routes || []).map((item) => item.id === route.id ? { ...item, status: 'starting', updatedAt: now() } : item);
    currentGroup.status = 'routing';
    currentGroup.updatedAt = now();
  });
  emitHermesTurnEvent(threadId, turnId, { event: 'mention.route', route: { ...route, status: 'starting' } });
  const selectedAgents = Array.from(new Set([...(thread.selectedAgents || []), route.targetAgentId]));
  const result = await invokeInternalHermesRun(threadId, {
    message: route.text,
    selectedAgents,
    targetAgentId: route.targetAgentId,
    turnId,
    sourceAgentId: route.sourceAgentId,
    sourceAgentName: route.sourceAgentName,
    mentionDepth: route.mentionDepth,
    parentMessageId: route.sourceMessageId,
    _deferConsumer: true,
  });
  if (result.status >= 400 || !result.payload?.runId) {
    const message = result.payload?.error || `Agent 路由启动失败（HTTP ${result.status}）`;
    const failedThread = await appendMentionRouteFailure(threadId, turnId, route, message);
    emitHermesTurnEvent(threadId, turnId, { event: 'mention.failed', route: { ...route, status: 'failed', error: message }, thread: failedThread });
    return startNextHermesMentionRoute(threadId, turnId);
  }
  await updateState(async (state) => {
    const current = state.threads.find((item) => item.id === threadId);
    const currentGroup = current?.activeRunGroup?.turnId === turnId ? current.activeRunGroup : null;
    if (!currentGroup) return;
    currentGroup.routes = (currentGroup.routes || []).map((item) => item.id === route.id
      ? { ...item, status: 'running', runId: result.payload.runId, updatedAt: now() }
      : item);
    currentGroup.updatedAt = now();
  });
  ensureHermesRunConsumer({
    threadId,
    turnId,
    runId: result.payload.runId,
    sessionId: result.payload.sessionId,
    agentId: result.payload.agentId || route.targetAgentId,
    agentName: result.payload.agentName || route.targetAgentName,
    mentionDepth: Number(result.payload.mentionDepth ?? route.mentionDepth),
    parentMessageId: result.payload.parentMessageId || route.sourceMessageId,
  });
  return result.payload;
}

async function routeCompletedHermesRun(threadId, turnId, runId) {
  await collectHermesMentionRoutes(threadId, turnId, runId);
  return startNextHermesMentionRoute(threadId, turnId);
}

function ensureHermesRunConsumer({ threadId, turnId, runId, sessionId = '', agentId = '', agentName = '', mentionDepth = 0, parentMessageId = '' }) {
  if (!runId) return null;
  if (hermesRunConsumers.has(runId)) return hermesRunConsumers.get(runId);
  const promise = (async () => {
    let cursor = 0;
    let eventCursor = 0;
    const outputState = { text: '' };
    const sink = hermesTurnEventSink(threadId, turnId, { runId, agentId, agentName, mentionDepth, parentMessageId });
    try {
      for (;;) {
        const chunk = await requestHermesBridge({ action: 'get_output', run_id: runId, cursor, event_cursor: eventCursor }, { timeoutMs: 10000, retryMs: 1000 });
        cursor = Number(chunk.cursor ?? cursor);
        eventCursor = Number(chunk.event_cursor ?? eventCursor);
        const result = await processHermesBridgeChunk({ threadId, runId, chunk, res: sink, outputState });
        if (result.completed) {
          if (!result.failed) await routeCompletedHermesRun(threadId, turnId, runId);
          else await startNextHermesMentionRoute(threadId, turnId);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
    } catch (error) {
      const formatted = enrichMissingExecutableError(String(error?.message || error), 'default');
      const failedThread = await failHermesRun(threadId, runId, formatted);
      emitHermesTurnEvent(threadId, turnId, { event: 'run.failed', runId, agentId, agentName, mentionDepth, parentMessageId, error: formatted, thread: failedThread });
      await startNextHermesMentionRoute(threadId, turnId);
    } finally {
      hermesRunConsumers.delete(runId);
    }
  })();
  hermesRunConsumers.set(runId, promise);
  return promise;
}

async function healStaleRunningThreads(state) {
  let changed = false;
  const runningThreads = (state.threads || []).filter((thread) => thread.runStatus === 'running');
  for (const thread of runningThreads) {
    const activeRunId = String(thread.activeRunId || '').trim();
    const activeSessionId = String(thread.activeSessionId || thread.externalSessionId || `workbench-${thread.id}`);
    const updatedAtMs = Date.parse(thread.activeRunStartedAt || thread.updatedAt || '');
    const ageMs = Number.isFinite(updatedAtMs) ? Date.now() - updatedAtMs : 0;
    if (!activeRunId) {
      if (ageMs > 60000) {
        thread.runStatus = 'failed';
        clearHermesRunState(thread);
        thread.workflowState = mergeWorkflowStep(closeOpenWorkflowSteps(thread.workflowState || [], 'failed'), { title: 'Hermes Agent 运行状态已过期', status: 'failed', source: 'run', detail: '旧 run 没有可恢复的 runId，请重新发送消息。', updatedAt: now() });
        thread.workflow = thread.workflowState.map((step) => step.title);
        thread.updatedAt = now();
        changed = true;
      }
      continue;
    }
    const turnId = thread.activeRunTurnId || thread.activeRunGroup?.turnId || activeRunId;
    const runMeta = thread.activeRunGroup?.activeRuns?.[activeRunId] || {};
    ensureHermesRunConsumer({
      threadId: thread.id,
      turnId,
      runId: activeRunId,
      sessionId: activeSessionId,
      agentId: runMeta.agentId || thread.activeRunAgentId || '',
      agentName: runMeta.agentName || '',
      mentionDepth: Number(runMeta.mentionDepth ?? thread.activeRunMentionDepth ?? 0),
      parentMessageId: runMeta.parentMessageId || thread.activeRunParentMessageId || '',
    });
  }
  if (changed) await writeState(state);
  return changed;
}

async function runtimeModelSelection(state, thread, agent, runtimeId) {
  const overrides = normalizeAgentModelOverrides(thread?.agentModelOverrides || {}, state.agents, state.models);
  const selection = resolveModelSelectionByPrecedence({
    threadModel: agent?.id ? overrides[agent.id] : '',
    agentModel: agent?.model || '',
    globalModel: state.ui?.defaultModel || '',
    models: state.models || [],
  });
  if (selection.requestedValue) {
    if (!selection.selectedModel) {
      const error = new Error(`模型「${selection.requestedValue}」不存在，请在模型中心重新选择。`);
      error.status = 409;
      error.code = 'RUNTIME_MODEL_NOT_FOUND';
      throw error;
    }
    const compatibility = await runtimeModelCompatibility(runtimeId, selection.selectedModel, state.models || [], state.features);
    if (compatibility.status === 'unsupported') {
      const error = new Error(compatibility.reason);
      error.status = 409;
      error.code = 'RUNTIME_MODEL_UNSUPPORTED';
      throw error;
    }
    if (!runtimeSupportsModel(runtimeId, selection.selectedModel, selection.selectedName)) {
      const error = new Error(`模型「${selection.selectedName}」使用的 API 协议不受 ${runtimeId === 'pi' ? 'Pi' : 'Hermes'} 支持。`);
      error.status = 409;
      error.code = 'RUNTIME_MODEL_UNSUPPORTED';
      throw error;
    }
    if (compatibility.credentialStatus === 'missing') {
      const error = new Error(compatibility.reason);
      error.status = 409;
      error.code = runtimeId === 'pi' ? 'PI_MODEL_CREDENTIAL_MISSING' : 'HERMES_MODEL_CREDENTIAL_MISSING';
      throw error;
    }
    return { ...selection, compatibility };
  }
  for (const model of state.models || []) {
    const selectedName = model.model || runtimeModelNames(model)[0] || '';
    const compatibility = await runtimeModelCompatibility(runtimeId, model, state.models || [], state.features);
    if (selectedName && compatibility.usableModelIds.includes(selectedName)) {
      return {
        selectedModel: model,
        selectedName,
        selectionValue: modelSelectionValue(model, selectedName),
        requestedValue: '',
        source: 'fallback',
        compatibility,
      };
    }
  }
  const error = new Error(`${runtimeId === 'pi' ? 'Pi' : 'Hermes'} 没有兼容且已配置凭据的模型，请前往模型中心检查。`);
  error.status = 409;
  error.code = 'RUNTIME_MODEL_MISSING';
  throw error;
}

function piApiMode(model) {
  return runtimeApiMode(model?.modelApiModes?.[model?.model] || model?.apiMode || 'chat_completions');
}

function assertSupportedRuntimeReasoning({ runtimeLabel, modelName, capability, requested = {} }) {
  const level = String(requested.reasoningEffort || '').trim();
  if (!level) return;
  if (typeof capability?.reasoningMap?.[level] === 'string') return;
  const error = new Error(`模型「${modelName}」不支持「${level}」推理档位，请在模型中心重新选择。`);
  error.status = 409;
  error.code = 'RUNTIME_REASONING_UNSUPPORTED';
  error.runtimeLabel = runtimeLabel;
  throw error;
}

function piThinkingFormat(value) {
  const format = String(value || 'openai').trim();
  if (format === 'chat_template') return 'chat-template';
  if (format === 'string_thinking') return 'string-thinking';
  return ['openai', 'openrouter', 'deepseek', 'together', 'zai', 'qwen', 'chat-template', 'string-thinking', 'ant-ling'].includes(format)
    ? format
    : 'openai';
}

function piModelRuntimeSettings(selectedModel, selectedName, capability, requestedRunSettings, mapping) {
  assertSupportedRuntimeReasoning({
    runtimeLabel: 'Pi',
    modelName: selectedName,
    capability,
    requested: requestedRunSettings,
  });
  const modelCompat = {
    ...(selectedModel?.compat || {}),
    ...(selectedModel?.modelCompat?.[selectedName] || {}),
  };
  const thinkingFormat = piThinkingFormat(capability?.thinkingFormat || modelCompat.thinkingFormat);
  const supportsExplicitOff = ['deepseek', 'together', 'zai', 'qwen', 'chat-template', 'string-thinking'].includes(thinkingFormat);
  const thinkingLevelMap = Object.fromEntries(Object.entries(capability?.reasoningMap || {})
    .filter(([level, mapped]) => typeof mapped === 'string' && mapped.trim())
    .filter(([level]) => level !== 'off' || supportsExplicitOff));
  const requestedLevel = String(requestedRunSettings?.reasoningEffort || '').trim();
  return {
    thinkingLevel: requestedLevel && requestedLevel !== 'off' ? requestedLevel : 'off',
    requestedReasoning: mapping.requestedReasoning,
    effectiveReasoning: requestedLevel === 'off' && !supportsExplicitOff ? 'provider_default' : mapping.effectiveReasoning,
    compat: {
      thinkingFormat,
      supportsReasoningEffort: Object.entries(thinkingLevelMap).some(([level]) => level !== 'off'),
      thinkingLevelMap,
      requestOverrides: modelCompat.requestOverrides || {},
    },
  };
}

async function piModelConfiguration(state, thread, agent) {
  const { selectedModel, selectedName } = await runtimeModelSelection(state, thread, agent, 'pi');
  const apiKey = await getReusableModelSecret(selectedModel, state.models || []);
  const oauthProviderKey = oauthCredentialProviderKey(selectedModel);
  const oauth = oauthProviderKey ? await getOAuthCredential(oauthProviderKey, selectedModel.oauthAccountId || '') : null;
  if (!apiKey && !oauth?.access && !modelCredentialNotRequired(selectedModel)) {
    const error = new Error(`模型「${selectedModel.name}」没有可供 Pi 使用的凭据。请在 Frakio Model Center 完成授权。`);
    error.status = 409;
    error.code = 'PI_MODEL_CREDENTIAL_MISSING';
    throw error;
  }
  const providerCatalog = flattenProviderCatalog(modelCatalogCache);
  const capability = resolveModelCapability(selectedModel, selectedName, { providerCatalog });
  const requestedRunSettings = normalizeAgentRunOverrides(thread.agentRunOverrides, state.agents)[agent.id] || {};
  const mapping = capability
    ? mapRunSettings(selectedModel, capability, requestedRunSettings)
    : { effectiveReasoning: 'off', requestedReasoning: 'default', effectiveServiceTier: 'standard', requestedServiceTier: 'standard' };
  const piSettings = piModelRuntimeSettings(selectedModel, selectedName, capability, requestedRunSettings, mapping);
  const mode = piApiMode({ ...selectedModel, model: selectedName });
  const providerId = oauthProviderKey ? piOAuthProviderId(oauthProviderKey) : (selectedModel.providerKey || selectedModel.id);
  let geminiProjectId = '';
  if (oauthProviderKey === geminiProviderKey) {
    if (!state.features?.piGeminiCodeAssistAdapter) {
      const error = new Error('Gemini Code Assist 的 Pi 适配器尚未开放。');
      error.status = 409;
      error.code = 'PI_GEMINI_CODE_ASSIST_DISABLED';
      throw error;
    }
    const account = await resolveGeminiCodeAssistAccount(agent.profileName || 'default', oauth.access, selectedModel.oauthAccountId || '');
    geminiProjectId = account.projectId;
    await setOAuthCredential(geminiProviderKey, {
      ...oauth,
      codeAssist: { ...(oauth.codeAssist || {}), ...account, checkedAt: now() },
    }, selectedModel.oauthAccountId || '');
  }
  return {
    providerId,
    providerName: selectedModel.provider || selectedModel.name,
    modelId: selectedName,
    modelName: selectedName,
    apiMode: mode,
    baseUrl: selectedModel.baseUrl,
    apiKey,
    authMode: oauthProviderKey ? 'oauth' : 'api_key',
    oauthProviderKey,
    oauthAccountId: selectedModel.oauthAccountId || '',
    geminiProjectId,
    reasoning: Boolean(capability?.reasoning),
    thinkingLevelMap: piSettings.compat.thinkingLevelMap,
    contextWindow: Number(selectedModel.contextLimit || 128000),
    maxTokens: Math.min(32768, Math.max(1024, Number(selectedModel.maxTokens || 8192))),
    cost: {
      input: Number(selectedModel.pricing?.input || 0),
      output: Number(selectedModel.pricing?.output || 0),
      cacheRead: Number(selectedModel.pricing?.cacheRead || 0),
      cacheWrite: Number(selectedModel.pricing?.cacheCreation || 0),
    },
    compat: piSettings.compat,
    thinkingLevel: piSettings.thinkingLevel,
    requestedReasoning: piSettings.requestedReasoning,
    effectiveReasoning: piSettings.effectiveReasoning,
    requestedServiceTier: mapping.requestedServiceTier,
    effectiveServiceTier: mapping.effectiveServiceTier,
    modelProfileId: selectedModel.id,
  };
}

function runtimeForRequest(state, thread, body = {}) {
  const selected = Array.isArray(body.selectedAgents) ? body.selectedAgents : thread.selectedAgents || [resolveDefaultAgentId(state)];
  const selectedAgents = state.agents.filter((agent) => selected.includes(agent.id));
  const agent = resolveRunTargetAgent(state, thread, body.targetAgentId, selectedAgents);
  if (!agent) return { agent: null, runtimeId: '' };
  const threadOverride = thread.agentRuntimeOverrides?.[agent.id] || '';
  const runtimeId = runtimeForAgent(agent, String(body.runtimeId || threadOverride || '').trim());
  return { agent, runtimeId };
}

function runtimeHandoffPacket(thread, agent, runtimeId) {
  const previousRuntimeId = String(thread.runtimeId || thread.activeRuntimeId || '');
  const messages = (thread.messages || []).slice(-12).map((message) => ({
    agentName: message.agentName,
    role: message.role,
    content: String(message.content || '').slice(0, 1200),
  }));
  return {
    fromRuntimeId: previousRuntimeId && previousRuntimeId !== runtimeId ? previousRuntimeId : '',
    toRuntimeId: runtimeId,
    agentId: agent.id,
    acceptedDecisions: messages.filter((message) => /确认|决定|采用|approved|decision/i.test(message.content)).slice(-6),
    recentConversation: messages,
    createdAt: now(),
  };
}

async function runtimeContextPacket(state, thread, agent, runtimeId, message) {
  const workspace = state.workspaces.find((item) => item.id === thread.workspaceId) || null;
  const vaultId = thread.vaultId || workspace?.primaryVaultId || workspace?.vaultId || '';
  const vault = state.vaults.find((item) => item.id === vaultId) || null;
  const memory = memoryLedger.packet({
    userId: 'default',
    agentId: agent.id,
    workspaceId: workspace?.id || '',
    query: message.slice(0, 160),
  });
  const knowledge = vault
    ? await knowledgeGateway.search(vault, message.split(/\s+/).slice(0, 8).join(' ').slice(0, 100), { limit: 8 }).catch(() => [])
    : [];
  return {
    memory,
    knowledge,
    handoff: runtimeHandoffPacket(thread, agent, runtimeId),
    workspace: workspace ? { id: workspace.id, name: workspace.name, rootPath: workspace.rootPath } : null,
    vault: vault ? { id: vault.id, name: vault.name, path: vault.path } : null,
  };
}

async function handlePiToolRequest(name, params, context) {
  const state = await readState();
  const thread = state.threads.find((item) => item.id === context.threadId);
  const workspace = state.workspaces.find((item) => item.id === (context.workspaceId || thread?.workspaceId));
  const vault = state.vaults.find((item) => item.id === (context.vaultId || thread?.vaultId || workspace?.primaryVaultId || workspace?.vaultId));
  if (name === 'frakio_memory_search') {
    return memoryLedger.packet({
      userId: 'default',
      agentId: context.agentId,
      workspaceId: workspace?.id || '',
      query: String(params.query || ''),
      limit: Number(params.limit || 24),
    });
  }
  if (name === 'frakio_memory_propose') {
    const scope = ['user', 'agent', 'workspace'].includes(params.scope) ? params.scope : 'workspace';
    const subjectId = scope === 'user' ? 'default' : scope === 'agent' ? context.agentId : workspace?.id;
    if (!subjectId) throw new Error('The requested memory scope is not available in this conversation.');
    return memoryLedger.propose({
      scope,
      subjectId,
      fact: params.fact,
      confidence: Number(params.confidence ?? 0.5),
      provenance: [{ runtimeId: 'pi', runId: context.runId, threadId: context.threadId, source: 'pi-tool' }],
    });
  }
  if (name.startsWith('frakio_knowledge_') || name === 'frakio_artifact_publish') {
    if (!workspace || !vault) throw new Error('This conversation has no writable Workspace Vault.');
    if (name === 'frakio_knowledge_search') return knowledgeGateway.search(vault, params.query, { limit: params.limit });
    if (name === 'frakio_knowledge_read') return knowledgeGateway.read(vault, params.path);
    if (name === 'frakio_knowledge_draft_write') {
      return knowledgeGateway.draftWrite({ workspace, vault, runId: context.runId, relativePath: params.path, content: params.content });
    }
    if (name === 'frakio_artifact_publish') {
      const target = params.title
        ? `artifacts/${String(params.title).replace(/[^a-zA-Z0-9\u4e00-\u9fff._-]/g, '-')}.md`
        : '';
      return knowledgeGateway.publish({ workspace, vault, runId: context.runId, draftPath: params.path, targetPath: target });
    }
  }
  if (name.startsWith('frakio_task_')) {
    const taskId = String(params.taskId || context.taskId || '');
    const task = taskId ? runtimeStore.getWorkTask(taskId) : null;
    if (name === 'frakio_task_get') return task || { taskId, status: 'not_found' };
    if (!task) throw new Error(`Frakio Work task does not exist: ${taskId}`);
    const status = name === 'frakio_task_complete' ? 'completed'
      : name === 'frakio_task_request_input' ? 'needs_input'
        : String(params.status || task.status);
    return runtimeStore.upsertWorkTask({
      ...task,
      status,
      description: params.detail || params.question || params.summary || task.description,
      attempt: task.attempt,
      idempotencyKey: task.idempotencyKey,
      metadata: {
        ...task.metadata,
        lastRuntimeUpdate: { name, params, runId: context.runId, updatedAt: now() },
      },
    });
  }
  throw new Error(`Unsupported Frakio Pi tool: ${name}`);
}

function canonicalRuntimeEventType(type) {
  return [
    'run.started', 'message.delta', 'reasoning.summary', 'tool.started', 'tool.updated',
    'tool.completed', 'approval.requested', 'approval.resolved', 'artifact.published',
    'run.completed', 'run.failed', 'run.cancelled',
  ].includes(type) ? type : 'tool.updated';
}

async function processCanonicalRuntimeEvent(runId, event) {
  const run = runtimeStore.getRun(runId);
  if (!run) return;
  const runtimeId = run.runtimeId;
  const runtimeLabel = runtimeId === 'pi' ? 'Pi'
    : runtimeId === 'codex' ? 'Codex'
      : runtimeId === 'claude' ? 'Claude Code'
        : runtimeId === 'gemini' ? 'Gemini CLI'
          : runtimeId;
  const type = canonicalRuntimeEventType(event.type);
  const payload = event.payload || {};
  runtimeStore.appendEvent({ runId, type, payload });
  if (run.metadata?.taskId && !['run.completed', 'run.failed', 'run.cancelled'].includes(type)) {
    workScheduler.heartbeat(run.metadata.taskId);
  }
  if (type === 'message.delta') {
    emitHermesTurnEvent(run.threadId, run.turnId, {
      event: 'message.delta',
      runId,
      sessionId: run.sessionId,
      agentId: run.agentId,
      delta: String(payload.delta || ''),
      runtimeId,
    });
    return;
  }
  if (type === 'tool.started' || type === 'tool.updated' || type === 'tool.completed') {
    const mapped = type === 'tool.completed' ? 'tool.completed' : 'tool.running';
    const outputState = piRunOutputStates.get(runId) || { text: '', activityGroupOpen: false };
    const outgoing = await recordRunActivity(run.threadId, runId, outputState, {
      event: mapped,
      tool: payload.toolName,
      tool_call_id: payload.toolCallId,
      args: payload.args || {},
      resultPreview: payload.resultPreview || '',
      is_error: payload.isError,
      timestamp: Date.now() / 1000,
    });
    piRunOutputStates.set(runId, outputState);
    emitHermesTurnEvent(run.threadId, run.turnId, {
      ...outgoing,
      runId,
      sessionId: run.sessionId,
      agentId: run.agentId,
      runtimeId,
    });
    return;
  }
  if (type === 'reasoning.summary') {
    emitHermesTurnEvent(run.threadId, run.turnId, {
      event: 'reasoning.summary',
      runId,
      sessionId: run.sessionId,
      agentId: run.agentId,
      delta: String(payload.delta || ''),
      runtimeId,
    });
    return;
  }
  if (type === 'approval.requested') {
    runtimeStore.updateRun(runId, { status: 'waiting_approval' });
    emitHermesTurnEvent(run.threadId, run.turnId, {
      event: 'approval.request',
      runId,
      sessionId: run.sessionId,
      agentId: run.agentId,
      runtimeId,
      approvalId: payload.approvalId || '',
      title: payload.title || payload.description || `${runtimeLabel} 需要确认`,
      command: payload.command || payload.commandPreview || '',
      cwd: payload.cwd || '',
      tool: payload.toolName || payload.tool || '',
      choices: ['once', 'session', 'always', 'deny'],
      raw: payload,
      timestamp: Date.now() / 1000,
    });
    return;
  }
  if (type === 'approval.resolved') {
    runtimeStore.updateRun(runId, { status: 'running' });
    emitHermesTurnEvent(run.threadId, run.turnId, {
      event: 'approval.responded',
      runId,
      sessionId: run.sessionId,
      agentId: run.agentId,
      runtimeId,
      approvalId: payload.approvalId || '',
      choice: payload.decision || payload.choice || '',
      resolved: true,
      timestamp: Date.now() / 1000,
    });
    return;
  }
  if (type === 'run.completed') {
    runtimeStore.updateRun(runId, { status: 'completed' });
    const completedTask = run.metadata?.taskId ? runtimeStore.getWorkTask(run.metadata.taskId) : null;
    if (completedTask) {
      runtimeStore.upsertWorkTask({
        ...completedTask,
        status: 'completed',
        leaseExpiresAt: null,
        idempotencyKey: completedTask.idempotencyKey,
        metadata: { ...completedTask.metadata, summary: String(payload.output || '').slice(0, 4000) },
      });
      for (const candidate of runtimeStore.listWorkTasks(completedTask.workflowId, ['blocked'])) {
        const dependencies = candidate.dependencies || [];
        if (dependencies.length && dependencies.every((dependencyId) => runtimeStore.getWorkTask(dependencyId)?.status === 'completed')) {
          runtimeStore.upsertWorkTask({ ...candidate, status: 'ready', idempotencyKey: candidate.idempotencyKey });
        }
      }
    }
    const thread = run.metadata?.taskDispatch
      ? await updateState(async (state) => {
        const current = state.threads.find((item) => item.id === run.threadId);
        if (!current) return null;
        current.activeWorkRuns = Object.fromEntries(Object.entries(current.activeWorkRuns || {}).filter(([activeRunId]) => activeRunId !== runId));
        appendThreadCollaborationEvent(current, {
          type: 'task.completed',
          workflowId: completedTask?.workflowId || '',
          taskId: completedTask?.id || '',
          actorAgentId: run.agentId,
          title: completedTask?.title || '运行时任务已完成',
          detail: String(payload.output || '').slice(0, 4000),
          payload: { runtimeId, runtimeRunId: runId, runtimeSessionId: run.sessionId },
        });
        current.updatedAt = now();
        return current;
      })
      : await appendHermesRunResult(
        run.threadId,
        String(payload.output || ''),
        runId,
        {},
        0,
        runtimeId,
        run.modelId,
        run.profileRevision,
      );
    piRunOutputStates.delete(runId);
    emitHermesTurnEvent(run.threadId, run.turnId, { event: 'run.completed', runId, sessionId: run.sessionId, agentId: run.agentId, output: payload.output || '', runtimeId, thread });
    emitHermesTurnEvent(run.threadId, run.turnId, { event: 'turn.completed', runId, sessionId: run.sessionId, agentId: run.agentId, runtimeId, thread });
    return;
  }
  if (type === 'run.failed' || type === 'run.cancelled') {
    runtimeStore.updateRun(runId, { status: type === 'run.failed' ? 'failed' : 'cancelled', error: payload.error || '' });
    const failedTask = run.metadata?.taskId ? runtimeStore.getWorkTask(run.metadata.taskId) : null;
    if (failedTask) {
      runtimeStore.upsertWorkTask({
        ...failedTask,
        status: type === 'run.failed' ? 'failed' : 'cancelled',
        leaseExpiresAt: null,
        idempotencyKey: failedTask.idempotencyKey,
      });
    }
    const thread = run.metadata?.taskDispatch
      ? await updateState(async (state) => {
        const current = state.threads.find((item) => item.id === run.threadId);
        if (!current) return null;
        current.activeWorkRuns = Object.fromEntries(Object.entries(current.activeWorkRuns || {}).filter(([activeRunId]) => activeRunId !== runId));
        appendThreadCollaborationEvent(current, {
          type: type === 'run.failed' ? 'task.failed' : 'task.cancelled',
          workflowId: failedTask?.workflowId || '',
          taskId: failedTask?.id || '',
          actorAgentId: run.agentId,
          title: failedTask?.title || (type === 'run.failed' ? '运行时任务失败' : '运行时任务已取消'),
          detail: String(payload.error || '').slice(0, 2000),
          payload: { runtimeId, runtimeRunId: runId, runtimeSessionId: run.sessionId },
        });
        current.updatedAt = now();
        return current;
      })
      : type === 'run.failed'
        ? await failHermesRun(run.threadId, runId, String(payload.error || `${runtimeLabel} 运行失败。`), `${runtimeLabel} 运行失败`)
      : await updateState(async (state) => {
        const current = state.threads.find((item) => item.id === run.threadId);
        if (!current) return null;
        current.runStatus = 'idle';
        finishActiveRunGroupChild(current, runId, 'cancelled');
        clearHermesRunState(current);
        current.workflowState = closeOpenWorkflowSteps(current.workflowState || [], 'completed');
        current.workflow = current.workflowState.map((step) => step.title);
        current.updatedAt = now();
        return current;
      });
    piRunOutputStates.delete(runId);
    emitHermesTurnEvent(run.threadId, run.turnId, { event: type, runId, sessionId: run.sessionId, agentId: run.agentId, runtimeId, error: payload.error || '', thread });
    emitHermesTurnEvent(run.threadId, run.turnId, { event: type === 'run.failed' ? 'turn.failed' : 'turn.cancelled', runId, sessionId: run.sessionId, agentId: run.agentId, runtimeId, error: payload.error || '', thread });
  }
}

const piRunOutputStates = new Map();
piBridge.on('event', ({ runId, event }) => {
  void processCanonicalRuntimeEvent(runId, event).catch((error) => console.warn('Pi event processing failed:', error?.message || error));
});
codexBridge.on('event', ({ runId, event }) => {
  void processCanonicalRuntimeEvent(runId, event).catch((error) => console.warn('Codex event processing failed:', error?.message || error));
});
claudeBridge.on('event', ({ runId, event }) => {
  void processCanonicalRuntimeEvent(runId, event).catch((error) => console.warn('Claude event processing failed:', error?.message || error));
});
geminiBridge.on('event', ({ runId, event }) => {
  void processCanonicalRuntimeEvent(runId, event).catch((error) => console.warn('Gemini event processing failed:', error?.message || error));
});

async function startPiRunRequest(req, res) {
  let createdRun = null;
  const taskDispatch = Boolean(req.body?.taskDispatch && req.body?.taskId);
  try {
    const state = await readState();
    const thread = state.threads.find((item) => item.id === req.params.id);
    if (!thread) return res.status(404).json({ error: '会话不存在。' });
    if (!taskDispatch && thread.runStatus === 'running') return res.status(409).json({ error: '当前会话已有运行中的任务。' });
    const message = String(req.body?.message || '').trim();
    const turnId = String(req.body?.turnId || id('turn'));
    if (!message) return res.status(400).json({ error: '消息不能为空。' });
    const { agent, runtimeId } = runtimeForRequest(state, thread, { ...req.body, runtimeId: 'pi' });
    if (!agent || runtimeId !== 'pi') return res.status(409).json({ error: '目标 Agent 没有启用 Pi 运行时。', code: 'RUNTIME_NOT_ALLOWED' });
    const workspace = state.workspaces.find((item) => item.id === thread.workspaceId) || null;
    const vault = state.vaults.find((item) => item.id === (thread.vaultId || workspace?.primaryVaultId || workspace?.vaultId)) || null;
    const profileSnapshot = agentProfileSnapshot(agent);
    const model = await piModelConfiguration(state, thread, agent);
    const contextPacket = await runtimeContextPacket(state, thread, agent, 'pi', message);
    const session = runtimeStore.upsertSession({
      runtimeId: 'pi',
      threadId: thread.id,
      agentId: agent.id,
      workspaceId: workspace?.id || '',
      profileRevision: profileSnapshot.revision,
      status: 'active',
      metadata: { handoff: contextPacket.handoff },
    });
    createdRun = runtimeStore.createRun({
      sessionId: session.id,
      runtimeId: 'pi',
      threadId: thread.id,
      agentId: agent.id,
      turnId,
      profileRevision: profileSnapshot.revision,
      modelId: model.modelId,
      status: 'starting',
      metadata: { modelProfileId: model.modelProfileId, taskId: String(req.body?.taskId || ''), taskDispatch },
    });
    let taskId = '';
    let workTask = null;
    if (thread.executionMode === 'work') {
      const workflow = workflowById(thread);
      const existingTask = req.body?.taskId ? runtimeStore.getWorkTask(String(req.body.taskId)) : null;
      const task = runtimeStore.upsertWorkTask(existingTask ? {
        ...existingTask,
        runtimeSessionId: session.id,
        status: 'running',
        attempt: taskDispatch ? existingTask.attempt : existingTask.attempt + 1,
        leaseExpiresAt: existingTask.leaseExpiresAt || new Date(Date.now() + 120000).toISOString(),
        idempotencyKey: existingTask.idempotencyKey,
      } : {
        workflowId: workflow?.id || `workflow_${thread.id}`,
        title: message.slice(0, 120),
        description: message,
        assigneeAgentId: agent.id,
        runtimeId: 'pi',
        runtimeSessionId: session.id,
        dependencies: [],
        status: 'running',
        attempt: 1,
        leaseExpiresAt: new Date(Date.now() + 120000).toISOString(),
        idempotencyKey: `turn:${turnId}`,
      });
      taskId = task.id;
      workTask = task;
      runtimeStore.updateRun(createdRun.id, { metadata: { taskId, taskDispatch } });
    }
    if (!taskDispatch) {
      const userMessage = { id: id('msg'), agentId: 'user', agentName: '你', role: 'Workspace Owner', content: message, createdAt: now() };
      thread.messages = [...(thread.messages || []), userMessage];
      thread.runStatus = 'running';
      thread.activeRunId = createdRun.id;
      thread.activeSessionId = session.id;
      thread.activeRuntimeId = 'pi';
      thread.activeRunAgentId = agent.id;
      thread.activeRunTurnId = turnId;
      thread.activeRunStartedAt = now();
      thread.activeRunGroup = {
        turnId,
        maxMentionDepth: normalizeAgentMentionMaxDepth(state.ui?.agentMentionMaxDepth, 2),
        depth: 0,
        routedEdges: [],
        routes: [],
        activeRuns: { [createdRun.id]: { runId: createdRun.id, sessionId: session.id, agentId: agent.id, agentName: agent.name, mentionDepth: 0, parentMessageId: '', status: 'running' } },
        totalRoutedRuns: 1,
        status: 'running',
        startedAt: now(),
        updatedAt: now(),
      };
      thread.workflowState = [{ title: 'Pi 开始执行', status: 'running', source: 'run', detail: message.slice(0, 80), updatedAt: now() }];
      thread.workflow = thread.workflowState.map((step) => step.title);
    } else {
      thread.activeWorkRuns = {
        ...(thread.activeWorkRuns || {}),
        [createdRun.id]: {
          runId: createdRun.id,
          taskId,
          agentId: agent.id,
          runtimeId: 'pi',
          sessionId: session.id,
          status: 'running',
          startedAt: now(),
        },
      };
      appendThreadCollaborationEvent(thread, {
        type: 'task.started',
        workflowId: workTask?.workflowId || '',
        taskId,
        actorAgentId: agent.id,
        title: workTask?.title || message.slice(0, 120),
        detail: 'Pi Runtime Session 已启动',
        payload: { runtimeId: 'pi', runtimeRunId: createdRun.id, runtimeSessionId: session.id, worktreePath: workTask?.worktreePath || '' },
      });
    }
    thread.runtimeId = 'pi';
    thread.runtimeSessionIds = { ...(thread.runtimeSessionIds || {}), [`${agent.id}:pi`]: session.id };
    thread.updatedAt = now();
    await writeState(state);
    runtimeStore.appendEvent({ runId: createdRun.id, type: 'run.started', payload: { turnId, agentId: agent.id, profileRevision: profileSnapshot.revision } });
    emitHermesTurnEvent(thread.id, turnId, { event: 'run.started', runId: createdRun.id, sessionId: session.id, agentId: agent.id, agentName: agent.name, runtimeId: 'pi' });
    const accepted = await piBridge.startRun({
      runId: createdRun.id,
      sessionId: session.id,
      sessionFile: session.metadata?.sessionFile || '',
      threadId: thread.id,
      agentId: agent.id,
      workspaceId: workspace?.id || '',
      vaultId: vault?.id || '',
      taskId,
      cwd: workTask?.worktreePath || workspace?.rootPath || projectRoot,
      agentDir: path.join(frakioWorkHome, 'runtimes', 'pi', 'agents', agent.id),
      sessionRoot: path.join(frakioWorkHome, 'runtimes', 'pi', 'sessions'),
      profileSnapshot,
      contextPacket,
      model,
      thinkingLevel: model.thinkingLevel,
      permissionMode: thread.permissionMode || 'smart',
      prompt: message,
    });
    runtimeStore.upsertSession({
      ...session,
      nativeSessionId: accepted.nativeSessionId,
      status: 'active',
      metadata: { ...session.metadata, sessionFile: accepted.sessionFile || '', handoff: contextPacket.handoff },
    });
    runtimeStore.updateRun(createdRun.id, { status: 'running' });
    captureTelemetry('agent_run_started', { agent_count: 1, attachment_count: 0, permission_mode: thread.permissionMode || 'smart', runtime: 'pi' });
    return res.status(202).json({
      runId: createdRun.id,
      sessionId: session.id,
      status: 'started',
      runtime: 'pi',
      runtimeId: 'pi',
      profileRevision: profileSnapshot.revision,
      model: model.modelId,
      provider: model.providerName,
      requestedReasoning: model.requestedReasoning,
      effectiveReasoning: model.effectiveReasoning,
      turnId,
      agentId: agent.id,
      agentName: agent.name,
      kind: thread.executionMode === 'work' ? 'work-root' : 'chat',
      taskId,
    });
  } catch (error) {
    if (createdRun) runtimeStore.updateRun(createdRun.id, { status: 'failed', error: error.message || String(error) });
    if (createdRun && !taskDispatch) {
      await updateState(async (state) => {
        const thread = state.threads.find((item) => item.id === req.params.id);
        if (!thread || thread.activeRunId !== createdRun.id) return;
        thread.runStatus = 'failed';
        finishActiveRunGroupChild(thread, createdRun.id, 'failed');
        clearHermesRunState(thread);
        thread.workflowState = [{ title: 'Pi 启动失败', status: 'failed', source: 'run', detail: String(error.message || error).slice(0, 200), updatedAt: now() }];
        thread.workflow = thread.workflowState.map((step) => step.title);
        thread.updatedAt = now();
      }).catch(() => {});
    }
    if (createdRun && taskDispatch) {
      const run = runtimeStore.getRun(createdRun.id);
      const task = run?.metadata?.taskId ? runtimeStore.getWorkTask(run.metadata.taskId) : null;
      if (task) runtimeStore.upsertWorkTask({ ...task, status: 'failed', leaseExpiresAt: null, idempotencyKey: task.idempotencyKey });
      await updateState(async (state) => {
        const thread = state.threads.find((item) => item.id === req.params.id);
        if (!thread) return;
        thread.activeWorkRuns = Object.fromEntries(Object.entries(thread.activeWorkRuns || {}).filter(([runId]) => runId !== createdRun.id));
        thread.updatedAt = now();
      }).catch(() => {});
    }
    return res.status(error.status || 500).json({ error: error.message || 'Pi 运行创建失败。', code: error.code || 'PI_RUN_FAILED' });
  }
}

async function startExternalChannelRunRequest(req, res, { runtimeId: requestedRuntimeId, runtimeLabel, bridge }) {
  let createdRun = null;
  const taskDispatch = Boolean(req.body?.taskDispatch && req.body?.taskId);
  try {
    const state = await readState();
    const thread = state.threads.find((item) => item.id === req.params.id);
    if (!thread) return res.status(404).json({ error: '会话不存在。' });
    if (!taskDispatch && thread.runStatus === 'running') return res.status(409).json({ error: '当前会话已有运行中的任务。' });
    const installation = await runtimeRegistry.detect(requestedRuntimeId);
    if (!installation?.installed) return res.status(409).json({ error: `未检测到 ${runtimeLabel} CLI。`, code: 'RUNTIME_NOT_INSTALLED' });
    const message = String(req.body?.message || '').trim();
    const turnId = String(req.body?.turnId || id('turn'));
    if (!message) return res.status(400).json({ error: '消息不能为空。' });
    const { agent, runtimeId } = runtimeForRequest(state, thread, { ...req.body, runtimeId: requestedRuntimeId });
    if (!agent || runtimeId !== requestedRuntimeId) return res.status(409).json({ error: `目标 Agent 没有启用 ${runtimeLabel} 运行时。`, code: 'RUNTIME_NOT_ALLOWED' });
    const workspace = state.workspaces.find((item) => item.id === thread.workspaceId) || null;
    const profileSnapshot = agentProfileSnapshot(agent);
    const contextPacket = await runtimeContextPacket(state, thread, agent, requestedRuntimeId, message);
    const model = '';
    const session = runtimeStore.upsertSession({
      runtimeId: requestedRuntimeId,
      threadId: thread.id,
      agentId: agent.id,
      workspaceId: workspace?.id || '',
      profileRevision: profileSnapshot.revision,
      status: 'active',
      metadata: { handoff: contextPacket.handoff, authMode: 'native' },
    });
    createdRun = runtimeStore.createRun({
      sessionId: session.id,
      runtimeId: requestedRuntimeId,
      threadId: thread.id,
      agentId: agent.id,
      turnId,
      profileRevision: profileSnapshot.revision,
      modelId: model,
      status: 'starting',
      metadata: { taskId: String(req.body?.taskId || ''), taskDispatch, authMode: 'native' },
    });
    let workTask = req.body?.taskId ? runtimeStore.getWorkTask(String(req.body.taskId)) : null;
    if (workTask) {
      workTask = runtimeStore.upsertWorkTask({
        ...workTask,
        runtimeSessionId: session.id,
        status: 'running',
        attempt: taskDispatch ? workTask.attempt : workTask.attempt + 1,
        leaseExpiresAt: workTask.leaseExpiresAt || new Date(Date.now() + 120000).toISOString(),
        idempotencyKey: workTask.idempotencyKey,
      });
    }
    if (!taskDispatch) {
      thread.messages = [...(thread.messages || []), {
        id: id('msg'),
        agentId: 'user',
        agentName: '你',
        role: 'Workspace Owner',
        content: message,
        createdAt: now(),
      }];
      thread.runStatus = 'running';
      thread.activeRunId = createdRun.id;
      thread.activeSessionId = session.id;
      thread.activeRuntimeId = requestedRuntimeId;
      thread.activeRunAgentId = agent.id;
      thread.activeRunTurnId = turnId;
      thread.activeRunStartedAt = now();
      thread.activeRunGroup = {
        turnId,
        maxMentionDepth: normalizeAgentMentionMaxDepth(state.ui?.agentMentionMaxDepth, 2),
        depth: 0,
        routedEdges: [],
        routes: [],
        activeRuns: { [createdRun.id]: { runId: createdRun.id, sessionId: session.id, agentId: agent.id, agentName: agent.name, mentionDepth: 0, parentMessageId: '', status: 'running' } },
        totalRoutedRuns: 1,
        status: 'running',
        startedAt: now(),
        updatedAt: now(),
      };
    } else {
      thread.activeWorkRuns = {
        ...(thread.activeWorkRuns || {}),
        [createdRun.id]: {
          runId: createdRun.id,
          taskId: workTask?.id || '',
          agentId: agent.id,
          runtimeId: requestedRuntimeId,
          sessionId: session.id,
          status: 'running',
          startedAt: now(),
        },
      };
      appendThreadCollaborationEvent(thread, {
        type: 'task.started',
        workflowId: workTask?.workflowId || '',
        taskId: workTask?.id || '',
        actorAgentId: agent.id,
        title: workTask?.title || message.slice(0, 120),
        detail: `${runtimeLabel} Runtime Session 已启动`,
        payload: { runtimeId: requestedRuntimeId, runtimeRunId: createdRun.id, runtimeSessionId: session.id, worktreePath: workTask?.worktreePath || '' },
      });
    }
    thread.runtimeId = requestedRuntimeId;
    thread.runtimeSessionIds = { ...(thread.runtimeSessionIds || {}), [`${agent.id}:${requestedRuntimeId}`]: session.id };
    thread.updatedAt = now();
    await writeState(state);
    const runOverrides = normalizeAgentRunOverrides(thread.agentRunOverrides, state.agents)[agent.id] || {};
    const accepted = await bridge.startRun({
      runId: createdRun.id,
      sessionId: session.id,
      nativeSessionId: session.nativeSessionId,
      cwd: workTask?.worktreePath || workspace?.rootPath || projectRoot,
      model,
      effort: runOverrides.reasoningEffort || 'default',
      permissionMode: thread.permissionMode || 'smart',
      profileSnapshot,
      contextPacket,
      prompt: message,
    });
    runtimeStore.upsertSession({
      ...session,
      nativeSessionId: accepted.nativeSessionId,
      status: 'active',
      metadata: { ...session.metadata, handoff: contextPacket.handoff, nativeTurnId: accepted.nativeTurnId },
    });
    runtimeStore.updateRun(createdRun.id, { status: 'running', metadata: { nativeTurnId: accepted.nativeTurnId } });
    captureTelemetry('agent_run_started', { agent_count: 1, attachment_count: 0, permission_mode: thread.permissionMode || 'smart', runtime: requestedRuntimeId });
    return res.status(202).json({
      runId: createdRun.id,
      sessionId: session.id,
      status: 'started',
      runtime: requestedRuntimeId,
      runtimeId: requestedRuntimeId,
      profileRevision: profileSnapshot.revision,
      model: model || `${runtimeLabel} CLI default`,
      turnId,
      agentId: agent.id,
      agentName: agent.name,
      kind: taskDispatch ? 'work-task' : 'chat',
      taskId: workTask?.id || '',
    });
  } catch (error) {
    if (createdRun) runtimeStore.updateRun(createdRun.id, { status: 'failed', error: error.message || String(error) });
    if (createdRun) {
      const run = runtimeStore.getRun(createdRun.id);
      const task = run?.metadata?.taskId ? runtimeStore.getWorkTask(run.metadata.taskId) : null;
      if (task) runtimeStore.upsertWorkTask({ ...task, status: 'failed', leaseExpiresAt: null, idempotencyKey: task.idempotencyKey });
      await updateState(async (state) => {
        const thread = state.threads.find((item) => item.id === req.params.id);
        if (!thread) return;
        thread.activeWorkRuns = Object.fromEntries(Object.entries(thread.activeWorkRuns || {}).filter(([runId]) => runId !== createdRun.id));
        if (!taskDispatch && thread.activeRunId === createdRun.id) {
          thread.runStatus = 'failed';
          finishActiveRunGroupChild(thread, createdRun.id, 'failed');
          clearHermesRunState(thread);
        }
        thread.updatedAt = now();
      }).catch(() => {});
    }
    return res.status(error.status || 500).json({ error: error.message || `${runtimeLabel} 运行创建失败。`, code: error.code || `${requestedRuntimeId.toUpperCase()}_RUN_FAILED` });
  }
}

async function startRuntimeRunRequest(req, res) {
  const state = await readState();
  const thread = state.threads.find((item) => item.id === req.params.id);
  if (!thread) return res.status(404).json({ error: '会话不存在。' });
  const { agent, runtimeId } = runtimeForRequest(state, thread, req.body || {});
  if (!agent) return res.status(400).json({ error: '没有可用的 Agent。' });
  if (runtimeId === 'pi') return startPiRunRequest(req, res);
  if (runtimeId === 'codex') return startExternalChannelRunRequest(req, res, { runtimeId, runtimeLabel: 'Codex', bridge: codexBridge });
  if (runtimeId === 'claude') return startExternalChannelRunRequest(req, res, { runtimeId, runtimeLabel: 'Claude Code', bridge: claudeBridge });
  if (runtimeId === 'gemini') return startExternalChannelRunRequest(req, res, { runtimeId, runtimeLabel: 'Gemini CLI', bridge: geminiBridge });
  if (runtimeId !== 'hermes') {
    return res.status(409).json({
      error: `${runtimeId} 通道已被检测，但执行适配器尚未启用。请在 Runtime Center 查看状态。`,
      code: 'RUNTIME_CHANNEL_NOT_ENABLED',
      runtimeId,
    });
  }
  return startHermesRunRequest(req, res);
}

async function startHermesRunRequest(req, res) {
  let runProfileName = 'default';
  let runDiagnosticId = '';
  let runTurnId = '';
  const requestedPlanRunId = String(req.body?.planExecutionId || '').trim();
  try {
    const state = await readState();
    const thread = state.threads.find((item) => item.id === req.params.id);
    if (!thread) return res.status(404).json({ error: '会话不存在。' });
    const requestedPlanExecutionId = requestedPlanRunId;
    const planExecution = requestedPlanExecutionId
      ? (thread.planSessions || []).find((item) => item.id === requestedPlanExecutionId && ['approved', 'executing', 'failed'].includes(item.status))
      : null;
    const planExecutionDraft = latestPlanDraft(planExecution);
    const draftingPlan = thread.collaborationMode === 'plan' ? activePlanSession(thread) : null;
    if (requestedPlanExecutionId && (!planExecution || !planExecutionDraft || planExecution.targetExecutionMode !== 'chat')) {
      return res.status(409).json({ error: '批准的 Chat 计划不存在或已失效。', code: 'PLAN_EXECUTION_INVALID' });
    }
    const message = String(req.body?.message || '').trim();
    const turnId = String(req.body?.turnId || id('turn'));
    runTurnId = turnId;
    const attachmentMetadata = await attachmentStore.resolveMany(req.body?.attachmentIds);
    if (!message && !attachmentMetadata.length && !planExecution) return res.status(400).json({ error: '消息和附件不能同时为空。' });
    const existingRunGroup = thread.activeRunGroup?.turnId === turnId ? thread.activeRunGroup : null;
    const configuredDepth = existingRunGroup?.maxMentionDepth ?? normalizeAgentMentionMaxDepth(state.ui?.agentMentionMaxDepth, 2);
    if (req.body?.sourceAgentId && req.body.sourceAgentId !== 'user') {
      const requestedDepth = Math.max(0, Math.floor(Number(req.body?.mentionDepth || 0)));
      if (configuredDepth !== 'unlimited' && requestedDepth > configuredDepth) {
        return res.status(409).json({ error: 'Agent 间 @ 路由已达到当前深度上限。', code: 'AGENT_MENTION_DEPTH_LIMIT' });
      }
    }
    let bridge = null;
    try {
      const started = await startHermesBridge();
      bridge = started.bridge;
    } catch (error) {
      bridge = await probeHermesBridge({ timeoutMs: 1000 }).catch(() => null);
      return res.status(503).json({ error: `本机 Hermes Bridge 未连接：${error.message || bridge?.error || '启动失败。'}`, bridge });
    }

    const selected = Array.isArray(req.body?.selectedAgents) ? req.body.selectedAgents : thread.selectedAgents || [resolveDefaultAgentId(state)];
    const selectedAgents = state.agents.filter((agent) => selected.includes(agent.id));
    let primaryAgent = resolveRunTargetAgent(state, thread, req.body?.targetAgentId, selectedAgents);
    if (draftingPlan?.authorAgentId || planExecution?.authorAgentId) {
      primaryAgent = state.agents.find((agent) => agent.id === (draftingPlan?.authorAgentId || planExecution.authorAgentId)) || primaryAgent;
    }
    if (thread.executionMode === 'work' && workflowById(thread)?.currentRootTaskId) {
      primaryAgent = state.agents.find((agent) => agent.id === workflowById(thread).coordinatorAgentId) || primaryAgent;
    }
    if (!primaryAgent) return res.status(400).json({ error: '没有可用的 Agent。' });
    const routingMessage = planExecution
      ? approvedPlanExecutionInstruction(planExecution, planExecutionDraft)
      : message || '请查看并处理这些附件。';
    const mentionedAgents = matchMentionedAgents(routingMessage, state.agents, selected, resolveDefaultAgentId(state));
    const explicitlyMentionedPrimaryAgent = !isAllAgentsMentioned(message) && mentionedAgents.some((agent) => agent.id === primaryAgent.id);
    const routeReason = req.body?.sourceAgentId
      ? req.body.sourceAgentId === 'user' ? 'user_mention' : 'agent_mention'
      : explicitlyMentionedPrimaryAgent
        ? 'user_mention'
        : thread.followMode === 'conversation' ? 'conversation_follow' : 'default_agent';
    const selectedAgentIds = Array.from(new Set([...selected, primaryAgent.id].filter((agentId) => state.agents.some((agent) => agent.id === agentId))));
    const routeEdge = req.body?.sourceAgentId ? `${String(req.body.sourceAgentId)}->${primaryAgent.id}` : '';
    const routedEdges = new Set(existingRunGroup?.routedEdges || []);
    if (routeEdge && routedEdges.has(routeEdge)) return res.status(409).json({ error: '本轮已经执行过相同的 Agent @ 路由。', code: 'AGENT_MENTION_DUPLICATE_EDGE' });
    if (Number(existingRunGroup?.totalRoutedRuns || 0) >= 64) return res.status(409).json({ error: '本轮 Agent @ 路由已达到 64 次安全上限。', code: 'AGENT_MENTION_RUN_LIMIT' });
    if (routeEdge) routedEdges.add(routeEdge);
    const profileName = await resolveHermesProfileNameForAgent(primaryAgent);
    runProfileName = profileName;
    const runModel = await resolveThreadRunModelConfig(state, thread, primaryAgent, profileName);
    const requestedRunSettings = normalizeAgentRunOverrides(thread.agentRunOverrides, state.agents)[primaryAgent.id] || {};
    const runCapability = runModel.modelProfile ? resolveModelCapability(runModel.modelProfile, runModel.model, { providerCatalog: flattenProviderCatalog(modelCatalogCache) }) : null;
    assertSupportedRuntimeReasoning({
      runtimeLabel: 'Hermes',
      modelName: runModel.model,
      capability: runCapability,
      requested: requestedRunSettings,
    });
    const runMapping = runModel.modelProfile && runCapability
      ? mapRunSettings(runModel.modelProfile, runCapability, requestedRunSettings)
      : { requestedReasoning: 'default', effectiveReasoning: 'default', requestedServiceTier: 'standard', effectiveServiceTier: 'standard', runtimeOverrides: {} };
    const sanitizedRunSettings = {
      ...(requestedRunSettings.reasoningEffort && typeof runCapability?.reasoningMap?.[requestedRunSettings.reasoningEffort] === 'string' ? { reasoningEffort: requestedRunSettings.reasoningEffort } : {}),
      ...(requestedRunSettings.speedMode === 'standard' || runCapability?.serviceTiers?.some((tier) => tier.id === requestedRunSettings.speedMode || requestedRunSettings.speedMode === 'fast') ? { speedMode: requestedRunSettings.speedMode } : {}),
    };
    thread.agentRunOverrides = { ...(thread.agentRunOverrides || {}) };
    if (sanitizedRunSettings.reasoningEffort || sanitizedRunSettings.speedMode) thread.agentRunOverrides[primaryAgent.id] = sanitizedRunSettings;
    else delete thread.agentRunOverrides[primaryAgent.id];
    await ensureWorkbenchMcpServers(profileName);
    const missingMcpCommands = await findMissingMcpCommands(profileName);
    if (missingMcpCommands.length) {
      const error = new Error(missingMcpCommands[0].message);
      error.status = 503;
      error.code = 'MCP_COMMAND_MISSING';
      error.details = missingMcpCommands[0];
      throw error;
    }
    let workRoot = null;
    let workReplan = false;
    if (thread.executionMode === 'work' && !req.body?.sourceAgentId && !draftingPlan && !planExecution) {
      let workflow = workflowById(thread);
      if (workflow?.status === 'cancelled') {
        const created = await createCollaborationWorkflow(state, thread, {
          name: thread.title || '协作工作流',
          coordinatorAgentId: primaryAgent.id,
          idempotencyKey: `post-cancel-work:${turnId}`,
        });
        workflow = created.workflow;
      }
      if (!workflow) throw Object.assign(new Error('Work 模式没有可用工作流。请重新切换到 Work。'), { status: 409, code: 'WORKFLOW_MISSING' });
      let capability;
      try {
        capability = await ensureCollaborationRuntimeCapability(profileName);
      } catch (error) {
        workflow.capability = { status: 'blocked', protocolVersion: 0, checkedAt: now(), error: String(error.message || error) };
        appendThreadCollaborationEvent(thread, { type: 'capability.blocked', workflowId: workflow.id, taskId: workflow.currentRootTaskId || '', actorAgentId: 'system', title: '协作工具未加载', detail: String(error.message || error), payload: { profileName, missingTools: error.details?.missingTools || [] } });
        await writeState(state);
        throw error;
      }
      workflow.capability = { status: 'ready', protocolVersion: capability.protocolVersion, checkedAt: now(), reloaded: Boolean(capability.reloaded), error: '' };
      let hasUnfinishedRoot = false;
      if (workflow.currentRootTaskId) {
        const detail = await readKanbanTaskDetail(workflow.boardSlug, workflow.currentRootTaskId).catch(() => null);
        const rootStatus = detail?.task?.status || detail?.status || '';
        hasUnfinishedRoot = Boolean(rootStatus && !['done', 'archived', 'cancelled', 'failed'].includes(rootStatus));
      }
      if (hasUnfinishedRoot) {
        const intervention = await queueWorkSteer(state, thread, workflow, { message: routingMessage, idempotencyKey: `run-steer:${turnId}`, actorAgentId: 'user' });
        if (intervention.queueStatus === 'delivered' || intervention.queueStatus === 'held') {
          const userMessage = { id: id('msg'), agentId: 'user', agentName: '你', role: 'Workspace Owner', content: message, attachments: attachmentMetadata.map(attachmentStore.publicAttachment) };
          await attachmentStore.claim(attachmentMetadata, thread.id, userMessage.id);
          thread.messages = [...(thread.messages || []), userMessage];
          await writeState(state);
          return res.status(202).json({ kind: 'steer', status: intervention.queueStatus, thread, workflowId: workflow.id, rootTaskId: workflow.currentRootTaskId, ...intervention });
        }
        workReplan = true;
        workRoot = { id: workflow.currentRootTaskId };
      }
      if (!hasUnfinishedRoot) {
        workflow.coordinatorAgentId = primaryAgent.id;
        workflow.status = 'active';
        workflow.completedAt = null;
        if (workflow.plan) workflow.planHistory = [...(workflow.planHistory || []), workflow.plan].slice(-50);
        workflow.plan = null;
        workflow.planRevision = 0;
        workflow.executionBindings = {};
        const rootResult = await createCollaborationRoot(state, thread, workflow, {
          title: message.slice(0, 120) || attachmentMetadata.map((item) => item.name).join('、') || '新的协作任务',
          body: hermesStoredMessageContent(message, attachmentMetadata),
          assigneeAgentId: primaryAgent.id,
          actorAgentId: 'user',
          idempotencyKey: `run-root:${turnId}`,
        });
        workRoot = rootResult.task;
      }
    }
    const sessionId = hermesAgentSessionId(thread, primaryAgent.id);
    const userMessage = { id: id('msg'), agentId: 'user', agentName: '你', role: 'Workspace Owner', content: message, attachments: attachmentMetadata.map(attachmentStore.publicAttachment) };
    const relayMessage = req.body?.sourceAgentId ? {
      id: id('msg'),
      agentId: String(req.body.sourceAgentId),
      agentName: String(req.body.sourceAgentName || 'Agent'),
      role: 'Agent mention relay',
      content: message,
      mentionDepth: Number(req.body.mentionDepth || 1),
      parentMessageId: String(req.body.parentMessageId || ''),
    } : null;
    if (!relayMessage && !planExecution && !req.body?.suppressUserMessage) {
      await attachmentStore.claim(attachmentMetadata, thread.id, userMessage.id);
      if (!(thread.messages || []).some((item) => item.content === message && item.agentId === 'user' && String(item.id).startsWith('local-'))) {
        thread.messages = [...(thread.messages || []), userMessage];
      }
    }
    runDiagnosticId = id('model_run');
    thread.runStatus = 'running';
    thread.workflowState = [{ title: 'Hermes Agent 开始执行', status: 'running', source: 'run', detail: (message || attachmentMetadata.map((item) => item.name).join('、')).slice(0, 80), updatedAt: now() }];
    thread.workflow = thread.workflowState.map((step) => step.title);
    thread.selectedAgents = selectedAgentIds;
    thread.agentSessionIds = { ...(thread.agentSessionIds || {}), [primaryAgent.id]: sessionId };
    thread.externalSessionId = thread.externalSessionId || hermesAgentSessionId(thread, resolveThreadDefaultAgent(state, thread)?.id || primaryAgent.id);
    thread.activeRunId = '';
    thread.activeSessionId = sessionId;
    thread.activeRunStartedAt = now();
    thread.activeRunAgentId = primaryAgent.id;
    thread.activeRunMentionedAgentId = explicitlyMentionedPrimaryAgent || req.body?.sourceAgentId ? primaryAgent.id : '';
    thread.activeRunRouteReason = routeReason;
    thread.activeRunMentionDepth = Number(req.body?.mentionDepth || 0);
    thread.activeRunParentMessageId = String(req.body?.parentMessageId || '');
    thread.activeRunSourceAgentId = String(req.body?.sourceAgentId || '');
    thread.activeRunTurnId = turnId;
    thread.activeRunGroup = {
      turnId,
      maxMentionDepth: configuredDepth,
      depth: Math.max(Number(existingRunGroup?.depth || 0), Number(req.body?.mentionDepth || 0)),
      routedEdges: [...routedEdges],
      routes: Array.isArray(existingRunGroup?.routes) ? existingRunGroup.routes : [],
      activeRuns: { ...(existingRunGroup?.activeRuns || {}), [runDiagnosticId]: { runId: '', sessionId, agentId: primaryAgent.id, agentName: primaryAgent.name, mentionDepth: Number(req.body?.mentionDepth || 0), parentMessageId: String(req.body?.parentMessageId || ''), status: 'starting' } },
      totalRoutedRuns: Number(existingRunGroup?.totalRoutedRuns || 0) + 1,
      status: 'running',
      startedAt: existingRunGroup?.startedAt || now(),
      updatedAt: now(),
    };
    thread.runtime = 'hermes-bridge';
    thread.profileName = profileName;
    thread.bridgeEndpoint = bridge.endpoint;
    thread.updatedAt = now();
    const preparedThread = await updateState(async (latestState) => {
      const currentThread = latestState.threads.find((item) => item.id === req.params.id);
      if (!currentThread) throw Object.assign(new Error('会话不存在。'), { status: 404 });
      if (currentThread.runStatus === 'running' && currentThread.activeRunTurnId !== turnId) {
        throw Object.assign(new Error('当前对话已有任务正在运行。'), { status: 409, code: 'THREAD_RUN_ACTIVE' });
      }
      Object.assign(currentThread, {
        messages: thread.messages,
        collaborationMode: thread.collaborationMode,
        activePlanId: thread.activePlanId,
        planSessions: thread.planSessions,
        agentRunOverrides: thread.agentRunOverrides,
        collaboration: thread.collaboration,
        selectedAgents: thread.selectedAgents,
        agentSessionIds: thread.agentSessionIds,
        externalSessionId: thread.externalSessionId,
        runStatus: thread.runStatus,
        workflowState: thread.workflowState,
        workflow: thread.workflow,
        activeRunId: thread.activeRunId,
        activeSessionId: thread.activeSessionId,
        activeRunStartedAt: thread.activeRunStartedAt,
        activeRunAgentId: thread.activeRunAgentId,
        activeRunMentionedAgentId: thread.activeRunMentionedAgentId,
        activeRunRouteReason: thread.activeRunRouteReason,
        activeRunMentionDepth: thread.activeRunMentionDepth,
        activeRunParentMessageId: thread.activeRunParentMessageId,
        activeRunSourceAgentId: thread.activeRunSourceAgentId,
        activeRunTurnId: thread.activeRunTurnId,
        activeRunGroup: thread.activeRunGroup,
        runtime: thread.runtime,
        profileName: thread.profileName,
        bridgeEndpoint: thread.bridgeEndpoint,
        updatedAt: thread.updatedAt,
      });
      appendModelRunDiagnostic(latestState, createModelRunDiagnostic({
        id: runDiagnosticId,
        createdAt: currentThread.activeRunStartedAt,
        thread: currentThread,
        agent: primaryAgent,
        profileName,
        runModel,
        runCapability,
        runMapping,
      }));
      return currentThread;
    });

    const bridgeAttachments = await Promise.all(attachmentMetadata.map(async (metadata) => {
      const { filePath } = await attachmentStore.content(metadata.id);
      return { id: metadata.id, name: metadata.name, mime_type: metadata.mimeType, size: metadata.size, kind: metadata.kind, path: filePath };
    }));
    const runtimeMessage = `${agentIdentityRunInstruction(primaryAgent, state.agents)}\n\n${planExecution ? approvedPlanExecutionInstruction(planExecution, planExecutionDraft) : collaborationRunInstruction(preparedThread, primaryAgent)}\n\n${planExecution ? '已批准计划执行上下文' : '用户或群聊消息'}：\n${routingMessage}`;
    const started = await requestHermesBridge({
      action: 'chat',
      session_id: sessionId,
      message: runtimeMessage,
      storage_message: planExecution || req.body?.suppressUserMessage ? '' : hermesStoredMessageContent(message, bridgeAttachments),
      attachments: bridgeAttachments,
      conversation_history: await threadHistoryForHermes({
        ...preparedThread,
        messages: relayMessage || planExecution || req.body?.suppressUserMessage
          ? preparedThread.messages
          : (preparedThread.messages || []).slice(0, -1),
      }, primaryAgent),
      profile: profileName,
      model: runModel.model || undefined,
      provider: runModel.provider || undefined,
      runtime_revision: runModel.modelProfile?.runtimeRevision || undefined,
      runtime_overrides: { ...runMapping.runtimeOverrides, rich_tool_descriptions: state.ui?.richToolDescriptions !== false, ...(draftingPlan ? { plan_mode: true } : {}) },
      instructions: [richContentRunInstruction(), draftingPlan ? planRunInstruction(preparedThread, primaryAgent) : '', planExecution ? approvedPlanExecutionInstruction(planExecution, planExecutionDraft) : ''].filter(Boolean).join('\n\n'),
      source: 'frakio-workbench',
    }, {
      // Cold-starting the bundled Python/Hermes worker can exceed 30s on Windows,
      // especially on ARM machines running the x64 runtime under emulation.
      timeoutMs: 120000,
      retryMs: 5000,
    });
    const sentAt = now();
    const hermesProfileSnapshot = agentProfileSnapshot(primaryAgent);
    const hermesRuntimeSession = runtimeStore.upsertSession({
      runtimeId: 'hermes',
      threadId: thread.id,
      agentId: primaryAgent.id,
      workspaceId: thread.workspaceId || '',
      nativeSessionId: started.session_id || sessionId,
      profileRevision: hermesProfileSnapshot.revision,
      status: 'active',
      metadata: { profileName },
    });
    if (!runtimeStore.getRun(started.run_id)) {
      runtimeStore.createRun({
        id: started.run_id,
        sessionId: hermesRuntimeSession.id,
        runtimeId: 'hermes',
        threadId: thread.id,
        agentId: primaryAgent.id,
        turnId,
        profileRevision: hermesProfileSnapshot.revision,
        modelId: runModel.model || '',
        status: 'running',
        metadata: { profileName },
      });
      runtimeStore.appendEvent({ runId: started.run_id, type: 'run.started', payload: { turnId, agentId: primaryAgent.id, profileName } });
    }
    await updateState(async (stateAfterStart) => {
      const threadAfterStart = stateAfterStart.threads.find((item) => item.id === req.params.id);
      updateModelRunDiagnostic(stateAfterStart, { diagnosticId: runDiagnosticId }, (record) => markModelRunSent(record, started.run_id, sentAt));
      if (!threadAfterStart) return;
      threadAfterStart.activeRunId = started.run_id;
      threadAfterStart.activeSessionId = started.session_id || sessionId;
      threadAfterStart.activeRunAgentId = primaryAgent.id;
      threadAfterStart.activeRunMentionedAgentId = explicitlyMentionedPrimaryAgent || req.body?.sourceAgentId ? primaryAgent.id : '';
      threadAfterStart.activeRunRouteReason = routeReason;
      threadAfterStart.activeRunMentionDepth = Number(req.body?.mentionDepth || 0);
      threadAfterStart.activeRunParentMessageId = String(req.body?.parentMessageId || '');
      threadAfterStart.activeRunTurnId = turnId;
      threadAfterStart.activeRuntimeId = 'hermes';
      threadAfterStart.runtimeId = 'hermes';
      threadAfterStart.agentSessionIds = { ...(threadAfterStart.agentSessionIds || {}), [primaryAgent.id]: started.session_id || sessionId };
      threadAfterStart.runtimeSessionIds = { ...(threadAfterStart.runtimeSessionIds || {}), [`${primaryAgent.id}:hermes`]: hermesRuntimeSession.id };
      const startedPlan = draftingPlan
        ? (threadAfterStart.planSessions || []).find((item) => item.id === draftingPlan.id)
        : planExecution
          ? (threadAfterStart.planSessions || []).find((item) => item.id === planExecution.id)
          : null;
      if (startedPlan) {
        if (draftingPlan) startedPlan.sourceRunId = started.run_id;
        if (planExecution) {
          startedPlan.executionRunId = started.run_id;
          startedPlan.status = 'executing';
        }
        startedPlan.error = '';
        startedPlan.updatedAt = sentAt;
      }
      if (workReplan) {
        const activeWorkflow = workflowById(threadAfterStart);
        if (activeWorkflow?.interventionQueue?.length) {
          activeWorkflow.interventionQueue = activeWorkflow.interventionQueue.map((entry, index, all) => index === all.length - 1 && entry.status === 'pending'
            ? { ...entry, status: 'delivered', deliveredAt: sentAt, sessionId: started.session_id || sessionId }
            : entry);
        }
      }
      if (threadAfterStart.activeRunGroup?.turnId === turnId) {
        const activeRuns = { ...(threadAfterStart.activeRunGroup.activeRuns || {}) };
        delete activeRuns[runDiagnosticId];
        activeRuns[started.run_id] = { runId: started.run_id, sessionId: started.session_id || sessionId, agentId: primaryAgent.id, agentName: primaryAgent.name, mentionDepth: Number(req.body?.mentionDepth || 0), parentMessageId: String(req.body?.parentMessageId || ''), status: 'running' };
        threadAfterStart.activeRunGroup = { ...threadAfterStart.activeRunGroup, activeRuns, status: 'running', updatedAt: sentAt };
      }
      threadAfterStart.updatedAt = sentAt;
    });
    captureTelemetry('agent_run_started', {
      agent_count: selectedAgentIds.length,
      attachment_count: attachmentMetadata.length,
      permission_mode: thread.permissionMode || req.body?.permissionMode || 'smart',
      route_reason: routeReason,
    });
    captureMeaningfulActivity('agent_run_started');
    const responsePayload = {
      runId: started.run_id,
      sessionId: started.session_id || sessionId,
      status: started.status || 'started',
      runtime: 'hermes-bridge',
      profileName,
      model: runModel.model,
      provider: runModel.provider,
      modelSource: runModel.source,
      requestedReasoning: runMapping.requestedReasoning,
      effectiveReasoning: runMapping.effectiveReasoning,
      requestedServiceTier: runMapping.requestedServiceTier,
      effectiveServiceTier: runMapping.effectiveServiceTier,
      reasoningEffort: runMapping.effectiveReasoning,
      speedMode: runMapping.effectiveServiceTier,
      capabilitySource: runCapability?.source || 'profile',
      bridge,
      turnId,
      agentId: primaryAgent.id,
      agentName: primaryAgent.name,
      mentionDepth: Number(req.body?.mentionDepth || 0),
      parentMessageId: String(req.body?.parentMessageId || ''),
      kind: draftingPlan ? 'plan-drafting' : planExecution ? 'plan-chat-execution' : thread.executionMode === 'work' ? (workReplan ? 'work-replan' : 'work-root') : 'chat',
      planId: draftingPlan?.id || planExecution?.id || '',
      workflowId: thread.executionMode === 'work' ? workflowById(thread)?.id || '' : '',
      rootTaskId: workRoot?.id || '',
    };
    res.status(202).json(responsePayload);
    emitHermesTurnEvent(req.params.id, turnId, {
      event: 'run.started',
      runId: responsePayload.runId,
      sessionId: responsePayload.sessionId,
      agentId: primaryAgent.id,
      agentName: primaryAgent.name,
      mentionDepth: responsePayload.mentionDepth,
      parentMessageId: responsePayload.parentMessageId,
      routeReason,
    });
    if (!req.body?._deferConsumer) {
      ensureHermesRunConsumer({
        threadId: req.params.id,
        turnId,
        runId: responsePayload.runId,
        sessionId: responsePayload.sessionId,
        agentId: primaryAgent.id,
        agentName: primaryAgent.name,
        mentionDepth: responsePayload.mentionDepth,
        parentMessageId: responsePayload.parentMessageId,
      });
    }
  } catch (error) {
    const details = { ...hermesRuntimeErrorDetails(error, error.details?.profileName || runProfileName), ...(error.details || {}) };
    const enriched = enrichMissingExecutableError(error.message || 'Hermes Bridge run 创建失败。', details.profileName || runProfileName);
    try {
      await updateState(async (state) => {
        const thread = state.threads.find((item) => item.id === req.params.id);
        finishStoredModelRun(state, { diagnosticId: runDiagnosticId, threadId: req.params.id, status: 'failed', error: enriched });
        if (thread?.runStatus !== 'running' || thread.activeRunTurnId !== runTurnId) return;
        const failedPlan = requestedPlanRunId
          ? (thread.planSessions || []).find((plan) => plan.id === requestedPlanRunId)
          : thread.collaborationMode === 'plan' ? activePlanSession(thread) : null;
        if (failedPlan && !['cancelled', 'completed', 'waiting_approval'].includes(failedPlan.status)) {
          failedPlan.status = 'failed';
          failedPlan.error = enriched.slice(0, 1000);
          failedPlan.updatedAt = now();
        }
        thread.runStatus = 'failed';
        finishActiveRunGroupChild(thread, runDiagnosticId, 'failed');
        clearHermesRunState(thread);
        thread.workflowState = mergeWorkflowStep(closeOpenWorkflowSteps(thread.workflowState || [], 'failed'), { title: 'Hermes Agent 启动失败', status: 'failed', source: 'run', detail: enriched.slice(0, 200), updatedAt: now() });
        thread.workflow = thread.workflowState.map((step) => step.title);
        thread.updatedAt = now();
      });
    } catch {}
    captureTelemetry('agent_run_failed', { stage: 'startup', error_code: telemetryErrorCode(error) });
    res.status(error.status || 500).json({ error: enriched, code: error.code || details.errorType || '', details });
  }
}

app.post('/api/threads/:id/runs', startRuntimeRunRequest);

function streamHermesTurnEvents(req, res, { turnId, runId = '' }) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  const runtime = turnRuntime(req.params.id, turnId);
  const requestedCursor = Math.max(0, Number(req.query.cursor || req.headers['last-event-id'] || 0) || 0);
  const matches = (event) => !runId || event.runId === runId || event.event.startsWith('turn.');
  const send = (event) => {
    if (!matches(event) || res.writableEnded) return;
    res.write(`id: ${event.cursor}\ndata: ${JSON.stringify(event)}\n\n`);
    if ((event.event === 'turn.completed' || event.event === 'turn.failed' || event.event === 'turn.cancelled')
      || (runId && ['run.completed', 'run.failed', 'run.cancelled'].includes(event.event) && event.runId === runId)) {
      res.end();
    }
  };
  for (const event of runtime.events) {
    if (event.cursor > requestedCursor) send(event);
    if (res.writableEnded) return;
  }
  if (runtime.completed) {
    res.end();
    return;
  }
  runtime.subscribers.add(send);
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': keepalive\n\n');
  }, 15000);
  req.on('close', () => {
    clearInterval(heartbeat);
    runtime.subscribers.delete(send);
  });
}

app.get('/api/threads/:id/turns/:turnId/events', async (req, res) => {
  const state = await readState();
  const thread = state.threads.find((item) => item.id === req.params.id);
  if (!thread) return res.status(404).json({ error: '会话不存在。' });
  if (thread.activeRunGroup?.turnId !== req.params.turnId && !hermesTurnRuntime.has(`${req.params.id}:${req.params.turnId}`)) {
    return res.status(404).json({ error: '运行轮次不存在。' });
  }
  return streamHermesTurnEvents(req, res, { turnId: req.params.turnId });
});

app.get('/api/threads/:id/runs/:runId/events', async (req, res) => {
  const state = await readState();
  const thread = state.threads.find((item) => item.id === req.params.id);
  if (!thread) return res.status(404).json({ error: '会话不存在。' });
  const turnId = thread.activeRunGroup?.turnId || thread.activeRunTurnId || req.params.runId;
  return streamHermesTurnEvents(req, res, { turnId, runId: req.params.runId });
});

app.post('/api/threads/:id/runs/:runId/approval', async (req, res) => {
  try {
    const approvalId = String(req.body?.approvalId || req.body?.id || req.params.runId);
    if (!approvalId || approvalId === req.params.runId) return res.status(400).json({ error: '这次审批缺少 approval_id，请重新发起任务。' });
    const result = await requestHermesBridge({
      action: 'approval_respond',
      approval_id: approvalId,
      choice: req.body?.choice || 'deny',
      session_id: req.body?.sessionId || req.query.sessionId || '',
      run_id: req.params.runId,
    }, { timeoutMs: 10000, retryMs: 1000 });
    if (result?.resolved === false) return res.status(409).json({ error: '这次审批已失效，请重新发起任务。', ...result });
    res.json({ ok: true, approvalId, choice: req.body?.choice || 'deny', ...result });
  } catch (error) {
    res.status(502).json({ error: formatApprovalError(error.message || '审批响应失败。') });
  }
});

function formatApprovalError(message) {
  const text = String(message || '').trim();
  if (/approval_id is required|missing approval/i.test(text)) return '这次审批缺少 approval_id，请重新发起任务。';
  if (/unknown approval|not found|expired|timeout/i.test(text)) return '这次审批已失效，请重新发起任务。';
  if (/unknown action/i.test(text)) return '本机 Hermes Bridge 不支持当前审批协议，请重启 Bridge 后重试。';
  return text || '审批响应失败。';
}

const clarifySkipResponse = '[user skipped this clarification; do not assume an answer and do not ask the same question again in this run. Continue only with a safe reversible default. If the missing answer is required, leave that operation unperformed and explain what remains undecided in the final response.]';

app.post('/api/threads/:id/runs/:runId/clarify', async (req, res) => {
  try {
    const clarifyId = String(req.body?.clarifyId || req.body?.clarify_id || '').trim();
    const action = String(req.body?.action || 'answer').trim().toLowerCase();
    const answer = String(req.body?.response || '').trim();
    if (!clarifyId) return res.status(400).json({ error: '这次提问缺少 clarify_id，请重新发起任务。' });
    if (!['answer', 'skip'].includes(action)) return res.status(400).json({ error: '不支持的提问响应。' });
    if (action === 'answer' && !answer) return res.status(400).json({ error: '请输入回答。' });
    const result = await requestHermesBridge({
      action: 'clarify_respond',
      clarify_id: clarifyId,
      response: action === 'skip' ? clarifySkipResponse : answer,
      session_id: req.body?.sessionId || req.query.sessionId || '',
      run_id: req.params.runId,
    }, { timeoutMs: 10000, retryMs: 1000 });
    if (result?.resolved === false) return res.status(409).json({ error: '这次提问已失效，请重新发起任务。', ...result });
    await mergeHermesWorkflowEvent(req.params.id, { event: 'clarify.responded', clarifyId, skipped: action === 'skip' });
    res.json({ ok: true, clarifyId, action, resolved: true });
  } catch (error) {
    res.status(502).json({ error: formatClarifyError(error.message || '提问响应失败。') });
  }
});

function formatClarifyError(message) {
  const text = String(message || '').trim();
  if (/clarify_id is required|missing clarify/i.test(text)) return '这次提问缺少 clarify_id，请重新发起任务。';
  if (/unknown clarify|not found|expired|timeout/i.test(text)) return '这次提问已失效，请重新发起任务。';
  if (/unknown action/i.test(text)) return '本机 Hermes Bridge 不支持当前提问协议，请重启 Bridge 后重试。';
  return text || '提问响应失败。';
}

app.post('/api/threads/:id/runs/:runId/stop', async (req, res) => {
  try {
    const storedRuntimeRun = runtimeStore.getRun(req.params.runId);
    if (storedRuntimeRun && ['pi', 'codex', 'claude', 'gemini'].includes(storedRuntimeRun.runtimeId)) {
      const runtimeSession = runtimeStore.getSession(storedRuntimeRun.sessionId);
      if (!runtimeSession || !['starting', 'running', 'waiting_approval'].includes(storedRuntimeRun.status)) {
        return res.status(409).json({ error: '这次运行已经结束或无法停止', resolved: false });
      }
      if (storedRuntimeRun.runtimeId === 'pi') await piBridge.cancel(runtimeSession.id);
      else if (storedRuntimeRun.runtimeId === 'codex') await codexBridge.cancel(runtimeSession.id);
      else if (storedRuntimeRun.runtimeId === 'claude') await claudeBridge.cancel(runtimeSession.id);
      else await geminiBridge.cancel(runtimeSession.id);
      return res.json({ ok: true, resolved: true, stoppedRuns: 1, turnId: storedRuntimeRun.turnId });
    }
    const state = await readState();
    const thread = state.threads.find((item) => item.id === req.params.id);
    if (!thread) return res.status(404).json({ error: '对话不存在。', resolved: false });
    const groupRuns = Object.values(thread.activeRunGroup?.activeRuns || {});
    const requestedRun = groupRuns.find((run) => String(run.runId) === String(req.params.runId));
    if ((!thread.activeRunId || String(thread.activeRunId) !== String(req.params.runId)) && !requestedRun) {
      return res.status(409).json({ error: '这次运行已经结束或无法停止', resolved: false });
    }
    const runsToStop = req.body?.childOnly
      ? [requestedRun || { runId: req.params.runId, sessionId: req.body?.sessionId || req.query.sessionId || thread.activeSessionId }]
      : (groupRuns.length ? groupRuns : [{ runId: req.params.runId, sessionId: req.body?.sessionId || req.query.sessionId || thread.activeSessionId }]);
    const results = await Promise.allSettled(runsToStop.map((run) => requestHermesBridge({ action: 'interrupt', session_id: String(run.sessionId || ''), run_id: run.runId || undefined, message: '用户请求停止。' }, { timeoutMs: 10000, retryMs: 1000 })));
    const stopped = results.filter((result) => result.status === 'fulfilled' && result.value?.resolved !== false).length;
    if (!stopped) return res.status(409).json({ error: '这次运行已经结束或无法停止', resolved: false });
    captureTelemetry('agent_run_stopped', { duration_bucket: telemetryDurationBucket(thread.activeRunStartedAt) });
    res.json({ ok: true, resolved: true, stoppedRuns: stopped, turnId: thread.activeRunGroup?.turnId || '' });
  } catch (error) {
    const message = String(error?.message || '').trim();
    const expired = /unknown run|not found|expired|already (?:ended|finished)|not running|no active/i.test(message);
    res.status(expired ? 409 : 502).json({ error: expired ? '这次运行已经结束或无法停止' : message || '停止运行失败，请重试。', resolved: false });
  }
});

app.post('/api/council/send', async (req, res) => {
  const state = await readState();
  const thread = state.threads.find((item) => item.id === req.body?.threadId) || state.threads[0];
  if (thread) {
    const message = String(req.body?.message || '').trim();
    const taskType = detectTaskType(message);
    const runSteps = taskStepsForMessage(taskType, message, 'running');
    thread.runStatus = 'running';
    thread.workflow = runSteps.map((step) => step.title);
    thread.workflowState = runSteps;
    await writeState(state);
  }

  return runAgentRoomChat(req, res);
});

function artifactsFromThreadOutputs(taskType, proposals, thread) {
  const base = [
    {
      id: id('artifact'),
      name: thread?.mode === 'direct' ? '临时对话记录' : '任务报告',
      kind: thread?.mode === 'direct' ? 'conversation' : 'report',
      target: thread?.mode === 'direct' ? '未绑定 Workspace Root' : thread?.title || '当前对话',
      updatedAt: now(),
    },
  ];
  for (const proposal of proposals || []) {
    base.push({
      id: proposal.id || id('artifact'),
      name: proposal.title,
      kind: proposal.type || taskType,
      target: proposal.target || '当前 Workspace',
      updatedAt: now(),
    });
  }
  return base;
}

function buildAgentReply(agentId, message, taskType, summary) {
  const productHint = summary?.products?.find((product) => message.includes(product.slice(0, 3))) || summary?.products?.[0];
  const vaultLine = summary ? `当前资料库已学习 ${summary.documentCount} 个 Markdown、${summary.products.length} 个产品文档。` : '当前未连接资料库，我只基于会话上下文工作。';
  if (agentId === 'iris') return `已把需求整理成 ${taskTypeName(taskType)}。${vaultLine}`;
  if (agentId === 'max') return `本轮继续遵守低实体原则。${productHint ? `建议从 ${productHint} 开始跑一条可审核链路。` : '先把目标拆成可确认的下一步。'}`;
  if (agentId === 'nora') return summary ? `我会先看产品事实和用户场景。当前产品文档数量：${summary.products.length}。` : '我可以先做普通商业判断；连接资料库后再引用产品事实。';
  if (agentId === 'kai') return '我负责把商业判断转成 SEO、内容角度、标题结构和 CTA。';
  if (agentId === 'leo') return '我只在看到产品原素材和文章 brief 后进入配图。第一版先产出图片/视频 brief。';
  if (agentId === 'victor') return '我负责技术闸门。涉及 Obsidian 写入或 Shopify 发布都必须进入确认队列。';
  return '收到，我会按当前 Workspace 上下文参与。';
}

function taskTypeName(_taskType) {
  return '综合运营任务';
}

function compressContext(message, messages, summary, selectedAgents) {
  return {
    title: '交给新加入 Agent 的上下文包',
    conversation: {
      userIntent: message.slice(0, 220),
      activeAgents: selectedAgents,
      currentConclusion: messages.map((event) => `${event.agentName}: ${event.content}`).join('\n').slice(-1000),
    },
    vault: summary
      ? {
          connected: true,
          documentCount: summary.documentCount,
          products: summary.products.slice(0, 8),
          activeRules: summary.highSignal.slice(0, 5).map((doc) => doc.relativePath),
        }
      : { connected: false, activeRules: [] },
    policy: '新 Agent 加入时默认收到压缩会话上下文和仓库上下文，不回放完整聊天。',
  };
}

if ((isDesktopMode || isManagedWebMode) && existsSync(webDistPath)) {
  app.use(express.static(webDistPath));
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(webDistPath, 'index.html'));
  });
}

let appInitialized = false;
let httpServer = null;
let releaseManagedServiceLock = null;

export async function createApp() {
  if (appInitialized) return app;
  if (isManagedWebMode && !releaseManagedServiceLock) {
    releaseManagedServiceLock = await acquireManagedServiceLock(frakioWorkHome);
  }
  await runModelScopeMigration().catch((error) => {
    console.warn('Model scope migration skipped:', error?.message || error);
  });
  await runPresetProviderCredentialMigration().catch((error) => {
    console.warn('Preset Provider credential migration skipped:', error?.message || error);
  });
  await runLegacyDemoDataCleanupMigration().catch((error) => {
    console.warn('Legacy demo data cleanup skipped:', error?.message || error);
  });
  const startupState = await readState();
  runtimeStore.migrateHermesSessions(startupState.threads || []);
  await recoverWorkflowControls(startupState).catch((error) => {
    console.warn('Workflow control recovery skipped:', error?.message || error);
  });
  const initialTelemetryState = await readState();
  await telemetry.initialize();
  const authInitialization = await managedWebAuth.initialize();
  if (authInitialization.generatedAdminPassword) {
    console.log(`Frakio Work managed Web administrator password: ${authInitialization.generatedAdminPassword}`);
  }
  await telemetry.setEnabled(initialTelemetryState.ui?.telemetryEnabled === true && Boolean(initialTelemetryState.ui?.telemetryNoticeSeenAt));
  appInitialized = true;
  return app;
}

export async function startServer() {
  if (httpServer) return httpServer;
  const readyApp = await createApp();
  const bindHost = isManagedWebMode ? String(process.env.FRAKIO_WORK_BIND_HOST || '0.0.0.0') : '127.0.0.1';
  const appVersion = await readFrakioPackageVersion();
  const scheme = tlsEnabled ? 'https' : 'http';
  const onListening = () => {
    console.log(`Frakio Work API listening on ${scheme}://${bindHost}:${port}`);
    if (isManagedWebMode) {
      const loopbackUrl = String(process.env.FRAKIO_WORK_TLS_LOOPBACK_URL || '').trim()
        || `${scheme}://${tlsEnabled ? 'localhost' : '127.0.0.1'}:${port}`;
      void writeServiceDescriptor(frakioWorkHome, {
        deploymentMode: 'managed-web',
        appVersion,
        apiProtocol: FRAKIO_SERVICE_PROTOCOL,
        pid: process.pid,
        port,
        bindHost,
        loopbackUrl,
        startedAt: new Date().toISOString(),
      }).catch((error) => console.warn('Unable to write managed service descriptor:', error?.message || error));
    }
    const launchId = String(process.env.FRAKIO_WORK_LAUNCH_ID || '').trim();
    if (launchId) {
      captureTelemetry('app_opened', { startup_ms: Math.max(0, Date.now() - Number(process.env.FRAKIO_WORK_LAUNCH_STARTED_AT || Date.now())) }, { dedupeKey: `launch_${launchId}` });
    }
    if (process.env.FRAKIO_WORK_DISABLE_AUTOSTART !== '1') setTimeout(() => {
      ensureHermesRuntimeReady().then(async (result) => {
        if (result.status === 'failed') throw new Error(result.error || 'Hermes Runtime startup verification failed.');
        await completePendingHermes019Upgrade();
      }).catch(async (error) => {
        const restored = await rollbackPendingHermes019Upgrade(error).catch(() => null);
        if (restored) {
          hermesAutoStartState = restored;
          console.warn(`Hermes 0.19 startup verification failed; restored Runtime ${readRuntimeRegistrySync().activeVersion || 'previous'}.`);
          return;
        }
        hermesAutoStartState.status = 'failed';
        hermesAutoStartState.error = String(error?.message || error);
        hermesAutoStartState.finishedAt = now();
        console.warn('Hermes runtime auto-start failed:', error?.message || error);
      });
    }, 100);
    setTimeout(() => void refreshStaleProviderCatalogs().catch(() => {}), 400);
  };
  if (tlsEnabled) {
    httpServer = createHttpsServer({
      cert: await readFile(tlsCertPath),
      key: await readFile(tlsKeyPath),
    }, readyApp).listen(port, bindHost, onListening);
  } else {
    httpServer = readyApp.listen(port, bindHost, onListening);
  }
  return httpServer;
}

export async function closeRuntimeServices() {
  await Promise.all([piBridge.close(), codexBridge.close(), claudeBridge.close(), geminiBridge.close()]);
}

let telemetryShutdownStarted = false;
async function stopOwnedChild(child, label) {
  if (!child || child.exitCode !== null) return;
  console.log(`Stopping ${label} pid=${child.pid || 'unknown'}`);
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 1400)),
  ]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 600))]);
  }
}

async function stopOwnedRuntimeProcesses() {
  const bridge = await probeHermesBridge({ timeoutMs: 500 }).catch(() => null);
  const ownedBridgePids = bridge?.ownedByThisApi ? collectBridgePids(bridge.ping || {}) : [];
  await Promise.all([
    stopOwnedChild(hermesApiProcess, 'Runtime API'),
    stopOwnedChild(hermesBridgeProcess, 'Hermes Bridge'),
    ...[...profileGatewayProcesses].map((child) => stopOwnedChild(child, 'Profile Gateway')),
  ]);
  if (ownedBridgePids.length) await terminatePids(ownedBridgePids, [], 'owned Hermes Bridge');
  hermesApiProcess = null;
  hermesBridgeProcess = null;
  profileGatewayProcesses.clear();
}

async function shutdownApi() {
  if (telemetryShutdownStarted) return;
  telemetryShutdownStarted = true;
  await Promise.all([
    stopOwnedRuntimeProcesses(),
    piBridge.close(),
    codexBridge.close(),
    claudeBridge.close(),
    geminiBridge.close(),
  ]).catch((error) => console.warn('Runtime shutdown warning:', error?.message || error));
  try { runtimeStore.close(); } catch {}
  await Promise.race([telemetry.shutdown(), new Promise((resolve) => setTimeout(resolve, 900))]);
  if (isManagedWebMode) {
    await removeServiceDescriptor(frakioWorkHome).catch(() => {});
    await releaseManagedServiceLock?.().catch(() => {});
    releaseManagedServiceLock = null;
  }
  if (httpServer) httpServer.close(() => process.exit(0));
  else process.exit(0);
  setTimeout(() => process.exit(0), 3000).unref();
}

const isMainModule = path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url);
if (isMainModule) {
  await startServer();
  process.once('SIGTERM', () => void shutdownApi());
  process.once('SIGINT', () => void shutdownApi());
}
