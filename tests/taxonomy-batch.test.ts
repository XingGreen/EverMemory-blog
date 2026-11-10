import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 批量改写是「远端一次提交」还是「逐篇提交」，直接决定改一个分类名
 * 会触发 1 次还是 N 次自动构建。这里用假的存储提供者盯住提交次数，
 * 而不是断言实现细节。
 */
let writable = false;
let resolveAll = true;
let commitOk = true;

const committed: Array<{ path: string; content: string | null }[]> = [];

vi.mock("@utils/secret-io", async (importOriginal) => ({
	...(await importOriginal<typeof import("@utils/secret-io")>()),
	isEnvFileWritable: () => writable,
}));

vi.mock("@utils/providers/registry", () => ({
	getStorageProvider: () => ({
		isConfigured: () => true,
		resolvePath: async (slug: string) =>
			resolveAll || slug !== "missing" ? `src/content/posts/${slug}.mdx` : null,
		commitFiles: async (files: Array<{ path: string; content: string | null }>) => {
			committed.push(files);
			return commitOk ? { ok: true, commitOid: "fake" } : { ok: false };
		},
		writeFile: async () => true,
	}),
}));

const { writePostFiles } = await import("@utils/taxonomy");

const items = [
	{ slug: "a", content: "A" },
	{ slug: "b", content: "B" },
];

describe("writePostFiles / 远端", () => {
	afterEach(() => {
		committed.length = 0;
		writable = false;
		resolveAll = true;
		commitOk = true;
	});

	it("多篇只产生一次提交", async () => {
		const result = await writePostFiles(items, "rename category");

		expect(result).toEqual({ updated: 2, failed: [] });
		expect(committed).toHaveLength(1);
		expect(committed[0].map((f) => f.path)).toEqual([
			"src/content/posts/a.mdx",
			"src/content/posts/b.mdx",
		]);
	});

	it("按 resolvePath 的真实扩展名提交，不硬编码 .md", async () => {
		await writePostFiles([{ slug: "mdx-post", content: "x" }], "msg");

		// 返回 .md 会让 mdx 文章写成同名 .md 副本
		expect(committed[0][0].path).toBe("src/content/posts/mdx-post.mdx");
	});

	it("路径解析失败的条目进 failed，其余继续提交", async () => {
		resolveAll = false;

		const result = await writePostFiles(
			[{ slug: "missing", content: "x" }, { slug: "ok", content: "y" }],
			"msg",
		);

		expect(result.failed).toEqual(["missing"]);
		expect(result.updated).toBe(1);
		expect(committed[0]).toHaveLength(1);
	});

	it("提交失败时整批算失败，不做部分成功判定", async () => {
		commitOk = false;

		const result = await writePostFiles(items, "msg");

		expect(result.updated).toBe(0);
		expect(result.failed).toEqual(["a", "b"]);
	});

	it("全部路径都无法解析时不发起空提交", async () => {
		resolveAll = false;

		const result = await writePostFiles([{ slug: "missing", content: "x" }], "msg");

		expect(result.updated).toBe(0);
		expect(committed).toHaveLength(0);
	});

	it("空列表直接返回，不发请求", async () => {
		const result = await writePostFiles([], "msg");

		expect(result).toEqual({ updated: 0, failed: [] });
		expect(committed).toHaveLength(0);
	});
});
