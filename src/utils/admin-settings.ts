// 后台「网站配置」可在线编辑的配置文件清单（全部 23 项）
// 纯数据模块：可同时被浏览器端（Svelte 组件）与服务端（API / 脚本）共享，
// 因此不要在此文件中引入任何 node 或浏览器运行时依赖。
import I18nKey from "@/i18n/i18nKey";

export type AdminConfigItem = {
	key: string;
	/** 相对项目根目录的配置文件路径 */
	file: string;
	/** 配置文件中导出的配置对象变量名（html 类型为空字符串） */
	exportName: string;
	/** 配置对象的类型名，用于写回文件时的类型注解（html 类型为空字符串） */
	typeName: string;
	/** 内容形态：json=TS 导出对象（可视化表单）；html=原始 HTML 文件（文本编辑） */
	kind?: "json" | "html";
	/** 后台显示的配置名称 */
	label: string;
	/** iconify 图标 */
	icon: string;
	/** 后台显示的配置描述 */
	description: string;
};

export const CONFIG_ITEMS: AdminConfigItem[] = [
	{
		key: "site",
		file: "src/config/siteConfig.ts",
		exportName: "siteConfig",
		typeName: "SiteConfig",
		label: "站点配置",
		icon: "material-symbols:language",
		description: "站点标题、描述、主题色、页面开关、文章列表布局等基础信息",
	},
	{
		key: "profile",
		file: "src/config/profileConfig.ts",
		exportName: "profileConfig",
		typeName: "ProfileConfig",
		label: "个人资料",
		icon: "material-symbols:person",
		description: "头像、昵称、个人签名与社交链接",
	},
	{
		key: "navbar",
		file: "src/config/navBarConfig.ts",
		exportName: "navBarConfig",
		typeName: "NavBarConfig",
		label: "导航栏",
		icon: "material-symbols:menu",
		description: "顶部导航栏的菜单链接与子菜单",
	},
	{
		key: "footer",
		file: "src/config/footerConfig.ts",
		exportName: "footerConfig",
		typeName: "FooterConfig",
		label: "页脚",
		icon: "material-symbols:widgets",
		description: "页脚显示开关等配置",
	},
	{
		key: "footer-html",
		file: "src/config/FooterConfig.html",
		exportName: "",
		typeName: "",
		kind: "html",
		label: "页脚自定义内容",
		icon: "material-symbols:code",
		description: "页脚底部注入的自定义 HTML（备案号、认证徽章等）",
	},
	{
		key: "music",
		file: "src/config/musicConfig.ts",
		exportName: "musicPlayerConfig",
		typeName: "MusicPlayerConfig",
		label: "音乐",
		icon: "material-symbols:music-note",
		description: "音乐播放器配置（网易云音乐等）",
	},
	{
		key: "friends",
		file: "src/config/friendsConfig.ts",
		exportName: "friendsPageConfig",
		typeName: "FriendsPageConfig",
		label: "友链",
		icon: "material-symbols:link",
		description: "友链页面配置与友情链接列表",
	},
	{
		key: "comment",
		file: "src/config/commentConfig.ts",
		exportName: "commentConfig",
		typeName: "CommentConfig",
		label: "评论",
		icon: "material-symbols:mode-comment",
		description: "评论系统类型与各提供方配置",
	},
	{
		key: "font",
		file: "src/config/fontConfig.ts",
		exportName: "fontConfig",
		typeName: "FontSelectionConfig",
		label: "字体",
		icon: "material-symbols:format-letter-spacing",
		description: "站点字体选择与局部覆盖",
	},
	{
		key: "wallpaper",
		file: "src/config/backgroundWallpaper.ts",
		exportName: "backgroundWallpaper",
		typeName: "BackgroundWallpaperConfig",
		label: "背景壁纸",
		icon: "material-symbols:wallpaper",
		description: "背景壁纸模式与壁纸列表配置",
	},
	{
		key: "announcement",
		file: "src/config/announcementConfig.ts",
		exportName: "announcementConfig",
		typeName: "AnnouncementConfig",
		label: "公告",
		icon: "material-symbols:campaign",
		description: "公告标题与公告内容",
	},
	{
		key: "analytics",
		file: "src/config/analyticsConfig.ts",
		exportName: "analyticsConfig",
		typeName: "AnalyticsConfig",
		label: "统计",
		icon: "material-symbols:monitoring",
		description: "网站统计（Google Analytics、Clarity、Umami 等）",
	},
	{
		key: "gallery",
		file: "src/config/galleryConfig.ts",
		exportName: "galleryConfig",
		typeName: "GalleryConfig",
		label: "相册",
		icon: "material-symbols:photo-library",
		description: "相册列表与图片配置",
	},
	{
		key: "app",
		file: "src/config/appConfig.ts",
		exportName: "appConfig",
		typeName: "AppConfig",
		label: "软件推荐",
		icon: "material-symbols:apps",
		description: "软件推荐页面与推荐软件列表",
	},
	{
		key: "sponsor",
		file: "src/config/sponsorConfig.ts",
		exportName: "sponsorConfig",
		typeName: "SponsorConfig",
		label: "打赏",
		icon: "material-symbols:volunteer-activism",
		description: "打赏页面配置（标题、描述与打赏链接）",
	},
	{
		key: "license",
		file: "src/config/licenseConfig.ts",
		exportName: "licenseConfig",
		typeName: "LicenseConfig",
		label: "许可证",
		icon: "material-symbols:policy",
		description: "文章许可证名称、链接与显示开关",
	},
	{
		key: "cover-image",
		file: "src/config/coverImageConfig.ts",
		exportName: "coverImageConfig",
		typeName: "CoverImageConfig",
		label: "封面图",
		icon: "material-symbols:image",
		description: "文章封面图（固定/随机图片）配置",
	},
	{
		key: "effects",
		file: "src/config/effectsConfig.ts",
		exportName: "sakuraConfig",
		typeName: "SakuraConfig",
		label: "特效",
		icon: "material-symbols:auto-awesome",
		description: "页面特效（樱花等）开关与参数",
	},
	{
		key: "plantuml",
		file: "src/config/plantumlConfig.ts",
		exportName: "plantumlConfig",
		typeName: "PlantUMLConfig",
		label: "PlantUML",
		icon: "material-symbols:account-tree",
		description: "PlantUML 图表渲染与明暗主题配置",
	},
	{
		key: "code-theme",
		file: "src/config/expressiveCodeConfig.ts",
		exportName: "expressiveCodeConfig",
		typeName: "ExpressiveCodeConfig",
		label: "代码主题",
		icon: "material-symbols:code-blocks",
		description: "expressive-code 代码高亮主题配置（修改后需重启服务）",
	},
	{
		key: "pio-spine",
		file: "src/config/pioConfig.ts",
		exportName: "spineModelConfig",
		typeName: "SpineModelConfig",
		label: "看板娘（Spine）",
		icon: "material-symbols:accessibility-new",
		description: "Spine 看板娘开关与模型配置",
	},
	{
		key: "pio-live2d",
		file: "src/config/pioConfig.ts",
		exportName: "live2dWidgetConfig",
		typeName: "Live2DWidgetConfig",
		label: "看板娘（Live2D）",
		icon: "material-symbols:robot-2",
		description: "Live2D 看板娘开关与模型配置",
	},
	{
		key: "sidebar",
		file: "src/config/sidebarConfig.ts",
		exportName: "sidebarLayoutConfig",
		typeName: "SidebarLayoutConfig",
		label: "侧边栏",
		icon: "material-symbols:view-list",
		description: "左右侧边栏的组件排列与移动端底部组件",
	},
];

