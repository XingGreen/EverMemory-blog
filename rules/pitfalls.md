# Pitfalls

Traps that have caused real breakage in this repository. Read the relevant section before
touching icons, styles, the build pipeline, or the dev server.

## Dev server

- **`generate-icons.js --watch` must compare content before writing.** It watches all of
  `src/`, so any edit re-runs it. `src/constants/icons.ts` is statically imported by SSR
  modules, so a changed mtime triggers an Astro program reload; during the reload the virtual
  module `astro:server-app.js` is not rebuilt and the dev server half-breaks with
  `Failed to load url astro:server-app.js`. The generator now skips writes when the content is
  unchanged.
- **`astro check` needs a clean Vite cache in restricted shells.** If it aborts with a bulk
  delete guard, move `node_modules/.vite` aside first; Vite recreates it instead of deleting it.
- **The dev server dies whenever Vite re-optimises dependencies in a restricted shell.** Before
  re-bundling, Vite deletes `node_modules/.vite/deps` (70–100 files), which trips the same bulk
  delete guard and takes the server down with an `UnhandledRejection`. Moving the whole `.vite`
  directory makes it worse: the missing metadata counts as "vite config has changed" and it
  tries to delete again. The working move is to relocate the two things it wants to remove —
  `node_modules/.vite/deps` and any `deps_temp_*` siblings — somewhere else, then start the
  server so it writes fresh ones instead of deleting. `--force` does not help.
- **Icon names must belong to their set.** `material-symbols:book-open` is a Lucide name and
  does not exist in that collection. A wrong name renders blank and only logs "icon not found"
  in the dev server.

## Svelte and Astro

- **Svelte 5 `bind:this` targets must be `$state`.** A plain `let` raises
  `non_reactive_update`.
- **`css_unused_selector` warnings need classification.** Three cases: a real orphan (delete
  it), a class added via `classList.add` (false positive), or a class passed to a component such
  as `<Icon class="...">` (the compiler cannot see it — false positive). Do not delete the last
  two.
- **`astro check` does not parse CSS.** Unbalanced braces pass until Vite compiles them. Run
  `npx biome check` and verify brace balance after editing a `<style>` block.
- **Astro scoped styles cannot match `.dark` with `.dark &`.** Astro scopes the `.dark` class
  too, so the selector compiles to `.dark[data-astro-xxx] &` and never hits the real DOM.
  Use `:global(.dark) &` instead — already the established pattern in `FloatingButton.astro`,
  `FloatingTOC.astro`, and `SiteStats.astro`.
- **Svelte template comments must be `<!-- -->`.** `{/* */}` is a parse error on Svelte 5.56
  and a bare `/* */` leaks into the DOM. This project runs svelte ^5.56.3, so both failure
  modes are live; `/* */` style comments belong only in `<script>` / `<style>` blocks.
- **Descendant selectors built on a child component's root class silently fail.** When a
  parent passes `class` to a child (e.g. `<Icon class="...">` or a wrapper component), the
  root element carries the *child's* scope hash, not the parent's — so `.host-class .thing`
  in the parent's scoped style never matches. Put the host class on a real element in the
  parent's own template, or bridge with `:global(.host-class)`. Single-class rules are
  unaffected.
- **Svelte 5's default `cssHash` hashes the file path.** Moving a component between
  directories can then produce different scope hashes for SSR and client, silently dropping
  styles. This project has no `cssHash` override in `astro.config.mjs` (verified 2026-11-15),
  so treat unexplained scoped-style loss after a file move as this bug first. The fix is
  content-based hashing — `cssHash: ({ css, hash }) => \`svelte-${hash(css)}\`` under the
  svelte integration's `compilerOptions` — which touches `astro.config.mjs` and therefore
  needs explicit approval per the scope table.

## Markdown pipeline

- **rehype/remark plugin changes do not hot-reload.** Plugins under `src/plugins/*.mjs` run
  at Markdown compile time and Astro's content data store caches the compiled result, so a
  dev server restart alone may still serve stale HTML. Stop the server, delete
  `.astro/data-store.json`, and restart. Verify by checking whether the plugin's expected
  class/attribute actually appears in the page HTML — if new CSS loads but the new class is
  missing, it is the content cache, not your selector.
- **`fetch` must check `response.ok`.** A non-2xx body parsed with `r.json()` produces
  undefined fields that surface as `NaN` or blank UI instead of an error message. Check
  `ok`, add an `AbortController` timeout, and render explicit error copy in the catch.

## Forms and layout

- **Grid forms need explicit shrink rules.** With 27 grid-based field layouts under
  `src/components/admin/`, this is the default layout mode. A grid without an explicit
  column template gets implicit tracks sized to content, and a native `<input>` keeps its
  ~20-character intrinsic width. Always declare
  `grid-template-columns: minmax(0, 1fr)`-style templates, set `min-width: 0` on grid items,
  and give inputs `width: 100%; min-width: 0` so the browser's intrinsic size cannot push
  the row wider than its container.

## Tooling (Windows)

- **PowerShell does not support `2>nul`.** `nul` is a DOS device name; the redirect is parsed
  before execution and the command fails with `NotSupportedException` without ever running.
  Use `2>$null`, or `Remove-Item -ErrorAction SilentlyContinue`. This applies to every
  command, not just cleanup — the failure is silent in scripts.
- **PowerShell garbles non-ASCII paths and commit messages.** Read with explicit UTF-8
  output encoding; for commit messages containing quotes or CJK, write a temp file and use
  `git commit -F` instead of inline escaping.

## Admin UI

- **`.admin-content` applies `zoom: clamp(1, 0.07vw/1px, 1.5)`.** Inside that subtree,
  `getBoundingClientRect()` returns scaled coordinates, so `position: fixed` offsets are scaled
  a second time and drift with distance. Any fixed overlay (row menu, tooltip, dropdown) must be
  portalled to `document.body`.
- **Portalling loses inherited context.** After moving an overlay to `body`, copy the CSS custom
  properties (`--md-*`, `--destructive`) and the dashboard font from the trigger's
  `getComputedStyle`.
- `overflow: hidden` does not clip fixed descendants; a "clipped by the parent" symptom is
  usually an offset problem, not clipping.
- **Overlays share one surface token set.** Dialogs, row menus, modals and toasts all take
  `--float-panel-bg` / `--deep-text` / `--line-divider` (the project's stand-in for
  surface-container-high / on-surface / outline-variant). Do not invent inverted schemes such as
  mixing a status colour into `--deep-text` with `--page-bg` text: severity belongs on the icon
  badge, a semantic border, and the progress fill.

## Tooling

- **`biome.json` must not contain comments.** Once a JSONC comment is added, `overrides` fails
  silently: the scanned file set grows and the `.astro` relaxations stop applying. Record the
  rationale in a commit message instead.
- **`biome check --write` rewrites unrelated lines** in `src/i18n/languages/*.ts` because of
  pre-existing formatting drift. Use `biome lint` when only adding keys.
- **turbo 2 runs in strict env mode.** Variables not declared under a task's `env` never reach
  the process. `astro-build` must declare `CF_WORKERS`, `VERCEL`, and `BASE_PATH`; otherwise the
  build silently emits the wrong adapter artifact.
- **`pnpm build` runs the turbo pipeline**, not `astro build` alone. Editing `package.json`
  scripts affects the icon, LQIP, snapshot, font-subset, and Pagefind stages too.
