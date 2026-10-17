<script lang="ts">
import { onMount } from "svelte";
import VerifyScreen from "./VerifyScreen.svelte";

let { avatarUrl = "" }: { avatarUrl?: string } = $props();

let view = $state<"loading" | "login">("loading");
let oauthEnabled = $state(false);
let breakglassEnabled = $state(false);

function enterDashboard(target?: string) {
	sessionStorage.setItem("admin_verified", "true");
	// 后台主体是独立页面，登录成功后整页跳转，登录页的代码不再携带后台。
	// 若未登录时访问过后台深链（/admin/dashboard/settings/…），登录后回跳原目标。
	const dest =
		target || sessionStorage.getItem("admin_redirect") || "/admin/dashboard/";
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
