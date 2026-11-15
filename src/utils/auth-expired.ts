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

/**
 * 「用户主动退出」标记。
 *
 * 退出后用于拦住仍停留在后台标签页里的敏感操作（如 PostEditor 的未保存草稿
 * 提示）与 bfcache 恢复，避免用户刚退出就被这些残留界面拉回后台。
 * 显式登录成功时由 clearLoggedOut 清除。
 */
const LOGOUT_FLAG = "admin_logged_out";

export function markLoggedOut(): void {
	try {
		sessionStorage.setItem(LOGOUT_FLAG, "1");
	} catch {
		// 存储不可用时退化为「不记忆」，最坏情况是退出后又自动进一次
	}
}

export function isLoggedOut(): boolean {
	try {
		return sessionStorage.getItem(LOGOUT_FLAG) === "1";
	} catch {
		return false;
	}
}

/** 显式登录成功后调用：恢复「进后台即视为已登录」的行为 */
export function clearLoggedOut(): void {
	try {
		sessionStorage.removeItem(LOGOUT_FLAG);
	} catch {
		// 忽略
	}
}

/**
 * 登录页是否应当自动进入后台：服务端确认有会话即可。
 *
 * 会话接口只在真登录时回 success——首次配置已拆成独立的 /setup/ 页，
 * 不再有「success 但没登录」的伪会话，因此这里不需要再区分引导态。
 * 退出标记留给 PostEditor / bfcache 等场景，不再参与登录页判定。
 */
export function shouldAutoEnter(session: { success?: boolean }): boolean {
	return Boolean(session.success);
}

/**
 * 退出过程中屏蔽 401 弹窗。
 * 退出本身会删 Cookie，其间任何后台请求都可能 401；若照常弹「会话已过期」，
 * 用户点了「重新登录」又回到后台，又是一轮回弹。
 */
let suppressDepth = 0;

export function suppressAuthExpired(): void {
	suppressDepth += 1;
}

export function resumeAuthExpired(): void {
	suppressDepth = Math.max(0, suppressDepth - 1);
}

/** 单例闸门：并发请求同时 401 时，只放行第一次 */
let notified = false;

/** fetch 包装是否已安装（防止重复包装叠加） */
let guardInstalled = false;

export function notifyAuthExpired() {
	if (notified || suppressDepth > 0) return;
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

/**
 * 清凭据并回登录页（整页跳转，确保组件状态与内存缓存全部重建）。
 *
 * 目标是 /login/ 而不是 /admin/：会话若确实失效，回 /admin/ 会立刻再吃一次
 * 401，弹窗跟着再来一遍。不写退出标记——这不是用户主动退出，会话若只是
 * 瞬时抖动，登录页的会话探测会自动把用户送回后台。
 */
export function relogin() {
	clearSession();
	resetAuthExpired();
	window.location.replace("/login/");
}

/**
 * 退出登录的唯一实现：标记 → 清本地 → 清服务端 Cookie → 回登录页。
 *
 * 顺序不能反：先写标记再删 Cookie，两个请求之间若有人跳到后台也不会被
 * 引导模式接回去；Cookie 清理失败也必须继续跳转，否则用户卡在空页。
 */
export async function logout(): Promise<void> {
	markLoggedOut();
	suppressAuthExpired();
	clearSession();
	try {
		sessionStorage.removeItem("admin_verified");
		sessionStorage.removeItem("admin_redirect");
	} catch {
		// 忽略
	}
	try {
		await fetch("/api/admin/verify/", {
			method: "DELETE",
			keepalive: true,
			signal: AbortSignal.timeout(3000),
		});
	} catch {
		// 网络异常或超时也要离开：本地标记已经在，刷新不会再进后台
	}
	resumeAuthExpired();
	window.location.replace("/login/");
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
