export type PriceType = "free" | "freemium" | "paid";

export type AppItem = {
	name: string;
	description?: string;
	tags?: string[];
	visitUrl?: string;
	sourceCode?: string;
	icon?: string;
	platform?: string[];
	priceType?: PriceType;
};

export type AppConfig = {
	apps: AppItem[];
};
