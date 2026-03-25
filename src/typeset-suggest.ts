// typeset-suggest.ts — EditorSuggest for typeset frontmatter autocomplete
// Implemented in Issue #67: Per-note theme selection via YAML frontmatter

import {
	App,
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	TFile,
} from "obsidian";
import { CssManager } from "./css-manager";
import { ThemeInfo } from "./types";

/**
 * Provides theme filename autocomplete when the cursor is on a `theme:` line
 * inside a `typeset:` YAML frontmatter block.
 *
 * Triggers for:
 *   ---
 *   typeset-theme: <cursor here>
 *   ---
 */
export class TypesetThemeSuggest extends EditorSuggest<ThemeInfo> {
	private cssManager: CssManager;

	constructor(app: App) {
		super(app);
		this.cssManager = new CssManager(app);
	}

	onTrigger(
		cursor: EditorPosition,
		editor: Editor,
		_file: TFile | null
	): EditorSuggestTriggerInfo | null {
		if (!this.isInFrontmatter(cursor, editor)) return null;

		const line = editor.getLine(cursor.line);
		// Match a top-level "typeset-theme: <value>" line
		const match = line.match(/^(typeset-theme:\s*)(.*)$/);
		if (!match) return null;

		const prefixLen = match[1].length;
		if (cursor.ch < prefixLen) return null;

		return {
			start: { line: cursor.line, ch: prefixLen },
			end: cursor,
			query: match[2].slice(0, cursor.ch - prefixLen),
		};
	}

	async getSuggestions(context: EditorSuggestContext): Promise<ThemeInfo[]> {
		const themes = await this.cssManager.getAvailableThemes();
		const q = context.query.toLowerCase();
		if (!q) return themes;
		return themes.filter(
			(t) =>
				t.filename.toLowerCase().includes(q) ||
				t.name.toLowerCase().includes(q)
		);
	}

	renderSuggestion(theme: ThemeInfo, el: HTMLElement): void {
		el.createEl("div", { text: theme.name });
		el.createEl("div", {
			text: theme.filename,
			cls: "suggestion-note",
		});
	}

	selectSuggestion(theme: ThemeInfo, _evt: MouseEvent | KeyboardEvent): void {
		if (!this.context) return;
		this.context.editor.replaceRange(
			theme.filename,
			this.context.start,
			this.context.end
		);
	}

	/**
	 * Returns true if the cursor is inside the YAML frontmatter block
	 * (between the opening --- on line 0 and the closing ---).
	 */
	private isInFrontmatter(cursor: EditorPosition, editor: Editor): boolean {
		if (cursor.line === 0) return false;
		if (editor.getLine(0) !== "---") return false;
		for (let i = 1; i < cursor.line; i++) {
			if (editor.getLine(i) === "---") return false;
		}
		return true;
	}
}
