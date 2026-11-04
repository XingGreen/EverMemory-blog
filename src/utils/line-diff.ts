/**
 * 行级 diff（LCS）。
 *
 * 没有引入 diff 包：这里只需要「按行比较 + 上下文折叠」，
 * 引一个依赖换来的能力用不上，反而多一份包体积和升级负担。
 *
 * 复杂度 O(n·m) 内存。文章通常几百行，50 万格以内无压力；
 * 超过阈值直接退化成「整段替换」——那种文件本来也不适合逐行看。
 */

export type DiffKind = "keep" | "add" | "del";

export interface DiffRow {
	kind: DiffKind;
	/** 本地行号，新增行没有 */
	left: number | null;
	/** 远端行号，删除行没有 */
	right: number | null;
	text: string;
}

/** 折叠标记：中间跳过的未变更行数 */
export interface DiffGap {
	kind: "gap";
	count: number;
}

export type DiffLine = DiffRow | DiffGap;

const MAX_CELLS = 500_000;

export function diffLines(left: string, right: string): DiffRow[] {
	const a = left.split("\n");
	const b = right.split("\n");
	const m = a.length;
	const n = b.length;

	// 超大文件退化为整段替换，避免 DP 表吃掉几百 MB
	if (m * n > MAX_CELLS) {
		const rows: DiffRow[] = [];
		for (let i = 0; i < m; i++) {
			rows.push({ kind: "del", left: i + 1, right: null, text: a[i] });
		}
		for (let j = 0; j < n; j++) {
			rows.push({ kind: "add", left: null, right: j + 1, text: b[j] });
		}
		return rows;
	}

	// dp[i][j] = a[i..] 与 b[j..] 的最长公共子序列长度
	const dp: Int32Array[] = Array.from(
		{ length: m + 1 },
		() => new Int32Array(n + 1),
	);
	for (let i = m - 1; i >= 0; i--) {
		for (let j = n - 1; j >= 0; j--) {
			dp[i][j] =
				a[i] === b[j]
					? dp[i + 1][j + 1] + 1
					: Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}

	const rows: DiffRow[] = [];
	let i = 0;
	let j = 0;
	let ln = 1;
	let rn = 1;
	while (i < m && j < n) {
		if (a[i] === b[j]) {
			rows.push({ kind: "keep", left: ln++, right: rn++, text: a[i] });
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			rows.push({ kind: "del", left: ln++, right: null, text: a[i] });
			i++;
		} else {
			rows.push({ kind: "add", left: null, right: rn++, text: b[j] });
			j++;
		}
	}
	while (i < m)
		rows.push({ kind: "del", left: ln++, right: null, text: a[i++] });
	while (j < n)
		rows.push({ kind: "add", left: null, right: rn++, text: b[j++] });
	return rows;
}

/**
 * 只保留变更行及其前后 context 行，其余折叠成 gap。
 * 大文件里未变更的部分占绝大多数，全量渲染既慢也没人看。
 */
export function collapseUnchanged(rows: DiffRow[], context = 3): DiffLine[] {
	const keep = new Set<number>();
	rows.forEach((row, idx) => {
		if (row.kind === "keep") return;
		for (let k = idx - context; k <= idx + context; k++) {
			if (k >= 0 && k < rows.length) keep.add(k);
		}
	});

	const out: DiffLine[] = [];
	let gap = 0;
	rows.forEach((row, idx) => {
		if (keep.has(idx)) {
			if (gap > 0) {
				out.push({ kind: "gap", count: gap });
				gap = 0;
			}
			out.push(row);
		} else {
			gap++;
		}
	});
	if (gap > 0) out.push({ kind: "gap", count: gap });
	return out;
}

/** 统计增删行数，用于标题下的摘要 */
export function countChanges(rows: DiffRow[]): {
	added: number;
	removed: number;
} {
	let added = 0;
	let removed = 0;
	for (const r of rows) {
		if (r.kind === "add") added++;
		else if (r.kind === "del") removed++;
	}
	return { added, removed };
}
