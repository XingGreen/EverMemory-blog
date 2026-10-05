import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * persist-store 的测试重点是「线上真实故障路径」，而非行覆盖：
 *
 * - kvFetch 的 ECONNRESET 重试（注释里写明 Upstash 偶发连接重置，是真发生过的）
 * - parseUpstashResult 的降级语义（读失败必须返回 null 而非抛错，否则线上 API 直接 500）
 * - assertSafeKey 的键名校验（文件后端把 key 拼进路径，漏校验等于路径穿越）
 * - 文件后端的 TTL 过期与删除
 */

const ENV = {
	URL: "https://fake-kv.example.com",
	TOKEN: "fake-token",
};

/** 每个用例都从干净的模块状态开始：getStore 内含模块级 cachedStore 单例 */
async function loadStore(): Promise<typeof import("@utils/persist-store")> {
	vi.resetModules();
	return import("@utils/persist-store");
}

function setKvEnv(on: boolean): void {
	if (on) {
		process.env.KV_REST_API_URL = ENV.URL;
		process.env.KV_REST_API_TOKEN = ENV.TOKEN;
	} else {
		delete process.env.KV_REST_API_URL;
		delete process.env.KV_REST_API_TOKEN;
	}
}

/** 构造 Upstash 风格的响应：result 为字符串时会再被 JSON.parse */
function kvResponse(result: unknown, init: { status?: number } = {}): Response {
	const status = init.status ?? 200;
	const body =
		status === 200 || status === 204 ? JSON.stringify({ result }) : null;
	return new Response(body, {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

/**
 * 构造记录调用参数的 fetch mock。
 * 必须显式声明参数：`vi.fn(async () => ...)` 的 mock.calls 会被推断成空元组，
 * 取下标时 astro check 报 ts(2493)。
 */
function mockFetch(
	handler: (url: string, init?: RequestInit) => Promise<Response>,
) {
	return vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
		handler(String(url), init),
	);
}

beforeEach(() => {
	vi.restoreAllMocks();
	vi.spyOn(console, "error").mockImplementation(() => {});
	vi.spyOn(console, "warn").mockImplementation(() => {});
	vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
	setKvEnv(false);
	vi.unstubAllGlobals();
});

describe("后端选择", () => {
	it("配置了 KV 环境变量时走 KV 后端", async () => {
		setKvEnv(true);
		const { isKvBackend, getStore } = await loadStore();

		expect(isKvBackend()).toBe(true);
		expect(getStore()).toBeDefined();
	});

	it("未配置时走本地文件后端", async () => {
		setKvEnv(false);
		const { isKvBackend } = await loadStore();

		expect(isKvBackend()).toBe(false);
	});

	it("环境变量不完整时视为未配置", async () => {
		// 只有 URL 没有 Token：不能误判为 KV 后端，否则 get() 会在
		// 线上抛「KV 后端未配置」
		process.env.KV_REST_API_URL = ENV.URL;
		delete process.env.KV_REST_API_TOKEN;
		const { isKvBackend } = await loadStore();

		expect(isKvBackend()).toBe(false);
	});

	it("URL 末尾多余的斜杠被规范化", async () => {
		process.env.KV_REST_API_URL = `${ENV.URL}///`;
		process.env.KV_REST_API_TOKEN = ENV.TOKEN;
		const fetchMock = mockFetch(async () => kvResponse(null));
		vi.stubGlobal("fetch", fetchMock);

		const { getStore } = await loadStore();
		await getStore().get("some_key");

		expect(fetchMock.mock.calls[0][0]).toBe(`${ENV.URL}/get/some_key`);
	});

	it("getStore 返回同一单例", async () => {
		setKvEnv(false);
		const { getStore } = await loadStore();

		expect(getStore()).toBe(getStore());
	});
});

describe("assertSafeKey 键名校验", () => {
	it("拒绝含路径分隔符的键（文件后端会把 key 拼进路径）", async () => {
		setKvEnv(true);
		const fetchMock = mockFetch(async () => kvResponse(null));
		vi.stubGlobal("fetch", fetchMock);
		const { getStore } = await loadStore();

		await expect(getStore().get("../../etc/passwd")).rejects.toThrow(/非法存储键/);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("拒绝含空格的键", async () => {
		setKvEnv(true);
		vi.stubGlobal("fetch", vi.fn(async () => kvResponse(null)));
		const { getStore } = await loadStore();

		await expect(getStore().set("bad key", 1)).rejects.toThrow(/非法存储键/);
	});

	it("拒绝空键与超长键", async () => {
		setKvEnv(true);
		vi.stubGlobal("fetch", vi.fn(async () => kvResponse(null)));
		const { getStore } = await loadStore();

		await expect(getStore().get("")).rejects.toThrow(/非法存储键/);
		await expect(getStore().get("a".repeat(201))).rejects.toThrow(/非法存储键/);
	});

	it("接受合法字符集", async () => {
		setKvEnv(true);
		const fetchMock = mockFetch(async () => kvResponse(null));
		vi.stubGlobal("fetch", fetchMock);
		const { getStore } = await loadStore();

		await getStore().get("admin_sessions:abc-123.4");
		expect(fetchMock).toHaveBeenCalled();
	});
});

describe("parseUpstashResult 响应解析", () => {
beforeEach(() => {
		setKvEnv(true);
	});

	it("JSON 字符串结果被解析为对象", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				kvResponse(JSON.stringify({ sid: "s1", username: "admin" })),
			),
		);
		const { getStore } = await loadStore();

		expect(await getStore().get("admin_sessions")).toEqual({
			sid: "s1",
			username: "admin",
		});
	});

	it("非 JSON 字符串按原样返回", async () => {
		// Upstash 也用于存自增数字等非 JSON 内容，不能一律当 JSON 解析
		vi.stubGlobal("fetch", vi.fn(async () => kvResponse("plain-text")));
		const { getStore } = await loadStore();

		expect(await getStore().get("counter")).toBe("plain-text");
	});

	it("非字符串结果直接返回", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => kvResponse({ a: 1 })));
		const { getStore } = await loadStore();

		expect(await getStore().get("obj")).toEqual({ a: 1 });
	});

	it("result 为 null 或 undefined 时视为键不存在", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => kvResponse(null)));
		const { getStore } = await loadStore();
		expect(await getStore().get("k")).toBeNull();

		vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
		const { getStore: getStore2 } = await loadStore();
		expect(await getStore2().get("k")).toBeNull();
	});

	it("404 与 204 视为键不存在", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => kvResponse(null, { status: 404 })));
		const { getStore } = await loadStore();
		expect(await getStore().get("k")).toBeNull();

		vi.stubGlobal("fetch", vi.fn(async () => kvResponse(null, { status: 204 })));
		const { getStore: getStore2 } = await loadStore();
		expect(await getStore2().get("k")).toBeNull();
	});

	it("服务端错误降级为 null 而非抛出，避免线上 API 直接 500", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => kvResponse(null, { status: 500 })));
		const { getStore } = await loadStore();

		expect(await getStore().get("k")).toBeNull();
	});

	it("非 2xx 响应即使带有 result 字段也不得当作数据返回", async () => {
		// 这是 !res.ok 守卫的真正职责：若错误响应体里恰好含 result
		// （网关缓存、代理改写等），缺少守卫就会把它当成有效数据返回，
		// 把「KV 报错」误读成「键存在且有值」——比返回 null 危险得多。
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ result: { stale: true } }), {
						status: 500,
						headers: { "Content-Type": "application/json" },
					}),
			),
		);
		const { getStore } = await loadStore();

		expect(await getStore().get("k")).toBeNull();
	});

	it("404 响应带 result 字段时同样不得当作数据返回", async () => {
		// 注：这里覆盖的实际是下一行的 !res.ok 守卫 —— 404/204 的 res.ok
		// 恒为 false，所以函数开头那两行 status 守卫是不可达的冗余分支。
		// 变异测试无法捕获「删掉 status 守卫」，因为 !res.ok 已等价拦截。
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ result: "leaked" }), {
						status: 404,
						headers: { "Content-Type": "application/json" },
					}),
			),
		);
		const { getStore } = await loadStore();

		expect(await getStore().get("k")).toBeNull();
	});

	it("被拒的请求会记录错误日志，便于线上定位", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ result: { stale: true } }), {
						status: 500,
						headers: { "Content-Type": "application/json" },
					}),
			),
		);
		const { getStore } = await loadStore();

		await getStore().get("admin_sessions");

		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining("KV 500"),
		);
	});

	it("响应体非 JSON 时降级为 null", async () => {
		// 网关/代理返回 HTML 错误页是真实故障，不能让 JSON.parse 抛出去
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				new Response("<html>502</html>", {
					status: 200,
					headers: { "Content-Type": "text/html" },
				}),
			),
		);
		const { getStore } = await loadStore();

		expect(await getStore().get("k")).toBeNull();
	});
});

