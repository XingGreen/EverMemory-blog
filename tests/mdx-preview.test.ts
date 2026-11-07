import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/utils/markdown-renderer";
import { renderMdxFallback } from "@/utils/mdx-fallback";

/**
 * MDX 降级通道（remark-mdx + remarkMdxFlatten）的端到端回归。
 *
 * 曾经的故障：后台预览走纯 remark 管线，`.mdx` 里的 `import` 变成正文段落，
 * 自闭合 `<Icon />` 被当未闭合 HTML 标签，把后续正文全部吞进该元素。
 * 这里直接渲染仓库里的示例文章，锁住「不吞内容 + 组件降级为占位」两件事。
 *
 * 主通道（evaluate 运行时）的行为在 mdx-runtime.test.ts 里验证。
 */

const MDX_FILE = "src/content/posts/mdx-example.mdx";

function mdxBody(): string {
	const raw = readFileSync(MDX_FILE, "utf8");
	return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

describe("MDX 降级通道", () => {
	it("不把 import/export 当正文，且组件降级为占位而不是吞掉后续内容", async () => {
		const html = await renderMdxFallback(mdxBody());

		/* import 语句会以代码示例形式出现，但绝不能作为正文段落（<p>import …）出现 */
		expect(html).not.toContain("<p>import ");

		/* 组件降级：可见占位 + 组件名 */
		expect(html).toContain('data-mdx-component="Icon"');
		expect(html).toContain('class="mdx-component-tag"');

		/* 关键回归点：组件之后的正文仍然各自成节，说明没有被吞进 <icon> 里 */
		expect(html).toContain("使用 JSX");
		expect(html).toContain("简单的变量导出");
		expect(html).toContain("这是一个自定义样式的 div 块");

		/* 表达式不求值，降级成占位标记，源码只进 title。
		   注意：插件输出的是单引号属性，经 rehype-raw 与 hast 序列化后会统一成双引号 */
		expect(html).toContain('class="mdx-expression"');
		expect(html).toContain('title="{year}"');
	}, 60000);

	it("MD 通道不受 MDX 语法影响（双通道互不干扰的回归点）", async () => {
		const html = await renderMarkdown(
			"## 标题\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n<!-- 注释 -->\n\n普通 < b 段落。",
		);
		expect(html).toContain("<h2");
		/* gfm 表格由 markdown-remark 默认启用 */
		expect(html).toContain("<table");
		/* HTML 注释、裸 `<` 在 MD 通道里是合法内容 */
		expect(html).toContain("普通");
	}, 60000);

	it("整篇 JSX 的页面不把 JS 源码当正文铺开", async () => {
		const raw = readFileSync("src/content/posts/friends.mdx", "utf8");
		const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
		const html = await renderMdxFallback(body);

		/* export 块与注释都不该出现在成稿里 */
		expect(html).not.toContain("export const site");
		expect(html).not.toContain("左栏：本站信息");

		/* 受限求值：纯字面量常量 + 成员访问渲染出真值 */
		expect(html).toContain("夏夜流萤");
		expect(html).toContain("飞萤之火自无梦的长夜亮起");
		expect(html).toContain("hengruoyi@qq.com");
		/* 表达式属性也求值：头像 img 拿到真实地址 */
		expect(html).toContain('src="https://weavatar.com');

		/* 标签骨架仍然渲染：硬编码的标题文字必须还在 */
		expect(html).toContain("申请友链");
		expect(html).toContain("等待审核");
		expect(html).toContain("注意事项");

		/* 函数调用（.map）不可求值，仍是占位 */
		expect(html).toContain("mdx-expression");
		expect(html).not.toContain("navigator.clipboard.writeText");
		/* 对象字面量、map 回调等源码只允许出现在 title 属性里，绝不能成为可见文本 */
		expect(html).not.toContain(">{[ { label:");
		expect(html).not.toContain(">notes.map((item)");
	}, 60000);

	it("受限求值的安全边界", async () => {
		const mdx = [
			'export const site = { name: "测试站", nested: { deep: "值" } };',
			"export const n = 42;",
			"export const flag = true;",
			"export const neg = -7;",
			"export const tpl = `共 ${n} 篇`;",
			'export const fn = () => "危险";',
			"",
			"{site.name}|{site.nested.deep}|{n}|{flag}|{neg}|{tpl}",
			"",
			"{site.missing}|{fn()}|{globalThis}|{site.name.constructor}",
			"",
			"{ n + 1 }",
		].join("\n");

		const html = await renderMdxFallback(mdx);

		/* 可求值：成员访问（含嵌套）、数字、布尔、负数、模板串 */
		expect(html).toContain("测试站");
		expect(html).toContain("值");
		expect(html).toContain("42");
		expect(html).toContain("true");
		expect(html).toContain("-7");
		expect(html).toContain("共 42 篇");

		/* 不可求值：缺失属性、函数调用、全局对象、原型链逃逸、算术——一律占位 */
		const placeholders = html.match(/mdx-expression/g) ?? [];
		/* site.missing / fn() / globalThis / constructor / n+1 共 5 处 */
		expect(placeholders.length).toBe(5);
		expect(html).not.toContain("危险");
		expect(html).not.toContain("[object Object]");
	}, 60000);
});
