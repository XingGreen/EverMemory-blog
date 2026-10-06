import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 只替换环境读取边界，被测的 turnstile.ts 本身完全真实执行。
const env: Record<string, string> = {};
vi.mock("@utils/env", async (importOriginal) => ({
	...(await importOriginal<typeof import("@utils/env")>()),
	getEnv: (key: string) => env[key] ?? "",
}));

const { getTurnstileConfig, verifyTurnstileToken } = await import(
	"@utils/turnstile"
);

const SITE_KEY = "0x4AAAAAAA_site";
const SECRET_KEY = "0x4AAAAAAA_secret";

function mockFetchOnce(body: unknown, init?: { ok?: boolean; status?: number }) {
	return vi.fn().mockResolvedValue({
		ok: init?.ok ?? true,
		status: init?.status ?? 200,
		json: async () => body,
	} as unknown as Response);
}

beforeEach(() => {
	for (const key of Object.keys(env)) delete env[key];
	vi.stubGlobal("fetch", vi.fn());
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("getTurnstileConfig", () => {
	it("两个 key 都配齐才启用", () => {
		env.TURNSTILE_SITE_KEY = SITE_KEY;
		env.TURNSTILE_SECRET_KEY = SECRET_KEY;
		expect(getTurnstileConfig()).toEqual({
			enabled: true,
			siteKey: SITE_KEY,
			incomplete: false,
		});
	});

	it("两个都没配：未启用且非配置错误", () => {
		expect(getTurnstileConfig()).toEqual({
			enabled: false,
			siteKey: "",
			incomplete: false,
		});
	});

	it("只有 site key：标记为配置不完整", () => {
		env.TURNSTILE_SITE_KEY = SITE_KEY;
		const cfg = getTurnstileConfig();
		expect(cfg.enabled).toBe(false);
		expect(cfg.incomplete).toBe(true);
	});

	it("只有 secret key：同样标记为配置不完整", () => {
		env.TURNSTILE_SECRET_KEY = SECRET_KEY;
		const cfg = getTurnstileConfig();
		expect(cfg.enabled).toBe(false);
		expect(cfg.incomplete).toBe(true);
	});

	it("纯空白字符视为未配置", () => {
		env.TURNSTILE_SITE_KEY = "   ";
		env.TURNSTILE_SECRET_KEY = "\t";
		expect(getTurnstileConfig()).toEqual({
			enabled: false,
			siteKey: "",
			incomplete: false,
		});
	});

	it("site key 为空白、secret 有效：仍是配置不完整", () => {
		env.TURNSTILE_SITE_KEY = "   ";
		env.TURNSTILE_SECRET_KEY = SECRET_KEY;
		const cfg = getTurnstileConfig();
		expect(cfg.enabled).toBe(false);
		expect(cfg.incomplete).toBe(true);
	});

	it("secret 为空白、site key 有效：仍是配置不完整", () => {
		env.TURNSTILE_SITE_KEY = SITE_KEY;
		env.TURNSTILE_SECRET_KEY = "  ";
		const cfg = getTurnstileConfig();
		expect(cfg.enabled).toBe(false);
		expect(cfg.incomplete).toBe(true);
	});

	it("启用时 site key 为去除首尾空白后的值", () => {
		env.TURNSTILE_SITE_KEY = `  ${SITE_KEY}  `;
		env.TURNSTILE_SECRET_KEY = `  ${SECRET_KEY}  `;
		expect(getTurnstileConfig().siteKey).toBe(SITE_KEY);
	});

	it("启用时提交给 Cloudflare 的 secret 不含首尾空白", async () => {
		env.TURNSTILE_SITE_KEY = SITE_KEY;
		env.TURNSTILE_SECRET_KEY = `  ${SECRET_KEY}  `;
		const spy = mockFetchOnce({ success: true });
		vi.stubGlobal("fetch", spy);
		await verifyTurnstileToken("good-token");
		const body = (spy.mock.calls[0][1] as RequestInit).body as URLSearchParams;
		expect(body.get("secret")).toBe(SECRET_KEY);
	});
});

describe("verifyTurnstileToken 未启用时", () => {
	it("完全跳过校验并放行，不发起任何网络请求", async () => {
		const result = await verifyTurnstileToken("");
		expect(result).toEqual({ ok: true, skipped: true, reason: "" });
		expect(fetch).not.toHaveBeenCalled();
	});

	it("配置不完整时拒绝：不得出现假验证", async () => {
		env.TURNSTILE_SITE_KEY = SITE_KEY;
		const result = await verifyTurnstileToken("any-token");
		expect(result.ok).toBe(false);
		expect(result.skipped).toBe(false);
		expect(result.reason).toBe("TURNSTILE_INCOMPLETE_CONFIG");
		// 关键：不能在未启用时悄悄放行
		expect(fetch).not.toHaveBeenCalled();
	});
});

describe("verifyTurnstileToken 已启用", () => {
	beforeEach(() => {
		env.TURNSTILE_SITE_KEY = SITE_KEY;
		env.TURNSTILE_SECRET_KEY = SECRET_KEY;
	});

	it("Cloudflare 返回 success 时放行", async () => {
		vi.stubGlobal("fetch", mockFetchOnce({ success: true }));
		expect(await verifyTurnstileToken("good-token")).toEqual({
			ok: true,
			skipped: false,
			reason: "",
		});
	});

	it("提交 secret 与 token，并以表单形式发送", async () => {
		const spy = mockFetchOnce({ success: true });
		vi.stubGlobal("fetch", spy);
		await verifyTurnstileToken("good-token");

		const [, init] = spy.mock.calls[0] as [string, RequestInit];
		const body = init.body as URLSearchParams;
		expect(init.method).toBe("POST");
		expect(body.get("secret")).toBe(SECRET_KEY);
		expect(body.get("response")).toBe("good-token");
		// 未启用 remoteip 时不应发送空字段
		expect(body.has("remoteip")).toBe(false);
	});

	it("带上客户端 IP 供 Cloudflare 风控使用", async () => {
		const spy = mockFetchOnce({ success: true });
		vi.stubGlobal("fetch", spy);
		await verifyTurnstileToken("good-token", "1.1.1.1");

		const body = (spy.mock.calls[0][1] as RequestInit).body as URLSearchParams;
		expect(body.get("remoteip")).toBe("1.1.1.1");
	});

	it("缺少 token 时拒绝且不发请求", async () => {
		const result = await verifyTurnstileToken("");
		expect(result.ok).toBe(false);
		expect(result.reason).toBe("TURNSTILE_MISSING_TOKEN");
		expect(fetch).not.toHaveBeenCalled();
	});

	it("Cloudflare 明确拒绝时拒绝，并带上错误码", async () => {
		vi.stubGlobal(
			"fetch",
			mockFetchOnce({
				success: false,
				"error-codes": ["invalid-input-response", "timeout-or-duplicate"],
			}),
		);
		const result = await verifyTurnstileToken("bad-token");
		expect(result.ok).toBe(false);
		expect(result.reason).toContain("invalid-input-response");
		expect(result.reason).toContain("timeout-or-duplicate");
	});

	it("HTTP 5xx 时拒绝（不因上游故障而放行）", async () => {
		vi.stubGlobal(
			"fetch",
			mockFetchOnce({}, { ok: false, status: 503 }),
		);
		const result = await verifyTurnstileToken("good-token");
		expect(result.ok).toBe(false);
		expect(result.reason).toBe("TURNSTILE_HTTP_503");
	});

	it("网络异常时拒绝，不抛未捕获错误", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("socket hang up")),
		);
		const result = await verifyTurnstileToken("good-token");
		expect(result.ok).toBe(false);
		expect(result.reason).toContain("socket hang up");
	});

	it("响应体不是预期结构时按拒绝处理", async () => {
		vi.stubGlobal("fetch", mockFetchOnce(null));
		const result = await verifyTurnstileToken("good-token");
		expect(result.ok).toBe(false);
		expect(result.reason).toContain("unknown");
	});

	it("success 为字符串真值而非布尔 true 时不得放行", async () => {
		vi.stubGlobal("fetch", mockFetchOnce({ success: "yes" }));
		expect((await verifyTurnstileToken("t")).ok).toBe(false);
	});

	it("设置了超时，避免校验挂起拖住登录接口", async () => {
		const spy = mockFetchOnce({ success: true });
		vi.stubGlobal("fetch", spy);
		await verifyTurnstileToken("good-token");
		const [, init] = spy.mock.calls[0] as [string, RequestInit];
		expect(init.signal).toBeInstanceOf(AbortSignal);
	});
});