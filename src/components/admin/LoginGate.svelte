<script lang="ts">
import { onMount } from "svelte";
import SetupScreen from "./SetupScreen.svelte";
import VerifyScreen from "./VerifyScreen.svelte";

let { avatarUrl = "" }: { avatarUrl?: string } = $props();

// "loading" | "setup"（未初始化，需要创建管理员） | "login"（正常登录）
let view = $state<"loading" | "setup" | "login">("loading");
let defaultUsername = $state("admin");
let tokenRequired = $state(true);
let writable = $state(true);

function enterDashboard(target?: string) {
	sessionStorage.setItem("admin_verified", "true");
	// 后台主体是独立页面，登录成功后整页跳转，登录页的代码不再携带后台。
	// 若未登录时访问过后台深链（/admin/dashboard/settings/…），登录后回跳原目标；
	// 第二空间（super）登录则直接进入应急控制台。
	const dest =
		target || sessionStorage.getItem("admin_redirect") || "/admin/dashboard/";
	sessionStorage.removeItem("admin_redirect");
	window.location.replace(dest);
}

function handleVerify(success: boolean, space?: "admin" | "super") {
	if (success)
		enterDashboard(space === "super" ? "/admin/console/" : undefined);
}

onMount(async () => {
	// 始终以服务端会话为准，不盲信 admin_verified 本地标记：Cookie 失效
	//（过期 / 被踢 / 换设备）后标记可能残留，若据此直接进入后台，会与后台页
	// 的未授权回跳互相触发，形成「登录页 ↔ 后台」回弹死循环。
	try {
		const res = await fetch("/api/admin/session/");
		const data = await res.json();
		if (data.success) {
			sessionStorage.setItem("admin_verified", "true");
			// 已有效的 super 会话刷新登录页时同样回到应急控制台
			enterDashboard(data.role === "super" ? "/admin/console/" : undefined);
			return;
		}
		// 明确的未授权：清除残留标记与深链，避免与后台页反复互跳
		sessionStorage.removeItem("admin_verified");
		sessionStorage.removeItem("admin_redirect");
	} catch {
		// 网络异常时留在登录页（保留标记，等待用户重试）
	}

	// 检测初始化状态：首次部署（未配置 ADMIN_PASSWORD）时展示创建表单
	try {
		const setupRes = await fetch("/api/admin/setup/");
		const setup = await setupRes.json();
		if (setup.initialized === false) {
			view = "setup";
			defaultUsername = setup.defaultUsername || "admin";
			tokenRequired = Boolean(setup.tokenRequired);
			writable = Boolean(setup.writable);
			return;
		}
	} catch {
		// 接口异常时按已初始化处理，回落到登录表单
	}
	view = "login";
});
</script>

{#if view === "loading"}
	<div class="login-loading"></div>
{:else if view === "setup"}
	<SetupScreen
		{avatarUrl}
		{defaultUsername}
		{tokenRequired}
		{writable}
		onComplete={enterDashboard}
	/>
{:else}
	<VerifyScreen {avatarUrl} onVerify={handleVerify} />
{/if}

<style>
	.login-loading {
		min-height: 50vh;
	}
</style>