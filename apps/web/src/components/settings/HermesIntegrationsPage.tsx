// wjz新建文件，新建原因：解耦 Hermes 高级集成配置、多渠道网关、MCP 服务器与定时任务组件（HermesProfileConfigEditor, ChannelsPage, McpSettingsPage, JobsPage 等），修改时间：2026-08-17。
// 文件内容概述：Hermes 本地 Profile 高级配置、10 个即时通讯平台网关对接与扫码、MCP 工具管理与 Cron 定时任务治理。
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  Bot,
  Boxes,
  Building2,
  ChevronDown,
  FileText,
  LoaderCircle,
  MessageSquare,
  Network,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  X,
  Zap as ZapIcon,
} from 'lucide-react';
import {
  SettingsField,
  SettingsInlineNote,
  SettingsRow,
  SettingsSwitch,
} from '../../settings-ui';
import { requestJson } from '../../utils/api-client';
import { permissionLabel } from '../collaboration/PlanAndDecisionPanels';
import type {
  HermesConfig,
  HermesJob,
  HermesProfile,
  McpFormState,
  McpServer,
  McpServersPayload,
} from '../../types/workbench';

export const profileOptionFallback: HermesProfile[] = [
  { name: 'default', model: '', provider: '', hasConfig: true, hasEnv: false, hasAuth: false },
];

export function profileOptions(profiles: HermesProfile[]) {
  return profiles.length ? profiles : profileOptionFallback;
}

export const settingsTabs = [
  { id: 'proxy', label: '代理' },
  { id: 'agent', label: '代理执行' },
  { id: 'gateway', label: 'Gateway' },
  { id: 'memory', label: '记忆' },
  { id: 'compression', label: '上下文压缩' },
  { id: 'session', label: '会话' },
  { id: 'voice', label: '语音' },
];

export const settingFields: Record<
  string,
  Array<{
    section: string;
    key: string;
    label: string;
    type: 'toggle' | 'number' | 'text' | 'select' | 'csv';
    options?: string[];
    placeholder?: string;
  }>
> = {
  proxy: [
    { section: 'proxy', key: 'HTTPS_PROXY', label: 'HTTPS_PROXY', type: 'text', placeholder: 'http://127.0.0.1:7890' },
    { section: 'proxy', key: 'HTTP_PROXY', label: 'HTTP_PROXY', type: 'text' },
    { section: 'proxy', key: 'ALL_PROXY', label: 'ALL_PROXY', type: 'text' },
    { section: 'proxy', key: 'NO_PROXY', label: 'NO_PROXY', type: 'text', placeholder: 'localhost,127.0.0.1' },
  ],
  agent: [
    { section: 'agent', key: 'max_turns', label: '最大轮次', type: 'number' },
    { section: 'agent', key: 'gateway_timeout', label: '网关超时（秒）', type: 'number' },
    { section: 'agent', key: 'restart_drain_timeout', label: '重启排空超时（秒）', type: 'number' },
    { section: 'agent', key: 'tool_use_enforcement', label: '工具执行策略', type: 'select', options: ['auto', 'strict', 'off'] },
  ],
  gateway: [
    { section: 'gatewayAutoStart', key: 'enabled', label: 'Gateway 自动启动', type: 'toggle' },
    { section: 'gatewayAutoStart', key: 'management', label: '统一 Gateway', type: 'select', options: ['per_profile', 'unified'] },
    { section: 'gatewayAutoStart', key: 'include', label: '白名单 profiles', type: 'csv', placeholder: 'default, reviewer' },
    { section: 'gatewayAutoStart', key: 'exclude', label: '排除 profiles', type: 'csv', placeholder: 'default, reviewer' },
  ],
  memory: [
    { section: 'memory', key: 'memory_enabled', label: '启用记忆', type: 'toggle' },
    { section: 'memory', key: 'user_profile_enabled', label: '用户画像', type: 'toggle' },
    { section: 'memory', key: 'memory_char_limit', label: '记忆字符上限', type: 'number' },
    { section: 'memory', key: 'user_char_limit', label: '用户画像字符上限', type: 'number' },
    { section: 'memory', key: 'write_approval', label: '记忆写入审核', type: 'toggle' },
    { section: 'skills', key: 'write_approval', label: '技能写入审核', type: 'toggle' },
  ],
  compression: [
    { section: 'compression', key: 'enabled', label: '启用压缩', type: 'toggle' },
    { section: 'compression', key: 'threshold', label: '压缩阈值', type: 'number' },
    { section: 'compression', key: 'target_ratio', label: '目标比例', type: 'number' },
    { section: 'compression', key: 'protect_last_n', label: '保护最近消息', type: 'number' },
    { section: 'compression', key: 'protect_first_n', label: '保护开头消息', type: 'number' },
  ],
  session: [
    { section: 'approvals', key: 'mode', label: '操作权限', type: 'select', options: ['manual', 'smart', 'off'] },
    { section: 'session_reset', key: 'mode', label: '重置模式', type: 'select', options: ['off', 'idle', 'scheduled', 'idle+scheduled'] },
    { section: 'session_reset', key: 'idle_minutes', label: '空闲超时（分钟）', type: 'number' },
    { section: 'session_reset', key: 'at_hour', label: '定时重置时间', type: 'number' },
  ],
  voice: [
    { section: 'tts', key: 'provider', label: '当前 TTS API', type: 'select', options: ['edge', 'openai', 'elevenlabs', 'mistral', 'xai', 'neutts', 'piper'] },
    { section: 'tts', key: 'edge.voice', label: 'Edge TTS 音色', type: 'text', placeholder: 'zh-CN-XiaoxiaoNeural' },
    { section: 'stt', key: 'provider', label: '当前 STT API', type: 'select', options: ['local', 'browser', 'openai', 'mistral', 'elevenlabs'] },
  ],
};

function getNestedValue(source: Record<string, any>, keyPath: string) {
  return keyPath.split('.').reduce((value, key) => value?.[key], source);
}

function inputValue(value: unknown) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return '';
  return String(value);
}

function csvValue(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function setNestedDraft(source: Record<string, any>, keyPath: string, value: any) {
  const next = JSON.parse(JSON.stringify(source || {}));
  const parts = keyPath.split('.');
  let cursor = next;
  for (let index = 0; index < parts.length - 1; index += 1) {
    cursor[parts[index]] = cursor[parts[index]] || {};
    cursor = cursor[parts[index]];
  }
  cursor[parts[parts.length - 1]] = value;
  return next;
}

function cloneRecord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value || {}));
}

function sameJson(a: unknown, b: unknown) {
  return JSON.stringify(a || {}) === JSON.stringify(b || {});
}

