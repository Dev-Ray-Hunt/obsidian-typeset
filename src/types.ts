// types.ts — Core TypeScript interfaces and types

export enum PageSize {
	A4 = "A4",
	Letter = "Letter",
	Legal = "Legal",
	A5 = "A5",
}

export enum PageOrientation {
	Portrait = "Portrait",
	Landscape = "Landscape",
}

export interface PageMargins {
	top: number;
	right: number;
	bottom: number;
	left: number;
	unit: "mm" | "in" | "px";
}

export interface PageLayout {
	size: PageSize;
	orientation: PageOrientation;
	margins: PageMargins;
}

export interface TypesetSettings {
	defaultLayout: PageLayout;
	activeTheme: string; // filename of the active CSS theme
	outputFolder: string; // where to save exported PDFs
}

export interface ThemeInfo {
	name: string;
	filename: string;
	isBuiltIn: boolean;
	layoutOverrides?: Partial<PageLayout>;
}
