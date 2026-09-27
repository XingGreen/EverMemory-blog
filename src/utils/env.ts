// 服务端环境变量统一读取。
// Vercel / Cloudflare Workers 等平台运行时把项目环境变量注入 process.env，
// 而 Vite 仅把 .env 文件（本地 dev）注入 import.meta.env —— 云端构建无 .env 文件时
// import.meta.env?.XXX 恒为空，导致线上读不到 ADMIN_*/GITHUB_* 等配置。
// 读取顺序：process.env（线上运行时）→ import.meta.env（本地 dev 由 Vite 注入）。
// 注意：import.meta.env 不支持动态索引，静态键需在下方集中声明。

const STATIC_ENV_GETTERS: Record<string, () => string> = {
	GITHUB_APP_ID: () => import.meta.env?.GITHUB_APP_ID || "",
	GITHUB_OWNER: () => import.meta.env?.GITHUB_OWNER || "",
	GITHUB_REPO: () => import.meta.env?.GITHUB_REPO || "",
	GITHUB_BRANCH: () => import.meta.env?.GITHUB_BRANCH || "",
	GITHUB_INSTALLATION_ID: () => import.meta.env?.GITHUB_INSTALLATION_ID || "",
	GITHUB_PRIVATE_KEY: () => import.meta.env?.GITHUB_PRIVATE_KEY || "",
	GITHUB_PRIVATE_KEY_PATH: () => import.meta.env?.GITHUB_PRIVATE_KEY_PATH || "",
	ADMIN_USERNAME: () => import.meta.env?.ADMIN_USERNAME || "",
	ADMIN_PASSWORD: () => import.meta.env?.ADMIN_PASSWORD || "",
	ADMIN_JWT_SECRET: () => import.meta.env?.ADMIN_JWT_SECRET || "",
};

/** 服务端密钥类环境变量的可用键列表（供状态面板遍历展示） */
export const ENV_KEYS = Object.keys(STATIC_ENV_GETTERS);

/**
 * 读取服务端环境变量：process.env 优先（平台运行时注入），
 * import.meta.env 回退（本地 dev / 手工构建注入 .env 文件）。
 */
export function getEnv(key: string): string {
	const fromProxy = (process.env as Record<string, string | undefined>)[key];
	if (fromProxy) return fromProxy;
	return STATIC_ENV_GETTERS[key]?.() ?? "";
}