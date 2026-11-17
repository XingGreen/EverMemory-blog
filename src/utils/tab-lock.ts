/**
 * 后台多标签页路由锁。
 *
 * 同一台设备的多个标签页打开同一路由的后台页面会互相覆盖保存
 * （文章编辑页尤其危险）。这里按精确路由加锁：同路由第二个标签页
 * 被拦截并显示冲突提示；不同路由完全不受影响。
 *
 * 三层机制：
 * 1. localStorage 锁（tabId + 时间戳）：单一事实来源。
 * 2. 心跳续期（3s）：持有者活着就刷新时间戳。
 * 3. BroadcastChannel 握手（probe/alive，400ms 超时）：新标签页遇到
 *    未过期锁时先探测持有者是否存活——存活则拦截自己；无回应
 *    （持有者已关闭）立即抢占，不用等心跳过期。
 *
 * 锁的释放：显式 releaseRoute（路由切换）或 pagehide；崩溃/断电由
 * 心跳过期兜底。bfcache 恢复后由调用方重新尝试加锁。
 */

const LOCK_PREFIX = "em-tab-lock:";
const CHANNEL_NAME = "em-tab-lock";
/** 心跳间隔：持有者每 3s 刷新一次时间戳 */
const HEARTBEAT_MS = 3000;
/** 超过该时长未续期视为持有者已死 */
const STALE_MS = 10_000;
/** 握手等待：持有者回应 alive 的最长时限 */
const HANDSHAKE_MS = 400;

type LockInfo = { tabId: string; ts: number };

let myTabId = "";
let channel: BroadcastChannel | null = null;
/** 当前标签页持有的路由（同一时刻最多一个后台路由） */
let heldRoute = "";
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
/** probe 的 alive 回应监听 */
let aliveWaiters: Array<(route: string) => void> = [];

function myId(): string {
	if (!myTabId) {
		myTabId =
			globalThis.crypto?.randomUUID?.() ?? `tab-${Date.now()}-${Math.random()}`;
	}
	return myTabId;
}

function lockKey(route: string): string {
	return `${LOCK_PREFIX}${route}`;
}

function readLock(route: string): LockInfo | null {
	try {
		const raw = localStorage.getItem(lockKey(route));
		if (!raw) return null;
		const info = JSON.parse(raw) as LockInfo;
		if (typeof info.tabId !== "string" || typeof info.ts !== "number") {
			return null;
		}
		return info;
	} catch {
		return null;
	}
}

function writeLock(route: string) {
	localStorage.setItem(
		lockKey(route),
		JSON.stringify({ tabId: myId(), ts: Date.now() } satisfies LockInfo),
	);
}

function clearLock(route: string, byTabId?: string) {
	const info = readLock(route);
	if (info && byTabId && info.tabId !== byTabId) return;
	localStorage.removeItem(lockKey(route));
}

function isStale(info: LockInfo): boolean {
	return Date.now() - info.ts > STALE_MS;
}

function ensureChannel(): BroadcastChannel | null {
	if (channel) return channel;
	if (typeof BroadcastChannel === "undefined") return null;
	channel = new BroadcastChannel(CHANNEL_NAME);
	channel.onmessage = (event) => {
		const msg = event.data as
			| { type: "probe"; route: string; from: string }
			| { type: "alive"; route: string; from: string }
			| { type: "released"; route: string; from: string }
			| undefined;
		if (!msg || msg.from === myId()) return;
		if (msg.type === "probe") {
			// 我还持有这条路由：立刻回应，阻止对方抢占
			if (msg.route === heldRoute) {
				channel?.postMessage({
					type: "alive",
					route: msg.route,
					from: myId(),
				});
			}
			return;
		}
		if (msg.type === "alive") {
			// 唤醒所有等待该路由 alive 的握手
			aliveWaiters.forEach((w) => w(msg.route));
			aliveWaiters = [];
		}
	};
	return channel;
}

function startHeartbeat() {
	if (heartbeatTimer) return;
	heartbeatTimer = setInterval(() => {
		if (heldRoute) writeLock(heldRoute);
	}, HEARTBEAT_MS);
}

function stopHeartbeat() {
	if (!heartbeatTimer) return;
	clearInterval(heartbeatTimer);
	heartbeatTimer = undefined;
}

function waitHandshake(route: string): Promise<boolean> {
	return new Promise((resolve) => {
		const ch = ensureChannel();
		if (!ch) {
			// 无 BroadcastChannel（极旧浏览器）：退化为纯过期判定
			resolve(false);
			return;
		}
		const timer = setTimeout(() => {
			aliveWaiters = aliveWaiters.filter((w) => w !== waiter);
			resolve(false);
		}, HANDSHAKE_MS);
		const waiter = (aliveRoute: string) => {
			if (aliveRoute !== route) return;
			clearTimeout(timer);
			resolve(true);
		};
		aliveWaiters.push(waiter);
		ch.postMessage({ type: "probe", route, from: myId() });
	});
}

/**
 * 尝试为当前标签页获取一条后台路由的锁。
 * 返回 false 表示同路由已被另一个存活标签页持有（调用方应拦截进入）。
 */
export async function tryLockRoute(route: string): Promise<boolean> {
	const info = readLock(route);
	if (info) {
		if (info.tabId === myId()) {
			// 自己的锁（刷新/回退）：续期即可
			writeLock(route);
			heldRoute = route;
			startHeartbeat();
			return true;
		}
		if (!isStale(info)) {
			// 无 BroadcastChannel 的环境没有协商能力：未过期锁一律拦截，
			// 防止互相覆盖（等过期或持有者释放后再进）。
			if (typeof BroadcastChannel === "undefined") return false;
			// 未过期：握手确认持有者是否真的活着
			const alive = await waitHandshake(route);
			if (alive) return false;
			clearLock(route, info.tabId);
		} else {
			clearLock(route, info.tabId);
		}
	}
	writeLock(route);
	heldRoute = route;
	startHeartbeat();
	return true;
}

/** 释放当前标签页持有的锁（路由切换时调用，无需知道旧路径） */
export function releaseCurrentLock() {
	if (heldRoute) releaseRoute(heldRoute);
}

/** 释放当前持有的路由锁（路由切换 / 页面卸载时调用） */
export function releaseRoute(route: string) {
	if (heldRoute !== route) return;
	heldRoute = "";
	clearLock(route, myId());
	stopHeartbeat();
	ensureChannel()?.postMessage({ type: "released", route });
}

/** 页面卸载兜底：释放全部由本标签页持有的锁 */
export function releaseAllLocks() {
	if (heldRoute) releaseRoute(heldRoute);
}

/** 供测试与调试：当前持有者信息（可能为 null） */
export function peekLock(route: string): LockInfo | null {
	return readLock(route);
}

/** 仅供测试：重置模块级状态 */
export function _resetForTest() {
	stopHeartbeat();
	heldRoute = "";
	myTabId = "";
	aliveWaiters = [];
}
