/**
 * MDX 运行时渲染：@mdx-js/mdx 的 evaluate() + Preact 服务端渲染。
 *
 * 与 markdown-renderer.ts 的降级管线（remark-mdx + remarkMdxFlatten）互补：
 *   - 本模块：MDX 编译器全量执行，`.map()`、模板串、任意表达式都真实渲染，
 *     但 import 的 Astro 组件（Icon 等）无法在 Preact 世界渲染，映射为占位；
 *     且会执行文章里的任意 JS——信任级别与前台构建一致（文章只有管理员能写）。
 *   - 降级管线：零执行、语法容错，作为本模块编译失败（编辑中的半成品）时的保底。
 *
 * evaluate 无法解析 import 语句（运行时没有模块加载器），所以：
 *   1. 剥离源码顶层的 import（代码块围栏内的示例代码不动）；
 *   2. 对每个导入的绑定注入同名占位组件，渲染成 .mdx-component 占位块。
 */

import { evaluate } from "@mdx-js/mdx";
import * as runtime from "preact/jsx-runtime";
import { renderToString } from "preact-render-to-string";
import {
	buildMdxRuntimeRemarkPlugins,
	buildSharedRehypePlugins,
} from "@/utils/markdown-renderer";

/** 代码块围栏（``` / ~~~）状态机：剥离 import 时跳过围栏内的示例代码 */
function stripImports(source: string): {
	code: string;
	bindings: string[];
} {
	const lines = source.split(/\r?\n/);
	const out: string[] = [];
	const bindings = new Set<string>();
	let inFence = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;

		if (inFence || !/^\s*import\b/.test(line)) {
			out.push(line);
			continue;
		}

		/* import 可能跨行（花括号内换行），收集到 from '…' 或裸 import 行尾为止 */
		let statement = line;
		while (
			!/from\s*["'][^"']+["']\s*;?\s*$/.test(statement) &&
			!/^\s*import\s*["'][^"']+["']\s*;?\s*$/.test(statement) &&
			i + 1 < lines.length
		) {
			i += 1;
			statement += `\n${lines[i]}`;
		}

		/* 绑定名：import A, { B as C, D } from '…' → A / C / D；* as Ns → Ns */
		const braces = statement.match(/\{([^}]*)\}/s);
		if (braces) {
			for (const part of braces[1].split(",")) {
				const name = part
					.trim()
					.split(/\s+as\s+/)
					.pop()
					?.trim();
				if (name && /^[A-Za-z_$][\w$]*$/.test(name)) bindings.add(name);
			}
		}
		const withDefault = statement.match(
			/^\s*import\s+([A-Za-z_$][\w$]*)\s*(?:,|from\s)/,
		);
		if (withDefault) bindings.add(withDefault[1]);
		const namespace = statement.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
		if (namespace) bindings.add(namespace[1]);
	}

	return { code: out.join("\n"), bindings: [...bindings] };
}

/** 生成占位组件声明：渲染成与 remarkMdxFlatten 同款虚线占位块。
    MDX 顶层只允许 import/export 与正文，裸 const 会被当表达式块解析失败，
    所以必须是 export const（大写组件在 MDX 里按作用域同名变量引用）。
    这里引用 `_jsx` 是编译产物解构出的运行时名（development:false 固定此名），
    用户代码里不可见 jsx——若上游改名，mdx-example 的 e2e 用例会失败提醒。 */
function buildPlaceholderPreamble(bindings: string[]): string {
	return bindings
		.map(
			(name) =>
				`export const ${name} = (p) => _jsx("span", { class: "mdx-component", "data-mdx-component": ${JSON.stringify(name)}, children: p ? p.children : undefined });`,
		)
		.join("\n");
}

/** 保留运行时常量，避免每次调用重新 import（模块本身就是单例） */
let cachedEvaluateOptions: Parameters<typeof evaluate>[1] | undefined;

function getEvaluateOptions(): Parameters<typeof evaluate>[1] {
	if (!cachedEvaluateOptions) {
		cachedEvaluateOptions = {
			...runtime,
			development: false,
			/* 与前台一致的 HTML 属性风格（class 而非 className） */
			elementAttributeNameCase: "html",
			remarkPlugins: buildMdxRuntimeRemarkPlugins(),
			rehypePlugins: buildSharedRehypePlugins(),
		} as Parameters<typeof evaluate>[1];
	}
	return cachedEvaluateOptions;
}

/**
 * 渲染 MDX 为 HTML 字符串。
 * 编译/执行失败（编辑中的半成品、暂不支持的语法）抛出异常，由调用方降级。
 */
export async function renderMdxRuntime(source: string): Promise<string> {
	const { code, bindings } = stripImports(source);
	const preamble = buildPlaceholderPreamble(bindings);
	const { default: Content } = await evaluate(
		[preamble, code].filter(Boolean).join("\n"),
		getEvaluateOptions(),
	);
	return renderToString(Content({}));
}
