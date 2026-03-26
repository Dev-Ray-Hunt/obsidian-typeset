// css-editor-view.ts — CodeMirror 6 CSS editor Obsidian View
// Implemented in Issue #33: Create css-editor-view.ts
// Auto-save added in Issue #34: Implement auto-save on edit
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

import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { EditorState } from "@codemirror/state";
import { EditorView, ViewUpdate } from "@codemirror/view";
import type TypesetPlugin from "./main";
import type { ThemeInfo } from "./types";

export const VIEW_TYPE_CSS_EDITOR = "typeset-css-editor";

const AUTOSAVE_DELAY_MS = 500;

export class CssEditorView extends ItemView {
	private plugin: TypesetPlugin;
	private cmView: EditorView | null = null;
	private activeTheme: ThemeInfo | null = null;
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingSave = false;
	private headerStatus: HTMLSpanElement | null = null;

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
		this.headerStatus = header.createSpan({ cls: "typeset-css-editor-status" });

		// ── Resolve active theme ─────────────────────────────────────────────
		const themes = await this.plugin.cssManager.getAvailableThemes();
		this.activeTheme =
			themes.find(t => t.filename === this.plugin.settings.activeTheme) ?? null;

		const css = this.activeTheme
			? await this.plugin.cssManager.loadThemeCss(this.activeTheme)
			: "";

		// ── CM6 editor ──────────────────────────────────────────────────────
		const editorEl = contentEl.createDiv({ cls: "typeset-css-editor-cm" });

		const extensions = this.activeTheme?.isBuiltIn
			? [EditorState.readOnly.of(true)]
			: [
					EditorView.updateListener.of((update: ViewUpdate) => {
						if (update.docChanged) this.scheduleSave();
					}),
			  ];

		const state = EditorState.create({ doc: css, extensions });
		this.cmView = new EditorView({ state, parent: editorEl });

		if (this.activeTheme?.isBuiltIn) {
			this.setStatus("Read-only (built-in theme)");
		}
	}

	async onClose(): Promise<void> {
		// Flush any pending debounced save before the view is torn down.
		if (this.pendingSave) {
			if (this.saveTimer !== null) {
				clearTimeout(this.saveTimer);
				this.saveTimer = null;
			}
			await this.flushSave();
		}
		this.cmView?.destroy();
		this.cmView = null;
	}

	// ── Private helpers ───────────────────────────────────────────────────────

	private scheduleSave(): void {
		this.pendingSave = true;
		if (this.saveTimer !== null) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			this.flushSave();
		}, AUTOSAVE_DELAY_MS);
	}

	private async flushSave(): Promise<void> {
		if (!this.activeTheme || !this.cmView) return;
		const css = this.cmView.state.doc.toString();
		try {
			await this.plugin.cssManager.saveThemeCss(this.activeTheme, css);
			this.pendingSave = false;
			this.setStatus("Saved");
			setTimeout(() => this.setStatus(""), 2000);
		} catch (err) {
			console.error("[Typeset] Auto-save failed:", err);
			new Notice("Typeset: failed to save stylesheet. Check the console for details.");
		}
	}

	private setStatus(text: string): void {
		if (this.headerStatus) this.headerStatus.setText(text);
	}
}
