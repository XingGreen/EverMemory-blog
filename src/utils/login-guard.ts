/**
 * 登录暴力破解防护与审计（仅服务端使用，勿在前端组件中 import）
 *
 * 防护分两层，各自堵不同的绕过方式：
 *  - 固定窗口频次（checkAttemptRate/registerAttempt）：按客户端标识统计
 *    窗口内的**所有**尝试（含成功），超限即拒。与成败无关，因此攻击者
 *    换 IP 每次只试一次、或持有有效密码时都无法绕过。
 *  - 失败计数锁定（checkLockout/registerFailure）：连续失败达阈值后进入
 *    锁定，锁定时长随失败次数指数退避，封顶 30 分钟。登录成功后清零。
 *
 * 两层是互补而非重复：固定窗口粒度粗、防不住持续低速尝试；失败锁定能
 * 记住历史并指数加码，但只统计失败。单独任一层都有明显缺口。
 *
 * IP 黑名单（banIp/unbanIp/isIpBanned）：与前两层不同，它不是自动累计，
 * 而是管理员**显式、长期**地封禁某个客户端——用于「在日志里看到异常来源，
 * 主动把他挡在门外」。存储不可用时降级为进程内副本并放行（fail-open），
 * 与计数层保持一致，避免存储故障反过来把管理员自己锁在门外。
 *
 * 存储说明：
 *  - 状态交给 persist-store 的 getStore()，本机部署走文件、配置了
 *    KV_URL/KV_REST_API_TOKEN 时走 Vercel KV，因而在 Serverless 上也能
 *    跨实例生效（此前用系统临时目录追加日志，Vercel/Cloudflare 上写入
 *    失败会静默降级为「无进程内防护」，登录接口等于不限次爆破）。
 *  - 存储整体不可用时降级为进程内计数：至少保证单个实例生命周期内有效，
 *    且不会因为存储故障把所有人挡在门外。
 *
 * 已知取舍：
 *  - 计数更新是「读—改—写」，KV 为最终一致后端，多实例并发失败可能
 *    互相覆盖导致少数计数丢失，防护强度因此弱于单进程。相较完全无防护
 *    仍是显著改善，且登录频率本身受 scrypt 成本天然限速。
 *  - getClientIp 在无任何反代头时返回 "unknown"，所有直连客户端会共享同
 *    一个窗口与锁桶。对直连部署这是保守的（更容易误伤），但不会降低防护。
 *
 * 审计：每次登录尝试（成功/失败/锁定）追加写入系统临时目录
 * firefly-admin-audit.log（尽力而为）+ 控制台 [Admin Audit] 行。
 * 审计日志不参与防护判定，故仍用文件，Serverless 上会降级为仅控制台。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getClientIp } from "./client-ip";
import { getStore } from "./persist-store";

// getClientIp 已抽到 client-ip.ts（被非登录防护路径复用，如 OAuth 会话登记）；
// 此处再导出以保持既有 import 路径不变。
export { getClientIp };

/** 连续失败次数阈值，达到后开始锁定 */
const FAIL_THRESHOLD = 5;
/** 基础锁定秒数，第 FAIL_THRESHOLD 次失败生效 */
const BASE_LOCK_SECONDS = 30;
/** 锁定上限（30 分钟） */
const MAX_LOCK_SECONDS = 30 * 60;

/** 固定窗口时长（秒） */
const ATTEMPT_WINDOW_SECONDS = 60;
/** 固定窗口内允许的最大尝试次数（含成功） */
const ATTEMPT_LIMIT = 10;

/** 状态存储键（persist-store 会校验键名安全字符集） */
const LOCK_STATE_KEY = "admin_login_lock";
/** 尝试频次状态存储键 */
const ATTEMPT_STATE_KEY = "admin_login_attempts";
/** IP 黑名单存储键 */
const BAN_STATE_KEY = "admin_ip_ban";

/** 状态整体过期时间：24 小时无尝试即视为无需再累计，避免无界增长 */
const STATE_TTL_SECONDS = 24 * 60 * 60;

interface LockRecord {
	failures: number;
	lockedUntil: number;
}

/** 固定窗口内的尝试计数。与 LockRecord 不同，成功登录会清零该记录 */
interface AttemptRecord {
	count: number;
	windowStart: number;
}

/** 一条 IP 封禁记录；until 为 null 表示永久封禁 */
export interface BanRecord {
	/** 封禁原因（人工填写，便于日后回溯） */
	reason: string;
	/** 操作者标识（用户名 / 空间） */
	by: string;
	/** 封禁时间戳（ms） */
	bannedAt: number;
	/** 解封时间戳（ms）；null 表示永久 */
	until: number | null;
}

