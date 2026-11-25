/**
 * 后台（管理面板）自身的外观配置。
 *
 * 与 siteConfig 分开：这些开关只影响 /admin/ 的观感，不影响前台站点。
 * 之所以做成独立配置文件，是为了让「后台独立配置」这个策略本身也是可配置的：
 * appearanceStrategy = "inherit" 时，后台尽量跟随前台（配色、背景图）；
 * "custom" 时才使用下面的独立取值。
 */

export type AdminPageTransitionEffect =
	/** 滑动 + 淡入 */
	| "slide-fade"
	/** 仅淡入淡出 */
	| "fade"
	/** 仅滑动 */
	| "slide"
	/** 缩放 */
	| "zoom";

export type AdminConfig = {
	/**
	 * 整体配置策略
	 * - inherit：复用前台配置（背景图、配色跟随前台，动画与模糊仍按下方开关）
	 * - custom：后台完全独立配置
	 */
	appearanceStrategy?: "inherit" | "custom";

	/**
	 * 侧边栏紧贴模式
	 * - true：侧栏贴屏幕左缘、全高、四角直角；内容区保持画布式空隙
	 * - false：侧栏与内容区均为悬浮卡片布局（四周留白 + 大圆角）
	 */
	sidebarFlush?: boolean;

	/** 页面切换动画 */
	pageTransition?: {
		/** 是否开启 */
		enable?: boolean;
		/** 效果 */
		effect?: AdminPageTransitionEffect;
		/** 时长（毫秒） */
		duration?: number;
	};

	/**
	 * 开屏遮罩：OOBE（/setup/）与后台入口**共用这一份配置**。
	 *
	 * 两者是同一套视觉语言（夜色底 + 坐标格 + 站名 + 上移退场），只有承载的页面不同。
	 * 历史上 OOBE 在 SetupPage 里自建了一套 intro-* 动画、后台入口又有一套 entry-veil，
	 * 数值各写各的、先后被删掉一半，结果 OOBE 完全没有开屏、后台的又对不上配置。
	 * 现在统一从这里读：效果、时长、是否播放都只有一个来源。
	 */
	entryVeil?: {
		/** 是否开启；关闭后两个入口都直接显示内容 */
		enable?: boolean;
		/**
		 * 退场效果，取值与 pageTransition.effect 一致（slide-fade / fade / slide / zoom）。
		 * 默认 "slide-fade"。
		 */
		effect?: AdminPageTransitionEffect;
		/**
		 * 退场时长（毫秒）。
		 *
		 * **不要用 pageTransition.duration 的值。** 后者服务的是「内容位移 10px 的入场」，
		 * 而开屏遮罩要位移整屏（约 1010px）——位移量差 100 倍，共用数值会让遮罩
		 * 单帧跳过数百像素，看上去就是「闪一下」，也就是「动画不完整」。
		 * 建议 800–1000ms：900ms 约合 18px/帧，上移过程能看清。
		 */
		duration?: number;
	};

	/** 对话框（弹窗 / 抽屉）背后的模糊效果 */
	dialogBlur?: {
		enable?: boolean;
		/** 模糊半径（px） */
		radius?: number;
	};

	/** 背景图 */
	background?: {
		/**
		 * 图片来源
		 * - inherit：与前台对应（使用 backgroundWallpaper 的桌面图）
		 * - custom：使用下面的 customUrl
		 */
		source?: "inherit" | "custom";
		/** 自定义背景图地址（source=custom 时生效） */
		customUrl?: string;
		/** 遮罩不透明度 0-1，越大背景越淡（保证后台文字可读） */
		overlay?: number;
	};
};
