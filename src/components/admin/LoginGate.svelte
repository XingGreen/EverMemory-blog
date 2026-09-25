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

function enterDashboard() {
	sessionStorage.setItem("admin_verified", "true");
	// 后台主体是独立页面，登录成功后整页跳转，登录页的代码不再携带后台。
	// 若未登录时访问过后台深链（/admin/dashboard/settings/…），登录后回跳原目标
	const target =
		sessionStorage.getItem("admin_redirect") || "/admin/dashboard/";
	sessionStorage.removeItem("admin_redirect");
	window.location.replace(target);
}

function handleVerify(success: boolean) {
	if (success) enterDashboard();
}

onMount(async () => {
	// 已登录会话（刷新页面）或"记住我"Cookie 仍有效时，直接进入后台
	if (sessionStorage.getItem("admin_verified") === "true") {
		enterDashboard();
		return;
	}
	try {
		const res = await fetch("/api/admin/session/");
		const data = await res.json();
		if (data.success) {
			enterDashboard();
			return;
		}
	} catch {
		// 网络异常时留在登录页
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