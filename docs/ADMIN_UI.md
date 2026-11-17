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
- **Do not stack transparency on top of `--content-meta`.** It is already the weakest ink step
  (0.6 alpha in dark). `color-mix(content-meta 80%, transparent)` lands at 0.48 white, which at
  12px is unreadable on a dark card. Labels get `--deep-text` at 600; notes get `--content-meta`
  at 400. Two levers, not three.
- **A heading never shares a line with its own description.** Two sizes on one baseline read as one
  sentence that was cut in half (「管理员认证 决定谁能登录后台」). Title, then description on the
  next line.
- **A placeholder holds an example, never a status.** Placeholders vanish on focus and cannot be
  selected; anything a reader needs to know must live in text. `4423412` is a placeholder,
  「未配置」 is not.
- **The machine identifier is part of the row.** Where a field's value will be copied elsewhere
  (env var names, slugs, file paths), show it in mono beside the label and copy on click. Do not
  bury it in an overflow menu — it is the page's output, not a hidden convenience.
- **A form that talks to a third party owes the user a check.** "Filled in" is not "works":
  a wrong key pair, a revoked install and a renamed branch all look identical in a form. Where
  the page holds credentials for something external, give it one action that really asks, and
  report each stage separately so the failing link is visible.

## 4. Colour

Two jobs, nothing else:

1. **`--primary` means "needs you".** Pending deploy, unsynced, a failed save. If a piece of UI is
   coloured and nothing is waiting for the user, that colour is wrong.
2. **`--destructive` means "this removes something".** Delete buttons, error states, failed
   writes. It never decorates.

Everything else is ink: `--deep-text` for titles, `--content-meta` for secondary copy, and a
hairline (`--line-divider`) for structure.

Colour may also mark **state**, provided it lands on the word or the icon and never on a filled
shape: `--success` = nothing left to do, `--primary` = waiting on you, `--destructive` = failed.
What stays banned is the *pill* — a filled rounded block behind a label. Five pills down a column
read as a legend nobody asked for; a green check beside 已配置 reads as a fact.

One exception: **diff lines.** In a side-by-side or unified diff, green/red encode "this line was
added / removed" — that is content, not taxonomy, and it is the only colour convention users
already know by heart. Use `--success` and `--destructive`; never a raw colour literal.

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

- Props: `title`, `meta?`, `dense?`, `bordered?`, `rail?` (snippet), `actions?` (snippet).
- One line. If it wraps, the page has too many controls in it — move a control into the rail or
  into a popover.
- `dense` exists for list pages, where the list is the content and the title is furniture.
- Below 1023px the title and meta are hidden: the mobile top bar already shows the page name.
  Actions stay unless the page can prove the top bar duplicates them.
- The header owns the bottom hairline, and it owns exactly one per screen. When a tab bar sits
  directly underneath, pass `bordered={false}` and let the tab bar draw the line — otherwise two
  hairlines end up a few dozen pixels apart.

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

## 5a. Long navigation

A page with more than about eight peer sections does not get a horizontal tab bar. Tabs that do
not fit get clipped, and a clipped tab strip with a hidden scrollbar means sections stop
existing for anyone without a trackpad — this happened to the settings page with 24 items.

Use a vertical rail instead:

- Fixed width (`13.5rem`), independent scroll, `border-right` against the content column.
- Group headings are 11px mono, sticky at the top of the rail, and not clickable.
- The active item gets a tinted background plus the accent colour; nothing else is tinted.
- The rail stacks vertically only when its content needs the height; it never pushes the content
  column wider than the remaining space.
- Below 1023px the rail collapses into a single `Select` at the top of the content column. One
  control, no horizontal scrolling, current item always visible.

The settings page is the reference implementation (`CONFIG_GROUPS` → `settingsGroups`).

## 6. Page skeleton

Every page is: `PageHeader` → optional `Toolbar` → one scroll region → optional footer.

`AdminPage` is now only a shell: card, one scroll region, optional footer, and it renders
`PageHeader` for its heading. It is not a header implementation of its own.

- Only the scroll region scrolls. Header, toolbar and footer are fixed.
- Every interactive element has a hover state the eye can catch. On dark surfaces a background
  step alone (`--btn-regular-bg` → `-hover`) moves one lightness stop and reads as nothing:
  pair it with a 1px inset ring or a border colour change. Inputs carry a resting border
  (`--input-border`), not a transparent one.
- A page may not add a second sticky bar, a second hairline, or its own padding overrides.
- Empty and error states live inside the scroll region and use `ui-btn` variants.

## 7. Actions

