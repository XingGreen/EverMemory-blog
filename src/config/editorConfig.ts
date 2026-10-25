/**
 * 文章编辑器页面尺寸（固定值，不开放用户配置）
 *
 * 参考项目 E:\flare-stack-blog 的编辑器布局：页面宽度铺满可用空间
 * （其 editor 工作区用 flex-1 且无 max-width），内容区高度由外层容器
 * 限高（100vh - 3rem）后 flex 分配。
 *
 * 因此这里不再暴露到「网站配置」页：宽高由布局与视口决定，
 * 手工配置只会与 shell 的限高冲突——例如把 maxPageWidth 改成 25%
 * 会让正文被压成极窄一列（2026-10 实测正文仅 243px 宽，大量换行）。
 */
export const editorConfig = {
	/** 页面宽度：铺满可用宽度，不做额外限制 */
	maxPageWidth: "100%",
} as const;
