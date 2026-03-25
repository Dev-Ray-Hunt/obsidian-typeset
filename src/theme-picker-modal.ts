// theme-picker-modal.ts — Fuzzy suggest modal for per-note theme selection
// Implemented in Issue #67: Per-note theme selection via YAML frontmatter

import { App, FuzzyMatch, FuzzySuggestModal, TFile } from "obsidian";
import { CssManager } from "./css-manager";
import { ThemeInfo } from "./types";

/**
 * Opens a fuzzy search modal listing all available themes.
 * On selection, writes `typeset-theme: <filename>` to the note's frontmatter
 * using Obsidian's built-in processFrontMatter API (handles both insert and update).
 */
export class ThemePickerModal extends FuzzySuggestModal<ThemeInfo> {
	private cssManager: CssManager;

	constructor(app: App, private file: TFile) {
		super(app);
		this.cssManager = new CssManager(app);
		this.setPlaceholder("Choose a theme for this note…");
	}

	async onOpen(): Promise<void> {
		// Pre-load themes before the modal opens so the list is immediately ready
		this.items = await this.cssManager.getAvailableThemes();
		super.onOpen();
	}

	// Required by FuzzySuggestModal — returns the pre-loaded list
	private items: ThemeInfo[] = [];
	getItems(): ThemeInfo[] {
		return this.items;
	}

	getItemText(theme: ThemeInfo): string {
		// Searched against both display name and filename
		return `${theme.name} ${theme.filename}`;
	}

	renderSuggestion(match: FuzzyMatch<ThemeInfo>, el: HTMLElement): void {
		const theme = match.item;
		el.createEl("div", { text: theme.name });
		el.createEl("small", {
			text: theme.isBuiltIn ? `${theme.filename} — built-in` : theme.filename,
			cls: "suggestion-note",
		});
	}

	onChooseItem(theme: ThemeInfo): void {
		// processFrontMatter safely creates or updates the frontmatter block
		this.app.fileManager.processFrontMatter(this.file, (fm) => {
			fm["typeset-theme"] = theme.filename;
		});
	}
}
