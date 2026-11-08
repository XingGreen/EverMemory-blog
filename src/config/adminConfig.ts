import type { AdminConfig } from "../types/adminConfig";

export const adminConfig: AdminConfig = {
	// 整体策略：inherit=复用前台配置；custom=后台独立配置
	appearanceStrategy: "inherit",

	// 页面切换动画（后台内部切页时生效）
	pageTransition: {
		enable: true,
		// slide-fade | fade | slide | zoom
		effect: "slide-fade",
		duration: 220,
	},

	// 对话框模糊：弹窗/抽屉打开时，遮罩层做背景模糊
	dialogBlur: {
		enable: true,
		radius: 6,
	},

	// 背景图
	background: {
		// inherit=与前台对应（用前台壁纸图）；custom=用 customUrl
		source: "inherit",
		customUrl: "",
		// 遮罩不透明度，越大背景越淡
		overlay: 0.82,
	},
};
