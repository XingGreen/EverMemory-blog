/**
 * 会话过期（401）统一处理。
 *
 * 目标：
 *   1. 任意后台接口返回 401 时都能感知，而不必每个调用点各写一遍；
 *   2. 只提示一次 —— 页面加载时往往并发数个请求，若每个都弹窗会叠成一堆；
 *   3. 用户确认后清掉本地凭据并跳转登录页。
 *
 * 实现方式：AdminDashboard 挂载时用 installAuthGuard() 包一层 window.fetch 做旁路
 * 观察（不改写响应），检测到 401 就派发事件；弹窗由 AdminDashboard 渲染。
 * 之所以不在 fetch 里直接弹窗，是因为弹窗需要走组件树。
 */

const AUTH_EXPIRED_EVENT = "admin:auth-expired";

/** 单例闸门：并发请求同时 401 时，只放行第一次 */
let notified = false;

/** fetch 包装是否已安装（防止重复包装叠加） */
let guardInstalled = false;

export function notifyAuthExpired() {
	if (notified) return;
	notified = true;
	window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
}

/** 用户处理完（或重新登录成功）后复位，避免下次会话过期时不弹窗 */
export function resetAuthExpired() {
	notified = false;
}

export function onAuthExpired(handler: () => void): () => void {
	const listener = () => handler();
	window.addEventListener(AUTH_EXPIRED_EVENT, listener);
	return () => window.removeEventListener(AUTH_EXPIRED_EVENT, listener);
}

/** 清掉本地会话痕迹（localStorage 里的令牌 + 可读 cookie） */
export function clearSession() {
	try {
		for (const key of Object.keys(localStorage)) {
			if (/token|session|auth|admin/i.test(key)) localStorage.removeItem(key);
		}
	} catch {
		// 忽略存储不可用
	}
	try {
		for (const part of document.cookie.split(";")) {
			const name = part.split("=")[0]?.trim();
			if (!name) continue;
			if (/token|session|auth|admin/i.test(name)) {
				document.cookie = `${name}=; Max-Age=0; path=/`;
			}
		}
	} catch {
		// 忽略 cookie 不可写
	}
}

/** 清凭据并回登录页（整页跳转，确保组件状态与内存缓存全部重建） */
export function relogin() {
	clearSession();
	resetAuthExpired();
	window.location.href = "/admin/";
}

/**
 * 包一层 fetch，旁路观察 401。
 * 返回卸载函数，AdminDashboard 销毁时还原原始 fetch。
 *
 * 重复调用直接返回空操作：两层包装下卸载只会还原一层，剩下的那层
 * 会捕获一个已卸载组件的回调，HMR 反复热更后越叠越深。
 */
export function installAuthGuard(): () => void {
	if (guardInstalled) return () => {};
	guardInstalled = true;
	const original = window.fetch;
	window.fetch = async (...args) => {
		const res = await original(...args);
		try {
			const url =
				typeof args[0] === "string" ? args[0] : (args[0] as Request).url;
			// 只关心后台接口，避免前台页面/静态资源的 401 误触发
			if (res.status === 401 && url.includes("/api/admin/")) {
				notifyAuthExpired();
			}
		} catch {
			// 观察失败不影响请求本身
		}
		return res;
	};
	return () => {
		window.fetch = original;
		guardInstalled = false;
	};
}
