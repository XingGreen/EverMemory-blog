import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryStore } from "./helpers/memory-store";

// getStore 返回的是模块级单例，直接替换它的返回值即可让
// session-store 走内存后端。被测代码本身完全真实执行。
const store = createMemoryStore();
vi.mock("@utils/persist-store", async (importOriginal) => ({
	...(await importOriginal<typeof import("@utils/persist-store")>()),
	getStore: () => store,
	isKvBackend: () => false,
}));

const {
	describeDevice,
	getSession,
	listSessions,
	registerSession,
	revokeAllExcept,
	revokeSession,
	touchSession,
} = await import("@utils/session-store");

const SESSION_PREFIX = "admin_sess:";

/** 直接从内存双工里取会话 sid，避免经由被测函数自证正确 */
function rawSids(): string[] {
	return Object.keys(store.dump())
		.filter((key) => key.startsWith(SESSION_PREFIX))
		.map((key) => key.slice(SESSION_PREFIX.length));
}

/** 直接改存储里的会话记录：模拟时间流逝导致过期 */
async function patchRecord(
	sid: string,
	patch: Partial<{ exp: number; lastSeenAt: number }>,
): Promise<void> {
	const key = SESSION_PREFIX + sid;
	const current = store.dump()[key] as Record<string, unknown>;
	await store.set(key, { ...current, ...patch });
}

const baseOpts = {
	username: "admin",
	ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0",
	ip: "127.0.0.1",
	maxAgeSeconds: 3600,
	remember: false,
};

/** 为每个逻辑设备生成不同 UA，避免被「同设备去重」合并为一条 */
const uaOf = (id: string) =>
	`Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.${id}`;

