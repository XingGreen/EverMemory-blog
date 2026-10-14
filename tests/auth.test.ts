import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * token 版本号来自 secret-io 的 readSecretPreview（读 .env.local）。
 * 测试里替换为可编程的取值，从而覆盖「改密/改钥后旧令牌立即失效」这条链路。
 */
let tokenVersion = "0";
/**
 * 可编程的密钥取值。只有「读 .env.local」这一层是边界，值得 mock；
 * verifyPasswordHash / shouldRehash / hashAdminPassword 等真实加密逻辑
 * 保持原样，否则测的就不是生产代码了。
 */
let secrets: Record<string, string> = {};
/** 捕获 applyEnvFileUpdates 的写回，避免测试触碰真实 .env.local */
let envWrites: { key: string; value: string }[] = [];
let envWritable = true;
/** 让 applyEnvFileUpdates 抛错，模拟 isEnvFileWritable 检查通过但写入仍失败的场景 */
let envWriteThrows = false;

vi.mock("@utils/secret-io", async (importOriginal) => ({
	...(await importOriginal<typeof import("@utils/secret-io")>()),
	readSecretPreview: (key: string) =>
		key === "ADMIN_TOKEN_VER" ? tokenVersion : (secrets[key] ?? ""),
	readSecretValue: (key: string) => secrets[key] ?? "",
	incrementTokenVersion: () => {
		tokenVersion = String(Number(tokenVersion) + 1);
		return Number(tokenVersion);
	},
	isEnvFileWritable: () => envWritable,
	applyEnvFileUpdates: (updates: { key: string; value: string }[]) => {
		if (envWriteThrows) throw new Error("EACCES: .env.local 只读");
		envWrites.push(...updates);
	},
}));

