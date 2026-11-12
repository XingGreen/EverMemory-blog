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
	/**
	 * 是否由服务端自动托管（不暴露给用户手动填写）。
	 *
	 * 托管项不出现在表单里，只展示「已托管 / 未配置」状态，并提供「轮换」按钮。
	 * 判定标准：值不依赖任何第三方平台，纯随机数即可——目前只有 ADMIN_JWT_SECRET。
	 * 其余密钥都必须从外部平台复制，无法自动生成。
	 */
	managed?: boolean;
	/** 占满整行。只有多行私钥与长 URL 需要，其余一律半宽 */
	wide?: boolean;
	/** 输入框的格式示例（placeholder）。这里只放值长什么样，不再放「未配置」这类状态 */
	example?: string;
};

export const SECRET_GROUPS: readonly {
	id: SecretGroup;
	/** 分组标题文案 key（i18n key 名，组件侧直接取用，避免三元判断漏组） */
	labelKey: "secretsGroupGithub" | "secretsGroupAuth" | "secretsGroupTurnstile";
	/** 标题右侧的短标签：两个字说明这组管什么 */
	sub: string;
	icon: string;
	/** 分组用途说明，作为大板块副标题 */
	descKey: string;
}[] = [
	{
		id: "github",
		labelKey: "secretsGroupGithub",
		sub: "写入仓库",
		icon: "material-symbols:cloud",
		descKey: "secretsGroupGithubDesc",
	},
	{
		id: "auth",
		labelKey: "secretsGroupAuth",
		sub: "后台登录",
		icon: "material-symbols:shield-lock",
		descKey: "secretsGroupAuthDesc",
	},
	{
		id: "turnstile",
		labelKey: "secretsGroupTurnstile",
		sub: "登录防护",
		icon: "material-symbols:verified-user",
		descKey: "secretsGroupTurnstileDesc",
	},
];

/**
 * 页面的行。
 *
 * 一个字段一个输入框是「配置文件视角」；用户真正面对的是几个问题：
 * 「仓库在哪」「私钥有效吗」「装到账号上了吗」。所以行是展示单位，
 * `ADMIN_SECRETS` 仍是存储单位——一行可以吃掉 1–3 个环境变量，
 * 保存时拆回各自的 key，页面不因此少写任何一行 .env。
 *
 * `shape` 决定控件：
 * - address  三个 key 合成一个地址（owner/repo@branch）
 * - single   单输入框
 * - pair     两个 key 并排（成对才有意义的那类）
 * - upload   .pem 文件上传 +「更换文件」
 * - managed  服务端托管，只给「轮换」
 * - optional 可留空，空着显示静态提示
 */
export type SecretRowShape =
	| "address"
	| "single"
	| "pair"
	| "upload"
	| "managed"
	| "optional";

export interface SecretRow {
	id: string;
	group: string;
	/** 左栏标题，写「问题」而不是「字段名」 */
	label: string;
	/** 「我该怎么做」：一句可直接照做的指令，不解释原理 */
	how: string;
	/** 这一行覆盖的环境变量，等宽列在左栏 */
	keys: string[];
	shape: SecretRowShape;
	/** address 行的格式提示 */
	format?: string;
}

export const SECRET_ROWS: SecretRow[] = [
	{
		id: "repo",
		group: "github",
		label: "仓库",
		how: "填你博客所在的仓库：用户名/仓库名@分支",
		keys: ["GITHUB_OWNER", "GITHUB_REPO", "GITHUB_BRANCH"],
		shape: "address",
		format: "用户名/仓库名@分支",
	},
	{
		id: "app-id",
		group: "github",
		label: "App ID",
		how: "打开 GitHub 的 GitHub Apps 页面，在你的 App 顶部复制 App ID",
		keys: ["GITHUB_APP_ID"],
		shape: "single",
	},
	{
		id: "private-key",
		group: "github",
		label: "私钥",
		how: "同一个页面点 Private keys → 生成私钥，下载后在这里上传；或填文件路径",
		keys: ["GITHUB_PRIVATE_KEY", "GITHUB_PRIVATE_KEY_PATH"],
		shape: "upload",
	},
	{
		id: "install",
		group: "github",
		label: "安装",
		how: "把 App 装到你的账号，再从安装页地址末尾复制那串数字",
		keys: ["GITHUB_INSTALLATION_ID"],
		shape: "single",
	},
	{
		id: "oauth",
		group: "auth",
		label: "GitHub OAuth",
		how: "同一个页面复制 Client ID，再点生成 client secret，两个一起换",
		keys: ["GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET"],
		shape: "pair",
	},
	{
		id: "admin-id",
		group: "auth",
		label: "管理员 GitHub 用户 ID",
		how: "打开 api.github.com/user（先登录 GitHub），把返回里的 id 数字填进来",
		keys: ["ADMIN_GITHUB_ID"],
		shape: "single",
	},
	{
		id: "session",
		group: "auth",
		label: "会话签名",
		how: "不用填，保存时会自动生成；怀疑泄露再点轮换",
		keys: ["ADMIN_JWT_SECRET"],
		shape: "managed",
	},
	{
		id: "breakglass",
		group: "auth",
		label: "应急登录令牌",
		how: "一般留空。GitHub 登录出问题时，用它直接进后台",
		keys: ["ADMIN_BREAKGLASS_TOKEN"],
		shape: "single",
	},
	{
		id: "webhook",
		group: "auth",
		label: "登录告警 Webhook",
		how: "可选。把 Slack 或 Discord 的 webhook 地址粘进来，有登录时通知你",
		keys: ["ADMIN_ALERT_WEBHOOK"],
		shape: "optional",
	},
	{
		id: "turnstile",
		group: "turnstile",
		label: "Turnstile 密钥对",
		how: "在 Cloudflare 的 Turnstile 里建一个站点，把两个密钥一起复制过来；不启用就都留空",
		keys: ["TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"],
		shape: "pair",
	},
];

