/**
 * MDX 降级渲染通道（remark-mdx 解析 + remarkMdxFlatten 降级）。
 *
 * 三通道架构中的保底路径：
 *   1. MD  通道：markdown-renderer.ts 的 renderMarkdown()——标准 Markdown
 *   2. MDX 主通道：mdx-runtime.ts 的 renderMdxRuntime()——evaluate 全量执行
 *   3. MDX 降级通道：本文件——编辑中的半成品编译不过时兜底，零执行、语法容错
 *
 * 为什么不直接放进 markdown-renderer.ts：MD 与 MDX 的解析行为互斥
 * （remark-mdx 会把普通 .md 里的 `<!-- 注释 -->`、`a < b` 判成非法 JSX），
 * 分开文件后两条通道各自独立演化，路由在 preview API 里按扩展名分发。
 */

import { unified } from "@astrojs/markdown-remark";
import remarkMdx from "remark-mdx";
import { remarkMdxFlatten } from "@/plugins/remark-mdx-flatten.mjs";
import {
	buildSharedRehypePlugins,
	buildSharedRemarkPlugins,
} from "@/utils/markdown-renderer";

type Renderer = Awaited<
	ReturnType<ReturnType<typeof unified>["createRenderer"]>
>;

let processorInstance: ReturnType<typeof unified> | null = null;
let rendererPromise: Promise<Renderer> | null = null;

function getRenderer() {
	if (!rendererPromise) {
		processorInstance = unified({
			remarkPlugins: [
				remarkMdx as never,
				remarkMdxFlatten as never,
				/* 降级管线走 markdown-remark 的 render()，gfm/smartypants 由其
				   默认值补齐；这里的 shared 列表与 MD 通道保持同一套增强插件 */
				...buildSharedRemarkPlugins(),
			],
			rehypePlugins: buildSharedRehypePlugins(),
		});
		rendererPromise = processorInstance.createRenderer({
			syntaxHighlight: true as unknown as undefined,
		});
	}
	return rendererPromise;
}

/**
 * 渲染 MDX 为 HTML（降级路径）。
 * remarkMdxFlatten 会把 MDX 专有节点降级成标准 mdast：ESM 丢弃、表达式与
 * 自定义组件转占位块、JSX 元素还原为标签。功能弱于运行时通道（不求值、
 * 不执行 .map），但任何编辑中的半成品都能出结构。
 */
export async function renderMdxFallback(content: string): Promise<string> {
	const renderer = await getRenderer();
	const result = await renderer.render(content);
	return result.code;
}