/**
 * 存储不可用时的进程内降级副本。每次成功写入存储时同步更新，
 * 使后续存储故障能从最近一次已知状态继续，而不是从零开始。
 */
const memoryFallback = new Map<string, LockRecord>();
const attemptFallback = new Map<string, AttemptRecord>();

/** 存储故障告警节流：避免故障期间每次登录都刷屏 */
let lastWarnAt = 0;

function warnStorageFailure(error: unknown): void {
	const now = Date.now();
	if (now - lastWarnAt < 60_000) return;
	lastWarnAt = now;
	console.warn(
		"[LoginGuard] 锁定状态存储不可用，已降级为进程内计数（跨实例防护失效）：",
		error instanceof Error ? error.message : error,
	);
}

/**
 * 读取一类状态；存储不可用时返回进程内副本
 */
async function loadStateMap<T>(
	key: string,
	fallback: Map<string, T>,
): Promise<Map<string, T>> {
	try {
		const stored = await getStore().get<Record<string, T>>(key);
		return new Map(Object.entries(stored ?? {}));
	} catch (error) {
		warnStorageFailure(error);
		return new Map(fallback);
	}
}

/**
 * 覆盖写入一类状态；存储不可用时仅更新进程内副本。
 * ttlSeconds 缺省用 STATE_TTL_SECONDS；传 0 表示不设过期（黑名单用）。
 */
async function saveStateMap<T>(
	key: string,
	state: Map<string, T>,
	fallback: Map<string, T>,
	ttlSeconds = STATE_TTL_SECONDS,
): Promise<void> {
	fallback.clear();
	for (const [k, v] of state) fallback.set(k, v);
	try {
		await getStore().set(key, Object.fromEntries(state), ttlSeconds);
	} catch (error) {
		warnStorageFailure(error);
	}
}

/** 读取全部锁定状态 */
function loadState(): Promise<Map<string, LockRecord>> {
	return loadStateMap(LOCK_STATE_KEY, memoryFallback);
}

/** 覆盖写入全部锁定状态 */
function saveState(state: Map<string, LockRecord>): Promise<void> {
	return saveStateMap(LOCK_STATE_KEY, state, memoryFallback);
}

/** 清理过期记录（仅删除已过锁定期且超过 1 小时的；未锁定记录保留以持续累计） */
function swept(state: Map<string, LockRecord>): Map<string, LockRecord> {
	const now = Date.now();
	const out = new Map<string, LockRecord>();
	for (const [key, record] of state) {
		if (
			record.lockedUntil > 0 &&
			now > record.lockedUntil &&
			now - record.lockedUntil > 60 * 60 * 1000
		) {
			continue;
		}
		out.set(key, record);
	}
	return out;
}

/** 指数退避：第 5 次起 30s → 60s → 120s → ... 封顶 30 分钟 */
function lockSecondsFor(failures: number): number {
	const exponent = failures - FAIL_THRESHOLD;
	const seconds = BASE_LOCK_SECONDS * 2 ** exponent;
	return Math.min(seconds, MAX_LOCK_SECONDS);
}

/** 从请求头解析客户端标识：CF 直连 IP > X-Forwarded-For 首项 > unknown（见 client-ip.ts） */

/**
 * 第二空间（应急控制台）的失败计数命名空间。
 * 主空间用空 scope（与历史数据兼容），第二密码用 "super" 独立计数。
 */
export const SUPER_SCOPE = "super";

/**
 * 失败计数/锁定按「空间」隔离：scope 为空即主空间。
 * 之所以必须隔离，是因为登录成功后只应清零「本空间」的计数——否则攻击者
 * 用一次正确主密码登录即可清掉猜第二密码的失败计数，从而无限探测它。
 */
function scopedKey(clientKey: string, scope?: string): string {
	return scope ? `${clientKey}:${scope}` : clientKey;
}

/** 当前是否处于锁定：返回剩余秒数（0 表示未锁定）；只读，不触发写入 */
export async function checkLockout(
	clientKey: string,
	scope?: string,
): Promise<{
	locked: boolean;
	retryAfterSeconds: number;
}> {
	const state = await loadState();
	const record = state.get(scopedKey(clientKey, scope));
	if (!record) return { locked: false, retryAfterSeconds: 0 };
	const remaining = Math.ceil((record.lockedUntil - Date.now()) / 1000);
	if (remaining > 0) return { locked: true, retryAfterSeconds: remaining };
	return { locked: false, retryAfterSeconds: 0 };
}

