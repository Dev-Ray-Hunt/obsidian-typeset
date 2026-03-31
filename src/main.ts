import { Notice, Plugin, TFile } from "obsidian";
import { CssEditorView, VIEW_TYPE_CSS_EDITOR } from "./css-editor-view";
import { TypesetPreviewView, VIEW_TYPE_PREVIEW } from "./preview-view";
import { NewStylesheetModal } from "./new-stylesheet-modal";
import { TypesetSettings } from "./types";
import {
	loadSettings,
	saveSettings,
	TypesetSettingTab,
} from "./settings";
import { CssManager } from "./css-manager";
import { TypesetThemeSuggest } from "./typeset-suggest";
import { ThemePickerModal } from "./theme-picker-modal";

export default class TypesetPlugin extends Plugin {
	settings!: TypesetSettings;
	cssManager!: CssManager;
	

	async onload(): Promise<void> {
		this.settings = await loadSettings(this);
		this.cssManager = new CssManager(this.app);
		this.registerEditorSuggest(new TypesetThemeSuggest(this.app));
		this.registerView(
			VIEW_TYPE_CSS_EDITOR,
			leaf => new CssEditorView(leaf, this),
		);
		this.registerView(
			VIEW_TYPE_PREVIEW,
			leaf => new TypesetPreviewView(leaf, this),
		);

		this.addSettingTab(
			new TypesetSettingTab(
				this.app,
				this,
				this.settings,
				settings => saveSettings(this, settings),
				() => this.cssManager.getAvailableThemes(),
			),
		);

		// -----------------------------------------------------------------------
		// Export helper — shared by both the command and the ribbon button.
		// Lazily imports PdfExporter so the Electron/fs code is only loaded when
		// the user actually triggers an export, not on every plugin load.
		// -----------------------------------------------------------------------
		const runExport = async () => {
			const file = this.app.workspace.getActiveFile();
			if (!(file instanceof TFile)) {
				new Notice("No active note to export.");
				return;
			}
			const { PdfExporter } = await import("./pdf-exporter");
			const exporter = new PdfExporter(this.app, this.settings);
			await exporter.export(file);
		};
		

		// -----------------------------------------------------------------------
		// Command Palette entry
		// Registered with addCommand() — Obsidian auto-cleans it on unload.
		// Users can assign a hotkey via Settings → Hotkeys → "Typeset".
		// -----------------------------------------------------------------------
		this.addCommand({
			id: "export-to-pdf",
			name: "Export current note to PDF",
			callback: runExport,
		});

		this.addCommand({
			id: "set-note-theme",
			name: "Set theme for this note",
			callback: () => {
				const file = this.app.workspace.getActiveFile();
				if (!(file instanceof TFile)) {
					new Notice("No active note.");
					return;
				}
				new ThemePickerModal(this.app, file).open();
			},
		});

		// -----------------------------------------------------------------------
		// Open CSS Editor — opens the CM6-powered CSS editor in a new pane.
		// If a pane is already open, it is focused instead of duplicated.
		// -----------------------------------------------------------------------
		this.addCommand({
			id: "open-css-editor",
			name: "Open CSS editor",
			callback: async () => {
				const existing =
					this.app.workspace.getLeavesOfType(VIEW_TYPE_CSS_EDITOR);
				if (existing.length > 0) {
					this.app.workspace.revealLeaf(existing[0]);
					return;
				}
				await this.app.workspace
					.getLeaf(true)
					.setViewState({ type: VIEW_TYPE_CSS_EDITOR, active: true });
			},
		});

		// -----------------------------------------------------------------------
		// New Stylesheet — prompts for a name, creates the file in .typeset/,
		// sets it as the active theme, and opens it in the CSS editor.
		// -----------------------------------------------------------------------
		this.addCommand({
			id: "new-stylesheet",
			name: "New stylesheet",
			callback: () => {
				new NewStylesheetModal(this.app, async (filename) => {
					try {
						const STARTER = `/* typeset-layout: size=A4, orientation=Portrait */\n\n/* ========================\n   My Custom Theme\n   ======================== */\n\nbody {\n  font-family: Georgia, serif;\n  font-size: 11pt;\n  line-height: 1.5;\n}\n`;
						await this.cssManager.createUserTheme(filename, STARTER);
						this.settings.activeTheme = filename;
						await saveSettings(this, this.settings);

						// Close any existing CSS editor pane and open a fresh one
						// so it loads the newly created file.
						this.app.workspace
							.getLeavesOfType(VIEW_TYPE_CSS_EDITOR)
							.forEach(leaf => leaf.detach());
						await this.app.workspace
							.getLeaf(true)
							.setViewState({ type: VIEW_TYPE_CSS_EDITOR, active: true });
					} catch (err) {
						console.error("[Typeset] Failed to create stylesheet:", err);
						new Notice(`Typeset: ${(err as Error).message}`);
					}
				}).open();
			},
		});

		// -----------------------------------------------------------------------
		// Focus CSS Editor Search — no default hotkey to avoid conflicting with
		// Obsidian's built-in Cmd-F search. User assigns their own key via
		// Settings → Hotkeys → "Typeset: Focus CSS editor search".
		// -----------------------------------------------------------------------
		this.addCommand({
			id: "focus-css-editor-search",
			name: "Focus CSS editor search",
			callback: () => {
				const leaves =
					this.app.workspace.getLeavesOfType(VIEW_TYPE_CSS_EDITOR);
				if (leaves.length === 0) return;
				const view = leaves[0].view;
				if (view instanceof CssEditorView) {
					this.app.workspace.revealLeaf(leaves[0]);
					view.focusSearch();
				}
			},
		});

		// -----------------------------------------------------------------------
		// Open Print Preview — opens the paginated HTML preview in the right pane.
		// If already open, focuses it instead of duplicating.
		// -----------------------------------------------------------------------
		this.addCommand({
			id: "open-print-preview",
			name: "Open print preview",
			callback: async () => {
				const existing =
					this.app.workspace.getLeavesOfType(VIEW_TYPE_PREVIEW);
				if (existing.length > 0) {
					this.app.workspace.revealLeaf(existing[0]);
					return;
				}
				const leaf = this.app.workspace.getLeaf("split", "vertical");
				await leaf.setViewState({ type: VIEW_TYPE_PREVIEW, active: true });
				this.app.workspace.revealLeaf(leaf);
			},
		});

		// -----------------------------------------------------------------------
		// Ribbon button (left sidebar icon)
		// "lucide-printer" is one of Obsidian's built-in Lucide icons.
		// The returned element is ignored — Obsidian cleans it up on unload.
		// -----------------------------------------------------------------------
		this.addRibbonIcon("lucide-printer", "Export to PDF", runExport);

		console.log(`Typeset: plugin loaded (v${this.manifest.version})`);
	}

	onunload(): void {
		console.log("Typeset: plugin unloaded");
	}
}