export function getConfigItem(key: string): AdminConfigItem | undefined {
	return CONFIG_ITEMS.find((item) => item.key === key);
}

// 配置项 key → 国际化 key 映射（用于后台标题 / 描述，语言随 siteConfig.lang 切换）
const CONFIG_LABEL_KEYS: Record<string, I18nKey> = {
	site: I18nKey.configSite,
	profile: I18nKey.configProfile,
	navbar: I18nKey.configNavbar,
	footer: I18nKey.configFooter,
	"footer-html": I18nKey.configFooterHtml,
	music: I18nKey.configMusic,
	friends: I18nKey.configFriends,
	comment: I18nKey.configComment,
	font: I18nKey.configFont,
	wallpaper: I18nKey.configWallpaper,
	announcement: I18nKey.configAnnouncement,
	analytics: I18nKey.configAnalytics,
	gallery: I18nKey.configGallery,
	app: I18nKey.configApp,
	sponsor: I18nKey.configSponsor,
	license: I18nKey.configLicense,
	"cover-image": I18nKey.configCoverImage,
	effects: I18nKey.configEffects,
	plantuml: I18nKey.configPlantuml,
	"code-theme": I18nKey.configCodeTheme,
	"pio-spine": I18nKey.configPioSpine,
	"pio-live2d": I18nKey.configPioLive2d,
	sidebar: I18nKey.configSidebar,
};

