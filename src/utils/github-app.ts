import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const GITHUB_APP_ID = import.meta.env.GITHUB_APP_ID || "4423412";
const GITHUB_OWNER = import.meta.env.GITHUB_OWNER || "";
const GITHUB_REPO = import.meta.env.GITHUB_REPO || "";
const GITHUB_BRANCH = import.meta.env.GITHUB_BRANCH || "main";
const GITHUB_INSTALLATION_ID = import.meta.env.GITHUB_INSTALLATION_ID || "149804847";

let privateKeyCache: string | null = null;

export function getPrivateKey(): string {
	if (privateKeyCache) {
		return privateKeyCache;
	}

	const possiblePaths = [
		path.resolve(process.cwd(), ".key/emblog-ghapp.2026-07-29.private-key.pem"),
		path.resolve(process.cwd(), ".keys/emblog-ghapp.2026-07-29.private-key.pem"),
		import.meta.env.GITHUB_PRIVATE_KEY_PATH || "",
	];

	for (const keyPath of possiblePaths) {
		if (keyPath && fs.existsSync(keyPath)) {
			privateKeyCache = fs.readFileSync(keyPath, "utf-8");
			return privateKeyCache;
		}
	}

	throw new Error("GitHub App 私钥文件未找到");
}

function normalizeKey(key: string): string {
	return key
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.trim();
}

export async function verifyPrivateKey(privateKeyContent: string): Promise<boolean> {
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

		const inputFingerprint = crypto.createHash("sha256").update(normalizedInput).digest();
		const storedFingerprint = crypto.createHash("sha256").update(normalizedStored).digest();

		if (inputFingerprint.length !== storedFingerprint.length) {
			return false;
		}

		return crypto.timingSafeEqual(inputFingerprint, storedFingerprint);
	} catch (error) {
		console.error("Private key verification failed:", error instanceof Error ? error.message : error);
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
	const signature = sign.sign(privateKey, "base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=/g, "");
	return `${signInput}.${signature}`;
}

async function getInstallationTokenFromGitHub(jwt: string, installationId: string): Promise<string> {
	console.log(`[GitHub Token] Requesting installation token for app: ${GITHUB_APP_ID}, installation: ${installationId}`);
	
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
		throw new Error(`Failed to get installation token: ${response.status} - ${errorText}`);
	}

	console.log(`[GitHub Token] Successfully obtained installation token`);
	const data = await response.json();
	return data.token;
}

export async function getInstallationToken(): Promise<string> {
	try {
		console.log(`[GitHub Token] Initializing token request...`);
		const privateKey = getPrivateKey();
		console.log(`[GitHub Token] Private key loaded, creating JWT...`);
		const jwt = createJwt(privateKey, GITHUB_APP_ID);
		console.log(`[GitHub Token] JWT created, requesting installation token...`);
		return await getInstallationTokenFromGitHub(jwt, GITHUB_INSTALLATION_ID);
	} catch (error) {
		console.error(`[GitHub Token] Exception:`, error instanceof Error ? error.message : error);
		throw error;
	}
}

async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
	let lastError: Error | null = null;
	
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			console.log(`[GitHub Fetch] Attempt ${attempt}/${maxRetries}: ${options.method || "GET"} ${url}`);
			
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 30000);
			
			const response = await fetch(url, {
				...options,
				signal: controller.signal,
			});
			
			clearTimeout(timeoutId);
			
			console.log(`[GitHub Fetch] Attempt ${attempt} SUCCESS: status=${response.status}`);
			return response;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			console.log(`[GitHub Fetch] Attempt ${attempt} FAILED: ${lastError.message}`);
			console.log(`[GitHub Fetch] Error stack: ${lastError.stack}`);
			
			if (attempt < maxRetries) {
				const delay = attempt * 2000;
				console.log(`[GitHub Fetch] Retrying in ${delay}ms...`);
				await new Promise(resolve => setTimeout(resolve, delay));
			}
		}
	}
	
	console.log(`[GitHub Fetch] All ${maxRetries} attempts failed`);
	throw lastError || new Error("Unknown fetch error");
}

export async function getFileFromGitHub(filePath: string): Promise<string | null> {
	try {
		const token = await getInstallationToken();
		const response = await fetch(
			`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_BRANCH}`,
			{
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: "application/vnd.github.v3.raw",
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

export async function saveFileToGitHub(
	filePath: string,
	content: string,
	commitMessage: string,
): Promise<boolean> {
	try {
		const token = await getInstallationToken();
		const repoUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;

		console.log(`[GitHub Save] Attempting to save: ${filePath}`);
		console.log(`[GitHub Save] Repo: ${GITHUB_OWNER}/${GITHUB_REPO}, Branch: ${GITHUB_BRANCH}`);

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
			console.error(`[GitHub Save] Failed to get file info: ${getResponse.status}`, errorText);
		} else {
			console.log(`[GitHub Save] File does not exist, will create new`);
		}

		const body = {
			message: commitMessage,
			content: Buffer.from(content).toString("base64"),
			branch: GITHUB_BRANCH,
			...(sha ? { sha } : {}),
		};

		const response = await fetchWithRetry(
			repoUrl,
			{
				method: "PUT",
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: "application/vnd.github.v3+json",
					"Content-Type": "application/json",
					"User-Agent": "Firefly-Blog",
				},
				body: JSON.stringify(body),
			},
		);

		if (!response.ok) {
			const errorText = await response.text();
			console.error(`[GitHub Save] Failed to save file: ${response.status}`, errorText);
		} else {
			console.log(`[GitHub Save] Successfully saved: ${filePath}`);
		}

		return response.ok;
	} catch (error) {
		console.error(`[GitHub Save] Exception:`, error instanceof Error ? error.message : error);
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
	console.log(`[GitHub Delete] Repo: ${GITHUB_OWNER}/${GITHUB_REPO}, Branch: ${GITHUB_BRANCH}`);

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

	if (!getResponse.ok) {
		const errorText = await getResponse.text();
		console.log(`[GitHub Delete] Failed to get file SHA: ${getResponse.status}`, errorText);
		if (getResponse.status === 404) {
			throw new Error("文件在 GitHub 仓库中不存在（可能仅在本地存在，尚未提交到远程仓库）");
		}
		throw new Error(`Failed to get file info: HTTP ${getResponse.status} - ${errorText}`);
	}

	const data = await getResponse.json();
	console.log(`[GitHub Delete] File SHA: ${data.sha}`);

	const response = await fetchWithRetry(
		repoUrl,
		{
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
		},
	);

	if (!response.ok) {
		const errorText = await response.text();
		console.log(`[GitHub Delete] Failed to delete file: ${response.status}`, errorText);
		throw new Error(`Failed to delete file: HTTP ${response.status} - ${errorText}`);
	}

	console.log(`[GitHub Delete] Successfully deleted: ${filePath}`);
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
