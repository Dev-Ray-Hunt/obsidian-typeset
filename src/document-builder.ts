// document-builder.ts — Shared rendering logic for preview and PDF export
//
// Extracted in Issue #74 (Phase A) to eliminate duplication between
// preview-view.ts and pdf-exporter.ts. Both consumers now import these
// helpers instead of maintaining their own copies.

import { App, Component, MarkdownRenderer, TFile } from "obsidian";
import { applyCalloutClasses, parseBlockClasses } from "./block-class-parser";
import { CssManager } from "./css-manager";
import { PageOrientation, PageSize } from "./types";
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

// ---------------------------------------------------------------------------
// Obsidian CSS capture
// ---------------------------------------------------------------------------

let cachedObsidianCss: string | null = null;

/**
 * Captures all <style> elements from Obsidian's main document.head.
 * The result is cached for the lifetime of the plugin — Obsidian's styles
 * don't change at runtime. Both preview-view and pdf-exporter use this
 * to replicate Obsidian's visual environment in isolated contexts.
 */
export function captureObsidianCss(): string {
	if (cachedObsidianCss === null) {
		cachedObsidianCss = Array.from(
			document.querySelectorAll<HTMLStyleElement>("style"),
		)
			.map(s => s.textContent ?? "")
			.join("\n");
	}
	return cachedObsidianCss;
}

// ---------------------------------------------------------------------------
// PDF document builder
// ---------------------------------------------------------------------------

/** @page size CSS value for standard page sizes. */
const PAGE_SIZE_CSS: Record<Exclude<PageSize, PageSize.Custom>, string> = {
	[PageSize.A4]:     "A4",
	[PageSize.Letter]: "Letter",
	[PageSize.Legal]:  "Legal",
	[PageSize.A5]:     "A5",
};

export interface PdfHtmlOptions {
	layout: PageLayout;
	obsidianCss: string;
	themeCss: string;
	bodyHtml: string;
}

/**
 * Builds a complete, self-contained HTML document for PDF rendering in
 * an isolated BrowserWindow. Includes:
 *   1. Obsidian's base CSS (callout icons, code highlighting, variables)
 *   2. Theme CSS (fonts, sizes, colors)
 *   3. @page rules for page geometry (size, orientation, margins)
 *
 * Because <body> IS the root element in the BrowserWindow, theme CSS
 * `body` selectors work naturally — no remapping needed.
 */
export function buildPdfHtml(options: PdfHtmlOptions): string {
	const { layout, obsidianCss, themeCss, bodyHtml } = options;
	const { margins } = layout;
	const u = margins.unit;
	const marginCss =
		`${margins.top}${u} ${margins.right}${u} ${margins.bottom}${u} ${margins.left}${u}`;
	const landscape = layout.orientation === PageOrientation.Landscape;

	// Resolve @page size value
	let pageSizeCss: string;
	if (
		layout.size === PageSize.Custom &&
		layout.customWidth &&
		layout.customHeight
	) {
		const w = `${layout.customWidth}${u}`;
		const h = `${layout.customHeight}${u}`;
		pageSizeCss = landscape ? `${h} ${w}` : `${w} ${h}`;
	} else {
		const name = PAGE_SIZE_CSS[layout.size as Exclude<PageSize, PageSize.Custom>] ?? "A4";
		pageSizeCss = `${name} ${landscape ? "landscape" : "portrait"}`;
	}

	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
/* Declare layer order — later layers always win regardless of specificity */
@layer obsidian, theme, layout;

/* ══════════════════════════════════════════════════════════════════════════
   LAYER 1 — Obsidian's base CSS
   ══════════════════════════════════════════════════════════════════════════ */
@layer obsidian {
${obsidianCss}
}

/* ══════════════════════════════════════════════════════════════════════════
   LAYER 2 — Typeset theme CSS
   ══════════════════════════════════════════════════════════════════════════ */
@layer theme {
${themeCss}
}

/* ══════════════════════════════════════════════════════════════════════════
   LAYER 3 — PDF page geometry and resets
   ══════════════════════════════════════════════════════════════════════════ */
@layer layout {
@page {
  size: ${pageSizeCss};
  margin: ${marginCss};
}
html, body {
  margin: 0;
  padding: 0;
  background: white;
}

/* ── Content baseline — match preview output ───────────────────────────── */

/* Tables — reset browser default borders, keep theme's own styling */
table { border-collapse: collapse; }
th, td { border: none; }
td { border-bottom: 1px solid var(--background-modifier-border, #ddd); }

/* Callouts — hide icon and fold, color the title */
.callout-icon { display: none; }
.callout-title { color: rgb(var(--callout-color, 0, 0, 0)); }
.callout-fold { display: none; }
.callout-content > p:first-child { margin-top: 0; }
.callout-content > p:last-child { margin-bottom: 0; }

/* ── Page break hints ──────────────────────────────────────────────────── */
/* Prevent Chromium from splitting callouts, tables, and code blocks */
.callout, table, pre, blockquote { break-inside: avoid; }
/* Keep headings attached to the content that follows them */
h1, h2, h3, h4, h5, h6 { break-after: avoid; }

.copy-code-button { display: none; }
}
</style>
</head>
<body class="markdown-rendered">
${bodyHtml}
</body>
</html>`;
}
