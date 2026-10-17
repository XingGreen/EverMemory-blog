/**
 * 后台「密钥配置」页面的环境变量清单（纯数据模块）
 * 可同时被浏览器端（Svelte 组件）与服务端（API）共享，
 * 因此不要在此文件中引入任何 node 或浏览器运行时依赖，也不要访问 import.meta.env。
 */

export type SecretGroup = "github" | "auth" | "turnstile";

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
	{
		id: "turnstile",
		label: "人机验证（可选）",
		icon: "material-symbols:verified-user",
	},
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

	// ── 管理后台认证配置（GitHub OAuth + 应急令牌） ──
	{
		key: "GITHUB_APP_CLIENT_ID",
		group: "auth",
		label: "GitHub OAuth Client ID",
		description:
			"GitHub App 的 Client ID（形如 Iv23li…；与应用页顶部的 App ID 不同）",
		kind: "text",
		sensitive: false,
		required: true,
	},
	{
		key: "GITHUB_APP_CLIENT_SECRET",
		group: "auth",
		label: "GitHub OAuth Client Secret",
		description:
			"GitHub App 的 Client Secret，登录回调时用于换取访问令牌。泄露后须到 GitHub 重新生成",
		kind: "password",
		sensitive: true,
		required: true,
	},
	{
		key: "ADMIN_GITHUB_ID",
		group: "auth",
		label: "管理员 GitHub 用户 ID",
		description:
			"允许登录的 GitHub 账号数字 ID（形如 238927366，不随用户名/头像变更）",
		kind: "text",
		sensitive: false,
		required: true,
	},
	{
		key: "ADMIN_BREAKGLASS_TOKEN",
		group: "auth",
		label: "应急登录令牌（备用）",
		description:
			"GitHub 不可用时的备用登录入口：一段高熵随机串（如 32 字节 base64url）。留空则关闭备用登录",
		kind: "password",
		sensitive: true,
		required: false,
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
	{
		key: "ADMIN_ALERT_WEBHOOK",
		group: "auth",
		label: "登录告警 Webhook",
		description:
			"可选。配置后每次后台登录成功都会向该 URL POST 一条 JSON（Slack / Discord / 邮件网关），便于及时察觉异常登录。留空则不发送",
		kind: "text",
		sensitive: false,
		required: false,
	},

	// ── Cloudflare Turnstile 人机验证（可选，未配置则完全跳过） ──
	{
		key: "TURNSTILE_SITE_KEY",
		group: "turnstile",
		label: "Turnstile Site Key",
		description:
			"Cloudflare Turnstile 的 site key（公开值，登录页据此渲染验证码）。需与 Secret Key 成对配置",
		kind: "text",
		sensitive: false,
		required: false,
	},
	{
		key: "TURNSTILE_SECRET_KEY",
		group: "turnstile",
		label: "Turnstile Secret Key",
		description:
			"服务端用于向 Cloudflare 校验 token 的私钥。只配 Site Key 而不配此项会导致登录被拒（不做假验证）",
		kind: "password",
		sensitive: true,
		required: false,
	},
];

export function getSecretItem(key: string): AdminSecretItem | undefined {
	return ADMIN_SECRETS.find((item) => item.key === key);
}

/**
 * 保存时须「二次确认」的密钥。
 *
 * - `AUTH_SECRET_KEYS`：改 GitHub OAuth 凭据 / 管理员 GitHub ID / JWT 密钥 /
 *   应急令牌会直接影响谁能登录、旧会话是否失效。
 * - `DESTRUCTIVE_SECRET_KEYS`：改 GitHub 私钥可把仓库写入重定向到攻击者的 App，
 *   或用无效私钥直接切断同步。仅在可写环境（本地开发）生效——生产构建文件系统只读，
 *   该保存路径本身就不可达，因此这里不是线上防线，而是本地开发的顺手加固。
 *
 * 「二次确认」通过会话的强认证新鲜度（authAt）实现：距上次登录超过 5 分钟则要求
 * 重新登录（GitHub OAuth）。该谓词同时被前端（SecretManager 决定是否提示重新登录）
 * 与服务端（secrets API 强制校验）复用，避免两边各维护一份名单而漂移。
 */
export const AUTH_SECRET_KEYS: readonly string[] = [
	"ADMIN_JWT_SECRET",
	"GITHUB_APP_CLIENT_SECRET",
	"ADMIN_GITHUB_ID",
	"ADMIN_BREAKGLASS_TOKEN",
];

export const DESTRUCTIVE_SECRET_KEYS: readonly string[] = [
	"GITHUB_PRIVATE_KEY",
	"GITHUB_PRIVATE_KEY_PATH",
];

/** 客户端按此决定是否提示「重新登录」；服务端据此强制校验强认证新鲜度。 */
export function requiresFreshAuth(key: string): boolean {
	return (
		AUTH_SECRET_KEYS.includes(key) || DESTRUCTIVE_SECRET_KEYS.includes(key)
	);
}
