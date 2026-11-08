/**
 * 后台路径校验的回归测试。
 *
 * 覆盖两个曾可被绕过的入口：
 *   - 历史版本接口的 slug（会拼进 .revisions 路径，参与读取与 rmSync）
 *   - 同步执行的条目路径（push 方向会把读到的文件提交进公开仓库）
 */
import { describe, expect, it } from "vitest";

import { isAllowedPostPath } from "@/pages/api/admin/sync/apply";
import { isValidPostSlug } from "@/utils/github-app";

describe("isValidPostSlug", () => {
	it("接受常规文章标识", () => {
		for (const good of ["hello-world", "2024_01-post", "a", "ABC123"]) {
			expect(isValidPostSlug(good)).toBe(true);
		}
	});

	it("拒绝路径穿越、分隔符与空值", () => {
		const bad = [
			"..",
			"../..",
			"../../pages/api/admin",
			"src/content/posts",
			"a/b",
			"a\\b",
			".env",
			"",
			"  ",
			"has space",
			"中文 slug",
		];
		for (const value of bad) {
			expect(isValidPostSlug(value)).toBe(false);
		}
	});

	it("拒绝非字符串", () => {
		for (const value of [null, undefined, 42, {}, []]) {
			expect(isValidPostSlug(value)).toBe(false);
		}
	});
});

describe("isAllowedPostPath", () => {
	it("接受文章目录下的 Markdown", () => {
		const good = [
			"src/content/posts/hello.md",
			"src/content/posts/hello.mdx",
			"src/content/posts/2024/01/hello.md",
		];
		for (const value of good) {
			expect(isAllowedPostPath(value)).toBe(true);
		}
	});

	it("拒绝文章目录之外的文件", () => {
		const bad = [
			".env.local",
			"package.json",
			"src/pages/index.astro",
			"src/content/taxonomy.json",
			// 前缀相近但不是同一个目录
			"src/content/posts-evil/x.md",
			"src/content/postsx/x.md",
		];
		for (const value of bad) {
			expect(isAllowedPostPath(value)).toBe(false);
		}
	});

	it("拒绝穿越与只读目录之外的后缀", () => {
		const bad = [
			"src/content/posts/../secret.md",
			"src/content/posts/../../package.json.md",
			"src/content/posts/x.txt",
			"src/content/posts/x.md.js",
			"src/content/posts/x",
		];
		for (const value of bad) {
			expect(isAllowedPostPath(value)).toBe(false);
		}
	});

	it("拒绝绝对路径与非字符串", () => {
		const bad = [
			"/etc/passwd",
			"E:/EverMemory-blog/src/content/posts/x.md",
			"",
			null,
			undefined,
			42,
		];
		for (const value of bad) {
			expect(isAllowedPostPath(value)).toBe(false);
		}
	});
});
