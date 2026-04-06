// preview-view.ts — Split-pane print preview Obsidian View
// M4 rework: iframe + srcdoc with live updates (Issues #39, #40, #42, #43)

import { Component, ItemView, MarkdownRenderer, MarkdownView, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { VIEW_TYPE_CSS_EDITOR } from "./css-editor-view";
import { ThemePickerModal } from "./theme-picker-modal";
import { applyCalloutClasses, parseBlockClasses } from "./block-class-parser";
import { PageLayout, PageOrientation, PageSize } from "./types";
import { captureObsidianCss, mergeLayout, resolveThemes, toPx } from "./document-builder";
import type TypesetPlugin from "./main";

export const VIEW_TYPE_PREVIEW = "typeset-preview";

// ---------------------------------------------------------------------------
// Page dimensions in CSS pixels at 96dpi (portrait orientation)
// ---------------------------------------------------------------------------
const PAGE_WIDTH_PX: Record<Exclude<PageSize, PageSize.Custom>, number> = {
	[PageSize.A4]:     794,  // 210mm
	[PageSize.Letter]: 816,  // 8.5in
	[PageSize.Legal]:  816,  // 8.5in
	[PageSize.A5]:     559,  // 148mm
};

const PAGE_HEIGHT_PX: Record<Exclude<PageSize, PageSize.Custom>, number> = {
	[PageSize.A4]:     1123, // 297mm
	[PageSize.Letter]: 1056, // 11in
	[PageSize.Legal]:  1344, // 14in
	[PageSize.A5]:     794,  // 210mm
};

export class TypesetPreviewView extends ItemView {
	private plugin: TypesetPlugin;
	private currentFile: TFile | null = null;
	private lockedFile: TFile | null = null;
	private lockButtonEl: HTMLElement | null = null;
	private exportButtonEl: HTMLElement | null = null;
	private infoBarEl: HTMLElement | null = null;
	private currentThemeName = "";
	private iframeEl: HTMLIFrameElement | null = null;
	private debounceTimer: number | null = null;
	private zoomMode: "fit-width" | "fit-page" | "manual" = "fit-width";
	private manualZoom = 1; // 0.25–2.0
	private lastPageWidthPx = 0;
	private lastPageHeightPx = 0;

	// ── Render cache ──────────────────────────────────────────────────────────
	// Themes and CSS are re-loaded from disk only when the active theme changes,
	// not on every keystroke. This eliminates the main source of render lag.
	private cachedCss = "";
	private cachedCssKey = ""; // "<defaultTheme>|<assignedTheme>" — cache key

	constructor(leaf: WorkspaceLeaf, plugin: TypesetPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return VIEW_TYPE_PREVIEW; }
	getDisplayText(): string { return "Print Preview"; }
	getIcon(): string { return "lucide-layout-template"; }

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.addClass("typeset-preview-view");

		// ── Lock toggle button in pane header ─────────────────────────────────
		this.lockButtonEl = this.addAction(
			"lucide-lock-open",
			"Lock preview to this note",
			() => this.toggleLock(),
		);

		// ── CSS editor button in pane header ──────────────────────────────────
		this.addAction(
			"lucide-palette",
			"Open CSS editor",
			() => void this.openCssEditor(),
		);

		// ── Export PDF button in pane header ──────────────────────────────────
		this.exportButtonEl = this.addAction(
			"lucide-download",
			"Export PDF",
			() => void this.exportPdf(),
		);

		// ── Info bar — note name + theme name ────────────────────────────────────
		this.infoBarEl = contentEl.createDiv({ cls: "typeset-preview-info-bar" });
		this.infoBarEl.style.cssText =
			"display:flex;align-items:center;gap:12px;padding:4px 12px;" +
			"font-size:11px;color:var(--text-muted);border-bottom:1px solid var(--background-modifier-border);" +
			"background:var(--background-secondary);flex-shrink:0;";

		// Use flex on contentEl so info bar + iframe stack correctly.
		contentEl.style.cssText = "display:flex;flex-direction:column;height:100%;overflow:hidden;padding:0;";

		// The iframe fills remaining height and handles its own scrolling.
		this.iframeEl = contentEl.createEl("iframe", {
			attr: { frameborder: "0" },
		});
		this.iframeEl.style.cssText = "width:100%;flex:1;min-height:0;border:none;display:block;";

		// ── Live update: active note changes ───────────────────────────────────
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				if (this.lockedFile) return; // locked — ignore navigation
				const file = this.app.workspace.getActiveFile();
				// Only react to markdown files — ignore PDFs, images, etc.
				if (file instanceof TFile && file.extension === "md" && file !== this.currentFile) {
					void this.render(file);
				}
			}),
		);

		// ── Live update: in-editor typing (debounced 300ms) ──────────────────────
		// vault.on("modify") only fires when Obsidian flushes to disk (~1–3s delay).
		// editor-change fires on every keystroke, giving true live preview.
		this.registerEvent(
			this.app.workspace.on("editor-change", () => {
				// When locked, only update if the locked file is being edited.
				const watchFile = this.lockedFile ?? this.currentFile;
				const file = this.app.workspace.getActiveFile();
				if (!(file instanceof TFile) || file !== watchFile) return;
				if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
				this.debounceTimer = window.setTimeout(() => {
					this.debounceTimer = null;
					void this.render(file);
				}, 300);
			}),
		);



		// Initial render.
		// getActiveFile() returns null when the preview pane itself is the active
		// leaf (which it is immediately after opening). Fall back to finding any
		// open MarkdownView in the workspace.
		const activeFile = this.findMarkdownFile();
		if (activeFile instanceof TFile && activeFile.extension === "md") {
			await this.render(activeFile);
		} else {
			this.showPlaceholder();
		}
	}

	async onClose(): Promise<void> {
		if (this.debounceTimer !== null) {
			window.clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		this.iframeEl = null;
		this.infoBarEl = null;
		this.currentFile = null;
		this.lockedFile = null;
		this.lockButtonEl = null;
		this.exportButtonEl = null;
		this.contentEl.empty();
	}

	// ── Public API ────────────────────────────────────────────────────────────

	/** Force a full re-render (e.g. after settings change). */
	refresh(): void {
		const file = this.lockedFile ?? this.currentFile;
		if (!file) return;
		this.cachedCssKey = ""; // invalidate CSS cache
		void this.render(file);
	}

	/**
	 * Renders the given file through the full pipeline and updates the iframe.
	 * Called by onOpen() and by the live-update event listeners.
	 */
	async render(file: TFile): Promise<void> {
		if (!this.iframeEl) return;
		this.currentFile = file;

		// ── Step 1: Read markdown (from Obsidian's in-memory cache) ──────────────
		const markdown = await this.app.vault.cachedRead(file);

		// ── Step 2: Resolve themes and effective layout ───────────────────────
		const themes = await this.plugin.cssManager.getAvailableThemes();
		if (themes.length === 0) {
			console.error("[Typeset] render(): no themes found — check built-in/ folder in plugin directory");
			this.showPlaceholder("No themes found — check built-in/ folder");
			return;
		}

		const { defaultTheme, assignedTheme } = await resolveThemes(
			this.app, file, this.plugin.settings, this.plugin.cssManager,
		);

		// Update the info bar now that we have the file and theme names.
		const displayTheme = assignedTheme ?? defaultTheme;
		this.currentThemeName = displayTheme.name;
		this.updateInfoBar(file, this.currentThemeName);

		const effectiveLayout = mergeLayout(
			this.plugin.settings.defaultLayout,
			defaultTheme.layoutOverrides,
			assignedTheme?.layoutOverrides,
		);

		// ── Step 3: Compute page dimensions in CSS pixels ─────────────────────
		const landscape = effectiveLayout.orientation === PageOrientation.Landscape;
		let pageWidthPx: number;
		let pageHeightPx: number;

		if (
			effectiveLayout.size === PageSize.Custom &&
			effectiveLayout.customWidth &&
			effectiveLayout.customHeight
		) {
			const u = effectiveLayout.margins.unit;
			const w = toPx(effectiveLayout.customWidth, u);
			const h = toPx(effectiveLayout.customHeight, u);
			pageWidthPx  = landscape ? h : w;
			pageHeightPx = landscape ? w : h;
		} else {
			const size = effectiveLayout.size as Exclude<PageSize, PageSize.Custom>;
			pageWidthPx  = landscape ? PAGE_HEIGHT_PX[size] : PAGE_WIDTH_PX[size];
			pageHeightPx = landscape ? PAGE_WIDTH_PX[size]  : PAGE_HEIGHT_PX[size];
		}

		// ── Step 4: Margin pixel values + content area dimensions ────────────
		// These are the same values Electron uses for the PDF content area.
		// Using the full pageHeightPx as the break target was over-filling every
		// page by 2×margin, causing breaks to land too late and cut through content.
		const { margins } = effectiveLayout;
		const u = margins.unit;
		const topMarginPx    = toPx(margins.top,    u);
		const bottomMarginPx = toPx(margins.bottom, u);
		const leftMarginPx   = toPx(margins.left,   u);
		const rightMarginPx  = toPx(margins.right,  u);
		const contentAreaWidthPx  = pageWidthPx  - leftMarginPx - rightMarginPx;
		const contentAreaHeightPx = pageHeightPx - topMarginPx  - bottomMarginPx;
		const marginCss = `${topMarginPx}px ${rightMarginPx}px ${bottomMarginPx}px ${leftMarginPx}px`;

		// ── Step 5: Build CSS string (cached) ────────────────────────────────
		const cssKey = `${defaultTheme.filename}|${assignedTheme?.filename ?? ""}`;
		if (cssKey !== this.cachedCssKey) {
			const baseCss = await this.plugin.cssManager.loadThemeCss(defaultTheme);
			let themeCss = baseCss;
			if (assignedTheme) {
				themeCss += "\n" + await this.plugin.cssManager.loadThemeCss(assignedTheme);
			}
			this.cachedCss = themeCss;
			this.cachedCssKey = cssKey;
		}
		const themeCss = this.cachedCss;

		// ── Step 5: Render markdown → HTML using the same pipeline as PdfExporter ─
		// MarkdownRenderer requires the container to be in the live document tree
		// for async renderers (callouts, embeds, etc.) to fully paint. We render
		// off-screen, wait one frame + 50ms, then extract innerHTML.
		const tempContainer = document.body.createDiv({ cls: "typeset-temp-render" });
		tempContainer.style.cssText =
			"position:absolute;left:-9999px;top:0;" +
			`width:${pageWidthPx}px;visibility:hidden;pointer-events:none;`;

		const component = new Component();
		component.load();
		await MarkdownRenderer.render(this.app, markdown, tempContainer, file.path, component);

		await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
		await new Promise<void>(resolve => setTimeout(resolve, 50));

		// Use the same string-based transforms as PdfExporter — single source of truth.
		// applyCalloutClasses adds callout-<type> classes; parseBlockClasses handles {.class} annotations.
		const renderedHtml = parseBlockClasses(applyCalloutClasses(tempContainer.innerHTML));
		component.unload();
		tempContainer.remove();

		// ── Step 6: Build full self-contained document and set srcdoc ─────────
		// CSS is inlined inside the iframe — no scoping needed, no cascade
		// conflicts with Obsidian's own styles.
		const iframe = this.iframeEl;

		// Save scroll position before re-rendering so we can restore it.
		const prevScroll = iframe.contentDocument
			?.getElementById("typeset-scroll")?.scrollTop ?? 0;

		iframe.onload = () => {
			const doc = iframe.contentDocument;
			if (!doc) return;

			const measure      = doc.getElementById("typeset-measure");
			const pagesContainer = doc.getElementById("typeset-pages");
			const scrollEl     = doc.getElementById("typeset-scroll");
			if (!measure || !pagesContainer || !scrollEl) return;

			// ── Detect theme columns ─────────────────────────────────────────
			const colCountMatch = themeCss.match(/column-count\s*:\s*(\d+)/);
			const colGapMatch   = themeCss.match(/column-gap\s*:\s*([\d.]+\w+)/);
			const themeColCount = colCountMatch ? parseInt(colCountMatch[1], 10) : 1;
			const themeColGap   = colGapMatch   ? colGapMatch[1] : "20pt";
			const isColumned    = themeColCount >= 2;

			if (isColumned) {
				// ── Columned pagination: overflow detection ───────────────────
				// The browser's native column engine handles column layout.
				// We create an off-screen measurement container matching one
				// page's content area (with balanced columns, no height
				// constraint) and append elements one by one.  When the
				// balanced column height exceeds the page's content area,
				// we know the page is full and start a new one.
				const elements = Array.from(measure.children) as HTMLElement[];
				const pages: HTMLElement[][] = [];
				let currentPage: HTMLElement[] = [];

				// ── Normalization pre-pass ────────────────────────────
				// Convert ALL break directives into a single breakBefore
				// flag per element. This means:
				//   1. Elements with CSS break-before (e.g. stat-block-wide)
				//      or .break-before class → breakBefore = true
				//   2. Elements with .page-break (break-after) → the NEXT
				//      element gets breakBefore = true
				// After this, the main loop only ever checks breakBefore.
				const breakBefore = new Set<number>();

				for (let idx = 0; idx < elements.length; idx++) {
					const el = elements[idx];
					if (!el.classList) continue;

					// Direct break-before: element wants a new page before it
					if (el.classList.contains("break-before") ||
						el.classList.contains("callout-stat-block-wide")) {
						breakBefore.add(idx);
					}

					// Break-after (.page-break): normalize to break-before
					// on the NEXT element
					if (el.classList.contains("page-break") && idx + 1 < elements.length) {
						breakBefore.add(idx + 1);
					}
				}

				const createMC = (): HTMLDivElement => {
					const mc = doc.createElement("div");
					mc.className = "markdown-rendered";
					mc.style.cssText =
						`position:absolute;left:-9999px;visibility:hidden;` +
						`width:${contentAreaWidthPx}px;` +
						`column-count:${themeColCount};column-gap:${themeColGap};` +
						`column-fill:balance;`;
					scrollEl.appendChild(mc);
					return mc;
				};

				let mc = createMC();

				for (let idx = 0; idx < elements.length; idx++) {
					const el = elements[idx];

					// ── Forced page break ────────────────────────────
					// If this element has breakBefore and the current page
					// isn't empty, finalize the current page first.
					if (breakBefore.has(idx) && currentPage.length > 0) {
						pages.push([...currentPage]);
						mc.remove();
						mc = createMC();
						currentPage = [];
					}

					const clone = el.cloneNode(true) as HTMLElement;
					mc.appendChild(clone);

					if (mc.scrollHeight > contentAreaHeightPx) {
						// This element pushed us past the page boundary.
						mc.removeChild(clone);

						// Heading sticking: if the last element on the current
						// page is a heading, pull it to the next page so it
						// stays with the content that follows it.
						if (
							currentPage.length > 0 &&
							/^H[1-6]$/.test(currentPage[currentPage.length - 1].tagName)
						) {
							const heading = currentPage.pop()!;
							if (mc.lastChild) mc.removeChild(mc.lastChild);
							pages.push([...currentPage]);
							mc.remove();
							mc = createMC();
							currentPage = [heading, el];
							mc.appendChild(heading.cloneNode(true));
							mc.appendChild(el.cloneNode(true));
						} else {
							pages.push([...currentPage]);
							mc.remove();
							mc = createMC();
							currentPage = [el];
							mc.appendChild(el.cloneNode(true));
						}
					} else {
						currentPage.push(el);
					}
				}

				// Last page
				if (currentPage.length > 0) pages.push(currentPage);
				mc.remove();

				// ── Build columned page boxes ────────────────────────────────
				for (let i = 0; i < pages.length; i++) {
					const pageBox = doc.createElement("div");
					pageBox.className = "typeset-page-box";

					const label = doc.createElement("div");
					label.className = "typeset-page-label";
					label.textContent = `${i + 1}`;
					pageBox.appendChild(label);

					const content = doc.createElement("div");
					content.className = "typeset-page-content markdown-rendered";
					content.style.cssText =
						`position:static;` +
						`column-count:${themeColCount};column-gap:${themeColGap};column-fill:auto;` +
						`padding:${marginCss};box-sizing:border-box;` +
						`width:${pageWidthPx}px;height:${pageHeightPx}px;overflow:hidden;`;

					for (const el of pages[i]) {
						content.appendChild(el.cloneNode(true));
					}

					pageBox.appendChild(content);
					pagesContainer.appendChild(pageBox);
				}
			} else {
				// ── Non-columned pagination: clip-based approach ──────────────
				const totalHeight = measure.scrollHeight;
				const measureTop  = measure.getBoundingClientRect().top;

				// Collect forced page-break positions from .page-break elements
				const forceBreaks: number[] = Array.from(
					measure.querySelectorAll(".page-break"),
				).map(el => el.getBoundingClientRect().bottom - measureTop);

				type Block = { top: number; bottom: number; avoidBreakInside: boolean; avoidBreakAfter: boolean };
				const blocks: Block[] = Array.from(
					measure.querySelectorAll("p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre, table, .callout, hr, img"),
				).map(el => {
					const r = el.getBoundingClientRect();
					const isHeading  = /^H[1-6]$/.test(el.tagName);
					const isAvoidInside = el.classList.contains("callout")
						|| el.tagName === "TABLE"
						|| el.tagName === "PRE"
						|| el.tagName === "BLOCKQUOTE";
					return {
						top:              r.top    - measureTop,
						bottom:           r.bottom - measureTop,
						avoidBreakInside: isAvoidInside,
						avoidBreakAfter:  isHeading,
					};
				}).sort((a, b) => a.top - b.top);

				function smartBreak(prevBreak: number, target: number): number {
					let bestBreak        = prevBreak;
					let beforeHeadingPos = prevBreak;
					let pendingHeading   = false;

					for (const b of blocks) {
						if (b.top <= prevBreak) continue;
						if (b.top >= target)   break;

						if (b.bottom <= target) {
							if (b.avoidBreakAfter) {
								if (!pendingHeading) beforeHeadingPos = bestBreak;
								pendingHeading = true;
							} else {
								bestBreak     = b.bottom;
								pendingHeading = false;
							}
						} else {
							if (pendingHeading) {
								bestBreak = beforeHeadingPos;
							} else {
								bestBreak = b.top > prevBreak ? b.top : prevBreak;
							}
							break;
						}
					}

					return bestBreak > prevBreak ? bestBreak : target;
				}

				const pageStarts: number[] = [0];
				let prev = 0;
				while (prev < totalHeight) {
					// Check for forced page breaks before the natural target
					const target = prev + contentAreaHeightPx;
					const forcedBreak = forceBreaks.find(fb => fb > prev && fb <= target);
					if (forcedBreak !== undefined) {
						pageStarts.push(forcedBreak);
						prev = forcedBreak;
						continue;
					}
					if (target >= totalHeight) break;
					const next = smartBreak(prev, target);
					pageStarts.push(next);
					prev = next;
				}

				const contentHtml = measure.innerHTML;

				for (let i = 0; i < pageStarts.length; i++) {
					const pageBox = doc.createElement("div");
					pageBox.className = "typeset-page-box";

					const label = doc.createElement("div");
					label.className = "typeset-page-label";
					label.textContent = `${i + 1}`;
					pageBox.appendChild(label);

					const nextStart      = i + 1 < pageStarts.length ? pageStarts[i + 1] : totalHeight;
					const contentHeight  = nextStart - pageStarts[i];

					const clip = doc.createElement("div");
					const clipMargin = i === 0 ? 0 : topMarginPx;
					clip.style.cssText = `height:${contentHeight}px;overflow:hidden;position:relative;margin-top:${clipMargin}px;`;

					const content = doc.createElement("div");
					content.className = "typeset-page-content markdown-rendered";
					if (i > 0) {
						content.style.top = `${-pageStarts[i] + topMarginPx}px`;
						content.style.setProperty("padding-top", "0px", "important");
					} else {
						content.style.top = `${-pageStarts[i]}px`;
					}
					content.innerHTML = contentHtml;

					clip.appendChild(content);
					pageBox.appendChild(clip);
					pagesContainer.appendChild(pageBox);
				}
			}

			measure.remove();

			// ── Apply zoom ────────────────────────────────────────────────────
			this.lastPageWidthPx = pageWidthPx;
			this.lastPageHeightPx = pageHeightPx;
			this.applyZoom();

			// Restore scroll position after re-render.
			if (prevScroll > 0) scrollEl.scrollTop = prevScroll;
		};

		iframe.srcdoc = buildDocument(pageWidthPx, pageHeightPx, marginCss, captureObsidianCss(), themeCss, renderedHtml);
	}

	// ── Private helpers ───────────────────────────────────────────────────────

	private applyZoom(): void {
		const doc = this.iframeEl?.contentDocument;
		if (!doc) return;
		const scrollEl = doc.getElementById("typeset-scroll");
		const pagesContainer = doc.getElementById("typeset-pages");
		if (!scrollEl || !pagesContainer) return;

		let scale: number;
		if (this.zoomMode === "fit-width") {
			const available = scrollEl.clientWidth - 16; // 8px padding each side
			scale = Math.min(1, available / this.lastPageWidthPx);
		} else if (this.zoomMode === "fit-page") {
			const availW = scrollEl.clientWidth - 16;
			const availH = scrollEl.clientHeight - 16;
			const scaleW = availW / this.lastPageWidthPx;
			const scaleH = availH / this.lastPageHeightPx;
			scale = Math.min(1, scaleW, scaleH);
		} else {
			scale = this.manualZoom;
		}

		pagesContainer.style.zoom = String(scale);
	}

	private setZoomMode(mode: "fit-width" | "fit-page" | "manual", manualValue?: number): void {
		this.zoomMode = mode;
		if (manualValue !== undefined) this.manualZoom = manualValue;
		this.applyZoom();
		// Update the zoom label in the info bar
		const label = this.infoBarEl?.querySelector(".typeset-zoom-label");
		if (label) label.textContent = this.getZoomLabel();
	}

	private getZoomLabel(): string {
		if (this.zoomMode === "fit-width") return "Fit Width";
		if (this.zoomMode === "fit-page") return "Fit Page";
		return `${Math.round(this.manualZoom * 100)}%`;
	}

	private updateInfoBar(file: TFile, themeName: string): void {
		if (!this.infoBarEl) return;
		this.infoBarEl.empty();

		const chipCss =
			"display:flex;align-items:center;gap:4px;cursor:pointer;" +
			"padding:2px 6px;border-radius:4px;transition:background 0.1s;" +
			"color:var(--text-muted);";

		// Note chip — click opens the note in the editor
		const noteChip = this.infoBarEl.createSpan();
		noteChip.style.cssText = chipCss;
		noteChip.setAttribute("aria-label", "Open note in editor");
		const noteIcon = noteChip.createSpan();
		setIcon(noteIcon, this.lockedFile ? "lucide-lock" : "lucide-file-text");
		noteIcon.style.cssText = "display:flex;align-items:center;width:12px;height:12px;";
		noteChip.createSpan({ text: file.basename });
		noteChip.addEventListener("mouseenter", () => noteChip.style.background = "var(--background-modifier-hover)");
		noteChip.addEventListener("mouseleave", () => noteChip.style.background = "");
		noteChip.addEventListener("click", () => void this.openNoteInEditor(file));

		// Separator
		this.infoBarEl.createSpan({ text: "·", attr: { style: "opacity:0.4;" } });

		// Theme chip — click opens the theme picker modal
		const themeChip = this.infoBarEl.createSpan();
		themeChip.style.cssText = chipCss;
		themeChip.setAttribute("aria-label", "Change theme");
		const themeIcon = themeChip.createSpan();
		setIcon(themeIcon, "lucide-palette");
		themeIcon.style.cssText = "display:flex;align-items:center;width:12px;height:12px;";
		themeChip.createSpan({ text: themeName });
		themeChip.addEventListener("mouseenter", () => themeChip.style.background = "var(--background-modifier-hover)");
		themeChip.addEventListener("mouseleave", () => themeChip.style.background = "");
		themeChip.addEventListener("click", () => this.openThemePicker());

		// Spacer pushes zoom controls to the right
		const spacer = this.infoBarEl.createSpan();
		spacer.style.cssText = "flex:1;";

		// Zoom out button
		const zoomOutBtn = this.infoBarEl.createSpan();
		zoomOutBtn.style.cssText = chipCss;
		zoomOutBtn.setAttribute("aria-label", "Zoom out");
		const zoomOutIcon = zoomOutBtn.createSpan();
		setIcon(zoomOutIcon, "lucide-minus");
		zoomOutIcon.style.cssText = "display:flex;align-items:center;width:12px;height:12px;";
		zoomOutBtn.addEventListener("mouseenter", () => zoomOutBtn.style.background = "var(--background-modifier-hover)");
		zoomOutBtn.addEventListener("mouseleave", () => zoomOutBtn.style.background = "");
		zoomOutBtn.addEventListener("click", () => {
			const newZoom = Math.max(0.25, (this.zoomMode === "manual" ? this.manualZoom : 1) - 0.1);
			this.setZoomMode("manual", Math.round(newZoom * 100) / 100);
		});

		// Zoom label — click cycles through modes
		const zoomLabel = this.infoBarEl.createSpan({ cls: "typeset-zoom-label" });
		zoomLabel.style.cssText = chipCss + "min-width:60px;justify-content:center;user-select:none;";
		zoomLabel.textContent = this.getZoomLabel();
		zoomLabel.setAttribute("aria-label", "Click to cycle: Fit Width → Fit Page → manual");
		zoomLabel.addEventListener("mouseenter", () => zoomLabel.style.background = "var(--background-modifier-hover)");
		zoomLabel.addEventListener("mouseleave", () => zoomLabel.style.background = "");
		zoomLabel.addEventListener("click", () => {
			if (this.zoomMode === "fit-width") {
				this.setZoomMode("fit-page");
			} else if (this.zoomMode === "fit-page") {
				this.setZoomMode("manual", 1);
			} else {
				this.setZoomMode("fit-width");
			}
		});

		// Zoom in button
		const zoomInBtn = this.infoBarEl.createSpan();
		zoomInBtn.style.cssText = chipCss;
		zoomInBtn.setAttribute("aria-label", "Zoom in");
		const zoomInIcon = zoomInBtn.createSpan();
		setIcon(zoomInIcon, "lucide-plus");
		zoomInIcon.style.cssText = "display:flex;align-items:center;width:12px;height:12px;";
		zoomInBtn.addEventListener("mouseenter", () => zoomInBtn.style.background = "var(--background-modifier-hover)");
		zoomInBtn.addEventListener("mouseleave", () => zoomInBtn.style.background = "");
		zoomInBtn.addEventListener("click", () => {
			const newZoom = Math.min(2, (this.zoomMode === "manual" ? this.manualZoom : 1) + 0.1);
			this.setZoomMode("manual", Math.round(newZoom * 100) / 100);
		});
	}

	private async exportPdf(): Promise<void> {
		const file = this.lockedFile ?? this.currentFile;
		if (!file || !this.exportButtonEl) return;

		// Show loading state.
		const btn = this.exportButtonEl;
		setIcon(btn, "lucide-loader-2");
		btn.addClass("is-loading");
		btn.setAttribute("aria-disabled", "true");

		try {
			const { PdfExporter } = await import("./pdf-exporter");
			const exporter = new PdfExporter(this.app, this.plugin.settings);
			await exporter.export(file);

			// Brief "saved" feedback.
			setIcon(btn, "lucide-check");
			setTimeout(() => {
				setIcon(btn, "lucide-download");
				btn.removeClass("is-loading");
				btn.removeAttribute("aria-disabled");
			}, 1500);
		} catch (err) {
			console.error("[Typeset] Export failed:", err);
			new Notice(`Typeset: export failed — ${(err as Error).message}`);
			setIcon(btn, "lucide-download");
			btn.removeClass("is-loading");
			btn.removeAttribute("aria-disabled");
		}
	}

	private openThemePicker(): void {
		const file = this.lockedFile ?? this.currentFile;
		if (!file) return;
		const modal = new ThemePickerModal(this.app, file);
		// After the modal closes, processFrontMatter has updated the file.
		// In locked mode the editor-change event won't fire (the locked file
		// may not be the active editor), so force a re-render.
		const origClose = modal.onClose.bind(modal);
		modal.onClose = () => {
			origClose();
			this.cachedCssKey = ""; // invalidate CSS cache
			void this.render(file);
		};
		modal.open();
	}

	private async openNoteInEditor(file: TFile): Promise<void> {
		// Reveal the file if already open in a leaf, otherwise open to the LEFT.
		const leaves = this.app.workspace.getLeavesOfType("markdown");
		const existing = leaves.find(l => (l.view as MarkdownView).file === file);
		if (existing) {
			this.app.workspace.revealLeaf(existing);
			return;
		}
		// createLeafBySplit(leaf, direction, before=true) inserts to the LEFT.
		const leaf = (this.app.workspace as any).createLeafBySplit(this.leaf, "vertical", true);
		await leaf.openFile(file);
		this.app.workspace.revealLeaf(leaf);
	}

	private async openCssEditor(): Promise<void> {
		// Reveal if already open.
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_CSS_EDITOR);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		// Open in a horizontal split BELOW this preview pane.
		const leaf = (this.app.workspace as any).createLeafBySplit(this.leaf, "horizontal", false);
		await leaf.setViewState({ type: VIEW_TYPE_CSS_EDITOR, active: true });
		this.app.workspace.revealLeaf(leaf);
	}

	private toggleLock(): void {
		if (this.lockedFile) {
			// Unlock — resume following active note
			this.lockedFile = null;
			if (this.lockButtonEl) {
				setIcon(this.lockButtonEl, "lucide-lock-open");
				this.lockButtonEl.setAttribute("aria-label", "Lock preview to this note");
				this.lockButtonEl.removeClass("typeset-lock-active");
			}
			const file = this.findMarkdownFile();
			if (file) void this.render(file); // render() will refresh the info bar
		} else {
			// Lock to the note currently shown
			if (!this.currentFile) return;
			this.lockedFile = this.currentFile;
			if (this.lockButtonEl) {
				setIcon(this.lockButtonEl, "lucide-lock");
				this.lockButtonEl.setAttribute("aria-label", `Locked to: ${this.lockedFile.basename} — click to unlock`);
				this.lockButtonEl.addClass("typeset-lock-active");
			}
			// Refresh info bar immediately so the lock icon updates without a re-render.
			if (this.currentFile) {
				this.updateInfoBar(this.currentFile, this.currentThemeName);
			}
		}
	}

	/**
	 * Returns the active file if one is available, otherwise finds the most
	 * recently active MarkdownView in the workspace. Needed because when the
	 * preview pane opens as the active leaf, getActiveFile() returns null.
	 */
	private findMarkdownFile(): TFile | null {
		const direct = this.app.workspace.getActiveFile();
		if (direct?.extension === "md") return direct;
		// Preview is the active leaf — find any open markdown view.
		const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (mdView?.file?.extension === "md") return mdView.file;
		// Last resort: iterate all leaves for any open markdown file.
		let found: TFile | null = null;
		this.app.workspace.iterateAllLeaves(leaf => {
			if (!found && leaf.view instanceof MarkdownView && leaf.view.file?.extension === "md") {
				found = leaf.view.file;
			}
		});
		return found;
	}

	private showPlaceholder(message = "Open a note to preview"): void {
		if (!this.iframeEl) return;
		this.iframeEl.srcdoc =
			`<!DOCTYPE html><html><body style="font-family:sans-serif;` +
			`color:#666;padding:48px;background:#f5f5f5;">${message}</body></html>`;
	}
}