export const ADMIN_SECRETS: AdminSecretItem[] = [
	// ── GitHub App 凭据（写入文章到仓库的凭证） ──
	{
		key: "GITHUB_APP_ID",
		group: "github",
		label: "GitHub App ID",
		description: "GitHub App Settings 页顶部的数字 ID",
		example: "4423412",
		kind: "text",
		sensitive: false,
		required: true,
	},
	{
		key: "GITHUB_OWNER",
		group: "github",
		label: "仓库所有者",
		description: "仓库所有者，用户名或组织名，不带 @",
		example: "XingGreen",
		kind: "text",
		sensitive: false,
		required: true,
	},
	{
		key: "GITHUB_REPO",
		group: "github",
		label: "仓库名称",
		description: "仓库名称，不带 .git 后缀",
		example: "EverMemory-blog",
		kind: "text",
		sensitive: false,
		required: true,
	},
	{
		key: "GITHUB_BRANCH",
		group: "github",
		label: "仓库分支",
		description: "仓库分支，通常为 main 或 master",
		example: "master",
		kind: "text",
		sensitive: false,
		required: true,
	},
	{
		key: "GITHUB_INSTALLATION_ID",
		group: "github",
		label: "Installation ID",
		description: "App 安装页 URL 末尾的数字 ID",
		example: "149804847",
		kind: "text",
		sensitive: false,
		required: true,
	},
	{
		key: "GITHUB_PRIVATE_KEY",
		group: "github",
		label: "GitHub App 私钥",
		description: "只保存在本地，不会上传",
		wide: true,
		kind: "multiline",
		sensitive: true,
		required: true,
	},
	{
		key: "GITHUB_PRIVATE_KEY_PATH",
		group: "github",
		label: "私钥文件路径",
		description: "仅本地开发使用；留空时自动在 .key/ 与 .keys/ 中查找",
		example: ".key/xxx.private-key.pem",
		kind: "text",
		sensitive: false,
		required: false,
	},

	// ── 管理后台认证配置（GitHub OAuth + 应急令牌） ──
	{
		key: "GITHUB_APP_CLIENT_ID",
		group: "auth",
		label: "GitHub OAuth Client ID",
		description: "GitHub App 的 Client ID，与应用 ID 不同",
		example: "Iv23li04IMnCZn3h3u6s",
		kind: "text",
		sensitive: false,
		required: true,
	},
	{
		key: "GITHUB_APP_CLIENT_SECRET",
		group: "auth",
		label: "GitHub OAuth Client Secret",
		description: "换取访问令牌的密钥，泄露后须重新生成",
		kind: "password",
		sensitive: true,
		required: true,
	},
	{
		key: "ADMIN_GITHUB_ID",
		group: "auth",
		label: "管理员 GitHub 用户 ID",
		description: "允许登录的 GitHub 账号数字 ID",
		example: "238927366",
		kind: "text",
		sensitive: false,
		required: true,
	},
	{
		key: "ADMIN_BREAKGLASS_TOKEN",
		group: "auth",
		label: "应急登录令牌（备用）",
		description: "GitHub 不可用时的备用登录令牌，留空则关闭",
		kind: "password",
		sensitive: true,
		required: false,
	},
	{
		key: "ADMIN_JWT_SECRET",
		group: "auth",
		label: "JWT 签名密钥",
		description: "由服务端自动生成托管，仅在需要强制下线时轮换",
		kind: "password",
		sensitive: true,
		required: true,
		managed: true,
	},
	{
		key: "ADMIN_ALERT_WEBHOOK",
		group: "auth",
		label: "登录告警 Webhook",
		description: "登录成功时向该 URL 发送通知，留空则不发送",
		example: "https://hooks.slack.com/services/…",
		wide: true,
		kind: "text",
		sensitive: false,
		required: false,
	},

	// ── Cloudflare Turnstile 人机验证（可选，未配置则完全跳过） ──
	{
		key: "TURNSTILE_SITE_KEY",
		group: "turnstile",
		label: "Turnstile Site Key",
		description: "公开值，需与 Secret Key 成对配置",
		example: "0x4AAAAAAA…",
		kind: "text",
		sensitive: false,
		required: false,
	},
	{
		key: "TURNSTILE_SECRET_KEY",
		group: "turnstile",
		label: "Turnstile Secret Key",
		description: "服务端校验用的私钥，只配 Site Key 会导致登录被拒",
		example: "0x4AAAAAAA…",
		kind: "password",
		sensitive: true,
		required: false,
	},
];

export function getSecretItem(key: string): AdminSecretItem | undefined {
	return ADMIN_SECRETS.find((item) => item.key === key);
}

/** 托管项清单：这些键由服务端自动生成，拒绝通过表单直接写入 */
export const MANAGED_SECRET_KEYS: readonly string[] = ADMIN_SECRETS.filter(
	(item) => item.managed,
).map((item) => item.key);

/** 是否由服务端托管的密钥（表单/保存接口据此拒绝手动写入） */
export function isManagedSecret(key: string): boolean {
	return MANAGED_SECRET_KEYS.includes(key);
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
