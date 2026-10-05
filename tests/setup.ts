/**
 * 测试全局前置：确保测试不会误读开发者本机的真实配置。
 *
 * auth.ts 通过 getEnv 读 JWT 密钥、通过 secret-io 的 readSecretPreview 读
 * ADMIN_TOKEN_VER。若不隔离，测试结果会随本机 .env.local 而变——CI 上没有该
 * 文件，本地有，会造成「本地过、CI 挂」或反之。故此处显式清空。
 */
process.env.ADMIN_JWT_SECRET = "test-only-jwt-secret-not-for-production";
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;