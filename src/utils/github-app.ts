import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const GITHUB_APP_ID = import.meta.env.GITHUB_APP_ID || "";
const GITHUB_OWNER = import.meta.env.GITHUB_OWNER || "";
const GITHUB_REPO = import.meta.env.GITHUB_REPO || "";
const GITHUB_BRANCH = import.meta.env.GITHUB_BRANCH || "main";
const GITHUB_INSTALLATION_ID = import.meta.env.GITHUB_INSTALLATION_ID || "";

let privateKeyCache: string | null = null;

// Token 缓存：GitHub installation token 有效期 1 小时，避免频繁请求 API
let tokenCache: { token: string; expiresAt: number } | null = null;
const TOKEN_SAFETY_MARGIN_MS = 5 * 60 * 1000; // 提前 5 分钟过期，避免边界情况

export function getPrivateKey(): string {
	if (privateKeyCache) {
		return privateKeyCache;
	}

	// 1. 优先从环境变量读取（Vercel 等生产环境）
	//    支持纯文本或 Base64 编码（避免环境变量中的换行符问题）
	const envKey = import.meta.env.GITHUB_PRIVATE_KEY;
	if (envKey) {
		// 如果以 -----BEGIN 开头，当作纯文本
		if (envKey.includes("-----BEGIN")) {
			privateKeyCache = envKey;
			return envKey;
		}
		// 否则尝试 Base64 解码
		try {
			const decoded = Buffer.from(envKey, "base64").toString("utf-8");
			if (decoded.includes("-----BEGIN")) {
				privateKeyCache = decoded;
				return decoded;
			}
			console.error(
				"[GitHub Key] GITHUB_PRIVATE_KEY Base64 解码后不包含有效 PEM 头，尝试文件读取",
			);
		} catch {
			console.error(
				"[GitHub Key] GITHUB_PRIVATE_KEY Base64 解码失败，尝试文件读取",
			);
		}
	}

	// 2. 回退到文件系统读取（本地开发）
	const possiblePaths = [
		path.resolve(process.cwd(), ".key/emblog-ghapp.2026-07-29.private-key.pem"),
		path.resolve(
			process.cwd(),
			".keys/emblog-ghapp.2026-07-29.private-key.pem",
		),
		import.meta.env.GITHUB_PRIVATE_KEY_PATH || "",
	];

	for (const keyPath of possiblePaths) {
		if (keyPath && fs.existsSync(keyPath)) {
			privateKeyCache = fs.readFileSync(keyPath, "utf-8");
			return privateKeyCache;
		}
	}

	throw new Error(
		"GitHub App 私钥未找到。请在环境变量 GITHUB_PRIVATE_KEY 中配置（纯文本或 Base64 编码），或将私钥文件放在 .key/ 目录下。",
	);
}

