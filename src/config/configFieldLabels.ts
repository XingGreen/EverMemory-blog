import { siteConfig } from "./siteConfig";
import { JAPANESE_LABELS } from "./configFieldLabels_ja";
import { RUSSIAN_LABELS } from "./configFieldLabels_ru";

/**
 * 「网站配置」在线编辑器的字段名翻译。
 *
 * 配置页面会以可视表单的形式展示各个配置文件（site/profile/navbar/footer/sidebar）
 * 中的字段，而字段键名本身是英文（如 themeColor、pageWidth）。为了让中文站点在
 * 配置页看到的是中文标签，这里维护一份「英文键名 -> 中文标签」的字典；
 * 非中文语言站点则回退为可读的英文标签（保持中性）。
 *
 * 注意：这里翻译的是*字段名*，配置项的具体*值*（如 url、title 文本）属于用户数据，不会翻译。
 */

const ZH_LABELS: Record<string, string> = {
	// —— 站点（SiteConfig）——
	title: "站点标题",
	subtitle: "副标题",
	site_url: "站点网址",
	description: "站点描述",
	keywords: "关键词",
	lang: "语言",
	themeColor: "主题色",
	hue: "色相",
	fixed: "固定色相",
	defaultMode: "默认模式",
	pageWidth: "页面宽度",
	card: "卡片样式",
	border: "卡片边框",
	followTheme: "跟随主题色",
	siteStartDate: "建站日期",
	timezone: "时区",
	favicon: "站点图标",
	src: "图片地址",
	sizes: "尺寸",
	theme: "主题",
	navbar: "导航栏",
	logo: "导航栏 Logo",
	type: "类型",
	value: "内容",
	alt: "图片描述",
	widthFull: "宽度占满",
	menuAlign: "菜单对齐",
	stickyNavbar: "固定导航栏",
	mode: "模式",
	pages: "页面开关",
	friends: "友链页面",
	sponsor: "打赏页面",
	guestbook: "留言板页面",
	bangumi: "番组计划页",
	gallery: "相册页面",
	anime: "追番页面",
	app: "应用推荐页面",
	music: "音乐页面",
	categoryBar: "分类导航栏",
	foldArticle: "折叠旧年份归档",
	postListLayout: "文章列表布局",
	mobileDefaultMode: "移动端默认模式",
	showTags: "显示标签",
	descriptionLines: "简介行数",
	allowSwitch: "允许切换布局",
	grid: "网格布局",
	masonry: "瀑布流",
	columnWidth: "卡片最小宽度",
	post: "文章配置",
	rehypeCallouts: "提醒框",
	enablePythonMarkdownAdmonitions: "启用 Python 提醒语法",
	showLastModified: "显示最近编辑",
	outdatedThreshold: "过期阈值(天)",
	sharePoster: "分享海报",
	generateOgImages: "生成 OG 图片",
	userId: "用户 ID",
	apiUrl: "API 地址",
	subjectBaseUrl: "条目详情地址",
	categoryOrder: "类型排序",
	bilibili: "Bilibili",
	uid: "UID",
	tmdb: "TMDB",
	apiKey: "API 密钥",
	listId: "列表 ID",
	pagination: "分页配置",
	postsPerPage: "每页文章数",
	imageOptimization: "图片优化",
	formats: "输出格式",
	quality: "压缩质量",
	noReferrerDomains: "防盗链域名",

	// —— 个人资料（ProfileConfig）——
	avatar: "头像",
	name: "名字",
	bio: "个人签名",
	links: "链接列表",
	url: "链接地址",
	icon: "图标",
	showName: "显示名称",

	// —— 页脚（FooterConfig）——
	enable: "启用",
	customHtml: "自定义 HTML",

	// —— 侧边栏（SidebarLayoutConfig）——
	position: "侧边栏位置",
	tabletSidebar: "平板端侧边栏",
	hideSidebarOnPostPage: "文章页隐藏侧边栏",
	showBothSidebarsOnPostPage: "文章页显示双侧栏",
	leftComponents: "左侧组件",
	rightComponents: "右侧组件",
	mobileBottomComponents: "移动端底部组件",
	showTitle: "显示标题",
	showOnPostPage: "文章页显示",
	hideOnNonPostPage: "仅文章页显示",
	specificConfig: "专属配置",
	customProps: "自定义属性",
	hidden: "隐藏设备",
	collapseThreshold: "折叠阈值",
	calendar: "日历",
	showHeatmap: "年度热力图",
	ad: "广告配置",
	content: "内容",
	link: "链接按钮",
	text: "按钮文字",
	external: "新窗口打开",
	padding: "内边距",
	displayCount: "显示次数",
	closable: "可关闭",
	expireDate: "过期时间",
	image: "广告图片",
	header: "标题",
	siteInfo: "站点信息",
	unknownBuildPlatform: "未知平台文案",

	// —— 导航栏（NavBarConfig）——
	children: "子菜单",
	pageKey: "页面标识",
	method: "搜索方式",
};

/**
 * 将英文键名格式化为可读的英文标签：themeColor -> Theme Color，site_url -> Site Url
 */
function prettifyEnglishLabel(key: string): string {
	const spaced = key
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.trim();
	return spaced
		.split(" ")
		.map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
		.join(" ");
}

/**
 * 返回配置字段在「网站配置」表单中的显示标签。
 * 中文语言 -> 中文标签；日语 -> 日语标签；俄语 -> 俄语标签；其余 -> 可读英文标签。
 */
export function configFieldLabel(key: string): string {
	const lang = (siteConfig.lang || "en").toLowerCase();

	if (lang === "ja" || lang === "ja_jp") return JAPANESE_LABELS[key] || prettifyEnglishLabel(key);
	if (lang === "ru" || lang === "ru_ru") return RUSSIAN_LABELS[key] || prettifyEnglishLabel(key);
	if (lang.startsWith("zh")) return ZH_LABELS[key] || prettifyEnglishLabel(key);

	return prettifyEnglishLabel(key);
}