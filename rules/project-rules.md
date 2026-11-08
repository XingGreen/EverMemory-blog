# Project Rules

Full form of the rules summarized in [`AGENTS.md`](../AGENTS.md).

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

- Ask immediately when anything is unclear. This covers scope ambiguity, unknown values,
  history trade-offs, and the meaning of the rules themselves.
- Never invent values. Never ship placeholders: `<xxx>`, `TBD`, "to be filled in", "not
  specified", "to be added".
- Everything written into documentation must be verifiable in the repository or confirmed by
  the user. When a fact cannot be checked, ask.
- When the user describes a problem or proposes a change, align on the approach first. Start
  editing only after an explicit go-ahead.
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
- Confirm before creating a branch, merging, pushing, or deleting a branch, unless the user has
  explicitly waived that check for the current task.
- Rewriting published history requires a backup branch, explicit approval, and
  `git push --force-with-lease`.
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
