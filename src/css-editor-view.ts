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

import { ItemView, WorkspaceLeaf } from "obsidian";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type TypesetPlugin from "./main";

export const VIEW_TYPE_CSS_EDITOR = "typeset-css-editor";

export class CssEditorView extends ItemView {
	private plugin: TypesetPlugin;
	private cmView: EditorView | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: TypesetPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_CSS_EDITOR;
	}

	getDisplayText(): string {
		return `CSS Editor — ${this.plugin.settings.activeTheme}`;
	}

	getIcon(): string {
		return "lucide-file-code";
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();

		// ── Header ──────────────────────────────────────────────────────────
		const header = contentEl.createDiv({ cls: "typeset-css-editor-header" });
		header.createSpan({ text: this.plugin.settings.activeTheme });

		// ── Load active theme CSS ────────────────────────────────────────────
		const themes = await this.plugin.cssManager.getAvailableThemes();
		const activeThemeInfo = themes.find(
			t => t.filename === this.plugin.settings.activeTheme,
		);
		const css = activeThemeInfo
			? await this.plugin.cssManager.loadThemeCss(activeThemeInfo)
			: "";

		// ── CM6 editor ──────────────────────────────────────────────────────
		const editorEl = contentEl.createDiv({ cls: "typeset-css-editor-cm" });

		const state = EditorState.create({ doc: css });
		this.cmView = new EditorView({ state, parent: editorEl });
	}

	async onClose(): Promise<void> {
		this.cmView?.destroy();
		this.cmView = null;
	}
}
