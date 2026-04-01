// document-builder.ts — Shared rendering logic for preview and PDF export
//
// Extracted in Issue #74 (Phase A) to eliminate duplication between
// preview-view.ts and pdf-exporter.ts. Both consumers now import these
// helpers instead of maintaining their own copies.

import { App, Component, MarkdownRenderer, TFile } from "obsidian";
import { applyCalloutClasses, parseBlockClasses } from "./block-class-parser";
import { CssManager } from "./css-manager";
import type { PageLayout, ThemeInfo, TypesetSettings } from "./types";

// ---------------------------------------------------------------------------
// Theme resolution
// ---------------------------------------------------------------------------

export interface ResolvedThemes {
	defaultTheme: ThemeInfo;
	assignedTheme: ThemeInfo | null;
}

/**
 * Determines which themes apply to a given file.
 *
 * - `defaultTheme` comes from `settings.activeTheme` (falls back to first
 *   available theme if the configured one isn't found).
 * - `assignedTheme` is the per-file override set via `typeset-theme`
 *   frontmatter. It is `null` when no override is set or when it matches
 *   the default (no point loading the same theme twice).
 */
export async function resolveThemes(
	app: App,
	file: TFile,
	settings: TypesetSettings,
	cssManager: CssManager,
): Promise<ResolvedThemes> {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	const assignedThemeName = frontmatter?.["typeset-theme"] as string | undefined;
	const defaultThemeName = settings.activeTheme;

	const themes = await cssManager.getAvailableThemes();
	const defaultTheme = themes.find(t => t.filename === defaultThemeName) ?? themes[0];

	const assignedTheme =
		assignedThemeName && assignedThemeName !== defaultThemeName
			? (themes.find(t => t.filename === assignedThemeName) ?? null)
			: null;

	return { defaultTheme, assignedTheme };
}

// ---------------------------------------------------------------------------
// Layout merging
// ---------------------------------------------------------------------------

/**
 * Merges a base PageLayout with zero or more partial override layers.
 * Layers are applied left-to-right; later layers win.
 * `margins` is merged explicitly (it's a nested object).
 */
export function mergeLayout(
	base: PageLayout,
	...overrides: (Partial<PageLayout> | undefined)[]
): PageLayout {
	let result = { ...base };
	for (const override of overrides) {
		if (!override) continue;
		result = {
			...result,
			...override,
			margins: override.margins ?? result.margins,
		};
	}
	return result;
}

// ---------------------------------------------------------------------------
// Markdown → HTML pipeline
// ---------------------------------------------------------------------------

/**
 * Renders markdown to processed HTML using Obsidian's built-in renderer,
 * then applies the callout-class and block-class annotation pipeline.
 *
 * Callers are responsible for reading the markdown content (vault.read vs
 * vault.cachedRead) and for any off-screen rendering delays they need.
 * This function handles the core render + parse steps.
 */
export async function renderMarkdownToHtml(
	app: App,
	markdown: string,
	filePath: string,
): Promise<string> {
	const container = document.createElement("div");
	const component = new Component();
	component.load();

	await MarkdownRenderer.render(app, markdown, container, filePath, component);

	component.unload();
	return parseBlockClasses(applyCalloutClasses(container.innerHTML));
}

// ---------------------------------------------------------------------------
// Unit conversion
// ---------------------------------------------------------------------------

/** Converts a value in the given unit to CSS pixels at 96 dpi. */
export function toPx(value: number, unit: "mm" | "in" | "px"): number {
	if (unit === "mm") return Math.round((value * 96) / 25.4);
	if (unit === "in") return Math.round(value * 96);
	return Math.round(value);
}
