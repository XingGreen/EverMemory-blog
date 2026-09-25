/**
 * 后台「密钥配置」页面的环境变量清单（纯数据模块）
 * 可同时被浏览器端（Svelte 组件）与服务端（API）共享，
 * 因此不要在此文件中引入任何 node 或浏览器运行时依赖，也不要访问 import.meta.env。
 */

export type SecretGroup = "github" | "auth";

export type AdminSecretItem = {
	/** 环境变量名 */
	key: string;
	/** 所属分组 */
	group: SecretGroup;
	/** 后台显示的密钥名称 */
	label: string;
	/** 后台显示的密钥说明 */
	description: string;
	/** 输入形态：text=单行 / password=单行密文输入 / multiline=多行大文本（私钥） */
	kind: "text" | "password" | "multiline";
	/** 是否机密：机密值不回显真实内容，仅展示已配置/未配置状态 */
	sensitive: boolean;
	/** 是否为核心必配项（站点同步等基础功能依赖） */
	required: boolean;
};

export const SECRET_GROUPS: readonly {
	id: SecretGroup;
	label: string;
	icon: string;
}[] = [
	{ id: "github", label: "GitHub App 凭据", icon: "material-symbols:cloud" },
	{ id: "auth", label: "管理员认证", icon: "material-symbols:shield-lock" },
];

export const ADMIN_SECRETS: AdminSecretItem[] = [
	// ── GitHub App 凭据（写入文章到仓库的凭证） ──
	{
		key: "GITHUB_APP_ID",
		group: "github",
		label: "GitHub App ID",
		description: "GitHub App Settings 页面顶部的 App ID（纯数字）",
		kind: "text",
		sensitive: false,
		required: true,
	},
	{
		key: "GITHUB_OWNER",
		group: "github",
		label: "仓库所有者",
		description: "GitHub 仓库所有者（用户名或组织名，不带 @）",
		kind: "text",
		sensitive: false,
		required: true,
	},
	{
		key: "GITHUB_REPO",
		group: "github",
		label: "仓库名称",
		description: "GitHub 仓库名称（不带 .git 后缀）",
		kind: "text",
		sensitive: false,
		required: true,
	},
	{
		key: "GITHUB_BRANCH",
		group: "github",
		label: "仓库分支",
		description: "GitHub 仓库分支（新建仓库默认为 main）",
		kind: "text",
		sensitive: false,
		required: true,
	},
	{
		key: "GITHUB_INSTALLATION_ID",
		group: "github",
		label: "Installation ID",
		description: "App 安装页 URL 末尾的数字，如 /installations/149804847",
		kind: "text",
		sensitive: false,
		required: true,
	},
	{
		key: "GITHUB_PRIVATE_KEY",
		group: "github",
		label: "GitHub App 私钥",
		description:
			"用于签发 GitHub App JWT 的 PEM 私钥。粘贴 -----BEGIN 开头的原文即可，保存时自动转换为 Base64（适配 Vercel 环境变量不允许换行的限制）",
		kind: "multiline",
		sensitive: true,
		required: true,
	},
	{
		key: "GITHUB_PRIVATE_KEY_PATH",
		group: "github",
		label: "私钥文件路径",
		description:
			"仅本地开发使用；留空时默认查找 .key/ 与 .keys/ 目录下的 *.pem 文件",
		kind: "text",
		sensitive: false,
		required: false,
	},

	// ── 管理后台认证配置（双重锁：用户名 + 密码 + 私钥） ──
	{
		key: "ADMIN_USERNAME",
		group: "auth",
		label: "管理员用户名",
		description: "后台登录用户名（默认 admin，可自定义）",
		kind: "text",
		sensitive: false,
		required: true,
	},
	{
		key: "ADMIN_PASSWORD",
		group: "auth",
		label: "管理员密码哈希",
		description:
			"后台登录密码的 scrypt 加盐哈希（格式 scrypt$…）。直接粘贴明文密码也可以，保存时自动转换；或用下方生成工具转换",
		kind: "password",
		sensitive: true,
		required: true,
	},
	{
		key: "ADMIN_JWT_SECRET",
		group: "auth",
		label: "JWT 签名密钥",
		description:
			"用于签发后台会话 Cookie 的随机密钥（32 字节以上）。可直接点击下方生成工具一键生成",
		kind: "password",
		sensitive: true,
		required: true,
	},
];

export function getSecretItem(key: string): AdminSecretItem | undefined {
	return ADMIN_SECRETS.find((item) => item.key === key);
}
