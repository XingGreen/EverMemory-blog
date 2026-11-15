/**
 * 测试全局前置：确保测试不会误读开发者本机的真实配置。
 *
 * auth.ts 通过 getEnv 读 JWT 密钥、通过 secret-io 的 readSecretPreview 读
 * ADMIN_TOKEN_VER。若不隔离，测试结果会随本机 .env.local 而变——CI 上没有该
 * 文件，本地有，会造成「本地过、CI 挂」或反之。故此处显式清空。
 */
import { ADMIN_SECRETS } from "@utils/admin-secrets";

process.env.ADMIN_JWT_SECRET = "test-only-jwt-secret-not-for-production";
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

/**
 * 必填项默认给占位值。
 *
 * 缺任意必填项会真实触发「引导模式」（bootstrapNeeded），而引导模式让
 * /api/admin/session 对匿名请求也回 success=true —— 用例会随本机 .env
 * 是否配齐而飘。默认视为「已配好」，需要测缺失场景的用例自己删。
 */
for (const item of ADMIN_SECRETS) {
	if (item.required && !item.managed && !process.env[item.key]) {
		process.env[item.key] = "test-only-placeholder";
	}
}
