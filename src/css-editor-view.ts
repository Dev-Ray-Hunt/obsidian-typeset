// css-editor-view.ts — CodeMirror 6 CSS editor Obsidian View
// Implemented in Issue #33: Create css-editor-view.ts
//
// ── How we use CodeMirror 6 ──────────────────────────────────────────────────
//
// Obsidian ships its own CM6 build (it powers the note editor). We reuse that
// instance rather than bundling our own copy, which would bloat the plugin and
// risk version conflicts at runtime.
//
// HOW IT WORKS:
//   1. `@codemirror/state` and `@codemirror/view` are listed in `obsidianExternals`
//      inside esbuild.config.mjs. esbuild excludes them from main.js entirely.
//   2. At runtime, Obsidian injects its own CM6 build into the plugin's JS context,
//      satisfying those imports automatically.
//   3. We install the packages as devDependencies only — so `tsc` has types to
//      check against, but no extra bytes end up in the bundle.
//
// EXCEPTION — @codemirror/lang-css:
//   Obsidian does NOT expose lang-css. It will be bundled by esbuild normally
//   and added as a devDependency in Issue #38.
//
// ─────────────────────────────────────────────────────────────────────────────
