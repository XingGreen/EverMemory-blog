/** 后台文章编辑器三栏共享的状态/动作契约（Svelte context 键与类型定义） */

/** 左侧表单分组 */
export type FormGroup = "essential" | "publish" | "seo" | "advanced";

/** 右侧目录条目 */
export interface TocItem {
	level: number;
	text: string;
	lineIndex: number;
}

/** 文章字段：由编辑器容器以 $state 创建，三栏直接双向绑定 */
export interface PostEditorFields {
	title: string;
	author: string;
	category: string;
	description: string;
	content: string;
	slug: string;
	published: string;
	updated: string;
	isDraft: boolean;
	isPinned: boolean;
	image: string;
	lang: string;
	licenseName: string;
	licenseUrl: string;
	sourceLink: string;
	enableComment: boolean;
	password: string;
	passwordHint: string;
	tagInput: string;
	tags: string[];
}

/** 跨栏共享的 UI 状态与 DOM 引用 */
export interface PostEditorUiState {
	activeTab: "editor" | "preview";
	openGroups: Record<FormGroup, boolean>;
	renderedHtml: string;
	visibleTocLines: number[];
	editorEl: HTMLTextAreaElement | undefined;
	previewEl: HTMLElement | undefined;
}

/** 容器提供、供三栏调用的动作 */
export interface PostEditorActions {
	toggleGroup: (group: FormGroup) => void;
	handleSlugInput: () => void;
	addTag: () => void;
	removeTag: (index: number) => void;
	handleTagKeydown: (e: KeyboardEvent) => void;
	setTab: (tab: "editor" | "preview") => void;
	insertBold: () => void;
	insertItalic: () => void;
	insertStrikethrough: () => void;
	insertH2: () => void;
	insertH3: () => void;
	insertInlineCode: () => void;
	insertCodeBlock: () => void;
	insertLink: () => void;
	insertImage: () => void;
	insertQuote: () => void;
	insertUl: () => void;
	insertOl: () => void;
	insertDivider: () => void;
	handleEditorScroll: () => void;
	handlePreviewScroll: () => void;
	jumpToToc: (item: TocItem) => void;
}

export interface PostEditorContextValue {
	state: PostEditorFields & PostEditorUiState;
	actions: PostEditorActions;
}

export const POST_EDITOR_CONTEXT: symbol = Symbol("post-editor");

/** 从 Markdown 源码提取目录条目（容器与目录栏共用同一实现） */
export function extractTocItems(content: string): TocItem[] {
	return content.split("\n").reduce<TocItem[]>((acc, line, i) => {
		const m = /^(#{1,6})\s+(.+)$/.exec(line);
		if (m && m[2].trim())
			acc.push({ level: m[1].length, text: m[2].trim(), lineIndex: i });
		return acc;
	}, []);
}

/** 目录层级归一化：最浅为 0，其后依次 1、2 */
export function tocDepthLevelFn(level: number, minDepth: number): number {
	return level === minDepth ? 0 : level === minDepth + 1 ? 1 : 2;
}
