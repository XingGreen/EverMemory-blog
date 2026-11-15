# Component API Rules

Conventions for Svelte components' public interfaces. Verified against this repository's own
components — `SecretFields.svelte` and its consumers are the reference implementation. Static
Astro components follow the same naming spirit where applicable.

## 1. Static vs interactive

Astro (`.astro`) for markup with no client state — it renders on the server and costs zero
JS. Svelte 5 (`.svelte`) only when the component needs state, events, or focus management.
A component that only toggles a class or navigates does not justify hydration.

## 2. Props

- **Minimal surface, data passed in.** Display data comes from the caller; a component does
  not fetch its own content. `SecretFields` takes `rows`, `itemOf`, `drafts`, and callback
  props — it never calls an API.
- **Callbacks are lowercase `on` + verb**: `oninput`, `onselect`, `onclose`, `onrefresh`.
  This matches the Svelte 5 event convention and the existing codebase (`onNotify`,
  `onStateChange`, `onInput`, `onAddress`, `onView`, `onEdit`, `onRotate`). Never camelCase
  `onChange`.
- **`$bindable` for two-way state, callbacks for side effects.** If the parent must read and
  write the value, use `$bindable`. If the parent only needs to react, use a callback. Both
  may coexist on one component (a bound `open` plus an `onclose` event), but do not add a
  callback for a state change the parent already owns through binding.
- **`class` passthrough must merge, never overwrite** the caller's classes.
- Variant/size-style enums use lowercase semantic values (`soft`, `ghost`, `sm`); no
  abbreviations.

## 3. Content slots

Svelte 5 components take `children?: import("svelte").Snippet` and render it with
`{@render children?.()}`. Do not use the legacy `<slot>` element. Named snippets for
structured extension points (dialog actions, panel footers).

## 4. Structure rules

- Native semantics first: real `<button>`, `<input>`, `<a>`. Never nest interactive elements
  (`<a>` wrapping `<button>`).
- Provide `href` → render `<a>`; provide `onclick` on a non-link → render `<button>`.
- Icon-only controls take an explicit `aria-label` prop; visible text wins when present.
- Inputs and textareas: `width: 100%; min-width: 0` on the root and the native element, so
  intrinsic width cannot defeat the parent layout (see `rules/pitfalls.md`, Forms and
  layout).

## 5. Conditional rendering (zero burden)

An optional or unconfigured component renders nothing — no empty shell with height, padding,
or a placeholder border. Heavy optional dependencies load on demand, never via top-level
import. Full policy in `AGENTS.md` ("Zero-burden optionals").

## 6. Anti-patterns

- `onChange` camelCase callbacks; uppercase enum values (`variant="PRIMARY"`).
- A component fetching its own data or owning `localStorage` when its parent already holds
  the state.
- Empty-shell rendering for a disabled optional feature.
- Overwriting the caller's `class` instead of merging.
