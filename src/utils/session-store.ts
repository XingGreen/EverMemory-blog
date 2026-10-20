import type { AuthMethod } from "./auth";
import type { KVStore } from "./persist-store";
import { getStore, isKvBackend, isKvCircuitOpen } from "./persist-store";

/**
 * 管理端会话表：JWT 无状态之外的服务端会话记录。
 *
 * 存储位置由 persist-store 决定（本机文件 / Vercel KV），
 * 支持查看在线设备、精确踢下线、区分设备。
 *
 * 故障降级：KV 后端不可用（超时/熔断）时，会话表读写退化为「尽力而为」——
 * 读失败不阻断鉴权（由 auth.ts 回落到仅 JWT 校验），写失败不阻断登录。
 * 代价是熔断窗口内「踢下线」不能即时生效（最多延迟到 KV 恢复）。
 */

const SESSIONS_KEY = "admin_sessions";

/** 会话「最后活跃」独立 key 前缀：避免 touch 整表回写覆盖并发删除 */
const TOUCH_PREFIX = "admin_touch_";

/** touch key 自动过期时间（秒），过期后回退用表内 lastSeenAt */
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

async function readAll(): Promise<Record<string, AdminSession>> {
	const store: KVStore = getStore();
	const data = await store.get<Record<string, AdminSession>>(SESSIONS_KEY);
	return data && typeof data === "object" ? data : {};
}

/**
 * 读会话表；存储不可用时返回 degraded=true 而非抛错。
 * 上层据此区分「会话不存在（应登出）」与「暂时读不到（应放行）」。
 */
async function readAllSafe(): Promise<{
	sessions: Record<string, AdminSession>;
	degraded: boolean;
}> {
	try {
		const sessions = await readAll();
		return { sessions, degraded: isSessionStoreDegraded() };
	} catch (err) {
		console.warn("[SessionStore] 读取会话表失败，降级为无会话表:", err);
		return { sessions: {}, degraded: true };
	}
}

/** 写会话表；失败不抛给调用方，返回是否成功 */
async function writeAllSafe(
	sessions: Record<string, AdminSession>,
	ttlSeconds?: number,
): Promise<boolean> {
	try {
		const store: KVStore = getStore();
		await store.set(SESSIONS_KEY, sessions, ttlSeconds);
		return true;
	} catch (err) {
		console.warn("[SessionStore] 写入会话表失败（已降级）:", err);
		return false;
	}
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

	const { sessions } = await readAllSafe();
	// 顺带清理已过期会话，避免表无限膨胀；
	// 同设备（同 UA）只保留最新一次登录，避免反复登录在同一设备堆积会话。
	for (const key of Object.keys(sessions)) {
		if (sessions[key].exp <= now || sessions[key].ua === opts.ua) {
			delete sessions[key];
		}
	}
	sessions[sid] = record;
	const ok = await writeAllSafe(sessions, 7 * 24 * 3600);
	if (!ok) {
		console.warn(
			"[SessionStore] 会话未登记（存储不可用），本次登录继续，但该设备不会出现在会话列表",
		);
	}
	return sid;
}

/** 删除会话（踢下线）；返回是否真的存在 */
export async function revokeSession(sid: string): Promise<boolean> {
	const { sessions } = await readAllSafe();
	if (!sessions[sid]) return false;
	delete sessions[sid];
	const ok = await writeAllSafe(sessions, 7 * 24 * 3600);
	if (!ok) return false;
	await verifyDeleted(sid);
	return true;
}

/** 删除除指定 sid 外的全部会话（「踢掉其他设备」） */
export async function revokeAllExcept(sid: string): Promise<number> {
	const { sessions } = await readAllSafe();
	const others = Object.keys(sessions).filter((key) => key !== sid);
	for (const key of others) delete sessions[key];
	const ok = await writeAllSafe(sessions, 7 * 24 * 3600);
	if (!ok) return 0;
	for (const key of others) {
		await verifyDeleted(key);
	}
	return others.length;
}

/** 读取单个会话；不存在（被踢/过期/存储不可读）返回 null */
export async function getSession(sid: string): Promise<AdminSession | null> {
	const { sessions } = await readAllSafe();
	const record = sessions[sid];
	if (!record) return null;
	if (record.exp <= Date.now()) return null;
	return withTouchAt(record);
}

/**
 * 带降级标记的会话查询：区分「确实不存在」与「存储暂时不可读」。
 * auth.ts 用 degraded 决定是拒绝登录态还是仅靠 JWT 放行。
 */
export async function getSessionState(sid: string): Promise<SessionLookup> {
	const { sessions, degraded } = await readAllSafe();
	const record = sessions[sid];
	if (!record) return { session: null, degraded };
	if (record.exp <= Date.now()) return { session: null, degraded: false };
	return { session: await withTouchAt(record), degraded };
}

/**
 * 合并独立 touch key 的「最后活跃」时间（比表内值新时覆盖）。
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
 * 写入独立 key（自动过期），不整表回写——避免与「踢下线」的
 * 删除产生读-改-写竞态（旧快照整表写回会把已删除会话复活）。
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
	const { sessions } = await readAllSafe();
	let expired = false;
	const list: AdminSession[] = [];
	for (const key of Object.keys(sessions)) {
		const record = sessions[key];
		if (record.exp <= now) {
			delete sessions[key];
			expired = true;
			continue;
		}
		list.push(record);
	}
	if (expired) await writeAllSafe(sessions, 7 * 24 * 3600);
	// touch 读取失败不应让整个列表接口报错
	await Promise.all(
		list.map((r) => withTouchAt(r).catch(() => r)),
	);
	return list.sort((a, b) => b.loginAt - a.loginAt);
}

/** 同步验证删除：若并行请求以旧快照把目标写复读，则重删（最多 2 次） */
async function verifyDeleted(sid: string): Promise<void> {
	for (let i = 0; i < 2; i++) {
		const { sessions: cur, degraded } = await readAllSafe();
		if (degraded) return;
		if (cur[sid] === undefined) return;
		delete cur[sid];
		const ok = await writeAllSafe(cur, 7 * 24 * 3600);
		if (!ok) return;
	}
}
