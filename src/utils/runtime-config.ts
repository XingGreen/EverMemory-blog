/**
 * 运行时配置覆盖层
 *
 * 被 CONFIG_ITEMS 标记为 runtime 的配置项，保存时不写回源码 / 不触发重建，
 * 而是写入持久化 KV（本地文件或 Vercel KV，见 persist-store.ts）。
 * 前台组件构建时以源码默认值为基准，运行时拉取本覆盖层即时生效。
 *
 * 存储键：runtime-config:<key>（符合 persist-store 的键规则）。
 */

import { getStore } from "./persist-store";
import { CONFIG_ITEMS } from "./admin-settings";

const PREFIX = "runtime-config:";

function storeKey(key: string): string {
	return `${PREFIX}${key}`;
}

/** 当前允许运行时覆盖的配置项 key 集合（来自 CONFIG_ITEMS 的 runtime 标记） */
export const RUNTIME_CONFIG_KEYS: string[] = CONFIG_ITEMS.filter(
	(item) => item.runtime,
).map((item) => item.key);

/** 指定 key 是否为运行时配置 */
export function isRuntimeConfigKey(key: string): boolean {
	return RUNTIME_CONFIG_KEYS.includes(key);
}

/** 读取指定 key 的运行时覆盖值；未覆盖返回 null */
export async function getRuntimeConfig<T>(key: string): Promise<T | null> {
	if (!isRuntimeConfigKey(key)) return null;
	return await getStore().get<T>(storeKey(key));
}

/** 写入/覆盖指定 key 的运行时配置 */
export async function setRuntimeConfig(
	key: string,
	value: unknown,
): Promise<void> {
	if (!isRuntimeConfigKey(key)) {
		throw new Error(`[RuntimeConfig] 不允许运行时覆盖的配置项: ${key}`);
	}
	await getStore().set(storeKey(key), value);
}

/** 清除指定 key 的运行时覆盖，回落构建期源码默认值 */
export async function delRuntimeConfig(key: string): Promise<void> {
	if (!isRuntimeConfigKey(key)) return;
	await getStore().del(storeKey(key));
}

/** 读取全部运行时覆盖（公开只读端点用）；键值仅在存在覆盖时出现 */
export async function getAllRuntimeConfigs(): Promise<
	Record<string, unknown>
> {
	const out: Record<string, unknown> = {};
	for (const key of RUNTIME_CONFIG_KEYS) {
		const value = await getRuntimeConfig(key);
		if (value !== null && value !== undefined) out[key] = value;
	}
	return out;
}