export function HermesProfileConfigEditor({
  profileName,
  compact = false,
}: {
  profileName: string;
  compact?: boolean;
}) {
  const [activeTab, setActiveTab] = useState('agent_run');
  const [config, setConfig] = useState<HermesConfig>({});
  const [draft, setDraft] = useState<HermesConfig>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');

  async function loadConfig(nextProfile = profileName) {
    if (!nextProfile) return;
    setLoading(true);
    setError('');
    try {
      const data = await requestJson<HermesConfig>(
        `/api/hermes/config?profile=${encodeURIComponent(nextProfile)}`,
      );
      setConfig(data);
      setDraft(data);
    } catch (err: any) {
      setError(err.message || '配置读取失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setActiveTab('agent_run');
    setConfig({});
    setDraft({});
    setError('');
    setSaving('');
    void loadConfig(profileName);
  }, [profileName]);

  function fieldValue(section: string, key: string) {
    return getNestedValue(draft?.[section] || {}, key) ?? '';
  }

  function updateField(section: string, key: string, value: any) {
    setDraft((current) => ({
      ...current,
      [section]: setNestedDraft(current[section] || {}, key, value),
    }));
  }

  async function saveSection(section: string) {
    if (!profileName) return;
    setSaving(section);
    setError('');
    try {
      await requestJson(
        `/api/hermes/config?profile=${encodeURIComponent(profileName)}`,
        {
          method: 'PUT',
          body: JSON.stringify({ section, values: draft[section] || {} }),
        },
      );
      await loadConfig(profileName);
    } catch (err: any) {
      setError(err.message || '配置保存失败');
    } finally {
      setSaving('');
    }
  }

  const fields = settingFields[activeTab] || [];
  const sections = Array.from(new Set(fields.map((field) => field.section)));

  return (
    <section
      className={
        compact
          ? 'studio-settings-panel agent-config-editor compact'
          : 'studio-settings-panel agent-config-editor'
      }
    >
      <div className="studio-toolbar agent-config-toolbar">
        <div>
          <h3>Hermes Profile 配置</h3>
          <p>正在编辑：{profileName}</p>
        </div>
      </div>
      <div className="module-matrix-tabs">
        {settingsTabs.map((tab) => (
          <button
            className={activeTab === tab.id ? 'selected' : ''}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {error && <div className="form-error">{error}</div>}
      {loading ? (
        <div className="empty-state">读取 Hermes 配置中...</div>
      ) : (
        <div className="settings-option-list">
          {fields.map((field) => (
            <label
              className="settings-option-row"
              key={`${field.section}.${field.key}`}
            >
              <span>
                <strong>{field.label}</strong>
                <small>
                  {field.section}.{field.key}
                </small>
              </span>
              {field.type === 'toggle' ? (
                <SettingsSwitch
                  ariaLabel={field.label}
                  checked={Boolean(fieldValue(field.section, field.key))}
                  onChange={(checked) =>
                    updateField(field.section, field.key, checked)
                  }
                />
              ) : field.type === 'select' ? (
                <SettingsField>
                  <select
                    value={String(
                      fieldValue(field.section, field.key) ||
                        field.options?.[0] ||
                        '',
                    )}
                    onChange={(event) =>
                      updateField(field.section, field.key, event.target.value)
                    }
                  >
                    {(field.options || []).map((option) => (
                      <option key={option} value={option}>
                        {field.section === 'approvals' && field.key === 'mode'
                          ? permissionLabel(option)
                          : option}
                      </option>
                    ))}
                  </select>
                </SettingsField>
              ) : (
                <SettingsField>
                  <input
                    type={field.type === 'number' ? 'number' : 'text'}
                    step={
                      field.key.includes('ratio') ||
                      field.key.includes('threshold')
                        ? '0.1'
                        : '1'
                    }
                    value={inputValue(fieldValue(field.section, field.key))}
                    placeholder={field.placeholder}
                    onChange={(event) =>
                      updateField(
                        field.section,
                        field.key,
                        field.type === 'number'
                          ? Number(event.target.value)
                          : field.type === 'csv'
                            ? csvValue(event.target.value)
                            : event.target.value,
                      )
                    }
                  />
                </SettingsField>
              )}
            </label>
          ))}
          <div className="settings-save-row">
            {sections.map((section) => (
              <button
                className="secondary-btn"
                key={section}
                onClick={() => void saveSection(section)}
                disabled={Boolean(saving)}
              >
                {saving === section ? '保存中' : `保存 ${section}`}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export function HermesAdvancedProfileConfig({
  profiles,
  defaultProfileName,
}: {
  profiles: HermesProfile[];
  defaultProfileName: string;
}) {
  const options = profileOptions(profiles);
  const optionNames = options.map((profile) => profile.name);
  const initialProfileName = optionNames.includes(defaultProfileName)
    ? defaultProfileName
    : options[0]?.name || '';
  const [selectedProfileName, setSelectedProfileName] = useState(initialProfileName);

  useEffect(() => {
    const nextProfileName = optionNames.includes(defaultProfileName)
      ? defaultProfileName
      : options[0]?.name || '';
    setSelectedProfileName((current) =>
      optionNames.includes(current) && current === defaultProfileName
        ? current
        : nextProfileName,
    );
  }, [defaultProfileName, optionNames.join('|')]);

  return (
    <details className="hermes-advanced-profile-config">
      <summary>高级 Profile 配置</summary>
      <div className="hermes-advanced-profile-config-body">
        <SettingsInlineNote>
          这里用于兼容 Hermes 原生 CLI、Gateway 和外部会话。Frakio 对话的正式记忆、跨执行内核上下文压缩、会话状态和频道管理由 Frakio 控制。
        </SettingsInlineNote>
        <SettingsRow
          title="Hermes Profile"
          description="选择要查看或修改的本地 Hermes Profile 原生配置。"
        >
          <select
            value={selectedProfileName}
            onChange={(event) => setSelectedProfileName(event.target.value)}
            aria-label="选择 Hermes Profile"
          >
            {options.map((profile) => (
              <option key={profile.name} value={profile.name}>
                {profile.displayName || profile.name}
              </option>
            ))}
          </select>
        </SettingsRow>
        {selectedProfileName ? (
          <HermesProfileConfigEditor
            key={selectedProfileName}
            profileName={selectedProfileName}
          />
        ) : (
          <div className="empty-state">没有可用的 Hermes Profile。</div>
        )}
      </div>
    </details>
  );
}

export type PlatformField = {
  key: string;
  label: string;
  hint?: string;
  type?: 'toggle' | 'csv';
  credential?: boolean;
  secret?: boolean;
  placeholder?: string;
};

export type PlatformDefinition = {
  key: string;
  name: string;
  icon: React.ComponentType<{ size?: number }>;
  exclusive?: boolean;
  fields: PlatformField[];
};

export const exclusiveTokenHint =
  '此平台使用独占 token 锁。每个 profile 必须使用不同的身份 token，否则会与其他 profile 冲突导致 gateway 启动失败。';

export const platformDefinitions: PlatformDefinition[] = [
  {
    key: 'telegram',
    name: 'Telegram',
    icon: Send,
    exclusive: true,
    fields: [
      { key: 'token', label: 'Bot Token', hint: '开发者门户获取的 Bot Token', credential: true, placeholder: '123456:ABC-DEF...' },
      { key: 'proxy', label: '代理 URL', hint: '可选的平台专用代理，支持 http://、https:// 和 socks5://', credential: true, placeholder: 'socks5://127.0.0.1:7890' },
      { key: 'require_mention', label: '需要 @提及', hint: '群组中需要 @机器人 才会响应', type: 'toggle' },
      { key: 'reactions', label: '表情回应', hint: '对消息添加表情回应', type: 'toggle' },
      { key: 'free_response_chats', label: '自由响应聊天', hint: '不需要 @提及即响应的聊天 ID，逗号分隔', placeholder: 'chat_id1,chat_id2' },
      { key: 'mention_patterns', label: '自定义提及模式', hint: '额外的触发模式列表', type: 'csv', placeholder: 'pattern1, pattern2' },
    ],
  },
  {
    key: 'discord',
    name: 'Discord',
    icon: MessageSquare,
    exclusive: true,
    fields: [
      { key: 'token', label: 'Bot Token', hint: 'Discord Bot Token', credential: true, placeholder: 'Bot token...' },
      { key: 'proxy', label: '代理 URL', hint: '可选的平台专用代理', credential: true, placeholder: 'socks5://127.0.0.1:7890' },
      { key: 'require_mention', label: '需要 @提及', hint: '频道中需要提及机器人', type: 'toggle' },
      { key: 'auto_thread', label: '自动线程', hint: '自动把回复放入线程', type: 'toggle' },
      { key: 'reactions', label: '表情回应', hint: '对消息添加表情回应', type: 'toggle' },
      { key: 'free_response_channels', label: '自由响应频道', hint: '不需要提及即可响应的频道 ID', placeholder: 'channel_id1,channel_id2' },
      { key: 'allowed_channels', label: '允许频道', hint: '限制可响应频道', placeholder: 'channel_id1,channel_id2' },
      { key: 'ignored_channels', label: '忽略频道', hint: '忽略这些频道', placeholder: 'channel_id1,channel_id2' },
      { key: 'no_thread_channels', label: '禁用线程频道', hint: '这些频道不自动开线程', placeholder: 'channel_id1,channel_id2' },
    ],
  },
  {
    key: 'slack',
    name: 'Slack',
    icon: Network,
    exclusive: true,
    fields: [
      { key: 'token', label: 'Bot Token', hint: 'Slack Bot Token', credential: true, placeholder: 'xoxb-...' },
      { key: 'require_mention', label: '需要 @提及', hint: '频道中需要提及机器人', type: 'toggle' },
      { key: 'allow_bots', label: '允许机器人消息', hint: '允许响应机器人消息', type: 'toggle' },
      { key: 'free_response_channels', label: '自由响应频道', hint: '不需要提及即可响应的频道 ID', placeholder: 'channel_id1,channel_id2' },
    ],
  },
  {
    key: 'whatsapp',
    name: 'WhatsApp',
    icon: MessageSquare,
    exclusive: true,
    fields: [
      { key: 'enabled', label: '启用', hint: '启用 WhatsApp gateway', type: 'toggle', credential: true },
      { key: 'require_mention', label: '需要 @提及', hint: '群组中需要提及机器人', type: 'toggle' },
      { key: 'free_response_chats', label: '自由响应聊天', hint: '不需要提及即可响应的聊天 ID', placeholder: 'chat_id1,chat_id2' },
      { key: 'mention_patterns', label: '自定义提及模式', hint: '额外触发模式列表', type: 'csv', placeholder: 'pattern1, pattern2' },
    ],
  },
  {
    key: 'matrix',
    name: 'Matrix',
    icon: Boxes,
    fields: [
      { key: 'token', label: 'Access Token', hint: 'Matrix access token', credential: true, placeholder: 'syt_...' },
      { key: 'extra.homeserver', label: 'Homeserver', hint: 'Matrix homeserver 地址', credential: true, placeholder: 'https://matrix.org' },
      { key: 'extra.user_id', label: 'User ID', hint: 'Matrix 用户 ID', credential: true, placeholder: '@hermes:example.org' },
      { key: 'extra.password', label: 'Password', hint: '没有 token 时可使用密码登录', credential: true, secret: true, placeholder: 'Matrix password' },
      { key: 'proxy', label: '代理 URL', hint: '可选的平台专用代理', credential: true, placeholder: 'socks5://127.0.0.1:7890' },
      { key: 'require_mention', label: '需要 @提及', hint: '房间中需要提及机器人', type: 'toggle' },
      { key: 'auto_thread', label: '自动线程', hint: '自动创建线程', type: 'toggle' },
      { key: 'dm_mention_threads', label: '私信提及线程', hint: '私信提及时创建线程', type: 'toggle' },
      { key: 'free_response_rooms', label: '自由响应房间', hint: '不需要提及即可响应的房间 ID', placeholder: 'room_id1,room_id2' },
    ],
  },
  {
    key: 'feishu',
    name: 'Feishu',
    icon: FileText,
    exclusive: true,
    fields: [
      { key: 'extra.app_id', label: 'App ID', hint: '飞书应用 App ID', credential: true, placeholder: 'cli_...' },
      { key: 'extra.app_secret', label: 'App Secret', hint: '飞书应用密钥', credential: true, secret: true, placeholder: 'App Secret' },
      { key: 'extra.encrypt_key', label: 'Encrypt Key', hint: '事件订阅加密密钥', credential: true, secret: true, placeholder: 'Encrypt Key' },
      { key: 'extra.verification_token', label: 'Verification Token', hint: '事件订阅校验 token', credential: true, secret: true, placeholder: 'Verification Token' },
      { key: 'require_mention', label: '需要 @提及', hint: '群聊中需要提及机器人', type: 'toggle' },
      { key: 'free_response_chats', label: '自由响应聊天', hint: '不需要提及即可响应的聊天 ID', placeholder: 'chat_id1,chat_id2' },
    ],
  },
  {
    key: 'dingtalk',
    name: 'DingTalk',
    icon: ZapIcon,
    exclusive: true,
    fields: [
      { key: 'extra.client_id', label: 'Client ID', hint: '钉钉 Client ID', credential: true, placeholder: 'Client ID' },
      { key: 'extra.client_secret', label: 'Client Secret', hint: '钉钉 Client Secret', credential: true, secret: true, placeholder: 'Client Secret' },
      { key: 'extra.app_key', label: 'App Key', hint: '钉钉 App Key', credential: true, placeholder: 'App Key' },
      { key: 'extra.card_template_id', label: 'AI Card Template ID', hint: 'AI 卡片模板 ID', credential: true, placeholder: 'AI Card Template ID' },
      { key: 'allow_all_users', label: '允许所有用户', hint: '允许所有用户触发机器人', type: 'toggle', credential: true },
      { key: 'allowed_users', label: '允许用户', hint: '允许的用户 ID，逗号分隔', credential: true, placeholder: 'user_id1,user_id2' },
      { key: 'require_mention', label: '需要 @提及', hint: '群聊中需要提及机器人', type: 'toggle' },
      { key: 'free_response_chats', label: '自由响应聊天', hint: '不需要提及即可响应的聊天 ID', placeholder: 'chat_id1,chat_id2' },
    ],
  },
  {
    key: 'qqbot',
    name: 'QQBot',
    icon: Bot,
    exclusive: true,
    fields: [
      { key: 'extra.app_id', label: 'App ID', hint: 'QQ Bot App ID', credential: true, placeholder: 'App ID' },
      { key: 'extra.client_secret', label: 'App Secret', hint: 'QQ Bot App Secret', credential: true, secret: true, placeholder: 'App Secret' },
      { key: 'allowed_users', label: '允许用户', hint: '允许的 openid，逗号分隔', credential: true, placeholder: 'openid1,openid2' },
      { key: 'allow_all_users', label: '允许所有用户', hint: '允许所有用户触发机器人', type: 'toggle', credential: true },
      { key: 'extra.markdown_support', label: 'Markdown 支持', hint: '启用 QQ markdown 消息', type: 'toggle' },
    ],
  },
  {
    key: 'weixin',
    name: 'Weixin',
    icon: MessageSquare,
    exclusive: true,
    fields: [
      { key: 'token', label: 'Token', hint: '微信 iLink bot token', credential: true, secret: true, placeholder: 'Token' },
      { key: 'extra.account_id', label: 'Account ID', hint: '微信 iLink bot account ID', credential: true, placeholder: 'Account ID' },
      { key: 'extra.base_url', label: 'Base URL', hint: 'iLink API base URL', credential: true, placeholder: 'https://ilinkai.weixin.qq.com' },
    ],
  },
  {
    key: 'wecom',
    name: 'WeCom',
    icon: Building2,
    fields: [
      { key: 'extra.bot_id', label: 'Bot ID', hint: '企业微信 Bot ID', credential: true, placeholder: 'Bot ID' },
      { key: 'extra.secret', label: 'Secret', hint: '企业微信 Secret', credential: true, secret: true, placeholder: 'Secret' },
    ],
  },
];

function pickPlatformValues(
  current: Record<string, any>,
  fields: PlatformField[],
) {
  return fields.reduce((values, field) => {
    const value = getNestedValue(current, field.key);
    if (value !== undefined) return setNestedDraft(values, field.key, value);
    return values;
  }, {} as Record<string, any>);
}

function platformConfigured(
  platform: PlatformDefinition,
  credentials: Record<string, any>,
) {
  if (platform.key === 'matrix') {
    const extra = credentials.extra || {};
    const homeserver = String(extra.homeserver || '').trim();
    const token = String(credentials.token || '').trim();
    const userId = String(extra.user_id || '').trim();
    const password = String(extra.password || '').trim();
    return Boolean(homeserver && (token || (userId && password)));
  }
  const keys = [
    'token',
    'api_key',
    'app_id',
    'client_id',
    'secret',
    'app_secret',
    'client_secret',
    'access_token',
    'bot_id',
    'account_id',
    'enabled',
  ];
  const targets = [credentials, credentials.extra].filter(Boolean);
  return targets.some((target) =>
    keys.some((key) => {
      const value = target[key];
      return (
        value !== undefined &&
        value !== null &&
        value !== '' &&
        value !== false
      );
    }),
  );
}

function qrStatusLabel(status: WeixinQrStatus['status']) {
  if (status === 'loading') return '正在获取二维码...';
  if (status === 'waiting') return '请使用微信扫码登录。';
  if (status === 'scaned') return '已扫码，请在微信中确认登录。';
  if (status === 'expired') return '二维码已过期，请重新登录。';
  if (status === 'confirmed') return '已确认，正在保存凭据。';
  if (status === 'error') return '扫码登录失败。';
  return '';
}

export type WeixinQrStatus = {
  status:
    | 'idle'
    | 'loading'
    | 'waiting'
    | 'scaned'
    | 'scaned_but_redirect'
    | 'expired'
    | 'confirmed'
    | 'error';
  qrcode?: string;
  qrcodeUrl?: string;
  error?: string;
};

export function WeixinQrDialog({
  state,
  onClose,
  onRetry,
}: {
  state: WeixinQrStatus;
  onClose: () => void;
  onRetry: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="modal-backdrop weixin-qr-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal weixin-qr-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="weixin-qr-title"
      >
        <div className="modal-head">
          <div>
            <h2 id="weixin-qr-title">微信扫码登录</h2>
            <p>使用微信扫描二维码，为当前 Profile 连接 Weixin。</p>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>
        <div className="weixin-qr-modal-body">
          <div
            className={`weixin-qr-code ${state.qrcodeUrl ? '' : 'placeholder'}`}
          >
            {state.qrcodeUrl ? (
              <QRCodeSVG
                value={state.qrcodeUrl}
                size={232}
                level="M"
                marginSize={2}
                title="微信登录二维码"
              />
            ) : (
              <LoaderCircle className="spin" size={30} aria-hidden="true" />
            )}
          </div>
          <div
            className={`weixin-qr-status ${state.status === 'error' || state.status === 'expired' ? 'error' : ''}`}
            role="status"
          >
            {state.error || qrStatusLabel(state.status)}
          </div>
          {(state.status === 'expired' || state.status === 'error') && (
            <button
              type="button"
              className="send-btn"
              onClick={onRetry}
            >
              重新获取二维码
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ChannelsPage({
  profiles,
  defaultProfile,
  embedded = false,
}: {
  profiles: HermesProfile[];
  defaultProfile: string;
  embedded?: boolean;
}) {
  const [profile, setProfile] = useState(defaultProfile || 'default');
  const [config, setConfig] = useState<HermesConfig>({});
  const [configDrafts, setConfigDrafts] = useState<Record<string, Record<string, any>>>({});
  const [credentialDrafts, setCredentialDrafts] = useState<Record<string, Record<string, any>>>({});
  const [expandedPlatforms, setExpandedPlatforms] = useState<Record<string, boolean>>({});
  const [touchedConfig, setTouchedConfig] = useState<Record<string, boolean>>({});
  const [touchedCredentials, setTouchedCredentials] = useState<Record<string, boolean>>({});
  const [weixinQr, setWeixinQr] = useState<WeixinQrStatus>({ status: 'idle' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const weixinPollRef = useRef<number | null>(null);
  const weixinAttemptRef = useRef(0);

  const closeWeixinQrLogin = useCallback(() => {
    weixinAttemptRef.current += 1;
    if (weixinPollRef.current) window.clearTimeout(weixinPollRef.current);
    weixinPollRef.current = null;
    setWeixinQr({ status: 'idle' });
  }, []);

  async function loadChannels(nextProfile = profile) {
    setLoading(true);
    setError('');
    try {
      const data = await requestJson<HermesConfig>(
        `/api/hermes/config?profile=${encodeURIComponent(nextProfile)}`,
      );
      setConfig(data);
      setConfigDrafts(
        Object.fromEntries(
          platformDefinitions.map((platform) => [
            platform.key,
            pickPlatformValues(
              data.platforms?.[platform.key] || {},
              platform.fields.filter((field) => !field.credential),
            ),
          ]),
        ),
      );
      setCredentialDrafts(
        Object.fromEntries(
          platformDefinitions.map((platform) => [
            platform.key,
            pickPlatformValues(
              data.platforms?.[platform.key] || {},
              platform.fields.filter((field) => field.credential),
            ),
          ]),
        ),
      );
      setTouchedConfig({});
      setTouchedCredentials({});
      setExpandedPlatforms((current) =>
        Object.keys(current).length
          ? current
          : Object.fromEntries(
              platformDefinitions.map((platform) => [platform.key, true]),
            ),
      );
    } catch (err: any) {
      setError(err.message || '频道配置读取失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadChannels(profile);
  }, [profile]);

  useEffect(() => {
    closeWeixinQrLogin();
  }, [profile, closeWeixinQrLogin]);

  useEffect(() => {
    return () => {
      weixinAttemptRef.current += 1;
      if (weixinPollRef.current) window.clearTimeout(weixinPollRef.current);
    };
  }, []);

  function updateConfigDraft(platform: string, field: PlatformField, value: any) {
    setConfigDrafts((items) => ({
      ...items,
      [platform]: setNestedDraft(items[platform] || {}, field.key, value),
    }));
    setTouchedConfig((items) => ({ ...items, [platform]: true }));
  }

  function updateCredentialDraft(
    platform: string,
    field: PlatformField,
    value: any,
  ) {
    setCredentialDrafts((items) => ({
      ...items,
      [platform]: setNestedDraft(items[platform] || {}, field.key, value),
    }));
    setTouchedCredentials((items) => ({ ...items, [platform]: true }));
  }

  function hasConfigChanges(platform: PlatformDefinition) {
    const original = pickPlatformValues(
      config.platforms?.[platform.key] || {},
      platform.fields.filter((field) => !field.credential),
    );
    return (
      Boolean(touchedConfig[platform.key]) &&
      !sameJson(configDrafts[platform.key], original)
    );
  }

  function hasCredentialChanges(platform: PlatformDefinition) {
    const original = pickPlatformValues(
      config.platforms?.[platform.key] || {},
      platform.fields.filter((field) => field.credential),
    );
    return (
      Boolean(touchedCredentials[platform.key]) &&
      !sameJson(credentialDrafts[platform.key], original)
    );
  }

  async function savePlatform(platform: string) {
    setSaving(platform);
    setError('');
    try {
      const definition = platformDefinitions.find(
        (item) => item.key === platform,
      );
      if (!definition) return;
      if (hasConfigChanges(definition)) {
        await requestJson(
          `/api/hermes/config?profile=${encodeURIComponent(profile)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              section: platform,
              values: cloneRecord(configDrafts[platform] || {}),
            }),
          },
        );
      }
      if (hasCredentialChanges(definition)) {
        await requestJson(
          `/api/hermes/config/credentials?profile=${encodeURIComponent(profile)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              platform,
              values: cloneRecord(credentialDrafts[platform] || {}),
            }),
          },
        );
      }
      await loadChannels(profile);
    } catch (err: any) {
      setError(err.message || '频道配置保存失败');
    } finally {
      setSaving('');
    }
  }

  async function pollWeixinStatus(qrcode: string, attempt: number) {
    try {
      const data = await requestJson<{
        status: WeixinQrStatus['status'] | 'wait';
        account_id?: string;
        token?: string;
        base_url?: string;
      }>(
        `/api/hermes/weixin/qrcode/status?qrcode=${encodeURIComponent(qrcode)}`,
      );
      if (attempt !== weixinAttemptRef.current) return;
      if (data.status === 'confirmed' && data.account_id && data.token) {
        setWeixinQr((current) => ({
          ...current,
          status: 'confirmed',
          qrcode,
        }));
        await requestJson(
          `/api/hermes/weixin/save?profile=${encodeURIComponent(profile)}`,
          {
            method: 'POST',
            body: JSON.stringify({
              account_id: data.account_id,
              token: data.token,
              base_url: data.base_url,
            }),
          },
        );
        if (attempt !== weixinAttemptRef.current) return;
        await loadChannels(profile);
        if (attempt === weixinAttemptRef.current) closeWeixinQrLogin();
        return;
      }
      if (data.status === 'expired') {
        setWeixinQr((current) => ({ ...current, status: 'expired', qrcode }));
        return;
      }
      const nextStatus =
        data.status === 'wait'
          ? 'waiting'
          : data.status === 'scaned_but_redirect'
            ? 'scaned'
            : data.status;
      setWeixinQr((current) => ({ ...current, status: nextStatus, qrcode }));
      weixinPollRef.current = window.setTimeout(
        () => void pollWeixinStatus(qrcode, attempt),
        3000,
      );
    } catch (err: any) {
      if (attempt !== weixinAttemptRef.current) return;
      setWeixinQr((current) => ({
        ...current,
        status: 'error',
        qrcode,
        error: err.message || '微信扫码状态读取失败',
      }));
    }
  }

  async function startWeixinQrLogin() {
    if (weixinPollRef.current) window.clearTimeout(weixinPollRef.current);
    weixinPollRef.current = null;
    const attempt = weixinAttemptRef.current + 1;
    weixinAttemptRef.current = attempt;
    setWeixinQr({ status: 'loading' });
    setError('');
    try {
      const data = await requestJson<{
        qrcode: string;
        qrcode_url: string;
      }>('/api/hermes/weixin/qrcode');
      if (attempt !== weixinAttemptRef.current) return;
      if (!data.qrcode_url) throw new Error('微信二维码内容为空');
      setWeixinQr({
        status: 'waiting',
        qrcode: data.qrcode,
        qrcodeUrl: data.qrcode_url,
      });
      void pollWeixinStatus(data.qrcode, attempt);
    } catch (err: any) {
      if (attempt !== weixinAttemptRef.current) return;
      setWeixinQr({
        status: 'error',
        error: err.message || '微信二维码获取失败',
      });
    }
  }

  return (
    <>
      <section
        className={
          embedded
            ? 'embedded-management-page channels-page'
            : 'management-page channels-page'
        }
      >
        <div className="studio-toolbar settings-head">
          <div>
            <h2>频道</h2>
          </div>
          <label>
            Profile
            <select
              value={profile}
              onChange={(event) => setProfile(event.target.value)}
            >
              {profileOptions(profiles).map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && <div className="form-error">{error}</div>}
        {loading ? (
          <div className="empty-state">读取频道配置中...</div>
        ) : (
          <div className="platform-grid">
            {platformDefinitions.map((platform) => {
              const Icon = platform.icon;
              const configDraft = configDrafts[platform.key] || {};
              const credentialDraft = credentialDrafts[platform.key] || {};
              const configured = platformConfigured(platform, credentialDraft);
              const expanded = expandedPlatforms[platform.key] !== false;
              const hasChanges =
                hasConfigChanges(platform) ||
                hasCredentialChanges(platform);
              return (
                <article
                  className={
                    configured
                      ? 'platform-card configured'
                      : 'platform-card'
                  }
                  key={platform.key}
                >
                  <button
                    className="platform-head"
                    onClick={() =>
                      setExpandedPlatforms((items) => ({
                        ...items,
                        [platform.key]: !expanded,
                      }))
                    }
                    aria-expanded={expanded}
                  >
                    <span className="platform-title">
                      <span className="platform-icon">
                        <Icon size={16} />
                      </span>
                      <strong>{platform.name}</strong>
                      <em className={configured ? 'configured' : ''}>
                        {configured ? '已配置' : '未配置'}
                      </em>
                      {platform.exclusive && <small>独占 token</small>}
                    </span>
                    <ChevronDown size={16} />
                  </button>
                  {expanded && (
                    <div className="platform-body">
                      {platform.exclusive && (
                        <div className="platform-warning">
                          <ShieldAlert size={15} />
                          {exclusiveTokenHint}
                        </div>
                      )}
                      {platform.key === 'weixin' && (
                        <div className="weixin-qr-section">
                          <button
                            className="secondary-btn"
                            onClick={() => void startWeixinQrLogin()}
                            disabled={
                              weixinQr.status === 'loading' ||
                              weixinQr.status === 'waiting' ||
                              weixinQr.status === 'scaned'
                            }
                          >
                            {configured ? '重新扫码登录' : '扫码登录'}
                          </button>
                          {weixinQr.status !== 'idle' && (
                            <span
                              className={
                                weixinQr.status === 'error' ||
                                weixinQr.status === 'expired'
                                  ? 'error'
                                  : ''
                              }
                            >
                              {weixinQr.error || qrStatusLabel(weixinQr.status)}
                            </span>
                          )}
                        </div>
                      )}
                      <div className="platform-fields">
                        {platform.fields.map((field) => {
                          const draft = field.credential
                            ? credentialDraft
                            : configDraft;
                          const value = getNestedValue(draft, field.key);
                          const update = field.credential
                            ? updateCredentialDraft
                            : updateConfigDraft;
                          return (
                            <label
                              className="platform-setting-row"
                              key={field.key}
                            >
                              <span>
                                <strong>{field.label}</strong>
                                {field.hint && <small>{field.hint}</small>}
                              </span>
                              {field.type === 'toggle' ? (
                                <button
                                  className={
                                    Boolean(value)
                                      ? 'toggle-switch on'
                                      : 'toggle-switch'
                                  }
                                  type="button"
                                  onClick={() =>
                                    update(platform.key, field, !Boolean(value))
                                  }
                                  aria-pressed={Boolean(value)}
                                >
                                  <i />
                                </button>
                              ) : (
                                <input
                                  type={field.secret ? 'password' : 'text'}
                                  value={inputValue(value)}
                                  onChange={(event) =>
                                    update(
                                      platform.key,
                                      field,
                                      field.type === 'csv'
                                        ? csvValue(event.target.value)
                                        : event.target.value,
                                    )
                                  }
                                  placeholder={
                                    field.placeholder || field.label
                                  }
                                />
                              )}
                            </label>
                          );
                        })}
                      </div>
                      <div className="platform-actions">
                        <button
                          className="send-btn"
                          onClick={() => void savePlatform(platform.key)}
                          disabled={
                            saving === platform.key || !hasChanges
                          }
                        >
                          {saving === platform.key ? '保存中' : '保存'}
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
      {weixinQr.status !== 'idle' && (
        <WeixinQrDialog
          state={weixinQr}
          onClose={closeWeixinQrLogin}
          onRetry={() => void startWeixinQrLogin()}
        />
      )}
    </>
  );
}

export const emptyMcpForm: McpFormState = {
  name: '',
  transport: 'stdio',
  command: '',
  argsText: '',
  envText: '',
  url: '',
  headersText: '',
  auth: '',
  enabled: true,
};

export function textFromRecord(record?: Record<string, string>) {
  return Object.entries(record || {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

export function mcpFormFromServer(server: McpServer): McpFormState {
  return {
    name: server.name,
    transport: server.transport || (server.url ? 'http' : 'stdio'),
    command: server.command || '',
    argsText: (server.args || []).join('\n'),
    envText: textFromRecord(server.env),
    url: server.url || '',
    headersText: textFromRecord(server.headers),
    auth: server.auth || '',
    enabled: server.enabled !== false,
  };
}

export function mcpPayloadFromForm(form: McpFormState) {
  return {
    name: form.name.trim(),
    transport: form.transport,
    command: form.command.trim(),
    args: form.argsText
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean),
    env: form.envText,
    url: form.url.trim(),
    headers: form.headersText,
    auth: form.auth.trim(),
    enabled: form.enabled,
  };
}

export function McpSettingsPage({
  profiles,
  defaultProfile,
}: {
  profiles: HermesProfile[];
  defaultProfile: string;
}) {
  const [profile, setProfile] = useState(defaultProfile || 'default');
  const [payload, setPayload] = useState<McpServersPayload | null>(null);
  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingName, setEditingName] = useState('');
  const [form, setForm] = useState<McpFormState>(emptyMcpForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [installingWorkbench, setInstallingWorkbench] = useState(false);
  const [testing, setTesting] = useState('');
  const [error, setError] = useState('');
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  async function loadServers(nextProfile = profile) {
    setLoading(true);
    setError('');
    try {
      const data = await requestJson<McpServersPayload>(
        `/api/hermes/mcp/servers?profile=${encodeURIComponent(nextProfile)}`,
      );
      setPayload(data);
    } catch (err: any) {
      setError(err.message || 'MCP 服务器读取失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadServers(profile);
  }, [profile]);

  function startCreate() {
    setEditingName('');
    setForm(emptyMcpForm);
    setFormOpen(true);
  }

  function startEdit(server: McpServer) {
    setEditingName(server.name);
    setForm(mcpFormFromServer(server));
    setFormOpen(true);
  }

  async function saveServer() {
    setSaving(true);
    setError('');
    try {
      const body = mcpPayloadFromForm(form);
      const url = editingName
        ? `/api/hermes/mcp/servers/${encodeURIComponent(editingName)}?profile=${encodeURIComponent(profile)}`
        : `/api/hermes/mcp/servers?profile=${encodeURIComponent(profile)}`;
      const data = await requestJson<McpServersPayload>(url, {
        method: editingName ? 'PATCH' : 'POST',
        body: JSON.stringify(editingName ? { config: body } : body),
      });
      setPayload(data);
      setFormOpen(false);
      setEditingName('');
      setForm(emptyMcpForm);
    } catch (err: any) {
      setError(err.message || 'MCP 服务器保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function toggleServer(server: McpServer) {
    const data = await requestJson<McpServersPayload>(
      `/api/hermes/mcp/servers/${encodeURIComponent(server.name)}?profile=${encodeURIComponent(profile)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !server.enabled }),
      },
    );
    setPayload(data);
  }

  async function deleteServer(server: McpServer) {
    if (!window.confirm(`删除 MCP Server「${server.name}」？`)) return;
    const data = await requestJson<McpServersPayload>(
      `/api/hermes/mcp/servers/${encodeURIComponent(server.name)}?profile=${encodeURIComponent(profile)}`,
      { method: 'DELETE' },
    );
    setPayload(data);
  }

  async function testServer(server: McpServer) {
    setTesting(server.name);
    setTestResult((current) => ({ ...current, [server.name]: '' }));
    try {
      const data = await requestJson<{
        ok: boolean;
        tools?: string[];
        output?: string;
      }>(
        `/api/hermes/mcp/servers/${encodeURIComponent(server.name)}/test?profile=${encodeURIComponent(profile)}`,
        { method: 'POST' },
      );
      setTestResult((current) => ({
        ...current,
        [server.name]: `连接成功 · ${(data.tools || []).length} 个工具`,
      }));
    } catch (err: any) {
      setTestResult((current) => ({
        ...current,
        [server.name]: err.message || '测试失败',
      }));
    } finally {
      setTesting('');
    }
  }

  async function reloadMcp() {
    try {
      const data = await requestJson<{
        runtime?: McpServersPayload;
        error?: string;
      }>(`/api/hermes/mcp/reload?profile=${encodeURIComponent(profile)}`, {
        method: 'POST',
      });
      if (data.runtime) setPayload(data.runtime);
      if (data.error) setError(data.error);
    } catch (err: any) {
      setError(err.message || 'MCP 重载失败');
    }
  }

  async function installWorkbenchMcp() {
    setInstallingWorkbench(true);
    setError('');
    try {
      const data = await requestJson<McpServersPayload>(
        `/api/hermes/mcp/workbench/install?profile=${encodeURIComponent(profile)}`,
        { method: 'POST' },
      );
      setPayload(data);
      setTestResult((current) => ({
        ...current,
        'hermes-workbench-api': '已安装 Frakio Work 内置 MCP',
        'hermes-workbench-use': '已安装 Frakio Work 内置 MCP',
      }));
    } catch (err: any) {
      setError(err.message || 'Frakio Work 内置 MCP 安装失败');
    } finally {
      setInstallingWorkbench(false);
    }
  }

  const stats = payload?.stats || {
    total: 0,
    connected: 0,
    disconnected: 0,
    tools: 0,
  };
  const normalizedQuery = query.trim().toLowerCase();
  const servers = (payload?.servers || []).filter((server) => {
    const haystack = [
      server.name,
      server.command,
      server.url,
      server.statusLabel,
      ...(server.tools || []),
    ]
      .join(' ')
      .toLowerCase();
    return !normalizedQuery || haystack.includes(normalizedQuery);
  });

  return (
    <section className="embedded-management-page mcp-page">
      <div className="studio-toolbar settings-head">
        <div>
          <h2>MCP 服务器</h2>
        </div>
        <div className="mcp-toolbar-actions">
          <label>
            Profile
            <select
              value={profile}
              onChange={(event) => setProfile(event.target.value)}
            >
              {profileOptions(profiles).map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary-btn"
            onClick={() => void loadServers(profile)}
            disabled={loading}
          >
            <RefreshCw size={15} />
            刷新
          </button>
        </div>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="plugin-stats mcp-stats">
        <article>
          <span>总计</span>
          <strong>{stats.total}</strong>
          <small>配置的服务器</small>
        </article>
        <article>
          <span>已连接</span>
          <strong>{stats.connected}</strong>
          <small>可识别工具</small>
        </article>
        <article>
          <span>未连接</span>
          <strong>{stats.disconnected}</strong>
          <small>停用或待重载</small>
        </article>
        <article>
          <span>工具</span>
          <strong>{stats.tools}</strong>
          <small>当前可展示工具</small>
        </article>
      </div>
      <div className="plugin-toolbar">
        <label className="plugin-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索服务器或工具"
          />
        </label>
        <div className="mcp-toolbar-actions">
          <button
            className="secondary-btn"
            onClick={() => void installWorkbenchMcp()}
            disabled={installingWorkbench}
          >
            {installingWorkbench
              ? '安装中'
              : '安装 Frakio Work 内置 MCP'}
          </button>
          <button className="secondary-btn" onClick={() => void reloadMcp()}>
            全部重载
          </button>
          <button className="send-btn" onClick={startCreate}>
            <Plus size={15} />
            添加服务器
          </button>
        </div>
      </div>
      {formOpen && (
        <div className="mcp-form">
          <label>
            名称
            <input
              value={form.name}
              disabled={Boolean(editingName)}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
              placeholder="agentmail"
            />
          </label>
          <label>
            类型
            <select
              value={form.transport}
              onChange={(event) =>
                setForm({
                  ...form,
                  transport: event.target.value as 'stdio' | 'http',
                })
              }
            >
              <option value="stdio">stdio</option>
              <option value="http">HTTP</option>
            </select>
          </label>
          {form.transport === 'stdio' ? (
            <>
              <label>
                Command
                <input
                  value={form.command}
                  onChange={(event) =>
                    setForm({ ...form, command: event.target.value })
                  }
                  placeholder="npx"
                />
              </label>
              <label className="wide">
                Args
                <textarea
                  value={form.argsText}
                  onChange={(event) =>
                    setForm({ ...form, argsText: event.target.value })
                  }
                  placeholder="-y&#10;agentmail-mcp"
                />
              </label>
              <label className="wide">
                Env
                <textarea
                  value={form.envText}
                  onChange={(event) =>
                    setForm({ ...form, envText: event.target.value })
                  }
                  placeholder="API_KEY=..."
                />
              </label>
            </>
          ) : (
            <>
              <label className="wide">
                URL
                <input
                  value={form.url}
                  onChange={(event) =>
                    setForm({ ...form, url: event.target.value })
                  }
                  placeholder="https://example.com/mcp"
                />
              </label>
              <label className="wide">
                Headers
                <textarea
                  value={form.headersText}
                  onChange={(event) =>
                    setForm({ ...form, headersText: event.target.value })
                  }
                  placeholder="Authorization=Bearer ..."
                />
              </label>
              <label>
                Auth
                <input
                  value={form.auth}
                  onChange={(event) =>
                    setForm({ ...form, auth: event.target.value })
                  }
                  placeholder="oauth"
                />
              </label>
            </>
          )}
          <label className="mcp-check">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) =>
                setForm({ ...form, enabled: event.target.checked })
              }
            />
            启用
          </label>
          <div className="mcp-form-actions">
            <button
              className="secondary-btn"
              onClick={() => {
                setFormOpen(false);
                setEditingName('');
              }}
            >
              取消
            </button>
            <button
              className="send-btn"
              onClick={() => void saveServer()}
              disabled={saving}
            >
              {saving ? '保存中' : '保存'}
            </button>
          </div>
        </div>
      )}
      {loading ? (
        <div className="empty-state">读取 MCP 服务器中...</div>
      ) : servers.length ? (
        <div className="mcp-grid">
          {servers.map((server) => (
            <article className="mcp-card" key={server.name}>
              <div className="plugin-card-head">
                <div>
                  <strong>{server.name}</strong>
                  <span>
                    {server.transport} ·{' '}
                    {server.command || server.url || '未配置入口'}
                  </span>
                </div>
                <em
                  className={
                    server.enabled && server.status === 'connected'
                      ? 'enabled'
                      : ''
                  }
                >
                  {server.statusLabel}
                </em>
              </div>
              <div className="mcp-card-tools">
                <span>工具列表</span>
                <strong>
                  {server.availableToolCount || server.toolCount}/
                  {server.toolCount} 个工具
                </strong>
              </div>
              <div className="plugin-tags mcp-tools">
                {(server.tools || []).slice(0, 18).map((tool) => (
                  <span key={tool}>{tool}</span>
                ))}
                {!server.tools?.length && <span>暂无工具列表</span>}
              </div>
              {(server.error || testResult[server.name]) && (
                <p className="mcp-result">
                  {testResult[server.name] || server.error}
                </p>
              )}
              <div className="mcp-card-actions">
                <button onClick={() => startEdit(server)}>编辑</button>
                <button
                  onClick={() => void testServer(server)}
                  disabled={testing === server.name}
                >
                  {testing === server.name ? '测试中' : '测试'}
                </button>
                <button onClick={() => void reloadMcp()}>重载</button>
                <button
                  className="danger"
                  onClick={() => void deleteServer(server)}
                >
                  移除
                </button>
                <label className="mcp-switch">
                  <input
                    type="checkbox"
                    checked={server.enabled}
                    onChange={() => void toggleServer(server)}
                  />
                  <span />
                </label>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">暂无 MCP Server。</div>
      )}
    </section>
  );
}

export function JobsPage({
  profiles,
  defaultProfile,
  embedded = false,
}: {
  profiles: HermesProfile[];
  defaultProfile: string;
  embedded?: boolean;
}) {
  const [profile, setProfile] = useState(defaultProfile || 'default');
  const [jobs, setJobs] = useState<HermesJob[]>([]);
  const [form, setForm] = useState({ name: '', schedule: '', prompt: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function loadJobs(nextProfile = profile) {
    setLoading(true);
    setError('');
    try {
      const data = await requestJson<{ jobs: HermesJob[] }>(
        `/api/hermes/jobs?include_disabled=true&profile=${encodeURIComponent(nextProfile)}`,
      );
      setJobs(data.jobs || []);
    } catch (err: any) {
      setError(err.message || '定时任务读取失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadJobs(profile);
  }, [profile]);

  async function createJob() {
    if (!form.schedule.trim()) return;
    await requestJson(
      `/api/hermes/jobs?profile=${encodeURIComponent(profile)}`,
      { method: 'POST', body: JSON.stringify(form) },
    );
    setForm({ name: '', schedule: '', prompt: '' });
    await loadJobs(profile);
  }

  async function jobAction(
    job: HermesJob,
    action: 'run' | 'pause' | 'resume' | 'delete',
  ) {
    const method = action === 'delete' ? 'DELETE' : 'POST';
    const suffix = action === 'delete' ? '' : `/${action}`;
    await requestJson(
      `/api/hermes/jobs/${encodeURIComponent(job.job_id || job.id)}${suffix}?profile=${encodeURIComponent(profile)}`,
      { method },
    );
    await loadJobs(profile);
  }

  const runHistory = jobs.filter(
    (job) => job.last_run_at || job.last_status || job.last_error,
  );

  return (
    <section
      className={
        embedded ? 'embedded-management-page' : 'management-page'
      }
    >
      <div className="studio-toolbar settings-head">
        <div>
          <h2>定时任务</h2>
        </div>
        <label>
          Profile
          <select
            value={profile}
            onChange={(event) => setProfile(event.target.value)}
          >
            {profileOptions(profiles).map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="create-strip">
        <input
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          placeholder="任务名称"
        />
        <input
          value={form.schedule}
          onChange={(event) =>
            setForm({ ...form, schedule: event.target.value })
          }
          placeholder="30m / every 2h / 0 9 * * *"
        />
        <input
          value={form.prompt}
          onChange={(event) =>
            setForm({ ...form, prompt: event.target.value })
          }
          placeholder="执行提示词"
        />
        <button className="send-btn" onClick={() => void createJob()}>
          创建任务
        </button>
      </div>
      {loading ? (
        <div className="empty-state">读取定时任务中...</div>
      ) : jobs.length ? (
        <div className="job-list">
          {jobs.map((job) => (
            <article className="job-card" key={job.job_id || job.id}>
              <div>
                <strong>{job.name}</strong>
                <span>
                  {job.schedule_display || '未设置时间'} · {job.state}
                </span>
                <p>{job.prompt_preview || job.prompt || '无提示词'}</p>
              </div>
              <div className="job-actions">
                <button
                  className="secondary-btn"
                  onClick={() => void jobAction(job, 'run')}
                >
                  运行
                </button>
                <button
                  className="secondary-btn"
                  onClick={() =>
                    void jobAction(job, job.enabled ? 'pause' : 'resume')
                  }
                >
                  {job.enabled ? '暂停' : '恢复'}
                </button>
                <button
                  className="secondary-btn danger"
                  onClick={() => void jobAction(job, 'delete')}
                >
                  删除
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">暂无定时任务。</div>
      )}
      <section className="job-history-panel">
        <h3>运行历史</h3>
        {runHistory.length ? (
          runHistory.map((job) => (
            <article
              className="job-history-row"
              key={`${job.job_id || job.id}-history`}
            >
              <strong>{job.name}</strong>
              <span>
                {job.last_status || 'unknown'} ·{' '}
                {job.last_run_at || '未记录时间'}
              </span>
              {job.last_error && <p>{job.last_error}</p>}
            </article>
          ))
        ) : (
          <div className="empty-state">暂无运行历史。</div>
        )}
      </section>
    </section>
  );
}
// wjz新建文件结束。
