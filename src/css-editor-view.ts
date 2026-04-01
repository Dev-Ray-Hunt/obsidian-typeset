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

import { ItemView, MarkdownView, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, ViewUpdate } from "@codemirror/view";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { css as cssLanguage } from "@codemirror/lang-css";
import type TypesetPlugin from "./main";
import type { ThemeInfo } from "./types";
import { TypesetPreviewView, VIEW_TYPE_PREVIEW } from "./preview-view";
import { cssSearchField, setSearchQuery } from "./css-search-query";

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
	private searchInput: HTMLInputElement | null = null;
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

		// Use flex layout so search bar + info bar + editor stack correctly.
		contentEl.style.cssText = "display:flex;flex-direction:column;height:100%;overflow:hidden;padding:0;";

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

		// ── Search bar — full width across top ──────────────────────────────
		this.searchInput = contentEl.createEl("input", {
			type: "text",
			cls: "typeset-css-editor-search",
			attr: { placeholder: "Search selectors & properties…" },
		});
		this.searchInput.addEventListener("input", () => {
			if (!this.cmView) return;
			this.cmView.dispatch({
				effects: setSearchQuery.of(this.searchInput?.value ?? ""),
			});
		});

		// ── Info bar — file picker chip + apply button + status ──────────────
		const infoBar = contentEl.createDiv({ cls: "typeset-css-editor-info-bar" });
		infoBar.style.cssText =
			"display:flex;align-items:center;gap:8px;padding:4px 12px;" +
			"font-size:11px;color:var(--text-muted);border-bottom:1px solid var(--background-modifier-border);" +
			"background:var(--background-secondary);flex-shrink:0;";

		const chipCss =
			"display:flex;align-items:center;gap:4px;cursor:pointer;" +
			"padding:2px 6px;border-radius:4px;transition:background 0.1s;" +
			"color:var(--text-muted);";

		// File picker — styled <select> that looks like an info bar chip
		const fileChipWrapper = infoBar.createSpan();
		fileChipWrapper.style.cssText = chipCss;
		const fileIcon = fileChipWrapper.createSpan();
		setIcon(fileIcon, "lucide-file-code");
		fileIcon.style.cssText = "display:flex;align-items:center;width:12px;height:12px;";
		this.dropdown = fileChipWrapper.createEl("select", {
			cls: "typeset-css-editor-dropdown",
		});
		this.dropdown.style.cssText =
			"background:none;border:none;color:var(--text-muted);font-size:11px;" +
			"cursor:pointer;outline:none;padding:0;font-family:inherit;" +
			"-webkit-appearance:none;appearance:none;";
		this.buildDropdown();
		this.dropdown.addEventListener("change", () => this.onDropdownChange());
		fileChipWrapper.addEventListener("mouseenter", () => fileChipWrapper.style.background = "var(--background-modifier-hover)");
		fileChipWrapper.addEventListener("mouseleave", () => fileChipWrapper.style.background = "");

		// Separator
		infoBar.createSpan({ text: "·", attr: { style: "opacity:0.4;" } });

		// "Apply to note" button — sets typeset-theme on the active note
		const applyChip = infoBar.createSpan();
		applyChip.style.cssText = chipCss;
		applyChip.setAttribute("aria-label", "Set as theme for active note");
		const applyIcon = applyChip.createSpan();
		setIcon(applyIcon, "lucide-file-check");
		applyIcon.style.cssText = "display:flex;align-items:center;width:12px;height:12px;";
		applyChip.createSpan({ text: "Apply to note" });
		applyChip.addEventListener("mouseenter", () => applyChip.style.background = "var(--background-modifier-hover)");
		applyChip.addEventListener("mouseleave", () => applyChip.style.background = "");
		applyChip.addEventListener("click", () => this.applyThemeToActiveNote());

		// Spacer to push status to the right
		infoBar.createDiv({ attr: { style: "flex:1;" } });

		this.headerStatus = infoBar.createSpan({
			cls: "typeset-css-editor-status",
		});

		// ── Load CSS ─────────────────────────────────────────────────────────
		const css = this.activeTheme
			? await this.plugin.cssManager.loadThemeCss(this.activeTheme)
			: "";

		// ── CM6 editor ──────────────────────────────────────────────────────
		const editorEl = contentEl.createDiv({ cls: "typeset-css-editor-cm" });
		editorEl.style.cssText = "flex:1;min-height:0;overflow:auto;";
		const isBuiltIn = this.activeTheme?.isBuiltIn ?? false;

		const state = EditorState.create({
			doc: css,
			extensions: [
				// CSS language support — bundled (Obsidian does not provide lang-css).
				cssLanguage(),
				// Token colouring — uses @codemirror/language which IS external.
				syntaxHighlighting(defaultHighlightStyle),
				// Search highlight decorations — reacts to setSearchQuery effects.
				cssSearchField,
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

		// getDisplayText() was called by Obsidian before onOpen() resolved
		// the theme, so we force both the tab and the pane header to refresh.
		this.refreshPaneTitle();
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

	// ── Public API ────────────────────────────────────────────────────────────

	/**
	 * Focuses the search input and selects any existing text.
	 * Called by the "Focus CSS editor search" command (Mod+F, reassignable
	 * in Obsidian Settings → Hotkeys).
	 */
	focusSearch(): void {
		if (!this.searchInput) return;
		this.searchInput.focus();
		this.searchInput.select();
	}

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
		this.refreshPaneTitle();
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
			// Refresh any open preview panes so CSS changes appear live.
			for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_PREVIEW)) {
				if (leaf.view instanceof TypesetPreviewView) {
					leaf.view.refresh();
				}
			}
		} catch (err) {
			console.error("[Typeset] Auto-save failed:", err);
			new Notice(
				"Typeset: failed to save stylesheet. Check the console for details.",
			);
		}
	}

	/**
	 * Refreshes the tab label and the pane header title.
	 *
	 * Obsidian calls getDisplayText() once when the view opens, before
	 * onOpen() resolves the actual theme. updateHeader() refreshes the tab
	 * but does not always update the separate .view-header-title element
	 * inside the pane, so we write that DOM node directly as a fallback.
	 */
	private refreshPaneTitle(): void {
		(this.leaf as any).updateHeader?.();

		const titleEl = this.containerEl
			.closest(".workspace-leaf")
			?.querySelector(".view-header-title");
		if (titleEl instanceof HTMLElement) {
			titleEl.textContent = this.getDisplayText();
		}
	}

	private setStatus(text: string): void {
		if (this.headerStatus) this.headerStatus.setText(text);
	}

	/** Sets the currently edited theme as typeset-theme on the active markdown note. */
	private applyThemeToActiveNote(): void {
		if (!this.activeTheme) return;

		// Find the most recent markdown file — check active file first,
		// then fall back to any open MarkdownView.
		let file = this.app.workspace.getActiveFile();
		if (!(file instanceof TFile) || file.extension !== "md") {
			const mdLeaves = this.app.workspace.getLeavesOfType("markdown");
			const mdView = mdLeaves[0]?.view as MarkdownView | undefined;
			file = mdView?.file ?? null;
		}
		if (!file) {
			new Notice("No active note to apply theme to.");
			return;
		}

		const themeName = this.activeTheme.filename;
		this.app.fileManager.processFrontMatter(file, (fm) => {
			fm["typeset-theme"] = themeName;
		});
		new Notice(`Theme "${this.activeTheme.name}" applied to ${file.basename}`);
	}
}
