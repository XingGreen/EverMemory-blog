-- 0001_app_store.sql
-- 通用键值存储表：persist-store 的 db 后端与审计日志共用。
-- 兼容 Cloudflare D1 (SQLite) / Postgres / MySQL —— 只用最基础的列类型。

CREATE TABLE IF NOT EXISTS app_store (
	key        TEXT PRIMARY KEY,   -- 业务键，如 audit:1793496702387:ab12、config:site
	value      TEXT NOT NULL,      -- JSON 字符串
	expires_at INTEGER,            -- 过期时间戳（ms）；NULL 表示永不过期
	updated_at INTEGER NOT NULL    -- 最后写入时间戳（ms）
);

-- 过期清理扫描用（purgeExpired 按 expires_at 过滤）
CREATE INDEX IF NOT EXISTS idx_app_store_expires ON app_store(expires_at);

-- 审计日志按 key 前缀倒序读取（listByPrefix），key 以时间戳开头，
-- 因此对 key 建索引即可满足 "audit:%" 的范围扫描 + 倒序。
CREATE INDEX IF NOT EXISTS idx_app_store_key ON app_store(key);

-- ---------------------------------------------------------------------------
-- 清理策略（按天跑一次即可，个人博客量级下完全够用）
--
--   -- 1) 过期键
--   DELETE FROM app_store WHERE expires_at IS NOT NULL AND expires_at < :now_ms;
--
--   -- 2) 审计日志保留 90 天（key 形如 audit:<ms>:<rand>，可解析出时间）
--   DELETE FROM app_store WHERE key LIKE 'audit:%' AND updated_at < :cutoff_ms;
--
--   -- 3) 需要更强控制时按动作降采样（只留异常与危险操作）
--   --    先 SELECT 出目标，再删，因为 key 里不含 action。
--
-- 触发方式：
--   Cloudflare → wrangler.jsonc 的 triggers.crons（如 "0 3 * * *"）
--   Vercel     → vercel.json 的 crons
--   本地/自托管 → 系统 crontab 调一个 POST /api/admin/maintenance/purge
-- ---------------------------------------------------------------------------
