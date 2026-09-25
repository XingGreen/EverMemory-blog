/**
 * 登录暴力破解防护与审计（仅服务端使用，勿在前端组件中 import）
 *
 * 防护策略（状态持久化，跨请求/跨进程生效）：
 *  - 按客户端标识（IP）统计连续失败次数
 *  - 达到阈值后进入锁定：锁定时长随失败次数指数退避，封顶 30 分钟
 *  - 登录成功后清空该标识的失败计数
 *
 * 存储说明（重要）：
 *  - 状态以「追加式日志」写入系统临时目录 firefly-admin-lock.log，
 *    每行是一份完整状态快照 JSON，读取时取最后一行即为最新状态。
 *  - 为什么不用覆盖写入：本环境实测（Astro dev daemon / preview /
 *    node standalone 构建产物）下，覆盖式 writeFileSync 的落盘在跨请求
 *    后不可见（内容丢失），而 appendFileSync 与读取一直可靠；故采用
 *    追加日志 + 读尾行的模式。
 *  - Vercel / Cloudflare 等 Serverless 平台文件系统只读（或 /tmp 不持久），
 *    写入失败自动降级（无进程内防护），此时应依赖平台网关层 Rate Limiting。
 *
 * 审计：每次登录尝试（成功/失败/锁定）追加写入系统临时目录
 * firefly-admin-audit.log（尽力而为）+ 控制台 [Admin Audit] 行。
 */
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

/** 连续失败次数阈值，达到后开始锁定 */
const FAIL_THRESHOLD = 5;
/** 基础锁定秒数，第 FAIL_THRESHOLD 次失败生效 */
const BASE_LOCK_SECONDS = 30;
/** 锁定上限（30 分钟） */
const MAX_LOCK_SECONDS = 30 * 60;

interface LockRecord {
	failures: number;
	lockedUntil: number;
}

type LockState = Record<string, LockRecord>;

function stateFilePath(): string {
	return path.join(os.tmpdir(), "firefly-admin-lock.log");
}

/** 读取持久化状态：取追加日志的最后一行；缺失/损坏时视为空 */
function loadState(): LockState {
	try {
		const raw = fs.readFileSync(stateFilePath(), "utf8");
		const lines = raw.split("\n").filter((l) => l.startsWith("{"));
		const last = lines[lines.length - 1];
		if (!last) return {};
		const parsed = JSON.parse(last) as LockState;
		if (parsed && typeof parsed === "object") return parsed;
		return {};
	} catch {
		return {};
	}
}

/** 追加一行完整状态快照；文件系统不可写（Serverless 等）时静默降级 */
function saveState(state: LockState): void {
	try {
		fs.mkdirSync(path.dirname(stateFilePath()), { recursive: true });
		fs.appendFileSync(stateFilePath(), `${JSON.stringify(state)}\n`, "utf8");
	} catch {
		// 防护降级（不影响登录功能本身），依赖平台限流
	}
}

/** 清理过期记录（仅删除已过锁定期且超过 1 小时的；未锁定记录保留以持续累计） */
function swept(state: LockState): LockState {
	const now = Date.now();
	const out: LockState = {};
	for (const [key, record] of Object.entries(state)) {
		if (
			record.lockedUntil > 0 &&
			now > record.lockedUntil &&
			now - record.lockedUntil > 60 * 60 * 1000
		) {
			continue;
		}
		out[key] = record;
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

/** 当前是否处于锁定：返回剩余秒数（0 表示未锁定）；只读，不触发写盘 */
export function checkLockout(clientKey: string): {
	locked: boolean;
	retryAfterSeconds: number;
} {
	const state = loadState();
	const record = state[clientKey];
	if (!record) return { locked: false, retryAfterSeconds: 0 };
	const remaining = Math.ceil((record.lockedUntil - Date.now()) / 1000);
	if (remaining > 0) return { locked: true, retryAfterSeconds: remaining };
	return { locked: false, retryAfterSeconds: 0 };
}

/** 记录一次登录失败；达到阈值后按指数退避延长锁定，返回当前剩余秒数 */
export function registerFailure(clientKey: string): {
	retryAfterSeconds: number;
	locked: boolean;
	failures: number;
} {
	const state = swept(loadState());
	const prev = state[clientKey];
	const failures = (prev?.failures ?? 0) + 1;
	const lockedUntil =
		failures >= FAIL_THRESHOLD
			? Date.now() + lockSecondsFor(failures) * 1000
			: prev?.lockedUntil ?? 0;
	state[clientKey] = { failures, lockedUntil };
	saveState(state);
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
export function clearFailures(clientKey: string): void {
	const state = swept(loadState());
	delete state[clientKey];
	saveState(state);
}

/** 查询当前失败计数（诊断/审计用） */
export function failureCount(clientKey: string): number {
	return loadState()[clientKey]?.failures ?? 0;
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
		| "setup_completed";
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