import {
	ADMIN_SECRETS,
	AUTH_SECRET_KEYS,
	DESTRUCTIVE_SECRET_KEYS,
	PASSWORD_HASH_KEYS,
	requiresPasswordToSave,
} from "@utils/admin-secrets";
import { describe, expect, it } from "vitest";

// 用字面量而非导出的常量做正向断言：常量若被误删/改名，这里仍应失败
describe("requiresPasswordToSave", () => {
	it("管理员认证密钥需要二次验证", () => {
		expect(requiresPasswordToSave("ADMIN_USERNAME")).toBe(true);
		expect(requiresPasswordToSave("ADMIN_PASSWORD")).toBe(true);
		expect(requiresPasswordToSave("ADMIN_JWT_SECRET")).toBe(true);
	});

	it("第二密码与主密码同等保护", () => {
		expect(requiresPasswordToSave("ADMIN_SUPER_PASSWORD")).toBe(true);
		expect(AUTH_SECRET_KEYS).toContain("ADMIN_SUPER_PASSWORD");
	});

	it("破坏性密钥（GitHub 私钥）需要二次验证", () => {
		expect(requiresPasswordToSave("GITHUB_PRIVATE_KEY")).toBe(true);
		expect(requiresPasswordToSave("GITHUB_PRIVATE_KEY_PATH")).toBe(true);
	});

	it("普通密钥不需要二次验证", () => {
		expect(requiresPasswordToSave("GITHUB_REPO")).toBe(false);
		expect(requiresPasswordToSave("TURNSTILE_SITE_KEY")).toBe(false);
		expect(requiresPasswordToSave("ADMIN_SCRYPT_N")).toBe(false);
		expect(requiresPasswordToSave("ADMIN_ALERT_WEBHOOK")).toBe(false);
		expect(requiresPasswordToSave("UNKNOWN_KEY")).toBe(false);
	});

	it("导出的两组清单本身正确", () => {
		expect(AUTH_SECRET_KEYS).toContain("ADMIN_PASSWORD");
		expect(DESTRUCTIVE_SECRET_KEYS).toContain("GITHUB_PRIVATE_KEY");
		// 认证与破坏性两组不重叠，便于「按组提示文案」区分
		for (const key of DESTRUCTIVE_SECRET_KEYS) {
			expect(AUTH_SECRET_KEYS.includes(key)).toBe(false);
		}
	});
});

describe("密钥配置页清单", () => {
	it("包含新纳入的 3 个变量", () => {
		const keys = ADMIN_SECRETS.map((item) => item.key);
		expect(keys).toContain("ADMIN_SUPER_PASSWORD");
		expect(keys).toContain("ADMIN_SCRYPT_N");
		expect(keys).toContain("ADMIN_ALERT_WEBHOOK");
	});

	it("scrypt 哈希密钥清单同时含主密码与第二密码", () => {
		expect(PASSWORD_HASH_KEYS).toContain("ADMIN_PASSWORD");
		expect(PASSWORD_HASH_KEYS).toContain("ADMIN_SUPER_PASSWORD");
	});
});
