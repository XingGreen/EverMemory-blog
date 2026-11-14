/**
 * 引导模式（bootstrap）
 *
 * 背景：环境变量页在登录之后，而登录本身需要这些密钥 —— 死锁。
 * 本模块给出「可以未登录改配置」的唯一判定，三个条件同时成立才允许：
 *
 * 1. 非生产构建 —— 生产目录只读，改配置本来就无效，门也就不该开
 * 2. 必要项确实缺失 —— 配齐之后立刻关闭，不会变成常开的后门
 * 3. 请求来自回环地址 —— 只有本机能用
 *
 * 即使成立，也只允许写「必要项」；可选字段（webhook / turnstile 等）留给登录后。
 */
import { ADMIN_SECRETS } from "./admin-secrets";
import { getEnv, IS_PROD_BUILD } from "./env";

/**
 * 引导期允许写入的键：必填且非托管。
 * 托管项（ADMIN_JWT_SECRET）由服务端首次认证时自己生成，不需要也不允许人填。
 */
export const BOOTSTRAP_KEYS: readonly string[] = ADMIN_SECRETS.filter(
	(item) => item.required && !item.managed,
).map((item) => item.key);

export function isLoopbackRequest(request: Request): boolean {
	const host = request.headers.get("host") ?? new URL(request.url).host;
	const hostname = host
		.split(":")[0]
		.replace(/^\[|\]$/g, "")
		.toLowerCase();
	return (
		hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1"
	);
}

/** 必要项是否仍缺（缺 = 还没配好，登录不了） */
export function bootstrapNeeded(): boolean {
	if (IS_PROD_BUILD) return false;
	return ADMIN_SECRETS.some(
		(item) => item.required && !getEnv(item.key).trim(),
	);
}

export function canBootstrap(request: Request): boolean {
	return isLoopbackRequest(request) && bootstrapNeeded();
}