// ---------------------------------------------------------------------------
// Document builder
// ---------------------------------------------------------------------------

function buildDocument(
	pageWidthPx: number,
	pageHeightPx: number,
	marginCss: string,
	obsidianCss: string,
	themeCss: string,
	bodyHtml: string,
): string {
	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
/* Declare layer order — later layers always win regardless of specificity */
@layer obsidian, theme, layout;

/* ══════════════════════════════════════════════════════════════════════════
   LAYER 1 — Obsidian's base CSS
   Copied from the main window's <style> elements so the iframe has the same
   callout icons, code highlighting, CSS variables, etc. that the PDF sees.
   ══════════════════════════════════════════════════════════════════════════ */
@layer obsidian {
${obsidianCss}
}

/* ══════════════════════════════════════════════════════════════════════════
   LAYER 2 — Typeset theme CSS
   Print-specific overrides (fonts, sizes, colors).  Comes after Obsidian's
   CSS so any conflicts resolve in favour of the theme.
   ══════════════════════════════════════════════════════════════════════════ */
@layer theme {
${themeCss}
}

/* ══════════════════════════════════════════════════════════════════════════
   LAYER 3 — Preview layout (MUST BE LAST)
   Page-box chrome, grey surround, and content clipping.  @layer ordering
   guarantees these override Obsidian and theme rules without !important.
   ══════════════════════════════════════════════════════════════════════════ */
@layer layout {

/* ── Structural body overrides ──────────────────────────────────────────── */
html, body {
	margin:   0;
	padding:  0;
	height:   auto;
	overflow: auto;
	background: #d0d0d0;
	/* Reset theme columns — preview uses clip-based pagination which is
	   incompatible with CSS column-count.  Columns work in PDF natively. */
	column-count: auto;
}

/* ── Grey surround ──────────────────────────────────────────────────────── */
#typeset-scroll {
	background: #d0d0d0;
	padding: 8px;
	box-sizing: border-box;
	overflow-x: auto;
}

/* ── Page stack ─────────────────────────────────────────────────────────── */
#typeset-pages {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 24px;
	padding-bottom: 32px;
	width: fit-content;
	margin: 0 auto;
}

