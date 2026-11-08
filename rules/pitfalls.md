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
