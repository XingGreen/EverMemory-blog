import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getEnv, IS_PROD_BUILD } from "./env";

const GITHUB_APP_ID = getEnv("GITHUB_APP_ID");
const GITHUB_OWNER = getEnv("GITHUB_OWNER");
const GITHUB_REPO = getEnv("GITHUB_REPO");
const GITHUB_BRANCH = getEnv("GITHUB_BRANCH") || "main";
const GITHUB_INSTALLATION_ID = getEnv("GITHUB_INSTALLATION_ID");

let privateKeyCache: string | null = null;

/**
 * 诊断日志：只在非生产构建打印。
 * 请求次数、文件 SHA、token 获取这些细节在线上日志里没有价值，只有噪音，
 * 而且会把真实错误淹没；本地排查时仍然照常输出。
 */
function debugLog(...args: unknown[]): void {
	if (!IS_PROD_BUILD) console.log(...args);
}

// Token 缓存：GitHub installation token 有效期 1 小时，避免频繁请求 API
let tokenCache: { token: string; expiresAt: number } | null = null;
const TOKEN_SAFETY_MARGIN_MS = 5 * 60 * 1000; // 提前 5 分钟过期，避免边界情况

export function getPrivateKey(): string {
	if (privateKeyCache) {
		return privateKeyCache;
	}

	// 1. 优先从环境变量读取（Vercel 等生产环境）
	//    支持纯文本或 Base64 编码（避免环境变量中的换行符问题）
	const envKey = getEnv("GITHUB_PRIVATE_KEY");
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
		getEnv("GITHUB_PRIVATE_KEY_PATH") || "",
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
	debugLog(
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

	console.debug("[GitHub Token] Successfully obtained installation token");
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
		console.debug(
			`[GitHub Token] Using cached token, expires in ${Math.round((tokenCache.expiresAt - Date.now()) / 1000)}s`,
		);
		return tokenCache.token;
	}

	try {
		console.debug("[GitHub Token] Initializing token request...");
		const privateKey = getPrivateKey();
		console.debug("[GitHub Token] Private key loaded, creating JWT...");
		const jwt = createJwt(privateKey, GITHUB_APP_ID);
		console.debug(
			"[GitHub Token] JWT created, requesting installation token...",
		);
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

/**
 * 把 fetch 的异常翻译成人能看懂的原因。
 *
 * undici 在连接层失败时只抛 `TypeError: fetch failed`，
 * 真正的信息在 `error.cause.code` 里（超时 / DNS / 连接重置 / TLS）。
 * 不取出来就只能显示「不可达」，把超时、认证失败、DNS 问题混成同一句话。
 */
export function describeFetchError(error: unknown): string {
	const err = error as {
		name?: string;
		message?: string;
		cause?: { code?: string; errno?: string; message?: string };
	};
	const cause = err?.cause;
	const code = String(cause?.code ?? cause?.errno ?? "");
	const causeMsg = cause?.message ?? "";

	if (code === "UND_ERR_CONNECT_TIMEOUT") return "连接 GitHub 超时";
	if (code === "UND_ERR_HEADERS_TIMEOUT") return "等待 GitHub 响应超时";
	if (code === "UND_ERR_BODY_TIMEOUT") return "读取 GitHub 响应超时";
	if (code === "UND_ERR_SOCKET") return "与 GitHub 的连接被中断";
	if (code === "ENOTFOUND" || code === "EAI_AGAIN")
		return `GitHub 域名解析失败（${code}）`;
	if (code === "ECONNREFUSED") return "连接 GitHub 被拒绝";
	if (code === "ECONNRESET") return "连接 GitHub 被重置";
	/* 证书链类错误的 code 五花八门，能确认的是「中间有人在动 TLS」 */
	if (
		code.startsWith("CERT_") ||
		code.includes("SSL") ||
		code.includes("TLS") ||
		code.includes("SELF_SIGNED") ||
		code.includes("UNABLE_TO_VERIFY")
	) {
		return `TLS 证书校验失败（${code}）：通常是系统代理或安全软件在做 HTTPS 拦截。请让本机代理的根证书进入信任链，或在启动开发服务器前清空 HTTP_PROXY / HTTPS_PROXY`;
	}
	if (err?.name === "AbortError" || err?.name === "TimeoutError")
		return "请求超时被中断";

	if (code) return `请求 GitHub 失败（${code}）`;
	if (causeMsg) return `请求 GitHub 失败：${causeMsg}`;
	return err?.message || "请求 GitHub 失败";
}

async function fetchWithRetry(
	url: string,
	options: RequestInit,
	maxRetries = 3,
): Promise<Response> {
	let lastError: Error | null = null;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			debugLog(
				`[GitHub Fetch] Attempt ${attempt}/${maxRetries}: ${options.method || "GET"} ${url}`,
			);

			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 30000);

			const response = await fetch(url, {
				...options,
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			/* 正常路径不打印：一次列表要拉十几个目录，每次都打一行会把
			   dev 终端刷满，真正需要的信息反而被埋掉。 */
			console.debug(
				`[GitHub Fetch] Attempt ${attempt} SUCCESS: status=${response.status}`,
			);
			return response;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			/* 中间重试失败只记 debug：网络抖动时 3 次重试 × 多个并发请求
			   会瞬间刷出几十行，其中绝大多数是会被下一次重试救回来的。
			   只有最终失败（下面那句）才值得 warn。 */
			console.debug(
				`[GitHub Fetch] Attempt ${attempt} FAILED: ${lastError.message}`,
			);

			if (attempt < maxRetries) {
				const delay = attempt * 2000;
				console.debug(`[GitHub Fetch] Retrying in ${delay}ms...`);
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}
	}

	const reason = describeFetchError(lastError);
	console.warn(
		`[GitHub Fetch] All ${maxRetries} attempts failed: ${reason}（原始：${lastError?.message ?? "unknown"}）`,
	);
	// 抛出分类后的文案，并保留原始错误作为 cause 供排查
	throw new Error(reason, { cause: lastError ?? undefined });
}

export type RemoteReadResult =
	| { ok: true; content: string }
	| {
			ok: false;
			/** 404 才是「文件不存在」；其余都是读取失败，不能混为一谈 */
			reason: "not-found" | "auth" | "server" | "network";
			status?: number;
			message: string;
	  };

/**
 * 读远端文件，并把失败原因分清楚。
 *
 * getFileFromGitHub 把所有失败都收敛成 null——404、500、断网看起来一模一样，
 * 上层只能报「远端不存在该文件」。断网时这么说，等于让用户去仓库里找
 * 一个本来就存在的文件。
 */
export async function readFileFromGitHub(
	filePath: string,
): Promise<RemoteReadResult> {
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
				signal: AbortSignal.timeout(15_000),
			},
		);
		if (response.ok) return { ok: true, content: await response.text() };
		if (response.status === 404) {
			return {
				ok: false,
				reason: "not-found",
				status: 404,
				message: "远端不存在该文件",
			};
		}
		if (response.status === 401 || response.status === 403) {
			return {
				ok: false,
				reason: "auth",
				status: response.status,
				message: `GitHub 认证失败（${response.status}）：检查 App 凭据或权限`,
			};
		}
		return {
			ok: false,
			reason: "server",
			status: response.status,
			message: `GitHub 返回 HTTP ${response.status}，请稍后重试`,
		};
	} catch (error) {
		return {
			ok: false,
			reason: "network",
			message: `读取远端失败：${describeFetchError(error)}`,
		};
	}
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
/**
 * 列举目录内容。
 * sha 是 Git 的 blob 哈希（与本地 gitBlobSha 同源），用于「只比对元数据、
 * 不拉正文」的同步检查；目录项的 sha 是 tree 哈希，不用于内容比对。
 */
