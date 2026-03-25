// css-manager.ts — Discovers and loads stylesheets from .typeset/
// Implemented in Issue #27: Create css-manager.ts

import { App } from "obsidian";
import {
	PageLayout,
	PageMargins,
	PageOrientation,
	PageSize,
	ThemeInfo,
} from "./types";

const TYPESET_FOLDER = ".typeset";

// Built-in themes are always available regardless of vault contents.
// CSS is loaded from the plugin's own styles/ folder at runtime.
const BUILT_IN_THEMES: ThemeInfo[] = [
	{ name: "Default", filename: "default.css", isBuiltIn: true },
	{ name: "D&D Homebrew", filename: "dnd-homebrew.css", isBuiltIn: true },
];

export class CssManager {
	constructor(private app: App) {}

	/**
	 * Returns all available themes: built-ins first, then any .css files
	 * found in <vault>/.typeset/. Never throws — missing folder returns
	 * only built-ins.
	 */
	async getAvailableThemes(): Promise<ThemeInfo[]> {
		const userThemes = await this.discoverUserThemes();
		return [...BUILT_IN_THEMES, ...userThemes];
	}

	/**
	 * Loads the CSS string for a given theme.
	 * Built-in themes are read from the plugin's styles/ directory.
	 * User themes are read from <vault>/.typeset/<filename>.
	 * Returns an empty string if the file cannot be read.
	 */
	async loadThemeCss(theme: ThemeInfo): Promise<string> {
		try {
			if (theme.isBuiltIn) {
				// Built-in themes live next to main.js in the plugin folder
				const pluginDir = this.app.vault.configDir + "/plugins/obsidian-typeset";
				const path = `${pluginDir}/styles/${theme.filename}`;
				return await this.app.vault.adapter.read(path);
			} else {
				const path = `${TYPESET_FOLDER}/${theme.filename}`;
				return await this.app.vault.adapter.read(path);
			}
		} catch {
			console.warn(`[Typeset] Could not load theme "${theme.filename}"`);
			return "";
		}
	}

	/**
	 * Scans <vault>/.typeset/ for .css files and returns a ThemeInfo for each.
	 * Parses any layout override comment at the top of each file.
	 * Returns [] if the folder doesn't exist or is empty.
	 */
	private async discoverUserThemes(): Promise<ThemeInfo[]> {
		try {
			const exists = await this.app.vault.adapter.exists(TYPESET_FOLDER);
			if (!exists) return [];

			const { files } = await this.app.vault.adapter.list(TYPESET_FOLDER);
			const cssFiles = files.filter((f) => f.endsWith(".css"));

			const themes: ThemeInfo[] = [];
			for (const filepath of cssFiles) {
				const filename = filepath.split("/").pop() ?? filepath;
				const name = filename.replace(/\.css$/, "").replace(/[-_]/g, " ");
				let layoutOverrides: Partial<PageLayout> | undefined;

				try {
					const css = await this.app.vault.adapter.read(filepath);
					layoutOverrides = parseLayoutOverride(css) ?? undefined;
				} catch {
					// Can't read the file — still list the theme, just no overrides
				}

				themes.push({
					name: toTitleCase(name),
					filename,
					isBuiltIn: false,
					...(layoutOverrides ? { layoutOverrides } : {}),
				});
			}

			return themes;
		} catch (err) {
			console.warn("[Typeset] Error scanning .typeset/ folder:", err);
			return [];
		}
	}
}

/**
 * Parses a layout override comment from the top of a CSS file.
 *
 * Expected format (must appear within the first 500 characters):
 *   /* typeset-layout: size=A4, orientation=Portrait, margins=20mm *\/
 *
 * All fields are optional. Returns null if no valid comment is found.
 */
export function parseLayoutOverride(css: string): Partial<PageLayout> | null {
	const header = css.slice(0, 500);
	const match = header.match(/\/\*\s*typeset-layout:\s*([^*]+)\*\//);
	if (!match) return null;

	const parts = match[1].trim();
	const result: Partial<PageLayout> = {};

	// size=A4
	const sizeMatch = parts.match(/\bsize=(\w+)/i);
	if (sizeMatch) {
		const size = sizeMatch[1] as PageSize;
		if (Object.values(PageSize).includes(size)) result.size = size;
	}

	// orientation=Portrait|Landscape
	const orientMatch = parts.match(/\borientation=(\w+)/i);
	if (orientMatch) {
		const orient = orientMatch[1] as PageOrientation;
		if (Object.values(PageOrientation).includes(orient))
			result.orientation = orient;
	}

	// margins=20mm  — applies the same value to all four sides
	const marginsMatch = parts.match(/\bmargins=(\d+(?:\.\d+)?)(mm|in|px)/i);
	if (marginsMatch) {
		const value = parseFloat(marginsMatch[1]);
		const unit = marginsMatch[2].toLowerCase() as PageMargins["unit"];
		result.margins = { top: value, right: value, bottom: value, left: value, unit };
	}

	return Object.keys(result).length > 0 ? result : null;
}

function toTitleCase(str: string): string {
	return str.replace(/\b\w/g, (c) => c.toUpperCase());
}
