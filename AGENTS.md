# AGENTS.md

Collaboration rules for this repository. This file is the source of truth for how work is
done here. Technical details live in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md);
project usage lives in [`README.md`](./README.md).

## 1. Priority

1. The instruction the user gives in the current turn.
2. This file.
3. `docs/ARCHITECTURE.md` and other documentation.

## 2. Scope of Change

| Path | Permission |
| :--- | :--- |
| `src/pages/admin/**`, `src/pages/api/admin/**`, `src/components/admin/**` | edit directly |
| `src/pages/**` except `admin`, `src/layouts/**`, `src/components/{layout,widget,controls}/**` | do not modify |
| `src/components/common/**` | ask first |
| `src/utils/**`, `src/i18n/**`, `src/config/**`, `src/constants/**` | ask first |
| `turbo.json`, `astro.config.mjs`, `wrangler.jsonc`, `vercel.json`, `package.json` | ask first |

Never change files outside the agreed scope, and never widen a request on your own reading
of it. If the scope is ambiguous, ask before touching anything.

## 3. Communication

- Ask immediately when something is unclear: scope, values, history trade-offs, or the
  meaning of a rule. Do not work it out alone.
- Never invent unknown values. Never leave placeholders such as `<xxx>`, `TBD`, or
  "to be filled in". Ask instead.
- When the user describes a problem or suggests a change, align on the approach first.
  Start editing only after an explicit go-ahead.
- Every value written into documentation must be verifiable in the repository or confirmed
  by the user.

## 4. No Reinvention

Before writing code, check in this order:

1. Dependencies already present in `package.json` / `node_modules`.
2. Official library documentation or official snippets.
3. A reference project, only after its license has been checked (see §5).

If nothing fits, stop and report what is missing, where it was checked, and which options
exist. Adding a dependency requires reporting the trade-off first.

Two standing applications:

- **i18n copy** — reuse existing keys under `src/i18n/`. Never write or machine-translate
  new copy; ask whether to reuse a key or add one.
- **Markdown rendering** — always reuse `src/utils/markdown-renderer.ts`,
  `src/utils/mdx-runtime.ts`, and the existing preview APIs. Never build a second pipeline.

## 5. License Compliance

- Check the license of any third-party code before reading or adapting it, and report the
  result before use.
- This project is MIT. Copyleft source (GPL and similar) must not be copied into it: study
  the idea and the layout intent, write the implementation yourself.
- Copyright notices are permanent. Never remove or rewrite `LICENSE`, the copyright lines
  in every `README*.md`, or the GPL inspiration notice.
- Never commit machine-specific material: absolute paths, usernames, keys, `.env*`.

## 6. Git

- Never develop on `master`. Create a feature branch first.
- Several commits inside the branch are fine.
- **Before merging, clean the branch**: squash or rebase until it is one coherent commit.
  Confirm the history is clean, then merge.
- Merge squashed so `master` receives exactly one commit per iteration. One task must not
  leave a trail of fragments on the main branch.
- After merging: delete the branch (local and remote), switch back, `git pull`.
- Confirm before each of these four steps: create branch / merge / push / delete branch.
- Rewriting published history requires a backup branch, explicit approval, and
  `git push --force-with-lease`.
- Commit messages: one short subject line; body at most two lines describing only what
  changed. No narrative, no reasoning, no conversation traces.

## 7. Verification

- Types and templates: `pnpm check`, `pnpm type-check`.
- Tests: `pnpm test:run`.
- Style changes: `npx biome check <files>`, brace balance inside `<style>` blocks, and
  request the compiled module from the dev server (expect HTTP 200). `astro check` does not
  parse CSS.
- UI changes: screenshots are required for acceptance. A passing type check is not visual
  proof.
- Report conclusions with evidence. Never claim "should be fine".

## 8. Todo and Records

- Mark finished items in `todo.md` (`- [ ]` → `- [x]`) with the commit hash.
- Keep a daily work log under `.workbuddy/memory/YYYY-MM-DD.md` (local only, gitignored).

## 9. Documentation Rules

- Keep the AI-generated notice on the first line of every README language version.
- Do not repeat the repository URL in maintenance sections.
- Badges use shields static badges with official logos and brand colors. Never display
  Issues or Stars counts.
- Keep all language versions structurally identical; translate the text only.

## 10. Language

- Documentation, code comments, and commit messages: English.
- Chinese only in user-facing copy and `src/i18n/` strings.
- Migrate existing Chinese documents only when a task touches them. No mass rewrites.

## 11. Local-Only Material

- Machine paths, tool install locations, local reference repositories, and AI working notes
  belong under `.workbuddy/`, which is gitignored.
- Reference projects are chosen per task by the user. There is no permanent default
  reference repository, and no reference project path belongs in a committed file.
