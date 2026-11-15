# Project Rules

Full form of the rules summarized in [`AGENTS.md`](../AGENTS.md).

## Workflow (overrides everything else in this file)

Set by the repository owner on 2026-11-10. Where these three rules conflict with any other
section here, in `AGENTS.md`, in `docs/`, or with practice carried over from earlier sessions,
these rules win and the older wording is void.

1. **Fix bugs on sight.** A defect found while working on a task is fixed in that same pass.
   Do not log it for later and do not ship it as a caveat in the report. Stop first only if the
   fix would fall outside the scope table in §1.
2. **Every change gets its own branch.** Create the feature branch before the first edit, however
   small the change, and commit there. No direct commits to `master`, no finished work left
   uncommitted.
3. **Merge when done.** Squash the finished branch to one commit, merge, delete the branch
   (local and remote), switch back, `git pull`. Do not park a completed branch waiting for
   approval; only the destructive operations in §3 need a report first.

## 1. Scope of change

| Area | Paths | Permission |
| :--- | :--- | :--- |
| Dashboard | `src/pages/admin/**`, `src/pages/api/admin/**`, `src/components/admin/**` | edit directly |
| Frontend | `src/pages/**` except `admin`, `src/layouts/**`, `src/components/{layout,widget,controls}/**` | do not modify |
| Shared components | `src/components/common/**` | ask first |
| Shared logic | `src/utils/**`, `src/i18n/**`, `src/config/**`, `src/constants/**` | ask first |
| Build and deploy | `turbo.json`, `astro.config.mjs`, `wrangler.jsonc`, `vercel.json`, `package.json` | ask first |
| Shared docs | `AGENTS.md`, `rules/**`, `docs/**`, `README*.md`, `CONTRIBUTING.md` | edit directly |

Violating the frontend boundary has already forced a rollback once. Do not re-interpret a
request to justify touching files outside the agreed area.

## 2. Requirement handling

- **Decide and execute.** Routine code edits, file organisation, and formatting are decided and
  run directly — do not ask for permission.
- When a standard, style, or architecture question is unclear, read `docs/ADMIN_UI.md` for
  anything visual under `/admin/`, and the existing implementation for everything else. The
  reference project is a source for how things are wired, never for how they look.
- Stop and report only when: the instruction conflicts with the real system behaviour (would
  crash or corrupt data), or the action touches sensitive data or destructive Git operations.
- Never invent values. Never ship placeholders: `<xxx>`, `TBD`, "to be filled in", "not
  specified", "to be added".
- Everything written into documentation must be verifiable in the repository or confirmed by the
  user. When a fact cannot be checked, ask.
- A plan means listing the work, not doing one item at a time. Related bugs found along the way
  are fixed in the same pass, and finished items are ticked off in `todo.md`.

## 3. Git policy

- Never develop on `master`. Create a feature branch first.
- Granular commits inside the branch are fine.
- **Before merging, clean the branch**: squash or rebase until one coherent commit remains.
  Confirm the history is clean, then merge.
- Merge squashed so `master` receives exactly one commit per iteration. One task must not leave
  fragments on the main branch.
- After merging: delete the branch locally and remotely, switch back, `git pull`, then start the
  next task.
- Run the normal branch → commit → squash-merge → delete → push flow without asking.
- Stop and report before destructive Git operations: force push, `reset --hard`, rewriting
  published history, or deleting an unmerged branch. Rewriting published history requires a
  backup branch, explicit approval, and `git push --force-with-lease`.
- Commit messages: one short subject line; body at most two lines, only what changed. No
  reasoning, no narrative, no conversation traces. `scripts/check-commit-msg.mjs` rejects
  phrases such as "previous round", "measured", or "per your request".
- Stage only the files this change touches; avoid `git add -A` when unrelated edits exist.

## 4. Delivery

- Run `pnpm check` (and `pnpm test:run` for logic changes) before committing.
- For style changes, also run `npx biome check <files>` and verify brace balance; `astro check`
  does not parse CSS.
- For UI changes, request screenshots before declaring completion. A type check is not visual
  proof.
- Report concrete evidence: command output, file paths, hashes, diff size. Never "should be
  fine".