/** 记录一次登录失败；达到阈值后按指数退避延长锁定，返回当前剩余秒数 */
export async function registerFailure(
	clientKey: string,
	scope?: string,
): Promise<{
	retryAfterSeconds: number;
	locked: boolean;
	failures: number;
}> {
	const key = scopedKey(clientKey, scope);
	const state = swept(await loadState());
	const prev = state.get(key);
	const failures = (prev?.failures ?? 0) + 1;
	const lockedUntil =
		failures >= FAIL_THRESHOLD
			? Date.now() + lockSecondsFor(failures) * 1000
			: (prev?.lockedUntil ?? 0);
	state.set(key, { failures, lockedUntil });
	await saveState(state);
	if (lockedUntil > Date.now()) {
		return {
			locked: true,
			retryAfterSeconds: Math.ceil((lockedUntil - Date.now()) / 1000),
			failures,
		};
	}
	return { locked: false, retryAfterSeconds: 0, failures };
}

/** 登录成功：清空该客户端「本空间」的失败计数 */
export async function clearFailures(
	clientKey: string,
	scope?: string,
): Promise<void> {
	const state = swept(await loadState());
	state.delete(scopedKey(clientKey, scope));
	await saveState(state);
}

/** 查询当前失败计数（诊断/审计用） */
export async function failureCount(
	clientKey: string,
	scope?: string,
): Promise<number> {
	const state = await loadState();
	return state.get(scopedKey(clientKey, scope))?.failures ?? 0;
}

/**
 * 固定窗口频次检查：窗口内尝试次数已达上限即拒绝。只读，不触发写入。
 *
 * 与失败计数锁定的分工：锁定只在密码错误时累计，攻击者若掌握有效密码
 * （或用分布式方式每次换一个 IP 只试一次）完全不会触发它。此处按 IP 对
 * 所有尝试计数，堵住这类绕过。成功登录由 clearAttempts 清零，因此正常
 * 使用者不受影响，只有连续密集尝试才会被挡。
 */
export async function checkAttemptRate(clientKey: string): Promise<{
	limited: boolean;
	retryAfterSeconds: number;
}> {
	const now = Date.now();
	const record = (await loadAttemptState()).get(clientKey);
	if (!record) return { limited: false, retryAfterSeconds: 0 };
	const windowEnd = record.windowStart + ATTEMPT_WINDOW_SECONDS * 1000;
	// 窗口已过期：视为全新窗口，不追溯历史次数
	if (now >= windowEnd) return { limited: false, retryAfterSeconds: 0 };
	if (record.count < ATTEMPT_LIMIT) {
		return { limited: false, retryAfterSeconds: 0 };
	}
	return {
		limited: true,
		retryAfterSeconds: Math.ceil((windowEnd - now) / 1000),
	};
}

/** 记一次尝试（成功与失败都调用）；窗口已过期则开启新窗口 */
export async function registerAttempt(clientKey: string): Promise<void> {
	const now = Date.now();
	const state = await loadAttemptState();
	const prev = state.get(clientKey);
	const inWindow =
		prev !== undefined &&
		now - prev.windowStart < ATTEMPT_WINDOW_SECONDS * 1000;
	state.set(
		clientKey,
		inWindow
			? { count: prev.count + 1, windowStart: prev.windowStart }
			: { count: 1, windowStart: now },
	);
	await saveAttemptState(state);
}

/** 登录成功：清空该客户端的尝试计数，避免正常用户被自己的重试拖累 */
export async function clearAttempts(clientKey: string): Promise<void> {
	const state = await loadAttemptState();
	state.delete(clientKey);
	await saveAttemptState(state);
}

/** 当前窗口内的尝试次数（诊断/审计用） */
export async function attemptCount(clientKey: string): Promise<number> {
	const record = (await loadAttemptState()).get(clientKey);
	if (!record) return 0;
	if (Date.now() - record.windowStart >= ATTEMPT_WINDOW_SECONDS * 1000)
		return 0;
	return record.count;
}

function loadAttemptState(): Promise<Map<string, AttemptRecord>> {
	return loadStateMap(ATTEMPT_STATE_KEY, attemptFallback);
}

function saveAttemptState(state: Map<string, AttemptRecord>): Promise<void> {
	return saveStateMap(ATTEMPT_STATE_KEY, state, attemptFallback);
}

/* ---------------- IP 黑名单 ---------------- */

