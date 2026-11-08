# Architecture

Technical overview of the codebase. Collaboration rules live in
[`AGENTS.md`](../AGENTS.md); project usage lives in [`README.md`](../README.md).

## Overview

An Astro 7 + Svelte 5 personal blog with a built-in admin dashboard.

- Posts are Markdown / MDX files in `src/content/posts/`.
- Frontend pages are prerendered at build time.
- Admin pages and API routes opt out of prerendering with `export const prerender = false`
  and run on the server adapter.

## Commands

| Command | Purpose |
| :--- | :--- |
| `pnpm dev` | Dev server at `http://localhost:4321` |
| `pnpm build` | Full production build |
| `pnpm preview` | Preview the production build |
| `pnpm check` | `astro check` for types and templates |
| `pnpm type-check` | `tsc --noEmit --isolatedDeclarations` |
| `pnpm lint` | Biome check with auto-fix |
| `pnpm format` | Biome format |
| `pnpm test` | Vitest in watch mode |
| `pnpm test:run` | Vitest single run |
| `pnpm new-post <filename>` | Scaffold a new post |
| `pnpm icons` / `pnpm lqips` | Regenerate icon and LQIP data |
| `pnpm snapshot` | Regenerate the admin config snapshot |

pnpm is enforced by `preinstall`. Node.js >= 22.

## Architecture

### Astro + Svelte hybrid

- `.astro` components handle static content and layouts.
- `.svelte` components handle interactive UI (search, settings, pagination, admin), mounted
  with `client:load` or `client:visible`.
- Swup provides in-site navigation. `astro.config.mjs` skips `/admin/` and `/login/` so the
  dashboard always loads as a full page.

### Configuration-driven

All features are toggled through TypeScript files in `src/config/`, exported from the barrel
`src/config/index.ts`. Frequently edited files:

- `siteConfig.ts` — site identity, language, theme, pagination, page switches
- `profileConfig.ts` — author profile and social links
- `navBarConfig.ts` — main navigation and search
- `sidebarConfig.ts` — sidebar layout (`left` / `right` / `both`) and widget ordering
- `commentConfig.ts`, `musicConfig.ts`, `fontConfig.ts`, `licenseConfig.ts`

### Layout system

- `src/layouts/Layout.astro` — HTML shell: head, theme init, metadata, analytics, Swup hooks
- `src/layouts/MainGridLayout.astro` — page grid with sidebars, navbar, wallpaper, footer
- `src/layouts/AdminLayout.astro` — dashboard shell

### Content collections

Defined in `src/content.config.ts`:

- `posts` — Markdown / MDX with frontmatter: `title`, `published`, `updated`, `draft`,
  `description`, `image`, `tags`, `category`, `lang`, `pinned`, `author`, `sourceLink`,
  `licenseName`, `licenseUrl`, `comment`, `password`, `passwordHint`
- `spec` — content for the about page, the guestbook, and the friends page custom block
  (`about.md`, `friends.mdx`, `guestbook.md`)

### Key directories

| Path | Contents |
| :--- | :--- |
| `src/pages/` | File-based routes; admin entry under `src/pages/admin/` |
| `src/pages/api/admin/` | Admin API endpoints |
| `src/components/` | Domain-grouped components; admin under `src/components/admin/` |
| `src/plugins/` | remark / rehype extensions (Mermaid, PlantUML, KaTeX, GitHub cards, reading time, MDX fallback) |
| `src/i18n/` | `i18nKey.ts`, language files, lookup in `translation.ts` |
| `src/utils/` | Storage, auth, GitHub App, markdown rendering, content helpers |
| `src/constants/` | Generated data (icons, LQIPs, admin config snapshot) |
| `scripts/` | Build-time and maintenance scripts |
| `tests/` | Vitest suites |

### Path aliases

Declared in `tsconfig.json`: `@components/*`, `@assets/*`, `@constants/*`, `@utils/*`,
`@i18n/*`, `@layouts/*` → `./src/<dir>/*`; `@/*` → `./src/*`.

`vitest.config.ts` must mirror these aliases exactly; a missing alias fails resolution.

## Tests

Vitest in a Node environment (`tests/`). Coverage focuses on the admin toolchain, where
mistakes are expensive.

- `tests/auth.test.ts` — JWT signing and verification, tampering, expiry boundaries, token
  version invalidation, missing `sid`, role checks, `requireAuth` 401 branches, cookie flags
- `tests/session-store.test.ts` — session registration and expiry, revocation,
  `touch` throttling, `describeDevice`, `verifyDeleted` race handling
- `tests/remark-mdx-flatten.test.ts`, `tests/mdx-runtime.test.ts`, `tests/mdx-preview.test.ts`
  — the MD/MDX preview channels

Conventions:

- **Test real code, do not mock the subject.** Mock only boundaries (storage backend,
  `.env.local` reads). `tests/helpers/memory-store.ts` provides an in-memory duplex that
  matches `persist-store`.
- **`.astro` / `.svelte` components are not tested.** They need a DOM environment while
  Vitest is configured for `node`.
- **Prove new tests can fail.** Break the guarded branch on purpose and confirm the test
  fails; assertions on the final result alone can pass vacuously.
