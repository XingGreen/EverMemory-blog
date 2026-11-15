<script lang="ts">
import { onMount } from "svelte";
import Icon from "@/components/common/Icon.svelte";
import { clearLoggedOut, shouldAutoEnter } from "@/utils/auth-expired";
import VerifyScreen from "./VerifyScreen.svelte";

let { avatarUrl = "" }: { avatarUrl?: string } = $props();

let view = $state<"loading" | "login">("loading");
let oauthEnabled = $state(false);
let breakglassEnabled = $state(false);
/** 服务端配置错误（如缺签名密钥）：显示原因而不是反复尝试登录 */
let configError = $state("");

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
		/* 服务端配置错误：登录页也停下来说明原因。照旧渲染登录表单只会让
		   用户反复试、每次都失败，看不到真正的问题在环境变量。 */
		if (typeof data.configError === "string" && data.configError) {
			configError = data.configError;
			view = "login";
			return;
		}
		if (data.success) {
			/* 服务端只在真登录时回 success（首次配置已拆到独立的 /setup/ 页），
			   这里据此自动进入后台；shouldAutoEnter 统一了判定，避免各处各写一遍。 */
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
{:else if configError}
	<div class="config-error-card">
		<Icon icon="material-symbols:error-outline" class="config-error-icon" />
		<h2>无法登录</h2>
		<p>{configError}</p>
		<p class="config-error-hint">
			配置完成后重启服务（本地）或重新部署（线上）即可恢复。
		</p>
	</div>
{:else}
	<VerifyScreen {avatarUrl} onVerify={handleVerify} {oauthEnabled} {breakglassEnabled} />
{/if}

<style>
	.login-loading {
		min-height: 50vh;
	}

	.config-error-card {
		max-width: 34rem;
		margin: 12vh auto 0;
		padding: 1.5rem;
		border: 1px solid var(--line-divider, rgb(0 0 0 / 0.12));
		border-radius: 0.75rem;
		text-align: center;
	}

	.config-error-icon {
		font-size: 2rem;
		color: var(--destructive, #c0392b);
	}

	.config-error-card h2 {
		margin: 0.5rem 0 0.75rem;
		font-size: 1.0625rem;
	}

	.config-error-card p {
		margin: 0;
		font-size: 0.875rem;
		line-height: 1.6;
	}

	.config-error-hint {
		margin-top: 0.75rem;
		opacity: 0.75;
	}
</style>
