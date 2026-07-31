import { verifyPrivateKey } from "@/utils/github-app";
import { generateSessionToken, setAuthCookie, clearAuthCookie } from "@/utils/auth";

export const prerender = false;

export async function POST({ request }) {
	try {
		const text = await request.text();
		const body = JSON.parse(text);
		let privateKey = body.privateKey;

		if (!privateKey) {
			console.log(`[Admin Verify] Failed: missing private key`);
			return new Response(
				JSON.stringify({ success: false, message: "请提供私钥" }),
				{ status: 400, headers: { "Content-Type": "application/json" } },
			);
		}

		privateKey = privateKey
			.replace(/\r\n/g, "\n")
			.replace(/\r/g, "\n")
			.trim();

		console.log(`[Admin Verify] Private key received, length: ${privateKey.length}`);
		const isValid = await verifyPrivateKey(privateKey);
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
			JSON.stringify({ success: false, message: "私钥无效" }),
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
				error: error instanceof Error ? error.message : String(error),
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
