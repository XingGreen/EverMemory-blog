/**
 * 网易云歌单聚合接口（带 KV 缓存）。
 *
 * 背景：原先每个访客打开 /music/ 都会由浏览器直连第三方代理，先拉列表再逐条拉
 * 详情（N 个歌单 = N+1 次请求）。访客一多，第三方就会限流甚至把本站当成刷接口。
 *
 * 现在的口径：
 *   1. 浏览器只请求本接口（1 次）；
 *   2. 本接口先查 persist-store（线上是 KV、本地是文件），命中直接返回；
 *   3. 未命中才回源第三方，取完写缓存（TTL 10 分钟）；
 *   4. 回源失败但存在过期缓存时，返回过期数据并标记 stale，页面不至于白屏。
 *
 * 这样源站压力从「访客数 × 歌单数」降到「每 10 分钟一轮」。
 */

import type { APIRoute } from "astro";
import { siteConfig } from "@/config";
import { getStore } from "@/utils/persist-store";

export const prerender = false;

const CACHE_TTL_SECONDS = 600;
const FETCH_TIMEOUT_MS = 10_000;
const DETAIL_CONCURRENCY = 4;

interface Playlist {
	id: string | number;
	name: string;
	coverImgUrl?: string;
	cover?: string;
	description?: string;
	creator?: {
		nickname?: string;
		userId?: string | number;
		id?: string | number;
	};
	trackCount?: number;
	tracks?: Array<{
		id: string | number;
		name: string;
		artist: string;
		album: string;
		duration?: number;
	}>;
	playCount?: number;
	subscribed?: boolean;
}

interface PlaylistPayload {
	my: Playlist[];
	subscribed: Playlist[];
}

interface CacheRecord {
	data: PlaylistPayload;
	savedAt: number;
}

function cacheKey(uid: string): string {
	return `music:playlists:${uid}`;
}

const HEADERS = {
	"User-Agent":
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	Referer: "https://music.163.com/",
};

async function fetchJson(url: string): Promise<unknown | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(url, { headers: HEADERS, signal: controller.signal });
		if (!res.ok) return null;
		return await res.json();
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

function splitByOwner(
	list: Playlist[],
	uid: string,
): { mine: Playlist[]; others: Playlist[] } {
	const mine: Playlist[] = [];
	const others: Playlist[] = [];
	for (const item of list) {
		const creatorId =
			item.creator?.userId?.toString() || item.creator?.id?.toString();
		if (creatorId === uid) mine.push(item);
		else others.push(item);
	}
	return { mine, others };
}

/** 拉取歌单列表；逐个尝试多个第三方源，任一成功即返回 */
async function fetchPlaylists(uid: string): Promise<PlaylistPayload | null> {
	const sources = [
		`https://apis.netstart.cn/music/user/playlist?uid=${uid}`,
		`https://music.163.com/api/user/playlist/?uid=${uid}`,
		`https://api.i-meto.com/meting/api?server=netease&type=playlist&id=${uid}`,
	];

	for (const url of sources) {
		const data = (await fetchJson(url)) as
			| {
					code?: number;
					playlist?: Playlist[];
					subscribedPlaylist?: Playlist[];
			  }
			| Playlist[]
			| null;
		if (!data) continue;

		if (!Array.isArray(data) && data.code === 200 && Array.isArray(data.playlist)) {
			if (Array.isArray(data.subscribedPlaylist)) {
				const { mine } = splitByOwner(data.playlist, uid);
				return { my: mine, subscribed: data.subscribedPlaylist };
			}
			const { mine, others } = splitByOwner(data.playlist, uid);
			return { my: mine, subscribed: others };
		}

		if (Array.isArray(data) && data.length > 0 && "name" in data[0]) {
			const { mine, others } = splitByOwner(data as Playlist[], uid);
			return { my: mine, subscribed: others };
		}
	}
	return null;
}

/** 单歌单详情；只用来补 tracks 与准确曲目数 */
async function fetchPlaylistDetail(id: string | number): Promise<Playlist | null> {
	const url = `https://api.i-meto.com/meting/api?server=netease&type=playlist&id=${id}&limit=300`;
	const data = (await fetchJson(url)) as
		| { code?: number; playlist?: Playlist; tracks?: Playlist["tracks"] }
		| Playlist[]
		| null;
	if (!data) return null;
	if (!Array.isArray(data)) {
		if (data.playlist) return data.playlist;
		if (data.tracks) return data as Playlist;
		return null;
	}
	if (data.length > 0 && data[0].tracks) return data[0];
	return null;
}

/** 限制并发地补详情 */
async function enrichWithDetails(list: Playlist[]): Promise<Playlist[]> {
	const results: Playlist[] = new Array(list.length);
	let cursor = 0;

	async function worker(): Promise<void> {
		while (cursor < list.length) {
			const index = cursor++;
			const base = list[index];
			const detail = await fetchPlaylistDetail(base.id);
			results[index] = detail
				? {
						...base,
						...detail,
						trackCount:
							base.trackCount ||
							detail.trackCount ||
							detail.tracks?.length ||
							0,
					}
				: base;
		}
	}

	await Promise.all(
		Array.from({ length: Math.min(DETAIL_CONCURRENCY, list.length) }, worker),
	);
	return results;
}

function json(data: unknown, extraHeaders: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(data), {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "public, max-age=60",
			...extraHeaders,
		},
	});
}

export const GET: APIRoute = async ({ url }) => {
	const uid = (url.searchParams.get("uid") || siteConfig.music?.userId || "").trim();
	if (!uid) {
		return json({ success: false, message: "未配置网易云音乐用户 ID" });
	}

	const store = getStore();
	const key = cacheKey(uid);

	/* 1. 命中缓存直接返回，不再碰第三方 */
	let cached: CacheRecord | null = null;
	try {
		cached = await store.get<CacheRecord>(key);
	} catch {
		cached = null;
	}
	if (cached && Date.now() - cached.savedAt < CACHE_TTL_SECONDS * 1000) {
		return json(
			{ success: true, ...cached.data, updatedAt: cached.savedAt, cached: true },
			{ "X-Music-Cache": "hit" },
		);
	}

	/* 2. 回源：列表 + 详情 */
	const raw = await fetchPlaylists(uid);
	if (!raw) {
		/* 回源失败：有旧缓存就继续用旧的，只是标记 stale */
		if (cached) {
			return json(
				{
					success: true,
					...cached.data,
					updatedAt: cached.savedAt,
					cached: true,
					stale: true,
				},
				{ "X-Music-Cache": "stale" },
			);
		}
		return json({ success: false, message: "歌单数据获取失败" });
	}

	const [my, subscribed] = await Promise.all([
		raw.my.length > 0 ? enrichWithDetails(raw.my) : Promise.resolve([]),
		raw.subscribed.length > 0 ? enrichWithDetails(raw.subscribed) : Promise.resolve([]),
	]);

	const record: CacheRecord = {
		data: { my, subscribed },
		savedAt: Date.now(),
	};
	try {
		await store.set(key, record, CACHE_TTL_SECONDS * 6);
	} catch (error) {
		/* 缓存写失败不影响本次返回 */
		console.warn("[Music API] 写入缓存失败:", error);
	}

	return json(
		{ success: true, my, subscribed, updatedAt: record.savedAt, cached: false },
		{ "X-Music-Cache": "miss" },
	);
};
