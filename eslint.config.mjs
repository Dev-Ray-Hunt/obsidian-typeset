import tseslint from "typescript-eslint";

// ESLint flat config (ESLint 9+)
// Docs: https://typescript-eslint.io/getting-started/

export default tseslint.config(
	// ── TypeScript source files ──────────────────────────────────────────────
	{
		files: ["src/**/*.ts"],

		// Start from typescript-eslint's recommended ruleset, which includes
		// the parser (@typescript-eslint/parser) and core TS-aware rules.
		extends: [...tseslint.configs.recommended],

		rules: {
			// ── Variables ────────────────────────────────────────────────────
			// Unused variables are usually bugs — but allow them when prefixed
			// with _ (convention for intentionally unused function parameters).
			"@typescript-eslint/no-unused-vars": [
				"error",
				{ argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
			],

			// ── Return types ─────────────────────────────────────────────────
			// Explicit return types on every function is too noisy for small
			// helpers. TypeScript infers them well. We enforce them on public
			// API boundaries manually via code review.
			"@typescript-eslint/explicit-function-return-type": "off",
			"@typescript-eslint/explicit-module-boundary-types": "off",

			// ── Console ──────────────────────────────────────────────────────
			// Per REQUIREMENTS.md, we use console.error for debug logging.
			// Keep it — don't warn on every console call.
			"no-console": "off",

			// ── Any ──────────────────────────────────────────────────────────
			// Warn (not error) on explicit `any` — sometimes unavoidable when
			// working with Obsidian's loosely-typed internal APIs.
			"@typescript-eslint/no-explicit-any": "warn",

			// ── Empty blocks ─────────────────────────────────────────────────
			// Empty catch blocks are almost always a mistake. Make it an error.
			"no-empty": ["error", { allowEmptyCatch: false }],

			// ── Promises ─────────────────────────────────────────────────────
			// Forgetting to await a promise is a common async bug.
			"@typescript-eslint/no-floating-promises": "error",
		},
	},

	// ── Ignore generated/non-source files ────────────────────────────────────
	{
		ignores: [
			"main.js",        // esbuild output — not our source
			"node_modules/**",
			"test-vault/**",  // Obsidian vault — not plugin code
		],
	}
);
