import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 审计记录在 serverless 下最典型的失效方式：写入被 fire-and-forget，
 * 响应一返回进程就把未完成的 promise 掐掉，记录静默消失。
 * 这里断言的是「函数返回时写入已经完成」，不是实现细节。
 */
let writeResolves = false;
let writeRejects = false;

vi.mock("@utils/persist-store", () => ({
	getStore: () => ({
		set: async () => {
			// 模拟一次真实的异步落盘（KV 往返）
			await new Promise((resolve) => setTimeout(resolve, 20));
			if (writeRejects) throw new Error("kv down");
			writeResolves = true;
		},
	}),
}));

const { writeAuditLog } = await import("@utils/audit-log");

const entry = {
	event: "login_failure" as const,
	client: "127.0.0.1",
	username: "admin",
};

beforeEach(() => {
	writeResolves = false;
	writeRejects = false;
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("writeAuditLog", () => {
	it("返回时持久化已完成，不留悬挂 promise", async () => {
		await writeAuditLog(entry);

		// fire-and-forget 实现下这里会是 false：函数早就返回了
		expect(writeResolves).toBe(true);
	});

	it("存储失败只告警，不向调用方抛错", async () => {
		writeRejects = true;

		await expect(writeAuditLog(entry)).resolves.toBeUndefined();
		expect(console.warn).toHaveBeenCalled();
	});
});
