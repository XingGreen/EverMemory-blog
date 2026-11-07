import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/utils/markdown-renderer";

/**
 * MDX 预览的端到端回归。
 *
 * 曾经的故障：后台预览走纯 remark 管线，`.mdx` 里的 `import` 变成正文段落，
 * 自闭合 `<Icon />` 被当未闭合 HTML 标签，把后续正文全部吞进该元素。
 * 这里直接渲染仓库里的示例文章，锁住「不吞内容 + 组件降级为占位」两件事。
 *
 * 只跑 .mdx 分支：普通 .md 的行为由前台构建覆盖，不在这里重复。
 */

const MDX_FILE = "src/content/posts/mdx-example.mdx";

function mdxBody(): string {
	const raw = readFileSync(MDX_FILE, "utf8");
	return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

describe("MDX 预览渲染", () => {
	it("不把 import/export 当正文，且组件降级为占位而不是吞掉后续内容", async () => {
		const html = await renderMarkdown(mdxBody(), { mdx: true });

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

	it("普通 Markdown 不启用 MDX 解析时保持原行为", async () => {
		const html = await renderMarkdown("## 标题\n\n普通段落。");
		expect(html).toContain("<h2");
		expect(html).toContain("普通段落");
	}, 60000);

	it("整篇 JSX 的页面不把 JS 源码当正文铺开", async () => {
		const raw = readFileSync("src/content/posts/friends.mdx", "utf8");
		const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
		const html = await renderMarkdown(body, { mdx: true });

		/* export 块与注释都不该出现在成稿里 */
		expect(html).not.toContain("export const site");
		expect(html).not.toContain("左栏：本站信息");

		/* 标签骨架仍然渲染：硬编码的标题文字必须还在 */
		expect(html).toContain("申请友链");
		expect(html).toContain("等待审核");
		expect(html).toContain("注意事项");

		/* 动态部分退化成占位标记，而不是几百行 JS */
		expect(html).toContain("mdx-expression");
		expect(html).not.toContain("navigator.clipboard.writeText");
		/* 对象字面量、map 回调等源码只允许出现在 title 属性里，绝不能成为可见文本 */
		expect(html).not.toContain(">{[ { label:");
		expect(html).not.toContain(">notes.map((item)");
	}, 60000);
});
