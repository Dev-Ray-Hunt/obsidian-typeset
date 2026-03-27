// css-manager.ts — Discovers and loads stylesheets from the plugin folder
// Implemented in Issue #27: Create css-manager.ts
//
// Built-in themes live in <plugin>/built-in/ and are auto-discovered at
// runtime — no hardcoded list. Adding a new built-in is as simple as
// dropping a .css file in that folder.
//
// User themes live in <plugin>/themes/ and are also auto-discovered.
//
// Display name convention for built-in themes:
//   Add  /* typeset-name: Human Readable Name */  anywhere in the first
//   500 characters of the CSS file. Falls back to title-casing the filename.

import { App } from "obsidian";
import {
	PageLayout,
	PageMargins,
	PageOrientation,
	PageSize,
	ThemeInfo,
} from "./types";

const PLUGIN_ID = "obsidian-typeset";

export class CssManager {
	private pluginDir: string;
	/** Vault-relative path to built-in (read-only) themes. */
	private builtInDir: string;
	/**
	 * Vault-relative path where user stylesheets are stored.
	 * NOTE: This must stay at <plugin>/themes/ — see architecture note in CLAUDE.md.
	 */
	readonly themesDir: string;

	constructor(private app: App) {
		this.pluginDir  = `${app.vault.configDir}/plugins/${PLUGIN_ID}`;
		this.builtInDir = `${this.pluginDir}/built-in`;
		this.themesDir  = `${this.pluginDir}/themes`;
	}

	/**
	 * Returns all available themes: built-ins first (default.css always
	 * first among built-ins), then any .css files found in <plugin>/themes/.
	 * Never throws — missing folders return an empty list for that group.
	 */
	async getAvailableThemes(): Promise<ThemeInfo[]> {
		const [builtIns, userThemes] = await Promise.all([
			this.discoverBuiltInThemes(),
			this.discoverUserThemes(),
		]);
		return [...builtIns, ...userThemes];
	}

	/**
	 * Loads the CSS string for a given theme.
	 * Built-in themes come from <plugin>/built-in/.
	 * User themes come from <plugin>/themes/.
	 * Returns an empty string if the file cannot be read.
	 */
	async loadThemeCss(theme: ThemeInfo): Promise<string> {
		const path = theme.isBuiltIn
			? `${this.builtInDir}/${theme.filename}`
			: `${this.themesDir}/${theme.filename}`;
		try {
			return await this.app.vault.adapter.read(path);
		} catch {
			console.warn(`[Typeset] Could not load theme "${theme.filename}" from ${path}`);
			return "";
		}
	}

	/**
	 * Writes updated CSS content back to a user theme file on disk.
	 * Built-in themes are read-only — calling this for one throws an Error.
	 */
	async saveThemeCss(theme: ThemeInfo, css: string): Promise<void> {
		if (theme.isBuiltIn) {
			throw new Error(`[Typeset] Cannot overwrite built-in theme "${theme.filename}"`);
		}
		await this.app.vault.adapter.write(`${this.themesDir}/${theme.filename}`, css);
	}

	/**
	 * Creates a new user stylesheet in <plugin>/themes/ and returns its ThemeInfo.
	 * Creates the themes/ folder if it doesn't exist yet.
	 * Throws if a file with that name already exists.
	 */
	async createUserTheme(filename: string, css: string): Promise<ThemeInfo> {
		await this.ensureThemesDirExists();
		const path = `${this.themesDir}/${filename}`;
		if (await this.app.vault.adapter.exists(path)) {
			throw new Error(`[Typeset] Stylesheet "${filename}" already exists`);
		}
		await this.app.vault.adapter.write(path, css);
		const name = filename.replace(/\.css$/, "").replace(/[-_]/g, " ");
		return { name: toTitleCase(name), filename, isBuiltIn: false };
	}

