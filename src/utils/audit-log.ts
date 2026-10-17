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
		| "secrets_exported"
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
