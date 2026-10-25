import type { EditorConfig } from "../types/editorConfig";

/**
 * 文章编辑器页面尺寸限制
 *
 * 后台控制面板已铺满窗口宽度，编辑器默认同样不再限宽（100%）；
 * 如需限宽，把 maxPageWidth 改为 px / rem / calc(...) 等合法 CSS 长度即可。
 *
 * 若后续需要在后台「网站配置」中在线调整，可将本文件加入
 * src/utils/admin-settings.ts 的 CONFIG_ITEMS（先走「改源码 + 重建」链路，
 * 再按需升级为 runtime 配置）。
 */
export const editorConfig: EditorConfig = {
	/** 编辑器页面最大宽度，默认铺满可用宽度 */
	maxPageWidth: "100%",
	/** 编辑区最小高度（写作区不会再被压到比这更矮） */
	minContentHeight: "26rem",
	/** 编辑区默认高度：由外层 flex 分配，此值仅在样式回退时使用 */
	defaultContentHeight: "calc(100vh - 18rem)",
	/** 编辑区最大高度：由容器限高（100vh - 3rem）约束，此值仅在样式回退时使用 */
	maxContentHeight: "calc(100vh - 10rem)",
};
