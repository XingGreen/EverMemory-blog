# Admin UI Standards

The dashboard's own design system. It replaced "copy whatever the reference project did" as the
source of truth on 2026-11-10. When this document and an existing component disagree, the
component is wrong.

Scope: everything under `/admin/` — pages, panels, modals, editors. The public blog is out of
scope and keeps its own hue-driven theme.

## 1. Why this file exists

The dashboard grew from four different page-header implementations and four page-title sizes
(28 / 24 / 21 / 20px), because each page was copied from a different screen of the reference
project. Copying a screen copies its result, not its reason, so every page was locally sensible
and collectively incoherent.

The fix is not "try harder per page". It is: define the vocabulary once, implement it once, and
make pages fill it in.

## 2. Tokens

Defined in `src/styles/admin.css` and inherited by everything inside `.admin-shell`.
Components must not invent local substitutes.

| Token | Value | Use |
| :--- | :--- | :--- |
| `--admin-gutter` | `1.5rem` | page horizontal padding; list rows bleed to it |
| `--admin-block-gap` | `1.25rem` | vertical gap between page blocks |
| `--admin-fs-page` | `1.75rem` | page title (default) |
| `--admin-fs-page-dense` | `1.3125rem` | page title on list pages only |
| `--admin-fs-item` | `1.0625rem` | row / card title |
| `--admin-fs-body` | `0.875rem` | buttons, inputs, dialogs |
| `--admin-fs-meta` | `0.75rem` | secondary copy, descriptions |
| `--admin-fs-data` | `0.6875rem` | machine data, always with `--font-mono` |

Spacing is a closed set: **4 / 8 / 12 / 16 / 24 / 32 px** (`0.25 / 0.5 / 0.75 / 1 / 1.5 / 2rem`).
A value outside this set needs a comment explaining why the scale cannot express it.

## 3. Typography

Five sizes, no others. A sixth size is how the drift started.

| Role | Size / weight | Notes |
| :--- | :--- | :--- |
| Page title | 28 / 650 | 21 / 650 on list pages (`dense`) |
| Row title | 17 / 600 | one per row, truncates with ellipsis |
| Body | 14 / 400 | buttons, inputs, dialog copy |
| Meta | 12 / 400 | descriptions, field labels |
| Data | 11 / 400, mono | dates, counts, slugs, extensions, hashes |

Rules:

- **Chinese text never gets negative letter-spacing.** Latin titles may use `-0.01em`.
- **Mono is for machine output only.** Categories, descriptions and titles stay in the sans stack
  even though the CJK glyphs would fall back to sans anyway — the intent is what matters.
- Weight carries hierarchy before colour does. Do not use opacity to de-emphasise text; use the
  meta size or `--content-meta`.

## 4. Colour

Two jobs, nothing else:

1. **`--primary` means "needs you".** Pending deploy, unsynced, a failed save. If a piece of UI is
   coloured and nothing is waiting for the user, that colour is wrong.
2. **`--destructive` means "this removes something".** Delete buttons, error states, failed
   writes. It never decorates.

Everything else is ink: `--deep-text` for titles, `--content-meta` for secondary copy, and a
hairline (`--line-divider`) for structure.

Forbidden:

- Status pills with a tinted background (the green/amber/blue badge set). Status is a word, set
  in the type scale, optionally in `--primary` when it is asking for action.
- Colour as taxonomy. Category, language and file type are data, not colour codes.
- Gradients on chrome. They belong to content (cover images), not to buttons or cards.

## 5. Primitives

Three components in `src/components/admin/ui/`. Pages import them; pages do not restyle them.

### `PageHeader`

```
[ title (28 | 21) ]  [ rail: filters, inline ] ...... [ actions: search, buttons ]
──────────────────────────────────────────────────────────────────────────────
```

- Props: `title`, `meta?`, `dense?`, `rail?` (snippet), `actions?` (snippet).
- One line. If it wraps, the page has too many controls in it — move a control into the rail or
  into a popover.
- `dense` exists for list pages, where the list is the content and the title is furniture.
- Below 1023px the title and meta are hidden: the mobile top bar already shows the page name.
  Actions stay unless the page can prove the top bar duplicates them.
- The header owns the bottom hairline. Nothing else on a page draws a full-width rule.

### `Toolbar`

Filters and sort, one row, immediately under the header. Collapsible; collapsed by default when
it holds two or more controls and the page has fewer than ~20 rows.

- Controls are 36px tall, `--admin-fs-meta`, 8px radius.
- Labels stay visible. Two selects both reading "All" are indistinguishable without them —
  this is worth the width.

### `ListRow`

```
title                                                      state
description                                  ·  category · .md      time
```

- Desktop: two-column grid, `1fr` plus a fixed rail (`--post-rail-w`).
- The rail holds machine data only: state word on top, relative time below, right-aligned, mono.
- Narrow screens: one column; title, description, meta line, then a row of state + actions.
- Hover swaps the rail for the row's actions. Keyboard does the same through `:focus-within`;
  touch shows both at once.

## 6. Page skeleton

Every page is: `PageHeader` → optional `Toolbar` → one scroll region → optional footer.

- Only the scroll region scrolls. Header, toolbar and footer are fixed.
- A page may not add a second sticky bar, a second hairline, or its own padding overrides.
- Empty and error states live inside the scroll region and use `ui-btn` variants.

## 7. Actions

| Level | Style | Limit |
| :--- | :--- | :--- |
| Primary | `ui-btn ui-btn-primary` | at most one per page |
| Secondary | `ui-btn ui-btn-soft` | header actions |
| Tertiary | `ui-btn ui-btn-ghost` | reset, clear, cancel |
| Destructive | quiet text button, red on hover | editor header, confirm dialogs |

Destructive actions do not live in list rows. Deleting a post happens in the editor, where the
decision belongs; a row is for finding things.

## 8. Forbidden list

These are the specific patterns this document exists to stop:

1. A new header implementation, or a new page-title size.
2. Tinted status pills.
3. A second full-width hairline on one screen.
4. Magic padding values that only make sense for one component (`0.8125rem`, `1.4375rem`).
5. Opacity used to de-emphasise text.
6. Coloured icons that encode a category rather than an action.
7. Icons without text in a header action group (kill the icon-only toolbar).

## 9. Migration

The order is deliberate: hardest page first, so the primitives get stress-tested before the easy
pages cement them.

1. `PageHeader` extracted; post list migrated (done).
2. Settings — four-section layout, the most bespoke surface.
3. Sync — list plus detail pane.
4. Taxonomy — table-ish list with inline editing.
5. Secrets — dense forms.
6. Links — the friend-links manager.
7. History and the editor — these have their own top bars; align them last.

Each migration is one branch, one commit, with before/after screenshots. A page is migrated
when it imports the primitives and passes without local overrides.
