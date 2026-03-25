// settings.ts — Plugin settings and Settings Tab UI

import { AbstractInputSuggest, App, Plugin, PluginSettingTab, Setting, TFolder } from "obsidian";

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

export async function loadSettings(plugin: Plugin): Promise<TypesetSettings> {
	return Object.assign({}, DEFAULT_SETTINGS, await plugin.loadData());
}

export async function saveSettings(
	plugin: Plugin,
	settings: TypesetSettings,
): Promise<void> {
	await plugin.saveData(settings);
}

export class TypesetSettingTab extends PluginSettingTab {
	private settings: TypesetSettings;
	private save: (settings: TypesetSettings) => Promise<void>;

	constructor(
		app: App,
		plugin: Plugin,
		settings: TypesetSettings,
		save: (settings: TypesetSettings) => Promise<void>,
	) {
		super(app, plugin);
		this.settings = settings;
		this.save = save;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Typeset Settings" });

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

		const marginUnit = this.settings.defaultLayout.margins.unit;

		for (const side of ["top", "right", "bottom", "left"] as const) {
			new Setting(containerEl)
				.setName(`Margin — ${side}`)
				.setDesc(`${side.charAt(0).toUpperCase() + side.slice(1)} margin (${marginUnit})`)
				.addText(text =>
					text
						.setPlaceholder("20")
						.setValue(
							String(this.settings.defaultLayout.margins[side]),
						)
						.onChange(async value => {
							const parsed = parseFloat(value);
							this.settings.defaultLayout.margins[side] = isNaN(
								parsed,
							)
								? 0
								: Math.max(0, parsed);
							await this.save(this.settings);
						}),
				);
		}

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
					}),
			);

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
