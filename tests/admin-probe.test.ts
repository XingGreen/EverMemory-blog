import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	describeProbeError,
	probeAdminService,
	runProbeWithStages,
	type ProbeMessages,
	type ProbeResult,
} from "@utils/admin-probe";

/**
 * 这里的测试直接覆盖线上曾出过故障的那段逻辑。
 *
 * 历史事故：`const { ok, failure, serverMs } = await Promise.all([...])`
 * 把数组当对象解构，UI 于是显示「无法连接: undefined」。该写法语法与
 * 类型都合法，`pnpm check`、`pnpm build` 均无法拦截，只有运行时才暴露。
 */

const MSG: ProbeMessages = {
	badResponse: "响应格式异常",
	networkError: "网络错误",
};

function jsonResponse(
	body: unknown,
	init: { status?: number; contentType?: string } = {},
): Response {
	const status = init.status ?? 200;
	return new Response(status === 204 ? null : JSON.stringify(body), {
		status,
		headers: { "Content-Type": init.contentType ?? "application/json" },
	});
}

/** 鉴权失败的典型响应：HTTP 401 + JSON message */
function unauthorized(message?: string): Response {
	return jsonResponse(message ? { message } : {}, { status: 401 });
}

/** 必须显式声明参数，否则 mock.calls 被推断成空元组，取下标会报 ts(2493) */
function mockFetchOnce(handler: () => Promise<Response> | Response) {
	const m = vi.fn(
		async (_url: string | URL | Request, _init?: RequestInit) => handler(),
	);
	vi.stubGlobal("fetch", m);
	return m;
}

async function probe(href = "/api/admin/service-ping/"): Promise<ProbeResult> {
	return probeAdminService(href, MSG);
}

