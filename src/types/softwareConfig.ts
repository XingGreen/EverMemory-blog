export type PriceType = "free" | "freemium" | "paid";

export type SoftwareItem = {
	name: string;
	description?: string;
	tags?: string[];
	visitUrl?: string;
	sourceCode?: string;
	icon?: string;
	platform?: string[];
	priceType?: PriceType;
};

export type SoftwareConfig = {
	software: SoftwareItem[];
};
