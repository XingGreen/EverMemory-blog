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
	 * 进入后台的开屏遮罩。
	 *
	 * 与 pageTransition 分开是因为两者触发时机不同：pageTransition 管「后台内部
	 * 切页」，entryVeil 管「整页加载后进后台」。但它们**共用同一套效果与时长语义**，
	 * 所以 effect 的类型与 pageTransition 相同，不另立一套名字——
	 * 两套动画曾各自硬编码数值，结果遮罩的退场比页面切换慢四倍、效果也对不上。
	 */
	entryVeil?: {
		/** 是否开启；关闭后整页加载直接显示后台 */
		enable?: boolean;
		/**
		 * 退场效果，取值与 pageTransition.effect 一致。
		 * 默认跟随 pageTransition.effect，避免两处各写一个值导致观感不一致。
		 */
		effect?: AdminPageTransitionEffect;
		/** 退场时长（毫秒）；不填则跟随 pageTransition.duration */
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
