import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderMdxRuntime } from "@/utils/mdx-runtime";

/**
 * MDX 运行时渲染（@mdx-js/mdx evaluate + Preact）的端到端回归。
 *
 * 与 mdx-preview.test.ts（降级管线）的分工：这里验证 evaluate 路径——
 * `.map()` 列表、模板串、表达式属性全部真实渲染；import 的 Astro 组件
 * 映射为 .mdx-component 占位。preview API 走「runtime 失败 → 降级」两段式。
 */

function mdxBody(rel: string): string {
	return readFileSync(rel, "utf8").replace(
		/^---\r?\n[\s\S]*?\r?\n---\r?\n?/,
		"",
	);
}

describe("MDX 运行时渲染", () => {
	it("friends.mdx：.map 列表与全部动态内容真实渲染", async () => {
		const html = await renderMdxRuntime(
			mdxBody("src/content/posts/friends.mdx"),
		);

		/* notes.map(...) 渲染出全部 4 条注意事项——降级管线永远做不到的部分 */
		expect(html).toContain("互换原则");
		expect(html).toContain("链接维护");
		expect(html).toContain("内容要求");
		expect(html).toContain("站点要求");

		/* 受限求值已覆盖的部分在 runtime 下同样成立 */
		expect(html).toContain("夏夜流萤");
		expect(html).toContain("hengruoyi@qq.com");
		expect(html).toContain('src="https://weavatar.com');

		/* friends.mdx 没有自定义组件，不该出现占位 */
		expect(html).not.toContain("mdx-component");
	}, 60000);

	it("mdx-example.mdx：import 组件映射为占位，代码块内 import 不被误删", async () => {
		const html = await renderMdxRuntime(
			mdxBody("src/content/posts/mdx-example.mdx"),
		);

		/* import 的 Icon（astro-icon，Preact 世界不存在）→ 占位块 */
		expect(html).toContain('data-mdx-component="Icon"');
		/* 占位块之后的正文照常渲染 */
		expect(html).toContain("火箭发射");
		expect(html).toContain("使用 JSX");
		expect(html).toContain("今年是");

		/* 代码块里的 import 示例是正文，绝不能被剥离逻辑删掉 */
		expect(html).toContain("import { Icon }");
	}, 60000);

	it("编译失败的半成品抛出异常（由 preview API 降级兜底）", async () => {
		await expect(
			renderMdxRuntime("export const broken = {\n\n<div"),
		).rejects.toThrow();
	}, 60000);

	it("stripImports 不吞围栏内的 import 示例", async () => {
		const mdx = [
			"import { Icon } from 'astro-icon/components'",
			"",
			"```md",
			"import { Fake } from 'somewhere'",
			"```",
			"",
			"<Icon />",
		].join("\n");
		const html = await renderMdxRuntime(mdx);
		/* 围栏内的 Fake 示例还在；围栏外的 Icon 被替换为占位 */
		expect(html).toContain("import { Fake } from 'somewhere'");
		expect(html).toContain('data-mdx-component="Icon"');
	}, 60000);
});
