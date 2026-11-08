import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import getReadingTime from "reading-time";
import { describe, expect, it } from "vitest";
import { countWords, readingMinutes, stripFrontmatter } from "@utils/reading-stats";

/** 后台字数与前台插件必须同源同口径：前台用 reading-time 在构建期算，后台现算 */
describe("reading-stats 词数口径", () => {
	it("与前台 reading-time 插件结果一致（全部文章原文）", () => {
		const dir = join(process.cwd(), "src/content/posts");
		const files = readdirSync(dir).filter(
			(file) => file.endsWith(".md") || file.endsWith(".mdx"),
		);
		expect(files.length).toBeGreaterThan(0);
		for (const file of files) {
			const raw = readFileSync(join(dir, file), "utf8");
			expect(countWords(raw), file).toBe(getReadingTime(raw).words);
		}
	});

	it("边界输入：空白、标点、中英混排", () => {
		const samples = [
			"",
			"   ",
			"\n\n\t",
			"hello world",
			"中文测试，标点。",
			"Hello 世界 123",
			"日本語のテスト",
			"한국어 테스트",
		];
		for (const sample of samples) {
			expect(countWords(sample), JSON.stringify(sample)).toBe(
				getReadingTime(sample).words,
			);
		}
	});

	it("分钟数按 200 词/分钟取整，最少 1 分钟", () => {
		expect(readingMinutes(0)).toBe(0);
		expect(readingMinutes(1)).toBe(1);
		expect(readingMinutes(100)).toBe(1);
		expect(readingMinutes(300)).toBe(2);
	});
});

describe("stripFrontmatter", () => {
	it("剥掉开头的 frontmatter，保留正文", () => {
		const raw = "---\ntitle: a\n---\n正文\n";
		expect(stripFrontmatter(raw)).toBe("正文\n");
	});

	it("没有 frontmatter 时原样返回", () => {
		expect(stripFrontmatter("正文")).toBe("正文");
	});
});
