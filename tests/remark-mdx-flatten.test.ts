import { describe, expect, it } from "vitest";
import { remarkMdxFlatten } from "@/plugins/remark-mdx-flatten.mjs";

/**
 * remarkMdxFlatten 把 MDX 专有节点降级成标准 mdast。
 *
 * 这里手工构造最小 mdast（而不是走 remark-mdx 解析），原因是被测逻辑只依赖节点形状；
 * 解析那一半由 remark-mdx 负责，属于第三方行为，不该在这里再测一遍。
 */

/** 手工构造的最小 mdast 节点：只声明本测试用到的字段 */
interface Node {
	type: string;
	value?: string;
	name?: string | null;
	attributes?: unknown[];
	children?: Node[];
}

function flatten(tree: Node): Node {
	const transformer = remarkMdxFlatten();
	transformer(tree);
	return tree;
}

function children(tree: Node): Node[] {
	return tree.children ?? [];
}

describe("remarkMdxFlatten", () => {
	it("丢弃 import/export 语句，其余节点保持原位", () => {
		const tree = {
			type: "root",
			children: [
				{
					type: "mdxjsEsm",
					value: "import { Icon } from 'astro-icon/components'",
				},
				{ type: "paragraph", children: [{ type: "text", value: "正文" }] },
				{ type: "mdxjsEsm", value: "export const year = 2024" },
			],
		};

		flatten(tree);

		expect(children(tree)).toHaveLength(1);
		expect(children(tree)[0].type).toBe("paragraph");
	});

	it("把表达式降级成占位标记，源码进 title", () => {
		const tree = {
			type: "root",
			children: [
				{
					type: "paragraph",
					children: [
						{ type: "text", value: "今年是 " },
						{ type: "mdxTextExpression", value: "year" },
						{ type: "text", value: " 年。" },
					],
				},
			],
		};

		flatten(tree);

		const inline = children(tree)[0].children ?? [];
		expect(inline[1].type).toBe("html");
		expect(inline[1].value).toContain('class="mdx-expression"');
		expect(inline[1].value).toContain("title='{year}'");
		/* 占位里给出可读的源码片段，而不是一个看不出所以然的省略号 */
		expect(inline[1].value).toContain(">{year}<");
	});

	it("MDX 注释表达式 {/* … */} 直接丢弃", () => {
		const tree = {
			type: "root",
			children: [
				{ type: "mdxFlowExpression", value: "/* 左栏：本站信息 */" },
				{ type: "paragraph", children: [{ type: "text", value: "正文" }] },
			],
		};

		flatten(tree);

		expect(children(tree)).toHaveLength(1);
		expect(children(tree)[0].type).toBe("paragraph");
	});

	it("块级表达式用 div，行内表达式用 span", () => {
		const tree = {
			type: "root",
			children: [
				{ type: "mdxFlowExpression", value: "items.map((i) => i.name)" },
				{
					type: "heading",
					depth: 2,
					children: [{ type: "mdxFlowExpression", value: "site.name" }],
				},
			],
		};

		flatten(tree);

		/* 父节点是 root → 块级 */
		expect((children(tree)[0].value as string).startsWith("<div")).toBe(true);
		/* 父节点是 heading → 必须是行内，否则标题会被拆成两个块 */
		const heading = children(tree)[1];
		const inlineHtml = (heading.children ?? [])[0]?.value as string;
		expect(inlineHtml.startsWith("<span")).toBe(true);
	});

	it("流式组件降级成 div 占位块，子内容保留", () => {
		const tree = {
			type: "root",
			children: [
				{
					type: "mdxJsxFlowElement",
					name: "Icon",
					attributes: [
						{ type: "mdxJsxAttribute", name: "name", value: "rocket" },
					],
					children: [{ type: "text", value: "x" }],
				},
			],
		};

		flatten(tree);

		const out = children(tree);
		expect(out).toHaveLength(3);
		expect(out[0].type).toBe("html");
		expect(out[0].value).toContain('class="mdx-component"');
		expect(out[0].value).toContain('data-mdx-component="Icon"');
		expect(out[0].value).toContain("&lt;Icon&gt;");
		/* 组件属性不会出现在占位块上：Icon 不是 HTML 元素，属性没有承载对象 */
		expect(out[0].value).not.toContain("rocket");
		expect(out[1]).toEqual({ type: "text", value: "x" });
		expect(out[2]).toEqual({ type: "html", value: "</div>" });
	});

	it("行内组件降级成 span 占位", () => {
		const tree = {
			type: "root",
			children: [
				{
					type: "paragraph",
					children: [
						{ type: "text", value: "看这里 " },
						{
							type: "mdxJsxTextElement",
							name: "Badge",
							attributes: [],
							children: [],
						},
					],
				},
			],
		};

		flatten(tree);

		const inline = children(tree)[0].children as Node[];
		expect(inline[1].type).toBe("html");
		expect(inline[1].value).toContain("<span");
		expect(inline[2]).toEqual({ type: "html", value: "</span>" });
	});

	it("HTML 标签转回普通标签，并做 JSX→HTML 属性映射", () => {
		const tree = {
			type: "root",
			children: [
				{
					type: "mdxJsxFlowElement",
					name: "div",
					attributes: [
						{ type: "mdxJsxAttribute", name: "className", value: "a b" },
						{ type: "mdxJsxAttribute", name: "onClick", value: "fn" },
						{ type: "mdxJsxAttribute", name: "onclick", value: "alert(1)" },
						{
							type: "mdxJsxAttribute",
							name: "style",
							value: { type: "mdxJsxAttributeValueExpression", value: "{}" },
						},
						{ type: "mdxJsxAttribute", name: "hidden", value: null },
						{ type: "mdxJsxExpressionAttribute", value: "...props" },
					],
					children: [{ type: "text", value: "内容" }],
				},
			],
		};

		flatten(tree);

		const open = children(tree)[0].value as string;
		expect(open).toBe('<div class="a b" hidden>');
		/* 事件处理器与表达式属性一律不输出，避免把无效属性丢给浏览器 */
		expect(open).not.toContain("onClick");
		expect(open).not.toContain("alert(1)");
		expect(open).not.toContain("style");
	});

	it("JSX 容器里的表达式按标签名决定块级/行内", () => {
		const tree = {
			type: "root",
			children: [
				{
					type: "mdxJsxFlowElement",
					name: "h3",
					attributes: [],
					children: [{ type: "mdxFlowExpression", value: "site.name" }],
				},
				{
					type: "mdxJsxFlowElement",
					name: "div",
					attributes: [],
					children: [
						{ type: "mdxFlowExpression", value: "notes.map((n) => n.title)" },
					],
				},
			],
		};

		flatten(tree);

		const flat = JSON.stringify(tree);
		/* h3 内必须是 span，div 内可以是 div */
		expect(flat).toContain('<span class=\\"mdx-expression\\"');
		expect(flat).toContain('<div class=\\"mdx-expression\\"');
	});

	it("片段 <>…</> 直接展开子节点", () => {
		const tree = {
			type: "root",
			children: [
				{
					type: "mdxJsxFlowElement",
					name: null,
					attributes: [],
					children: [
						{
							type: "paragraph",
							children: [{ type: "text", value: "片段内" }],
						},
					],
				},
			],
		};

		flatten(tree);

		expect(children(tree)).toHaveLength(1);
		expect(children(tree)[0].type).toBe("paragraph");
	});

	it("嵌套组件会被逐层降级", () => {
		const tree = {
			type: "root",
			children: [
				{
					type: "mdxJsxFlowElement",
					name: "Card",
					attributes: [],
					children: [
						{
							type: "mdxJsxTextElement",
							name: "Icon",
							attributes: [],
							children: [],
						},
					],
				},
			],
		};

		flatten(tree);

		const flat = JSON.stringify(tree);
		expect(flat).not.toContain('"mdxJsxTextElement"');
		/* 两个占位块各带一个 data-mdx-component（JSON 里引号被转义，只数属性名） */
		expect(flat.match(/data-mdx-component/g) ?? []).toHaveLength(2);
	});
});
