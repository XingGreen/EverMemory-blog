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

import { getStore } from "./persist-store";

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

/** 覆盖写入一类状态；存储不可用时仅更新进程内副本 */
async function saveStateMap<T>(
	key: string,
	state: Map<string, T>,
	fallback: Map<string, T>,
): Promise<void> {
	fallback.clear();
	for (const [k, v] of state) fallback.set(k, v);
	try {
		await getStore().set(key, Object.fromEntries(state), STATE_TTL_SECONDS);
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

/** 从请求头解析客户端标识：CF 直连 IP > X-Forwarded-For 首项 > unknown */
export function getClientIp(request: Request): string {
	const cf = request.headers.get("cf-connecting-ip");
	if (cf) return cf;
	const fwd = request.headers.get("x-forwarded-for");
	if (fwd) {
		const first = fwd.split(",")[0]?.trim();
		if (first) return first;
	}
	return "unknown";
}

/** 当前是否处于锁定：返回剩余秒数（0 表示未锁定）；只读，不触发写入 */
export async function checkLockout(clientKey: string): Promise<{
	locked: boolean;
	retryAfterSeconds: number;
}> {
	const state = await loadState();
	const record = state.get(clientKey);
	if (!record) return { locked: false, retryAfterSeconds: 0 };
	const remaining = Math.ceil((record.lockedUntil - Date.now()) / 1000);
	if (remaining > 0) return { locked: true, retryAfterSeconds: remaining };
	return { locked: false, retryAfterSeconds: 0 };
}

/** 记录一次登录失败；达到阈值后按指数退避延长锁定，返回当前剩余秒数 */
export async function registerFailure(clientKey: string): Promise<{
	retryAfterSeconds: number;
	locked: boolean;
	failures: number;
}> {
	const state = swept(await loadState());
	const prev = state.get(clientKey);
	const failures = (prev?.failures ?? 0) + 1;
	const lockedUntil =
		failures >= FAIL_THRESHOLD
			? Date.now() + lockSecondsFor(failures) * 1000
			: (prev?.lockedUntil ?? 0);
	state.set(clientKey, { failures, lockedUntil });
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

/** 登录成功：清空失败计数 */
export async function clearFailures(clientKey: string): Promise<void> {
	const state = swept(await loadState());
	state.delete(clientKey);
	await saveState(state);
}

/** 查询当前失败计数（诊断/审计用） */
export async function failureCount(clientKey: string): Promise<number> {
	const state = await loadState();
	return state.get(clientKey)?.failures ?? 0;
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
		prev !== undefined && now - prev.windowStart < ATTEMPT_WINDOW_SECONDS * 1000;
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
	if (Date.now() - record.windowStart >= ATTEMPT_WINDOW_SECONDS * 1000) return 0;
	return record.count;
}

function loadAttemptState(): Promise<Map<string, AttemptRecord>> {
	return loadStateMap(ATTEMPT_STATE_KEY, attemptFallback);
}

function saveAttemptState(state: Map<string, AttemptRecord>): Promise<void> {
	return saveStateMap(ATTEMPT_STATE_KEY, state, attemptFallback);
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
		| "draft_saved";
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