beforeEach(() => {
	for (const key of Object.keys(store.dump())) {
		void store.del(key);
	}
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("describeDevice", () => {
	it("识别常见桌面浏览器与系统", () => {
		expect(
			describeDevice(
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0",
			),
		).toBe("Chrome · Windows 10/11");
		expect(
			describeDevice(
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15",
			),
		).toBe("Safari · macOS");
		expect(
			describeDevice(
				"Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
			),
		).toBe("Firefox · Linux");
	});

	it("Edge 必须优先于 Chrome 判定", () => {
		// Edg/ 与 Chrome/ 同时出现在 UA 里，若顺序写错会误报为 Chrome
		expect(
			describeDevice(
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
			),
		).toBe("Edge · Windows 10/11");
	});

	it("移动端追加标注，iPad 不算移动端", () => {
		expect(
			describeDevice(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148",
			),
		).toBe("未知浏览器 · iOS（移动端）");
		expect(
			describeDevice(
				"Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Mobile/15E148",
			),
		).toBe("未知浏览器 · iOS");
	});

	it("空 UA 走未知兜底而非抛错", () => {
		expect(describeDevice("")).toBe("未知浏览器 · 未知系统");
	});
});

describe("registerSession", () => {
	it("写入完整会话记录并返回 sid", async () => {
		const sid = await registerSession(baseOpts);

		const record = await getSession(sid);
		expect(record).not.toBeNull();
		expect(record?.sid).toBe(sid);
		expect(record?.username).toBe("admin");
		expect(record?.ip).toBe("127.0.0.1");
		expect(record?.remember).toBe(false);
		expect(record?.exp).toBeGreaterThan(Date.now());
		expect(record?.loginAt).toBe(record?.lastSeenAt);
	});

	it("顺带清理已过期会话，避免表无限膨胀", async () => {
		const keep = await registerSession({ ...baseOpts, ua: uaOf("keep") });

		// 先正常注册，再把 exp 改到过去——这样下一次注册时的清理逻辑
		// 才会遇到它。不能直接用 maxAgeSeconds: -1 注册：那会让该记录
		// 在「清理之后」才写入，测试不到清理分支。
		const stale = await registerSession({ ...baseOpts, ua: uaOf("stale") });
		await patchRecord(stale, { exp: Date.now() - 1000 });

		// 下一次注册触发清理
		await registerSession({ ...baseOpts, ua: uaOf("next") });

		const remaining = rawSids();
		expect(remaining).toContain(keep);
		expect(remaining).not.toContain(stale);
	});

	it("默认认证方式为 github", async () => {
		const sid = await registerSession(baseOpts);

		expect((await getSession(sid))?.amr).toBe("github");
	});

	it("可注册 breakglass 认证方式的会话", async () => {
		const sid = await registerSession({ ...baseOpts, amr: "breakglass" });

		expect((await getSession(sid))?.amr).toBe("breakglass");
	});

	it("authAt 缺省为登录时刻，可显式指定", async () => {
		const sid = await registerSession(baseOpts);
		const rec = await getSession(sid);
		expect(rec?.authAt).toBe(rec?.loginAt);

		const past = Date.now() - 10_000;
		const sid2 = await registerSession({ ...baseOpts, authAt: past });
		expect((await getSession(sid2))?.authAt).toBe(past);
	});
});

describe("同设备去重", () => {
	it("同一 UA 再次登录会替换旧会话，表内只留最新一条", async () => {
		const first = await registerSession(baseOpts);
		const second = await registerSession(baseOpts);

		expect(await getSession(first)).toBeNull();
		expect(await getSession(second)).not.toBeNull();
		expect(rawSids()).toEqual([second]);
	});

	it("不同 UA 的会话并存", async () => {
		const a = await registerSession({ ...baseOpts, ua: uaOf("a") });
		const b = await registerSession({ ...baseOpts, ua: uaOf("b") });

		expect(rawSids().sort()).toEqual([a, b].sort());
	});
});

describe("getSession", () => {
	it("不存在的 sid 返回 null", async () => {
		expect(await getSession("never-existed")).toBeNull();
	});

	it("过期会话返回 null，但本函数不负责清理记录", async () => {
		const sid = await registerSession(baseOpts);
		await patchRecord(sid, { exp: Date.now() - 1000 });

		expect(await getSession(sid)).toBeNull();
		// 清理职责在 registerSession / listSessions，getSession 只做判定；
		// 若这里顺带删除，会与「踢下线」的并发删除形成额外竞态。
		expect(rawSids()).toContain(sid);
	});

	it("优先采用更新的独立 touch 时间", async () => {
		const sid = await registerSession(baseOpts);
		const original = (await getSession(sid))?.lastSeenAt ?? 0;

		// 独立 key 里放入一个更新的时间
		await store.set(`admin_touch_${sid}`, original + 5000);

		expect((await getSession(sid))?.lastSeenAt).toBe(original + 5000);
	});

	it("touch 时间较旧时不覆盖表内值", async () => {
		const sid = await registerSession(baseOpts);
		const original = (await getSession(sid))?.lastSeenAt ?? 0;

		await store.set(`admin_touch_${sid}`, original - 5000);

		expect((await getSession(sid))?.lastSeenAt).toBe(original);
	});
});

describe("revokeSession", () => {
	it("删除存在的会话并返回 true", async () => {
		const sid = await registerSession(baseOpts);

		expect(await revokeSession(sid)).toBe(true);
		expect(await getSession(sid)).toBeNull();
		expect(rawSids()).not.toContain(sid);
	});

	it("删除不存在的会话返回 false，不写库", async () => {
		const sid = await registerSession(baseOpts);

		expect(await revokeSession("nope")).toBe(false);
		// 失败的删除不应影响既有数据
		expect(await getSession(sid)).not.toBeNull();
	});
});

describe("revokeAllExcept", () => {
	it("保留指定 sid 并返回被删数量", async () => {
		const keep = await registerSession({ ...baseOpts, ua: uaOf("keep") });
		const a = await registerSession({ ...baseOpts, ua: uaOf("a") });
		const b = await registerSession({ ...baseOpts, ua: uaOf("b") });

		expect(await revokeAllExcept(keep)).toBe(2);
		expect(await getSession(keep)).not.toBeNull();
		expect(await getSession(a)).toBeNull();
		expect(await getSession(b)).toBeNull();
	});

	it("只有自己一个会话时返回 0 且不误删", async () => {
		const keep = await registerSession(baseOpts);

		expect(await revokeAllExcept(keep)).toBe(0);
		expect(await getSession(keep)).not.toBeNull();
	});
});

describe("touchSession", () => {
	it("60秒内重复 touch 被节流，不产生额外写入", async () => {
		vi.useFakeTimers();
		try {
			const sid = await registerSession(baseOpts);
			const setSpy = vi.spyOn(store, "set");

			await touchSession(sid);
			const firstWrites = setSpy.mock.calls.filter(
				(c) => c[0] === `admin_touch_${sid}`,
			).length;
			expect(firstWrites).toBe(1);

			// 推进到节流窗口内（30 秒）
			vi.advanceTimersByTime(30_000);
			await touchSession(sid);
			const secondWrites = setSpy.mock.calls.filter(
				(c) => c[0] === `admin_touch_${sid}`,
			).length;

			// 节流生效：没有新增写入
			expect(secondWrites).toBe(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("超过节流窗口后允许再次写入", async () => {
		vi.useFakeTimers();
		try {
			const sid = await registerSession(baseOpts);
			await touchSession(sid);

			vi.advanceTimersByTime(61_000);
			await touchSession(sid);

			const stored = store.dump()[`admin_touch_${sid}`];
			expect(typeof stored).toBe("number");
			// 第二次写入的是推进后的时间，而非首次的值
			expect(stored as number).toBeGreaterThan(Date.now() - 61_000);
		} finally {
			vi.useRealTimers();
		}
	});

	it("存储异常时静默失败，不向上抛", async () => {
		vi.spyOn(store, "set").mockRejectedValueOnce(new Error("kv down"));

		// 主流程不应因活跃时间更新失败而中断
		await expect(touchSession("any-sid")).resolves.toBeUndefined();
	});
});

describe("listSessions", () => {
	it("按登录时间倒序排列", async () => {
		vi.useFakeTimers();
		try {
			const first = await registerSession({ ...baseOpts, ua: uaOf("first") });
			vi.advanceTimersByTime(1000);
			const second = await registerSession({ ...baseOpts, ua: uaOf("second") });

			const list = await listSessions();
			expect(list.map((s) => s.sid)).toEqual([second, first]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("过滤过期项并把清理结果落盘", async () => {
		const alive = await registerSession({ ...baseOpts, ua: uaOf("alive") });
		const stale = await registerSession({ ...baseOpts, ua: uaOf("stale") });

		// 同样先注册再改 exp，确保过期记录已进入存储（listSessions 的清理对象）
		await patchRecord(stale, { exp: Date.now() - 1000 });

		const list = await listSessions();

		expect(list.map((s) => s.sid)).toEqual([alive]);
		// 过期项必须已从存储中删除，否则每次列表都要重复过滤
		expect(rawSids()).toEqual([alive]);
	});

	it("空表返回空数组", async () => {
		expect(await listSessions()).toEqual([]);
	});
});

describe("删除竞态防护（verifyDeleted）", () => {
	it("并发写入把会话复活后，revokeSession 仍保证目标已删除", async () => {
		const sid = await registerSession(baseOpts);
		const key = SESSION_PREFIX + sid;
		const snapshot = structuredClone(store.dump()[key]);

		/* 真实竞态时序：revokeSession 删掉键之后，另一台持有旧值的长请求
		   把它写回来。注入点必须在删除之后的第一次读，且该次读要如实
		   反映注入后的状态——否则 verifyDeleted 会看到「已删除」直接返回。 */
		let injected = false;
		const realGet = store.get.bind(store);
		const realSet = store.set.bind(store);
		vi.spyOn(store, "get").mockImplementation(async (k: string) => {
			const value = await realGet(k);
			if (k !== key) return value;
			if (!injected && value === null) {
				injected = true;
				await realSet(k, structuredClone(snapshot));
				return await realGet(k);
			}
			return value;
		});

		expect(await revokeSession(sid)).toBe(true);

		// 注入确实发生，否则本用例测不到任何东西
		expect(injected).toBe(true);
		// verifyDeleted 最多 2 轮，应把复活记录清掉
		expect(await getSession(sid)).toBeNull();
		expect(rawSids()).not.toContain(sid);
	});

	it("无并发写入时 verifyDeleted 不会误删其他会话", async () => {
		const target = await registerSession({ ...baseOpts, ua: uaOf("target") });
		const other = await registerSession({ ...baseOpts, ua: uaOf("other") });

		await revokeSession(target);

		expect(await getSession(target)).toBeNull();
		expect(await getSession(other)).not.toBeNull();
	});
});

/**
 * 一人一键的核心收益：任何写操作都不再整表回写。
 * 旧实现下这两个用例都会失败——第二次写带着「读时」的旧快照，
 * 把并发注册的会话覆盖掉。
 */
describe("并发写入", () => {
	it("两台设备同时登录不会互相覆盖", async () => {
		const realSet = store.set.bind(store);
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let held = false;
		vi.spyOn(store, "set").mockImplementation(
			async (key: string, value: unknown, ttl?: number) => {
				// 卡住先到的写入，让两次注册的读窗口重叠
				if (!held && key.startsWith(SESSION_PREFIX)) {
					held = true;
					await gate;
				}
				return realSet(key, value, ttl);
			},
		);

		const first = registerSession({ ...baseOpts, ua: uaOf("dev1") });
		const second = registerSession({ ...baseOpts, ua: uaOf("dev2") });
		await new Promise((resolve) => setTimeout(resolve, 10));
		release();
		const [sid1, sid2] = await Promise.all([first, second]);

		expect(await getSession(sid1)).not.toBeNull();
		expect(await getSession(sid2)).not.toBeNull();
		expect(rawSids().sort()).toEqual([sid1, sid2].sort());
	});

	it("列表只清理本次列举到的过期会话，不波及期间新注册的", async () => {
		const stale = await registerSession({ ...baseOpts, ua: uaOf("stale") });
		await patchRecord(stale, { exp: Date.now() - 1000 });

		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let armed = true;
		const realList = store.list.bind(store);
		vi.spyOn(store, "list").mockImplementation(
			async (prefix: string, limit?: number) => {
				const keys = await realList(prefix, limit);
				// 列举期间暂停：此刻新落的键不在返回的名单里
				if (armed) {
					armed = false;
					await gate;
				}
				return keys;
			},
		);

		const listing = listSessions();
		const fresh = await registerSession({ ...baseOpts, ua: uaOf("fresh") });
		release();
		await listing;

		expect(await getSession(fresh)).not.toBeNull();
		expect(rawSids()).not.toContain(stale);
	});
});
