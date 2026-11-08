/**
 * 加密文章的默认标题。
 *
 * 加密文章的意义是不让未授权访客看到正文，但「标题留空走正文首行」的兜底策略
 * 会把正文第一句直接摆到明面上。因此加密文章一旦没填标题，就改用「前缀 + 时间」，
 * 时间格式由 siteConfig.post.encryptedTitle.timeFormat 配置。
 */

import { siteConfig } from "../config";

const DEFAULT_PREFIX = "加密文章";
const DEFAULT_FORMAT = "YYYY-MM-DD HH:mm";

interface DateParts {
	YYYY: string;
	MM: string;
	DD: string;
	HH: string;
	mm: string;
	ss: string;
}

/** 按站点时区取各时间分量，避免服务器时区与站点时区不一致 */
function partsOf(date: Date): DateParts {
	const options: Intl.DateTimeFormatOptions = {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	};
	if (siteConfig.timezone) options.timeZone = siteConfig.timezone;

	const parts = new Intl.DateTimeFormat("en-CA", options).formatToParts(date);
	const get = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((part) => part.type === type)?.value || "";

	return {
		YYYY: get("year"),
		MM: get("month"),
		DD: get("day"),
		HH: get("hour"),
		mm: get("minute"),
		ss: get("second"),
	};
}

/** 单遍替换，避免先替换出的数字被后面的占位符二次命中 */
export function formatByPattern(date: Date, pattern: string): string {
	const trimmed = (pattern || DEFAULT_FORMAT).trim();
	if (/^iso$/i.test(trimmed)) return date.toISOString();

	const parts = partsOf(date);
	return trimmed.replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => {
		return parts[token as keyof DateParts] ?? token;
	});
}

/** 「加密文章 2026-11-08 17:20」——前缀与时间格式都来自站点配置 */
export function buildEncryptedTitle(date: Date = new Date()): string {
	const conf = siteConfig.post?.encryptedTitle ?? {};
	const prefix = (conf.prefix ?? "").trim() || DEFAULT_PREFIX;
	const stamp = formatByPattern(date, conf.timeFormat ?? DEFAULT_FORMAT);
	return stamp ? `${prefix} ${stamp}` : prefix;
}
