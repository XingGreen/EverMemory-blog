/**
 * 后台审计日志（仅服务端使用，含 node:fs，勿在前端组件中 import）
 *
 * 每次后台敏感操作（登录、密钥变更、导出、会话管理、草稿）追加写入系统临时
 * 目录 firefly-admin-audit.log（尽力而为）+ 控制台 [Admin Audit] 行。
 *
 * 审计日志不参与任何授权/防护判定，纯记录用途，故：
 *  - 仍用文件追加，Serverless 上写入失败会自动降级为仅控制台；
 *  - 本模块不依赖存储后端，删掉登录防护层后仍独立可用。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getStore } from "./persist-store";

function auditLogPath(): string {
	return path.join(os.tmpdir(), "firefly-admin-audit.log");
}

/** 追加一条审计记录；文件系统不可写时降级为仅控制台 */
export function writeAuditLog(entry: {
	event:
		| "login_success"
		| "login_failure"
		| "secrets_updated"
		| "secrets_credentials_updated"
		| "secrets_rotated"
		| "secrets_exported"
		| "sessions_listed"
		| "session_revoked"
		| "draft_saved"
		/** 同步操作台执行了一次同步（detail 里记成功/失败条数） */
		| "sync_applied"
		/** 同步检查：只读比对，用于记录「什么时候查过、结果如何」 */
		| "sync_checked";
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

	/* 写入持久化存储（KV / file / db 由 persist-store 选择）。
	   必须 fire-and-forget：调用方多为同步路径（登录、保存），
	   不能因为一次日志写入把请求拖慢或拖挂。失败只记 console。 */
	void getStore()
		.set(`audit:${Date.now()}:${randomSuffix()}`, entry, AUDIT_TTL_SECONDS)
		.catch((err) => {
			console.warn("[Admin Audit] 持久化失败，仅保留控制台输出:", err);
		});
}

/** 90 天：与迁移脚本注释里的保留窗口一致 */
const AUDIT_TTL_SECONDS = 90 * 24 * 3600;

/** 同一毫秒内多次写入时避免键冲突 */
function randomSuffix(): string {
	return Math.random().toString(36).slice(2, 8);
}

export interface AuditEntry {
	event: string;
	client: string;
	username: string;
	detail?: string;
	/** 写入时的时间戳（ms） */
	at?: number;
}

/**
 * 读取最近的审计记录（新的在前）。
 * 依赖 KVStore.list —— file / kv / db 三个后端都已实现；
 * 没实现的第三方后端会返回空数组，面板显示「暂无记录」而不是报错。
 */
export async function listAuditLogs(limit = 100): Promise<AuditEntry[]> {
	try {
		const store = getStore();
		if (!store.list) return [];
		const keys = await store.list("audit:", limit);
		const entries = await Promise.all(
			keys.map(async (key): Promise<AuditEntry | null> => {
				const raw = await store.get<AuditEntry>(key);
				if (!raw) return null;
				const ts = Number(key.split(":")[1]);
				return { ...raw, at: Number.isFinite(ts) ? ts : undefined };
			}),
		);
		return entries.filter((e): e is AuditEntry => e !== null);
	} catch {
		return [];
	}
}
