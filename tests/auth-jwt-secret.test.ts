import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 签名密钥必须「文件里已经有就复用」，而不是每次冷启动重新生成。
 *
 * 真实故障链：`.env.local` 里有 ADMIN_JWT_SECRET，但 getEnv() 只读
 * process.env / import.meta.env 快照，看不见文件里刚写的值 →
 * 判定「未配置」→ 重新生成并覆盖文件 → 之前签发的 token 全部验签失败 →
 * 后台接口 401 → 前端在 /admin/ 与 /login/ 之间反复跳转。
 *
 * 这里用「两次独立模块实例」模拟两次进程启动：只要第二次覆盖了文件，
 * 就说明复用逻辑没生效。
 */
let tmpDir = "";

beforeEach(() => {
	vi.resetModules();
	delete process.env.ADMIN_JWT_SECRET;
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jwt-secret-test-"));
	vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
});

afterEach(() => {
	if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
	vi.restoreAllMocks();
});

const envFile = () => path.join(tmpDir, ".env.local");

function secretLine(): string {
	const raw = fs.existsSync(envFile())
		? fs.readFileSync(envFile(), "utf8")
		: "";
	return (
		raw.split(/\r?\n/).find((l) => l.startsWith("ADMIN_JWT_SECRET=")) ?? ""
	);
}

/** 用给定密钥重算 token 的签名段，用于判断「这一步用的是哪把密钥」 */
function signWith(secret: string, token: string): string {
	const [header, payload] = token.split(".");
	return crypto
		.createHmac("sha256", secret)
		.update(`${header}.${payload}`)
		.digest("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=/g, "");
}

describe("ADMIN_JWT_SECRET 的自动初始化", () => {
	it("文件里已有密钥时不得重新生成（否则会话全部失效）", async () => {
		fs.writeFileSync(
			envFile(),
			"ADMIN_JWT_SECRET=existing-secret-value\n",
			"utf8",
		);

		const first = await import("@utils/auth");
		first.generateSessionToken();
		const afterFirst = secretLine();

		// 模拟进程重启：模块缓存清空，但 .env.local 还在
		vi.resetModules();
		const second = await import("@utils/auth");
		second.generateSessionToken();
		const afterSecond = secretLine();

		expect(afterFirst).toBe("ADMIN_JWT_SECRET=existing-secret-value");
		expect(afterSecond).toBe(afterFirst);
	});

	it("文件缺密钥时才生成，且签发的 token 用的就是文件里那把", async () => {
		const auth = await import("@utils/auth");
		const token = auth.generateSessionToken();

		const line = secretLine();
		expect(line.startsWith("ADMIN_JWT_SECRET=")).toBe(true);
		const secret = line.slice("ADMIN_JWT_SECRET=".length);
		expect(secret.length).toBeGreaterThan(32);

		// 关键断言：签发时用的密钥 = 落盘的那把。不相等说明生成后又换了一把。
		expect(token.split(".")[2]).toBe(signWith(secret, token));
	});

	it("第二个实例签发的 token 仍能用文件里的密钥验证", async () => {
		const first = await import("@utils/auth");
		first.generateSessionToken();
		const secret = secretLine().slice("ADMIN_JWT_SECRET=".length);

		vi.resetModules();
		const second = await import("@utils/auth");
		const tokenB = second.generateSessionToken();

		// 两次启动之间密钥不变 → 同一条签名算法验证通过
		expect(tokenB.split(".")[2]).toBe(signWith(secret, tokenB));
	});
});
