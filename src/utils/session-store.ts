import type { KVStore } from "./persist-store";
import { getStore } from "./persist-store";

/**
 * 管理端会话表：JWT 无状态之外的服务端会话记录。
 *
 * 存储位置由 persist-store 决定（本机文件 / Vercel KV），
 * 支持查看在线设备、精确踢下线、区分设备。
 */

const SESSIONS_KEY = "admin:sessions";

/** 会话列表「最后活跃」写入节流：避免每次请求都回写存储 */
const TOUCH_THROTTLE_MS = 60_000;

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
	/** 是否勾选「记住我」（7 天 / 1 小时） */
	remember: boolean;
}

async function readAll(): Promise<Record<string, AdminSession>> {
	const store: KVStore = getStore();
	const data = await store.get<Record<string, AdminSession>>(SESSIONS_KEY);
	return data && typeof data === "object" ? data : {};
}

async function writeAll(
	sessions: Record<string, AdminSession>,
	ttlSeconds?: number,
): Promise<void> {
	const store: KVStore = getStore();
	await store.set(SESSIONS_KEY, sessions, ttlSeconds);
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

/** 从请求头解析客户端 IP（与 login-guard 一致，供注册会话使用） */

/**
 * 注册新会话，返回会话 ID（写入 token 的 sid）。
 * ip 由调用方用 login-guard 的 getClientIp 解析。
 */
export async function registerSession(opts: {
	username: string;
	ua: string;
	ip: string;
	maxAgeSeconds: number;
	remember: boolean;
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
	};

	const sessions = await readAll();
	// 顺带清理已过期会话，避免表无限膨胀
	for (const key of Object.keys(sessions)) {
		if (sessions[key].exp <= now) delete sessions[key];
	}
	sessions[sid] = record;
	await writeAll(sessions, 7 * 24 * 3600);
	return sid;
}

/** 删除会话（踢下线）；返回是否真的存在 */
export async function revokeSession(sid: string): Promise<boolean> {
	const sessions = await readAll();
	if (!sessions[sid]) return false;
	delete sessions[sid];
	await writeAll(sessions, 7 * 24 * 3600);
	return true;
}

/** 删除除指定 sid 外的全部会话（「踢掉其他设备」） */
export async function revokeAllExcept(sid: string): Promise<number> {
	const sessions = await readAll();
	const others = Object.keys(sessions).filter((key) => key !== sid);
	for (const key of others) delete sessions[key];
	await writeAll(sessions, 7 * 24 * 3600);
	return others.length;
}

/** 读取单个会话；不存在（被踢/过期）返回 null */
export async function getSession(sid: string): Promise<AdminSession | null> {
	const sessions = await readAll();
	const record = sessions[sid];
	if (!record) return null;
	if (record.exp <= Date.now()) return null;
	return record;
}

/** 更新「最后活跃」时间（节流：同一会话 60 秒内不重复写） */
export async function touchSession(sid: string): Promise<void> {
	const sessions = await readAll();
	const record = sessions[sid];
	if (!record) return;
	const now = Date.now();
	if (now - record.lastSeenAt < TOUCH_THROTTLE_MS) return;
	record.lastSeenAt = now;
	await writeAll(sessions, 7 * 24 * 3600);
}

/** 会话列表（已过滤过期项） */
export async function listSessions(): Promise<AdminSession[]> {
	const now = Date.now();
	const sessions = await readAll();
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
	if (expired) await writeAll(sessions, 7 * 24 * 3600);
	return list.sort((a, b) => b.loginAt - a.loginAt);
}
