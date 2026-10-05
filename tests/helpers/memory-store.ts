import type { KVStore } from "@utils/persist-store";

/**
 * 内存版 KVStore：接口与 persist-store 的两个后端完全等价，
 * 但不碰文件系统也不发网络请求。
 *
 * 存在的意义是让 session-store 的测试跑真实代码路径
 * （readAll/writeAll/过期清理/touch 节流/删除竞态重试），
 * 而不是把被测对象本身mock 掉——那样测的就只是 mock 的行为。
 */
export function createMemoryStore(): KVStore & {
	dump: () => Record<string, unknown>;
} {
	const map = new Map<string, unknown>();

	return {
		async get<T>(key: string): Promise<T | null> {
			return map.has(key) ? (map.get(key) as T) : null;
		},
		async set(key: string, value: unknown): Promise<void> {
			// 与真实后端一致：存的是深拷贝，避免调用方后续修改对象
			// 意外影响「已存储」的值（真实的 JSON 序列化天然隔离）。
			map.set(key, structuredClone(value));
		},
		async del(key: string): Promise<void> {
			map.delete(key);
		},
		dump: () => Object.fromEntries(map),
	};
}