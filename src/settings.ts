// settings.ts — Plugin settings and Settings Tab UI

import { AbstractInputSuggest, App, Plugin, PluginSettingTab, Setting, TFolder } from "obsidian";
import { TypesetPreviewView, VIEW_TYPE_PREVIEW } from "./preview-view";
import type { ThemeInfo } from "./types";

// FolderSuggest — attaches a vault folder autocomplete dropdown to any text input.
// Extends Obsidian's AbstractInputSuggest so it matches the look and feel of
// native folder pickers used elsewhere in Obsidian's own settings UI.
class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(
		app: App,
		private inputEl: HTMLInputElement,
	) {
		super(app, inputEl);
	}

	getSuggestions(query: string): TFolder[] {
		const lower = query.toLowerCase();
		return this.app.vault
			.getAllLoadedFiles()
			.filter(
				(f): f is TFolder =>
					f instanceof TFolder && f.path.toLowerCase().includes(lower),
			)
			.sort((a, b) => a.path.localeCompare(b.path));
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path);
	}

	selectSuggestion(folder: TFolder): void {
		this.inputEl.value = folder.path;
		this.inputEl.trigger("input");
		this.close();
	}
}
import { TypesetSettings, PageSize, PageOrientation } from "./types";

export const DEFAULT_SETTINGS: TypesetSettings = {
	defaultLayout: {
		size: PageSize.A4,
		orientation: PageOrientation.Portrait,
		margins: { top: 20, right: 20, bottom: 20, left: 20, unit: "mm" },
	},
	activeTheme: "default.css",
	outputFolder: "",
};

// Page dimensions in mm — used to warn when margins exceed the page size.
const PAGE_DIMENSIONS_MM: Record<
	Exclude<PageSize, PageSize.Custom>,
	{ w: number; h: number }
> = {
	[PageSize.A4]:     { w: 210,   h: 297   },
	[PageSize.Letter]: { w: 215.9, h: 279.4 },
	[PageSize.Legal]:  { w: 215.9, h: 355.6 },
	[PageSize.A5]:     { w: 148,   h: 210   },
};

function toMm(value: number, unit: "mm" | "in" | "px"): number {
	if (unit === "mm") return value;
	if (unit === "in") return value * 25.4;
	return value * 0.264583; // 96 dpi
}

// Deep-merge saved data onto defaults so nested objects (e.g. margins) are
// merged field-by-field rather than replaced wholesale.
function deepMerge<T>(defaults: T, saved: Partial<T>): T {
	const result = { ...defaults } as Record<string, unknown>;
	for (const key in saved) {
		const savedVal = saved[key];
		const defaultVal = (defaults as Record<string, unknown>)[key];
		if (
			savedVal !== null &&
			typeof savedVal === "object" &&
			!Array.isArray(savedVal) &&
			typeof defaultVal === "object"
		) {
			result[key] = deepMerge(
				defaultVal as Record<string, unknown>,
				savedVal as Record<string, unknown>,
			);
		} else if (savedVal !== undefined) {
			result[key] = savedVal;
		}
	}
	return result as T;
}

// Fix NaN values that could come from corrupted saves — but never clamp,
// so the user's intentional values (even unusual ones) are always preserved.
function sanitizeSettings(s: TypesetSettings): TypesetSettings {
	const { margins } = s.defaultLayout;
	const fix = (v: number) => (isNaN(v) ? 0 : v);
	margins.top    = fix(margins.top);
	margins.right  = fix(margins.right);
	margins.bottom = fix(margins.bottom);
	margins.left   = fix(margins.left);
	return s;
}

export async function loadSettings(plugin: Plugin): Promise<TypesetSettings> {
	const saved = (await plugin.loadData()) ?? {};
	return sanitizeSettings(deepMerge(DEFAULT_SETTINGS, saved));
}

export async function saveSettings(
	plugin: Plugin,
	settings: TypesetSettings,
): Promise<void> {
	await plugin.saveData(settings);
	// Refresh any open preview panes so they pick up the new settings.
	for (const leaf of plugin.app.workspace.getLeavesOfType(VIEW_TYPE_PREVIEW)) {
		if (leaf.view instanceof TypesetPreviewView) {
			leaf.view.refresh();
		}
	}
}

export class TypesetSettingTab extends PluginSettingTab {
	private settings: TypesetSettings;
	private save: (settings: TypesetSettings) => Promise<void>;
	private getThemes: () => Promise<ThemeInfo[]>;