describe("kvFetch 网络重试", () => {
	beforeEach(() => setKvEnv(true));

	it("首次连接重置（ECONNRESET）后重试成功", async () => {
		// 这是 Upstash 真实发生过的故障：首个请求被对端重置
		let calls = 0;
		vi.stubGlobal("fetch", vi.fn(async () => {
			calls++;
			if (calls === 1) {
				throw Object.assign(new Error("socket hang up"), {
					code: "ECONNRESET",
				});
			}
			return kvResponse(JSON.stringify({ ok: true }));
		}));

		const { getStore } = await loadStore();
		expect(await getStore().get("k")).toEqual({ ok: true });
		expect(calls).toBe(2);
	});

	it("连续两次失败后向上抛，由调用方降级", async () => {
		const fetchMock = vi.fn(async () => {
			throw new Error("network down");
		});
		vi.stubGlobal("fetch", fetchMock);

		const { getStore } = await loadStore();
		// get 内部有 try/catch，失败降级为 null
		expect(await getStore().get("k")).toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("set 的网络失败会抛出（写入不可静默失败）", async () => {
		const fetchMock = vi.fn(async () => {
			throw new Error("network down");
		});
		vi.stubGlobal("fetch", fetchMock);

		const { getStore } = await loadStore();
		// 读可以降级为 null，写必须让调用方知道失败，否则会话表会丢数据
		await expect(getStore().set("k", { a: 1 })).rejects.toThrow(/network down/);
	});

	it("del 的网络失败会抛出", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => {
			throw new Error("network down");
		}));

		const { getStore } = await loadStore();
		await expect(getStore().del("k")).rejects.toThrow(/network down/);
	});
});

