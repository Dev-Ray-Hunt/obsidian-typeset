// preview-view.ts — Split-pane print preview Obsidian View
// M4 rework: iframe + srcdoc with live updates (Issues #39, #40, #42, #43)

import { Component, ItemView, MarkdownRenderer, MarkdownView, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { VIEW_TYPE_CSS_EDITOR } from "./css-editor-view";
import { applyCalloutClasses, parseBlockClasses } from "./block-class-parser";
import { PageLayout, PageOrientation, PageSize } from "./types";
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
	private infoBarEl: HTMLElement | null = null;
	private currentThemeName = "";
	private iframeEl: HTMLIFrameElement | null = null;
	private debounceTimer: number | null = null;

	// ── Render cache ──────────────────────────────────────────────────────────
	// Themes and CSS are re-loaded from disk only when the active theme changes,
	// not on every keystroke. This eliminates the main source of render lag.
	private cachedCss = "";
	private cachedCssKey = ""; // "<defaultTheme>|<assignedTheme>" — cache key

	// Obsidian's base CSS captured once from document.head.
	// The PDF renders inside the main Obsidian window so all of Obsidian's CSS
	// is already present — callout icons, colors, code highlighting, etc.
	// The preview iframe has none of that unless we copy it in explicitly.
	// We capture it once and reuse it for every render (it never changes).
	private obsidianCss: string | null = null;

	private getObsidianCss(): string {
		if (this.obsidianCss === null) {
			this.obsidianCss = Array.from(
				document.querySelectorAll<HTMLStyleElement>("style"),
			)
				.map(s => s.textContent ?? "")
				.join("\n");
		}
		return this.obsidianCss;
	}

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
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const assignedThemeName = frontmatter?.["typeset-theme"] as string | undefined;
		const defaultThemeName = this.plugin.settings.activeTheme;

		const themes = await this.plugin.cssManager.getAvailableThemes();
		if (themes.length === 0) {
			console.error("[Typeset] render(): no themes found — check built-in/ folder in plugin directory");
			this.showPlaceholder("No themes found — check built-in/ folder");
			return;
		}

		const defaultTheme = themes.find(t => t.filename === defaultThemeName) ?? themes[0];
		const assignedTheme =
			assignedThemeName && assignedThemeName !== defaultThemeName
				? (themes.find(t => t.filename === assignedThemeName) ?? null)
				: null;

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

			const totalHeight = measure.scrollHeight;
			const contentHtml = measure.innerHTML;
			const measureTop  = measure.getBoundingClientRect().top;

			// ── Block element map ─────────────────────────────────────────────
			// Collect all significant block elements with their measured positions.
			// We check each element for two CSS hints:
			//   avoidBreakInside — .callout, table, pre: never split mid-element
			//   avoidBreakAfter  — h1–h6: keep heading glued to the content below it
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

			// ── Smart break finder ────────────────────────────────────────────
			// Given the previous page's break position and the raw target
			// (prevBreak + pageHeightPx), return a clean break position that:
			//   • doesn't split any avoidBreakInside element (callout, table, pre)
			//   • doesn't break immediately after a heading — keeps heading + first
			//     content together (avoidBreakAfter)
			//
			// Key invariant: the "revert to before-heading" logic fires ONLY when
			// the block that follows the heading STRADDLES the boundary.  When the
			// heading and the block both fit, bestBreak advances normally.
			function smartBreak(prevBreak: number, target: number): number {
				let bestBreak        = prevBreak; // best clean break found so far
				let beforeHeadingPos = prevBreak; // bestBreak value just before a heading
				let pendingHeading   = false;     // true while last seen block was a heading

				for (const b of blocks) {
					if (b.top <= prevBreak) continue; // before our window
					if (b.top >= target)   break;      // past the boundary

					if (b.bottom <= target) {
						// ── Block fits entirely on this page ─────────────────────
						if (b.avoidBreakAfter) {
							// Heading fits — remember the break point just before it so
							// we can retreat here if the *next* block doesn't fit.
							if (!pendingHeading) beforeHeadingPos = bestBreak;
							pendingHeading = true;
							// Don't advance bestBreak yet; wait to see if next content fits.
						} else {
							// Non-heading block fits.  Always advance bestBreak.
							// (If a heading preceded it and BOTH fit, heading stays on this
							// page with its content — no revert needed.)
							bestBreak     = b.bottom;
							pendingHeading = false;
						}
					} else {
						// ── Block straddles the boundary ─────────────────────────
						if (pendingHeading) {
							// Content after the heading doesn't fit — retreat to just
							// before the heading so it travels with its content to p.N+1.
							bestBreak = beforeHeadingPos;
						} else {
							// No pending heading — break just before this block.
							bestBreak = b.top > prevBreak ? b.top : prevBreak;
						}
						break;
					}
				}

				// Fall back to the raw boundary if no clean break was found.
				return bestBreak > prevBreak ? bestBreak : target;
			}

			// ── Calculate page start offsets ──────────────────────────────────
			const pageStarts: number[] = [0];
			let prev = 0;
			while (prev < totalHeight) {
				const target = prev + contentAreaHeightPx;
				if (target >= totalHeight) break;
				const next = smartBreak(prev, target);
				pageStarts.push(next);
				prev = next;
			}

			// ── Build page boxes ──────────────────────────────────────────────
			for (let i = 0; i < pageStarts.length; i++) {
				const pageBox = doc.createElement("div");
				pageBox.className = "typeset-page-box";

				const label = doc.createElement("div");
				label.className = "typeset-page-label";
				label.textContent = `${i + 1}`;
				pageBox.appendChild(label);

				// Calculate the exact height of this page's content slice.
				// Without this clip, smart breaks cause content to repeat:
				// page N still shows up to pageHeightPx even if pageStarts[N+1]
				// was moved back, so the overlapping region shows on both pages.
				const nextStart      = i + 1 < pageStarts.length ? pageStarts[i + 1] : totalHeight;
				const contentHeight  = nextStart - pageStarts[i];

				const clip = doc.createElement("div");
				// Pages 2+ need margin-top to recreate the top margin space
				// (page 1 gets it from the content div's CSS padding-top).
				const clipMargin = i === 0 ? 0 : topMarginPx;
				clip.style.cssText = `height:${contentHeight}px;overflow:hidden;position:relative;margin-top:${clipMargin}px;`;

				const content = doc.createElement("div");
				content.className = "typeset-page-content";
				if (i > 0) {
					// Remove top padding — the clip's margin-top provides the space.
					// Compensate the top offset: without padding, content shifts up
					// by topMarginPx, so add it back to keep alignment correct.
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

			measure.remove();

			// ── Fit to width ──────────────────────────────────────────────────
			const available = scrollEl.clientWidth - 64; // 32px padding each side
			const scale     = Math.min(1, available / pageWidthPx);
			pagesContainer.style.zoom = String(scale);

			// Restore scroll position after re-render.
			if (prevScroll > 0) scrollEl.scrollTop = prevScroll;
		};

		iframe.srcdoc = buildDocument(pageWidthPx, pageHeightPx, marginCss, this.getObsidianCss(), themeCss, renderedHtml);
	}

	// ── Private helpers ───────────────────────────────────────────────────────

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

		// Theme chip — click opens the CSS editor below this pane
		const themeChip = this.infoBarEl.createSpan();
		themeChip.style.cssText = chipCss;
		themeChip.setAttribute("aria-label", "Open CSS editor");
		const themeIcon = themeChip.createSpan();
		setIcon(themeIcon, "lucide-palette");
		themeIcon.style.cssText = "display:flex;align-items:center;width:12px;height:12px;";
		themeChip.createSpan({ text: themeName });
		themeChip.addEventListener("mouseenter", () => themeChip.style.background = "var(--background-modifier-hover)");
		themeChip.addEventListener("mouseleave", () => themeChip.style.background = "");
		themeChip.addEventListener("click", () => void this.openCssEditor());
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
/* ══════════════════════════════════════════════════════════════════════════
   LAYER 1 — Obsidian's base CSS
   Copied from the main window's <style> elements so the iframe has the same
   callout icons, code highlighting, CSS variables, etc. that the PDF sees.
   ══════════════════════════════════════════════════════════════════════════ */
${obsidianCss}

/* ══════════════════════════════════════════════════════════════════════════
   LAYER 2 — Typeset theme CSS
   Print-specific overrides (fonts, sizes, colors).  Comes after Obsidian's
   CSS so any conflicts resolve in favour of the theme.
   ══════════════════════════════════════════════════════════════════════════ */
${themeCss}

/* ══════════════════════════════════════════════════════════════════════════
   LAYER 3 — Preview layout (MUST BE LAST)
   Page-box chrome, grey surround, and content clipping.  Uses !important on
   body-level properties because Obsidian's CSS sets overflow:hidden / height
   on body for its own pane management — those break iframe scrolling.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── Structural body overrides ──────────────────────────────────────────── */
html, body {
	margin:   0 !important;
	padding:  0 !important;
	height:   auto !important;
	overflow: auto !important;
	background: #d0d0d0 !important;
}

/* ── Grey surround ──────────────────────────────────────────────────────── */
#typeset-scroll {
	background: #d0d0d0;
	padding: 32px;
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
	background: white !important;
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

/* ── Callout fixes — match PDF output ──────────────────────────────────── */
.callout-icon { display: none !important; }
.callout-title { color: rgb(var(--callout-color, 68, 138, 255)) !important; }

/* ── Page content / measure div ─────────────────────────────────────────── */
.typeset-page-content {
	position: absolute !important;
	left: 0;
	width: ${pageWidthPx}px !important;
	padding: ${marginCss} !important;
	box-sizing: border-box !important;
}
</style>
</head>
<body>
<div id="typeset-scroll">
  <div id="typeset-pages"></div>
  <div id="typeset-measure" class="typeset-page-content" style="top:0;left:-9999px;visibility:hidden;">${bodyHtml}</div>
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Converts a value in the given unit to CSS pixels at 96dpi. */
function toPx(value: number, unit: "mm" | "in" | "px"): number {
	if (unit === "mm") return Math.round((value * 96) / 25.4);
	if (unit === "in") return Math.round(value * 96);
	return Math.round(value);
}

/**
 * Merges a base PageLayout with zero or more partial override layers.
 * Mirrors the private mergeLayout in pdf-exporter.ts.
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
