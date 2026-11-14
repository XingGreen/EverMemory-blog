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
	it("没退出过：引导模式的假会话也自动进入（首次配置路径）", () => {
		expect(shouldAutoEnter({ success: true, bootstrap: true })).toBe(true);
	});

	it("刚退出过：引导模式的假会话不再把人送回后台", () => {
		markLoggedOut();
		expect(isLoggedOut()).toBe(true);
		expect(shouldAutoEnter({ success: true, bootstrap: true })).toBe(false);
	});

	it("刚退出过：真会话仍然放行，不会锁在门外", () => {
		markLoggedOut();
		expect(shouldAutoEnter({ success: true })).toBe(true);
	});

	it("会话无效时一律停在登录页", () => {
		markLoggedOut();
		expect(shouldAutoEnter({ success: false })).toBe(false);
		clearLoggedOut();
		expect(shouldAutoEnter({ success: false })).toBe(false);
	});

	it("显式登录成功后退出标记失效", () => {
		markLoggedOut();
		clearLoggedOut();
		expect(isLoggedOut()).toBe(false);
		expect(shouldAutoEnter({ success: true, bootstrap: true })).toBe(true);
	});
});