	private async ensureThemesDirExists(): Promise<void> {
		if (!(await this.app.vault.adapter.exists(this.themesDir))) {
			await this.app.vault.adapter.mkdir(this.themesDir);
		}
	}

	/**
	 * Scans <plugin>/built-in/ for .css files and returns a ThemeInfo for each.
	 * Reads each file to extract a display name (typeset-name comment) and any
	 * layout overrides (typeset-layout comment). default.css is always sorted first.
	 */
	private async discoverBuiltInThemes(): Promise<ThemeInfo[]> {
		try {
			const exists = await this.app.vault.adapter.exists(this.builtInDir);
			if (!exists) return [];

			const { files } = await this.app.vault.adapter.list(this.builtInDir);
			const cssFiles = files.filter(f => f.endsWith(".css"));

			const themes: ThemeInfo[] = [];
			for (const filepath of cssFiles) {
				const filename = filepath.split("/").pop() ?? filepath;
				let displayName = filenameToTitle(filename);
				let layoutOverrides: Partial<PageLayout> | undefined;

				try {
					const css = await this.app.vault.adapter.read(filepath);
					displayName = parseCssName(css) ?? displayName;
					layoutOverrides = parseLayoutOverride(css) ?? undefined;
				} catch {
					// Can't read the file — still list the theme, just no metadata
				}

				themes.push({
					name: displayName,
					filename,
					isBuiltIn: true,
					...(layoutOverrides ? { layoutOverrides } : {}),
				});
			}

			// Keep default.css first; sort remaining built-ins alphabetically.
			themes.sort((a, b) => {
				if (a.filename === "default.css") return -1;
				if (b.filename === "default.css") return 1;
				return a.name.localeCompare(b.name);
			});

			return themes;
		} catch (err) {
			console.warn("[Typeset] Error scanning built-in themes folder:", err);
			return [];
		}
	}

	/**
	 * Scans <plugin>/themes/ for .css files and returns a ThemeInfo for each.
	 * Parses any layout override comment at the top of each file.
	 * Returns [] if the folder doesn't exist or is empty.
	 */
	private async discoverUserThemes(): Promise<ThemeInfo[]> {
		try {
			const exists = await this.app.vault.adapter.exists(this.themesDir);
			if (!exists) return [];

			const { files } = await this.app.vault.adapter.list(this.themesDir);
			const cssFiles = files.filter(f => f.endsWith(".css"));

			const themes: ThemeInfo[] = [];
			for (const filepath of cssFiles) {
				const filename = filepath.split("/").pop() ?? filepath;
				const name = filenameToTitle(filename);
				let layoutOverrides: Partial<PageLayout> | undefined;

				try {
					const css = await this.app.vault.adapter.read(filepath);
					layoutOverrides = parseLayoutOverride(css) ?? undefined;
				} catch {
					// Can't read the file — still list the theme, just no overrides
				}

				themes.push({
					name,
					filename,
					isBuiltIn: false,
					...(layoutOverrides ? { layoutOverrides } : {}),
				});
			}

			return themes;
		} catch (err) {
			console.warn("[Typeset] Error scanning themes folder:", err);
			return [];
		}
	}
}

// ── CSS metadata parsers ──────────────────────────────────────────────────────

/**
 * Extracts a display name from a typeset-name comment.
 *
 * Format (must appear within the first 500 characters):
 *   /* typeset-name: D&D Homebrew *\/
 *
 * Returns null if no valid comment is found.
 */
function parseCssName(css: string): string | null {
	const match = css.slice(0, 500).match(/\/\*\s*typeset-name:\s*([^*\n]+?)\s*\*\//);
	return match ? match[1].trim() : null;
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

// ── Utilities ─────────────────────────────────────────────────────────────────

function filenameToTitle(filename: string): string {
	return toTitleCase(filename.replace(/\.css$/, "").replace(/[-_]/g, " "));
}

function toTitleCase(str: string): string {
	return str.replace(/\b\w/g, c => c.toUpperCase());
}
