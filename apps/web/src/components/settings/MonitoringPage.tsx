// wjz新建文件，新建原因：解耦监控与用量数据分析页面组件（MonitoringPage 及用量聚合纯函数），修改时间：2026-08-17。
// 文件内容概述：模型调用监控、Token/成本统计、趋势图表（Recharts）及运行记录分析。
import React, { useEffect, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Bot,
  ChevronDown,
  Clock3,
  FileText,
  RefreshCw,
  Sparkles,
  Zap as ZapIcon,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  formatChineseApproxNumber,
  formatCompactNumber,
  formatFullNumber,
  formatUsd,
  formatWanNumber,
} from '../../utils/formatters';
import { pricingSourceLabel } from './ModelCenter';


import type {
  AnalysisTab,
  DonutMetricRow,
  ModelMetricRow,
  ModelUsageRow,
  MonitoringSummary,
  UsageDay,
  UsageEntry,
  UsageRangeMode,
  UsageSource,
  UsageTrendPoint,
} from '../../types/workbench';

export function modelRunReasoningLabel(value: string) {
  return (
    ({
      off: '关闭',
      none: '关闭',
      minimal: '最低',
      low: '低',
      medium: '中',
      high: '高',
      xhigh: '超高',
      max: '最大',
      ultra: '极致',
    } as Record<string, string>)[value] || value
  );
}

