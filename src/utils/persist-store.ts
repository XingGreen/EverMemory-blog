import fs from "node:fs/promises";
import path from "node:path";

/**
 * 轻量持久化存储抽象：文件后端（本机/自托管） + Vercel KV REST 后端（线上）。
 *
 * 自动选择规则：检测到 KV_REST_API_URL + KV_REST_API_TOKEN 环境变量 → KV 后端；
 * 否则使用文件后端（写入 .data/persist/，已被 gitignore）。
 *
 * 两个后端接口等价，业务代码无需感知部署环境。
 */

const KV_URL_KEY = "KV_REST_API_URL";
const KV_TOKEN_KEY = "KV_REST_API_TOKEN";

/** 本地文件后端存储目录（相对项目根） */
const FILE_PERSIST_DIR = path.join(process.cwd(), ".data", "persist");

export interface KVStore {
	/** 读取；键不存在返回 null */
	get<T>(key: string): Promise<T | null>;
	/** 写入（覆盖）；ttlSeconds 可指定过期时间 */
	set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
	/** 删除；键不存在时静默成功 */
	del(key: string): Promise<void>;
}

function assertSafeKey(key: string): void {
	if (!/^[a-zA-Z0-9._:-]{1,200}$/.test(key)) {
		throw new Error(`[PersistStore] 非法存储键: ${key}`);
	}
}

/* ---------------- 文件后端 ---------------- */

interface FileEnvelope {
	v: unknown;
	e?: number; // 过期时间戳（ms），缺省为永不过期
}

const fileStore: KVStore = {
	async get<T>(key: string): Promise<T | null> {
		assertSafeKey(key);
		try {
			const raw = await fs.readFile(
				path.join(FILE_PERSIST_DIR, `${key}.json`),
				"utf-8",
			);
			const env = JSON.parse(raw) as FileEnvelope;
			if (env.e && env.e <= Date.now()) {
				await fileStore.del(key);
				return null;
			}
			return env.v as T;
		} catch {
			return null;
		}
	},

	async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
		assertSafeKey(key);
		await fs.mkdir(FILE_PERSIST_DIR, { recursive: true });
		const env: FileEnvelope = { v: value };
		if (ttlSeconds && ttlSeconds > 0) {
			env.e = Date.now() + ttlSeconds * 1000;
		}
		await fs.writeFile(
			path.join(FILE_PERSIST_DIR, `${key}.json`),
			JSON.stringify(env),
			"utf-8",
		);
	},

	async del(key: string): Promise<void> {
		assertSafeKey(key);
		try {
			await fs.unlink(path.join(FILE_PERSIST_DIR, `${key}.json`));
		} catch {
			// 文件不存在时静默成功
		}
	},
};

/* ---------------- Vercel KV（Upstash REST）后端 ---------------- */

function kvConfig(): { url: string; token: string } | null {
	const metaEnv = (import.meta as unknown as Record<string, unknown>)
		.env as Record<string, unknown> | undefined;
	const getEnv = (key: string): string | undefined => {
		const fromMeta = metaEnv?.[key];
		const fromProc = (process.env as Record<string, unknown>)[key];
		return (fromMeta as string | undefined) ?? (fromProc as string | undefined);
	};
	const url = getEnv(KV_URL_KEY);
	const token = getEnv(KV_TOKEN_KEY);
	if (url && token) return { url: url.replace(/\/+$/, ""), token };
	return null;
}

function kvConfigRequired(): { url: string; token: string } {
	const conf = kvConfig();
	if (!conf) {
		throw new Error("[PersistStore] KV 后端未配置");
	}
	return conf;
}

/* ---------------- Vercel KV（Upstash REST）后端 ---------------- */

/**
 * Upstash REST API 是命令式 URL：
 *   GET    /get/{key}   → 200 {"result": string|null}
 *   PUT    /set/{key}   → body 为存储的原文
 *   POST   /del/{key}   → 200 {"result": 0|1}
 * key 参数会做 URL 解码，直接拼接即可（含特殊字符时需 encodeURIComponent）。
 */

/** Upstash 偶发连接重置（ECONNRESET/其他 side closed），网络层失败重试一次 */
async function kvFetch(
	url: string,
	init: RequestInit,
): Promise<Response> {
	try {
		return await fetch(url, init);
	} catch (err) {
		console.warn("[PersistStore] KV 网络请求失败，重试一次:", err);
		return await fetch(url, init);
	}
}

/** 解析 Upstash 响应：result 为 null 表示缺失；否则是存储的 JSON 字符串 */
async function parseUpstashResult(
	res: Response,
	key: string,
): Promise<unknown | null> {
	if (res.status === 404 || res.status === 204) return null;
	if (!res.ok) {
		console.error(`[PersistStore] KV ${res.status} (键 ${key})`);
		// 读失败降级为"不存在"，避免线上 API 直接 500
		return null;
	}
	const data = (await res.json()) as { result?: unknown };
	const result = data?.result;
	if (result === null || result === undefined) return null;
	if (typeof result === "string") {
		try {
			return JSON.parse(result) as unknown;
		} catch {
			// 存储内容不是 JSON（如数字/自增），按原样返回字符串
			return result;
		}
	}
	return result;
}

const kvStore: KVStore = {
	async get<T>(key: string): Promise<T | null> {
		assertSafeKey(key);
		const { url, token } = kvConfigRequired();
		try {
			const res = await kvFetch(`${url}/get/${encodeURIComponent(key)}`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			return (await parseUpstashResult(res, key)) as T | null;
		} catch (err) {
			console.error("[PersistStore] KV GET 异常:", err);
			return null;
		}
	},

	async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
		assertSafeKey(key);
		const { url, token } = kvConfigRequired();
		const qs =
			ttlSeconds && ttlSeconds > 0 ? `?EX=${Math.floor(ttlSeconds)}` : "";
		const res = await kvFetch(`${url}/set/${encodeURIComponent(key)}${qs}`, {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "text/plain",
			},
			body: JSON.stringify(value),
		});
		if (!res.ok) {
			throw new Error(`[PersistStore] KV SET 失败: ${res.status}`);
		}
	},

	async del(key: string): Promise<void> {
		assertSafeKey(key);
		const { url, token } = kvConfigRequired();
		const res = await kvFetch(`${url}/del/${encodeURIComponent(key)}`, {
			method: "POST",
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!res.ok) {
			throw new Error(`[PersistStore] KV DEL 失败: ${res.status}`);
		}
	},
};

/* ---------------- 选择器 ---------------- */

let cachedStore: KVStore | null = null;

/** 当前部署环境使用的存储后端；每次调用返回统一单例 */
export function getStore(): KVStore {
	if (cachedStore) return cachedStore;
	cachedStore = kvConfig() ? kvStore : fileStore;
	console.log(
		`[PersistStore] 使用 ${kvConfig() ? "Vercel KV" : "本地文件"} 后端存储`,
	);
	return cachedStore;
}

/** 当前是否处于 KV 后端（供 UI 判断能力是否可用） */
export function isKvBackend(): boolean {
	return kvConfig() !== null;
}
