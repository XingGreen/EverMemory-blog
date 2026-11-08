import type { LicenseConfig } from "../types/licenseConfig";

export const licenseConfig: LicenseConfig = {
	// 是否启用文章顶部许可证信息显示
	enable: true,

	// 许可证名称及链接
	name: "CC BY-NC-SA 4.0",
	url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",

	// 可选：自定义许可证图标（iconify 图标名）
	// 留空时根据许可证名称自动匹配：
	//   CC 系列 → fa7-brands:creative-commons；CC0 → creative-commons-zero；
	//   Public Domain → creative-commons-pd；MIT / Apache / BSD / GPL / MPL 等 → osi；
	//   其余 → fa7-regular:copyright
	icon: "",
};
