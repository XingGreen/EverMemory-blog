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
 *   - `mdxjsEsm`                → 语句丢弃，但 const 纯字面量声明进常量表
 *   - `mdx*Expression`          → 先试受限求值（常量 + 成员访问），求不出转 {…} 占位
 *   - JSX 片段 `<>…</>`         → 直接展开子节点
 *   - 组件（首字母大写）         → 虚线占位块，保留子内容并标出组件名
 *   - HTML 标签                  → 转回普通标签，属性做 JSX→HTML 映射
 *
 * 已知局限：组件本体不会被渲染（Astro 组件在浏览器运行时里不存在），
 * 含函数调用的表达式（`notes.map(...)`）不会求值——预览只负责「结构与正文正确」。
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
 * 字符串属性直接输出；表达式属性（`src={site.avatar}`）尝试受限求值，
 * 求不出就跳过——保留空属性反而会让浏览器当成合法空值，观感更差。
 */
function serializeAttributes(attributes, scope) {
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
		if (typeof attribute.value === "string") {
			parts.push(`${name}="${escapeAttribute(attribute.value)}"`);
			continue;
		}
		if (attribute.value.type === "mdxJsxAttributeValueExpression") {
			const program = attribute.value.data?.estree;
			const statement =
				program?.type === "Program" && program.body.length === 1
					? program.body[0]
					: undefined;
			if (statement?.type === "ExpressionStatement") {
				const value = evalExpression(statement.expression, scope, 0);
				if (isPlainValue(value)) {
					parts.push(`${name}="${escapeAttribute(String(value))}"`);
				}
			}
		}
	}
	return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

function html(value) {
	return { type: "html", value };
}

