import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

// ─── Build mode ──────────────────────────────────────────────────────────────
// `npm run build` passes "production" as the first CLI argument.
// `npm run dev`   passes nothing → watch mode.
const isProd = process.argv[2] === "production";

// ─── Packages Obsidian provides at runtime ───────────────────────────────────
// These must NOT be bundled into main.js. Obsidian injects them directly into
// every plugin's JavaScript context when it loads the plugin. If we bundled
// our own copies, we'd get duplicate instances that break Obsidian's internals.
const obsidianExternals = [
  "obsidian",   // The Obsidian API itself
  "electron",          // Electron APIs (used in pdf-exporter.ts for printToPDF)
  "@electron/remote",  // Electron 14+ remote module — lives inside Obsidian, not node_modules

  // CodeMirror 6 — Obsidian ships its own CM6 build. We reuse it in Issue #32
  // (In-Plugin CSS Editor) rather than bundling a separate copy.
  "@codemirror/autocomplete",
  "@codemirror/collab",
  "@codemirror/commands",
  "@codemirror/language",
  "@codemirror/lint",
  "@codemirror/search",
  "@codemirror/state",
  "@codemirror/view",
  "@lezer/common",
  "@lezer/highlight",
  "@lezer/lr",
];

// ─── Timestamp plugin ─────────────────────────────────────────────────────────
// Prints the wall-clock time after every build so you know exactly when the
// last rebuild finished and can tell at a glance whether it picked up your save.
const timestampPlugin = {
  name: "timestamp",
  setup(build) {
    build.onEnd(() => {
      const now = new Date();
      const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      console.log(`⏱  Built at ${time}`);
    });
  },
};

// ─── esbuild context ─────────────────────────────────────────────────────────
const context = await esbuild.context({
  // Single entry point — esbuild follows all imports from here and bundles them.
  entryPoints: ["src/main.ts"],

  // Bundle everything into one file (except the externals listed above).
  bundle: true,

  // Output to the repo root. The symlink we create in Issue #8 will point
  // Obsidian's plugin loader here to find main.js.
  outfile: "main.js",

  // CommonJS format — the module format Obsidian's plugin loader expects.
  // (Different from our tsconfig `module: ESNext` — esbuild converts for us.)
  format: "cjs",

  // Match our tsconfig target. Electron/Chromium fully supports ES6.
  target: "es6",

  // Exclude obsidian/electron/node built-ins from the bundle.
  external: [...obsidianExternals, ...builtins],

  // Inline source maps in dev: stack traces in Obsidian's console will point
  // to your .ts source lines, not the compiled main.js.
  // No source maps in production: keeps the release file clean.
  sourcemap: isProd ? false : "inline",

  // Minify in production to reduce file size for distribution.
  // Not minified in dev so you can read main.js if you need to debug the bundle.
  minify: isProd,

  // Remove dead code (unreachable branches, unused exports) in all modes.
  treeShaking: true,

  // Print each build result (files, sizes, duration) to the terminal.
  logLevel: "info",

  plugins: [timestampPlugin],
});

// ─── Run ─────────────────────────────────────────────────────────────────────
if (isProd) {
  // Production build: compile once, exit with code 0 (success) or 1 (error).
  await context.rebuild();
  process.exit(0);
} else {
  // Dev watch mode: rebuild automatically on every file save.
  // The process stays alive until you press Ctrl+C.
  await context.watch();
  console.log("👁  Watching for changes — save any .ts file to rebuild.");
}
