/**
 * 生产环境草稿存储（KV / 文件后端）。
 *
 * 问题：草稿（frontmatter `draft: true`）只在本地磁盘上，而线上项目目录只读、
 * 构建产物也不含源码，于是「生产环境点开草稿」必然 404，「保存草稿」必然 403，
 * 历史版本恢复同样写不进去——草稿在线上等于不可用。
 *
 * 方案：草稿的正文与 frontmatter 额外存一份到 persist-store（线上是 KV、
 * 本地是 .data/persist 文件）。读写优先级保持不变：
 *   读：本地文件 → 远端仓库 → KV 草稿
 *   写：本地文件（可用时）→ KV 草稿（只读部署）
 * 这样草稿在线上可读可编辑，恢复历史版本时也有落点；正式文章仍然只能通过
 * 同步面板推送，口径不变。
 */

import { getStore } from "./persist-store";

export interface StoredDraft {
	slug: string;
	/** 相对项目根的路径，恢复时用它决定写到哪 */
	filePath: string;
	/** 完整文件内容（含 frontmatter） */
	content: string;
	updatedAt: number;
}

const KEY_PREFIX = "prodpost:";

function keyFor(slug: string): string {
	return `${KEY_PREFIX}${slug}`;
}

/** 读取草稿；不存在或后端不可用时返回 null（调用方按「没有草稿」处理） */
export async function getStoredDraft(
	slug: string,
): Promise<StoredDraft | null> {
	if (!slug) return null;
	try {
		const rec = await getStore().get<StoredDraft>(keyFor(slug));
		if (!rec || typeof rec.content !== "string") return null;
		return rec;
	} catch {
		return null;
	}
}

/** 写入草稿；返回是否成功（存储不可用时不应让保存流程直接崩） */
export async function putStoredDraft(
	draft: Omit<StoredDraft, "updatedAt"> & { updatedAt?: number },
): Promise<boolean> {
	if (!draft.slug) return false;
	try {
		await getStore().set(keyFor(draft.slug), {
			...draft,
			updatedAt: draft.updatedAt ?? Date.now(),
		});
		return true;
	} catch (error) {
		console.warn("[DraftStore] 写入草稿失败:", error);
		return false;
	}
}

export async function deleteStoredDraft(slug: string): Promise<boolean> {
	if (!slug) return false;
	try {
		await getStore().del(keyFor(slug));
		return true;
	} catch {
		return false;
	}
}

/** 列出全部云端草稿；后端不支持 list 时返回空数组 */
export async function listStoredDrafts(): Promise<StoredDraft[]> {
	const store = getStore();
	if (!store.list) return [];
	try {
		const keys = await store.list(KEY_PREFIX, 500);
		const items = await Promise.all(
			keys.map(async (key) => {
				try {
					const rec = await store.get<StoredDraft>(key);
					return rec && typeof rec.content === "string" ? rec : null;
				} catch {
					return null;
				}
			}),
		);
		return items.filter((x): x is StoredDraft => x !== null);
	} catch {
		return [];
	}
}
