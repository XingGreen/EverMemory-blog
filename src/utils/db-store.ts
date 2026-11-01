/**
 * 数据库后端（实现 KVStore 接口）。
 *
 * 设计要点：
 *  - 零依赖：不直接 import pg / D1，而是接受一个 SqlExecutor（依赖注入），
 *    这样同一份实现能跑在 Cloudflare D1、Postgres、SQLite 上，
 *    也便于单测时塞一个内存实现。
 *  - 表结构与方言：只用 TEXT / INTEGER / PRIMARY KEY / INDEX 这些各引擎都支持的类型，
 *    时间统一存毫秒整数（跨引擎一致，且范围查询走索引最快）。
 *  - 过期清理由 expires_at + 定期 DELETE 完成（见 migrations/0001_app_store.sql 末尾注释）。
 */
import type { KVStore } from "./persist-store";

/** 最小 SQL 执行器契约：不同数据库适配成它即可 */
export interface SqlExecutor {
	/** 执行一条 SQL，返回行数组（写操作可返回空数组） */
	query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
}

/**
 * 建表语句。放在这里是为了让「接入数据库」这一步自成闭环：
 * 无论用 D1 / PG / SQLite，先把这段跑一遍即可。
 */
export const APP_STORE_SCHEMA = `
CREATE TABLE IF NOT EXISTS app_store (
	key        TEXT PRIMARY KEY,
	value      TEXT NOT NULL,
	expires_at INTEGER,
	updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_store_expires ON app_store(expires_at);
`;

/** 清理已过期的键；返回删除行数（多数驱动不返回，故只作尽力而为） */
export async function purgeExpired(db: SqlExecutor): Promise<void> {
	await db.query(
		"DELETE FROM app_store WHERE expires_at IS NOT NULL AND expires_at < ?",
		[Date.now()],
	);
}

export function createDbStore(db: SqlExecutor): KVStore {
	return {
		async get<T>(key: string): Promise<T | null> {
			const rows = await db.query(
				"SELECT value, expires_at FROM app_store WHERE key = ? LIMIT 1",
				[key],
			);
			const row = rows[0];
			if (!row) return null;
			const expiresAt = row.expires_at;
			if (typeof expiresAt === "number" && expiresAt < Date.now()) {
				// 惰性删除：读到过期的顺手清掉，避免依赖定时任务才能保证语义
				await db.query("DELETE FROM app_store WHERE key = ?", [key]);
				return null;
			}
			try {
				return JSON.parse(String(row.value)) as T;
			} catch {
				return null;
			}
		},

		async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
			const now = Date.now();
			const expiresAt =
				typeof ttlSeconds === "number" && ttlSeconds > 0
					? now + ttlSeconds * 1000
					: null;
			const payload = JSON.stringify(value);
			/* 各引擎的 UPSERT 方言差异大（ON CONFLICT / ON DUPLICATE KEY / MERGE），
			   这里用「先查存在性，再 UPDATE 或 INSERT」的写法，通用且行为可预期。
			   写入频率低（配置、日志），两次往返的开销可以接受。 */
			const exists = await db.query(
				"SELECT 1 AS hit FROM app_store WHERE key = ? LIMIT 1",
				[key],
			);
			if (exists.length > 0) {
				await db.query(
					"UPDATE app_store SET value = ?, expires_at = ?, updated_at = ? WHERE key = ?",
					[payload, expiresAt, now, key],
				);
			} else {
				await db.query(
					"INSERT INTO app_store (key, value, expires_at, updated_at) VALUES (?, ?, ?, ?)",
					[key, payload, expiresAt, now],
				);
			}
		},

		async del(key: string): Promise<void> {
			await db.query("DELETE FROM app_store WHERE key = ?", [key]);
		},
	};
}

/**
 * 列出某个前缀下的键（审计日志的读取需要它，KVStore 接口本身没有 list）。
 * 单独导出而不是塞进 KVStore，是为了不破坏已有 file / kv 后端的契约。
 */
export async function listByPrefix(
	db: SqlExecutor,
	prefix: string,
	limit = 200,
): Promise<string[]> {
	const rows = await db.query(
		"SELECT key FROM app_store WHERE key LIKE ? ORDER BY key DESC LIMIT ?",
		[`${prefix}%`, limit],
	);
	return rows.map((r) => String(r.key));
}
