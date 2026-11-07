/**
 * MDX 运行时渲染：@mdx-js/mdx 的 evaluate() + Preact 服务端渲染。
 *
 * 与 markdown-renderer.ts 的降级管线（remark-mdx + remarkMdxFlatten）互补：
 *   - 本模块：MDX 编译器全量执行，`.map()`、模板串、任意表达式都真实渲染，
 *     且会执行文章里的任意 JS——信任级别与前台构建一致（文章只有管理员能写）。
 *   - 降级管线：零执行、语法容错，作为本模块编译失败（编辑中的半成品）时的保底。
 *
 * evaluate 无法解析 import 语句（运行时没有模块加载器），所以：
 *   1. 剥离源码顶层的 import（代码块围栏内的示例代码不动）；
 *   2. 对导入的绑定注入同名组件。其中 astro-icon 的 `Icon` 走真渲染：
 *      直读 @iconify-json 的图标数据输出真 <svg>（见 createRuntimeIconComponent）；
 *      其余 Astro 组件映射为 .mdx-component 占位块——项目 MDX 里实际只有
 *      Icon 一个，通用 Astro 组件 SSR 收益为零、风险高，记入 todo.md 技术债。
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

/* ── astro-icon 运行时替身 ──
   Icon 的本质：按 name 前缀（"fa7-solid:rocket"）去 @iconify-json/<set> 的
   icons.json 里取 { body, width, height }，输出 <svg>。纯数据操作，无需
   Astro 上下文。集合按需加载并缓存；name 里出现的集合名在 evaluate 前
   预加载（组件渲染是同步的，不能在里面 await）。 */

/** 项目依赖里有的 iconify 集合；name 前缀不在表内的图标渲染为占位 */
const ICON_SET_LOADERS: Record<string, () => Promise<{ default: any }>> = {
	"fa7-solid": () => import("@iconify-json/fa7-solid/icons.json"),
	"fa7-regular": () => import("@iconify-json/fa7-regular/icons.json"),
	"fa7-brands": () => import("@iconify-json/fa7-brands/icons.json"),
	"material-symbols": () => import("@iconify-json/material-symbols/icons.json"),
	mingcute: () => import("@iconify-json/mingcute/icons.json"),
	"simple-icons": () => import("@iconify-json/simple-icons/icons.json"),
};

const iconDataCache = new Map<string, any>();

async function loadIconSet(set: string): Promise<void> {
	if (iconDataCache.has(set)) return;
	const loader = ICON_SET_LOADERS[set];
	if (!loader) return;
	const mod = await loader();
	iconDataCache.set(set, mod.default);
}

/** 从源码里扫出 name="set:icon" 用到的集合，提前加载 */
async function preloadIconSets(source: string): Promise<void> {
	const sets = new Set<string>();
	for (const match of source.matchAll(/name=["']([\w-]+):[\w-]+["']/g)) {
		if (match[1] in ICON_SET_LOADERS) sets.add(match[1]);
	}
	await Promise.all([...sets].map(loadIconSet));
}

/** 查图标数据：icons 直接命中，或走 aliases（material-symbols 有别名表）。
    图标级 width/height 缺省时回落到集合顶层（fa7 全系 640，mingcute 24 等），
    再缺省 16——不能只看图标自身，否则 viewBox 会错成 0 0 16 16。 */
function findIcon(
	set: string,
	icon: string,
): { body: string; width: number; height: number } | undefined {
	const data = iconDataCache.get(set);
	if (!data) return undefined;
	const record =
		data.icons?.[icon] ??
		(() => {
			const alias = data.aliases?.[icon];
			return alias ? data.icons?.[alias.parent] : undefined;
		})();
	if (!record) return undefined;
	const width =
		record.width ?? data.width ?? record.height ?? data.height ?? 16;
	const height =
		record.height ?? data.height ?? record.width ?? data.width ?? 16;
	return { body: record.body, width, height };
}

/**
 * 生成 Preact 版 Icon 组件。jsx 由调用方传入（evaluate 的运行时参数），
 * 避免 mdx-runtime 自身与 preact/jsx-runtime 的内部 API 耦合。
 * name 查不到（未知集合/图标/表达式动态值）→ 退回虚线占位块。
 */
function createRuntimeIconComponent(jsx: any) {
	return function Icon(props: any) {
		const name = String(props?.name ?? "");
		const sep = name.indexOf(":");
		const set = sep === -1 ? "" : name.slice(0, sep);
		const icon = sep === -1 ? "" : name.slice(sep + 1);
		const data = findIcon(set, icon);

		if (!data) {
			return jsx("span", {
				class: "mdx-component",
				"data-mdx-component": "Icon",
				children: props?.children,
			});
		}

		/* astro-icon 默认 1em 见方，与前台 <svg width="1em" height="1em"> 对齐 */
		return jsx("svg", {
			xmlns: "http://www.w3.org/2000/svg",
			viewBox: `0 0 ${data.width} ${data.height}`,
			width: props?.width ?? "1em",
			height: props?.height ?? "1em",
			class: props?.class,
			dangerouslySetInnerHTML: { __html: data.body },
		});
	};
}

/** 生成导入组件的声明：MDX 顶层只允许 import/export 与正文，裸 const 会被
    当表达式块解析失败，所以必须是 export const（大写组件按作用域同名变量
    引用）。这里引用 `_jsx` 是编译产物解构出的运行时名（development:false
    固定此名），用户代码里不可见 jsx——若上游改名，mdx-example 的 e2e 用例
    会失败提醒。IconRuntime 通过 evaluate 的 arguments[0] 传入。 */
/**
 * 组件提供器：import 剥离后，MDX 编译器把 `<Icon>` 这类「无本地声明的组件」
 * 编译成从 _components 表取值 + 缺失检查。这里通过 evaluate 白名单内的
 * useMDXComponents 提供它们：
 *   - astro-icon 的 `Icon` → 真渲染（直读 iconify 数据输出 <svg>）
 *   - 其余 Astro 组件 → .mdx-component 占位块
 * （不能用 preamble 里 `export const` + 自定义 arguments[0].IconRuntime 键——
 *   evaluate 的 runtime options 是固定白名单，自定义键会被过滤成 undefined。）
 */
function createComponentProvider(bindings: string[]) {
	const icon = createRuntimeIconComponent(runtime.jsx);
	return (components: Record<string, any>) => ({
		...components,
		...Object.fromEntries(
			bindings.map((name) => [
				name,
				name === "Icon"
					? icon
					: (p: any) =>
							runtime.jsx(
								"span",
								{
									class: "mdx-component",
									"data-mdx-component": name,
									children: p ? p.children : undefined,
								},
								undefined,
							),
			]),
		),
	});
}

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
	await preloadIconSets(source);
	/* useMDXComponents 依赖本次源码的 import 绑定，不能走缓存。
	   官方类型只允许透传形式 (c) => c，注入额外组件需 as never 绕过。 */
	const options: Parameters<typeof evaluate>[1] = {
		...getEvaluateOptions(),
		useMDXComponents: createComponentProvider(bindings) as never,
	};
	const { default: Content } = await evaluate(code, options);
	return renderToString(Content({}));
}
