import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	clearLoggedOut,
	isLoggedOut,
	markLoggedOut,
	shouldAutoEnter,
} from "@/utils/auth-expired";

/** node 环境没有 sessionStorage，这里给一个内存版，行为和浏览器一致 */
const memory = {
	store: new Map<string, string>(),
	getItem(key: string) {
		return this.store.has(key) ? (this.store.get(key) as string) : null;
	},
	setItem(key: string, value: string) {
		this.store.set(key, String(value));
	},
	removeItem(key: string) {
		this.store.delete(key);
	},
	clear() {
		this.store.clear();
	},
};

beforeEach(() => {
	memory.clear();
	(globalThis as unknown as { sessionStorage: typeof memory }).sessionStorage =
		memory;
});

afterEach(() => {
	memory.clear();
});

describe("退出登录与登录页的判定", () => {
	/* 首次配置已拆成独立的 /setup/ 页，会话接口只在真登录时回 success，
	   不再有「引导模式假会话」这种 success 但没登录的状态。 */

	it("有会话就自动进入后台", () => {
		expect(shouldAutoEnter({ success: true })).toBe(true);
	});

	it("刚退出过也不影响真会话判定（退出标记只服务于后台内的草稿/bfcache）", () => {
		markLoggedOut();
		expect(isLoggedOut()).toBe(true);
		expect(shouldAutoEnter({ success: true })).toBe(true);
	});

	it("会话无效时一律停在登录页", () => {
		markLoggedOut();
		expect(shouldAutoEnter({ success: false })).toBe(false);
		clearLoggedOut();
		expect(shouldAutoEnter({ success: false })).toBe(false);
	});

	it("退出标记可标记、可清除", () => {
		markLoggedOut();
		expect(isLoggedOut()).toBe(true);
		clearLoggedOut();
		expect(isLoggedOut()).toBe(false);
	});
});
