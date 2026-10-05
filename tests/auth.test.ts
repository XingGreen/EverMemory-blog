import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * token 版本号来自 secret-io 的 readSecretPreview（读 .env.local）。
 * 测试里替换为可编程的取值，从而覆盖「改密/改钥后旧令牌立即失效」这条链路。
 */
let tokenVersion = "0";
vi.mock("@utils/secret-io", async (importOriginal) => ({
	...(await importOriginal<typeof import("@utils/secret-io")>()),
	readSecretPreview: (key: string) => (key === "ADMIN_TOKEN_VER" ? tokenVersion : ""),
	incrementTokenVersion: () => {
		tokenVersion = String(Number(tokenVersion) + 1);
		return Number(tokenVersion);
	},
}));

/** 会话表桩：verifySessionToken 只关心 sid 是否存在 */
const sessions = new Set<string>();
vi.mock("@utils/session-store", () => ({
	getSession: async (sid: string) => (sessions.has(sid) ? { sid } : null),
	touchSession: async () => {},
}));

// auth.ts 内部有模块级 cachedSecret（JWT 密钥）与 getTokenVersion 的
// 实时读取语义，两者都要求每个用例从干净模块状态开始，故每次动态 import。
const loadAuth = () => import("@utils/auth");

type AuthModule = Awaited<ReturnType<typeof loadAuth>>;

const SESSION_MAX_AGE = 12 * 3600;
const REMEMBER_MAX_AGE = 7 * 24 * 3600;

/** 造一个已在会话表中的 sid，并签发对应 token */
async function issue(
	auth: AuthModule,
	opts: { remember?: boolean; maxAge?: number } = {},
): Promise<string> {
	const sid = crypto.randomUUID();
	sessions.add(sid);
	return auth.generateSessionToken(opts.maxAge ?? SESSION_MAX_AGE, sid);
}

/**
 * 用真实密钥手工签一个任意 payload 的 token。
 * generateSessionToken 只能产出 role=admin，要覆盖角色/缺 sid 这类
 * 校验分支只能自己签——签名必须正确，否则失败原因会变成验签失败，
 * 测试就失去了意义（会假绿）。
 */
