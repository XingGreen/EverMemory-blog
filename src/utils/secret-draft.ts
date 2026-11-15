/**
 * 密钥草稿的纯逻辑：脏判定、提交条目、逐行 diff。
 *
 * 引导页（/setup/）与后台环境变量页（/admin/env/）共用这一份，
 * 两处各算一遍的话，白名单与 diff 迟早会漂。
 */
import {
	SECRET_ROWS,
	type SecretItemState,
	type SecretRow,
} from "./admin-secrets";

/** 提交给 /api/admin/secrets 的一条：写入、或删除 */
export type SecretEntry = { key: string; value?: string; delete?: boolean };

export type SecretDiffRow = {
	key: string;
	label: string;
	kind: "add" | "replace" | "remove";
	/** 展示用文本：超长截断，敏感项一律留空 */
	from: string;
	to: string;
	masked: boolean;
};

/** 单项是否有未保存改动 */
export function isDirtyItem(
	item: SecretItemState,
	drafts: Record<string, string>,
	origin: Record<string, string>,
): boolean {
	const draft = (drafts[item.key] ?? "").trim();
	// 非敏感项已预填原值，直接与草稿比较
	if (!item.sensitive) return draft !== (origin[item.key] ?? "");
	// 敏感项：预填了原值则比较差异，否则「有输入即修改」
	if (item.key in origin) return draft !== (origin[item.key] ?? "");
	return draft !== "";
}

/**
 * 引导期要展示的行：只要行里有任意一个 key 是「必填且非托管」，这一行就出现。
 *
 * 判据与服务端写入白名单 BOOTSTRAP_KEYS 同源（都是 required && !managed），
 * 所以页面上摆出来的每一项都确实能被引导接口接收，不会出现「填了却存不进」。
 * env 页与 setup 页共用，避免两处各写一份过滤规则而漂移。
 */
export function bootstrapRows(items: SecretItemState[]): SecretRow[] {
	const required = new Set(
		items
			.filter((item) => item.required && !item.managed)
			.map((item) => item.key),
	);
	return SECRET_ROWS.filter((row) => row.keys.some((key) => required.has(key)));
}

/** 一行是否有未保存改动（一行可能管 1–3 个键） */
export function isRowDirty(
	row: SecretRow,
	itemOf: (key: string) => SecretItemState | undefined,
	drafts: Record<string, string>,
	origin: Record<string, string>,
): boolean {
	return row.keys.some((key) => {
		const item = itemOf(key);
		return item ? isDirtyItem(item, drafts, origin) : false;
	});
}

/**
 * 这一行算不算「配好了」。
 *
 * 多数行要求每个键都在；私钥那行是**二选一**（内联内容与 .pem 路径），
 * 用 every 会把它永远判成未配置。
 */
export function isRowConfigured(
	row: SecretRow,
	itemOf: (key: string) => SecretItemState | undefined,
): boolean {
	const has = (key: string) => {
		const item = itemOf(key);
		return item?.configured === true || item?.managed === true;
	};
	return row.shape === "content" ? row.keys.some(has) : row.keys.every(has);
}

/** 只把真正改动过的项发出去；清空输入框即视为删除该配置项 */
export function buildEntries(
	items: SecretItemState[],
	drafts: Record<string, string>,
	origin: Record<string, string>,
): SecretEntry[] {
	const entries: SecretEntry[] = [];
	for (const item of items) {
		const draft = (drafts[item.key] ?? "").trim();
		if (item.key in origin) {
			const baseline = origin[item.key] ?? "";
			if (draft === baseline) continue;
			if (!draft) {
				entries.push({ key: item.key, delete: true });
				continue;
			}
			entries.push({ key: item.key, value: draft });
		} else if (draft) {
			entries.push({ key: item.key, value: draft });
		}
	}
	return entries;
}

export function buildDiffRows(
	items: SecretItemState[],
	drafts: Record<string, string>,
	origin: Record<string, string>,
): SecretDiffRow[] {
	const byKey = new Map(items.map((item) => [item.key, item]));
	const clip = (value: string) =>
		!value ? "" : value.length > 40 ? `${value.slice(0, 40)}…` : value;

	return buildEntries(items, drafts, origin).map((entry) => {
		const item = byKey.get(entry.key);
		const masked = item?.sensitive === true;
		const kind: SecretDiffRow["kind"] = entry.delete
			? "remove"
			: entry.key in origin
				? "replace"
				: "add";
		return {
			key: entry.key,
			label: item?.label ?? entry.key,
			kind,
			from: masked ? "" : clip(origin[entry.key] ?? ""),
			to: masked ? "" : clip(entry.value ?? ""),
			masked,
		};
	});
}
