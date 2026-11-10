import type { AuthMethod } from "./auth";
import type { KVStore } from "./persist-store";
import { getStore, isKvBackend, isKvCircuitOpen } from "./persist-store";

/**
 * 管理端会话表：JWT 无状态之外的服务端会话记录。
 *
 * 存储位置由 persist-store 决定（本机文件 / Vercel KV），
 * 支持查看在线设备、精确踢下线、区分设备。
 *
 * 存储形态：**每条会话一个独立键**（`admin_sess:<sid>`）。
 * 早期版本把全部会话放在一个 key 里，任何写操作都是「读整表→改→写整表」，
 * 并发登录会互相覆盖（后写的一方带着旧快照，把对方刚登记的会话抹掉），
 * 列表页清理过期项时甚至会删掉刚落地的会话。改成一人一键后，
 * 注册 / 踢出 / 清理都只操作自己那条，不再存在覆盖别人的可能。
 *
 * 故障降级：KV 后端不可用（超时/熔断）时，会话表读写退化为「尽力而为」——
 * 读失败不阻断鉴权（由 auth.ts 回落到仅 JWT 校验），写失败不阻断登录。
 * 代价是熔断窗口内「踢下线」不能即时生效（最多延迟到 KV 恢复）。
 */

/** 会话键前缀。键名允许 `[a-zA-Z0-9._:-]`，冒号在后端会被安全转义 */
const SESSION_PREFIX = "admin_sess:";

/** 升级前的整表键。已无读写方，注册时顺手清掉，避免旧会话残留在存储里 */
const LEGACY_SESSIONS_KEY = "admin_sessions";

/** 会话键的 TTL 余量：比会话本身多留一小时，避免临界时刻键先于会话消失 */
const KEY_TTL_MARGIN_SECONDS = 3600;

/** 列表上限。单管理员不会有这么多设备，主要防 KEYS 结果失控 */
const LIST_LIMIT = 500;

/** 会话「最后活跃」独立 key 前缀：避免 touch 整表回写覆盖并发删除 */
const TOUCH_PREFIX = "admin_touch_";

/** touch key 自动过期时间（秒），过期后回退用记录内 lastSeenAt */
const TOUCH_TTL_SECONDS = 10 * 60;

/** 会话列表「最后活跃」写入节流：避免每次请求都写入存储 */
const TOUCH_THROTTLE_MS = 60_000;

/**
 * 会话表当前是否「不可用」。
 * 仅 KV 后端会不可用；文件后端本地必然可写，永不降级。
 */
export function isSessionStoreDegraded(): boolean {
	return isKvBackend() && isKvCircuitOpen();
}

export interface AdminSession {
	sid: string;
	username: string;
	/** 可读设备名，如 "Chrome 130 · Windows 10" */
	device: string;
	/** 原始 User-Agent */
	ua: string;
	ip: string;
	/** 登录时间戳（ms） */
	loginAt: number;
	/** 最后活跃时间戳（ms） */
	lastSeenAt: number;
	/** 过期时间戳（ms） */
	exp: number;
	/** 是否勾选「记住我」（7 天 / 12 小时） */
	remember: boolean;
	/** 上次强认证时间戳（ms）：危险操作二次确认据此判定 */
	authAt: number;
	/** 本会话的认证方式 */
	amr: AuthMethod;
}

/** 已确认「存储不可用」：getSession 据此让调用方回落到仅 JWT 校验 */
export interface SessionLookup {
	session: AdminSession | null;
	/** 存储层不可用（区别于「会话确实不存在」） */
	degraded: boolean;
}

function sessionKey(sid: string): string {
	return SESSION_PREFIX + sid;
}

/** 键的存活时间跟随会话本身，多留一小时余量 */
function keyTtlSeconds(record: AdminSession): number {
	const remaining = Math.ceil((record.exp - Date.now()) / 1000);
	return Math.max(60, remaining + KEY_TTL_MARGIN_SECONDS);
}

/** 读单条会话；不存在返回 null */
async function readRecord(sid: string): Promise<AdminSession | null> {
	const record = await getStore().get<AdminSession>(sessionKey(sid));
	return record && typeof record === "object" ? record : null;
}