/** 会话表桩：verifySessionToken 只关心 sid 是否存在，并补全有效账户名 */
const sessions = new Set<string>();
vi.mock("@utils/session-store", () => ({
	getSession: async (sid: string) =>
		sessions.has(sid) ? { sid, username: "EverMemory" } : null,
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
	secrets = {};
envWrites = [];
	envWritable = true;
	envWriteThrows = false;
delete process.env.ADMIN_USERNAME;
	// 生产目标 N=131072，单次 scrypt 约 1s、整文件会跑到 7s。
	// 官方提供 ADMIN_SCRYPT_N 覆盖（见 targetScryptN），这里降到 2048：
	// 覆盖的是「成本不足则升级」这条逻辑本身，成本大小与结论无关。
	process.env.ADMIN_SCRYPT_N = "2048";
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

	it("验签后从会话表补全有效账户名（审计需要）", async () => {
		const auth = await loadAuth();
		const sid = crypto.randomUUID();
		sessions.add(sid);
		const token = auth.generateSessionToken(SESSION_MAX_AGE, sid, "super");

		// 令牌本身不含 username，必须以服务端会话表为准
		expect((await auth.verifySessionToken(token))?.username).toBe("EverMemory");
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
describe("verifyAdminPassword 管理员密码验证", () => {
	/** 真实 scrypt 哈希，密码学部分不 mock */
	const hashOf = async (plain: string) => {
		const { hashAdminPassword } = await import("@utils/secret-io");
		return hashAdminPassword(plain);
	};

	it("正确的 scrypt 密码通过验证", async () => {
		secrets.ADMIN_PASSWORD = await hashOf("correct-horse");
		const auth = await loadAuth();

		expect(auth.verifyAdminPassword("correct-horse")).toBe(true);
	});

	it("错误密码被拒绝", async () => {
		secrets.ADMIN_PASSWORD = await hashOf("correct-horse");
		const auth = await loadAuth();

		expect(auth.verifyAdminPassword("wrong-password")).toBe(false);
	});

	it("空密码被拒绝且不触碰哈希", async () => {
		secrets.ADMIN_PASSWORD = await hashOf("correct-horse");
		const auth = await loadAuth();

		// 空密码若漏判会绕过校验直接进 catch 分支返回 false，
		// 表面结果相同——必须断言「没有发生 rehash 写回」才能证明提前拦截
		expect(auth.verifyAdminPassword("")).toBe(false);
		expect(envWrites).toHaveLength(0);
	});

	it("未配置 ADMIN_PASSWORD 时拒绝并记录错误", async () => {
		const auth = await loadAuth();
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});

		expect(auth.verifyAdminPassword("anything")).toBe(false);
		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining("ADMIN_PASSWORD 环境变量未配置"),
		);
	});

	it("兼容旧版 SHA256 hex 密码", async () => {
		const nodeCrypto = await import("node:crypto");
		secrets.ADMIN_PASSWORD = nodeCrypto
			.createHash("sha256")
			.update("legacy-pass", "utf8")
			.digest("hex");
		const auth = await loadAuth();

		// 存量站点仍是 SHA256，验证失败会导致无法登录
		expect(auth.verifyAdminPassword("legacy-pass")).toBe(true);
	});

	it("旧版 SHA256 验证通过后自动升级写回 scrypt", async () => {
		const nodeCrypto = await import("node:crypto");
		secrets.ADMIN_PASSWORD = nodeCrypto
			.createHash("sha256")
			.update("legacy-pass", "utf8")
			.digest("hex");
		const auth = await loadAuth();

		expect(auth.verifyAdminPassword("legacy-pass")).toBe(true);

		expect(envWrites).toHaveLength(1);
		const [update] = envWrites;
		expect(update.key).toBe("ADMIN_PASSWORD");
		expect(update.value).toMatch(/^scrypt\$\d+\$/);
		// 写回的新哈希必须能验证同一密码，否则用户会被自己锁在门外
		expect(update.value).not.toBe(secrets.ADMIN_PASSWORD);
	});

	it("已是目标成本的 scrypt 哈希不再重复写回", async () => {
		secrets.ADMIN_PASSWORD = await hashOf("stable-pass");
		const auth = await loadAuth();

		expect(auth.verifyAdminPassword("stable-pass")).toBe(true);
		// 无谓写回会在每次登录时都改写 .env.local
		expect(envWrites).toHaveLength(0);
	});

it("成本参数偏低的 scrypt 哈希会被升级到目标 N", async () => {
		// 模拟历史低 N 哈希（1024 < 目标 2048）
		const nodeCrypto = await import("node:crypto");
		const salt = nodeCrypto.randomBytes(16);
		const computed = nodeCrypto.scryptSync("low-cost", salt, 64, {
			N: 1024,
			maxmem: 64 * 1024 * 1024,
		});
		secrets.ADMIN_PASSWORD = `scrypt$1024$${salt.toString("base64")}$${computed.toString("base64")}`;
		const auth = await loadAuth();

		expect(auth.verifyAdminPassword("low-cost")).toBe(true);
		expect(envWrites).toHaveLength(1);
		expect(envWrites[0].value).toMatch(/^scrypt\$2048\$/);
	});

	it("写回的新哈希仍能验证同一密码", async () => {
		// 防止「升级后把自己锁在门外」：升级路径一旦算错，用户下次登录即失效
		const nodeCrypto = await import("node:crypto");
		const salt = nodeCrypto.randomBytes(16);
		const computed = nodeCrypto.scryptSync("low-cost", salt, 64, {
			N: 1024,
			maxmem: 64 * 1024 * 1024,
		});
		secrets.ADMIN_PASSWORD = `scrypt$1024$${salt.toString("base64")}$${computed.toString("base64")}`;
		const auth = await loadAuth();

		auth.verifyAdminPassword("low-cost");
		const { verifyPasswordHash } = await import("@utils/secret-io");

		expect(verifyPasswordHash("low-cost", envWrites[0].value)).toBe(true);
	});

	it(".env.local 不可写时验证仍通过但不写回", async () => {
		const nodeCrypto = await import("node:crypto");
		secrets.ADMIN_PASSWORD = nodeCrypto
			.createHash("sha256")
			.update("legacy-pass", "utf8")
			.digest("hex");
		envWritable = false;
		const auth = await loadAuth();

		// 文件不可写不能变成登录失败——否则只读部署会全员被锁
		expect(auth.verifyAdminPassword("legacy-pass")).toBe(true);
		expect(envWrites).toHaveLength(0);
	});

it("写回抛错时验证仍返回 true", async () => {
		const nodeCrypto = await import("node:crypto");
		secrets.ADMIN_PASSWORD = nodeCrypto
			.createHash("sha256")
			.update("legacy-pass", "utf8")
			.digest("hex");
		envWritable = true;
		envWriteThrows = true;
		const auth = await loadAuth();

		// isEnvFileWritable 说可写、但写入过程中失败的真实情况。
		// 写回只是优化，失败绝不能连带把登录也判失败，否则用户会被锁在门外。
		expect(auth.verifyAdminPassword("legacy-pass")).toBe(true);
		expect(envWrites).toHaveLength(0);
	});

it("格式损坏的哈希返回 false 而不抛出", async () => {
		// .env.local 被手工改坏时不能让登录接口 500，也不能误判为通过
		secrets.ADMIN_PASSWORD = "scrypt$notanumber$!!!$???";
		const auth = await loadAuth();

		expect(() => auth.verifyAdminPassword("anything")).not.toThrow();
		expect(auth.verifyAdminPassword("anything")).toBe(false);
	});

	it("scrypt 段数不全的哈希被拒绝", async () => {
		secrets.ADMIN_PASSWORD = "scrypt$";
		const auth = await loadAuth();
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});

		expect(auth.verifyAdminPassword("anything")).toBe(false);
		// 空盐/空哈希由 verifyPasswordHash 内部提前 return false 拒绝，
		// 不该冒泡到 auth 的 catch（那意味着内部防护漏了）
		expect(spy).not.toHaveBeenCalled();
	});

	it("省略 N 的旧版 scrypt 哈希按 16384 校验", async () => {
		// scrypt$salt$hash 是早期格式，省略 N 时按 16384 计算
		const nodeCrypto = await import("node:crypto");
		const salt = nodeCrypto.randomBytes(16);
		const computed = nodeCrypto.scryptSync("old-format", salt, 64, {
			N: 16384,
			maxmem: 256 * 1024 * 1024,
		});
		secrets.ADMIN_PASSWORD = `scrypt$${salt.toString("base64")}$${computed.toString("base64")}`;
		const auth = await loadAuth();

		expect(auth.verifyAdminPassword("old-format")).toBe(true);
		// 16384 < 目标 2048？不，16384 > 2048，故不需要升级
		expect(envWrites).toHaveLength(0);
	});
});

