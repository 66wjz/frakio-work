<!-- wjz新建文件，新建原因：编写前端设计规范与Token体系手册，修改时间：2026-08-18。 -->
# Frakio Work 前端设计规范与 Design Token 体系手册

本文档为开发团队提供统一的 UI 设计规范、控件尺寸契约、层级网格标准与编码禁忌准则。

---

## 1. 核心设计原则

1. **功能导向与极简克制（Less, but better）**：
   - 界面元素必须具备明确的交互意图，消除冗余的装饰性噪音。
2. **像素级对齐（Pixel Perfection）**：
   - 同一行并排出现的所有操作控件（Input / Select / Button / SearchForm / CheckTag）必须统一采用 `--control-height-*` 变量，严禁出现因 padding 差异导致的高度错位。
3. **全局层级严格分层（Z-Index Hierarchy）**：
   - 彻底禁止在代码中随意硬编码 `z-index: 9999` 或 `z-index: 100` 等魔法数字，必须使用系统统一的层级 Token。

---

## 2. 核心 Design Token 规范

### 2.1 控件尺寸体系 (Control Heights)

| Token 变量 | 像素值 | 适用场景 |
| :--- | :--- | :--- |
| **`--control-height-sm`** | `28px` | 紧凑型控件：表格行内操作按钮、筛选小标签、微型徽标 |
| **`--control-height-md`** | `34px` | **默认标准尺寸**：绝大多数表单输入框、标准按钮、下拉选择框 |
| **`--control-height-lg`** | `42px` | 突出型控件：全宽提交按钮、全局主搜索框、登录门禁表单 |

### 2.2 圆角规范 (Border Radius)

| Token 变量 | 像素值 | 适用场景 |
| :--- | :--- | :--- |
| **`--control-radius-sm`** | `6px` | 内部小组件：Tooltip 气泡、Badge 标签、小按钮 |
| **`--control-radius-md`** | `8px` | 标准表单控件：BaseInput, BaseSelect, BaseButton |
| **`--control-radius-lg`** | `12px` | 容器级组件：BaseCard, BaseSection, BaseTabs 外框 |
| **`--control-radius-xl`** | `16px` ~ `20px` | 顶层弹窗：BaseModal, 对话气泡框 |
| **`--control-radius-full`**| `9999px` | 圆形头像、胶囊式标签（BaseCheckTag） |

### 2.3 全局层级分层 (Z-Index Hierarchy)

| Token 变量 | 数值 | 覆盖范围与说明 |
| :--- | :--- | :--- |
| **`--z-base`** | `1` | 基础层：页面内部的局部绝对定位元素 |
| **`--z-dropdown`** | `100` | 下拉菜单、二级选项浮层、AutoComplete 建议列表 |
| **`--z-sticky`** | `500` | 粘性吸顶栏、固定侧边栏、拖拽手柄 |
| **`--z-modal`** | `2000` | 标准模态对话框遮罩与弹窗内容 |
| **`--z-modal-nested`** | `2100` | 二级嵌套弹窗（如弹窗内触发的图片裁剪、确认框） |
| **`--z-tooltip`** | `3000` | 文字提示气泡（确保在弹窗之上依然正常悬停显示） |
| **`--z-toast`** | `9999` | 全局顶层通知、Toast 状态消息 |

---

## 3. 常见控件组合范式

### 3.1 工具栏并排对齐（SearchForm + Select + Button）
```tsx
<div className="flex items-center gap-2.5">
  {/* 所有控件自动保持 --control-height-md (34px) 高度并排对齐 */}
  <BaseInput prefixIcon="search" placeholder="搜索 Agent..." className="h-[var(--control-height-md)]" />
  <BaseSelect options={filterOptions} className="h-[var(--control-height-md)]" />
  <BaseButton variant="primary" icon="plus" className="h-[var(--control-height-md)]">创建 Agent</BaseButton>
</div>
```

### 3.2 表单字段标准化
```tsx
<BaseFormGroup label="Agent 描述" required helperText="简要描述 Agent 职责与定位">
  <BaseInput value={desc} onChange={setDesc} placeholder="例如：负责代码重构与审查" />
</BaseFormGroup>
```
<!-- wjz新建文件结束。 -->