export async function listFilesFromGitHub(
	directoryPath: string,
): Promise<Array<{ name: string; path: string; type: string; sha?: string }>> {
	const token = await getInstallationToken();
	const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${directoryPath}?ref=${GITHUB_BRANCH}`;

	console.debug(`[GitHub List] Listing: ${directoryPath}`);

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
		return [
			{ name: data.name, path: data.path, type: data.type, sha: data.sha },
		];
	}

	return data.map(
		(item: { name: string; path: string; type: string; sha?: string }) => ({
			name: item.name,
			path: item.path,
			type: item.type,
			sha: item.sha,
		}),
	);
}

/**
 * 递归收集 markdown 文件及其 blob sha。
 * 与 listAllMarkdownFiles 的区别：那个只返回路径，这个带上 sha，
 * 供同步检查做内容比对——整个递归只拉目录元数据，不下载任何正文。
 */
export async function listMarkdownWithSha(
	directoryPath: string,
): Promise<Array<{ path: string; sha: string }>> {
	const items = await listFilesFromGitHub(directoryPath);
	const result: Array<{ path: string; sha: string }> = [];

	for (const item of items) {
		if (item.type === "file" && /\.mdx?$/.test(item.name) && item.sha) {
			result.push({ path: item.path, sha: item.sha });
		} else if (item.type === "dir") {
			result.push(...(await listMarkdownWithSha(item.path)));
		}
	}

	return result;
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
		/* 内容集合同时支持 .md 与 .mdx（见 content.config.ts），列目录时一并纳入，
		   否则 .mdx 文章永远进不了远端清单，会被误判成「未推送」。 */
		if (
			item.type === "file" &&
			(item.name.endsWith(".md") || item.name.endsWith(".mdx"))
		) {
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

		debugLog(`[GitHub Save] Attempting to save: ${filePath}`);
		debugLog(
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
			debugLog(`[GitHub Save] Existing file SHA: ${sha}`);
		} else if (getResponse.status !== 404) {
			const errorText = await getResponse.text();
			console.error(
				`[GitHub Save] Failed to get file info: ${getResponse.status}`,
				errorText,
			);
		} else {
			debugLog("[GitHub Save] File does not exist, will create new");
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
			debugLog(`[GitHub Save] Successfully saved: ${filePath}`);
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

	debugLog(`[GitHub Delete] Attempting to delete: ${filePath}`);
	debugLog(
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
		debugLog(
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
	debugLog(`[GitHub Delete] File SHA: ${data.sha}`);

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
		debugLog(
			`[GitHub Delete] Failed to delete file: ${response.status}`,
			errorText,
		);
		throw new Error(
			`Failed to delete file: HTTP ${response.status} - ${errorText}`,
		);
	}

	debugLog(`[GitHub Delete] Successfully deleted: ${filePath}`);
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
			debugLog(`[Local Save] Created directory: ${dir}`);
		}

		/* 内容未变就不写盘。
		   dev 下 Vite 监听整个 src/，而 src/content 是 content collection、无法热替换，
		   哪怕只更新 mtime 也会触发整页 full reload —— 表现为「点保存后页面刷新、
		   编辑器被重置、toast 一闪而过」，看起来像保存失败。 */
		if (fs.existsSync(fullPath)) {
			const existing = fs.readFileSync(fullPath, "utf-8");
			if (existing === content) {
				debugLog(`[Local Save] 内容未变化，跳过写入: ${relativePath}`);
				return true;
			}
		}

		fs.writeFileSync(fullPath, content, "utf-8");
		debugLog(`[Local Save] Successfully saved: ${relativePath}`);
		return true;
	} catch (error) {
		debugLog(
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
			debugLog(`[Local Delete] File does not exist, skipping: ${relativePath}`);
			return true; // 文件不存在也算删除成功
		}

		fs.unlinkSync(fullPath);
		debugLog(`[Local Delete] Successfully deleted: ${relativePath}`);
		return true;
	} catch (error) {
		debugLog(
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

/**
 * 解析文章 slug 对应的真实仓库路径。
 *
 * 不能直接拼 `${slug}.md`：内容集合同时收录 `.md` 与 `.mdx`（见 content.config.ts），
 * 硬编码 `.md` 会让 mdx 文章「编辑时另存出一份同名 .md」「删除时删不到真实文件」。
 * 按候选顺序探测，本地可读时查磁盘，只读部署（Vercel / Workers）下逐个问 GitHub。
 * 都找不到返回 null —— 调用方自行决定是新建（保存）还是报 404（读取/删除）。
 */
export async function resolvePostPath(slug: string): Promise<string | null> {
	const candidates = [
		`src/content/posts/${slug}.md`,
		`src/content/posts/${slug}.mdx`,
		// slug 是目录名时的兜底形态（当前 isValidPostSlug 不允许 "/"，留着防止将来放宽）
		`src/content/posts/${slug}/index.md`,
		`src/content/posts/${slug}/index.mdx`,
	];

	if (!IS_PROD_BUILD) {
		for (const rel of candidates) {
			if (fs.existsSync(path.resolve(process.cwd(), rel))) return rel;
		}
		return null;
	}

	for (const rel of candidates) {
		const raw = await getFileFromGitHub(rel);
		if (raw !== null) return rel;
	}
	return null;
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

/**
 * 测试 GitHub 连通性：绕过 token 缓存，每次都真实发起一次 GitHub API 请求，
 * 确保网络断开时能如实反映。成功返回本次请求耗时(ms)，失败抛错。
 */
export async function testGitHubConnection(): Promise<number> {
	const started = Date.now();

	// 真实请求：race 可能被超时先判胜，因此给真实请求附加空 catch，
	// 避免超时后请求抛错时 rejection 无人消费（UnhandledRejection）
	const request = getInstallationTokenFromGitHub(
		createJwt(getPrivateKey(), GITHUB_APP_ID),
		GITHUB_INSTALLATION_ID,
	);
	request.catch(() => {});

	// 15s 超时，避免网络断开时请求长时间挂起
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error("连接超时（15s）")), 15000);
	});

	try {
		await Promise.race([request, timeout]);
	} finally {
		// race 结束即取消定时器，防止超时 reject 在请求先返回后仍然触发
		if (timer) clearTimeout(timer);
	}

	return Date.now() - started;
}

/**
 * 把 UTF-8 字符串编成 base64。
 *
 * 不用 Buffer：Cloudflare Workers 运行时只有 nodejs_compat 才给 Buffer，
 * 而这个函数在两条部署线都要跑。TextEncoder + btoa 两边都有。
 */
function toBase64(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

/**
 * 一次提交多个文件（GraphQL createCommitOnBranch）。
 *
 * 为什么不是循环调 saveFileToGitHub：每次调用产生一个 commit，
 * 每个 commit 都会触发一次部署。推 5 篇就是 5 次构建——这正是
 * 「改完要等半天才上线」的来源。
 *
 * expectedHeadOid 顺带提供乐观锁：期间远端被推过，整个提交失败而不是静默覆盖。
 *
 * @param files content 为 null 表示删除该文件
 */
export async function commitFiles(
	files: Array<{ path: string; content: string | null }>,
	message: { headline: string; body?: string },
): Promise<{ ok: boolean; commitOid?: string; message?: string }> {
	if (files.length === 0) return { ok: true };

	let token: string;
	try {
		token = await getInstallationToken();
	} catch (error) {
		return {
			ok: false,
			message: error instanceof Error ? error.message : String(error),
		};
	}

	// 1. 当前 HEAD 作为 expectedHeadOid
	const refRes = await fetch(
		`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/ref/heads/${GITHUB_BRANCH}`,
		{
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github+json",
			},
		},
	);
	if (!refRes.ok) {
		return { ok: false, message: `读取分支失败：HTTP ${refRes.status}` };
	}
	const ref = (await refRes.json()) as { object?: { sha?: string } };
	const expectedHeadOid = ref.object?.sha;
	if (!expectedHeadOid) return { ok: false, message: "无法读取分支 HEAD" };

	/* 2. 组装变更。
	   注意 additions / deletions 在 schema 里都是 [X!]!（非空列表），
	   所以两个字段都必须出现，没有内容时传空数组，而不是省略。 */
	const additions = files
		.filter((f) => f.content !== null)
		.map((f) => ({
			path: f.path,
			contents: toBase64(f.content as string),
		}));
	const deletions = files
		.filter((f) => f.content === null)
		.map((f) => ({ path: f.path }));
	if (additions.length === 0 && deletions.length === 0) return { ok: true };
	const fileChanges = { additions, deletions };

	// 3. 一次提交
	const res = await fetch("https://api.github.com/graphql", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			Accept: "application/json",
		},
		body: JSON.stringify({
			query: `mutation ($input: CreateCommitOnBranchInput!) {
				createCommitOnBranch(input: $input) {
					commit { oid }
				}
			}`,
			variables: {
				input: {
					branch: {
						repositoryNameWithOwner: `${GITHUB_OWNER}/${GITHUB_REPO}`,
						branchName: GITHUB_BRANCH,
					},
					expectedHeadOid,
					message: message.body
						? { headline: message.headline, body: message.body }
						: { headline: message.headline },
					fileChanges,
				},
			},
		}),
	});

	const payload = (await res.json().catch(() => null)) as {
		data?: { createCommitOnBranch?: { commit?: { oid?: string } } };
		errors?: Array<{ message?: string }>;
	} | null;

	if (!res.ok || payload?.errors?.length) {
		const detail =
			payload?.errors
				?.map((e) => e.message)
				.filter(Boolean)
				.join("; ") ?? `HTTP ${res.status}`;
		return { ok: false, message: detail };
	}

	const oid = payload?.data?.createCommitOnBranch?.commit?.oid;
	if (!oid) return { ok: false, message: "提交未返回 commit oid" };
	return { ok: true, commitOid: oid };
}