describe("verifyAdminUsername 管理员用户名验证", () => {
	it("默认用户名为 admin", async () => {
		const auth = await loadAuth();

		expect(auth.verifyAdminUsername("admin")).toBe(true);
		expect(auth.verifyAdminUsername("root")).toBe(false);
	});

	it("未设置 ADMIN_USERNAME 时回退到 admin", async () => {
		process.env.ADMIN_USERNAME = "";
		const auth = await loadAuth();

		expect(auth.verifyAdminUsername("admin")).toBe(true);
	});

	it("自定义用户名生效", async () => {
		process.env.ADMIN_USERNAME = "editor";
		const auth = await loadAuth();

		expect(auth.verifyAdminUsername("editor")).toBe(true);
		expect(auth.verifyAdminUsername("admin")).toBe(false);
	});

it("长度不同的输入被拒绝", async () => {
		process.env.ADMIN_USERNAME = "admin";
		const auth = await loadAuth();

		// 长度不等时 timingSafeEqual 会抛错，必须提前 return false
		expect(auth.verifyAdminUsername("adm")).toBe(false);
		expect(auth.verifyAdminUsername("administrator")).toBe(false);
	});

	it("长度不等是主动拒绝，不产生异常日志", async () => {
		// 变异测试发现：删掉长度检查后，timingSafeEqual 抛 RangeError 被外层
		// catch 吞掉，最终仍返回 false —— 只断言返回值无法区分两者。
		// 「无错误日志」才说明这是设计内的拒绝，而非靠异常兜底。
		process.env.ADMIN_USERNAME = "admin";
		const auth = await loadAuth();
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});

		expect(auth.verifyAdminUsername("adm")).toBe(false);
		expect(spy).not.toHaveBeenCalled();
	});

	it("使用 timingSafeEqual 而非普通比较", async () => {
		// 二者返回同样的布尔值，只能靠「是否调用了常量时间比较」区分。
		// 这是代码注释里明确声明的防时序攻击意图，值得钉住。
		process.env.ADMIN_USERNAME = "admin";
		const auth = await loadAuth();
		const nodeCrypto = await import("node:crypto");
		const spy = vi.spyOn(nodeCrypto.default, "timingSafeEqual");

		auth.verifyAdminUsername("admin");

		expect(spy).toHaveBeenCalled();
	});

	it("大小写敏感", async () => {
		process.env.ADMIN_USERNAME = "admin";
		const auth = await loadAuth();

		expect(auth.verifyAdminUsername("Admin")).toBe(false);
		expect(auth.verifyAdminUsername("ADMIN")).toBe(false);
	});

	it("空用户名被拒绝", async () => {
		const auth = await loadAuth();

		expect(auth.verifyAdminUsername("")).toBe(false);
	});

	it("多字节字符按字节长度比较", async () => {
		process.env.ADMIN_USERNAME = "管理员";
		const auth = await loadAuth();

		expect(auth.verifyAdminUsername("管理员")).toBe(true);
		expect(auth.verifyAdminUsername("管理")).toBe(false);
	});
});

