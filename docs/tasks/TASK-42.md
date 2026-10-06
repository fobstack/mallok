# Task 42 — Inquiry form labels in the page's language

- Status: **done**.
- Date: 2026-10-06
- Scope: the labels of the form the `inquiry` plugin injects.
- Source: Nundar's item M17, received 2026-10-06
  (`docs/IMPLEMENTATION_PLAN.md`, phase six).

## 1. Demonstrable loop

A theme's `locales/de.json` defines `inquiry_name: "Ihr Name"` and the other
labels. The contact page at `/de/kontakt` shows the form with German labels
and a German button; a label the pack leaves out is the plugin's English
one. The English and Chinese pages are unchanged.

## 2. What changed

| File | Change |
| --- | --- |
| `src/plugins/types.ts`, `src/worker/public.d.ts` | `PluginRenderContext.t` |
| `src/worker/plugin-runtime.ts` | `runAfterRender` hands each hook the theme's strings for the page's locale |
| `src/plugins/inquiry/form.ts`, `index.ts` | Labels from `t.inquiry_*`, each falling back to the plugin's own |
| `test/worker/inquiry-form-language.test.ts` | New |
| `docs/` | `PLUGIN_API §5.3, §13.2`, `THEME_FORMAT §10`, the plan, the changelog |

## 3. Decisions and deviations

- **Owner decision, 2026-10-06:** the theme's language pack supplies the
  labels (the list's first shape).
- **This is a capability of every plugin, not a special case for one.** The
  official plugin takes the same path as any other, so the pack is on the
  `afterRender` context as `ctx.t` and the plugin reads it from there.
- **`ctx.t` is what templates read as `t`**: the page's locale over the
  theme's default one. One meaning for one name. The consequence is
  documented where a theme author will read it: a label defined only in the
  default pack is used on every language's pages, the Chinese ones too, in
  place of the plugin's Chinese.
- **A blank value counts as absent.**
- **Available whichever `pluginApi` a plugin declares.** It is a new field on
  a context, and removes nothing.
- **The official themes define none of the six keys.** They ship English and
  Chinese packs, which the plugin's own text already covers, so their output
  is byte-for-byte what it was.
- The pack is read once per render, and only when an enabled plugin has an
  `afterRender` hook.
- What the submit route answers with — a redirect, or its error response —
  is not part of this and was not changed: Nundar's item is about the labels.

## 4. Verification

- `test/worker/inquiry-form-language.test.ts`, on a Worker whose theme has a
  German pack naming five labels: the German page's labels and button, the
  blank and the absent key falling back, markup in a label escaped; the
  English and Chinese pages as before; a second plugin's hook receiving the
  pack; the form built with no pack identical to the form built with an
  empty one.
- Red-green: with `form.ts` reverted the German case fails; with an empty
  pack passed to hooks, that case and the hook case fail.
- `test/worker/inquiry.test.ts` unchanged and passing.
- The gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build &&
  pnpm bundle:size && pnpm admin:size`.

## 5. Not covered, and known risks

- What the submit route answers with was not looked at for language.
- Not run on a deployed site.
