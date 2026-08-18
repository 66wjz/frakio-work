<!-- wjz新建文件，新建原因：编写前端基础与复合组件库使用指南 BASE_COMPONENTS_GUIDE.md，修改时间：2026-08-18。 -->
# Frakio Work 前端基础组件与复合组件使用指南

## 1. 概述

本文档全面规范 Frakio Work 前端基础组件（Base Components）、复合业务布局组件（Composite Components）与统一图标体系（BaseIcon）的属性契约、设计 Token 与调用范式，确保二次开发过程中的 UI 风格统一、响应式体验优秀与高可复用性。

---

## 2. 组件全景索引表

### 2.1 原子基础组件 (`components/base/`)

| 组件名称 | 源文件路径 | 核心用途与特性 |
| :--- | :--- | :--- |
| **`BaseIcon`** | `components/base/BaseIcon.tsx` | **★ 全局统一图标中心**。聚合 80+ 个 Lucide 矢量图标与项目专属 SVG（`hermes`, `pi`, `codex`, `claude`, `brand-logo` 等），支持统一 `size`、`color`、`clickable` 与 `spinning`。 |
| **`BaseButton`** | `components/base/BaseButton.tsx` | 标准按钮。支持 `primary`, `secondary`, `outline`, `ghost`, `danger` 五种变体与 `sm`, `md`, `lg` 尺寸，内置 loading 态与前后缀图标插槽。 |
| **`BaseInput`** | `components/base/BaseInput.tsx` | 标准输入控件。支持单行 Input、多行 Textarea、前缀/后缀图标、一键清除 `clearable` 与错误辅助文案 `helperText`。 |
| **`BaseSelect`** | `components/base/BaseSelect.tsx` | 自定义下拉选择框。支持 `options` 数据驱动与 `children` 自定义选项，自动统一操作系统原生边框与焦点动效。 |
| **`BaseBadge`** | `components/base/BaseBadge.tsx` | 状态标签与徽标。支持 `neutral`, `primary`, `success`, `warning`, `error`, `info` 六大色系变体与发光状态圆点 `dot`。 |
| **`BaseCard`** | `components/base/BaseCard.tsx` | 结构化卡片容器。包含 `BaseCardHeader`, `BaseCardTitle`, `BaseCardDescription`, `BaseCardContent`, `BaseCardFooter` 完整子组件。 |
| **`BaseModal`** | `components/base/BaseModal.tsx` | 标准模态对话框。基于 Radix UI Dialog 封装，支持多级 `maxWidth`（`sm` ~ `full`）、磨砂遮罩、平滑缩放动画与底部动作区。 |
| **`BaseTooltip`** | `components/base/BaseTooltip.tsx` | 轻量文字提示气泡。支持四个方位 `side`、对齐方式 `align` 与毫秒级延迟控制 `delayDuration`。 |
| **`BaseAlert`** | `components/base/BaseAlert.tsx` | 提示与警告横幅。支持 `info`, `success`, `warning`, `error`，可选关闭按钮与自定义图标。 |
| **`BaseCheckbox`** | `components/base/BaseCheckbox.tsx` | 标准复选框。支持双向绑定、自定义主标签 `label` 与辅助描述 `description`。 |
| **`BaseAvatar`** | `components/base/BaseAvatar.tsx` | 用户/Agent 头像。支持真实图片、首字/中文拼音缩写自适应、柔和纯色背景与四色在线状态角标（`online`, `busy`, `away`, `offline`）。 |
| **`BaseEmptyState`** | `components/base/BaseEmptyState.tsx` | 统一空状态插画。支持主副文案、专属大图标与快捷操作按钮插槽 `action`。 |
| **`BaseSpinner`** | `components/base/BaseSpinner.tsx` | 统一加载指示器。支持尺寸定制、居中容器 `center` 与说明文字 `label`。 |
| **`BaseFormGroup`** | `components/base/BaseFormGroup.tsx` | 表单字段封装。支持垂直 `vertical` 与水平 `horizontal` 布局，自动管理必填星号与校验错误提示。 |
| **`BaseCheckTag`** | `components/base/BaseCheckTag.tsx` | 可切换胶囊芯片。适用于多选标签、分类过滤与模型能力多选场景。 |

---

### 2.2 复合业务布局组件 (`components/composite/`)

