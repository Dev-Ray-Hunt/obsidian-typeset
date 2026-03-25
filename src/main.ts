import { Modal, Notice, Plugin, TFile } from "obsidian";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
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
		// THROWAWAY — Issue #32: Prove CM6 works via Obsidian's bundled instance.
		// This command is removed/replaced in Issue #33.
		// -----------------------------------------------------------------------
		this.addCommand({
			id: "test-cm6-editor",
			name: "Test CM6 editor (throwaway)",
			callback: () => {
				const modal = new (class extends Modal {
					onOpen() {
						const state = EditorState.create({
							doc: "/* CM6 is working! Type here to confirm. */\n",
						});
						const view = new EditorView({
							state,
							parent: this.contentEl,
						});
						console.log("CM6 EditorView mounted", view);
					}
					onClose() {
						this.contentEl.empty();
					}
				})(this.app);
				modal.open();
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
