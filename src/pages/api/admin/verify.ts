import {
	clearAuthCookie,
	generateSessionToken,
	setAuthCookie,
	verifyAdminPassword,
	verifyAdminUsername,
} from "@/utils/auth";

export const prerender = false;

export async function POST({ request }) {
	try {
		const text = await request.text();
		const body = JSON.parse(text);
		const { username, password } = body;

		// 参数完整性检查
		const missing: string[] = [];
		if (!username) missing.push("用户名");
		if (!password) missing.push("密码");

		if (missing.length > 0) {
			console.log(`[Admin Verify] Failed: missing ${missing.join(", ")}`);
			return new Response(
				JSON.stringify({
					success: false,
					message: `缺少: ${missing.join("、")}`,
				}),
				{ status: 400, headers: { "Content-Type": "application/json" } },
			);
		}

		console.log(
			`[Admin Verify] Username: ${username}, password length: ${password.length}`,
		);

		// 双重验证：用户名 + 密码，全部通过才签发会话
		// 私钥由服务端环境变量持有，用于 GitHub API 操作，前端不传输
		const usernameOk = verifyAdminUsername(username);
		const passwordOk = verifyAdminPassword(password);

		console.log(
			`[Admin Verify] Results: username=${usernameOk}, password=${passwordOk}`,
		);

		if (usernameOk && passwordOk) {
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

		// 至少一项失败，返回具体提示（不泄露哪一项失败）
		const failHeaders = new Headers({ "Content-Type": "application/json" });
		clearAuthCookie(failHeaders);

		return new Response(
			JSON.stringify({ success: false, message: "用户名或密码错误" }),
			{ status: 401, headers: failHeaders },
		);
	} catch (error) {
		console.error(
			"[Admin Verify] Exception:",
			error instanceof Error ? error.stack : error,
		);
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
}
