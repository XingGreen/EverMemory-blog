import { siteConfig } from "../config";
import type I18nKey from "./i18nKey";
import { en } from "./languages/en";
import { ja } from "./languages/ja";
import { ru } from "./languages/ru";
import { zh_CN } from "./languages/zh_CN";
import { zh_TW } from "./languages/zh_TW";
import { zaku } from "./languages/zh_CN_zaku"; // 豆包翻译的雌小鬼语言，暂未完成

export type Translation = {
	[K in I18nKey]: string;
};

const defaultTranslation = zh_CN;

const map: { [key: string]: Translation } = {
	en: en,
	en_us: en,
	en_gb: en,
	en_au: en,
	zh_cn: zh_CN,
	zh_tw: zh_TW,
	ja: ja,
	ja_jp: ja,
	ru: ru,
	ru_ru: ru,
	zaku: zaku,
	"zh_cn_zaku": zaku,
};

export function getTranslation(lang: string): Translation {
	return map[lang.toLowerCase()] || defaultTranslation;
}

export function i18n(key: I18nKey): string {
	const lang = siteConfig.lang || "en";
	const currentLang = getTranslation(lang);
	const value = currentLang[key];

	// 如果当前语言没有翻译（或为空），则使用中文作为备选
	if (!value && lang.toLowerCase() !== "zh_cn") {
		const chineseValue = zh_CN[key];
		if (chineseValue) {
			return chineseValue;
		}
	}

	return value || defaultTranslation[key];
}
