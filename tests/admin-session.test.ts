import { afterEach, describe, expect, it, vi } from "vitest";

/** 登录方式开关：只 mock「是否已配置」这一层 */
let oauthConfigured = true;
let breakglassConfigured = true;
vi.mock("@utils/github-oauth", () => ({
	isOAuthConfigured: () => oauthConfigured,
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
		token === "valid-token" ? { sid: "s1", username: "EverMemory" } : null,
	isBreakglassConfigured: () => breakglassConfigured,
}));

const loadEndpoint = () => import("@/pages/api/admin/session");

const requestWith = (cookie?: string) =>
	new Request("http://localhost/api/admin/session/", {
		headers: cookie ? { cookie } : undefined,
	});

describe("GET /api/admin/session", () => {
	afterEach(() => {
		vi.resetModules();
		oauthConfigured = true;
		breakglassConfigured = true;
	});

	it("未登录：success=false 且不回传用户名", async () => {
		const { GET } = await loadEndpoint();
		const res = await GET({ request: requestWith() });
		const body = await res.json();

		expect(body.success).toBe(false);
		// 去掉 payload 判断会连匿名请求也回传用户名，只断言 success 无法区分
		expect(body.username).toBeUndefined();
		// 登录方式开关与登录态无关，匿名也应回传（登录页据此渲染入口）
		expect(body.oauthEnabled).toBe(true);
		expect(body.breakglassEnabled).toBe(true);
	});

	it("已登录：回传账户名（走会话表实时值）", async () => {
		const { GET } = await loadEndpoint();
		const res = await GET({
			request: requestWith("admin_session=valid-token"),
		});
		const body = await res.json();

		expect(body.success).toBe(true);
		expect(body.username).toBe("EverMemory");
	});

	it("回传的开关反映后端配置", async () => {
		oauthConfigured = false;
		breakglassConfigured = false;
		const { GET } = await loadEndpoint();
		const res = await GET({ request: requestWith() });
		const body = await res.json();

		expect(body.oauthEnabled).toBe(false);
		expect(body.breakglassEnabled).toBe(false);
	});
});