## 5. Documentation

- Keep the AI-generated notice on the first line of every README language version, translated
  per language.
- Do not repeat the repository URL in maintenance sections.
- Badges: shields static badge, official logo, brand color. Never display Issues or Stars.
- All language versions share the same structure: same heading count, same table rows, same
  bullet count, same link targets. Translate text only.
- Write documentation in English. Chinese remains in user-facing copy and `src/i18n/`.

## 6. CSS ownership boundaries (`!important`)

`!important` expresses a style-ownership contract: the overridden declaration comes from an
owner this codebase cannot (or should not) edit, and this owner must win. It is not a
shortcut for specificity problems between rules the same owner controls.

**Before adding one**, in this order: delete the duplicated or wrong upstream rule; repair
the selector (Svelte/Astro scope, `:global()`, class placement); expose a component prop,
variant, or CSS custom property as the override point; reorder within the same owner; raise
specificity with one stable component root class. Only if none of these apply and the case
matches an allowed scenario below, use `!important`.

**Allowed scenarios**

1. **Third-party or generated styles** that cannot be fixed upstream (Expressive Code,
   remark/rehype output, embedded widgets). Scope to the integration's root node, override
   only the necessary properties, and verify computed styles in the browser.
2. **Explicit caller-override API.** The component's API documents that callers may override
   this property, and the Svelte scoped hash stably beats the override class. The important
   lives at the call site, never inside the component's defaults. If the same override
   appears twice, add a real prop/variant instead.
3. **User-preference and media boundaries** (`prefers-reduced-motion`, `@media print`)
   disabling third-party animation or inline styles. Do not smuggle unrelated color or
   layout changes into the same block.
4. **Documented compatibility layer** for an external contract that cannot be upgraded in
   step. Requires a boundary comment, a regression check, and removal conditions.

**Forbidden**: repairing a misspelled or mis-scoped selector; resolving priority inside one
owner's own template and styles; overriding design tokens or hardcoding values; papering
over import order or duplicate styles; broad selectors without a component root; hover /
focus / active states; several unrelated properties in one block; `!important` vs
`!important` escalation (refactor the boundary instead).

**Comment**: every new `!important` carries an adjacent English comment naming who produced
the overridden declaration, who owns the final value, and why normal cascade cannot express
it: `/* !important boundary: <external owner>; this owner owns <invariant>. */` One comment
may cover a tight group of same-origin declarations, not a whole file.

**Verification**: confirm in the browser which stylesheet actually wins; check both themes,
narrow viewports, and reduced-motion where relevant; `astro check` does not parse CSS — run
`npx biome check <files>`. When reviewing a diff, treat each new `!important` as needing an
allowed scenario plus a boundary comment; reject the rest.

**Existing occurrences (~540) are grandfathered.** Constrain new code only; do not sweep
them. When touching a grandfathered declaration for other reasons, add the boundary comment
if the ownership is clear, and leave it alone otherwise.

## 7. Optional features (zero burden when disabled)

Anything that can be switched off — Turnstile, login alerts, widgets, third-party
integrations — must follow these four properties in its disabled state:

1. **Zero external requests.** No script, link, font, iframe, or analytics call is fetched.
2. **Zero DOM footprint.** No placeholder markup, empty card, or extra margin/padding; the
   page's DOM structure and layout do not shift.
3. **Zero bundle growth.** The third-party SDK is loaded on demand at runtime, never bundled
   into the main build just because the feature might be enabled.
4. **No migration burden.** Existing content frontmatter and config keep working without bulk
   edits; safe defaults inherit global settings.

Verify the disabled state when reviewing such a feature — enabled-state screenshots say
nothing about points 1–3. Applies to the public theme and `/admin/` alike.

## 8. Accessibility

Keyboard, focus, contrast, and motion rules are in [`rules/a11y.md`](./a11y.md). Short form:
native semantics first, every control has an accessible name, Esc closes overlays, focus
moves in and returns out of dialogs, `:focus-visible` on all interactive styles, both themes
pass contrast, `prefers-reduced-motion` is honored. Screenshots are not acceptance for
interactive changes — walk the flow with the keyboard.
