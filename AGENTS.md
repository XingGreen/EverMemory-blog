# Agent Instructions for EverMemory's Blog

## Summary

An Astro 7 + Svelte 5 personal blog with a built-in admin dashboard. Posts are Markdown /
MDX files in `src/content/posts/`; frontend pages are prerendered at build time; admin pages
and API routes run on the server adapter. Swup handles in-site navigation and skips
`/admin/` and `/login/`. Development happens on Windows.

Design, directory conventions, and code standards follow the reference project **Shirone**
(MIT licensed). When unsure how something should be structured, read its `AGENTS.md`,
`rules/`, and `docs/` first and match that standard. Reference projects are chosen per task
and never hardcoded into committed files; machine paths live under `.workbuddy/` (gitignored).

## Must-follow rules

- **Scope.** Edit `src/pages/admin/**`, `src/pages/api/admin/**`, and `src/components/admin/**`
  directly. Do not modify frontend routes (`src/pages/**` except admin), `src/layouts/**`, or
  `src/components/{layout,widget,controls}/**`. Ask before touching `src/components/common/**`,
  `src/utils/**`, `src/i18n/**`, `src/config/**`, `src/constants/**`, `turbo.json`,
  `astro.config.mjs`, `wrangler.jsonc`, `vercel.json`, or `package.json`. Never widen a request
  beyond its stated scope.

- **Decide and execute.** Routine code edits, file organisation, and formatting: decide and run
  them without asking. When a standard, style, or architecture question is unclear, read the
  reference project (Shirone) or the existing implementation and follow that — do not ask. Never
  invent unknown values and never leave placeholders (`<xxx>`, `TBD`, "to be filled in"). Stop
  and report only when the instruction conflicts with the real system behaviour (would crash or
  corrupt data), or when the action touches sensitive data or destructive Git operations.

- **No reinvention.** Check `package.json` / `node_modules`, then official library docs, then a
  license-checked reference project. If nothing fits, stop and report what is missing and which
  options exist. Adding a dependency requires reporting the trade-off first. Reuse `src/i18n/`
  keys instead of writing copy; reuse `src/utils/markdown-renderer.ts`,
  `src/utils/mdx-runtime.ts`, and the existing preview APIs instead of building a second
  Markdown pipeline.

- **License.** Check the license of third-party code before reading or adapting it. This project
  is MIT; copyleft source must not be copied in — study the intent, write the implementation.
  Never remove `LICENSE`, the copyright lines in any `README*.md`, or the GPL inspiration
  notice. Never commit absolute paths, usernames, keys, or `.env*`.

- **Git.** Never develop on `master`; create a feature branch. Commits inside the branch may be
  granular, but **squash or rebase before merging** until the branch is one coherent commit, and
  confirm the history is clean first. Merge squashed so `master` gets exactly one commit per
  iteration. Afterwards delete the branch, switch back, and `git pull`. Run this normal flow
  without asking. Stop and report before destructive Git operations: force push, `reset --hard`,
  rewriting published history, or deleting an unmerged branch. Rewriting published history
  needs a backup branch, explicit approval, and `--force-with-lease`. Commit messages: one short
  subject line,
  body at most two lines describing only what changed — no narrative, no conversation traces.

- **Verify.** `pnpm check`, `pnpm type-check`, and `pnpm test:run` for logic. For style changes
  also run `npx biome check <files>`, check brace balance inside `<style>`, and request the
  compiled module (expect HTTP 200) — `astro check` does not parse CSS. UI changes require
  screenshots for acceptance; a passing type check is not visual proof. Report evidence, never
  "should be fine".

- **Documentation.** Keep the AI-generated notice on the first line of every README language
  version. Do not repeat the repository URL in maintenance sections. Badges use shields static
  badges with official logos and brand colors; never show Issues/Stars counts. Keep all language
  versions structurally identical, translate only. Keep `todo.md` checked off with commit hashes.

- **Language.** Documentation, code comments, and commit messages are English. Chinese only
  appears in user-facing copy and `src/i18n/` strings. Migrate existing Chinese documents only
  when a task touches them; no mass rewrites.

## Required documents

- [`rules/project-rules.md`](./rules/project-rules.md) — scope table, Git policy, and delivery
  rules in full.
- [`rules/pitfalls.md`](./rules/pitfalls.md) — dev-server, build, and styling traps that have
  caused real breakage. Read before changing icons, styles, or the build pipeline.
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — routing, configuration, content
  collections, tests, build pipeline, and deployment.
- [`docs/PROVIDERS.md`](./docs/PROVIDERS.md) — auth and storage adapter interfaces, provider
  selection, and the permission model. Required before touching admin APIs.
- [`docs/ADMIN_MANUAL.md`](./docs/ADMIN_MANUAL.md) — dashboard usage and environment variables.
  Required before changing admin APIs or authentication.
- [`docs/EMERGENCY_OPS.md`](./docs/EMERGENCY_OPS.md) — recovery procedures.
- [`docs/screenshot-guide.md`](./docs/screenshot-guide.md) — headless capture for UI acceptance.
- [`src/config/README.md`](./src/config/README.md) — configuration reference. Required before
  changing config types or values.
- [`README.md`](./README.md) and the four language versions — positioning and usage.

## Validation

- `pnpm dev` serves `http://localhost:4321`; the dashboard is at `/admin/`.
- `pnpm check` (`astro check`) must report 0 errors before committing.
- `pnpm type-check` runs `tsc --noEmit --isolatedDeclarations`; the existing error count must not
  grow.
- `pnpm test:run` is the single-run suite. `pnpm lint` and `pnpm format` both write files, so use
  `npx biome check <files>` when a check must not modify anything.
- `pnpm build` runs the turbo pipeline: icons → LQIPs → config snapshot → taxonomy check →
  Astro build → font subsetting → Pagefind.
- If Stylus or Svelte output looks stale, clear `node_modules/.vite` and `.astro`, then restart.

## Repository context

- Admin writes differ by capability: post saves write local files only and return 403 in
  production; deletes and pushes go through the GitHub App (`sync/apply` commits many files in
  one GraphQL call, which triggers a single deployment); site configuration and taxonomy write
  straight to GitHub in production; secrets are local-only.
- `src/content/spec/` holds `about.md`, `friends.mdx`, and `guestbook.md`, read by `/about/`,
  `/friends/`, and `/guestbook/` through `getEntry("spec", …)`. It is not a generic "special
  pages" collection.
- Five UI languages: `en`, `ja`, `ru`, `zh_CN`, `zh_TW`. `zh_CN_zaku` is commented out.
- The adapter is chosen by environment variable: `CF_WORKERS` wins over `VERCEL`; neither falls
  back to `@astrojs/node` standalone. `BASE_PATH` controls `base`. New adapter-affecting
  variables must be registered in `turbo.json` under the `astro-build` task env.
- Admin overlays are portalled to `document.body`: `.admin-content` applies a `zoom`, so
  `position: fixed` offsets inside that subtree are scaled a second time.