| Level | Style | Limit |
| :--- | :--- | :--- |
| Primary | `ui-btn ui-btn-primary` | at most one per page |
| Secondary | `ui-btn ui-btn-soft` | header actions |
| Tertiary | `ui-btn ui-btn-ghost` | reset, clear, cancel |
| Destructive | quiet text button, red on hover | editor header, confirm dialogs |

`ui-btn-sm` (36px) exists for a single action inside a dense row — a managed-key row, a table
cell. It is a size, not a level: pair it with one of the three variants above.

Destructive actions do not live in list rows. Deleting a post happens in the editor, where the
decision belongs; a row is for finding things.

Buttons are not links. A `<button>` never shows an underline — not in its resting state and not
on hover. Underlines are reserved for actual links (`<a href>`).

## 7a. Icon states (admin only)

Icon fill encodes selection state, and nothing else:

- A highlighted item uses the **solid** variant of its icon. Sidebar page options are the
  reference case: the active page renders the filled icon, the inactive pages render the
  outline variant.
- An icon that can never be highlighted always renders the **outline** variant.

This rule applies to the admin dashboard only; the public blog keeps its own conventions.

## 8. Forbidden list

These are the specific patterns this document exists to stop:

1. A new header implementation, or a new page-title size.
2. Tinted status pills.
3. A second full-width hairline on one screen.
4. Magic padding values that only make sense for one component (`0.8125rem`, `1.4375rem`).
5. Opacity used to de-emphasise text.
6. Coloured icons that encode a category rather than an action.
7. Icons without text in a header action group (kill the icon-only toolbar).
8. **Explanatory copy about the work itself.** Any sentence that only makes sense to whoever built
   the page: design rationale, refactor notes, review findings, mechanism names, "this replaces…",
   "not three fields", "it gates the next step". A screen carries three things and nothing else —
   **what this is, what to do, what happened**. Everything else goes in a code comment, a commit
   message, or this document.

   Bad → good:
   - 「一个地址，不是三个字段」→「文章提交到哪里」
   - 「前两环通了才能取」→「App 安装到哪个账号」
   - 「用于签发 JWT 的私钥」→「只保存在本地，不会上传」
   - 「用它签出的 JWT 会被 GitHub 校验」→「上传后需要点一次『验证连接』」

## 9. Migration

The order is deliberate: hardest page first, so the primitives get stress-tested before the easy
pages cement them.

1. `PageHeader` extracted; post list migrated (done).
2. Settings — four-section layout, the most bespoke surface.
3. Sync — migrated (done). Two panes inside one card: the header is the primitive, the left list
   repeats `ListRow`'s shape (title over mono path, status word at the right edge), and the right
   pane owns the only other horizontal rule on the screen.
4. Taxonomy — migrated (done). Its shell `AdminPage` now delegates the heading to the primitive,
   so the sessions and env pages inherit it in the same move; the list's status pills became
   words. Remaining debt: the page still sizes everything off its own `--tx-unit`.
5. Secrets — migrated (done). Nested cards are gone (the page is the card), the local `.btn`
   vocabulary was replaced by `ui-btn`, the "all configured" bar is ink and only the unfinished
   state is accent-coloured, and leak severities are words rather than tinted pills. The form
   itself: a group title never shares a line with its hint, each group carries a `done / total`
   count, each field shows its env var name in mono (click to copy), and placeholders hold
   format examples only — never status. The GitHub group can also **check the credentials against
   GitHub** (`POST`-free `GET /api/admin/secrets/probe`, 60s cache): sign a JWT, read the branch
   with an installation token, list installations, report each stage separately.
6. Links — migrated (done). Status is a word, the save bar's three coloured states collapsed into
   accent-for-unsaved and ink-for-saved, and two dead selectors were dropped.
7. History and the editor — migrated (done). These keep their own workspace bars rather than
   `PageHeader` — they hold a back button and a document title, not a page title. Both bars are
   now 72px tall with the gutter padding and one hairline, so switching between the two does not
   shift the layout, and their save/restore buttons are the same size.

## 10. Known debt

- `TaxonomyManager` still sizes everything from `--tx-unit`; it needs its own pass.
- `AdminDashboard` (the shell) still holds page-specific styles for several screens. They move
  into their pages as those pages are touched.
- The handshake receipt is written server-side and is Chinese-only, same as the `description`
  fields in `admin-secrets.ts`. Localising it means returning structured facts instead of a
  sentence — worth doing only if the admin is ever meant to run in another language.

Each migration is one branch, one commit, with before/after screenshots. A page is migrated
when it imports the primitives and passes without local overrides.
