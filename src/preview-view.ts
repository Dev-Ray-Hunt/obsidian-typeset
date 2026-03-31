// preview-view.ts — Split-pane print preview Obsidian View
// M4 rework: iframe + srcdoc with live updates (Issues #39, #40, #42, #43)

import { Component, ItemView, MarkdownRenderer, MarkdownView, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { VIEW_TYPE_CSS_EDITOR } from "./css-editor-view";
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
				if (file instanceof TFile && file !== this.currentFile) {
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
		if (activeFile instanceof TFile) {
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

		// ── Step 4: Build CSS string (cached — skips disk reads while typing) ──
		const { margins } = effectiveLayout;
		const u = margins.unit;
		const marginCss = `${margins.top}${u} ${margins.right}${u} ${margins.bottom}${u} ${margins.left}${u}`;

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

		// ── Step 5: Render markdown to a live, document-attached temp container ─
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

		// Apply block-class transforms on the live DOM before extracting HTML.
		applyCalloutClassesDOM(tempContainer);
		parseBlockClassesDOM(tempContainer);

		const renderedHtml = tempContainer.innerHTML;
		component.unload();
		tempContainer.remove();

		// ── Step 6: Build full self-contained document and set srcdoc ─────────
		// CSS is inlined inside the iframe — no scoping needed, no cascade
		// conflicts with Obsidian's own styles.
		const iframe = this.iframeEl;
		iframe.onload = () => {
			const doc = iframe.contentDocument;
			if (!doc) return;

			// Inject page-boundary lines into the positioned page div.
			const page = doc.getElementById("typeset-page");
			if (!page) return;
			const contentHeight = page.scrollHeight;
			for (let y = pageHeightPx; y < contentHeight; y += pageHeightPx) {
				const line = doc.createElement("div");
				line.className = "typeset-page-boundary";
				line.style.top = `${y}px`;
				page.appendChild(line);
			}
		};

		iframe.srcdoc = buildDocument(pageWidthPx, marginCss, themeCss, renderedHtml);
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
		if (direct) return direct;
		// Preview is the active leaf — find any open markdown view.
		const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (mdView?.file) return mdView.file;
		// Last resort: iterate all leaves for any open markdown file.
		let found: TFile | null = null;
		this.app.workspace.iterateAllLeaves(leaf => {
			if (!found && leaf.view instanceof MarkdownView && leaf.view.file) {
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
// DOM transforms — mirror block-class-parser.ts but operate on the live DOM
// so we never reset innerHTML and lose Obsidian's callout render state.
// ---------------------------------------------------------------------------

/**
 * Adds a `callout-<type>` class derived from `data-callout` to every callout.
 */
function applyCalloutClassesDOM(root: HTMLElement): void {
	for (const el of Array.from(root.querySelectorAll<HTMLElement>(".callout[data-callout]"))) {
		const type = el.getAttribute("data-callout") ?? "";
		el.classList.add("callout-" + type.toLowerCase().replace(/\s+/g, "-"));
	}
}

/**
 * Finds `{.class}` annotation paragraphs, applies the classes to the
 * preceding sibling, then removes the annotation.
 */
function parseBlockClassesDOM(root: HTMLElement): void {
	const ANNOTATION = /^\{\.[\w-]+(?: +\.[\w-]+)*\}$/;
	for (const p of Array.from(root.querySelectorAll("p"))) {
		const text = p.textContent?.trim() ?? "";
		if (!ANNOTATION.test(text)) continue;
		const classes = text.slice(1, -1).split(/\s+/).map(c => c.slice(1));
		const prev = p.previousElementSibling;
		if (prev) classes.forEach(cls => prev.classList.add(cls));
		p.remove();
	}
}

// ---------------------------------------------------------------------------
// Document builder
// ---------------------------------------------------------------------------

function buildDocument(
	pageWidthPx: number,
	marginCss: string,
	themeCss: string,
	bodyHtml: string,
): string {
	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
/* ── iframe body = grey surround; #typeset-page = white page ────────────── */
html, body {
	margin: 0;
	padding: 32px;
	background: #e8e8e8;
	min-height: 100%;
	box-sizing: border-box;
}

#typeset-page {
	width: ${pageWidthPx}px;
	margin: 0 auto;
	padding: ${marginCss};
	box-sizing: border-box;
	background: white;
	color: black;
	position: relative;
	/* Obsidian CSS variable fallbacks so theme CSS renders correctly
	   inside the iframe without the host theme's variable definitions. */
	--text-normal: #1a1a1a;
	--text-muted: #555555;
	--text-faint: #888888;
	--text-on-accent: #ffffff;
	--background-primary: #ffffff;
	--background-primary-alt: #f7f7f7;
	--background-secondary: #f2f3f5;
	--background-modifier-border: #ddd;
	--callout-content-color: #1a1a1a;
}

.typeset-page-boundary {
	position: absolute;
	left: 0;
	right: 0;
	height: 0;
	border-top: 2px dashed #aaa;
	pointer-events: none;
	z-index: 10;
}

/* ── Theme CSS (isolated inside iframe — no selector scoping needed) ─────── */
${themeCss}
</style>
</head>
<body>
<div id="typeset-page">
${bodyHtml}
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
