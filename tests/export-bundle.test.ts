import { describe, expect, it } from "vitest";
import { extractAssetRefs, toPackagePath } from "@/utils/export-paths";

describe("extractAssetRefs", () => {
	it("抽取 Markdown 图片与链接", () => {
		const refs = extractAssetRefs(`
![封面](images/cover.avif)
[下载](files/doc.pdf)
`);
		expect(refs).toContain("images/cover.avif");
		expect(refs).toContain("files/doc.pdf");
	});

	it("抽取 HTML 的 src 与 href", () => {
		const refs = extractAssetRefs(`
<img src="/assets/x.png" />
<a href="/files/y.webp">y</a>
`);
		expect(refs).toContain("/assets/x.png");
		expect(refs).toContain("/files/y.webp");
	});

	it("跳过外链、锚点与 data URI", () => {
		const refs = extractAssetRefs(`
![远程](https://example.com/a.png)
[锚点](#section)
![内联](data:image/png;base64,AAAA)
[协议](//cdn.example.com/b.png)
[邮件](mailto:a@b.com)
`);
		expect(refs).toEqual([]);
	});

	it("只保留已知资源扩展名", () => {
		const refs = extractAssetRefs(`
[文档](readme.md)
[页面](other.html)
![图](photo.jpg)
`);
		expect(refs).toContain("photo.jpg");
		expect(refs).not.toContain("readme.md");
		expect(refs).not.toContain("other.html");
	});

	it("带查询串的引用仍能识别扩展名", () => {
		const refs = extractAssetRefs("![x](images/a.png?raw=1)");
		expect(refs).toContain("images/a.png?raw=1");
	});

	it("同一资源多次引用只出现一次", () => {
		const refs = extractAssetRefs(`
![a](images/same.png)
![b](images/same.png)
`);
		expect(refs.filter((r) => r === "images/same.png")).toHaveLength(1);
	});

	it("空内容返回空数组", () => {
		expect(extractAssetRefs("")).toEqual([]);
	});
});

describe("toPackagePath", () => {
	it("src/content 下的资源去掉前缀放到 assets/", () => {
		expect(toPackagePath("src/content/posts/images/a.avif")).toBe(
			"assets/posts/images/a.avif",
		);
	});

	it("public 下的资源放到 assets/public/", () => {
		expect(toPackagePath("public/assets/x.png")).toBe("assets/public/assets/x.png");
	});
});
