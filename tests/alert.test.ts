import { afterEach, describe, expect, it, vi } from "vitest";

/** 只 mock「读环境变量」这一层；fetch 在用例内单独 stub */
let webhook = "";
vi.mock("@utils/secret-io", () => ({
	readSecretValue: (key: string) =>
		key === "ADMIN_ALERT_WEBHOOK" ? webhook : "",
}));

const loadAlert = () => import("@utils/alert");

const sampleInfo = {
	space: "admin" as const,
	username: "EverMemory",
	ip: "203.0.113.7",
	device: "Chrome on Windows",
	time: "2026-10-14T01:02:03.000Z",
};

afterEach(() => {
	webhook = "";
	vi.unstubAllGlobals();
	vi.resetModules();
});

describe("登录带外告警", () => {
	it("未配置 Webhook：isAlertConfigured=false 且不发任何请求", async () => {
		const alert = await loadAlert();
		expect(alert.isAlertConfigured()).toBe(false);

		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);
		await alert.sendLoginAlert(sampleInfo);

		// 去掉 `if (!url) return;` 后此处会以空 URL 发请求，断言即失败
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("已配置：向 Webhook POST 结构化载荷（含 Slack text 与 Discord content）", async () => {
		webhook = "https://example.com/hook";
		const alert = await loadAlert();
		expect(alert.isAlertConfigured()).toBe(true);

		const fetchSpy = vi.fn(
			async (_url: string, _init: RequestInit) =>
				new Response("", { status: 200 }),
		);
		vi.stubGlobal("fetch", fetchSpy);
		await alert.sendLoginAlert({ ...sampleInfo, space: "super" });

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [url, init] = fetchSpy.mock.calls[0];
		expect(url).toBe("https://example.com/hook");
		expect(init.method).toBe("POST");
		const body = JSON.parse(String(init.body));
		expect(body.event).toBe("admin_login_success");
		expect(body.space).toBe("super");
		expect(body.username).toBe("EverMemory");
		expect(body.ip).toBe("203.0.113.7");
		expect(body.text).toContain("203.0.113.7");
		expect(body.content).toBe(body.text);
	});

	it("Webhook 抛异常时不向上抛出（绝不连累登录）", async () => {
		webhook = "https://example.com/hook";
		const alert = await loadAlert();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("network down");
			}),
		);

		await expect(alert.sendLoginAlert(sampleInfo)).resolves.toBeUndefined();
	});
});