function normalizeKey(key: string): string {
	return key.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

/**
 * 验证用户提交的私钥是否与服务端配置的私钥匹配
 * 使用 SHA256 指纹 + timingSafeEqual 防止时序攻击
 */
export async function verifyPrivateKey(
	privateKeyContent: string,
): Promise<boolean> {
	try {
		if (!privateKeyContent || !privateKeyContent.includes("PRIVATE KEY")) {
			return false;
		}

		const key = crypto.createPrivateKey(privateKeyContent);
		if (key.type !== "private" || key.asymmetricKeyType !== "rsa") {
			return false;
		}

		const normalizedInput = normalizeKey(privateKeyContent);
		const storedKey = getPrivateKey();
		const normalizedStored = normalizeKey(storedKey);

		const inputFingerprint = crypto
			.createHash("sha256")
			.update(normalizedInput)
			.digest();
		const storedFingerprint = crypto
			.createHash("sha256")
			.update(normalizedStored)
			.digest();

		if (inputFingerprint.length !== storedFingerprint.length) {
			return false;
		}

		return crypto.timingSafeEqual(inputFingerprint, storedFingerprint);
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		if (msg.includes("私钥未找到")) {
			console.error("[Verify] 服务端私钥未配置:", msg);
		} else {
			console.error("[Verify] 私钥验证异常:", msg);
		}
		return false;
	}
}

function createJwt(privateKey: string, appId: string): string {
	const header = { alg: "RS256", typ: "JWT" };
	const now = Math.floor(Date.now() / 1000);
	const payload = {
		iat: now - 60,
		exp: now + 540,
		iss: appId,
	};
	const base64Url = (obj: object) =>
		Buffer.from(JSON.stringify(obj))
			.toString("base64")
			.replace(/=/g, "")
			.replace(/\+/g, "-")
			.replace(/\//g, "_");
	const headerB64 = base64Url(header);
	const payloadB64 = base64Url(payload);
	const signInput = `${headerB64}.${payloadB64}`;
	const sign = crypto.createSign("RSA-SHA256");
	sign.update(signInput);
	sign.end();
	const signature = sign
		.sign(privateKey, "base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=/g, "");
	return `${signInput}.${signature}`;
}

async function getInstallationTokenFromGitHub(
	jwt: string,
	installationId: string,
): Promise<{ token: string; expiresAt: number }> {
	console.log(
		`[GitHub Token] Requesting installation token for app: ${GITHUB_APP_ID}, installation: ${installationId}`,
	);

	const response = await fetch(
		`https://api.github.com/app/installations/${installationId}/access_tokens`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${jwt}`,
				Accept: "application/vnd.github+json",
				"User-Agent": "Firefly-Blog",
			},
		},
	);

	if (!response.ok) {
		const errorText = await response.text();
		console.error(`[GitHub Token] Failed: ${response.status}`, errorText);
		throw new Error(
			`Failed to get installation token: ${response.status} - ${errorText}`,
		);
	}

	console.log("[GitHub Token] Successfully obtained installation token");
	const data = await response.json();
	// GitHub 返回 expires_at 为 ISO 字符串，转为时间戳
	const expiresAt = data.expires_at
		? new Date(data.expires_at).getTime()
		: Date.now() + 50 * 60 * 1000;
	return { token: data.token, expiresAt };
}

export async function getInstallationToken(): Promise<string> {
	// 1. 检查缓存：token 未过期则直接复用
	if (
		tokenCache &&
		Date.now() < tokenCache.expiresAt - TOKEN_SAFETY_MARGIN_MS
	) {
		console.log(
			`[GitHub Token] Using cached token, expires in ${Math.round((tokenCache.expiresAt - Date.now()) / 1000)}s`,
		);
		return tokenCache.token;
	}

	try {
		console.log("[GitHub Token] Initializing token request...");
		const privateKey = getPrivateKey();
		console.log("[GitHub Token] Private key loaded, creating JWT...");
		const jwt = createJwt(privateKey, GITHUB_APP_ID);
		console.log("[GitHub Token] JWT created, requesting installation token...");
		const result = await getInstallationTokenFromGitHub(
			jwt,
			GITHUB_INSTALLATION_ID,
		);
		tokenCache = result;
		return result.token;
	} catch (error) {
		console.error(
			"[GitHub Token] Exception:",
			error instanceof Error ? error.message : error,
		);
		throw error;
	}
}

async function fetchWithRetry(
	url: string,
	options: RequestInit,
	maxRetries = 3,
): Promise<Response> {
	let lastError: Error | null = null;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			console.log(
				`[GitHub Fetch] Attempt ${attempt}/${maxRetries}: ${options.method || "GET"} ${url}`,
			);

			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 30000);

			const response = await fetch(url, {
				...options,
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			console.log(
				`[GitHub Fetch] Attempt ${attempt} SUCCESS: status=${response.status}`,
			);
			return response;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			console.log(
				`[GitHub Fetch] Attempt ${attempt} FAILED: ${lastError.message}`,
			);
			console.log(`[GitHub Fetch] Error stack: ${lastError.stack}`);

			if (attempt < maxRetries) {
				const delay = attempt * 2000;
				console.log(`[GitHub Fetch] Retrying in ${delay}ms...`);
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}
	}

	console.log(`[GitHub Fetch] All ${maxRetries} attempts failed`);
	throw lastError || new Error("Unknown fetch error");
}

export async function getFileFromGitHub(
	filePath: string,
): Promise<string | null> {
	try {
		const token = await getInstallationToken();
		const response = await fetch(
			`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_BRANCH}`,
			{
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: "application/vnd.github.v3.raw",
					"User-Agent": "Firefly-Blog",
				},
			},
		);

		if (!response.ok) {
			return null;
		}

		return await response.text();
	} catch {
		return null;
	}
}

/**
 * 列出 GitHub 仓库中指定目录下的文件
 */
export async function listFilesFromGitHub(
	directoryPath: string,
): Promise<Array<{ name: string; path: string; type: string }>> {
	const token = await getInstallationToken();
	const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${directoryPath}?ref=${GITHUB_BRANCH}`;

	console.log(`[GitHub List] Listing: ${directoryPath}`);

	const response = await fetchWithRetry(url, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github.v3+json",
			"User-Agent": "Firefly-Blog",
		},
	});

	if (!response.ok) {
		const errorText = await response.text();
		console.error(`[GitHub List] Failed: ${response.status}`, errorText);
		throw new Error(`Failed to list directory: HTTP ${response.status}`);
	}

	const data = await response.json();

	if (!Array.isArray(data)) {
		// 可能是单个文件
		return [{ name: data.name, path: data.path, type: data.type }];
	}

	return data.map((item: { name: string; path: string; type: string }) => ({
		name: item.name,
		path: item.path,
		type: item.type,
	}));
}

/**
 * 递归获取目录下所有 .md 文件
 */
export async function listAllMarkdownFiles(
	directoryPath: string,
): Promise<string[]> {
	const items = await listFilesFromGitHub(directoryPath);
	const mdFiles: string[] = [];

	for (const item of items) {
		if (item.type === "file" && item.name.endsWith(".md")) {
			mdFiles.push(item.path);
		} else if (item.type === "dir") {
			// 递归获取子目录
			const subFiles = await listAllMarkdownFiles(item.path);
			mdFiles.push(...subFiles);
		}
	}

	return mdFiles;
}

export async function saveFileToGitHub(
	filePath: string,
	content: string,
	commitMessage: string,
): Promise<boolean> {
	try {
		const token = await getInstallationToken();
		const repoUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;

		console.log(`[GitHub Save] Attempting to save: ${filePath}`);
		console.log(
			`[GitHub Save] Repo: ${GITHUB_OWNER}/${GITHUB_REPO}, Branch: ${GITHUB_BRANCH}`,
		);

		const getResponse = await fetchWithRetry(
			`${repoUrl}?ref=${GITHUB_BRANCH}`,
			{
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: "application/vnd.github.v3+json",
					"User-Agent": "Firefly-Blog",
				},
			},
		);

		let sha: string | undefined;
		if (getResponse.ok) {
			const data = await getResponse.json();
			sha = data.sha;
			console.log(`[GitHub Save] Existing file SHA: ${sha}`);
		} else if (getResponse.status !== 404) {
			const errorText = await getResponse.text();
			console.error(
				`[GitHub Save] Failed to get file info: ${getResponse.status}`,
				errorText,
			);
		} else {
			console.log("[GitHub Save] File does not exist, will create new");
		}

		const body = {
			message: commitMessage,
			content: Buffer.from(content).toString("base64"),
			branch: GITHUB_BRANCH,
			...(sha ? { sha } : {}),
		};

		const response = await fetchWithRetry(repoUrl, {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github.v3+json",
				"Content-Type": "application/json",
				"User-Agent": "Firefly-Blog",
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error(
				`[GitHub Save] Failed to save file: ${response.status}`,
				errorText,
			);
		} else {
			console.log(`[GitHub Save] Successfully saved: ${filePath}`);
		}

		return response.ok;
	} catch (error) {
		console.error(
			"[GitHub Save] Exception:",
			error instanceof Error ? error.message : error,
		);
		return false;
	}
}

export async function deleteFileFromGitHub(
	filePath: string,
	commitMessage: string,
): Promise<void> {
	const token = await getInstallationToken();
	const repoUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;

	console.log(`[GitHub Delete] Attempting to delete: ${filePath}`);
	console.log(
		`[GitHub Delete] Repo: ${GITHUB_OWNER}/${GITHUB_REPO}, Branch: ${GITHUB_BRANCH}`,
	);

	const getResponse = await fetchWithRetry(`${repoUrl}?ref=${GITHUB_BRANCH}`, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github.v3+json",
			"User-Agent": "Firefly-Blog",
		},
	});

	if (!getResponse.ok) {
		const errorText = await getResponse.text();
		console.log(
			`[GitHub Delete] Failed to get file SHA: ${getResponse.status}`,
			errorText,
		);
		if (getResponse.status === 404) {
			throw new Error(
				"文件在 GitHub 仓库中不存在（可能仅在本地存在，尚未提交到远程仓库）",
			);
		}
		throw new Error(
			`Failed to get file info: HTTP ${getResponse.status} - ${errorText}`,
		);
	}

	const data = await getResponse.json();
	console.log(`[GitHub Delete] File SHA: ${data.sha}`);

	const response = await fetchWithRetry(repoUrl, {
		method: "DELETE",
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github.v3+json",
			"Content-Type": "application/json",
			"User-Agent": "Firefly-Blog",
		},
		body: JSON.stringify({
			message: commitMessage,
			sha: data.sha,
			branch: GITHUB_BRANCH,
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		console.log(
			`[GitHub Delete] Failed to delete file: ${response.status}`,
			errorText,
		);
		throw new Error(
			`Failed to delete file: HTTP ${response.status} - ${errorText}`,
		);
	}

	console.log(`[GitHub Delete] Successfully deleted: ${filePath}`);
}

// ==================== 本地文件同步功能 ====================

function resolveLocalPath(relativePath: string): string {
	return path.resolve(process.cwd(), relativePath);
}

/**
 * 保存文件到本地文件系统
 */
export function saveFileLocally(
	relativePath: string,
	content: string,
): boolean {
	try {
		const fullPath = resolveLocalPath(relativePath);
		const dir = path.dirname(fullPath);

		// 确保目录存在
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
			console.log(`[Local Save] Created directory: ${dir}`);
		}

		fs.writeFileSync(fullPath, content, "utf-8");
		console.log(`[Local Save] Successfully saved: ${relativePath}`);
		return true;
	} catch (error) {
		console.log(
			`[Local Save] Failed to save ${relativePath}:`,
			error instanceof Error ? error.message : error,
		);
		return false;
	}
}

/**
 * 从本地文件系统删除文件
 */
export function deleteFileLocally(relativePath: string): boolean {
	try {
		const fullPath = resolveLocalPath(relativePath);

		if (!fs.existsSync(fullPath)) {
			console.log(
				`[Local Delete] File does not exist, skipping: ${relativePath}`,
			);
			return true; // 文件不存在也算删除成功
		}

		fs.unlinkSync(fullPath);
		console.log(`[Local Delete] Successfully deleted: ${relativePath}`);
		return true;
	} catch (error) {
		console.log(
			`[Local Delete] Failed to delete ${relativePath}:`,
			error instanceof Error ? error.message : error,
		);
		return false;
	}
}

/**
 * 验证文章 slug 是否合法，防止路径穿越
 * 仅允许字母、数字、连字符、下划线，禁止路径分隔符或 ".."
 */
export function isValidPostSlug(slug: unknown): boolean {
	return typeof slug === "string" && /^[A-Za-z0-9_-]+$/.test(slug);
}

export function getConfig() {
	return {
		appId: GITHUB_APP_ID,
		owner: GITHUB_OWNER,
		repo: GITHUB_REPO,
		branch: GITHUB_BRANCH,
		installationId: GITHUB_INSTALLATION_ID,
	};
}