/** 写单条会话；失败不抛给调用方，返回是否成功 */
async function writeRecord(record: AdminSession): Promise<boolean> {
	try {
		await getStore().set(sessionKey(record.sid), record, keyTtlSeconds(record));
		return true;
	} catch (err) {
		console.warn("[SessionStore] 写入会话失败（已降级）:", err);
		return false;
	}
}

/** 删除单条会话；失败不抛给调用方 */
async function deleteRecord(sid: string): Promise<boolean> {
	try {
		await getStore().del(sessionKey(sid));
		return true;
	} catch (err) {
		console.warn("[SessionStore] 删除会话失败:", err);
		return false;
	}
}

/**
 * 列出全部会话（未过滤过期）。
 * 单条读取失败按「不存在」处理：一条坏记录不该让整张列表报错。
 */
async function listAll(): Promise<AdminSession[]> {
	const store: KVStore = getStore();
	if (!store.list) return [];
	let keys: string[];
	try {
		keys = await store.list(SESSION_PREFIX, LIST_LIMIT);
	} catch (err) {
		console.warn("[SessionStore] 列举会话失败，按空表处理:", err);
		return [];
	}
	const records = await Promise.all(
		keys.map((key) =>
			store
				.get<AdminSession>(key)
				.catch(() => null)
				.then((record) =>
					record && typeof record === "object" && record.sid ? record : null,
				),
		),
	);
	return records.filter((record): record is AdminSession => record !== null);
}

