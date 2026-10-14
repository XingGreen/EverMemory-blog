<script lang="ts">
import Icon from "@/components/common/Icon.svelte";
import IpBanManager from "./IpBanManager.svelte";
import RuntimeConfigPanel from "./RuntimeConfigPanel.svelte";
import SessionManager from "./SessionManager.svelte";

// 应急控制台容器：集中控制面三项操作（踢会话 / 封 IP / 运行时配置）。
// 仅第二空间（super）可达，门禁在 console.astro 服务端与各控制面 API 的 requireSuperAuth。
let toast = $state<{ message: string; type: "success" | "error" } | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function notify(message: string, type: "success" | "error", duration = 4000) {
	toast = { message, type };
	if (toastTimer) clearTimeout(toastTimer);
	toastTimer = setTimeout(() => {
		toast = null;
	}, duration);
}

async function logout() {
	try {
		await fetch("/api/admin/verify/", { method: "DELETE" });
	} catch {
		// 忽略清理失败
	}
	sessionStorage.removeItem("admin_verified");
	window.location.replace("/admin/");
}
</script>

<div class="console-page">
	<header class="console-head card-base">
		<div class="head-main">
			<div class="head-icon">
				<Icon icon="material-symbols:shield-lock" />
			</div>
			<div class="head-text">
				<h1>应急控制台</h1>
				<p>
					第二空间（super）专属。可踢下线任意设备、封禁来源 IP、修改运行时配置。本会话有效期
					1 小时且不提供「记住我」。
				</p>
			</div>
		</div>
		<div class="head-actions">
			<a class="hd-btn" href="/admin/dashboard/">
				<Icon icon="material-symbols:arrow-back-rounded" />
				<span>返回控制面板</span>
			</a>
			<button class="hd-btn" type="button" onclick={logout}>
				<Icon icon="material-symbols:logout-rounded" />
				<span>退出登录</span>
			</button>
		</div>
	</header>

	<section class="console-section">
		<h2 class="section-title">
			<Icon icon="material-symbols:devices" />
			<span>活跃会话</span>
		</h2>
		<SessionManager onNotify={notify} canKick={true} />
	</section>

	<section class="console-section">
		<h2 class="section-title">
			<Icon icon="material-symbols:block" />
			<span>IP 黑名单</span>
		</h2>
		<IpBanManager onNotify={notify} />
	</section>

	<section class="console-section">
		<h2 class="section-title">
			<Icon icon="material-symbols:bolt" />
			<span>运行时配置</span>
		</h2>
		<RuntimeConfigPanel onNotify={notify} />
	</section>

	{#if toast}
		<div class={`toast ${toast.type}`}>
			<Icon
				icon={toast.type === "success"
					? "material-symbols:check"
					: "material-symbols:error-outline"}
			/>
			<span>{toast.message}</span>
		</div>
	{/if}
</div>

<style>
	.console-page {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		max-width: 960px;
		margin: 0 auto;
	}

	.console-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.25rem 1.5rem;
		flex-wrap: wrap;
	}

	.head-main {
		display: flex;
		align-items: flex-start;
		gap: 0.875rem;
	}

	.head-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 0.75rem;
		background: color-mix(in srgb, var(--primary) 14%, transparent);
		color: var(--primary);
		font-size: 1.5rem;
		flex-shrink: 0;
	}

	.head-text h1 {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--deep-text);
		margin-bottom: 0.25rem;
	}

	.head-text p {
		font-size: 0.85rem;
		color: var(--content-meta);
		line-height: 1.5;
		max-width: 34rem;
	}

	.head-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.hd-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.45rem 0.875rem;
		border-radius: 0.65rem;
		border: 1px solid var(--line-divider);
		background: var(--card-bg);
		color: var(--deep-text);
		font-size: 0.875rem;
		cursor: pointer;
		text-decoration: none;
		transition: background 0.15s ease, border-color 0.15s ease;
	}

	.hd-btn:hover {
		background: var(--btn-card-bg-hover);
	}

	.console-section {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.section-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1rem;
		font-weight: 600;
		color: var(--deep-text);
	}

	.section-title :global(.inline-icon),
	.section-title svg {
		color: var(--primary);
	}

	.toast {
		position: fixed;
		right: 1.5rem;
		bottom: 1.5rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border-radius: 0.75rem;
		background: var(--card-bg);
		border: 1px solid var(--line-divider);
		box-shadow: var(--shadow-card);
		font-size: 0.875rem;
		color: var(--deep-text);
		z-index: 50;
	}

	.toast.success {
		border-color: color-mix(in srgb, var(--success) 45%, var(--line-divider));
	}

	.toast.error {
		border-color: color-mix(in srgb, var(--destructive) 45%, var(--line-divider));
		color: var(--destructive);
	}
</style>