const CONFIG_DESC_KEYS: Record<string, I18nKey> = {
	site: I18nKey.configSiteDesc,
	profile: I18nKey.configProfileDesc,
	navbar: I18nKey.configNavbarDesc,
	footer: I18nKey.configFooterDesc,
	"footer-html": I18nKey.configFooterHtmlDesc,
	music: I18nKey.configMusicDesc,
	friends: I18nKey.configFriendsDesc,
	comment: I18nKey.configCommentDesc,
	font: I18nKey.configFontDesc,
	wallpaper: I18nKey.configWallpaperDesc,
	announcement: I18nKey.configAnnouncementDesc,
	analytics: I18nKey.configAnalyticsDesc,
	gallery: I18nKey.configGalleryDesc,
	app: I18nKey.configAppDesc,
	sponsor: I18nKey.configSponsorDesc,
	license: I18nKey.configLicenseDesc,
	"cover-image": I18nKey.configCoverImageDesc,
	effects: I18nKey.configEffectsDesc,
	plantuml: I18nKey.configPlantumlDesc,
	"code-theme": I18nKey.configCodeThemeDesc,
	"pio-spine": I18nKey.configPioSpineDesc,
	"pio-live2d": I18nKey.configPioLive2dDesc,
	sidebar: I18nKey.configSidebarDesc,
};

export function getConfigLabelKey(key: string): I18nKey {
	return CONFIG_LABEL_KEYS[key] ?? I18nKey.configSite;
}

export function getConfigDescKey(key: string): I18nKey {
	return CONFIG_DESC_KEYS[key] ?? I18nKey.configSiteDesc;
}

// ── 配置分组 ──
// 参照 src/config/index.ts 导出注释中的分类：
// 核心配置（站点、打赏） / 布局配置（侧边栏） / 样式配置（背景壁纸） /
// 组件配置（导航栏、个人资料、音乐、看板娘、PlantUML） / 功能配置（其余）
export type ConfigGroup =
	| "core"
	| "layout"
	| "style"
	| "component"
	| "feature";

/** 配置项 key → 所属分组 */
const ITEM_GROUPS: Record<string, ConfigGroup> = {
	site: "core",
	sponsor: "core",
	sidebar: "layout",
	wallpaper: "style",
	navbar: "component",
	profile: "component",
	music: "component",
	plantuml: "component",
	"pio-spine": "component",
	"pio-live2d": "component",
	announcement: "feature",
	analytics: "feature",
	app: "feature",
	comment: "feature",
	"cover-image": "feature",
	effects: "feature",
	"code-theme": "feature",
	font: "feature",
	footer: "feature",
	"footer-html": "feature",
	friends: "feature",
	gallery: "feature",
	license: "feature",
};

/** 分组展示顺序与国际化标题 */
export const CONFIG_GROUPS: readonly {
	id: ConfigGroup;
	labelKey: I18nKey;
}[] = [
	{ id: "core", labelKey: I18nKey.configGroupCore },
	{ id: "layout", labelKey: I18nKey.configGroupLayout },
	{ id: "style", labelKey: I18nKey.configGroupStyle },
	{ id: "component", labelKey: I18nKey.configGroupComponent },
	{ id: "feature", labelKey: I18nKey.configGroupFeature },
];

export function getConfigGroup(key: string): ConfigGroup {
	return ITEM_GROUPS[key] ?? "feature";
}
