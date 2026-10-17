import {
	ADMIN_SECRETS,
	AUTH_SECRET_KEYS,
	DESTRUCTIVE_SECRET_KEYS,
	requiresFreshAuth,
} from "@utils/admin-secrets";
import { describe, expect, it } from "vitest";

// 用字面量而非导出的常量做正向断言：常量若被误删/改名，这里仍应失败
describe("requiresFreshAuth", () => {
	it("管理员认证密钥需要强认证新鲜度", () => {
		expect(requiresFreshAuth("ADMIN_JWT_SECRET")).toBe(true);
		expect(requiresFreshAuth("GITHUB_APP_CLIENT_SECRET")).toBe(true);
		expect(requiresFreshAuth("ADMIN_GITHUB_ID")).toBe(true);
		expect(requiresFreshAuth("ADMIN_BREAKGLASS_TOKEN")).toBe(true);
	});

	it("破坏性密钥（GitHub 私钥）需要强认证新鲜度", () => {
		expect(requiresFreshAuth("GITHUB_PRIVATE_KEY")).toBe(true);
		expect(requiresFreshAuth("GITHUB_PRIVATE_KEY_PATH")).toBe(true);
	});

	it("普通密钥不需要强认证新鲜度", () => {
		expect(requiresFreshAuth("GITHUB_REPO")).toBe(false);
		expect(requiresFreshAuth("TURNSTILE_SITE_KEY")).toBe(false);
		expect(requiresFreshAuth("ADMIN_ALERT_WEBHOOK")).toBe(false);
		expect(requiresFreshAuth("UNKNOWN_KEY")).toBe(false);
	});

	it("导出的两组清单本身正确", () => {
		expect(AUTH_SECRET_KEYS).toContain("ADMIN_JWT_SECRET");
		expect(DESTRUCTIVE_SECRET_KEYS).toContain("GITHUB_PRIVATE_KEY");
		// 认证与破坏性两组不重叠，便于「按组提示文案」区分
		for (const key of DESTRUCTIVE_SECRET_KEYS) {
			expect(AUTH_SECRET_KEYS.includes(key)).toBe(false);
		}
	});
});

describe("密钥配置页清单", () => {
	it("包含 OAuth 与应急令牌相关变量", () => {
		const keys = ADMIN_SECRETS.map((item) => item.key);
		expect(keys).toContain("GITHUB_APP_CLIENT_ID");
		expect(keys).toContain("GITHUB_APP_CLIENT_SECRET");
		expect(keys).toContain("ADMIN_GITHUB_ID");
		expect(keys).toContain("ADMIN_BREAKGLASS_TOKEN");
		expect(keys).toContain("ADMIN_ALERT_WEBHOOK");
	});

	it("不再暴露密码哈希类密钥", () => {
		const keys = ADMIN_SECRETS.map((item) => item.key);
		expect(keys).not.toContain("ADMIN_PASSWORD");
		expect(keys).not.toContain("ADMIN_SUPER_PASSWORD");
		expect(keys).not.toContain("ADMIN_SCRYPT_N");
	});
});
