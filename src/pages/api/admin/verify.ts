import { verifyAdminPassword, generateSessionToken, setAuthCookie, clearAuthCookie } from "@/utils/auth";

export const prerender = false;

export async function POST({ request }) {
	try {
		const text = await request.text();
		const body = JSON.parse(text);
		const { password } = body;

		if (!password) {
			console.log(`[Admin Verify] Failed: missing password`);
			return new Response(
				JSON.stringify({ success: false, message: "请输入管理密码" }),
				{ status: 400, headers: { "Content-Type": "application/json" } },
			);
		}

		console.log(`[Admin Verify] Password received, length: ${password.length}`);
		const isValid = verifyAdminPassword(password);
		console.log(`[Admin Verify] Verification result: ${isValid ? "SUCCESS" : "FAILED"}`);

		if (isValid) {
			const token = generateSessionToken();
			const headers = new Headers({ "Content-Type": "application/json" });
			setAuthCookie(token, headers);

			return new Response(
				JSON.stringify({
					success: true,
					message: "验证成功",
				}),
				{ status: 200, headers },
			);
		}

		const failHeaders = new Headers({ "Content-Type": "application/json" });
		clearAuthCookie(failHeaders);

		return new Response(
			JSON.stringify({ success: false, message: "管理密码错误" }),
			{ status: 401, headers: failHeaders },
		);
	} catch (error) {
		console.error(`[Admin Verify] Exception:`, error instanceof Error ? error.stack : error);
		const failHeaders = new Headers({ "Content-Type": "application/json" });
		clearAuthCookie(failHeaders);

		return new Response(
			JSON.stringify({
				success: false,
				message: "验证失败",
			}),
			{ status: 500, headers: failHeaders },
		);
	}
}

export async function DELETE() {
	const headers = new Headers({ "Content-Type": "application/json" });
	clearAuthCookie(headers);

	return new Response(
		JSON.stringify({ success: true, message: "已退出" }),
		{ status: 200, headers },
	);
}
