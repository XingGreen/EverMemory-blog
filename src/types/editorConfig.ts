/**
 * 文章编辑器（后台 PostEditor）页面尺寸限制配置
 *
 * 这些值均为合法的 CSS 长度值（rem / px / calc(...) 等），
 * 由 PostEditor 与 AdminDashboard 注入为 CSS 变量后使用，
 * 使编辑器页面拥有独立于后台其他页面（全局 max-width）的尺寸限制。
 */
export type EditorConfig = {
	/** 编辑器页面最大宽度，独立于后台其他页面的全局宽度限制 */
	maxPageWidth: string;
	/** 编辑区（源码 / 预览）最小高度 */
	minContentHeight: string;
	/** 编辑区默认高度，通常填满视口剩余空间 */
	defaultContentHeight: string;
	/** 编辑区最大高度，限制手动拖拽时的上限，避免超出视口 */
	maxContentHeight: string;
};
