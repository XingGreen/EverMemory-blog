// 后台「网站配置」可在线编辑的配置文件清单（目前前 5 个）
// 纯数据模块：可同时被浏览器端（Svelte 组件）与服务端（API / 脚本）共享，
// 因此不要在此文件中引入任何 node 或浏览器运行时依赖。

export type AdminConfigItem = {
	key: string;
	/** 相对项目根目录的配置文件路径 */
	file: string;
	/** 配置文件中导出的配置对象变量名 */
	exportName: string;
	/** 配置对象的类型名（用于写回文件时的类型注解） */
	typeName: string;
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