| 组件名称 | 源文件路径 | 核心用途与特性 |
| :--- | :--- | :--- |
| **`BaseTabs`** | `components/composite/BaseTabs.tsx` | 选项卡切换器。支持 `pill`（胶囊式）、`underline`（下划线式）、图标徽标与响应式切换。 |
| **`BaseSection`** | `components/composite/BaseSection.tsx` | 页面独立功能分区。标配左侧主标题/副标题、左侧装饰图标与右侧操作按钮区 `extra`。 |
| **`BaseToolbar`** | `components/composite/BaseToolbar.tsx` | 列表与工作台顶部工具栏。自动支持左侧操作按钮群与右侧搜索筛选器插槽。 |
| **`BaseSearchForm`** | `components/composite/BaseSearchForm.tsx` | 结构化搜索表单。内置防抖输入、清除按钮、回车搜索与重置逻辑。 |
| **`BasePagination`** | `components/composite/BasePagination.tsx` | 分页条。支持上一页/下一页、总条数汇总与极简自适应。 |
| **`BaseSettingsLayout`** | `components/composite/BaseSettingsLayout.tsx` | 设置中心标准分栏布局。左侧按 `group` 分组的可滚动菜单 + 右侧带 Header 的内容主面板。 |

---

## 3. 典型使用范例

### 3.1 统一图标 (`BaseIcon`)
```tsx
import { BaseIcon } from '@/components/base';

// 1. 常用矢量图标
<BaseIcon name="sparkles" size={16} />
<BaseIcon name="settings" size={14} clickable onClick={openSettings} />
<BaseIcon name="loader-circle" size={18} spinning />

// 2. 运行时专属 SVG 图标
<BaseIcon name="hermes" size={20} />
<BaseIcon name="pi" size={20} />
<BaseIcon name="codex" size={20} />
<BaseIcon name="claude" size={20} />
<BaseIcon name="brand-logo" size={24} />
```

---

### 3.2 基础按钮与表单控件
```tsx
import { BaseButton, BaseInput, BaseFormGroup, BaseSelect } from '@/components/base';

<BaseFormGroup label="Agent 名称" required error={errors.name}>
  <BaseInput
    value={form.name}
    onChange={(e) => setForm({ ...form, name: e.target.value })}
    placeholder="请输入 Agent 名称"
    prefixIcon="bot"
    clearable
  />
</BaseFormGroup>

<BaseFormGroup label="默认运行内核">
  <BaseSelect
    value={form.runtime}
    onChange={(e) => setForm({ ...form, runtime: e.target.value })}
    options={[
      { label: 'Hermes Agent (生活长期记忆与进化)', value: 'hermes' },
      { label: 'Pi Runtime (编码与高阶工具调度)', value: 'pi' },
    ]}
    prefixIcon="cpu"
  />
</BaseFormGroup>

<div className="flex gap-2">
  <BaseButton variant="primary" icon="send" loading={isSubmitting} onClick={handleSubmit}>
    保存配置
  </BaseButton>
  <BaseButton variant="secondary" onClick={handleCancel}>
    取消
  </BaseButton>
</div>
```

---

### 3.3 设置中心左右分栏布局 (`BaseSettingsLayout`)
```tsx
import { BaseSettingsLayout } from '@/components/composite';

<BaseSettingsLayout
  activeId={activeTab}
  onSelectNav={setActiveTab}
  title="系统设置中心"
  description="管理全局模型、Agent 团队组织、记忆进化与多运行时通道。"
  navItems={[
    { id: 'general', label: '通用与外观', icon: 'palette', group: '基本配置' },
    { id: 'models', label: '模型中心', icon: 'cpu', group: '基本配置' },
    { id: 'org', label: '团队 Agent', icon: 'users', group: '运行与 Agent' },
    { id: 'hermes', label: 'Hermes 运行时', icon: 'hermes', group: '运行与 Agent' },
    { id: 'monitoring', label: '用量与监控', icon: 'gauge', group: '系统' },
  ]}
>
  {/* 右侧渲染具体页面 */}
  {activeTab === 'general' && <GeneralSettings />}
  {activeTab === 'models' && <ModelCenter />}
</BaseSettingsLayout>
```

---

## 4. 样式设计 Token 契约

所有组件深度绑定 CSS 变量，确保自动无缝适配系统的 **浅色（Light）、深色（Dark）与空间主题（Space Theme）**：

- **主色调**：`var(--mac-accent)`
- **背景与卡片**：`var(--mac-card-bg)`、`var(--mac-surface)`、`var(--mac-surface-muted)`
- **边框与分割线**：`var(--mac-border)`
- **文字与次要文案**：`var(--mac-text)`、`var(--mac-text-muted)`
<!-- wjz新建文件结束。 -->