	constructor(
		app: App,
		plugin: Plugin,
		settings: TypesetSettings,
		save: (settings: TypesetSettings) => Promise<void>,
		getThemes: () => Promise<ThemeInfo[]>,
	) {
		super(app, plugin);
		this.settings = settings;
		this.save = save;
		this.getThemes = getThemes;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Typeset Settings" });

		// --- Default Theme ---
		containerEl.createEl("h3", { text: "Default Theme" });

		// Build a placeholder Setting immediately; populate the dropdown once
		// getAvailableThemes() resolves (it's async — reads from disk).
		const themeDropdownSetting = new Setting(containerEl)
			.setName("Default theme")
			.setDesc(
				"Theme applied when a note has no typeset-theme set in its frontmatter.",
			);

		this.getThemes().then(themes => {
			themeDropdownSetting.addDropdown(drop => {
				for (const theme of themes) {
					const label = theme.isBuiltIn
						? `${theme.name} (built-in)`
						: theme.name;
					drop.addOption(theme.filename, label);
				}
				// Fall back gracefully if the saved value isn't in the list.
				const saved = this.settings.activeTheme;
				const valid = themes.find(t => t.filename === saved);
				drop.setValue(valid ? saved : (themes[0]?.filename ?? ""));
				drop.onChange(async value => {
					this.settings.activeTheme = value;
					await this.save(this.settings);
				});
			});
		});

		// --- Page Layout ---
		containerEl.createEl("h3", { text: "Page Layout" });

		new Setting(containerEl)
			.setName("Page size")
			.setDesc("Paper size used when exporting to PDF.")
			.addDropdown(drop =>
				drop
					.addOptions({
						[PageSize.A4]: "A4",
						[PageSize.Letter]: "Letter",
						[PageSize.Legal]: "Legal",
						[PageSize.A5]: "A5",
						[PageSize.Custom]: "Custom",
					})
					.setValue(this.settings.defaultLayout.size)
					.onChange(async value => {
						this.settings.defaultLayout.size = value as PageSize;
						await this.save(this.settings);
						this.display();
					}),
			);

		if (this.settings.defaultLayout.size === PageSize.Custom) {
			const unit = this.settings.defaultLayout.margins.unit;

			new Setting(containerEl)
				.setName("Custom width")
				.setDesc(`Page width (${unit})`)
				.addText(text =>
					text
						.setPlaceholder("210")
						.setValue(
							String(
								this.settings.defaultLayout.customWidth ?? "",
							),
						)
						.onChange(async value => {
							const parsed = parseFloat(value);
							this.settings.defaultLayout.customWidth = isNaN(
								parsed,
							)
								? undefined
								: Math.max(1, parsed);
							await this.save(this.settings);
						}),
				);

			new Setting(containerEl)
				.setName("Custom height")
				.setDesc(`Page height (${unit})`)
				.addText(text =>
					text
						.setPlaceholder("297")
						.setValue(
							String(
								this.settings.defaultLayout.customHeight ?? "",
							),
						)
						.onChange(async value => {
							const parsed = parseFloat(value);
							this.settings.defaultLayout.customHeight = isNaN(
								parsed,
							)
								? undefined
								: Math.max(1, parsed);
							await this.save(this.settings);
						}),
				);
		}

		new Setting(containerEl)
			.setName("Orientation")
			.setDesc("Portrait or Landscape.")
			.addDropdown(drop =>
				drop
					.addOptions({
						[PageOrientation.Portrait]: "Portrait",
						[PageOrientation.Landscape]: "Landscape",
					})
					.setValue(this.settings.defaultLayout.orientation)
					.onChange(async value => {
						this.settings.defaultLayout.orientation =
							value as PageOrientation;
						await this.save(this.settings);
					}),
			);

		// --- Margins ---
		containerEl.createEl("h3", { text: "Margins" });

		new Setting(containerEl)
			.setName("Margin unit")
			.setDesc("Unit applied to all four margin values.")
			.addDropdown(drop =>
				drop
					.addOptions({ mm: "mm", in: "in" })
					.setValue(this.settings.defaultLayout.margins.unit)
					.onChange(async value => {
						this.settings.defaultLayout.margins.unit = value as
							| "mm"
							| "in"
							| "px";
						await this.save(this.settings);
						this.display();
					}),
			);

		const layout = this.settings.defaultLayout;
		const m = layout.margins;
		const u = m.unit;

		// Resolve page dimensions (mm), swapped for landscape.
		let pageW = 0, pageH = 0;
		if (layout.size !== PageSize.Custom) {
			const base = PAGE_DIMENSIONS_MM[layout.size as Exclude<PageSize, PageSize.Custom>];
			if (base) {
				const isLandscape = layout.orientation === PageOrientation.Landscape;
				pageW = isLandscape ? base.h : base.w;
				pageH = isLandscape ? base.w : base.h;
			}
		}

		// Raw text the user is typing — lets us flag non-numeric input without
		// clobbering the saved numeric value mid-keystroke.
		const raw: Partial<Record<"top" | "bottom" | "left" | "right", string>> = {};

		// Builds a margin text field and returns its onChange hook so the
		// paired warning can be updated whenever either field changes.
		const makeField = (
			side: "top" | "bottom" | "left" | "right",
			updateWarning: () => void,
		) => {
			new Setting(containerEl)
				.setName(side.charAt(0).toUpperCase() + side.slice(1))
				.setDesc(`${side.charAt(0).toUpperCase() + side.slice(1)} margin (${u})`)
				.addText(text =>
					text
						.setPlaceholder("20")
						.setValue(String(m[side]))
						.onChange(async value => {
							raw[side] = value;
							const parsed = parseFloat(value);
							if (!isNaN(parsed)) {
								m[side] = parsed;
								await this.save(this.settings);
							}
							updateWarning();
						}),
				);
		};

		// Converts mm back to the user's chosen unit for display.
		const fromMm = (mm: number, unit: "mm" | "in" | "px"): number => {
			if (unit === "in") return mm / 25.4;
			if (unit === "px") return mm / 0.264583;
			return mm;
		};

		// Renders warnings for a pair of sides into the given element.
		const renderPairWarnings = (
			el: HTMLDivElement,
			sideA: "top" | "bottom" | "left" | "right",
			sideB: "top" | "bottom" | "left" | "right",
			pageLimit: number, // mm; 0 = custom page (skip size check)
			dimension: "height" | "width",
		) => {
			el.empty();
			const msgs: string[] = [];
			const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

			for (const side of [sideA, sideB]) {
				const r = raw[side];
				if (r !== undefined && r.trim() !== "" && isNaN(parseFloat(r)))
					msgs.push(`${cap(side)}: "${r}" is not a valid number.`);
			}
			for (const side of [sideA, sideB]) {
				if (m[side] < 0)
					msgs.push(`${cap(side)} margin is negative — content may overflow the page edge.`);
			}
			if (pageLimit > 0) {
				const combined = toMm(m[sideA], u) + toMm(m[sideB], u);
				const available = pageLimit - combined;
				const availableDisplay = fromMm(Math.max(available, 0), u).toFixed(u === "in" ? 2 : 1);
				const threshold = pageLimit * 0.10;

				if (available <= 0) {
					msgs.push(
						`${cap(sideA)} + ${sideB} leaves no room for content — reduce margins to fit within the page ${dimension}.`,
					);
				} else if (available < threshold) {
					msgs.push(
						`Only ${availableDisplay} ${u} available for content (less than 10% of page ${dimension}).`,
					);
				}
			}

			for (const msg of msgs)
				el.createEl("p", { text: msg, cls: "typeset-margin-warning" });
		};

		// ── Top & Bottom ──────────────────────────────────────────────────────
		containerEl.createEl("p", { text: "Top & Bottom", cls: "typeset-margin-group-label" });
		let tbWarning!: HTMLDivElement;
		const updateTB = () => renderPairWarnings(tbWarning, "top", "bottom", pageH, "height");
		makeField("top", updateTB);
		makeField("bottom", updateTB);
		tbWarning = containerEl.createDiv({ cls: "typeset-margin-pair-warning" });
		updateTB();

		// ── Left & Right ──────────────────────────────────────────────────────
		containerEl.createEl("p", { text: "Left & Right", cls: "typeset-margin-group-label" });
		let lrWarning!: HTMLDivElement;
		const updateLR = () => renderPairWarnings(lrWarning, "left", "right", pageW, "width");
		makeField("left", updateLR);
		makeField("right", updateLR);
		lrWarning = containerEl.createDiv({ cls: "typeset-margin-pair-warning" });
		updateLR();

		// --- Export ---
		containerEl.createEl("h3", { text: "Export" });

		new Setting(containerEl)
			.setName("Output folder")
			.setDesc(
				"Vault-relative folder where exported PDFs are saved. Leave blank to save next to the note.",
			)
			.addText(text => {
				text
					.setPlaceholder("e.g. Exports/PDF")
					.setValue(this.settings.outputFolder)
					.onChange(async value => {
						this.settings.outputFolder = value;
						await this.save(this.settings);
					});
				new FolderSuggest(this.app, text.inputEl);
			});
	}
}
