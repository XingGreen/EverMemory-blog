import type { AdminConfig } from "../types/adminConfig";

export const adminConfig: AdminConfig = {
	// 整体策略：inherit=复用前台配置；custom=后台独立配置
	appearanceStrategy: "inherit",
	// 侧边栏紧贴屏幕左缘（四角直角，内容区保持画布式空隙）；false = 悬浮卡片布局
	sidebarFlush: false,
	// 页面切换动画（后台内部切页时生效）
	pageTransition: {
		enable: true,
		// slide-fade | fade | slide | zoom
		effect: "slide-fade",
		duration: 220,
	},
	// 进入后台的开屏遮罩：与 OOBE 开屏共用这一份配置（同一套效果与节奏）。
	//
	// duration 必须单独给值，不能跟随 pageTransition：pageTransition 的 220ms 服务的是
	// 「内容位移 10px 的入场」，而开屏遮罩要位移整屏（约 1010px）——
	// 位移量差 100 倍，共用一个数值必然一个太快（实测单帧跳过 483px，肉眼只看到闪）。
	// 900ms 对应约 18px/帧，上移动画能看清。
	entryVeil: {
		enable: true,
		effect: "slide-fade",
		duration: 900,
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