beforeEach(() => {
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("probeAdminService 成功路径", () => {
	it("读取 latency 与采样区间", async () => {
		mockFetchOnce(() =>
			jsonResponse({ latency: 400, min: 300, median: 380, max: 500 }),
		);

		expect(await probe()).toEqual({
			ok: true,
			failure: "",
			serverMs: 400,
			serverMin: 300,
			serverMedian: 380,
			serverMax: 500,
		});
	});

	it("以 no-store 发起请求，避免命中缓存的探测结果", async () => {
		const m = mockFetchOnce(() => jsonResponse({ latency: 1 }));

		await probe();

		// 命中缓存会让「测试连接」永远返回上次的成功结果
		expect(m.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
	});
});

describe("probeAdminService 旧版端点兼容", () => {
	it("缺 min/median/max 时回退为单值 latency", async () => {
		// 旧版端点只返回 latency，字段缺失时若得到 undefined 会渲染出
		//「undefinedms」这类脏文案
		mockFetchOnce(() => jsonResponse({ latency: 250 }));

		const r = await probe();
		expect(r.serverMin).toBe(250);
		expect(r.serverMedian).toBe(250);
		expect(r.serverMax).toBe(250);
	});

	it("完全没有 latency 时采样值为 0 而非 undefined", async () => {
		mockFetchOnce(() => jsonResponse({}));

		const r = await probe();
		expect(r.serverMs).toBe(0);
		expect(r.serverMin).toBe(0);
		expect(r.serverMedian).toBe(0);
		expect(r.serverMax).toBe(0);
	});

it("类型不符的字段被忽略而非直接透传", async () => {
		// 端点被改坏返回 { median: "380" } 时不能把字符串塞进耗时
		mockFetchOnce(() =>
			jsonResponse({ latency: 100, median: "380", min: null, max: [] }),
		);

		const r = await probe();
		expect(r.serverMedian).toBe(100);
		expect(r.serverMin).toBe(100);
		expect(r.serverMax).toBe(100);
	});

	it("latency 本身非数字时归零，不把字符串当耗时", async () => {
		// 变异测试发现的盲区：`latency ?? 0` 与 `typeof === "number"`
		// 在 null/undefined 上表现相同，只有非数字字符串才暴露差异
		mockFetchOnce(() => jsonResponse({ latency: "380" }));

		const r = await probe();
		expect(r.serverMs).toBe(0);
		expect(r.serverMin).toBe(0);
		expect(r.serverMedian).toBe(0);
		expect(r.serverMax).toBe(0);
	});

	it("latency 为 0 时不会被误当作缺失", async () => {
		mockFetchOnce(() => jsonResponse({ latency: 0, median: 5 }));

		// 用 || 兜底会把 0 吞掉；此处必须靠 ?? / typeof 区分
		const r = await probe();
		expect(r.serverMs).toBe(0);
		expect(r.serverMedian).toBe(5);
	});
});

describe("probeAdminService HTTP 失败", () => {
	it("401 优先展示后端给出的原因", async () => {
		mockFetchOnce(() => unauthorized("未授权或会话已失效"));

		// 只显示 HTTP 401 对排查毫无帮助
		expect(await probe()).toMatchObject({
			ok: false,
			failure: "未授权或会话已失效",
		});
	});

	it("401 无 message 时回退到状态码", async () => {
		mockFetchOnce(() => unauthorized());

		expect((await probe()).failure).toBe("HTTP 401");
	});

	it("失败结果的耗时字段全为 0", async () => {
		mockFetchOnce(() => unauthorized("x"));

		const r = await probe();
		expect(r.serverMs).toBe(0);
		expect(r.serverMin).toBe(0);
		expect(r.serverMedian).toBe(0);
		expect(r.serverMax).toBe(0);
	});

	it("HTTP 异常时记录诊断日志供线上定位", async () => {
		mockFetchOnce(() => new Response("<html>502</html>", {
			status: 502,
			headers: { "Content-Type": "text/html" },
		}));

		await probe();

		expect(console.warn).toHaveBeenCalledWith(
			"[Admin] service-ping 返回异常",
			expect.objectContaining({
				status: 502,
				contentType: "text/html",
			}),
		);
	});

	it("200 的 HTML 错误页判为响应格式异常", async () => {
		mockFetchOnce(() =>
			new Response("<html>hello</html>", {
				status: 200,
				headers: { "Content-Type": "text/html" },
			}),
		);

		const r = await probe();
		expect(r.ok).toBe(false);
		expect(r.failure).toContain(MSG.badResponse);
	});

	it("空响应体判为响应格式异常", async () => {
		mockFetchOnce(() => new Response("", { status: 200 }));

		expect((await probe()).ok).toBe(false);
	});

	it("超长响应体被截断，不会把整个 HTML 塞进 UI", async () => {
		mockFetchOnce(() => new Response("x".repeat(5000), { status: 200 }));

		const r = await probe();
		// 详情面板直接展示 failure，未截断会撑破布局。
		// 上限 = 前缀 + ": " + 截断后的 80 字符
		const maxLen = MSG.badResponse.length + ": ".length + 80;
		expect(r.failure.length).toBe(maxLen);
		expect(r.failure).toContain("x".repeat(80));
		expect(r.failure).not.toContain("x".repeat(81));
	});

	it("请求本身抛错时返回失败而非向上抛", async () => {
		mockFetchOnce(() => {
			throw new Error("Failed to fetch");
		});

		// 探测失败必须能展示给用户，不能让组件异常
		const r = await probe();
		expect(r.ok).toBe(false);
		expect(r.failure).toBe("Failed to fetch");
	});

	it("204 无内容视为响应格式异常", async () => {
		mockFetchOnce(() => new Response(null, { status: 204 }));

		expect((await probe()).ok).toBe(false);
	});
});

describe("runProbeWithStages 并发编排", () => {
	// 这一组直接锁住线上事故点：Promise.all 返回数组，
	// 若按对象解构，ok/failure/serverMs 会全部变成 undefined。

	it("结果取自 request，而非 stepper", async () => {
		const result = await runProbeWithStages(
			Promise.resolve({ ok: true, failure: "", serverMs: 42 }),
			Promise.resolve(),
		);

		expect(result).toEqual({ ok: true, failure: "", serverMs: 42 });
	});

	it("stepper 无返回值时不污染结果", async () => {
		const result = await runProbeWithStages(
			Promise.resolve({ ok: false, failure: "boom", serverMs: 0 }),
			(async () => {
				await Promise.resolve();
				return undefined;
			})(),
		);

		expect(result.failure).toBe("boom");
	});

	it("请求先完成时仍等待 stepper 结束", async () => {
		const order: string[] = [];
		const request = Promise.resolve().then(() => {
			order.push("request");
			return "probe";
		});
		const stepper = Promise.resolve().then(() => {
			order.push("stepper");
		});

		await runProbeWithStages(request, stepper);

		// stepper 负责推进 UI 步骤文案，必须跑完，否则 UI 会卡在中间态
		expect(order).toEqual(["request", "stepper"]);
	});

	it("stepper 抛错不会吞掉探测结果", async () => {
		// UI 步骤推进失败不该让探测结果作废，否则用户看不到真实连通性
		const result = await runProbeWithStages(
			Promise.resolve({ ok: true, failure: "" }),
			Promise.reject(new Error("stage boom")),
		);

		expect(result.ok).toBe(true);
		expect(console.warn).toHaveBeenCalledWith(
			"[Probe] 步骤推进失败，不影响探测结果",
			expect.any(Error),
		);
	});

	it("request 抛错时向上传播", async () => {
		// 与 stepper 相反：探测失败必须让调用方知道，
		// 不能返回 undefined 让上层拿到全 undefined 字段
		await expect(
			runProbeWithStages(
				Promise.reject(new Error("probe boom")),
				Promise.resolve(),
			),
		).rejects.toThrow("probe boom");
	});

	it("与真实探测组合时返回完整归一化结果", async () => {
		mockFetchOnce(() => jsonResponse({ latency: 400, min: 300, median: 380, max: 500 }));

		const probe = await runProbeWithStages(
			probeAdminService("/api/admin/service-ping/", MSG),
			Promise.resolve(),
		);

		expect(probe.ok).toBe(true);
		expect(probe.serverMedian).toBe(380);
		expect(probe.serverMs).toBe(400);
	});
});

describe("describeProbeError", () => {
	it("优先返回 Error 的 message", () => {
		expect(describeProbeError(new Error("boom"), MSG.networkError)).toBe(
			"boom",
		);
	});

	it("字符串错误原样返回", () => {
		expect(describeProbeError("timeout", MSG.networkError)).toBe("timeout");
	});

	it("空字符串回退到兜底文案", () => {
		expect(describeProbeError("", MSG.networkError)).toBe(MSG.networkError);
	});

	it("undefined 回退到兜底文案", () => {
		// 浏览器部分失败场景抛出的并非 Error，直接 String(err) 会显示
		//「undefined」，对用户毫无信息量
		expect(describeProbeError(undefined, MSG.networkError)).toBe(
			MSG.networkError,
		);
	});

	it("无 message 的 Error 回退到兜底文案", () => {
		expect(describeProbeError(new Error(""), MSG.networkError)).toBe(
			MSG.networkError,
		);
	});

	it("null 回退到兜底文案", () => {
		expect(describeProbeError(null, MSG.networkError)).toBe(MSG.networkError);
	});

	it("普通对象回退到兜底文案", () => {
		expect(describeProbeError({ code: 500 }, MSG.networkError)).toBe(
			MSG.networkError,
		);
	});
});