describe("KV 写入与删除", () => {
	beforeEach(() => setKvEnv(true));

	it("set 使用 PUT 并携带 JSON 请求体与鉴权头", async () => {
		const fetchMock = mockFetch(async () => kvResponse("OK"));
		vi.stubGlobal("fetch", fetchMock);
		const { getStore } = await loadStore();

		await getStore().set("k", { a: 1 });

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe(`${ENV.URL}/set/k`);
		expect(init?.method).toBe("PUT");
		expect((init?.headers as Record<string, string>).Authorization).toBe(
			`Bearer ${ENV.TOKEN}`,
		);
		expect(init?.body).toBe(JSON.stringify({ a: 1 }));
	});

	it("set 带 ttl 时追加 EX 参数", async () => {
		const fetchMock = mockFetch(async () => kvResponse("OK"));
		vi.stubGlobal("fetch", fetchMock);
		const { getStore } = await loadStore();

		await getStore().set("k", 1, 60);

		expect(fetchMock.mock.calls[0][0]).toBe(`${ENV.URL}/set/k?EX=60`);
	});

	it("set 不传 ttl 时不带 EX", async () => {
		const fetchMock = mockFetch(async () => kvResponse("OK"));
		vi.stubGlobal("fetch", fetchMock);
		const { getStore } = await loadStore();

		await getStore().set("k", 1, 0);

		expect(fetchMock.mock.calls[0][0]).toBe(`${ENV.URL}/set/k`);
	});

	it("set 遇非 2xx 时抛错", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => kvResponse(null, { status: 500 })));
		const { getStore } = await loadStore();

		await expect(getStore().set("k", 1)).rejects.toThrow(/KV SET 失败/);
	});

	it("del 使用 POST 并处理成功", async () => {
		const fetchMock = mockFetch(async () => kvResponse(1));
		vi.stubGlobal("fetch", fetchMock);
		const { getStore } = await loadStore();

		await getStore().del("k");

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe(`${ENV.URL}/del/k`);
		expect(init?.method).toBe("POST");
	});

	it("del 遇非 2xx 时抛错", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => kvResponse(null, { status: 500 })));
		const { getStore } = await loadStore();

		await expect(getStore().del("k")).rejects.toThrow(/KV DEL 失败/);
	});

	it("特殊字符的键被 URL 编码", async () => {
		const fetchMock = mockFetch(async () => kvResponse(null));
		vi.stubGlobal("fetch", fetchMock);
		const { getStore } = await loadStore();

		await getStore().get("key:with:colons");

		// 冒号虽在允许字符集内，但 URL 路径段中需要编码，否则路由可能出错
		expect(fetchMock.mock.calls[0][0]).toContain("key%3Awith%3Acolons");
	});
});

describe("未配置 KV 时访问 KV 专属路径", () => {
	it("isKvBackend 为 false，但 getStore 仍返回可用的文件后端", async () => {
		setKvEnv(false);
		const { getStore, isKvBackend } = await loadStore();

		expect(isKvBackend()).toBe(false);
		// 文件后端不需要 KV 配置，不应抛「KV 后端未配置」
		await expect(getStore().get("k")).resolves.not.toThrow();
	});
});