// settings.ts — Plugin settings and Settings Tab UI

import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
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

		new Setting(containerEl)
			.setName("Output folder")
			.setDesc(
				"Vault-relative folder where exported PDFs are saved. Leave blank to save next to the note.",
			)
			.addText(text =>
				text
					.setPlaceholder("e.g. Exports/PDF")
					.setValue(this.settings.outputFolder)
					.onChange(async value => {
						this.settings.outputFolder = value;
						await this.save(this.settings);
					}),
			);
	}
}
