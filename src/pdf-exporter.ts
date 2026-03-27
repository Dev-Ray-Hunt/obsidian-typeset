// pdf-exporter.ts — Core PDF export pipeline

import { App, Component, MarkdownRenderer, Notice, Platform, TFile } from "obsidian";
import { PageOrientation, PageSize, TypesetSettings } from "./types";
import { applyCalloutClasses, parseBlockClasses } from "./block-class-parser";
import { CssManager } from "./css-manager";
import { writeFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Page size lookup
//
// For standard sizes we use Electron's built-in string names — safer than
// passing raw micron dimensions, which vary in interpretation across Electron
// versions. Custom sizes still use microns (the only option for arbitrary dims).
// ---------------------------------------------------------------------------
const PAGE_SIZE_STRINGS: Record<Exclude<PageSize, PageSize.Custom>, string> = {
	[PageSize.A4]:     "A4",
	[PageSize.Letter]: "Letter",
	[PageSize.Legal]:  "Legal",
	[PageSize.A5]:     "A5",
};

// Used only for Custom page size — Electron needs microns for arbitrary dims.
// (1 mm = 1000 µm, 1 inch = 25400 µm)
function toMicronsForCustom(value: number, unit: "mm" | "in" | "px"): number {
	if (unit === "mm") return Math.round(value * 1000);
	if (unit === "in") return Math.round(value * 25400);
	return Math.round(value * 264.583); // 96 dpi px → µm
}

// ---------------------------------------------------------------------------
// PdfExporter
// ---------------------------------------------------------------------------
export class PdfExporter {
	private cssManager: CssManager;

	constructor(private app: App, private settings: TypesetSettings) {
		this.cssManager = new CssManager(app);
	}

	async export(file: TFile): Promise<void> {
		if (!Platform.isDesktop) {
			new Notice("PDF export requires Obsidian Desktop.");
			return;
		}

		// ------------------------------------------------------------------
		// Step 1: Render Markdown → HTML via Obsidian's built-in renderer
		// ------------------------------------------------------------------
		const markdown = await this.app.vault.read(file);
		const container = document.createElement("div");
		const component = new Component();
		component.load();

		await MarkdownRenderer.render(
			this.app,
			markdown,
			container,
			file.path,
			component,
		);

		component.unload();
		const rawHtml = container.innerHTML;

		// Run the parser pipeline: callout classes first, then block annotations
		const bodyHtml = parseBlockClasses(applyCalloutClasses(rawHtml));
		console.log("[Typeset] Rendered HTML:", bodyHtml);

		// ------------------------------------------------------------------
		// Step 2: Resolve themes and effective layout.
		//
		// CSS cascade (lowest → highest priority):
		//   1. Default theme     (settings.activeTheme)
		//   2. Settings choices  (@page margins from settings UI)
		//   3. Assigned theme    (typeset-theme frontmatter, if different)
		//
		// Layout cascade (same order — each level overrides the previous):
		//   settings.defaultLayout → default theme layoutOverrides
		//                          → assigned theme layoutOverrides
		// ------------------------------------------------------------------
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const assignedThemeName = frontmatter?.["typeset-theme"] as string | undefined;
		const defaultThemeName  = this.settings.activeTheme;

		const themes = await this.cssManager.getAvailableThemes();
		const defaultTheme  = themes.find(t => t.filename === defaultThemeName) ?? themes[0];
		// Only treat as an override when it's a different theme from the default.
		const assignedTheme = assignedThemeName && assignedThemeName !== defaultThemeName
			? (themes.find(t => t.filename === assignedThemeName) ?? null)
			: null;

		// Merge layout: settings → default theme hints → assigned theme hints.
		const effectiveLayout = mergeLayout(
			this.settings.defaultLayout,
			defaultTheme.layoutOverrides,
			assignedTheme?.layoutOverrides,
		);

		console.log(
			`[Typeset] Effective layout: size=${effectiveLayout.size}, ` +
			`orientation=${effectiveLayout.orientation}, ` +
			`margins=${JSON.stringify(effectiveLayout.margins)}, ` +
			`defaultTheme="${defaultTheme.name}"` +
			(assignedTheme ? `, assignedTheme="${assignedTheme.name}"` : ""),
		);

		// ------------------------------------------------------------------
		// Step 3: Resolve page dimensions and margin CSS from effective layout
		// ------------------------------------------------------------------
		const { margins } = effectiveLayout;
		const u = margins.unit;
		const marginCss =
			`${margins.top}${u} ${margins.right}${u} ${margins.bottom}${u} ${margins.left}${u}`;

		const landscape = effectiveLayout.orientation === PageOrientation.Landscape;

		// Resolve pageSize to either a string ('A4', 'Letter', …) or a micron
		// object for custom dimensions. Electron handles landscape separately.
		let pageSize: string | { width: number; height: number };

		if (
			effectiveLayout.size === PageSize.Custom &&
			effectiveLayout.customWidth &&
			effectiveLayout.customHeight
		) {
			const w = toMicronsForCustom(effectiveLayout.customWidth,  u);
			const h = toMicronsForCustom(effectiveLayout.customHeight, u);
			pageSize = landscape ? { width: h, height: w } : { width: w, height: h };
		} else {
			pageSize = PAGE_SIZE_STRINGS[effectiveLayout.size as Exclude<PageSize, PageSize.Custom>]
				?? "A4";
		}

		// ------------------------------------------------------------------
		// Step 4: Load and inject theme CSS.
		//
		// Injection order matches the cascade (later = higher priority):
		//   1. typeset-base-theme-style   — default theme (broad base)
		//   2. typeset-print-style        — @page margins + isolation (settings)
		//   3. typeset-override-theme-style — assigned theme (most specific)
		//
		// `body` selectors are remapped to `#typeset-print-root` so theme rules
		// apply to our content div rather than Obsidian's actual <body>.
		// ------------------------------------------------------------------
		const rawBaseCss = await this.cssManager.loadThemeCss(defaultTheme);
		const baseCss    = rawBaseCss.replace(/\bbody\b/g, "#typeset-print-root");

		const themeStyle = document.createElement("style");
		themeStyle.id = "typeset-base-theme-style";
		themeStyle.textContent = baseCss;

		// ------------------------------------------------------------------
		// Step 5: Print isolation styles — hide Obsidian's UI and expose only
		// our print root. These take precedence over the theme via @media print.
		// ------------------------------------------------------------------
		const printStyle = document.createElement("style");
		printStyle.id = "typeset-print-style";
		printStyle.textContent = `
			@page { margin: ${marginCss}; }
			@media print {
				html, body {
					overflow: visible !important;
					height: auto !important;
					min-height: 0 !important;
					width: 100% !important;
					margin: 0 !important;
					padding: 0 !important;
				}
				body > *:not(#typeset-print-root) {
					display: none !important;
					visibility: hidden !important;
				}
				#typeset-print-root {
					display: block !important;
					visibility: visible !important;
					width: 100% !important;
					max-width: none !important;
					margin: 0 !important;
					padding: 0 !important;
				}
				.copy-code-button { display: none !important; }
			}
		`;

		const printRoot = document.createElement("div");
		printRoot.id = "typeset-print-root";
		printRoot.innerHTML = bodyHtml;

		// Cascade order: base theme → settings → assigned theme override
		document.head.appendChild(themeStyle);
		document.head.appendChild(printStyle);

		// Assigned theme (if different from default) injected last — highest priority.
		if (assignedTheme) {
			const rawOverrideCss = await this.cssManager.loadThemeCss(assignedTheme);
			const overrideCss    = rawOverrideCss.replace(/\bbody\b/g, "#typeset-print-root");
			const overrideStyle  = document.createElement("style");
			overrideStyle.id     = "typeset-override-theme-style";
			overrideStyle.textContent = overrideCss;
			document.head.appendChild(overrideStyle);
		}

		document.body.appendChild(printRoot);

		// Directly hide Obsidian's app container so its flex layout cannot
		// affect how our print root is positioned during capture.
		const appContainer = document.querySelector<HTMLElement>(".app-container");
		if (appContainer) appContainer.style.display = "none";

		try {
			// ------------------------------------------------------------------
			// Step 4: Call printToPDF on the current Obsidian window.
			// We access Electron via require() — no new window needed.
			// ------------------------------------------------------------------
			// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
			const electron = (require as any)("electron");
			// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
			const remote = electron.remote ?? (require as any)("@electron/remote");
			const currentWin = remote.getCurrentWindow();

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const pdfBuffer: Buffer = await currentWin.webContents.printToPDF({
				pageSize,
				landscape,
				marginsType: 0,       // honour CSS @page margins
				printBackground: true,
			});
			console.log(`Typeset: PDF buffer size = ${pdfBuffer.length} bytes`);

			// ------------------------------------------------------------------
			// Step 5: Write PDF to vault
			// ------------------------------------------------------------------
			const pdfName    = `${file.basename}.pdf`;
			const folder     = this.settings.outputFolder.trim();
			const outputPath = folder ? `${folder}/${pdfName}` : pdfName;

			if (folder && !(await this.app.vault.adapter.exists(folder))) {
				await this.app.vault.createFolder(folder);
			}

			// Write the raw Node Buffer directly via fs — bypasses the
			// Buffer→ArrayBuffer conversion that was corrupting the file.
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const vaultPath = (this.app.vault.adapter as any).basePath as string;
			writeFileSync(join(vaultPath, outputPath), pdfBuffer);

			new Notice(`PDF saved to: ${outputPath}`, 5000);
			console.log(`Typeset: PDF exported to "${outputPath}"`);

		} catch (err) {
			new Notice("Export failed — check the developer console for details.", 0);
			console.error("[Obsidian Typeset] Export failed:", err);
		} finally {
			// Always restore Obsidian's UI and remove injected elements
			if (appContainer) appContainer.style.display = "";
			document.getElementById("typeset-base-theme-style")?.remove();
			document.getElementById("typeset-override-theme-style")?.remove();
			document.getElementById("typeset-print-style")?.remove();
			document.getElementById("typeset-print-root")?.remove();
		}
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

import type { PageLayout } from "./types";

/**
 * Merges a base PageLayout with zero or more partial override layers.
 * Layers are applied left-to-right; later layers win.
 * `margins` is merged explicitly (it's a nested object).
 */
function mergeLayout(
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
