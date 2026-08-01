import crypto from "node:crypto";

const JWT_SECRET =
	import.meta.env.ADMIN_JWT_SECRET ||
	"firefly-admin-secret-key-change-in-production";
const JWT_EXPIRY_HOURS = 1;

interface JwtPayload {
	sub: string;
	role: string;
	iat: number;
	exp: number;
}

export function generateSessionToken(): string {
	const payload: JwtPayload = {
		sub: crypto.randomUUID(),
		role: "admin",
		iat: Math.floor(Date.now() / 1000),
		exp: Math.floor(Date.now() / 1000) + JWT_EXPIRY_HOURS * 3600,
	};

	const header = { alg: "HS256", typ: "JWT" };

	const base64Url = (obj: object) =>
		Buffer.from(JSON.stringify(obj))
			.toString("base64")
			.replace(/=/g, "")
			.replace(/\+/g, "-")
			.replace(/\//g, "_");

	const headerB64 = base64Url(header);
	const payloadB64 = base64Url(payload);
	const signInput = `${headerB64}.${payloadB64}`;

	const signature = crypto
		.createHmac("sha256", JWT_SECRET)
		.update(signInput)
		.digest("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=/g, "");

	return `${signInput}.${signature}`;
}

export function verifySessionToken(token: string): boolean {
	try {
		if (!token) return false;

		const parts = token.split(".");
		if (parts.length !== 3) return false;

		const [headerB64, payloadB64, signature] = parts;
		const signInput = `${headerB64}.${payloadB64}`;

		const expectedSignature = crypto
			.createHmac("sha256", JWT_SECRET)
			.update(signInput)
			.digest("base64")
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=/g, "");

		if (signature !== expectedSignature) {
			return false;
		}

		const payload = JSON.parse(
			Buffer.from(
				payloadB64.replace(/-/g, "+").replace(/_/g, "/"),
				"base64",
			).toString(),
		) as JwtPayload;

		if (payload.exp < Math.floor(Date.now() / 1000)) {
			return false;
		}

		if (payload.role !== "admin") {
			return false;
		}

		return true;
	} catch {
		return false;
	}
}

export function getAuthTokenFromRequest(request: Request): string | null {
	const cookieHeader = request.headers.get("cookie");
	if (!cookieHeader) return null;

	const cookies = cookieHeader.split(";").map((c) => c.trim());
	for (const cookie of cookies) {
		const [name, value] = cookie.split("=");
		if (name === "admin_session" && value) {
			return decodeURIComponent(value);
		}
	}

	return null;
}

export function requireAuth(request: Request): {
	authenticated: boolean;
	response?: Response;
} {
	const token = getAuthTokenFromRequest(request);

	if (!token || !verifySessionToken(token)) {
		return {
			authenticated: false,
			response: new Response(
				JSON.stringify({ success: false, message: "未授权或会话已过期" }),
				{ status: 401, headers: { "Content-Type": "application/json" } },
			),
		};
	}

	return { authenticated: true };
}

export function setAuthCookie(token: string, headers: Headers): void {
	headers.set(
		"Set-Cookie",
		`admin_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${JWT_EXPIRY_HOURS * 3600}`,
	);
}

export function clearAuthCookie(headers: Headers): void {
	headers.set(
		"Set-Cookie",
		"admin_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
	);
}
