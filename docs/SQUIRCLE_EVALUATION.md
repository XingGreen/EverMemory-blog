# C1 连续曲线圆角（squircle）方案评估

> 依据 AGENTS.md「先给方案再写代码」：本文只评估，不改代码。
> 待用户确认后再实施。

## 一、现状

- 全项目 **293 处** `border-radius` 声明，分布在 40+ 文件。
- 圆角令牌在 `src/styles/variables.styl` 第 253–259 行：
  `--radius-sm: 0.25rem` / `md: 0.375rem` / `lg: 0.5rem` / `xl: 0.75rem` /
  `2xl: 1rem` / `3xl: 1.5rem` / `full: 9999px`，另有 `--radius-large: 1rem`。
- **未实现任何 squircle**（`squircle` / `corner-shape` 全库零命中）。
- `docs/ADMIN_UI.md` 未对圆角形状作规定，只涉及尺寸。

## 二、技术能力实测

在本机 headless Chrome **157.0** 上实测：

| 特性 | 结果 |
| :--- | :--- |
| `corner-shape: squircle` | **支持**（`CSS.supports` 返回 true） |
| `border-shape` | 不支持（草案，未实现） |
| `clip-path` / `mask-image` | 支持 |

### 这意味着什么

`corner-shape` 是 **CSS Borders Level 4** 的新属性，Chrome 139+ 原生支持。
它**不需要** replaces `border-radius`，而是**修饰**它：

```css
border-radius: 1rem;
corner-shape: squircle;   /* 把圆锥曲线的圆角变成超椭圆 */
```

一个属性就能把全站圆角从「圆弧」变成「连续曲线」，无需 SVG、无需 JS、无额外 DOM、无性能成本。

## 三、三种方案对比

### 方案 A：原生 `corner-shape`（推荐）

```css
/* variables.styl 或 ui-base.css */
:root {
  --corner-shape: squircle;
}
/* 在需要的地方批量应用 */
```

**优点**
- 零依赖、零运行时、零 DOM 变更、零性能开销
- 渐变背景、边框、阴影、`overflow:hidden` 子元素裁剪全部自动正确
  （mask / clip-path 方案在这些地方会露馅）
- 仅新增一行属性，不动现有 `border-radius`

**缺点**
- **浏览器支持窄**：Chrome 139+ / Edge 139+；Firefox、Safari **全部不支持**
- 不支持时**优雅降级**为普通圆角（属性被忽略），不会破坏布局
- 属于较新的 CSS 特性，规范尚未完全定稿

### 方案 B：SVG mask / clip-path superellipse

用超椭圆路径做 `clip-path` 或 `mask-image`。

**优点**：所有现代浏览器都支持，效果一致。

**缺点**（这些是硬伤，不是偏好问题）
- `clip-path` **会裁掉 box-shadow**，全站卡片投影会消失
- `mask-image` 会创建新的合成层，**大量元素时性能下降明显**
- 边框会被裁成不完整（`border` 在裁剪边缘显示为半透明）
- `overflow: hidden` 的滚动容器 + mask 组合在部分浏览器有渲染 bug
- 293 处若逐一改造，工作量与风险都极高

### 方案 C：混合（原生优先 + 降级）

```css
.card {
  border-radius: 1rem;
  corner-shape: squircle;   /* Chrome/Edge 生效 */
}
```

本质是方案 A —— 因为**不支持时自动降级**，不需要额外写降级代码。

## 四、建议

**推荐方案 A（原生 `corner-shape`）**，理由：

1. 本项目的后台（`/admin/`）是内部工具，用户就是站点所有者本人，
   **浏览器可控**；前台面向公众，但降级为普通圆角完全可接受。
2. 零成本、零风险：属性不被支持时浏览器直接忽略，不会出现布局崩坏。
3. 可随时回退：删掉一行属性即可。

### 实施范围建议

**只做后台（`/admin/`）**，不动前台。原因：

- 前台是公开页面，访客浏览器不可控；虽能降级，但「部分访客看到 squircle、部分看到圆弧」
  会造成视觉不一致。前台圆角属于主题的一部分，改动应由主题层面决定。
- 后台是内部工具，统一 squircle 能形成一致的「专业工具」观感。

### 实施方式

不改 293 处 `border-radius`，只在**少数几个聚合点**加属性：

1. `src/styles/admin.css` —— 后台全局容器、卡片、按钮
2. `src/styles/ui-base.css` —— 通用控件（`.ui-input` 等）
3. `src/components/admin/ui/` —— 三个原语组件

这样改动点约 5–8 处，而不是 293 处。

## 五、需要你确认的三点

1. **范围**：只做后台，还是前台也做？
   （推荐只做后台，见上）
2. **是否接受浏览器限制**：Firefox / Safari 用户会看到普通圆角。
   （后台内部工具通常可接受）
3. **圆角尺寸是否一并调整**：squircle 在相同 `border-radius` 下**视觉上比圆弧更圆**，
   可能需要把 `--radius-*` 略微调小 1–2px 才与现在观感一致。
   这是可选优化，不做也能用。

确认后我再动代码。
