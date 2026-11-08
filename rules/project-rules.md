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

- **Decide and execute.** Routine code edits, file organisation, and formatting are decided and
  run directly — do not ask for permission.
- When a standard, style, or architecture question is unclear, read the reference project
  (Shirone) or compare the existing implementation, and follow that instead of asking.
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
