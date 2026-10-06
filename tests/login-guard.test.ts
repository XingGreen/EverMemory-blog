import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryStore } from "./helpers/memory-store";

// getStore 是模块级单例，替换其返回值即可让 login-guard 走内存后端。
// 被测代码本身完全真实执行，只有存储边界被替换。
const store = createMemoryStore();
vi.mock("@utils/persist-store", async (importOriginal) => ({
	...(await importOriginal<typeof import("@utils/persist-store")>()),
	getStore: () => store,
	isKvBackend: () => false,
}));

/**
 * login-guard 持有模块级的进程内降级副本（memoryFallback / attemptFallback），
 * 故障降级测试会写入它并污染后续用例，因此每个用例都重新导入一份全新模块。
 */
async function loadGuard() {
	vi.resetModules();
	return await import("@utils/login-guard");
}

const LOCK_KEY = "admin_login_lock";
const ATTEMPT_KEY = "admin_login_attempts";

const T0 = Date.parse("2026-01-01T00:00:00.000Z");

beforeEach(() => {
	for (const key of Object.keys(store.dump())) {
		void store.del(key);
	}
	vi.setSystemTime(T0);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

/** 直接读内存双工里的原始状态，避免用被测函数自证正确 */
function rawLock(): Record<string, { failures: number; lockedUntil: number }> {
	return (store.dump()[LOCK_KEY] ?? {}) as Record<
		string,
		{ failures: number; lockedUntil: number }
	>;
}

function rawAttempts(): Record<string, { count: number; windowStart: number }> {
	return (store.dump()[ATTEMPT_KEY] ?? {}) as Record<
		string,
		{ count: number; windowStart: number }
	>;
}

describe("getClientIp", () => {
	it("优先取 CF 注入的直连 IP", async () => {
		const { getClientIp } = await loadGuard();
		const req = new Request("https://x/", {
			headers: { "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" },
		});
		expect(getClientIp(req)).toBe("1.1.1.1");
	});

	it("无 CF 头时取 X-Forwarded-For 首项", async () => {
		const { getClientIp } = await loadGuard();
		const req = new Request("https://x/", {
			headers: { "x-forwarded-for": "3.3.3.3, 4.4.4.4" },
		});
		expect(getClientIp(req)).toBe("3.3.3.3");
	});

	it("两者皆无时退化为 unknown，所有直连客户端共享同一桶", async () => {
		const { getClientIp } = await loadGuard();
		expect(getClientIp(new Request("https://x/"))).toBe("unknown");
	});
});

describe("固定窗口频次闸门", () => {
	it("无历史记录时不受限", async () => {
		const guard = await loadGuard();
		expect(await guard.checkAttemptRate("1.1.1.1")).toEqual({
			limited: false,
			retryAfterSeconds: 0,
		});
	});

	it("窗口内未达上限时持续放行，且计数逐次递增", async () => {
		const guard = await loadGuard();
		for (let i = 1; i <= 9; i++) {
			await guard.registerAttempt("1.1.1.1");
			expect(await guard.attemptCount("1.1.1.1")).toBe(i);
			expect((await guard.checkAttemptRate("1.1.1.1")).limited).toBe(false);
		}
	});

	it("达到第 10 次后转为受限，并给出窗口剩余秒数", async () => {
		const guard = await loadGuard();
		for (let i = 0; i < 10; i++) await guard.registerAttempt("1.1.1.1");

		const limited = await guard.checkAttemptRate("1.1.1.1");
		expect(limited.limited).toBe(true);
		expect(limited.retryAfterSeconds).toBe(60);
	});

	it("与成败无关：成功登录也会消耗窗口额度", async () => {
		const guard = await loadGuard();
		// 模拟「密码正确」但未调用 clearAttempts 的路径
		for (let i = 0; i < 10; i++) await guard.registerAttempt("1.1.1.1");
		expect((await guard.checkAttemptRate("1.1.1.1")).limited).toBe(true);
	});

	it("窗口过期后重新计数，不追溯历史", async () => {
		const guard = await loadGuard();
		for (let i = 0; i < 10; i++) await guard.registerAttempt("1.1.1.1");
		expect((await guard.checkAttemptRate("1.1.1.1")).limited).toBe(true);

		vi.setSystemTime(T0 + 60_000);
		expect(await guard.checkAttemptRate("1.1.1.1")).toEqual({
			limited: false,
			retryAfterSeconds: 0,
		});
		expect(await guard.attemptCount("1.1.1.1")).toBe(0);

		// 过期后再记一次应开启新窗口，计数回到 1 而非 11
		await guard.registerAttempt("1.1.1.1");
		expect(rawAttempts()["1.1.1.1"].count).toBe(1);
		expect(rawAttempts()["1.1.1.1"].windowStart).toBe(T0 + 60_000);
	});

	it("剩余秒数随窗口推进递减", async () => {
		const guard = await loadGuard();
		for (let i = 0; i < 10; i++) await guard.registerAttempt("1.1.1.1");

		vi.setSystemTime(T0 + 25_000);
		expect((await guard.checkAttemptRate("1.1.1.1")).retryAfterSeconds).toBe(35);
	});

	it("不同 IP 各自独立计数", async () => {
		const guard = await loadGuard();
		for (let i = 0; i < 10; i++) await guard.registerAttempt("1.1.1.1");
		expect((await guard.checkAttemptRate("1.1.1.1")).limited).toBe(true);
		expect((await guard.checkAttemptRate("9.9.9.9")).limited).toBe(false);
	});

	it("clearAttempts 清空该 IP 的窗口计数", async () => {
		const guard = await loadGuard();
		for (let i = 0; i < 10; i++) await guard.registerAttempt("1.1.1.1");
		await guard.clearAttempts("1.1.1.1");
		expect(rawAttempts()["1.1.1.1"]).toBeUndefined();
		expect((await guard.checkAttemptRate("1.1.1.1")).limited).toBe(false);
	});

	it("成功登录后同 IP 可立即再次尝试", async () => {
		const guard = await loadGuard();
		// 9 次失败逼近上限，再一次成功
		for (let i = 0; i < 9; i++) await guard.registerAttempt("1.1.1.1");
		await guard.registerAttempt("1.1.1.1");
		await guard.clearAttempts("1.1.1.1");
		await guard.registerAttempt("1.1.1.1");
		expect(rawAttempts()["1.1.1.1"].count).toBe(1);
		expect((await guard.checkAttemptRate("1.1.1.1")).limited).toBe(false);
	});

	it("窗口状态与锁定状态使用不同的存储键，互不覆盖", async () => {
		const guard = await loadGuard();
		for (let i = 0; i < 10; i++) await guard.registerAttempt("1.1.1.1");
		await guard.registerFailure("1.1.1.1");
		expect(Object.keys(store.dump()).sort()).toEqual([ATTEMPT_KEY, LOCK_KEY]);
	});
});

describe("失败计数锁定", () => {
	it("阈值前不锁定", async () => {
		const guard = await loadGuard();
		for (let i = 0; i < 4; i++) {
			const info = await guard.registerFailure("1.1.1.1");
			expect(info.locked).toBe(false);
		}
		expect((await guard.checkLockout("1.1.1.1")).locked).toBe(false);
	});

	it("第 5 次失败触发锁定，基础 30 秒", async () => {
		const guard = await loadGuard();
		for (let i = 0; i < 4; i++) await guard.registerFailure("1.1.1.1");
		const info = await guard.registerFailure("1.1.1.1");
		expect(info.locked).toBe(true);
		expect(info.failures).toBe(5);
		expect(info.retryAfterSeconds).toBe(30);
	});

	it("锁定时长随失败次数指数增长", async () => {
		const guard = await loadGuard();
		for (let i = 0; i < 6; i++) await guard.registerFailure("1.1.1.1");
		expect(rawLock()["1.1.1.1"].lockedUntil).toBe(T0 + 60_000);

		for (let i = 0; i < 1; i++) await guard.registerFailure("1.1.1.1");
		expect(rawLock()["1.1.1.1"].lockedUntil).toBe(T0 + 120_000);
	});

	it("锁定时长封顶 30 分钟", async () => {
		const guard = await loadGuard();
		// 第 5 次 30s，每次翻倍：第 11 次起达到 30*2^6 = 1920s 并封顶
		for (let i = 0; i < 12; i++) await guard.registerFailure("1.1.1.1");
		expect(rawLock()["1.1.1.1"].lockedUntil).toBe(T0 + 30 * 60 * 1000);
	});

	it("锁定期间 checkLockout 持续返回剩余秒数并递减", async () => {
		const guard = await loadGuard();
		for (let i = 0; i < 5; i++) await guard.registerFailure("1.1.1.1");
		expect((await guard.checkLockout("1.1.1.1")).retryAfterSeconds).toBe(30);

		vi.setSystemTime(T0 + 10_000);
		expect((await guard.checkLockout("1.1.1.1")).retryAfterSeconds).toBe(20);
	});

	it("锁定到期后自动解除", async () => {
		const guard = await loadGuard();
		for (let i = 0; i < 5; i++) await guard.registerFailure("1.1.1.1");
		vi.setSystemTime(T0 + 31_000);
		expect(await guard.checkLockout("1.1.1.1")).toEqual({
			locked: false,
			retryAfterSeconds: 0,
		});
	});

	it("clearFailures 清空失败计数", async () => {
		const guard = await loadGuard();
		for (let i = 0; i < 5; i++) await guard.registerFailure("1.1.1.1");
		await guard.clearFailures("1.1.1.1");
		expect(await guard.failureCount("1.1.1.1")).toBe(0);
		expect((await guard.checkLockout("1.1.1.1")).locked).toBe(false);
	});

	it("成功登录后失败计数与窗口计数同时归零", async () => {
		const guard = await loadGuard();
		for (let i = 0; i < 4; i++) {
			await guard.registerFailure("1.1.1.1");
			await guard.registerAttempt("1.1.1.1");
		}
		await guard.clearFailures("1.1.1.1");
		await guard.clearAttempts("1.1.1.1");
		expect(await guard.failureCount("1.1.1.1")).toBe(0);
		expect(await guard.attemptCount("1.1.1.1")).toBe(0);
	});

	it("锁定过期恰好满 1 小时：不清扫，失败数继续累计", async () => {
		const guard = await loadGuard();
		for (let i = 0; i < 5; i++) await guard.registerFailure("1.1.1.1");
		// 第 5 次把 lockedUntil 设为 T0+30s；清扫条件是「过期后超过 1 小时」
		// 的严格大于，此刻恰好等于 1 小时，不应触发
		vi.setSystemTime(T0 + 30_000 + 3_600_000);
		await guard.registerFailure("1.1.1.1");
		expect(rawLock()["1.1.1.1"].failures).toBe(6);
	});

	it("锁定过期超过 1 小时：记录被清扫，从 1 重新累计", async () => {
		const guard = await loadGuard();
		for (let i = 0; i < 5; i++) await guard.registerFailure("1.1.1.1");
		// 比上一个用例多推进 1 毫秒，越过严格大于的边界
		vi.setSystemTime(T0 + 30_000 + 3_600_001);
		await guard.registerFailure("1.1.1.1");
		expect(rawLock()["1.1.1.1"].failures).toBe(1);
	});

	it("清扫后锁定状态一并归零：计数不足阈值即不再锁定", async () => {
		const guard = await loadGuard();
		for (let i = 0; i < 5; i++) await guard.registerFailure("1.1.1.1");
		vi.setSystemTime(T0 + 30_000 + 3_600_001);
		await guard.registerFailure("1.1.1.1");
		// 清扫后重新从 1 起步，未达阈值故不进入锁定（lockedUntil 归零）
		expect(rawLock()["1.1.1.1"].failures).toBe(1);
		expect(rawLock()["1.1.1.1"].lockedUntil).toBe(0);
		expect((await guard.checkLockout("1.1.1.1")).locked).toBe(false);
	});

	it("未锁定过的记录不会被清扫，失败数持续累计", async () => {
		const guard = await loadGuard();
		for (let i = 0; i < 3; i++) await guard.registerFailure("1.1.1.1");
		vi.setSystemTime(T0 + 86_400_000);
		await guard.registerFailure("1.1.1.1");
		expect(rawLock()["1.1.1.1"].failures).toBe(4);
	});

	it("两层独立：失败锁定不释放窗口额度，反之亦然", async () => {
		const guard = await loadGuard();
		// 清掉失败计数不应重置窗口计数
		for (let i = 0; i < 4; i++) await guard.registerAttempt("1.1.1.1");
		await guard.clearFailures("1.1.1.1");
		expect(await guard.attemptCount("1.1.1.1")).toBe(4);
	});
});

describe("存储不可用时的降级", () => {
	it("写入失败仍更新进程内副本，后续请求继续受保护", async () => {
		const guard = await loadGuard();
		vi.spyOn(store, "set").mockRejectedValue(new Error("KV down"));
		vi.spyOn(store, "get").mockRejectedValue(new Error("KV down"));
		// biome-ignore lint/suspicious/noConsole: 降级告警是预期输出
		vi.spyOn(console, "warn").mockImplementation(() => {});

		for (let i = 0; i < 10; i++) await guard.registerAttempt("1.1.1.1");
		// 存储不可读，但进程内副本仍有计数，防护不失效
		expect((await guard.checkAttemptRate("1.1.1.1")).limited).toBe(true);
	});

	it("getClientIp 在降级路径上仍可工作", async () => {
		const guard = await loadGuard();
		expect(guard.getClientIp(new Request("https://x/"))).toBe("unknown");
	});
});