- `pnpm type-check` reports pre-existing `isolatedDeclarations` errors; the count must not
  increase, and they must not be "fixed" as a side quest.

## Code Style

- Biome enforces tab indentation, double quotes, and the recommended rules.
- `.svelte` / `.astro` files relax `useConst` and `noUnusedVariables`.
- Conventional Commits.

## Verifying style changes

`astro check` does not parse CSS inside `<style>`. Unbalanced braces pass silently until
Vite compiles them. After touching a style block:

1. `npx biome check <files>` — Biome has a CSS parser and reports syntax errors.
2. Check brace balance:

   ```bash
   awk -v s=$(grep -n '^<style>' FILE | cut -d: -f1) \
     'NR>=s {o+=gsub(/{/,"{"); c+=gsub(/}/,"}")} END {print o"/"c}' FILE
   ```

   Both numbers must match.
3. Request the module to confirm Vite compiles it:

   ```bash
   curl -o /dev/null -w '%{http_code}' \
     http://localhost:4321/src/components/admin/X.svelte   # expect 200
   ```

Deleting a style range by line number is high risk: if the range ends before a closing
brace, an orphan `}` remains and `astro check` still reports zero errors.

## Markdown rendering

Any Markdown or MDX rendering must reuse the existing pipeline:

- Rendering: `src/utils/markdown-renderer.ts`, `src/utils/mdx-runtime.ts`,
  `src/utils/mdx-fallback.ts`, and the `/api/admin/preview/` endpoint
- Styling: `.custom-md` in `src/styles/markdown.css` plus the Stylus extensions

Preview splits by file type: `.md` uses the pure Markdown pipeline, `.mdx` runs the MDX
runtime and falls back to the flatten pipeline when compilation fails.

## Drafts in production

The production filesystem is read-only and the build output contains no `src/content`
sources, so a draft (`draft: true`) used to be unreadable and unsavable online. Drafts now
have a second home:

| Operation | Order of resolution |
| :--- | :--- |
| Read | local file → remote repository → `prodpost:<slug>` in persist-store |
| Save | local file when writable → `prodpost:<slug>` (read-only deployments) |
| Restore revision | local file → `prodpost:<slug>` when the snapshot is a draft |

`src/utils/post-draft-store.ts` wraps `persist-store` (Vercel KV in production, files under
`.data/persist` locally). Published posts are untouched: they still save locally and reach
the repository only through the sync workbench. Draft revisions keep using `rev:<slug>:<ts>`
keys, so nothing changes for the history list.

## Music playlist cache

`/api/music/playlists/` serves the whole playlist payload (lists plus track details) from
`persist-store` under `music:playlists:<uid>`, refreshed at most once every 10 minutes. On an
upstream failure it returns the stale record instead of an empty page. The `/music/` page now
makes a single request to this endpoint instead of calling the third-party mirrors N+1 times,
which is what previously risked rate limits.

## Build pipeline

`turbo run icons lqips github-cards snapshot astro-build subset-fonts pagefind`, with dependencies:

1. `icons` — generates `src/constants/icons.ts`
2. `lqips` — generates `src/constants/lqips.json`
3. `github-cards` — caches GitHub repository metadata for `::github` cards
4. `snapshot` — generates `src/constants/admin-config-snapshot.ts` (gitignored)
5. `taxonomy-check` — validates the category/tag registry before the build
6. `astro-build` — the Astro build itself (`cache: false`)
7. `subset-fonts` — production font subsetting (writes into the real site root)
8. `pagefind` — search index written to the real site root

`scripts/site-root.ts` resolves that root (`dist/client`, `.vercel/output/static`, or
`dist`), so font subsetting and Pagefind target the directory that is actually deployed.

Generated icon, LQIP, and GitHub card data are committed; the admin config snapshot is not.
Regenerate with `pnpm icons`, `pnpm lqips`, `pnpm github-cards`, or `pnpm snapshot`.

## Deployment

`astro.config.mjs` picks the adapter from environment variables:

| Condition | Adapter | Output |
| :--- | :--- | :--- |
| `CF_WORKERS` set | `@astrojs/cloudflare` | `dist/client` + `dist/server/entry.mjs` |
| `VERCEL` set (no `CF_WORKERS`) | `@astrojs/vercel` | Vercel platform output |
| neither | `@astrojs/node` standalone | `dist/` |

`CF_WORKERS` takes precedence. `BASE_PATH` sets `base` and defaults to `/`.

Cloudflare Workers specifics:

- `wrangler.jsonc` must keep `no_bundle: true` and `rules: [{ type: "ESModule" }]`;
  without them wrangler treats the ESM bundle as a Service Worker and rejects every
  `node:` import.
- The `SESSION` KV namespace ID must be created with `npx wrangler kv namespace create SESSION`
  and filled in; the placeholder cannot deploy.
- `turbo.json` must declare `CF_WORKERS`, `VERCEL`, and `BASE_PATH` under the `astro-build`
  task env. turbo 2 runs in strict env mode, so undeclared variables never reach the task
  and the build silently emits the wrong artifact.

Production write behaviour is documented in the README: posts save locally only, pushes and
deletes go through the GitHub App, site configuration and taxonomy are written straight to
GitHub, and secrets are limited to local development.