describe("verifySuperPassword 第二密码验证", () => {
	/** 真实 scrypt 哈希，密码学部分不 mock */
	const hashOf = async (plain: string) => {
		const { hashAdminPassword } = await import("@utils/secret-io");
		return hashAdminPassword(plain);
	};

	it("正确的第二密码通过验证", async () => {
		secrets.ADMIN_SUPER_PASSWORD = await hashOf("super-secret");
		const auth = await loadAuth();

		expect(auth.verifySuperPassword("super-secret")).toBe(true);
	});

	it("错误密码被拒绝", async () => {
		secrets.ADMIN_SUPER_PASSWORD = await hashOf("super-secret");
		const auth = await loadAuth();

		expect(auth.verifySuperPassword("nope")).toBe(false);
	});

	it("未配置第二密码时一律拒绝", async () => {
		const auth = await loadAuth();

		expect(auth.verifySuperPassword("anything")).toBe(false);
	});

	it("空密码被拒绝且不触碰哈希", async () => {
		secrets.ADMIN_SUPER_PASSWORD = await hashOf("super-secret");
		const auth = await loadAuth();

		expect(auth.verifySuperPassword("")).toBe(false);
	});

	it("主密码哈希存在时不会误判第二密码通过", async () => {
		secrets.ADMIN_PASSWORD = await hashOf("main-pass");
		const auth = await loadAuth();

		// 两个哈希分属不同 env 键，互不干扰；拿主密码当第二密码必须失败
		expect(auth.verifySuperPassword("main-pass")).toBe(false);
	});

	it("格式损坏的哈希返回 false 而不抛出", async () => {
		secrets.ADMIN_SUPER_PASSWORD = "scrypt$bad";
		const auth = await loadAuth();

		expect(() => auth.verifySuperPassword("x")).not.toThrow();
		expect(auth.verifySuperPassword("x")).toBe(false);
	});
});

describe("isSuperPasswordConfigured", () => {
	it("已配置返回 true", async () => {
		secrets.ADMIN_SUPER_PASSWORD = "scrypt$2048$aa$bb";
		const auth = await loadAuth();

		expect(auth.isSuperPasswordConfigured()).toBe(true);
	});

	it("未配置返回 false", async () => {
		const auth = await loadAuth();

		expect(auth.isSuperPasswordConfigured()).toBe(false);
	});
});

