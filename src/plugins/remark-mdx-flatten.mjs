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
/** 事件属性一律不输出：预览 HTML 会被 {@html} 注入后台页面，onclick 是真会执行的。
    JSX 里写 onClick，但小写 onclick 同样合法，所以大小写都不放过。 */
const EVENT_HANDLER = /^on/i;
const ATTRIBUTE_NAME = /^[A-Za-z_:][-A-Za-z0-9_:.]*$/;
/** MDX 注释：{/* … *\/} */
const EXPRESSION_COMMENT = /^\s*\/\*[\s\S]*\*\/\s*$/;

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

/** 单引号属性值：源码里的双引号可以原样保留，读起来不至于满是 &quot; */
function escapeSingleQuoted(value) {
	return String(value).replace(/[&<>']/g, (char) => {
		if (char === "'") return "&#39;";
		return TEXT_ESCAPES[char];
	});
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

const PHRASING_PARENT = new Set([
	"paragraph",
	"heading",
	"emphasis",
	"strong",
	"link",
	"linkReference",
	"tableCell",
	"delete",
	"mdxJsxTextElement",
]);

/** 这些 JSX 标签内部只放行内内容，块级占位塞进去会把标题/段落拆坏 */
const PHRASING_TAGS = new Set([
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"p",
	"span",
	"a",
	"strong",
	"em",
	"b",
	"i",
	"small",
	"code",
	"label",
	"button",
	"td",
	"th",
	"figcaption",
]);

function isPhrasingParent(parent) {
	if (!parent) return false;
	if (PHRASING_PARENT.has(parent.type)) return true;
	/* JSX 元素被降级前，子节点看到的 parent 仍是原始 mdxJsxFlowElement，
	   只能靠标签名判断它是不是行内容器 */
	if (
		parent.type === "mdxJsxFlowElement" ||
		parent.type === "mdxJsxTextElement"
	) {
		return PHRASING_TAGS.has(String(parent.name ?? "").toLowerCase());
	}
	return false;
}

/**
 * 表达式占位。MDX 里 `{…}` 独占一行时会被解析成 block 级节点，
 * 但它的父节点可能仍是 heading / h3 / p——在这种上下文里塞 <div> 会把标题拆坏，
 * 所以块级判定要同时看节点类型与父节点。
 *
 * 可见文字不用源码本身：`{[ {label:"站点名称", value: site.name}, …]}` 这类长对象
 * 数组直接铺 32 字，观感就是「满屏 JS 没渲染」，比一个干净的占位更糟。
 * 固定成 `{…}`，源码全文只进 title 悬浮提示。
 */
function expressionPlaceholder(node, parent) {
	const source = String(node.value ?? "")
		.replace(/\s+/g, " ")
		.trim();
	const isBlock =
		node.type === "mdxFlowExpression" && !isPhrasingParent(parent);
	const tag = isBlock ? "div" : "span";
	const tooltip = source.length > 120 ? `${source.slice(0, 120)}…` : source;

	return {
		type: "html",
		value: `<${tag} class="mdx-expression" title='{${escapeSingleQuoted(tooltip)}}'>{…}</${tag}>`,
	};
}

/**
 * 递归降级：先处理子节点，再处理自己。
 *
 * 不用 unist-util-visit 的原因：JSX 容器的降级会把「开标签 / 子内容 / 闭标签」
 * 平铺进父级数组，visit 之后会把原 children 当成父节点的孩子来访问，
 * 于是 `<h3>{site.name}</h3>` 里的表达式看到 parent=root，被判成块级 <div>，
 * 标题被拆成三段。递归时 parent 始终是真实宿主节点，判断才成立。
 */
function transformChildren(parent) {
	if (!Array.isArray(parent.children)) return;
	const next = [];
	for (const child of parent.children) {
		next.push(...transformNode(child, parent));
	}
	parent.children = next;
}

function transformNode(node, parent) {
	if (!node || typeof node !== "object") return [node];

	if (node.type === "mdxjsEsm") return [];

	if (node.type === "mdxFlowExpression" || node.type === "mdxTextExpression") {
		/* {/* … *\/} 是 MDX 的注释语法，不该出现在成稿里 */
		if (EXPRESSION_COMMENT.test(node.value ?? "")) return [];
		return [expressionPlaceholder(node, parent)];
	}

	if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
		transformChildren(node);
		return flattenJsxElement(node, node.type === "mdxJsxFlowElement");
	}

	transformChildren(node);
	return [node];
}

export function remarkMdxFlatten() {
	return (tree) => {
		transformChildren(tree);
	};
}
