<script lang="ts">
import { onMount } from "svelte";
import { clearLoggedOut, shouldAutoEnter } from "@/utils/auth-expired";
import VerifyScreen from "./VerifyScreen.svelte";

let { avatarUrl = "" }: { avatarUrl?: string } = $props();

let view = $state<"loading" | "login">("loading");
let oauthEnabled = $state(false);
let breakglassEnabled = $state(false);

function enterDashboard(target?: string) {
	// 只有真正登录成功才恢复「进后台即视为已登录」，退出标记到此才失效
	clearLoggedOut();
	sessionStorage.setItem("admin_verified", "true");
	// 后台主体是独立页面，登录成功后整页跳转，登录页的代码不再携带后台。
	// 若未登录时访问过后台深链（/admin/settings/…），登录后回跳原目标。
	const dest = target || sessionStorage.getItem("admin_redirect") || "/admin/";
	sessionStorage.removeItem("admin_redirect");
	window.location.replace(dest);
}

function handleVerify(success: boolean) {
	if (success) enterDashboard();
}

onMount(async () => {
	// 始终以服务端会话为准，不盲信 admin_verified 本地标记：Cookie 失效
	//（过期 / 被踢 / 换设备）后标记可能残留，若据此直接进入后台，会与后台页
	// 的未授权回跳互相触发，形成「登录页 ↔ 后台」回弹死循环。
	try {
		const res = await fetch("/api/admin/session/");
		const data = await res.json();
		oauthEnabled = Boolean(data.oauthEnabled);
		breakglassEnabled = Boolean(data.breakglassEnabled);
		if (data.success) {
			/* 退出与引导模式的冲突点：密钥没配齐时，服务端对回环请求也回 success，
			   它表示「允许未登录改配置」，不是「你已登录」。照旧自动进后台，用户
			   点完退出就被弹回来，表现为退不出去。
			   真会话（有 Cookie、非 bootstrap）则照常进入，退出过一次不会把人锁在门外。 */
			if (!shouldAutoEnter(data)) {
				sessionStorage.removeItem("admin_verified");
				sessionStorage.removeItem("admin_redirect");
				view = "login";
				return;
			}
			sessionStorage.setItem("admin_verified", "true");
			enterDashboard();
			return;
		}
		// 明确的未授权：清除残留标记与深链，避免与后台页反复互跳
		sessionStorage.removeItem("admin_verified");
		sessionStorage.removeItem("admin_redirect");
	} catch {
		// 网络异常时留在登录页（保留标记，等待用户重试）
	}
	view = "login";
});
</script>

{#if view === "loading"}
	<div class="login-loading"></div>
{:else}
	<VerifyScreen {avatarUrl} onVerify={handleVerify} {oauthEnabled} {breakglassEnabled} />
{/if}

<style>
	.login-loading {
		min-height: 50vh;
	}
</style>