function flattenJsxElement(node, isFlow, scope) {
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
		html(`<${node.name}${serializeAttributes(node.attributes, scope)}>`),
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
 * 受限求值：让 `{site.name}` 这类「纯字面量常量 + 成员访问」在预览里渲染出真值。
 *
 * 立场是「解释 AST」，绝不 eval / new Function——即使文章被注入恶意代码，
 * 求值器只会因为遇到不支持的语法而返回 undefined（占位），不存在代码执行。
 *
 * 支持的语法（超出即占位）：
 *   声明：`export const x = <字面量>`（字面量 = 字符串/数字/布尔/null、
 *         数组、对象、无插值或插值可求值的模板串、±数字、引用已声明常量）
 *   表达式：常量标识符、成员访问（`site.name`，只认自有属性，非计算）、
 *           字面量、模板串
 * 显式不支持：函数调用（`f()`、`notes.map(...)`）、`new`、计算属性 `a[b]`、
 *             `let/var`（有再赋值语义）、原型链取值（自有属性之外一律拒绝）
 */

const EVAL_DEPTH_MAX = 24;
/** 超长表达式直接占位：求值收益低，还能防大 AST 拖慢预览 */
const EVAL_SOURCE_MAX = 2000;

function isPlainValue(value) {
	return (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	);
}

function evalLiteral(node, scope, depth) {
	if (!node || typeof node !== "object" || depth > EVAL_DEPTH_MAX) return;

	switch (node.type) {
		case "Literal": {
			/* regex / bigint 字面量不是普通 JSON 值，排除 */
			if (node.regex || node.bigint !== undefined) return;
			return node.value;
		}
		case "TemplateLiteral": {
			/* 插值若也能受限求值就拼接，否则整体放弃 */
			const parts = [];
			for (let i = 0; i < node.quasis.length; i++) {
				parts.push(node.quasis[i].value.cooked ?? "");
				if (i < node.expressions.length) {
					const value = evalExpression(node.expressions[i], scope, depth + 1);
					if (value === undefined) return;
					parts.push(String(value));
				}
			}
			return parts.join("");
		}
		case "ObjectExpression": {
			const object = {};
			for (const property of node.properties) {
				if (property.type !== "Property" || property.computed) return;
				const key =
					property.key.type === "Identifier"
						? property.key.name
						: property.key.type === "Literal"
							? String(property.key.value)
							: undefined;
				if (key === undefined) return;
				const value = evalLiteral(property.value, scope, depth + 1);
				if (value === undefined) return;
				object[key] = value;
			}
			return object;
		}
		case "ArrayExpression": {
			const array = [];
			for (const element of node.elements) {
				if (!element) return; /* 稀疏数组 [1, , 2] 不支持 */
				const value = evalLiteral(element, scope, depth + 1);
				if (value === undefined) return;
				array.push(value);
			}
			return array;
		}
		case "UnaryExpression": {
			if (node.operator !== "-" && node.operator !== "+") return;
			const value = evalLiteral(node.argument, scope, depth + 1);
			if (typeof value !== "number") return;
			return node.operator === "-" ? -value : value;
		}
		case "Identifier": {
			if (scope && Object.hasOwn(scope, node.name)) return scope[node.name];
			return;
		}
		default:
			return;
	}
}

function evalExpression(node, scope, depth) {
	if (!node || typeof node !== "object" || depth > EVAL_DEPTH_MAX) return;

	switch (node.type) {
		case "Identifier":
		case "Literal":
		case "TemplateLiteral":
		case "UnaryExpression":
			return evalLiteral(node, scope, depth);
		case "MemberExpression": {
			/* a[b] 计算属性不支持；只认自有属性，堵死 constructor / __proto__ 链。
			   中间层允许返回对象/数组（嵌套访问 site.nested.deep 要靠它），
			   最终值是否可入正文由调用方过滤。 */
			if (node.computed) return;
			const object = evalExpression(node.object, scope, depth + 1);
			if (object === undefined || object === null || typeof object !== "object")
				return;
			const key =
				node.property.type === "Identifier"
					? node.property.name
					: node.property.type === "Literal"
						? String(node.property.value)
						: undefined;
			if (key === undefined || !Object.hasOwn(object, key)) return;
			return object[key];
		}
		default:
			return;
	}
}

/** 从 `export const x = …` 声明里收集常量。求不出的（含函数）不进表。 */
function collectConstants(node, scope) {
	const program = node.data?.estree;
	if (program?.type !== "Program") return;
	for (const statement of program.body) {
		const declaration =
			statement.type === "ExportNamedDeclaration"
				? statement.declaration
				: statement.type === "VariableDeclaration"
					? statement
					: undefined;
		if (declaration?.type !== "VariableDeclaration") continue;
		if (declaration.kind !== "const") continue;
		for (const declarator of declaration.declarations) {
			if (declarator.id.type !== "Identifier" || !declarator.init) continue;
			const value = evalLiteral(declarator.init, scope, 0);
			if (value !== undefined) scope[declarator.id.name] = value;
		}
	}
}

/**
 * 表达式节点：先试受限求值，求出普通值就渲染为真文本；
 * 求不出（含函数调用、JSX）退回 {…} 占位。
 */
function expressionReplacement(node, parent, scope) {
	const source = String(node.value ?? "").trim();
	const isBlock =
		node.type === "mdxFlowExpression" && !isPhrasingParent(parent);
	const tag = isBlock ? "div" : "span";

	if (source.length <= EVAL_SOURCE_MAX) {
		const program = node.data?.estree;
		const statement =
			program?.type === "Program" && program.body.length === 1
				? program.body[0]
				: undefined;
		if (statement?.type === "ExpressionStatement") {
			const value = evalExpression(statement.expression, scope, 0);
			if (isPlainValue(value)) {
				return { type: "text", value: String(value) };
			}
		}
	}

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
function transformChildren(parent, scope) {
	if (!Array.isArray(parent.children)) return;
	const next = [];
	for (const child of parent.children) {
		next.push(...transformNode(child, parent, scope));
	}
	parent.children = next;
}

function transformNode(node, parent, scope) {
	if (!node || typeof node !== "object") return [node];

	if (node.type === "mdxjsEsm") {
		/* 语句本身丢弃，但 const 声明进常量表，供后续表达式求值 */
		collectConstants(node, scope);
		return [];
	}

	if (node.type === "mdxFlowExpression" || node.type === "mdxTextExpression") {
		/* {/* … *\/} 是 MDX 的注释语法，不该出现在成稿里 */
		if (EXPRESSION_COMMENT.test(node.value ?? "")) return [];
		return [expressionReplacement(node, parent, scope)];
	}

	if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
		transformChildren(node, scope);
		return flattenJsxElement(node, node.type === "mdxJsxFlowElement", scope);
	}

	transformChildren(node, scope);
	return [node];
}

export function remarkMdxFlatten() {
	return (tree) => {
		transformChildren(tree, Object.create(null));
	};
}
