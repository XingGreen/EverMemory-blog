import fs from "node:fs/promises";
import path from "node:path";

/**
 * 轻量持久化存储抽象：文件后端（本机/自托管） + Vercel KV REST 后端（线上）。
 *
 * 后端选择优先级：
 *   1. `PERSIST_BACKEND=file|kv` 显式指定（缺省或非法值视为未指定）
 *   2. 开发模式（`import.meta.env.DEV`）强制文件后端——
 *      本地开发不应依赖任何远程服务，断网/网络抖动时不至于登录都失败
 *   3. 检测到 KV_REST_API_URL + KV_REST_API_TOKEN → KV 后端
 *   4. 否则文件后端（写入 .data/persist/，已被 gitignore）
 *
 * 两个后端接口等价，业务代码无需感知部署环境；KV 后端带超时与熔断，
 * 故障时通过 isDegraded() 告知上层，由调用方决定降级策略。
 */

const KV_URL_KEY = "KV_REST_API_URL";
const KV_TOKEN_KEY = "KV_REST_API_TOKEN";

/** 显式后端开关的环境变量名 */
const BACKEND_ENV_KEY = "PERSIST_BACKEND";

/** 单次 KV 请求超时（ms）：网络抖动时不要拖住整个请求 21 秒 */
const KV_TIMEOUT_MS = 3000;

/** 连续失败达到该次数后熔断 */
const KV_BREAKER_THRESHOLD = 3;

/** 熔断持续时长（ms）：期间所有 KV 操作直接走降级，不再发起网络请求 */
const KV_BREAKER_COOLDOWN_MS = 30_000;

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
	const metaEnv = (import.meta as unknown as Record<string, unknown>).env as
		| Record<string, unknown>
		| undefined;
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

/** 读取 PERSIST_BACKEND 显式开关；非法值视为未指定 */
function backendOverride(): "file" | "kv" | null {
	const metaEnv = (import.meta as unknown as Record<string, unknown>).env as
		| Record<string, unknown>
		| undefined;
	const raw = (
		(metaEnv?.[BACKEND_ENV_KEY] as string | undefined) ??
		((process.env as Record<string, unknown>)[BACKEND_ENV_KEY] as
			| string
			| undefined) ??
		""
	)
		.trim()
		.toLowerCase();
	if (raw === "file" || raw === "kv") return raw;
	return null;
}

/** 是否开发模式（本地开发不依赖远程服务） */
function isDevMode(): boolean {
	const metaEnv = (import.meta as unknown as Record<string, unknown>).env as
		| Record<string, unknown>
		| undefined;
	if (typeof metaEnv?.DEV === "boolean") return metaEnv.DEV;
	return process.env.NODE_ENV !== "production";
}

/* ---------------- 熔断状态 ---------------- */

let kvFailures = 0;
let kvOpenUntil = 0;

/** 当前是否处于 KV 熔断中（供 UI / 调用方判断） */
export function isKvCircuitOpen(): boolean {
	return kvOpenUntil > Date.now();
}

function recordKvSuccess(): void {
	kvFailures = 0;
	kvOpenUntil = 0;
}

function recordKvFailure(reason: unknown): void {
	kvFailures += 1;
	if (kvFailures >= KV_BREAKER_THRESHOLD && kvOpenUntil === 0) {
		kvOpenUntil = Date.now() + KV_BREAKER_COOLDOWN_MS;
		console.error(
			`[PersistStore] KV 连续失败 ${kvFailures} 次，熔断 ${KV_BREAKER_COOLDOWN_MS / 1000}s，期间降级为本地存储`,
			reason instanceof Error ? reason.message : reason,
		);
	}
}

/** 仅测试用：重置熔断与后端缓存 */
export function __resetPersistStoreForTests(): void {
	kvFailures = 0;
	kvOpenUntil = 0;
	cachedStore = null;
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

/** Upstash 请求：带超时；熔断打开时直接抛错由调用方降级 */
async function kvFetch(url: string, init: RequestInit): Promise<Response> {
	if (isKvCircuitOpen()) {
		throw new Error("[PersistStore] KV 熔断中");
	}
	try {
		const res = await fetch(url, {
			...init,
			signal: AbortSignal.timeout(KV_TIMEOUT_MS),
		});
		recordKvSuccess();
		return res;
	} catch (err) {
		// 超时/断连是网络层失败：记一次失败并按熔断阈值决定后续是否短路
		recordKvFailure(err);
		console.warn("[PersistStore] KV 请求失败:", err);
		throw err;
	}
}

/** 解析 Upstash 响应：result 为 null 表示缺失；否则是存储的 JSON 字符串 */
async function parseUpstashResult(
	res: Response,
	key: string,
): Promise<unknown | null> {
	// 404/204 是「键不存在」的正常响应，不属于异常：不记 error 日志。
	// 这看似与下面的 !res.ok 重复（404/204 的 res.ok 也是 false），但二者
	// 副作用不同——删掉这里会让每次查询已过期 sid 都刷一条 error 日志，
	// 正常流量淹没真实故障。注意 delete 后紧接着读会命中 204。
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
			recordKvFailure(new Error(`KV SET ${res.status}`));
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
			recordKvFailure(new Error(`KV DEL ${res.status}`));
			throw new Error(`[PersistStore] KV DEL 失败: ${res.status}`);
		}
	},
};

/* ---------------- 选择器 ---------------- */

let cachedStore: KVStore | null = null;

/**
 * 解析实际使用的后端（纯函数，便于测试与日志）。
 *
 * 优先级：显式 PERSIST_BACKEND > 开发模式强制 file > KV 配置存在则 kv > file。
 *
 * @param options.dev 覆盖「是否开发模式」判定，仅测试使用；缺省读构建期环境。
 */
export function resolveBackendKind(options?: { dev?: boolean }): "file" | "kv" {
	const override = backendOverride();
	if (override === "file") return "file";
	// 本地开发强制文件后端：后台不应因远程 KV 抖动而无法登录
	const dev = options?.dev ?? isDevMode();
	if (!override && dev) return "file";
	// 无论是否显式指定 kv，缺少凭据都只能用文件后端（否则运行期必然抛错）
	return kvConfig() ? "kv" : "file";
}

/** 当前部署环境使用的存储后端；每次调用返回统一单例 */
export function getStore(): KVStore {
	if (cachedStore) return cachedStore;
	const kind = resolveBackendKind();
	cachedStore = kind === "kv" ? kvStore : fileStore;
	console.log(
		`[PersistStore] 使用 ${kind === "kv" ? "Vercel KV" : "本地文件"} 后端存储` +
			(backendOverride() ? "（PERSIST_BACKEND 显式指定）" : ""),
	);
	return cachedStore;
}

/** 当前是否处于 KV 后端（供 UI 判断能力是否可用） */
export function isKvBackend(): boolean {
	return resolveBackendKind() === "kv";
}

/**
 * 当前是否处于「降级」状态：本该用 KV，但因熔断正在用本地文件兜底。
 * 供 session API / 后台 UI 提示「会话表暂不可用」。
 */
export function isDegraded(): boolean {
	return resolveBackendKind() === "kv" && isKvCircuitOpen();
}
