// pdf-exporter.ts — Core PDF export pipeline

import { App, Notice, Platform, TFile } from "obsidian";
import { PageOrientation, PageSize, TypesetSettings } from "./types";
import { CssManager } from "./css-manager";
import {
	buildPdfHtml,
	captureObsidianCss,
	mergeLayout,
	renderMarkdownToHtml,
	resolveThemes,
} from "./document-builder";
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
		// Step 1: Render Markdown → HTML via shared pipeline
		// ------------------------------------------------------------------
		const markdown = await this.app.vault.read(file);
		const bodyHtml = await renderMarkdownToHtml(this.app, markdown, file.path);
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
		const { defaultTheme, assignedTheme } = await resolveThemes(
			this.app, file, this.settings, this.cssManager,
		);

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
		// Step 3: Load theme CSS and build self-contained HTML document.
		//
		// Theme CSS `body` selectors work naturally in the isolated
		// BrowserWindow — no regex remapping needed.
		// ------------------------------------------------------------------
		let themeCss = await this.cssManager.loadThemeCss(defaultTheme);
		if (assignedTheme) {
			themeCss += "\n" + await this.cssManager.loadThemeCss(assignedTheme);
		}

		const html = buildPdfHtml({
			layout: effectiveLayout,
			obsidianCss: captureObsidianCss(),
			themeCss,
			bodyHtml,
		});

		// ------------------------------------------------------------------
		// Step 4: Render PDF in an isolated BrowserWindow.
		//
		// This avoids mutating Obsidian's live DOM entirely — no hiding
		// .app-container, no injecting styles, no cleanup needed.
		// ------------------------------------------------------------------
		// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
		const electron = (require as any)("electron");
		// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
		const remote = electron.remote ?? (require as any)("@electron/remote");
		const { BrowserWindow } = remote;

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const win = new BrowserWindow({
			show: false,
			width: 800,
			height: 600,
			webPreferences: { javascript: true },
		});

		try {
			// Load HTML via a data URI. encodeURIComponent handles all special
			// characters and avoids the escaping pitfalls of document.write().
			await win.loadURL(
				`data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
			);

			// Resolve Electron page size for printToPDF options.
			const { margins } = effectiveLayout;
			const u = margins.unit;
			const landscape = effectiveLayout.orientation === PageOrientation.Landscape;

			let pageSize: string | { width: number; height: number };
			if (
				effectiveLayout.size === PageSize.Custom &&
				effectiveLayout.customWidth &&
				effectiveLayout.customHeight
			) {
				const w = toMicronsForCustom(effectiveLayout.customWidth, u);
				const h = toMicronsForCustom(effectiveLayout.customHeight, u);
				pageSize = landscape ? { width: h, height: w } : { width: w, height: h };
			} else {
				pageSize = PAGE_SIZE_STRINGS[effectiveLayout.size as Exclude<PageSize, PageSize.Custom>]
					?? "A4";
			}

			const pdfBuffer: Buffer = await win.webContents.printToPDF({
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

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const vaultPath = (this.app.vault.adapter as any).basePath as string;
			writeFileSync(join(vaultPath, outputPath), pdfBuffer);

			new Notice(`PDF saved to: ${outputPath}`, 5000);
			console.log(`Typeset: PDF exported to "${outputPath}"`);

		} catch (err) {
			new Notice("Export failed — check the developer console for details.", 0);
			console.error("[Obsidian Typeset] Export failed:", err);
		} finally {
			win.close();
		}
	}
}

