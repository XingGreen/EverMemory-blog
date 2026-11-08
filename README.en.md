*This project is AI-generated

# EverMemory's Blog

> An Astro personal blog that renders posts into pages at build time, for recording and sharing personal writing and everyday notes, with colours, layout, and reading preferences you can adjust to your taste.

![Node.js >= 22](https://img.shields.io/badge/Node.js-%3E%3D22-5FA04E?logo=nodedotjs&logoColor=white)
![pnpm 9](https://img.shields.io/badge/pnpm-9-F69220?logo=pnpm&logoColor=white)
![Astro 7.0.2](https://img.shields.io/badge/Astro-7.0.2-BC52EE?logo=astro&logoColor=white)
[![License: MIT](https://img.shields.io/badge/License-MIT-3DA639.svg)](./LICENSE)

Other language versions: [简体中文](./README.md) · [繁體中文](./docs/README.zh-TW.md) · [日本語](./docs/README.ja.md) · [Русский](./docs/README.ru.md)

> [!IMPORTANT]
> For admin login, GitHub App setup, and environment variables, read [`docs/ADMIN_MANUAL.md`](./docs/ADMIN_MANUAL.md) first; this file covers project structure, commands, and deployment.

## Overview

Posts are Markdown / MDX files stored in `src/content/posts/` and turned into pages by Astro at build time; `/admin/` provides editing, live preview, drafts, revision history, and site configuration. Post saves write local files only, while drafts fall back to cloud storage in production; pushes go through the sync workbench and each push corresponds to a new build.

UI text supports Simplified Chinese, Traditional Chinese, English, Japanese, and Russian. The default language is set by `SITE_LANG` in `src/config/siteConfig.ts`, with translations in `src/i18n/languages/`.

## Features

### Content and Reading

- Markdown / MDX posts with GFM, admonitions, enhanced code blocks with line numbers, KaTeX math, Mermaid and PlantUML diagrams, and GitHub repository cards
- Categories, tags, pinned posts, drafts, password protection, excerpts, reading-time estimates, and table of contents (TOC)
- Standalone pages: about, archive, search, friends, guestbook, anime, bangumi, gallery, music, app recommendations, sponsorship
- The about and guestbook content and the friends page custom block are read from `src/content/spec/`
- Pagefind full-text search, RSS, and sitemap
- Light / dark / system themes, theme hue adjustment, banner / fullscreen / transparent / solid wallpaper modes, and single or dual sidebars
- Configurable modules: image lightbox, comments, footer content, fonts, music player, and mascot
- Swup page transitions and responsive layout

### Admin Dashboard

- GitHub OAuth sign-in (allowlisted accounts), JWT HttpOnly cookie sessions, active device list with revocation, and step-up re-authentication
- Optional break-glass sign-in (`ADMIN_BREAKGLASS_TOKEN`) and Cloudflare Turnstile verification
- Post list, editing with live preview, save and delete, cross-device draft resume, revision history and diff view
- Sync workbench, category and tag management, links management, site configuration, environment variables and secrets, session management
- Admin preview renders `.md` and `.mdx` through separate channels, independently of each other

### Engineering

- Astro 7 + Svelte 5 + TypeScript + Tailwind CSS 4
- Biome linting and formatting, Vitest unit tests, turbo-orchestrated build pipeline
- Build order: icon generation → LQIP → GitHub card cache → config snapshot → taxonomy check → Astro build → font subsetting → Pagefind indexing

## Quick Start

### Requirements

- Node.js ≥ 22
- pnpm 9 (pinned by `packageManager`; only pnpm is allowed for installation)

### Install and Run

```bash
git clone https://github.com/XingGreen/EverMemory-blog.git
cd EverMemory-blog
pnpm install
pnpm dev
```

The dev server runs at `http://localhost:4321` by default; the admin dashboard is at `/admin/`. Environment variables required for admin sign-in and writes are documented in [`docs/ADMIN_MANUAL.md`](./docs/ADMIN_MANUAL.md).

### Common Commands

| Command | Purpose |
| :--- | :--- |
| `pnpm install` | Install dependencies |
| `pnpm dev` | Start the local dev server |
| `pnpm build` | Run the full production build |
| `pnpm preview` | Preview the build locally |
| `pnpm check` | Astro type and template checks |
| `pnpm type-check` | TypeScript type check |
| `pnpm lint` / `pnpm format` | Biome check (with auto-fix) and formatting |
| `pnpm test` / `pnpm test:run` | Vitest watch mode / single run |
| `pnpm new-post <filename>` | Create a new post |
| `pnpm icons` / `pnpm lqips` | Regenerate icon and LQIP data |
| `pnpm astro ...` | Invoke the Astro CLI |

Before committing, run `pnpm check`, `pnpm test:run`, and `pnpm lint` in that order.

## Configuration and Content

### Site Configuration

Configuration is split by feature under `src/config/` and exported through `src/config/index.ts`. Site title, URL, language, theme hue, pagination, and page switches live in `siteConfig.ts`; see [`src/config/README.md`](./src/config/README.md) for the purpose of each file.

The site URL is defined by `site_url` in `siteConfig.ts`. When adding build logic controlled by an environment variable, register that variable in `env` of `turbo.json` as well; otherwise it will not be passed to the build task.

Common configuration files:

| File | Purpose |
| :--- | :--- |
| `siteConfig.ts` | Site title, URL, language, theme hue, pagination, and page switches |
| `profileConfig.ts` | Profile, avatar, and social links |
| `navBarConfig.ts` | Main navigation and search |
| `sidebarConfig.ts` | Sidebar layout and widgets |
| `commentConfig.ts` | Comment provider and options |
| `musicConfig.ts` | Music player |
| `fontConfig.ts` | Font definitions and loading |
| `licenseConfig.ts` | Default post license |

### Posts and Frontmatter

Posts live in `src/content/posts/` (`.md` / `.mdx`); the about, guestbook, and friends page content lives in `src/content/spec/`. Fields are defined in `src/content.config.ts`:

| Field | Type | Description |
| :--- | :--- | :--- |
| `title` | string | Title, required |
| `published` | date | Publication date, required |
| `updated` | date | Last updated date |
| `draft` | boolean | Draft, defaults to `false` |
| `description` | string | Excerpt |
| `image` | string | Cover image |
| `tags` | string[] | Tags |
| `category` | string | Category |
| `lang` | string | Post language, set when it differs from the site default |
| `pinned` | boolean | Pin to top |
| `author` / `sourceLink` | string | Author and source URL |
| `licenseName` / `licenseUrl` | string | Post license name and URL |
| `comment` | boolean | Whether comments are allowed |
| `password` / `passwordHint` | string | Reading password and hint |

### Directory Structure

| Path | Contents |
| :--- | :--- |
| `src/pages/` | Astro page routes; admin entry under `src/pages/admin/` |
| `src/pages/api/admin/` | Admin API endpoints |
| `src/components/` | Components; admin components under `src/components/admin/` |
| `src/layouts/` | Page layouts |
| `src/content/` | Posts, plus about, guestbook, and friends page content |
| `src/config/` | Site and feature configuration |
| `src/plugins/` | remark / rehype extensions |
| `src/i18n/` | Translation keys and language files |
| `src/utils/`, `src/constants/` | Utilities and generated data |
| `scripts/` | Build-time scripts |
| `tests/` | Unit tests |
| `docs/` | Admin and operations documentation |

## Build and Deployment

`astro.config.mjs` selects an adapter based on environment variables:

| Condition | Adapter | Output and configuration |
| :--- | :--- | :--- |
| `VERCEL=1` | `@astrojs/vercel` | Platform settings in `vercel.json` |
| `CF_WORKERS=1` | `@astrojs/cloudflare` | `dist/client` + `dist/server/entry.mjs`, see `wrangler.jsonc` |
| Neither set | `@astrojs/node` (standalone) | Output to `dist/` |

`pnpm build` produces `dist/`; `pnpm preview` serves the build locally. When both `CF_WORKERS` and `VERCEL` are set, `CF_WORKERS` takes precedence; `BASE_PATH` sets a deployment subpath and defaults to `/`. Cloudflare Workers deployments also require KV bindings such as `SESSION`; the namespace ID must be created and filled into `wrangler.jsonc`.

In production the project directory is read-only: published posts can only be saved in local development, and production rejects those writes. Drafts are the exception — they are stored in cloud storage, so they stay editable online and their revisions stay restorable. Pushes and deletes go through the GitHub App; pushes happen in the sync workbench, commit many files at once, and trigger a single deployment. Site configuration and categories/tags are written straight to GitHub in production, while environment variables and secrets can only be written locally.

Recommended checks before deployment:

```bash
pnpm check
pnpm type-check
pnpm test:run
pnpm build
```

On the hosting platform, set the build command to `pnpm build` and the output directory to `dist`.

## Documentation

- [`AGENTS.md`](./AGENTS.md) — collaboration rules and scope of change
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — architecture, technical conventions, and build pipeline
- [`docs/ADMIN_MANUAL.md`](./docs/ADMIN_MANUAL.md) — admin usage and environment variables
- [`docs/EMERGENCY_OPS.md`](./docs/EMERGENCY_OPS.md) — emergency operations
- [`src/config/README.md`](./src/config/README.md) — configuration reference
- [`todo.md`](./todo.md) — pending work and known issues

## License and Compliance

This project is licensed under the [MIT License](./LICENSE). Retain the following copyright notices when using, modifying, or distributing the code:

- Copyright (c) 2024 saicaca
- Copyright (c) 2025 CuteLeaf
- Copyright (c) 2026 XingGreen

The admin UI design is inspired by flare-stack-blog (GPL-3.0-only); this project is an independent implementation and does not copy any of its source code.

Some images and mascot assets remain the property of their respective rights holders.
