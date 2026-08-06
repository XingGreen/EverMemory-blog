// 把 JSON 值序列化为缩进的 TypeScript 对象字面量（纯函数，无任何运行时依赖）
const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** JSON 值 → 缩进的 TS 对象字面量（使用制表符缩进） */
export function serializeValue(value: unknown, indent = "\t"): string {
	const tab = "\t";
	if (value === null || value === undefined) return "null";
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value)) {
		if (value.length === 0) return "[]";
		const inner = value.map((v) => serializeValue(v, indent + tab)).join(`,\n${indent + tab}`);
		return `[\n${indent + tab}${inner},\n${indent}]`;
	}
	if (typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>);
		if (entries.length === 0) return "{}";
		const inner = entries
			.map(
				([k, v]) =>
					`${IDENTIFIER_RE.test(k) ? k : JSON.stringify(k)}: ${serializeValue(v, indent + tab)}`,
			)
			.join(`,\n${indent + tab}`);
		return `{\n${indent + tab}${inner},\n${indent}}`;
	}
	return "null";
}