import { visit } from "unist-util-visit";

/**
 * 把 MDX 专有节点降级成普通 mdast，供「运行时预览管线」使用。
 *
 * 背景：后台预览走 `@astrojs/markdown-remark` 的 unified 管线，没有 MDX 编译器；
 * 而前台 MDX 是 Astro 在构建期用 `@astrojs/mdx` 编译的，运行时拿不到。
 * 直接把 .mdx 源码丢进 remark 会有两类破坏：
 *   1. `import` / `export` 变成正文段落；
 *   2. 自闭合 JSX `<Icon />` 被当成未闭合 HTML 标签，后续正文全被吞进该元素。
 *
 * 这里配合 remark-mdx（只负责解析出 mdxJsx* / mdxjsEsm 节点）做降级：
 *   - `mdxjsEsm`                → 丢弃（import/export 无法在浏览器侧求值）
 *   - `mdx*Expression`          → 还原成字面量文本 `{expr}`
 *   - JSX 片段 `<>…</>`         → 直接展开子节点
 *   - 组件（首字母大写）         → 虚线占位块，保留子内容并标出组件名
 *   - HTML 标签                  → 转回普通标签，属性做 JSX→HTML 映射
 *
 * 已知局限：组件本体不会被渲染（Astro 组件在浏览器运行时里不存在），
 * 表达式也不会求值——预览只负责「结构与正文正确」。
 */

const COMPONENT_NAME = /^[A-Z]/;
const EVENT_HANDLER = /^on[A-Z]/;
const ATTRIBUTE_NAME = /^[A-Za-z_:][-A-Za-z0-9_:.]*$/;

/** JSX 驼峰属性 → HTML 属性名（只列常用的，其余原样输出） */
const HTML_ATTRIBUTE_ALIASES = {
	className: "class",
	htmlFor: "for",
	tabIndex: "tabindex",
	readOnly: "readonly",
	maxLength: "maxlength",
	colSpan: "colspan",
	rowSpan: "rowspan",
	autoComplete: "autocomplete",
	autoFocus: "autofocus",
	srcSet: "srcset",
	crossOrigin: "crossorigin",
	contentEditable: "contenteditable",
};

const TEXT_ESCAPES = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
};

function escapeText(value) {
	return String(value).replace(/[&<>]/g, (char) => TEXT_ESCAPES[char]);
}

function escapeAttribute(value) {
	return String(value).replace(/[&<>"]/g, (char) =>
		char === '"' ? "&quot;" : TEXT_ESCAPES[char],
	);
}

/**
 * 序列化 JSX 属性。
 * 表达式属性（`className={x}`）与展开属性（`{...props}`）在预览里没有值可输出，
 * 直接跳过——保留一个空属性反而会让浏览器当成合法空值，观感更差。
 */
function serializeAttributes(attributes) {
	const parts = [];
	for (const attribute of attributes ?? []) {
		if (attribute.type !== "mdxJsxAttribute") continue;
		if (EVENT_HANDLER.test(attribute.name)) continue;
		const name = HTML_ATTRIBUTE_ALIASES[attribute.name] ?? attribute.name;
		if (!ATTRIBUTE_NAME.test(name)) continue;
		if (attribute.value === null || attribute.value === undefined) {
			parts.push(name);
			continue;
		}
		if (typeof attribute.value !== "string") continue;
		parts.push(`${name}="${escapeAttribute(attribute.value)}"`);
	}
	return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

function html(value) {
	return { type: "html", value };
}

function flattenJsxElement(node, isFlow) {
	const children = node.children ?? [];

	// 片段 <>…</>：没有包裹语义，直接展开
	if (!node.name) return children;

	// 组件：运行时不存在对应实现，用占位块标出名字，子内容照常渲染
	if (COMPONENT_NAME.test(node.name)) {
		const tag = isFlow ? "div" : "span";
		const name = escapeAttribute(node.name);
		return [
			html(
				`<${tag} class="mdx-component" data-mdx-component="${name}"><span class="mdx-component-tag">&lt;${escapeText(node.name)}&gt;</span>`,
			),
			...children,
			html(`</${tag}>`),
		];
	}

	// 普通 HTML 标签：还原标签，只做属性名映射
	return [
		html(`<${node.name}${serializeAttributes(node.attributes)}>`),
		...children,
		html(`</${node.name}>`),
	];
}

export function remarkMdxFlatten() {
	return (tree) => {
		visit(tree, (node, index, parent) => {
			if (!parent || index === undefined || index === null) return;

			if (node.type === "mdxjsEsm") {
				parent.children.splice(index, 1);
				return index;
			}

			if (
				node.type === "mdxFlowExpression" ||
				node.type === "mdxTextExpression"
			) {
				parent.children.splice(index, 1, {
					type: "text",
					value: `{${node.value}}`,
				});
				return index + 1;
			}

			if (
				node.type === "mdxJsxFlowElement" ||
				node.type === "mdxJsxTextElement"
			) {
				const replacement = flattenJsxElement(
					node,
					node.type === "mdxJsxFlowElement",
				);
				parent.children.splice(index, 1, ...replacement);
				return index + 1;
			}
		});
	};
}