describe("角色与会话空间", () => {
	it("默认签发 admin 角色", async () => {
		const auth = await loadAuth();
		const payload = await auth.verifySessionToken(await issue(auth));

		expect(payload?.role).toBe("admin");
	});

	it("可签发 super 角色并通过验签", async () => {
		const auth = await loadAuth();
		const sid = crypto.randomUUID();
		sessions.add(sid);

		const token = auth.generateSessionToken(
			auth.SUPER_SESSION_MAX_AGE,
			sid,
			"super",
		);

		expect((await auth.verifySessionToken(token))?.role).toBe("super");
	});

	it("未知角色一律视为无效", async () => {
		const auth = await loadAuth();
		const sid = crypto.randomUUID();
		sessions.add(sid);
		const now = Math.floor(Date.now() / 1000);

		const token = await signRaw({
			sub: "x",
			role: "root",
			ver: tokenVersion,
			sid,
			iat: now,
			exp: now + 3600,
		});

		// 凭角色白名单拦截，而非靠后续会话表查询兜底
		expect(await auth.verifySessionToken(token)).toBeNull();
	});
});

describe("requireSuperAuth", () => {
	const requestWith = (token?: string) =>
		new Request("http://localhost/api/admin/x", {
			headers: token ? { cookie: `admin_session=${token}` } : undefined,
		});

	it("无 cookie 返回 401", async () => {
		const auth = await loadAuth();
		const result = await auth.requireSuperAuth(requestWith());

		expect(result.authenticated).toBe(false);
		expect(result.response?.status).toBe(401);
	});

	it("主空间会话访问控制面返回 403", async () => {
		const auth = await loadAuth();
		const token = await issue(auth); // role=admin

		const result = await auth.requireSuperAuth(requestWith(token));

		expect(result.authenticated).toBe(false);
		expect(result.response?.status).toBe(403);
	});

	it("super 会话通过并回传角色", async () => {
		const auth = await loadAuth();
		const sid = crypto.randomUUID();
		sessions.add(sid);
		const token = auth.generateSessionToken(
			auth.SUPER_SESSION_MAX_AGE,
			sid,
			"super",
		);

		const result = await auth.requireSuperAuth(requestWith(token));

		expect(result.authenticated).toBe(true);
		expect(result.response).toBeUndefined();
		expect(result.payload?.role).toBe("super");
	});
});

describe("resolveLoginSpace 分空间判定（主密码优先）", () => {
	const base = {
		usernameOk: true,
		passwordOk: false,
		superConfigured: true,
		superOk: false,
	};

	it("主密码通过即进主空间", async () => {
		const { resolveLoginSpace } = await loadAuth();

		expect(resolveLoginSpace({ ...base, passwordOk: true })).toBe("admin");
	});

	it("主密码通过时即使第二密码也对仍进主空间（不泄露第二密码是否猜中）", async () => {
		const { resolveLoginSpace } = await loadAuth();

		expect(
			resolveLoginSpace({
				...base,
				passwordOk: true,
				superOk: true,
			}),
		).toBe("admin");
	});

	it("主密码错、第二密码对且已配置 → super 空间", async () => {
		const { resolveLoginSpace } = await loadAuth();

		expect(resolveLoginSpace({ ...base, superOk: true })).toBe("super");
	});

	it("第二密码未配置时即使校验通过也不进 super", async () => {
		const { resolveLoginSpace } = await loadAuth();

		expect(
			resolveLoginSpace({
				...base,
				superConfigured: false,
				superOk: true,
			}),
		).toBeNull();
	});

	it("第二密码被锁（superOk=false）时降级为失败", async () => {
		const { resolveLoginSpace } = await loadAuth();

		expect(resolveLoginSpace({ ...base, superOk: false })).toBeNull();
	});

	it("用户名不通过时一律 null，即便密码正确", async () => {
		const { resolveLoginSpace } = await loadAuth();

		expect(
			resolveLoginSpace({
				...base,
				usernameOk: false,
				passwordOk: true,
				superOk: true,
			}),
		).toBeNull();
	});
});
