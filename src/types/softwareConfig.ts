export type SoftwareItem = {
	name: string;
	description?: string;
	tags?: string[];
	visitUrl?: string;
	sourceCode?: string;
	icon?: string;
	rating?: number;
	platform?: string[];
	price?: string;
};

export type SoftwareConfig = {
	software: SoftwareItem[];
	enableRating?: boolean;
};
