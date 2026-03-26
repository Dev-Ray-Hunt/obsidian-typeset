import { Notice, Plugin, TFile } from "obsidian";
import { CssEditorView, VIEW_TYPE_CSS_EDITOR } from "./css-editor-view";
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

		this.addSettingTab(
			new TypesetSettingTab(this.app, this, this.settings, settings =>
				saveSettings(this, settings),
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
