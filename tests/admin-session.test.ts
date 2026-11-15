import { afterEach, describe, expect, it, vi } from "vitest";

/** 登录方式开关：只 mock「是否已配置」这一层 */
let oauthConfigured = true;
let breakglassConfigured = true;
/** 签名密钥是否可用：缺密钥时应回 configError 而不是把人踢回登录页 */
let secretAvailable = true;
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
	isJwtSecretAvailable: () => secretAvailable,
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
		secretAvailable = true;
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

	it("签名密钥不可用：回 configError，且不把有效 Cookie 当作已登录", async () => {
		secretAvailable = false;
		const { GET } = await loadEndpoint();
		const res = await GET({
			request: requestWith("admin_session=valid-token"),
		});
		const body = await res.json();

		// 不能返回 success=true：否则后台照常渲染、每个接口 401，形成回弹
		expect(body.success).toBe(false);
		expect(body.configError).toContain("ADMIN_JWT_SECRET");
	});
});
