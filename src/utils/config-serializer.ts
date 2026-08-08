// 把 JSON 值序列化为缩进的 TypeScript 对象字面量（纯函数，无任何运行时依赖）。
// 支持在序列化时把原配置文件中的注释按「键路径」回填回去，避免在线编辑保存时丢失注释。
const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** JSON 值 → 缩进的 TS 对象字面量（使用制表符缩进）。comments 为可选的原注释表（path -> 注释行）。 */
export function serializeValue(
	value: unknown,
	indent = "\t",
	comments?: Map<string, string[]>,
	path = "",
): string {
	const tab = "\t";

	if (value === null || value === undefined) return "null";
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number" || typeof value === "boolean")
		return String(value);

	if (Array.isArray(value)) {
		if (value.length === 0) return "[]";
		const childIndent = indent + tab;
		const inner = value
			.map((v, i) => {
				const p = path ? `${path}.${i}` : String(i);
				return (
					withComments(p, childIndent, comments) +
					childIndent +
					serializeValue(v, childIndent, comments, p)
				);
			})
			.join(",\n");
		return `[\n${inner},\n${indent}]`;
	}

	if (typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>);
		if (entries.length === 0) return "{}";
		const childIndent = indent + tab;
		const inner = entries
			.map(([k, v]) => {
				const childPath = path ? `${path}.${k}` : k;
				const keyExpr = IDENTIFIER_RE.test(k) ? k : JSON.stringify(k);
				return (
					withComments(childPath, childIndent, comments) +
					`${childIndent}${keyExpr}: ${serializeValue(v, childIndent, comments, childPath)}`
				);
			})
			.join(",\n");
		return `{\n${inner},\n${indent}}`;
	}

	return "null";
}

/** 若指定路径存在原注释，则按当前缩进输出注释行（多行换行另起一行并缩进）。 */
function withComments(
	path: string,
	indent: string,
	comments?: Map<string, string[]>,
): string {
	const lines = comments?.get(path);
	if (!lines || lines.length === 0) return "";
	return lines.map((line) => indent + line.trimStart()).join("\n") + "\n";
}

/**
 * 从配置文件的对象字面量源码中收集注释。
 * @param literal 以 `{` 开头的对象字面量源码（含最外层 `{` 与匹配的 `}`）。
 * @returns path -> 注释行数组。path 用 `.` 连接（对象用键名、数组用下标）。
 */
/**
 * 在源码中寻找与 startIdx（指向 '{' 或 '['）匹配的闭合括号下标（处理字符串与注释）。
 */
export function matchClosingBrace(s: string, startIdx: number): number {
	const open = s[startIdx];
	const close = open === "{" ? "}" : "]";
	let depth = 0;
	let i = startIdx;
	while (i < s.length) {
		const c = s[i];
		if (c === '"' || c === "'") {
			const quote = c;
			i++;
			while (i < s.length) {
				if (s[i] === "\\") {
					i += 2;
					continue;
				}
				if (s[i] === quote) break;
				i++;
			}
			i++;
			continue;
		}
		if (s.startsWith("//", i)) {
			const e = s.indexOf("\n", i);
			i = e === -1 ? s.length : e;
			continue;
		}
		if (s.startsWith("/*", i)) {
			const e = s.indexOf("*/", i + 2);
			i = e === -1 ? s.length : e + 2;
			continue;
		}
		if (c === "{") depth++;
		else if (c === "}") {
			depth--;
			if (depth === 0) return i;
		}
		i++;
	}
	return -1;
}

export function collectComments(literal: string): Map<string, string[]> {
	const map = new Map<string, string[]>();
	parseObject(literal, 0, "", map);
	return map;
}

/** 跳过空白与注释；注释追加到 comments；返回新的下标。 */
function skipWsComments(
	s: string,
	i: number,
	comments: string[],
	tab = "\t",
): number {
	while (i < s.length) {
		const c = s[i];
		if (c === " " || c === "\t" || c === "\r" || c === "\n") {
			i++;
			continue;
		}
		if (s.startsWith("//", i)) {
			const e = s.indexOf("\n", i);
			const end = e === -1 ? s.length : e;
			comments.push(s.slice(i, end));
			i = end;
			continue;
		}
		if (s.startsWith("/*", i)) {
			const e = s.indexOf("*/", i + 2);
			const end = e === -1 ? s.length : e + 2;
			comments.push(s.slice(i, end));
			i = end;
			continue;
		}
		break;
	}
	return i;
}

function skipScalar(s: string, j: number) {
	if (j >= s.length) return j;
	const c = s[j];
	if (c === '"' || c === "'") {
		const quote = c;
		j++;
		while (j < s.length) {
			if (s[j] === "\\") {
				j += 2;
				continue;
			}
			if (s[j] === quote) return j + 1;
			j++;
		}
		return j;
	}
	while (j < s.length && !",}\n]".includes(s[j])) j++;
	return j;
}

function parseObject(
	s: string,
	i: number,
	path: string,
	map: Map<string, string[]>,
): number {
	// i 指向 '{'
	i++;
	const tabs = "\t";
	while (i < s.length) {
		const comments: string[] = [];
		i = skipWsComments(s, i, comments);
		if (i >= s.length) break;
		const ch = s[i];
		if (ch === "}") return i + 1;

		// 读取键名
		let key: string;
		if (ch === '"' || ch === "'") {
			const quote = ch;
			const start = ++i;
			while (i < s.length) {
				if (s[i] === "\\") {
					i += 2;
					continue;
				}
				if (s[i] === quote) break;
				i++;
			}
			key = s.slice(start, i);
			i++; // 跳过结束引号
		} else {
			const start = i;
			while (i < s.length && /[A-Za-z0-9_$]/.test(s[i])) i++;
			key = s.slice(start, i);
		}

		// 跳过冒号
		i = skipWsComments(s, i, []);
		if (s[i] === ":") i++;

		const childPath = path ? `${path}.${key}` : key;
		map.set(childPath, comments);

		// 解析值
		i = skipWsComments(s, i, []);
		if (s[i] === "{") {
			i = parseObject(s, i, childPath, map);
		} else if (s[i] === "[") {
			i = parseArray(s, i, childPath, map, tabs);
		} else {
			i = skipScalar(s, i);
		}

		i = skipWsComments(s, i, []);
		if (s[i] === ",") i++;
	}
	return i;
}

function parseArray(
	s: string,
	i: number,
	path: string,
	map: Map<string, string[]>,
	_tabs: string,
): number {
	// i 指向 '['
	i++;
	let propIdx = 0;
	while (i < s.length) {
		const comments: string[] = [];
		i = skipWsComments(s, i, comments);
		if (i >= s.length) break;
		if (s[i] === "]") return i + 1;
		const childPath = path ? `${path}.${propIdx}` : String(propIdx);
		map.set(childPath, comments);
		if (s[i] === "{") {
			i = parseObject(s, i, childPath, map);
		} else if (s[i] === "[") {
			i = parseArray(s, i, childPath, map, _tabs);
		} else {
			i = skipScalar(s, i);
		}
		i = skipWsComments(s, i, []);
		if (s[i] === ",") i++;
		propIdx++;
	}
	return i;
}
