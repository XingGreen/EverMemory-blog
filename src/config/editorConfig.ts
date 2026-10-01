import { siteConfig } from "./siteConfig";
import type { EditorConfig } from "../types/editorConfig";

/**
 * 文章编辑器页面尺寸限制
 *
 * 编辑器页面不沿用后台全局的 76rem 宽度限制，而是使用下列独立配置；
 * 值均为 CSS 长度，可按需调整为 px / rem / calc(...) 等任意合法写法。
 *
 * 若后续需要在后台「网站配置」中在线调整，可将本文件加入
 * src/utils/admin-settings.ts 的 CONFIG_ITEMS（先走「改源码 + 重建」链路，
 * 再按需升级为 runtime 配置）。
 */
export const editorConfig: EditorConfig = {
	/**
	 * 编辑器页面最大宽度，默认与前台的 siteConfig.pageWidth 保持一致，
	 * 前台调整页面宽度时编辑器同步跟随。
	 */
	maxPageWidth: `${siteConfig.pageWidth ?? 100}rem`,
	/** 编辑区最小高度 */
	minContentHeight: "26rem",
	/** 编辑区默认高度：填满视口剩余空间 */
	defaultContentHeight: "calc(100vh - 18rem)",
	/** 编辑区最大高度：手动拖拽时的上限 */
	maxContentHeight: "calc(100vh - 10rem)",
};
