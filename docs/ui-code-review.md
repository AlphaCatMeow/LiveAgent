# UI 代码审查报告

> 审查范围：`crates/agent-gui/src/components/ui/` + 相关页面组件  
> 审查日期：2026-05-26  
> 重构基准：Base UI + shadcn/ui 模式

---

## 一、可访问性（A11y）

### 🔴 高优先级

**confirm-action-popover.tsx — 自定义 Popover 缺少焦点管理**

当前实现用 CSS 定位的 `div` 模拟弹出层，存在以下问题：
- 无焦点陷阱：键盘用户打开弹窗后，焦点不锁定在弹窗内
- 无 `role="dialog"` 或 `role="alertdialog"` ARIA 角色
- 无 `aria-modal="true"`
- 按 `Esc` 不关闭弹窗

**建议**：替换为 Base UI `Popover` 组件（已内置焦点管理和键盘交互）：
```tsx
import { Popover } from "@base-ui-components/react";
```

---

**pages/chat/ChatHeader.tsx — 模型选择下拉菜单无 `aria-label`**

`DropdownMenuTrigger` 的 `render` 元素（Button）未设置 `aria-label`，屏幕阅读器无法知晓其用途。

**建议**：
```tsx
<DropdownMenuTrigger
  render={<Button aria-label="选择模型" ... />}
>
```

---

### 🟡 中优先级

**`DropdownMenuItem`、`DropdownMenuCheckboxItem` 无 `role` 声明**

Base UI `Menu.Item` 已自动添加 `role="menuitem"`，但需验证在所有浏览器/AT 中行为正确。重构后应运行 VoiceOver / NVDA 测试。

**NotifyToast（components/chat/NotifyToast.tsx）— 无 `role="alert"`**

Toast 用于错误/警告通知，但没有 `role="alert"` 或 `aria-live="assertive"` 属性，屏幕阅读器不会主动朗读。

**建议**：
```tsx
<div role="alert" aria-live="assertive">
  {/* toast content */}
</div>
```

---

## 二、组件实现问题

### 🔴 高优先级

**select.tsx — SelectValue placeholder 实现为"赌博式"渲染**

当前实现：
```tsx
(value: unknown) => (value == null ? placeholder : undefined)
```
当 value 不为 null 时返回 `undefined`，依赖 Base UI 内部回退到 ItemText 的行为。这是未文档化的行为，Base UI 版本升级可能静默破坏占位符显示。

**建议**：改用 Base UI 官方推荐模式，或在 `Select.Root` 层追踪选中项 label 来渲染：
```tsx
// 使用 items prop 让 Select.Value 自动显示 label
<Select.Root items={{ value1: "Label 1", value2: "Label 2" }}>
  <Select.Value />
```

---

**button.tsx — render prop 使用 `as any` 绕过类型检查**

```tsx
const rp = renderProp as React.ReactElement<any>;
```
类型不安全，且 Base UI 的 `mergeProps` 行为与 `React.cloneElement` 不完全一致，可能导致事件组合遗漏。

**建议**：待 `@base-ui-components/react` 迁移至正式版 `@base-ui/react` 后，使用官方 `useRender` hook 替代手动 cloneElement。

---

### 🟡 中优先级

**`@base-ui-components/react` 已弃用，应迁移至 `@base-ui/react`**

```
WARN deprecated @base-ui-components/react@1.0.0-rc.0: Package was renamed to @base-ui/react
```

两个包的 API 基本一致，但应尽快迁移：
```bash
pnpm remove @base-ui-components/react
pnpm add @base-ui/react
# 全局替换 import 路径
```

---

**dropdown-menu.tsx — DropdownMenuLabel 不使用 `Menu.GroupLabel`**

当前 `DropdownMenuLabel` 是裸 `div`，没有与 `Menu.Group` 关联，屏幕阅读器无法将标签与后续菜单项关联。

**建议**：
```tsx
export const DropdownMenuGroup = Menu.Group;
export const DropdownMenuLabel = React.forwardRef<...>(
  (props, ref) => <Menu.GroupLabel ref={ref} {...props} />
);
// 使用时：
<DropdownMenuGroup>
  <DropdownMenuLabel>模型选择</DropdownMenuLabel>
  <DropdownMenuItem>...</DropdownMenuItem>
</DropdownMenuGroup>
```

---

**ChatHistorySidebar.tsx — 事件组合依赖未文档化行为**

```tsx
<DropdownMenuTrigger
  render={<Button onPointerDown={(e) => e.stopPropagation()} />}
>
```
Base UI 的 `render` prop 通过 `mergeProps` 组合事件，但未明确文档化 `stopPropagation` 后 Base UI 自身的事件是否仍然触发。

**建议**：通过在 wrapper 容器上使用 `stopPropagation` 替代在 Trigger 上处理：
```tsx
<span onPointerDown={(e) => e.stopPropagation()}>
  <DropdownMenuTrigger ...>
    ...
  </DropdownMenuTrigger>
</span>
```

---

### 🟢 低优先级

**scroll-area.tsx — Base UI ScrollArea.Content 的必要性待确认**

```tsx
<ScrollAreaPrimitive.Viewport>
  <ScrollAreaPrimitive.Content>{children}</ScrollAreaPrimitive.Content>
</ScrollAreaPrimitive.Viewport>
```
Base UI 文档中 `ScrollArea.Content` 是否为必须层级需要验证，可能导致额外 DOM 嵌套。

---

## 三、缺失的标准组件

| 缺失组件 | 当前状况 | 建议 |
|---|---|---|
| **Dialog / Modal** | 每处自实现（HistoryShareModal 等） | 从 shadcn/ui 添加 `Dialog` 组件 |
| **Toast** | `NotifyToast` 是自定义实现 | 使用 Base UI `Toast` 组件替代 |
| **Tooltip** | 无 | 从 shadcn/ui 或 Base UI 添加 |
| **Popover** | `ConfirmActionPopover` 自实现 | 替换为 Base UI `Popover` |

---

## 四、样式一致性

**`ConfirmActionPopover` 使用 CSS 类手动处理方向**

```tsx
// 当前
flipUp ? "bottom-full mb-2" : "top-full mt-2"
```
应由 Popover 库的 `side` 和 `sideOffset` 自动处理碰撞检测。

**部分组件使用 `className` 字符串拼接而非 `cn()`**

MemoryPanel 中的 `triggerClass` 和 item className 使用 `.join(" ")` 代替 `cn()`，无法自动处理 Tailwind 类冲突：
```tsx
// 当前
className={["class-a", condition && "class-b"].filter(Boolean).join(" ")}
// 建议
className={cn("class-a", condition && "class-b")}
```

---

## 五、重构后待验证事项

- [ ] Select 打开/关闭动画（data-[open] / data-[closed] 属性验证）
- [ ] DropdownMenu 键盘导航（↑↓ 导航、Enter 选择、Esc 关闭）
- [ ] ScrollArea 自定义滚动条显示
- [ ] Button render prop 在 `<a>` 链接场景下的样式渲染
- [ ] MemoryPanel DrawerSelect 宽度跟随触发元素（`--anchor-width` CSS 变量）
- [ ] 模型选择下拉菜单在 ChatHeader 中的交互
