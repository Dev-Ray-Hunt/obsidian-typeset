// css-editor-view.ts — CodeMirror 6 CSS editor Obsidian View
// Implemented in Issue #33: Create css-editor-view.ts
// Auto-save added in Issue #34: Implement auto-save on edit
// Theme dropdown + note-aware opening added in Issue #36
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

import { ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, ViewUpdate } from "@codemirror/view";
import type TypesetPlugin from "./main";
import type { ThemeInfo } from "./types";
import { saveSettings } from "./settings";

export const VIEW_TYPE_CSS_EDITOR = "typeset-css-editor";

const AUTOSAVE_DELAY_MS = 500;

export class CssEditorView extends ItemView {
	private plugin: TypesetPlugin;
	private cmView: EditorView | null = null;
	private activeTheme: ThemeInfo | null = null;
	private allThemes: ThemeInfo[] = [];
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingSave = false;
	private headerStatus: HTMLSpanElement | null = null;
	private dropdown: HTMLSelectElement | null = null;
	private readonly readOnlyCompartment = new Compartment();

	constructor(leaf: WorkspaceLeaf, plugin: TypesetPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_CSS_EDITOR;
	}

	getDisplayText(): string {
		return `CSS Editor — ${this.activeTheme?.name ?? this.plugin.settings.activeTheme}`;
	}

	getIcon(): string {
		return "lucide-file-code";
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();

		// ── Load all themes ──────────────────────────────────────────────────
		this.allThemes = await this.plugin.cssManager.getAvailableThemes();

		// ── Resolve initial theme ────────────────────────────────────────────
		// Prefer the active note's per-note theme (typeset-theme frontmatter),
		// then fall back to the global active theme from settings.
		const initialFilename = this.resolveInitialThemeFilename();
		this.activeTheme =
			this.allThemes.find(t => t.filename === initialFilename) ??
			this.allThemes.find(t => t.filename === this.plugin.settings.activeTheme) ??
			this.allThemes[0] ??
			null;

		// ── Header ──────────────────────────────────────────────────────────
		const header = contentEl.createDiv({ cls: "typeset-css-editor-header" });

		this.dropdown = header.createEl("select", {
			cls: "typeset-css-editor-dropdown",
		});
		this.buildDropdown();
		this.dropdown.addEventListener("change", () => this.onDropdownChange());

		this.headerStatus = header.createSpan({
			cls: "typeset-css-editor-status",
		});

		// ── Load CSS ─────────────────────────────────────────────────────────
		const css = this.activeTheme
			? await this.plugin.cssManager.loadThemeCss(this.activeTheme)
			: "";

		// ── CM6 editor ──────────────────────────────────────────────────────
		const editorEl = contentEl.createDiv({ cls: "typeset-css-editor-cm" });
		const isBuiltIn = this.activeTheme?.isBuiltIn ?? false;

		const state = EditorState.create({
			doc: css,
			extensions: [
				this.readOnlyCompartment.of(EditorState.readOnly.of(isBuiltIn)),
				EditorView.updateListener.of((update: ViewUpdate) => {
					if (update.docChanged && !this.activeTheme?.isBuiltIn) {
						this.scheduleSave();
					}
				}),
			],
		});

		this.cmView = new EditorView({ state, parent: editorEl });

		if (isBuiltIn) this.setStatus("Read-only (built-in theme)");

		// Refresh both the tab title and the pane header title now that we
		// know the actual active theme (getDisplayText() was called before
		// onOpen() resolved the theme).
		(this.leaf as any).updateHeader?.();
	}

	async onClose(): Promise<void> {
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

	// ── Public API (for future three-pane sync — see REQUIREMENTS §5.3b) ─────

	/**
	 * Loads a theme into the editor. Called by the dropdown and will be called
	 * by the workspace sync layer (Issue #69) when the active note changes.
	 */
	async loadTheme(theme: ThemeInfo): Promise<void> {
		if (!this.cmView) return;
		if (theme.filename === this.activeTheme?.filename) return;

		// Flush pending save for the outgoing theme before switching.
		if (this.pendingSave) {
			if (this.saveTimer !== null) {
				clearTimeout(this.saveTimer);
				this.saveTimer = null;
			}
			await this.flushSave();
		}

		this.activeTheme = theme;
		if (this.dropdown) this.dropdown.value = theme.filename;

		// Persist the new selection as the global active theme.
		this.plugin.settings.activeTheme = theme.filename;
		await saveSettings(this.plugin, this.plugin.settings);

		const css = await this.plugin.cssManager.loadThemeCss(theme);
		const isBuiltIn = theme.isBuiltIn;

		// Replace editor content and toggle read-only in one CM6 transaction.
		this.cmView.dispatch({
			changes: { from: 0, to: this.cmView.state.doc.length, insert: css },
			effects: this.readOnlyCompartment.reconfigure(
				EditorState.readOnly.of(isBuiltIn),
			),
		});

		this.setStatus(isBuiltIn ? "Read-only (built-in theme)" : "");

		// Refresh both the tab title and the pane header title now that
		// this.activeTheme has changed.
		(this.leaf as any).updateHeader?.();
	}

	// ── Private helpers ───────────────────────────────────────────────────────

	/**
	 * Returns the filename of the theme to load on open.
	 * Checks the active note's typeset-theme frontmatter first.
	 */
	private resolveInitialThemeFilename(): string {
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile instanceof TFile) {
			const fm =
				this.app.metadataCache.getFileCache(activeFile)?.frontmatter;
			const perNote = fm?.["typeset-theme"];
			if (typeof perNote === "string" && perNote.trim()) return perNote;
		}
		return this.plugin.settings.activeTheme;
	}

	/** Rebuilds the <select> options from this.allThemes. */
	private buildDropdown(): void {
		if (!this.dropdown) return;
		this.dropdown.empty();
		for (const theme of this.allThemes) {
			const label = theme.isBuiltIn
				? `${theme.name} (built-in)`
				: theme.name;
			const opt = this.dropdown.createEl("option", {
				text: label,
				value: theme.filename,
			});
			if (theme.filename === this.activeTheme?.filename) {
				opt.selected = true;
			}
		}
	}

	private async onDropdownChange(): Promise<void> {
		if (!this.dropdown) return;
		const theme = this.allThemes.find(
			t => t.filename === this.dropdown!.value,
		);
		if (theme) await this.loadTheme(theme);
	}

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
			new Notice(
				"Typeset: failed to save stylesheet. Check the console for details.",
			);
		}
	}

	private setStatus(text: string): void {
		if (this.headerStatus) this.headerStatus.setText(text);
	}
}
