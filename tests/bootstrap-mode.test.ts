import { afterEach, describe, expect, it } from "vitest";
import { ADMIN_SECRETS, SECRET_ROWS } from "@/utils/admin-secrets";
import {
	BOOTSTRAP_KEYS,
	bootstrapNeeded,
	isLoopbackRequest,
} from "@/utils/bootstrap-mode";

const required = ADMIN_SECRETS.filter(
	(item) => item.required && !item.managed,
).map((item) => item.key);

afterEach(() => {
	for (const key of required) delete process.env[key];
});

describe("bootstrap mode", () => {
	it("必要项缺一项就需要引导", () => {
		for (const key of required) delete process.env[key];
		expect(bootstrapNeeded()).toBe(true);
	});

	it("必要项配齐后立刻关闭", () => {
		for (const key of required) process.env[key] = "x";
		expect(bootstrapNeeded()).toBe(false);
	});

	it("只放开必填项，可选与托管项仍要登录后才能改", () => {
		expect(BOOTSTRAP_KEYS).toHaveLength(required.length);
		expect(BOOTSTRAP_KEYS).not.toContain("ADMIN_ALERT_WEBHOOK");
		expect(BOOTSTRAP_KEYS).not.toContain("TURNSTILE_SECRET_KEY");
		expect(BOOTSTRAP_KEYS).not.toContain("ADMIN_JWT_SECRET");
	});

	it("引导页要显示的必填项，都能在字段行里找到落点", () => {
		// 引导页面按 SECRET_ROWS 渲染：某个必填键没有对应的行，用户就永远填不上，
		// 引导页也永远不会关闭。这条守住 UI 过滤规则与服务端白名单同源。
		for (const key of BOOTSTRAP_KEYS) {
			const covered = SECRET_ROWS.some((row) => row.keys.includes(key));
			expect(covered, `字段行里缺少 ${key}`).toBe(true);
		}
	});

	it("只认回环地址", () => {
		expect(isLoopbackRequest(new Request("http://127.0.0.1:4321/x"))).toBe(
			true,
		);
		expect(isLoopbackRequest(new Request("http://localhost:4321/x"))).toBe(
			true,
		);
		expect(isLoopbackRequest(new Request("https://example.com/x"))).toBe(false);
		expect(isLoopbackRequest(new Request("http://192.168.1.10:4321/x"))).toBe(
			false,
		);
	});
});
