<script lang="ts">
	import { onMount } from "svelte";
	import VerifyScreen from "./VerifyScreen.svelte";

	let { avatarUrl = "" }: { avatarUrl?: string } = $props();

	function enterDashboard() {
		sessionStorage.setItem("admin_verified", "true");
		// 后台主体是独立页面，登录成功后整页跳转，登录页的代码不再携带后台。
		// 若未登录时访问过后台深链（/admin/dashboard/settings/…），登录后回跳原目标
		const target = sessionStorage.getItem("admin_redirect") || "/admin/dashboard/";
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
			if (data.success) enterDashboard();
		} catch {
			// 网络异常时留在登录页
		}
	});
</script>

<VerifyScreen {avatarUrl} onVerify={handleVerify} />