async function signRaw(payload: Record<string, unknown>): Promise<string> {
	const nodeCrypto = await import("node:crypto");
	const b64 = (obj: object) =>
		Buffer.from(JSON.stringify(obj))
			.toString("base64")
			.replace(/=/g, "")
			.replace(/\+/g, "-")
			.replace(/\//g, "_");
	const header = b64({ alg: "HS256", typ: "JWT" });
	const body = b64(payload);
	const signature = nodeCrypto
		.createHmac("sha256", process.env.ADMIN_JWT_SECRET as string)
		.update(`${header}.${body}`)
		.digest("base64")
		.replace(/=/g, "")
		.replace(/\+/g, "-")
		.replace(/\//g, "_");
	return `${header}.${body}.${signature}`;
}

beforeEach(() => {
	tokenVersion = "0";
	sessions.clear();
	vi.resetModules();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("generateSessionToken", () => {
	it("签发的 token 可被自身验签通过", async () => {
		const auth = await loadAuth();
		const token = await issue(auth);

		const payload = await auth.verifySessionToken(token);
		expect(payload).not.toBeNull();
		expect(payload?.role).toBe("admin");
		expect(payload?.sid).toBeTruthy();
	});

	it("默认 12 小时过期，记住我为 7 天", async () => {
		const auth = await loadAuth();

		const normal = await auth.verifySessionToken(await issue(auth));
		expect(normal?.exp).toBeGreaterThan(normal?.iat ?? 0);
		const normalSpan = (normal?.exp ?? 0) - (normal?.iat ?? 0);
		expect(normalSpan).toBe(SESSION_MAX_AGE);

		const remembered = await auth.verifySessionToken(
			await issue(auth, { maxAge: REMEMBER_MAX_AGE }),
		);
		const rememberedSpan = (remembered?.exp ?? 0) - (remembered?.iat ?? 0);
		expect(rememberedSpan).toBe(REMEMBER_MAX_AGE);
	});

	it("每次签发生成不同的 sid 与 sub", async () => {
		const auth = await loadAuth();
		const a = await auth.verifySessionToken(await issue(auth));
		const b = await auth.verifySessionToken(await issue(auth));

		expect(a?.sid).not.toBe(b?.sid);
		expect(a?.sub).not.toBe(b?.sub);
	});
});

describe("verifySessionToken - 签名防护", () => {
	it("签名被篡改返回 null", async () => {
		const auth = await loadAuth();
		const token = await issue(auth);
		const [h, p, s] = token.split(".");
		const tampered = `${h}.${p}.${s.slice(0, -2)}xx`;

		expect(await auth.verifySessionToken(tampered)).toBeNull();
	});

	it("payload 被篡改（提权为 admin）返回 null", async () => {
		const auth = await loadAuth();
		const token = await issue(auth);
		const [h, p, s] = token.split(".");
		const forged = Buffer.from(
			JSON.stringify({ role: "admin", sub: "x", ver: "0", sid: "x", iat: 0, exp: 9e9 }),
		)
			.toString("base64")
			.replace(/=/g, "")
			.replace(/\+/g, "-")
			.replace(/\//g, "_");

		expect(await auth.verifySessionToken(`${h}.${forged}.${s}`)).toBeNull();
	});

	it("结构非法的 token 返回 null 而不抛错", async () => {
		const auth = await loadAuth();

		expect(await auth.verifySessionToken("")).toBeNull();
		expect(await auth.verifySessionToken("garbage")).toBeNull();
		expect(await auth.verifySessionToken("a.b")).toBeNull();
	});

	it("密钥变更后旧 token 立即失效", async () => {
		const auth = await loadAuth();
		const token = await issue(auth);
		expect(await auth.verifySessionToken(token)).not.toBeNull();

		// 模拟管理员重新生成密钥：模块缓存被清空后重新加载，
		// 新密钥签不出旧签名
		vi.resetModules();
		process.env.ADMIN_JWT_SECRET = "rotated-secret-value";
		const rotated = await loadAuth();

		expect(await rotated.verifySessionToken(token)).toBeNull();
		process.env.ADMIN_JWT_SECRET = "test-only-jwt-secret-not-for-production";
	});
});

describe("verifySessionToken - 过期判定", () => {
	it("已过期的 token 返回 null", async () => {
		const auth = await loadAuth();
		// 签发一个 1 秒后过期、2 秒前就已过期的 token
		const token = await issue(auth, { maxAge: -3600 });

		expect(await auth.verifySessionToken(token)).toBeNull();
	});

	it("过期边界：当前秒严格大于 exp 才失效", async () => {
		const auth = await loadAuth();
		// exp/iat 在实现里是秒级 Math.floor(Date.now()/1000)，
		// 且判定用严格小于（payload.exp < now），故恰好等于 exp 的那一秒
		// 仍视为有效。这是有意的 1 秒宽限，记录在此以免被误当成 bug。
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
			const token = await issue(auth, { maxAge: 100 });

			vi.advanceTimersByTime(99_000);
			expect(await auth.verifySessionToken(token)).not.toBeNull();

			// 恰好等于 exp：仍有效
			vi.advanceTimersByTime(1_000);
			expect(await auth.verifySessionToken(token)).not.toBeNull();

			// 跨过 exp 一秒：失效
			vi.advanceTimersByTime(1_000);
			expect(await auth.verifySessionToken(token)).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("verifySessionToken - 撤销版本号", () => {
	it("token 版本与当前不一致返回 null（改密后旧令牌失效）", async () => {
		const auth = await loadAuth();
		const token = await issue(auth);
		expect(await auth.verifySessionToken(token)).not.toBeNull();

		tokenVersion = "1"; // 模拟 incrementTokenVersion()

		expect(await auth.verifySessionToken(token)).toBeNull();
	});

	it("版本号一致时不受影响", async () => {
		const auth = await loadAuth();
		tokenVersion = "5";

		const sid = crypto.randomUUID();
		sessions.add(sid);
		const token = auth.generateSessionToken(SESSION_MAX_AGE, sid);

		expect(await auth.verifySessionToken(token)).not.toBeNull();
	});
});

describe("verifySessionToken - 会话表检查", () => {
	it("sid 不在会话表中返回 null（被踢下线）", async () => {
		const auth = await loadAuth();
		const sid = crypto.randomUUID();
		const token = auth.generateSessionToken(SESSION_MAX_AGE, sid);
		// 故意不加入 sessions

		expect(await auth.verifySessionToken(token)).toBeNull();
	});

	it("非 admin 角色返回 null", async () => {
		const auth = await loadAuth();
		const sid = crypto.randomUUID();
		sessions.add(sid);

		const now = Math.floor(Date.now() / 1000);
		const token = await signRaw({
			sub: "someone",
			role: "user",
			ver: tokenVersion,
			sid,
			iat: now,
			exp: now + 3600,
		});

		expect(await auth.verifySessionToken(token)).toBeNull();
	});

	it("无 sid 的旧令牌一律视为无效，强制重新登录", async () => {
		const auth = await loadAuth();
		// 构造一个没有 sid 字段的、签名完全合法的 token（模拟升级前签发的）
		const now = Math.floor(Date.now() / 1000);
		const token = await signRaw({
			sub: "legacy",
			role: "admin",
			ver: tokenVersion,
			iat: now,
			exp: now + 3600,
		});

		expect(await auth.verifySessionToken(token)).toBeNull();
	});

	it("无 sid 时不得落到会话表查询（否则 sid 校验形同虚设）", async () => {
		// 仅断言「验签失败」无法区分是哪一层拦住的：移除 sid 校验后
		// getSession(undefined) 同样会返回 null，最终结果不变但防护已失效。
		// 故这里断言「会话表根本没被查」。
		const getSessionSpy = vi.fn(async (sid: string) => (sessions.has(sid) ? { sid } : null));
		vi.doMock("@utils/session-store", () => ({
			getSession: getSessionSpy,
			touchSession: async () => {},
		}));
		vi.resetModules();

		const auth = await loadAuth();
		const now = Math.floor(Date.now() / 1000);
		const token = await signRaw({
			sub: "legacy",
			role: "admin",
			ver: tokenVersion,
			iat: now,
			exp: now + 3600,
		});

		expect(await auth.verifySessionToken(token)).toBeNull();
		expect(getSessionSpy).not.toHaveBeenCalled();
	});
});

describe("getAuthTokenFromRequest", () => {
	const makeRequest = (cookie?: string) =>
		new Request("http://localhost/api/admin/x", {
			headers: cookie ? { cookie } : undefined,
		});

	it("正确解析 admin_session", async () => {
		const auth = await loadAuth();

		expect(
			auth.getAuthTokenFromRequest(makeRequest("admin_session=abc123")),
		).toBe("abc123");
	});

	it("多cookie 时取到目标项", async () => {
		const auth = await loadAuth();

		expect(
			auth.getAuthTokenFromRequest(
				makeRequest("other=1; admin_session=xyz; another=2"),
			),
		).toBe("xyz");
	});

	it("URL 编码的值会被解码", async () => {
		const auth = await loadAuth();

		expect(
			auth.getAuthTokenFromRequest(
				makeRequest("admin_session=a%2Bb%2Fc"),
			),
		).toBe("a+b/c");
	});

	it("缺少目标 cookie 返回 null", async () => {
		const auth = await loadAuth();

		expect(auth.getAuthTokenFromRequest(makeRequest("other=1"))).toBeNull();
		expect(auth.getAuthTokenFromRequest(makeRequest())).toBeNull();
		expect(auth.getAuthTokenFromRequest(makeRequest("admin_session="))).toBeNull();
	});
});

describe("requireAuth", () => {
	const requestWith = (token?: string) =>
		new Request("http://localhost/api/admin/x", {
			headers: token ? { cookie: `admin_session=${token}` } : undefined,
		});

	it("无 cookie 时返回 401 且带中文原因", async () => {
		const auth = await loadAuth();
		const result = await auth.requireAuth(requestWith());

		expect(result.authenticated).toBe(false);
		expect(result.response?.status).toBe(401);
		const body = await result.response?.json();
		expect(body.message).toBe("未授权或会话已过期");
	});

	it("token 无效时返回 401", async () => {
		const auth = await loadAuth();
		const sid = crypto.randomUUID();
		const token = auth.generateSessionToken(SESSION_MAX_AGE, sid);

		const result = await auth.requireAuth(requestWith(token));

		expect(result.authenticated).toBe(false);
		expect(result.response?.status).toBe(401);
	});

	it("token 有效时通过并回传 payload", async () => {
		const auth = await loadAuth();
		const token = await issue(auth);

		const result = await auth.requireAuth(requestWith(token));

		expect(result.authenticated).toBe(true);
		expect(result.payload?.sid).toBeTruthy();
		expect(result.response).toBeUndefined();
	});
});

describe("会话 Cookie 属性", () => {
	it("setAuthCookie 使用 HttpOnly + Secure + SameSite=Strict", async () => {
		const auth = await loadAuth();
		const headers = new Headers();

		auth.setAuthCookie("the-token", headers);

		const cookie = headers.get("set-cookie") ?? "";
		expect(cookie).toContain("admin_session=the-token");
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("Secure");
		expect(cookie).toContain("SameSite=Strict");
		expect(cookie).toContain(`Max-Age=${SESSION_MAX_AGE}`);
	});

	it("clearAuthCookie 立即过期", async () => {
		const auth = await loadAuth();
		const headers = new Headers();

		auth.clearAuthCookie(headers);

		const cookie = headers.get("set-cookie") ?? "";
		expect(cookie).toContain("admin_session=");
		expect(cookie).toContain("Max-Age=0");
		expect(cookie).toContain("Expires=Thu, 01 Jan 1970");
	});
});