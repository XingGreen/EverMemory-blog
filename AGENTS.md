# Agent Instructions for EverMemory's Blog

## Summary

An Astro 7 + Svelte 5 personal blog with a built-in admin dashboard. Posts are Markdown /
MDX files in `src/content/posts/`; frontend pages are prerendered at build time; admin pages
and API routes run on the server adapter. Swup handles in-site navigation and skips
`/admin/` and `/login/`. Development happens on Windows.

**Engineering** conventions (directory layout, naming, build wiring, test shape) follow the
reference project **Shirone** (MIT). When unsure how something should be *wired*, read its
`AGENTS.md`, `rules/`, and `docs/` first and match that standard. Reference projects are chosen
per task and never hardcoded into committed files; machine paths live under `.workbuddy/`
(gitignored).

**Visual** standards are our own: [`docs/ADMIN_UI.md`](./docs/ADMIN_UI.md). The dashboard no
longer copies the reference project's screens — copying a screen copies its result, not its
reason, which is how the admin grew four page headers and four page-title sizes. Never borrow a
layout, a palette, or a component skin from the reference project; borrow only how things are
wired.

## Must-follow rules

- **Workflow — supersedes every earlier rule.** If this block conflicts with anything else in
  this file, with `rules/`, with `docs/`, or with a habit carried over from an earlier session,
  this block wins. The older wording is void; do not try to reconcile the two.

  1. **Fix bugs as they surface.** A defect found while working on a task is fixed in the same
     pass — not logged for later, not left as a caveat in the report. Only stop first if the fix
     would fall outside the scope table, and then say why.
  2. **Every change lands on its own branch.** Create the feature branch before the first edit,
     however small the change, and commit there. No direct commits to `master`, and no finished
     work left uncommitted in the working tree.
  3. **Merge as soon as the work is done.** When the branch is complete and verified, squash it
     into one commit, merge, delete the branch (local and remote), switch back, and `git pull`.
     Do not park a finished branch waiting for a go-ahead.
  4. **Task ledger.** Every task that was NOT executed — failed and deferred, proposed but not
     confirmed, skipped, or forgotten — must be recorded in the project's `.todo` file. No
     omissions: the ledger is the single source of truth for outstanding work.
  5. **Terminology ambiguity stops the work.** When the user names something with a vague or
     contradictory term (for example mixing up "loading progress bar" and "loading circle"),
     make no code change at all. Stop, state what you believe they mean, and wait for an
     explicit answer before acting.
  6. **Stay on the current task.** Without an explicit new instruction, never drift away from
     the task in progress. The conversation context and the current task goal decide what gets
     touched; never switch the object of work on your own initiative (for example, do not
     wander onto an unrelated branch while the task is about a specific screen).
  7. **Restate, then act; never claim unverified work.** Before touching anything, restate the
     task goal in one sentence and keep every edit inside it — a wider reading is not a licence
     to widen the change. When a reference image, layout, or sample exists, it is the contract:
     match its structure, and never substitute your own arrangement for it. Any UI change is
     finished only after a screenshot self-check at the real viewport — read the rendered result,
     name what is wrong, fix it, shoot again. "Done" without that check is not allowed, and
     neither is reporting a fix that was never rendered.

- **UI standards.** Anything under `/admin/` follows [`docs/ADMIN_UI.md`](./docs/ADMIN_UI.md):
  five type sizes, one spacing scale, one accent colour that only means "needs you", and the
  three primitives in `src/components/admin/ui/`. Pages fill in those primitives; they do not
  restyle them, add a header of their own, or introduce a sixth font size. The public blog is
  out of scope and keeps its own theme.
- **Copy.** Anything a user can read — public pages and `/admin/` alike — carries only what the
  user came for: what this is, what to do, what happened. Design rationale, refactor notes,
  review findings, mechanism names (`JWT`, `12-column grid`, "this replaces the old table") and
  any other inside-baseball explanation belong in code comments or `docs/`, never on screen.
- **CSS.** `!important` is an ownership contract, not a shortcut. Before reaching for it,
  exhaust the cheaper fixes: delete the wrong upstream rule, repair the selector or scope,
  expose a prop or CSS custom property, or reorder within the same owner. It is allowed only
  when a real ownership boundary exists — overriding third-party or generated styles that
  cannot be fixed upstream (scoped to the integration root, minimal properties), an explicit
  caller-override API where Svelte's scoped hash stably beats utility classes, a
  user-preference or media boundary (`prefers-reduced-motion`, `@media print`), or a
  documented compatibility layer for an external contract. Never use it to repair a broken
  selector, win a specificity fight inside one owner's own template and styles, or stack
  `!important` against `!important` — refactor the boundary instead. Every use carries an
  adjacent English comment naming who owns the overridden declaration and who owns the final
  value. Existing occurrences are grandfathered: constrain new code, do not sweep the old
  ones. Full policy in `rules/project-rules.md` §6.
- **Zero-burden optionals.** Anything that can be switched off — Turnstile, login alerts,
  widgets, third-party integrations — must cost nothing when disabled: zero external requests,
  zero placeholder DOM or layout shift, zero bundle growth (load on demand instead), and no
  migration burden on existing content. Verify the disabled state when reviewing such a
  feature, not only the enabled one.
- **Accessibility.** Keyboard, focus, contrast, and motion rules live in
  [`rules/a11y.md`](./rules/a11y.md). Native semantics first, every control named, Esc closes
  overlays, `:focus-visible` everywhere, both themes pass. A type check is not a11y proof.

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

- **No reinvention.** An existing plugin/package — or the project's own current solution —
  always outranks hand-rolling a replacement. Hand-written substitutes are the last resort, not
  a default: before writing custom code, check `package.json` / `node_modules`, then official
  library docs, then a license-checked reference project. If nothing fits, stop and report what
  is missing and which options exist. Adding a dependency requires reporting the trade-off
  first. Reuse `src/i18n/` keys instead of writing copy; reuse `src/utils/markdown-renderer.ts`,
  `src/utils/mdx-runtime.ts`, and the existing preview APIs instead of building a second
  Markdown pipeline.

- **Attribution and business boundary.** Preserve the original author's name and license
  notices (Footer, SiteInfo, README) — this is not negotiable. This is a public, community-
  maintained project: OOBE and the entire admin dashboard are original work by the project's
  maintainers, with no upstream lineage. Self-built modules carry the maintainers'
  attribution, and never carry upstream names, links, or traces into them.
- **Attribution and business boundary.** Preserve the original author's name and license
  notices (Footer, SiteInfo, README) — this is not negotiable. But OOBE and the entire admin
  dashboard are our own work with no upstream lineage: self-built modules carry only our own
  attribution, and never carry upstream names, links, or traces into them.
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

- [`rules/project-rules.md`](./rules/project-rules.md) — scope table, Git policy, CSS rules, and
  delivery rules in full.
- [`docs/ADMIN_UI.md`](./docs/ADMIN_UI.md) — the dashboard's design system: tokens, type scale,
  colour jobs, the three primitives, and the forbidden list. Required before any `/admin/` UI
  change.
- [`rules/pitfalls.md`](./rules/pitfalls.md) — dev-server, build, and styling traps that have
  caused real breakage. Read before changing icons, styles, or the build pipeline.
- [`rules/a11y.md`](./rules/a11y.md) — keyboard, focus, contrast, and motion rules. Required
  before adding or changing any interactive component, dialog, or overlay.
- [`rules/component-api.md`](./rules/component-api.md) — props naming, slot, and conditional
  rendering conventions for Svelte components. Required before adding or changing a
  component's public interface.
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
