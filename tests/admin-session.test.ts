import { afterEach, describe, expect, it, vi } from "vitest";

/** 用户名边界：只 mock「读 .env.local / 环境变量」这一层 */
let configuredUsername = "EverMemory";
vi.mock("@utils/secret-io", () => ({
	readSecretValue: (key: string) =>
		key === "ADMIN_USERNAME" ? configuredUsername : "",
}));

/** 会话校验边界：只关心 token 是否有效 */
vi.mock("@utils/auth", () => ({
	getAuthTokenFromRequest: (request: Request) => {
		const match = (request.headers.get("cookie") ?? "").match(
			/(?:^|;\s*)admin_session=([^;]+)/,
		);
		return match ? match[1] : null;
	},
	verifySessionToken: async (token: string) =>
		token === "valid-token" ? { sid: "s1", role: "admin" } : null,
}));

const loadEndpoint = () => import("@/pages/api/admin/session");

const requestWith = (cookie?: string) =>
	new Request("http://localhost/api/admin/session/", {
		headers: cookie ? { cookie } : undefined,
	});

describe("GET /api/admin/session", () => {
	afterEach(() => {
		vi.resetModules();
		configuredUsername = "EverMemory";
	});

	it("未登录：success=false 且不回传用户名", async () => {
		const { GET } = await loadEndpoint();
		const res = await GET({ request: requestWith() });
		const body = await res.json();

		expect(body.success).toBe(false);
		// 去掉 payload 判断会连匿名请求也回传用户名，只断言 success 无法区分
		expect(body.username).toBeUndefined();
	});

	it("已登录：回传配置的管理员用户名（而非硬编码 admin）", async () => {
		const { GET } = await loadEndpoint();
		const res = await GET({
			request: requestWith("admin_session=valid-token"),
		});
		const body = await res.json();

		expect(body.success).toBe(true);
		expect(body.username).toBe("EverMemory");
	});

	it("未配置 ADMIN_USERNAME 时回退为 admin", async () => {
		configuredUsername = "";
		const { GET } = await loadEndpoint();
		const res = await GET({
			request: requestWith("admin_session=valid-token"),
		});
		const body = await res.json();

		expect(body.username).toBe("admin");
	});
});
