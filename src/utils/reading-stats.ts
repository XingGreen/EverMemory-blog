/**
 * 字数与阅读时长估算（前后台共用）。
 *
 * 前台由 `remark-reading-time` 在构建期写入 frontmatter（words / minutes），
 * 后台拿不到那一步的结果，因此在同一套口径上重算一次。
 *
 * 这里刻意不引用 `reading-time` 包（不在客户端调用它的 `getReadingTime()`）：它内部依赖 node 的
 * `stream` / `util.inherits`，一旦被打进浏览器包，Vite 会把它外部化成空模块，
 * 调用时抛 `util.inherits is not a function`，把引用它的后台页面整体拖垮（水合失败
 * → 整页白屏）。因此按 reading-time 1.5.0 的同一套判定在本文件内重写一遍：
 * CJK 逐字计一个词，拉丁文按空白分词，标点跟随前一个 CJK 字一起吞掉。
 * 判定逻辑与前台插件一致，所以两边数字仍然对得上。
 */

/** 判断字符码是否落在任一区间内 */
function codeIsInRanges(code: number, ranges: Array<[number, number]>): boolean {
	return ranges.some(([lower, upper]) => lower <= code && code <= upper);
}

/** 汉字 / 平假名 / 谚文 / CJK 扩展区：每个字符都算一个词 */
function isCJK(char: string | undefined): boolean {
	if (!char) return false;
	const code = char.charCodeAt(0);
	return codeIsInRanges(code, [
		[0x3040, 0x309f],
		[0x4e00, 0x9fff],
		[0xac00, 0xd7a3],
		[0x20000, 0x2ebe0],
	]);
}

/** 空白即词边界 */
function isWordBound(char: string | undefined): boolean {
	return char === " " || char === "\n" || char === "\r" || char === "\t";
}

/** 标点（含全角变体）：跟在 CJK 后面时并入同一个词 */
function isPunctuation(char: string | undefined): boolean {
	if (!char) return false;
	const code = char.charCodeAt(0);
	return codeIsInRanges(code, [
		[0x21, 0x2f],
		[0x3a, 0x40],
		[0x5b, 0x60],
		[0x7b, 0x7e],
		[0x3000, 0x303f],
		[0xff00, 0xffef],
	]);
}

/** 词数：与前台 reading-time 插件同一口径（CJK 逐字、拉丁按词） */
export function countWords(text: string | undefined | null): number {
	if (!text) return 0;

	let words = 0;
	let start = 0;
	let end = text.length - 1;

	// 掐掉首尾空白；纯空白文本直接归零
	while (start <= end && isWordBound(text[start])) start++;
	while (end >= start && isWordBound(text[end])) end--;
	if (start > end) return 0;

	// 末尾补一个换行，让最后一段文字也能命中「后一个字符是词边界」的判定
	const normalized = `${text}\n`;

	for (let i = start; i <= end; i++) {
		// CJK 字符本身就是一个词；非边界字符后面紧跟边界或 CJK，说明一个词结束了
		if (
			isCJK(normalized[i]) ||
			(!isWordBound(normalized[i]) &&
				(isWordBound(normalized[i + 1]) || isCJK(normalized[i + 1])))
		) {
			words++;
		}
		// CJK 后面跟着的标点 / 空白一并吞掉，避免重复计数
		if (isCJK(normalized[i])) {
			while (
				i <= end &&
				(isPunctuation(normalized[i + 1]) || isWordBound(normalized[i + 1]))
			) {
				i++;
			}
		}
	}

	return words;
}

export function readingMinutes(words: number): number {
	if (!Number.isFinite(words) || words <= 0) return 0;
	return Math.max(1, Math.round(words / 200));
}

/** 从整篇 markdown（含 frontmatter）里剥掉元数据后计数 */
export function stripFrontmatter(raw: string): string {
	if (!raw.startsWith("---")) return raw;
	const end = raw.indexOf("\n---", 3);
	if (end === -1) return raw;
	// 结束标记那一行后面的换行也一起吃掉，返回值从正文第一行开始
	return raw.slice(end + 4).replace(/^\r?\n/, "");
}