export function MonitoringPage({ embedded = false }: { embedded?: boolean }) {
  const [summary, setSummary] = useState<MonitoringSummary | null>(null);
  const [moduleMode, setModuleMode] = useState<'skills' | 'plugins'>('skills');
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>('trend');
  const [loading, setLoading] = useState(false);
  const [providerFilter, setProviderFilter] = useState('all');
  const [modelFilter, setModelFilter] = useState('all');
  const [profileFilter, setProfileFilter] = useState('all');
  const [refreshMode, setRefreshMode] = useState<'30' | '0'>('30');
  const [rangeMode, setRangeMode] = useState<UsageRangeMode>('today');
  const allUsage = summary?.usage;
  const usageEntries = allUsage?.entries || [];
  const hasEntryData = usageEntries.length > 0;
  const rangeEntries = usageEntries.filter((entry) => {
    const time = new Date(entry.createdAt || '').getTime();
    return Number.isFinite(time) && time >= usageRangeStart(rangeMode);
  });
  const usageBySource = hasEntryData ? aggregateUsageSources(rangeEntries) : allUsage?.bySource || [];
  const usageByModel = hasEntryData ? aggregateUsageModels(rangeEntries) : allUsage?.byModel || [];
  const sourceOptions = usageBySource.map((row) => row.source).filter(Boolean);
  const modelOptions = usageByModel.filter((row) => row.requests > 0).map((row) => row.modelName).filter(Boolean);
  const profileOptions = Array.from(
    new Set(
      (hasEntryData
        ? rangeEntries.map((entry) => entry.profileName || entry.agentNames?.[0] || '')
        : allUsage?.byProfile?.map((row) => row.profileName) || []
      ).filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));
  const profileEntries =
    profileFilter === 'all'
      ? rangeEntries
      : rangeEntries.filter(
          (entry) => (entry.profileName || entry.agentNames?.[0] || '') === profileFilter,
        );
  const filteredEntries = filterEntriesBySelection(profileEntries, providerFilter, modelFilter);
  const filteredModels = (
    hasEntryData
      ? aggregateUsageModels(filteredEntries)
      : usageByModel.filter((row) => {
          const sourceMatched =
            providerFilter === 'all' ||
            row.provider === providerFilter ||
            Object.keys(row.dataSources || {}).includes(providerFilter);
          const modelMatched = modelFilter === 'all' || row.modelName === modelFilter;
          return sourceMatched && modelMatched;
        })
  ).filter((row) => row.requests > 0 || Number(row.realTotalTokens || row.totalTokens || 0) > 0);
  const usage = {
    totalRequests: filteredModels.reduce((sum, row) => sum + row.requests, 0),
    realTotalTokens: filteredModels.reduce(
      (sum, row) => sum + Number(row.realTotalTokens ?? row.totalTokens ?? 0),
      0,
    ),
    inputTokens: filteredModels.reduce((sum, row) => sum + row.inputTokens, 0),
    outputTokens: filteredModels.reduce((sum, row) => sum + row.outputTokens, 0),
    cacheReadTokens: filteredModels.reduce((sum, row) => sum + Number(row.cacheReadTokens || 0), 0),
    cacheCreationTokens: filteredModels.reduce(
      (sum, row) => sum + Number(row.cacheCreationTokens || 0),
      0,
    ),
    totalCost: filteredModels.reduce((sum, row) => sum + Number(row.totalCost || 0), 0),
    estimatedRequests: filteredModels.reduce((sum, row) => sum + row.estimatedRequests, 0),
  };
  const cacheableInput = usage.inputTokens + usage.cacheReadTokens;
  const cacheHitRate = cacheableInput > 0 ? usage.cacheReadTokens / cacheableInput : 0;
  const maxTokens = Math.max(
    1,
    ...filteredModels.map((row) => Number(row.realTotalTokens ?? row.totalTokens ?? 0)),
  );
  const trendPoints = hasEntryData
    ? aggregateUsageTrendPoints(filteredEntries, rangeMode)
    : buildUsageTrendPointsFromDays(allUsage?.byDay || []);
  const modelMetricRows = aggregateUsageByModelMetric(filteredEntries, filteredModels);
  const requestSeries = buildModelBarSeries(modelMetricRows, 'requests');
  const donutRows = buildDonutRows(modelMetricRows);
  const donutSegments = buildDonutSegments(donutRows);
  const rangeLabel = usageRangeLabel(rangeMode);
  const latestTrendIndex = latestActiveTrendIndex(trendPoints);
  const latestTrend = trendPoints[latestTrendIndex];
  const previousTrend = latestTrendIndex > 0 ? trendPoints[latestTrendIndex - 1] : undefined;
  const latestTokens = Number(latestTrend?.realTotalTokens || 0);
  const previousTokens = Number(previousTrend?.realTotalTokens || 0);
  const tokenDelta = previousTrend ? latestTokens - previousTokens : latestTokens;
  const tokenDeltaRatio = previousTrend && previousTokens > 0 ? tokenDelta / previousTokens : null;

  async function loadMonitoring() {
    setLoading(true);
    try {
      const data = await fetch('/api/monitoring/summary').then((res) => res.json());
      setSummary(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadMonitoring();
  }, []);

  useEffect(() => {
    if (refreshMode !== '30') return undefined;
    const timer = window.setInterval(() => void loadMonitoring(), 30_000);
    return () => window.clearInterval(timer);
  }, [refreshMode]);

  const modules = moduleMode === 'skills' ? summary?.modules.skills : summary?.modules.plugins;
  const modelRuns = summary?.modelRuns || [];
  return (
    <section
      className={embedded ? 'embedded-management-page monitoring-page' : 'settings-page monitoring-page'}
    >
      <div className="monitoring-shell">
        <div className="settings-head monitoring-head">
          <div>
            <h2>监控</h2>
          </div>
          <button
            className={`secondary-btn ${loading ? 'is-loading' : ''}`}
            onClick={() => void loadMonitoring()}
            disabled={loading}
          >
            <RefreshCw size={15} />
            {loading ? '刷新中' : '刷新'}
          </button>
        </div>

        <div className="usage-toolbar" aria-label="监控筛选">
          <label>
            <span>来源</span>
            <select
              value={providerFilter}
              onChange={(event) => setProviderFilter(event.target.value)}
            >
              <option value="all">全部来源</option>
              {sourceOptions.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
            <ChevronDown size={15} />
          </label>
          <label>
            <span>模型</span>
            <select
              value={modelFilter}
              onChange={(event) => setModelFilter(event.target.value)}
            >
              <option value="all">全部模型</option>
              {modelOptions.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
            <ChevronDown size={15} />
          </label>
          <label>
            <span>Profile</span>
            <select
              value={profileFilter}
              onChange={(event) => setProfileFilter(event.target.value)}
            >
              <option value="all">全部 Profile</option>
              {profileOptions.map((profile) => (
                <option key={profile} value={profile}>
                  {profile}
                </option>
              ))}
            </select>
            <ChevronDown size={15} />
          </label>
          <label>
            <RefreshCw size={15} />
            <select
              value={refreshMode}
              onChange={(event) => setRefreshMode(event.target.value as '30' | '0')}
            >
              <option value="30">30s</option>
              <option value="0">手动</option>
            </select>
            <ChevronDown size={15} />
          </label>
          <label>
            <Clock3 size={15} />
            <select
              value={rangeMode}
              onChange={(event) => setRangeMode(event.target.value as UsageRangeMode)}
            >
              <option value="today">当天</option>
              <option value="7">7 天</option>
              <option value="15">15 天</option>
              <option value="30">一个月</option>
              <option value="90">3 个月</option>
              <option value="180">6 个月</option>
              <option value="365">1 年</option>
            </select>
            <ChevronDown size={15} />
          </label>
        </div>

        <section className="usage-summary-card">
          <div className="usage-summary-top">
            <div className="usage-total-block">
              <div className="usage-total-icon">
                <ZapIcon />
              </div>
              <div>
                <span>真实消耗 Tokens</span>
                <strong>{formatFullNumber(usage.realTotalTokens)}</strong>
                <small>
                  ≈ {formatChineseApproxNumber(usage.realTotalTokens)} ·{' '}
                  {summary?.hermesAgent
                    ? `${summary.hermesAgent.usageSource} · ${summary.hermesAgent.databaseCount} profiles`
                    : '兼容汇总'}
                </small>
              </div>
            </div>
            <div className="usage-cost-pill">
              <div>
                <span>总请求数</span>
                <strong>
                  <Activity size={15} />
                  {formatFullNumber(usage.totalRequests)}
                </strong>
              </div>
              <i />
              <div>
                <span>总成本</span>
                <strong className="money">{formatUsd(usage.totalCost)}</strong>
              </div>
            </div>
          </div>

          <div className="usage-breakdown-grid">
            <UsageMiniStat
              icon={<ArrowDownToLine size={16} />}
              label="新增输入"
              value={formatWanNumber(usage.inputTokens)}
            />
            <UsageMiniStat
              icon={<ArrowUpFromLine size={16} />}
              label="Output"
              value={formatWanNumber(usage.outputTokens)}
              accent="purple"
            />
            <UsageMiniStat
              icon={<Sparkles size={16} />}
              label="命中"
              value={formatWanNumber(usage.cacheReadTokens)}
              accent="green"
            />
            <div className="cache-hit-card">
              <div>
                <span>缓存命中率</span>
                <strong>{(cacheHitRate * 100).toFixed(cacheHitRate > 0.999 ? 0 : 1)}%</strong>
              </div>
              <span className="hit-track">
                <i
                  style={{
                    width: `${Math.max(0, Math.min(100, cacheHitRate * 100))}%`,
                  }}
                />
              </span>
            </div>
          </div>
        </section>

        <section className="monitor-panel analysis-panel">
          <div className="panel-title analysis-title">
            <div>
              <span>模型数据分析</span>
              <small>{rangeMode === 'today' ? '当天按小时统计' : `${rangeLabel}按天统计`}</small>
            </div>
            <div className="analysis-tabs" role="tablist" aria-label="模型数据分析">
              {[
                ['cost', '消耗分布'],
                ['trend', '调用趋势'],
                ['requests', '调用次数分布'],
                ['ranking', '调用次数排行'],
              ].map(([id, label]) => (
                <React.Fragment key={id}>
                  <button
                    className={analysisTab === id ? 'selected' : ''}
                    onClick={() => setAnalysisTab(id as AnalysisTab)}
                    type="button"
                  >
                    {label}
                  </button>
                </React.Fragment>
              ))}
            </div>
          </div>

          {analysisTab === 'trend' && (
            <div className="analysis-chart">
              <div className="analysis-chart-head">
                <div>
                  <strong>调用趋势</strong>
                  <span>
                    {latestTrend
                      ? `${latestTrend.label} · ${formatCompactNumber(latestTokens)} tokens`
                      : '等待数据进入'}
                  </span>
                </div>
                <em className={tokenDelta >= 0 ? 'growth-positive' : 'growth-negative'}>
                  {rangeLabel} · {formatDelta(tokenDelta, tokenDeltaRatio)}
                </em>
              </div>
              <UsageTrendRechart points={trendPoints} hourly={rangeMode === 'today'} />
            </div>
          )}

          {analysisTab === 'cost' && (
            <div className="analysis-donut-view">
              <div className="donut-legend">
                <strong>模型消耗分布</strong>
                <span>总计：{formatCompactNumber(usage.realTotalTokens)} tokens</span>
                {donutRows.map((row) => (
                  <div className="donut-legend-row" key={row.key}>
                    <i style={{ background: row.color }} />
                    <span>{row.modelName}</span>
                    <em>{formatDonutShare(row.displayShare)}</em>
                  </div>
                ))}
              </div>
              <div className="donut-chart-wrap">
                <svg className="donut-chart" viewBox="0 0 120 120" aria-hidden="true">
                  <circle className="donut-ring-base" cx="60" cy="60" r="38" pathLength="100" />
                  {donutSegments.map((segment) => (
                    <circle
                      className="donut-ring-segment"
                      key={segment.key}
                      cx="60"
                      cy="60"
                      r="38"
                      pathLength="100"
                      style={{
                        stroke: segment.color,
                        strokeDasharray: `${segment.length} ${segment.gap}`,
                        strokeDashoffset: segment.offset,
                      }}
                    />
                  ))}
                </svg>
                <div>
                  <strong>
                    {donutRows[0] ? formatDonutShare(donutRows[0].displayShare) : '0%'}
                  </strong>
                  <span>{donutRows[0]?.modelName || '暂无模型'}</span>
                </div>
              </div>
            </div>
          )}

          {analysisTab === 'requests' && (
            <div className="analysis-bar-view">
              <div className="analysis-chart-head">
                <div>
                  <strong>模型调用次数占比</strong>
                  <span>总计：{formatFullNumber(usage.totalRequests)} 次</span>
                </div>
              </div>
              <div className="analysis-bars-chart">
                {requestSeries.map((bar) => (
                  <div className="analysis-model-bar" key={bar.key}>
                    <span>{bar.label}</span>
                    <i style={{ height: `${Math.max(2, bar.height)}%`, background: bar.color }} />
                    <em>{formatFullNumber(bar.value)}</em>
                  </div>
                ))}
                {!requestSeries.length && <p className="muted-copy">暂无调用次数数据。</p>}
              </div>
            </div>
          )}

          {analysisTab === 'ranking' && (
            <div className="analysis-ranking">
              <div className="analysis-chart-head">
                <div>
                  <strong>调用次数排行</strong>
                  <span>按模型请求数降序</span>
                </div>
              </div>
              {modelMetricRows.slice(0, 8).map((row, index) => (
                <div className="analysis-rank-row" key={row.key}>
                  <b>{index + 1}</b>
                  <div>
                    <strong>{row.modelName}</strong>
                    <small>
                      {row.provider} · {formatCompactNumber(row.realTotalTokens)} tokens ·{' '}
                      {formatUsd(row.totalCost)}
                    </small>
                  </div>
                  <span>{formatFullNumber(row.requests)}</span>
                  <i>
                    <em style={{ width: `${Math.max(3, row.share)}%`, background: row.color }} />
                  </i>
                </div>
              ))}
              {!modelMetricRows.length && <p className="muted-copy">暂无调用排行数据。</p>}
            </div>
          )}
        </section>

        <section className="monitor-panel wide monitor-model-panel">
          <div className="panel-title">
            <span>模型用量与成本</span>
            <Bot size={15} />
          </div>
          <div className="usage-bars">
            {filteredModels.slice(0, 8).map((row) => (
              <div className="usage-bar-row" key={row.key}>
                <div>
                  <strong>{row.modelName}</strong>
                  <small>
                    {row.provider} · {row.requests} requests · {pricingSourceLabel(row.pricingSource)}
                  </small>
                </div>
                <div className="usage-bar-track">
                  <span
                    style={{
                      width: `${Math.max(
                        3,
                        (Number(row.realTotalTokens ?? row.totalTokens ?? 0) / maxTokens) * 100,
                      )}%`,
                    }}
                  />
                </div>
                <em>
                  {formatCompactNumber(Number(row.realTotalTokens ?? row.totalTokens ?? 0))}
                  <small>{formatUsd(Number(row.totalCost || 0))}</small>
                </em>
              </div>
            ))}
            {!filteredModels.length && (
              <p className="muted-copy">
                还没有匹配的模型调用记录。发起一次真实模型对话后这里会开始累计。
              </p>
            )}
          </div>
        </section>

        <section className="monitor-panel model-run-diagnostics-panel">
          <details>
            <summary>
              <span>
                <Activity size={15} />
                <strong>模型运行记录</strong>
                <small>用于排查参数是否送达，不展示对话内容</small>
              </span>
              <span className="model-run-count">
                最近 {Math.min(modelRuns.length, 200)} 条
                <ChevronDown size={15} />
              </span>
            </summary>
            <div className="model-run-list">
              {modelRuns.slice(0, 30).map((run) => (
                <details className={`model-run-row ${run.status}`} key={run.id}>
                  <summary>
                    <i aria-hidden="true" />
                    <span>
                      <strong>
                        {run.provider || run.providerKey || '未命名 Provider'} ·{' '}
                        {run.model || '未识别模型'}
                      </strong>
                      <small>
                        {new Date(run.createdAt).toLocaleString('zh-CN')} ·{' '}
                        {run.profileName || run.agentName || '默认 Profile'}
                      </small>
                    </span>
                    <span className="model-run-settings">
                      {run.effectiveReasoning === 'default'
                        ? '默认推理'
                        : `${modelRunReasoningLabel(run.effectiveReasoning)}推理`}{' '}
                      · {run.effectiveServiceTier === 'standard' ? '标准速度' : '快速线路'}
                    </span>
                    <em>
                      {run.status === 'completed'
                        ? run.evidenceStatus === 'confirmed'
                          ? '供应商已确认'
                          : '已发送，供应商未确认'
                        : run.status === 'failed'
                        ? '运行失败'
                        : run.status === 'cancelled'
                        ? '已停止'
                        : '发送中'}
                    </em>
                  </summary>
                  <div className="model-run-detail">
                    <span>Transport：{run.transport}</span>
                    <span>
                      耗时：{run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : '—'}
                    </span>
                    <span>
                      推理回执：{run.reasoningTokens ? `${run.reasoningTokens} tokens` : '未返回'}
                    </span>
                    <span>速度回执：{run.confirmedServiceTier || '未返回'}</span>
                    {run.error && <p>{run.error}</p>}
                    {run.mappedParameters && Object.keys(run.mappedParameters).length > 0 && (
                      <pre>{JSON.stringify(run.mappedParameters, null, 2)}</pre>
                    )}
                  </div>
                </details>
              ))}
              {!modelRuns.length && (
                <p className="muted-copy">
                  还没有模型运行记录。发起一次真实对话后，这里会显示脱敏后的参数送达状态。
                </p>
              )}
            </div>
          </details>
        </section>

        <div className="monitor-grid">
          <section className="monitor-panel">
            <div className="panel-title">
              <span>系统日志</span>
              <FileText size={15} />
            </div>
            <div className="log-list">
              {(summary?.logs || []).slice(0, 18).map((log, index) => (
                <div className={`log-row ${log.level}`} key={`${log.source}-${index}`}>
                  <strong>{log.source}</strong>
                  <span>{log.message}</span>
                </div>
              ))}
              {!summary?.logs.length && (
                <p className="muted-copy">没有读取到 Hermes 日志文件。</p>
              )}
            </div>
          </section>

          <section className="monitor-panel module-usage-panel">
            <div className="panel-title">
              <span>技能与插件用量</span>
              <div className="mini-segment">
                <button
                  className={moduleMode === 'skills' ? 'selected' : ''}
                  onClick={() => setModuleMode('skills')}
                >
                  技能
                </button>
                <button
                  className={moduleMode === 'plugins' ? 'selected' : ''}
                  onClick={() => setModuleMode('plugins')}
                >
                  插件
                </button>
              </div>
            </div>
            <div className="module-usage-list">
              {(modules?.byName || []).slice(0, 12).map((row) => (
                <div className="module-usage-row" key={row.name}>
                  <span>
                    <strong>{row.name}</strong>
                    <small>
                      {row.enabledProfiles || 0}/{row.profiles || 0} enabled
                    </small>
                  </span>
                  <em>{formatCompactNumber(row.useCount + row.viewCount + row.patchCount)}</em>
                </div>
              ))}
              {!modules?.byName.length && (
                <p className="muted-copy">暂无{moduleMode === 'skills' ? '技能' : '插件'}用量记录。</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}

export function usageRangeStart(rangeMode: UsageRangeMode) {
  const nowDate = new Date();
  if (rangeMode === 'today') {
    const start = new Date(nowDate);
    start.setHours(0, 0, 0, 0);
    return start.getTime();
  }
  const start = new Date(nowDate);
  start.setDate(start.getDate() - (Number(rangeMode) - 1));
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

export function usageRangeLabel(rangeMode: UsageRangeMode) {
  if (rangeMode === 'today') return '当天';
  if (rangeMode === '30') return '一个月';
  if (rangeMode === '90') return '3 个月';
  if (rangeMode === '180') return '6 个月';
  if (rangeMode === '365') return '1 年';
  return `${rangeMode} 天`;
}

export function latestActiveTrendIndex(points: UsageTrendPoint[]) {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const row = points[index];
    if (Number(row.realTotalTokens || 0) > 0 || Number(row.requests || 0) > 0) return index;
  }
  return Math.max(0, points.length - 1);
}

export function filterEntriesBySelection(entries: UsageEntry[], source: string, model: string) {
  return entries.filter((entry) => {
    const sourceValue = entry.dataSource || entry.provider || 'Frakio Work';
    const sourceMatched = source === 'all' || sourceValue === source || entry.provider === source;
    const modelMatched = model === 'all' || entry.modelName === model;
    return sourceMatched && modelMatched;
  });
}

export function aggregateUsageModels(entries: UsageEntry[]): ModelUsageRow[] {
  const byModel = new Map<string, ModelUsageRow>();
  for (const entry of entries) {
    const key = `${entry.provider || 'unknown'}:${entry.modelId || entry.modelName || 'unknown'}`;
    const current = byModel.get(key) || {
      key,
      provider: entry.provider || 'unknown',
      modelId: entry.modelId || '',
      modelName: entry.modelName || entry.modelId || 'unknown',
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      realTotalTokens: 0,
      totalCost: 0,
      pricing: entry.pricing,
      pricingSource: entry.pricingSource,
      estimatedRequests: 0,
      lastUsedAt: entry.createdAt || null,
      dataSources: {},
    };
    current.requests += 1;
    current.inputTokens += Number(entry.inputTokens || 0);
    current.outputTokens += Number(entry.outputTokens || 0);
    current.cacheReadTokens += Number(entry.cacheReadTokens || 0);
    current.cacheCreationTokens += Number(entry.cacheCreationTokens || 0);
    current.totalTokens += Number(entry.totalTokens || 0);
    current.realTotalTokens += Number(entry.realTotalTokens || entry.totalTokens || 0);
    current.totalCost += Number(entry.totalCost || 0);
    current.estimatedRequests += entry.estimated ? 1 : 0;
    current.pricing = entry.pricing || current.pricing;
    current.pricingSource = entry.pricingSource || current.pricingSource;
    current.lastUsedAt =
      entry.createdAt && (!current.lastUsedAt || entry.createdAt.localeCompare(current.lastUsedAt) > 0)
        ? entry.createdAt
        : current.lastUsedAt;
    const source = entry.dataSource || entry.provider || 'Frakio Work';
    current.dataSources = current.dataSources || {};
    current.dataSources[source] = (current.dataSources[source] || 0) + 1;
    byModel.set(key, current);
  }
  return Array.from(byModel.values()).sort((a, b) => b.realTotalTokens - a.realTotalTokens);
}

export function aggregateUsageSources(entries: UsageEntry[]): UsageSource[] {
  const bySource = new Map<string, UsageSource>();
  for (const entry of entries) {
    const source = entry.dataSource || entry.provider || 'Frakio Work';
    const current = bySource.get(source) || {
      source,
      requests: 0,
      totalTokens: 0,
      realTotalTokens: 0,
      totalCost: 0,
    };
    current.requests += 1;
    current.totalTokens += Number(entry.totalTokens || 0);
    current.realTotalTokens += Number(entry.realTotalTokens || entry.totalTokens || 0);
    current.totalCost += Number(entry.totalCost || 0);
    bySource.set(source, current);
  }
  return Array.from(bySource.values()).sort((a, b) => b.realTotalTokens - a.realTotalTokens);
}

export function aggregateUsageDays(entries: UsageEntry[]): UsageDay[] {
  const byDay = new Map<string, UsageDay>();
  for (const entry of entries) {
    const day = String(entry.createdAt || '').slice(0, 10);
    if (!day) continue;
    const current = byDay.get(day) || {
      day,
      requests: 0,
      totalTokens: 0,
      realTotalTokens: 0,
      totalCost: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };
    current.requests += 1;
    current.totalTokens += Number(entry.totalTokens || 0);
    current.realTotalTokens += Number(entry.realTotalTokens || entry.totalTokens || 0);
    current.totalCost += Number(entry.totalCost || 0);
    current.inputTokens += Number(entry.inputTokens || 0);
    current.outputTokens += Number(entry.outputTokens || 0);
    current.cacheReadTokens += Number(entry.cacheReadTokens || 0);
    current.cacheCreationTokens += Number(entry.cacheCreationTokens || 0);
    byDay.set(day, current);
  }
  return Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
}

export function aggregateUsageTrendPoints(
  entries: UsageEntry[],
  rangeMode: UsageRangeMode,
): UsageTrendPoint[] {
  if (rangeMode !== 'today') {
    return aggregateUsageDays(entries).map((row) => ({
      key: row.day,
      label: row.day.slice(5),
      requests: row.requests,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheCreationTokens: row.cacheCreationTokens,
      cacheReadTokens: row.cacheReadTokens,
      realTotalTokens: row.realTotalTokens,
      cost: row.totalCost,
    }));
  }
  const nowDate = new Date();
  const currentDay = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}-${String(
    nowDate.getDate(),
  ).padStart(2, '0')}`;
  const rows = Array.from({ length: 24 }, (_, hour) => ({
    key: `${currentDay}-${String(hour).padStart(2, '0')}`,
    label: `${String(nowDate.getMonth() + 1).padStart(2, '0')}/${String(nowDate.getDate()).padStart(
      2,
      '0',
    )} ${String(hour).padStart(2, '0')}:00`,
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    realTotalTokens: 0,
    cost: 0,
  }));
  for (const entry of entries) {
    const date = new Date(entry.createdAt || '');
    if (Number.isNaN(date.getTime())) continue;
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate(),
    ).padStart(2, '0')}`;
    if (day !== currentDay) continue;
    const current = rows[date.getHours()];
    current.requests += 1;
    current.realTotalTokens += Number(entry.realTotalTokens || entry.totalTokens || 0);
    current.cost += Number(entry.totalCost || 0);
    current.inputTokens += Number(entry.inputTokens || 0);
    current.outputTokens += Number(entry.outputTokens || 0);
    current.cacheReadTokens += Number(entry.cacheReadTokens || 0);
    current.cacheCreationTokens += Number(entry.cacheCreationTokens || 0);
  }
  return rows;
}

export function buildUsageTrendPointsFromDays(rows: UsageDay[]): UsageTrendPoint[] {
  return rows.map((row) => ({
    key: row.day,
    label: row.day.slice(5),
    requests: row.requests,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheCreationTokens: row.cacheCreationTokens,
    cacheReadTokens: row.cacheReadTokens,
    realTotalTokens: row.realTotalTokens,
    cost: row.totalCost,
  }));
}

export function aggregateUsageByModelMetric(
  entries: UsageEntry[],
  fallbackModels: ModelUsageRow[],
): ModelMetricRow[] {
  const sourceRows = entries.length ? aggregateUsageModels(entries) : fallbackModels;
  const totalTokens = sourceRows.reduce(
    (sum, row) => sum + Number(row.realTotalTokens || row.totalTokens || 0),
    0,
  );
  const palette = ['#31527d', '#f2b705', '#0f766e', '#7c3aed', '#ef6f91', '#22a7c7', '#f97316', '#64748b'];
  return sourceRows
    .filter((row) => row.requests > 0 || Number(row.realTotalTokens || row.totalTokens || 0) > 0)
    .sort(
      (a, b) =>
        b.requests - a.requests ||
        Number(b.realTotalTokens || b.totalTokens || 0) - Number(a.realTotalTokens || a.totalTokens || 0),
    )
    .map((row, index) => {
      const realTotalTokens = Number(row.realTotalTokens || row.totalTokens || 0);
      return {
        key: row.key,
        provider: row.provider,
        modelName: row.modelName,
        requests: row.requests,
        realTotalTokens,
        totalCost: Number(row.totalCost || 0),
        share: totalTokens > 0 ? (realTotalTokens / totalTokens) * 100 : 0,
        color: palette[index % palette.length],
      };
    });
}

export function buildModelBarSeries(
  rows: ModelMetricRow[],
  metric: keyof Pick<ModelMetricRow, 'requests' | 'realTotalTokens' | 'totalCost'>,
) {
  const visible = rows.slice(0, 8);
  const maxValue = Math.max(1, ...visible.map((row) => Number(row[metric] || 0)));
  return visible.map((row) => ({
    key: row.key,
    label: row.modelName,
    value: Number(row[metric] || 0),
    height: (Number(row[metric] || 0) / maxValue) * 100,
    color: row.color,
  }));
}

export function buildDonutRows(rows: ModelMetricRow[]): DonutMetricRow[] {
  const palette = ['#31527d', '#f2b705', '#0f766e', '#7c3aed', '#ef6f91', '#22a7c7'];
  const sourceRows = rows
    .filter((row) => Number(row.realTotalTokens || 0) > 0)
    .sort((a, b) => b.realTotalTokens - a.realTotalTokens);
  const topRows = sourceRows
    .slice(0, 5)
    .map((row, index) => ({ ...row, displayShare: 0, color: palette[index] }));
  const otherRows = sourceRows.slice(5);
  if (!otherRows.length) return normalizeDonutShares(topRows);
  const otherTokens = otherRows.reduce((sum, row) => sum + row.realTotalTokens, 0);
  const otherRequests = otherRows.reduce((sum, row) => sum + row.requests, 0);
  const otherCost = otherRows.reduce((sum, row) => sum + row.totalCost, 0);
  return normalizeDonutShares([
    ...topRows,
    {
      key: 'other',
      modelName: '其他',
      requests: otherRequests,
      realTotalTokens: otherTokens,
      totalCost: otherCost,
      share: 0,
      displayShare: 0,
      color: palette[5],
    },
  ]);
}

export function normalizeDonutShares(rows: DonutMetricRow[]): DonutMetricRow[] {
  const totalTokens = rows.reduce((sum, row) => sum + row.realTotalTokens, 0);
  if (totalTokens <= 0) return [];
  let usedShare = 0;
  const normalized = rows.map((row, index) => {
    const isLast = index === rows.length - 1;
    const share = isLast ? Math.max(0, 100 - usedShare) : (row.realTotalTokens / totalTokens) * 100;
    usedShare += share;
    return { ...row, share };
  });
  const displayShares = normalized.map((row) => Math.round(row.share * 10) / 10);
  if (displayShares.length) {
    const displayedBeforeLast = displayShares.slice(0, -1).reduce((sum, share) => sum + share, 0);
    displayShares[displayShares.length - 1] = Math.max(
      0,
      Math.round((100 - displayedBeforeLast) * 10) / 10,
    );
  }
  return normalized.map((row, index) => ({ ...row, displayShare: displayShares[index] || 0 }));
}

export function buildDonutSegments(rows: DonutMetricRow[]) {
  const visible = rows.length
    ? rows
    : ([{ key: 'empty', color: 'var(--settings-chart-empty)', share: 100, displayShare: 100 }] as DonutMetricRow[]);
  let offset = 25;
  return visible.map((row) => {
    const length = rows.length ? row.share : 100;
    const segment = {
      key: row.key,
      color: row.color,
      length,
      gap: Math.max(0, 100 - length),
      offset: -offset,
    };
    offset += length;
    return segment;
  });
}

export function formatDonutShare(value: number) {
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`;
}

export function formatDelta(value: number, ratio: number | null) {
  const sign = value >= 0 ? '+' : '-';
  const amount = formatCompactNumber(Math.abs(value));
  if (ratio === null) return `${sign}${amount}`;
  return `${sign}${amount} · ${sign}${Math.abs(ratio * 100).toFixed(1)}%`;
}

export function UsageTrendRechart({
  points,
  hourly,
}: {
  points: UsageTrendPoint[];
  hourly: boolean;
}) {
  if (!points.length)
    return (
      <div className="usage-trend-scroll">
        <div className="usage-trend-rechart empty">
          <p className="muted-copy">暂无趋势数据。</p>
        </div>
      </div>
    );
  const timelineTicks = pickTimelineTicks(points, 12);
  const chartMinWidth = hourly
    ? Math.max(760, points.length * 42)
    : Math.min(1320, Math.max(720, points.length * 68));
  const tooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload as UsageTrendPoint | undefined;
    return (
      <div className="usage-chart-tooltip">
        <strong>{label}</strong>
        <span>请求数：{formatFullNumber(row?.requests || 0)} 次</span>
        {payload.map(
          (entry: {
            color?: string;
            name?: string | number;
            dataKey?: string | number;
            value?: unknown;
          }) => (
            <em key={entry.dataKey} style={{ color: entry.color }}>
              <i style={{ background: entry.color }} />
              {entry.name}：
              {entry.dataKey === 'cost'
                ? formatUsd(Number(entry.value || 0))
                : formatFullNumber(Number(entry.value || 0))}
            </em>
          ),
        )}
      </div>
    );
  };
  return (
    <div className="usage-trend-scroll" aria-label="调用趋势时间线">
      <div className="usage-trend-rechart" style={{ minWidth: `${chartMinWidth}px` }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 10, right: 12, left: 0, bottom: 4 }}>
            <defs>
              <linearGradient id="usageInputFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="usageOutputFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="usageCacheCreationFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f97316" stopOpacity={0.18} />
                <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="usageCacheReadFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#a855f7" stopOpacity={0.18} />
                <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="var(--settings-chart-grid)"
              opacity={0.72}
            />
            <XAxis
              dataKey="label"
              ticks={timelineTicks}
              axisLine={false}
              tickLine={false}
              interval={0}
              minTickGap={0}
              height={42}
              tick={{ fill: 'var(--settings-chart-axis)', fontSize: 12 }}
              dy={10}
            />
            <YAxis
              yAxisId="tokens"
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'var(--settings-chart-axis)', fontSize: 12 }}
              tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`}
              width={48}
            />
            <YAxis
              yAxisId="cost"
              orientation="right"
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'var(--settings-chart-axis)', fontSize: 12 }}
              tickFormatter={(value) => `$${Number(value).toFixed(Number(value) >= 10 ? 0 : 2)}`}
              width={50}
            />
            <Tooltip
              content={tooltip}
              cursor={{
                stroke: 'var(--settings-chart-cursor)',
                strokeWidth: 1,
                strokeDasharray: '4 4',
                opacity: 0.35,
              }}
            />
            <Legend
              verticalAlign="bottom"
              height={32}
              iconType="circle"
              wrapperStyle={{ color: 'var(--settings-chart-legend)', fontSize: 12, paddingTop: 10 }}
            />
            <Area
              yAxisId="tokens"
              type="monotone"
              dataKey="inputTokens"
              name="输入 Tokens"
              stroke="#3b82f6"
              fill="url(#usageInputFill)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Area
              yAxisId="tokens"
              type="monotone"
              dataKey="outputTokens"
              name="输出 Tokens"
              stroke="#22c55e"
              fill="url(#usageOutputFill)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Area
              yAxisId="tokens"
              type="monotone"
              dataKey="cacheCreationTokens"
              name="缓存创建"
              stroke="#f97316"
              fill="url(#usageCacheCreationFill)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Area
              yAxisId="tokens"
              type="monotone"
              dataKey="cacheReadTokens"
              name="缓存命中"
              stroke="#a855f7"
              fill="url(#usageCacheReadFill)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Area
              yAxisId="cost"
              type="monotone"
              dataKey="cost"
              name="成本"
              stroke="#f43f5e"
              fill="none"
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={false}
              activeDot={{ r: 4 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function pickTimelineTicks(points: UsageTrendPoint[], maxTicks = 12) {
  const labels = points.map((point) => point.label);
  if (labels.length <= maxTicks) return labels;
  const selected = new Set<string>();
  const lastIndex = labels.length - 1;
  for (let index = 0; index < maxTicks; index += 1) {
    selected.add(labels[Math.round((index * lastIndex) / (maxTicks - 1))]);
  }
  return labels.filter((label) => selected.has(label));
}

export function UsageMiniStat({
  icon,
  label,
  value,
  accent = 'blue',
  muted = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: 'blue' | 'purple' | 'green';
  muted?: boolean;
}) {
  return (
    <div className={`usage-mini-stat ${accent} ${muted ? 'muted' : ''}`}>
      <span>
        {icon}
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}
// wjz新建文件结束。