/* ── Individual page box ────────────────────────────────────────────────── */
.typeset-page-box {
	width: ${pageWidthPx}px;
	height: ${pageHeightPx}px;
	background: white;
	border: 1px solid #bbb;
	box-shadow: 0 2px 16px rgba(0, 0, 0, 0.25);
	overflow: hidden;
	position: relative;
	flex-shrink: 0;
}

/* ── Page number ────────────────────────────────────────────────────────── */
.typeset-page-label {
	position: absolute;
	top: 12px;
	right: 16px;
	font-family: system-ui, -apple-system, sans-serif;
	font-size: 10px;
	font-weight: 500;
	color: #aaa;
	letter-spacing: 0.06em;
	pointer-events: none;
	z-index: 10;
}

/* ── Content element baseline — match PDF output ──────────────────────── */

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

/* ── Page content / measure div ─────────────────────────────────────────── */
.typeset-page-content {
	position: absolute;
	left: 0;
	width: ${pageWidthPx}px;
	padding: ${marginCss};
	box-sizing: border-box;
}

} /* end @layer layout */
</style>
</head>
<body class="markdown-rendered">
<div id="typeset-scroll">
  <div id="typeset-pages"></div>
  <div id="typeset-measure" class="typeset-page-content markdown-rendered" style="top:0;left:-9999px;visibility:hidden;">${bodyHtml}</div>
</div>
</body>
</html>`;
}

