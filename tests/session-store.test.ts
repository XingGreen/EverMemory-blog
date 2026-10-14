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
	revokeSessionsByIp,
	touchSession,
} = await import("@utils/session-store");

const SESSIONS_KEY = "admin_sessions";

/** 读取内存双工里存的原始会话表，避免经由被测函数自证正确 */
function rawTable(): Record<string, { exp: number; lastSeenAt: number }> {
	return (store.dump()[SESSIONS_KEY] ?? {}) as Record<
		string,
		{ exp: number; lastSeenAt: number }
	>;
}

const baseOpts = {
	username: "admin",
	ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0",
	ip: "127.0.0.1",
	maxAgeSeconds: 3600,
	remember: false,
};

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
			describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0"),
		).toBe("Chrome · Windows 10/11");
		expect(
			describeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15"),
		).toBe("Safari · macOS");
		expect(
			describeDevice("Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0"),
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
			describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148"),
		).toBe("未知浏览器 · iOS（移动端）");
		expect(
			describeDevice("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Mobile/15E148"),
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
		const keep = await registerSession(baseOpts);

		// 先正常注册，再把exp 改到过去——这样下一次注册时的清理逻辑
		// 才会遇到它。不能直接用 maxAgeSeconds: -1 注册：那会让该记录
		// 在「清理之后」才写入，测试不到清理分支。
		const stale = await registerSession(baseOpts);
		const table = store.dump()[SESSIONS_KEY] as Record<
			string,
			{ exp: number }
		>;
		table[stale].exp = Date.now() - 1000;
		await store.set(SESSIONS_KEY, table);

		// 下一次注册触发清理
		await registerSession(baseOpts);

		const remaining = Object.keys(rawTable());
		expect(remaining).toContain(keep);
		expect(remaining).not.toContain(stale);
	});
});

describe("getSession", () => {
	it("不存在的 sid 返回 null", async () => {
		expect(await getSession("never-existed")).toBeNull();
	});

	it("过期会话返回 null，但本函数不负责清理表中记录", async () => {
		const sid = await registerSession(baseOpts);
		const table = store.dump()[SESSIONS_KEY] as Record<string, { exp: number }>;
		table[sid].exp = Date.now() - 1000;
		await store.set(SESSIONS_KEY, table);

		expect(await getSession(sid)).toBeNull();
		// 清理职责在 registerSession / listSessions，getSession 只做判定；
		// 若这里顺带删除，会与「踢下线」的并发删除形成额外竞态。
		expect(Object.keys(rawTable())).toContain(sid);
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
		expect(Object.keys(rawTable())).not.toContain(sid);
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
		const keep = await registerSession(baseOpts);
		const a = await registerSession(baseOpts);
		const b = await registerSession(baseOpts);

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

describe("revokeSessionsByIp", () => {
	it("删除该 IP 的全部会话并返回数量，其他 IP 不受影响", async () => {
		const a = await registerSession(baseOpts);
		const b = await registerSession(baseOpts);
		const other = await registerSession({ ...baseOpts, ip: "9.9.9.9" });

		expect(await revokeSessionsByIp("127.0.0.1")).toBe(2);
		expect(await getSession(a)).toBeNull();
		expect(await getSession(b)).toBeNull();
		expect(await getSession(other)).not.toBeNull();
	});

	it("无匹配会话时返回 0 且不误删", async () => {
		const sid = await registerSession(baseOpts);

		expect(await revokeSessionsByIp("8.8.8.8")).toBe(0);
		expect(await getSession(sid)).not.toBeNull();
	});

	it("空 IP 返回 0，不误删 ip 为空的会话", async () => {
		const sid = await registerSession({ ...baseOpts, ip: "" });

		expect(await revokeSessionsByIp("")).toBe(0);
		expect(await getSession(sid)).not.toBeNull();
	});
});

describe("touchSession", () => {
	it("60秒内重复 touch 被节流，不产生额外写入", async () => {
		vi.useFakeTimers();
		try {
			const sid = await registerSession(baseOpts);
			const setSpy = vi.spyOn(store, "set");

			await touchSession(sid);
			const firstWrites = setSpy.mock.calls.filter((c) => c[0] === `admin_touch_${sid}`).length;
			expect(firstWrites).toBe(1);

			// 推进到节流窗口内（30 秒）
			vi.advanceTimersByTime(30_000);
			await touchSession(sid);
			const secondWrites = setSpy.mock.calls.filter((c) => c[0] === `admin_touch_${sid}`).length;

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
			const first = await registerSession(baseOpts);
			vi.advanceTimersByTime(1000);
			const second = await registerSession(baseOpts);

			const list = await listSessions();
			expect(list.map((s) => s.sid)).toEqual([second, first]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("过滤过期项并把清理结果落盘", async () => {
		const alive = await registerSession(baseOpts);
		const stale = await registerSession(baseOpts);

		// 同样先注册再改 exp，确保过期记录已进入表内（listSessions 的清理对象）
		const table = store.dump()[SESSIONS_KEY] as Record<string, { exp: number }>;
		table[stale].exp = Date.now() - 1000;
		await store.set(SESSIONS_KEY, table);

		const list = await listSessions();

		expect(list.map((s) => s.sid)).toEqual([alive]);
		// 过期项必须已从表中删除，否则每次列表都要重复过滤
		expect(Object.keys(rawTable())).toEqual([alive]);
	});

	it("空表返回空数组", async () => {
		expect(await listSessions()).toEqual([]);
	});
});

describe("删除竞态防护（verifyDeleted）", () => {
	it("写回旧快照复活会话后，revokeSession 仍保证目标已删除", async () => {
		const sid = await registerSession(baseOpts);
		const snapshot = structuredClone(rawTable());

		// 真实竞态时序：revokeSession「读表→删除→整表写回」完成后，
		// 并发请求以旧快照写回，把会话复活；随后 verifyDeleted 的
		// 重读会看到复活记录并再删一次。
		//
		// 注入点必须在「主流程写回之后」的那次读（即 verifyDeleted 的首次读），
		// 且这次读要如实反映注入后的状态——否则 verifyDeleted 会因
		// 看到「已删除」而直接返回，用例假绿（这正是初版写错的地方）。
		let injected = false;
		const realGet = store.get.bind(store);
		const realSet = store.set.bind(store);
		vi.spyOn(store, "get").mockImplementation(async (key: string) => {
			const value = await realGet(key);
			if (key !== SESSIONS_KEY) return value;

			const table = value as Record<string, unknown> | null;
			// 主流程已把 sid 从表里删掉，此时并发写回旧快照
			if (!injected && table && !(sid in table)) {
				injected = true;
				await realSet(SESSIONS_KEY, structuredClone(snapshot));
				return await realGet(key);
			}
			return value;
		});

		expect(await revokeSession(sid)).toBe(true);

		// 注入确实发生，否则本用例测不到任何东西
		expect(injected).toBe(true);
		// verifyDeleted 最多 2 轮，应把复活记录清掉
		expect(await getSession(sid)).toBeNull();
		expect(Object.keys(rawTable())).not.toContain(sid);
	});

	it("无并发写入时 verifyDeleted 不会误删其他会话", async () => {
		const target = await registerSession(baseOpts);
		const other = await registerSession(baseOpts);

		await revokeSession(target);

		expect(await getSession(target)).toBeNull();
		expect(await getSession(other)).not.toBeNull();
	});
});