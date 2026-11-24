# D1 后台目录分类审计

> 排查项，产出结论而非代码。审计时间 2026-11-25。

## 一、现状

`src/components/admin/` 共 **37 个文件**，其中 **34 个平铺在根目录**，只有 3 个在子目录：

```
admin/
├── admin/                    34 个文件（平铺）
│   ├── AdminDashboard.svelte      5664 行
│   ├── PostEditor.svelte          2437 行
│   ├── TaxonomyManager.svelte     1700 行
│   ├── SecretManager.svelte       1641 行
│   ├── PostList.svelte            1526 行
│   └── …（其余 29 个）
├── ui/                        2 个（FloatField、PageHeader）
└── secrets/                   1 个（SecretFields）
```

### 项目自身约定

`docs/ARCHITECTURE.md` 第 77 行写的是：

> `src/components/` | **Domain-grouped components**; admin under `src/components/admin/`

其他目录确实按领域分组了（`common/` 8 个、`controls/` 7 个、`pages/` 9 个），
**但 `admin/` 自己没有分组** —— 37 个文件里 34 个堆在一起。

## 二、问题

不是「文件多」本身，而是**同一个目录里混着四种完全不同的东西**：

| 类别 | 例子 | 特征 |
| :--- | :--- | :--- |
| 页面级容器 | `AdminDashboard.svelte`(5664)、`PostEditor.svelte`(2437)、`PostList.svelte`(1526) | 只被路由引用，几百到几千行，含数据加载 |
| 业务页面 | `TaxonomyManager`、`SecretManager`、`LinksPage`、`SyncPage`、`SessionManager` | 被 Dashboard 按路由挂载 |
| 通用控件 | `Select`、`Checkbox`、`DatePicker`、`ConfirmDialog`、`Skeleton`、`TurnstileWidget` | 与后台业务无关，可复用 |
| 领域片段 | `PostMetaBar`、`AdminPostStats`、`PostEditorTocPanel`、`PostEditorFmPanel` | 只服务单一业务 |

后果具体有三条：

1. **找文件靠记忆**。想找「日期选择器」得知道它叫 `DatePicker.svelte` 且在根目录，
   没有「控件都在 ui/」这种可预测的位置。
2. **`ui/` 名不副实**。它只有 2 个文件，而真正通用的 `Select`/`Checkbox`/`DatePicker`/
   `ConfirmDialog`/`Skeleton` 却留在根目录 —— 想复用的人会先看 `ui/`，然后找不到。
3. **大文件与小组件混放**。`AdminDashboard.svelte` 5664 行和 `page-intro.svelte.ts` 23 行
   是同一个目录的兄弟，没有任何视觉或工具上的区分。

## 三、建议分类

按**职责**而非按业务名分组，与项目其他目录的做法一致：

```
admin/
├── pages/         页面级容器（路由直接挂载，含数据加载）
│   ├── AdminDashboard.svelte
│   ├── PostEditor.svelte
│   ├── PostList.svelte
│   ├── PostHistoryPage.svelte
│   ├── TaxonomyManager.svelte
│   ├── SecretManager.svelte
│   ├── LinksPage.svelte
│   ├── SyncPage.svelte
│   ├── SessionManager.svelte
│   └── ConfigEditor.svelte / SettingsOverview / SettingsEditor / RuntimeConfigPanel
├── ui/            通用控件（与业务无关，可跨页面复用）
│   ├── Select.svelte / Checkbox.svelte / DatePicker.svelte
│   ├── ConfirmDialog.svelte / DeleteConfirmModal.svelte / Skeleton.svelte
│   ├── TurnstileWidget.svelte
│   ├── FloatField.svelte / PageHeader.svelte（已在 ui/）
│   └── AdminPage.svelte / page-intro.svelte.ts
├── editor/        文章编辑器专用片段
│   ├── PostEditorWritePanel.svelte / PostEditorFmPanel.svelte / PostEditorTocPanel.svelte
│   ├── PostMetaBar.svelte / AdminPostStats.svelte
│   ├── DraftConflictDialog.svelte
│   └── postEditorContext.ts
├── secrets/       （已有）SecretFields.svelte
└── shell/         外壳与全局
    ├── AdminEntryVeil.svelte / OnboardingTour.svelte / LoginGate.svelte
    └── SyncHistory.svelte
```

### 分类依据（不是审美，是可验证的规则）

- **`pages/`**：被 `src/pages/admin/` 的路由或 `AdminDashboard` 直接挂载，
  且自身负责取数。实测这批文件「被引用次数」都是 0 或 1。
- **`ui/`**：被 ≥2 个不同业务引用，且文件名不含业务词
  （`Select` 被引用 3 次、`ConfirmDialog` 5 次、`Skeleton` 4 次、`PageHeader` 4 次）。
- **`editor/`**：只服务文章编辑，且文件名含 `PostEditor`/`Post`。
- **`shell/`**：与具体页面无关、作用于整个后台的全局组件。

## 四、代价与收益

| | 说明 |
| :--- | :--- |
| **改动量** | 移动约 30 个文件 + 修正 import 路径。无逻辑改动。 |
| **风险** | 低——纯文件移动，`pnpm check` 会立刻暴露漏改的 import。 |
| **收益** | 位置可预测；`ui/` 名副其实；大文件与控件分开。 |
| **不做也可以** | 现状不影响功能，只是长期维护成本。 |

## 五、结论

**建议做，但优先级低于功能缺陷。** 理由：

1. 这是一次纯结构重整，不改变行为，可以随时做、也随时能回退。
2. 但它会动 30 个文件的 import 路径，**与正在进行的任何功能改动都会冲突**。
   最适合的时机是所有功能项收尾后、单独一个提交完成。

**如果现在做**，我会：先 `git mv` 移动，再跑 `pnpm check` 逐个修 import，
最后用一次 `pnpm build` 确认没有遗漏的运行时引用。全程不动任何组件内部逻辑。

**需要你决定**：现在做，还是等功能项收尾后单独做？
