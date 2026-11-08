/**
 * Editor page dimensions (fixed values, not user-configurable).
 *
 * The editor fills the available width; the content area height is distributed by flex
 * after the outer container caps the page at 100vh - 3rem. Because both dimensions come
 * from the layout and the viewport, they are not exposed on the site configuration page:
 * overriding them conflicts with the shell's height cap and squeezes the text column.
 */
export const editorConfig = {
	/** 页面宽度：铺满可用宽度，不做额外限制 */
	maxPageWidth: "100%",
} as const;
