import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * tab-lock 的核心判定逻辑。jsdom 的 BroadcastChannel 无法跨实例传递，
 * 因此所有用例 stub 掉它走「无 BC → 握手视为无回应 → 立即抢占」的退化
 * 路径；跨标签页的实时握手（probe/alive）依赖真实浏览器，由手动双开
 * 标签页验证。
 */

let mockStore: Record<string, string>;
let nowMs: number;

/** 模拟一个全新的标签页上下文（新 tabId + 模块状态重置） */
async function freshTab(id: string) {
	vi.stubGlobal("crypto", { randomUUID: () => id });
	const mod = await import("../src/utils/tab-lock");
	mod._resetForTest();
	return mod;
}

beforeEach(() => {
	mockStore = {};
	nowMs = 1_700_000_000_000;
	// 去掉 BroadcastChannel：jsdom 实例间不互通，握手必超时，测不到退化路径
	vi.stubGlobal("BroadcastChannel", undefined);
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: {
			getItem: (k: string) => mockStore[k] ?? null,
			setItem: (k: string, v: string) => (mockStore[k] = v),
			removeItem: (k: string) => delete mockStore[k],
		},
	});
	vi.useFakeTimers();
	vi.setSystemTime(nowMs);
});

describe("tab-lock", () => {
	it("无锁时直接占用并写入时间戳", async () => {
		const { tryLockRoute, peekLock } = await freshTab("tab-A");
		const ok = await tryLockRoute("/admin/posts/edit/abc");
		expect(ok).toBe(true);
		const info = peekLock("/admin/posts/edit/abc");
		expect(info?.tabId).toBe("tab-A");
		expect(info?.ts).toBe(nowMs);
	});

	it("同标签页重复进入：续期而不是拦截", async () => {
		const { tryLockRoute } = await freshTab("tab-A");
		expect(await tryLockRoute("/admin/posts/edit/abc")).toBe(true);
		vi.setSystemTime(nowMs + 5000);
		expect(await tryLockRoute("/admin/posts/edit/abc")).toBe(true);
	});

	it("未过期且持有者无回应：拦截新标签页", async () => {
		await freshTab("tab-A");
		const a = await freshTab("tab-A");
		expect(await a.tryLockRoute("/admin/posts/edit/abc")).toBe(true);
		// 另一个标签页进入同路由：无 BC 握手视为「持有者无回应前的默认拦截」
		const b = await freshTab("tab-B");
		vi.setSystemTime(nowMs + 1000);
		expect(await b.tryLockRoute("/admin/posts/edit/abc")).toBe(false);
	});

	it("过期锁（持有者已死）：允许抢占", async () => {
		await freshTab("tab-A");
		const a = await freshTab("tab-A");
		expect(await a.tryLockRoute("/admin/posts/edit/abc")).toBe(true);
		const b = await freshTab("tab-B");
		vi.setSystemTime(nowMs + 10_001);
		expect(await b.tryLockRoute("/admin/posts/edit/abc")).toBe(true);
		expect(b.peekLock("/admin/posts/edit/abc")?.tabId).toBe("tab-B");
	});

	it("释放锁：新标签页立即可进，无需等过期", async () => {
		await freshTab("tab-A");
		const a = await freshTab("tab-A");
		expect(await a.tryLockRoute("/admin/")).toBe(true);
		a.releaseRoute("/admin/");
		expect(mockStore["em-tab-lock:/admin/"]).toBeUndefined();
		const b = await freshTab("tab-B");
		expect(await b.tryLockRoute("/admin/")).toBe(true);
	});

	it("不同路由互不影响", async () => {
		await freshTab("tab-A");
		const a = await freshTab("tab-A");
		expect(await a.tryLockRoute("/admin/posts/edit/abc")).toBe(true);
		expect(await a.tryLockRoute("/admin/settings/site/")).toBe(true);
		expect(a.peekLock("/admin/posts/edit/abc")?.tabId).toBe("tab-A");
		expect(a.peekLock("/admin/settings/site/")?.tabId).toBe("tab-A");
	});
});