/** 解析 User-Agent 为可读设备描述（浏览器 + 操作系统） */
export function describeDevice(ua: string): string {
	const u = ua || "";
	let browser = "未知浏览器";
	if (/edg\//i.test(u)) browser = "Edge";
	else if (/opr\/|opera/i.test(u)) browser = "Opera";
	else if (/chrome|chromium|crios/i.test(u)) browser = "Chrome";
	else if (/firefox|fxios/i.test(u)) browser = "Firefox";
	else if (/safari/i.test(u)) browser = "Safari";
	else if (/micromessenger/i.test(u)) browser = "微信";

	let os = "未知系统";
	if (/windows nt/i.test(u)) {
		if (/windows nt 10/i.test(u)) os = "Windows 10/11";
		else if (/windows nt 6\.3/i.test(u)) os = "Windows 8.1";
		else if (/windows nt 6\.1/i.test(u)) os = "Windows 7";
	} else if (/iphone|ipad|ipod/i.test(u)) os = "iOS";
	else if (/android/i.test(u)) os = "Android";
	else if (/mac os x/i.test(u)) os = "macOS";
	else if (/linux/i.test(u)) os = "Linux";

	if (/mobile/i.test(u) && !/ipad/i.test(u)) os += "（移动端）";
	return `${browser} · ${os}`;
}

/** 从请求头解析客户端 IP（与 client-ip 一致，供注册会话使用） */

/**
 * 注册新会话，返回会话 ID（写入 token 的 sid）。
 * ip 由调用方用 client-ip 的 getClientIp 解析。
 *
 * 存储不可写时不阻断登录：仍返回 sid（JWT 可正常签发），
 * 只是本次会话未登记到表里，代价是无法在设备列表中看到/踢它。
 */
export async function registerSession(opts: {
	username: string;
	ua: string;
	ip: string;
	maxAgeSeconds: number;
	remember: boolean;
	/** 上次强认证时间（ms）；缺省即本次登录时间 */
	authAt?: number;
	/** 认证方式；缺省视为 GitHub OAuth 登录 */
	amr?: AuthMethod;
}): Promise<string> {
	const sid = crypto.randomUUID();
	const now = Date.now();
	const record: AdminSession = {
		sid,
		username: opts.username,
		device: describeDevice(opts.ua),
		ua: opts.ua,
		ip: opts.ip,
		loginAt: now,
		lastSeenAt: now,
		exp: now + opts.maxAgeSeconds * 1000,
		remember: opts.remember,
		authAt: opts.authAt ?? now,
		amr: opts.amr ?? "github",
	};

	/* 同设备（同 UA）只保留最新一次登录，顺带清掉已过期会话。
	   只删别人的键、只写自己的键：并发注册时不会用旧快照覆盖对方。 */
	const existing = await listAll();
	await Promise.all(
		existing
			.filter((item) => item.exp <= now || item.ua === opts.ua)
			.map((item) => deleteRecord(item.sid)),
	);

	const ok = await writeRecord(record);
	if (!ok) {
		console.warn(
			"[SessionStore] 会话未登记（存储不可用），本次登录继续，但该设备不会出现在会话列表",
		);
	}

	// 升级前的整表已无读写方：第一次注册时顺手丢掉，防止旧会话长期残留
	void getStore()
		.del(LEGACY_SESSIONS_KEY)
		.catch(() => {});

	return sid;
}

/** 删除会话（踢下线）；返回该会话此前是否存在 */
export async function revokeSession(sid: string): Promise<boolean> {
	const record = await readRecord(sid);
	if (!record) return false;
	await deleteRecord(sid);
	await verifyDeleted(sid);
	return true;
}

/** 删除除指定 sid 外的全部会话（「踢掉其他设备」） */
export async function revokeAllExcept(sid: string): Promise<number> {
	const others = (await listAll()).filter((item) => item.sid !== sid);
	for (const item of others) {
		await deleteRecord(item.sid);
	}
	for (const item of others) {
		await verifyDeleted(item.sid);
	}
	return others.length;
}

/** 读取单个会话；不存在（被踢/过期/存储不可读）返回 null */
export async function getSession(sid: string): Promise<AdminSession | null> {
	const record = await readRecord(sid);
	if (!record) return null;
	if (record.exp <= Date.now()) return null;
	return withTouchAt(record);
}

/**
 * 带降级标记的会话查询：区分「确实不存在」与「存储暂时不可读」。
 * auth.ts 用 degraded 决定是拒绝登录态还是仅靠 JWT 放行。
 */
export async function getSessionState(sid: string): Promise<SessionLookup> {
	try {
		const record = await readRecord(sid);
		const degraded = isSessionStoreDegraded();
		if (!record) return { session: null, degraded };
		if (record.exp <= Date.now()) return { session: null, degraded: false };
		return { session: await withTouchAt(record), degraded };
	} catch (err) {
		console.warn("[SessionStore] 读取会话失败，降级为仅 JWT 校验:", err);
		return { session: null, degraded: true };
	}
}

/**
 * 合并独立 touch key 的「最后活跃」时间（比记录内值新时覆盖）。
 * 单条与会话列表共用。
 */
async function withTouchAt(record: AdminSession): Promise<AdminSession> {
	const t = await getStore().get<number>(TOUCH_PREFIX + record.sid);
	if (typeof t === "number" && t > record.lastSeenAt) {
		record.lastSeenAt = t;
	}
	return record;
}

/**
 * 更新「最后活跃」时间。
 * 写入独立 key（自动过期），不改会话记录——避免与「踢下线」的
 * 删除产生读-改-写竞态（旧值写回会把已删除会话复活）。
 */
export async function touchSession(sid: string): Promise<void> {
	try {
		const now = Date.now();
		const store = getStore();
		const last = await store.get<number>(TOUCH_PREFIX + sid);
		if (typeof last === "number" && now - last < TOUCH_THROTTLE_MS) {
			return;
		}
		await store.set(TOUCH_PREFIX + sid, now, TOUCH_TTL_SECONDS);
	} catch {
		// 活跃时间更新失败不影响主流程，静默忽略
	}
}

/** 会话列表（已过滤过期项）；存储不可用时返回空表 */
export async function listSessions(): Promise<AdminSession[]> {
	const now = Date.now();
	const alive: AdminSession[] = [];
	const expired: string[] = [];
	for (const record of await listAll()) {
		if (record.exp <= now) expired.push(record.sid);
		else alive.push(record);
	}
	// 清理只针对本次列举到的过期项：期间新注册的会话不在名单里，不会被误删
	if (expired.length > 0) {
		await Promise.all(expired.map((sid) => deleteRecord(sid)));
	}
	// touch 读取失败不应让整个列表接口报错
	await Promise.all(
		alive.map((record) => withTouchAt(record).catch(() => record)),
	);
	return alive.sort((a, b) => b.loginAt - a.loginAt);
}

/** 同步验证删除：并发写入把目标复活时再删一次（最多 2 轮） */
async function verifyDeleted(sid: string): Promise<void> {
	for (let i = 0; i < 2; i++) {
		const record = await readRecord(sid).catch(() => null);
		if (!record) return;
		await deleteRecord(sid);
	}
}