/** 存储不可用时的进程内副本（与计数层一致，降级为放行而非拒绝） */
const banFallback = new Map<string, BanRecord>();

function loadBanState(): Promise<Map<string, BanRecord>> {
	return loadStateMap(BAN_STATE_KEY, banFallback);
}

function saveBanState(state: Map<string, BanRecord>): Promise<void> {
	// 黑名单是显式人工操作：不设存储 TTL，避免「永久封禁」随时间流逝消失
	return saveStateMap(BAN_STATE_KEY, state, banFallback, 0);
}

/** 剔除已到期的临时封禁项；永久项（until=null）保留 */
function sweptBans(state: Map<string, BanRecord>): Map<string, BanRecord> {
	const now = Date.now();
	const out = new Map<string, BanRecord>();
	for (const [ip, rec] of state) {
		if (rec.until !== null && rec.until <= now) continue;
		out.set(ip, rec);
	}
	return out;
}

/**
 * 该 IP 当前是否被封禁。只读，不触发写入；已到期的临时封禁视为未封。
 * retryAfterSeconds 为 0 表示永久封禁（无自动解封时间）。
 */
export async function isIpBanned(ip: string): Promise<{
	banned: boolean;
	reason: string;
	retryAfterSeconds: number;
}> {
	if (!ip) return { banned: false, reason: "", retryAfterSeconds: 0 };
	const record = (await loadBanState()).get(ip);
	if (!record) return { banned: false, reason: "", retryAfterSeconds: 0 };
	if (record.until !== null && record.until <= Date.now()) {
		return { banned: false, reason: "", retryAfterSeconds: 0 };
	}
	return {
		banned: true,
		reason: record.reason,
		retryAfterSeconds:
			record.until === null ? 0 : Math.ceil((record.until - Date.now()) / 1000),
	};
}

/**
 * 封禁一个 IP。ttlSeconds 省略或 ≤0 表示永久封禁。
 * 返回写入的记录；ip 为空时抛错（避免误把 unknown 之类的空值写进黑名单）。
 */
export async function banIp(
	ip: string,
	opts: { reason?: string; by?: string; ttlSeconds?: number } = {},
): Promise<BanRecord> {
	if (!ip) throw new Error("[LoginGuard] banIp 需要非空 IP");
	const state = sweptBans(await loadBanState());
	const now = Date.now();
	const record: BanRecord = {
		reason: opts.reason?.trim() || "手动封禁",
		by: opts.by?.trim() || "admin",
		bannedAt: now,
		until:
			opts.ttlSeconds && opts.ttlSeconds > 0
				? now + opts.ttlSeconds * 1000
				: null,
	};
	state.set(ip, record);
	await saveBanState(state);
	return record;
}

/** 解除封禁；返回是否确实存在该记录 */
export async function unbanIp(ip: string): Promise<boolean> {
	const state = await loadBanState();
	if (!state.has(ip)) return false;
	state.delete(ip);
	await saveBanState(state);
	return true;
}

/** 当前生效的黑名单（已剔除过期临时项），按封禁时间倒序 */
export async function listBanned(): Promise<(BanRecord & { ip: string })[]> {
	const state = sweptBans(await loadBanState());
	return [...state.entries()]
		.map(([ip, rec]) => ({ ip, ...rec }))
		.sort((a, b) => b.bannedAt - a.bannedAt);
}

function auditLogPath(): string {
	return path.join(os.tmpdir(), "firefly-admin-audit.log");
}

/** 追加一条审计记录；文件系统不可写时降级为仅控制台 */
export function writeAuditLog(entry: {
	event:
		| "login_success"
		| "login_failure"
		| "login_locked"
		| "secrets_updated"
		| "secrets_credentials_updated"
		| "secrets_exported"
		| "setup_completed"
		| "sessions_listed"
		| "session_revoked"
		| "draft_saved"
		| "ip_banned"
		| "ip_unbanned";
	client: string;
	username: string;
	detail?: string;
}): void {
	const line = [
		new Date().toISOString(),
		entry.event,
		`client=${entry.client}`,
		`user=${entry.username || "(空)"}`,
		entry.detail ? `detail=${entry.detail}` : "",
	]
		.filter(Boolean)
		.join(" | ");
	try {
		fs.mkdirSync(path.dirname(auditLogPath()), { recursive: true });
		fs.appendFileSync(auditLogPath(), `${line}\n`, "utf8");
	} catch {
		// 文件系统不可写（Serverless 等）：仅控制台
	}
	console.log(`[Admin Audit] ${line}`);
}
