<script lang="ts">
import { onMount } from "svelte";
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";

interface SessionDTO {
	sid: string;
	device: string;
	ua: string;
	ip: string;
	loginAt: number;
	lastSeenAt: number;
	remember: boolean;
	isCurrent: boolean;
}

let {
	onNotify,
}: {
	onNotify: (
		message: string,
		type: "success" | "error",
		duration?: number,
	) => void;
} = $props();

let sessions = $state<SessionDTO[]>([]);
let loading = $state(true);
let loadError = $state("");
let kicking = $state<string | null>(null);
let kickingAll = $state(false);

function fmtTime(ts: number): string {
	if (!ts) return "-";
	return new Date(ts).toLocaleString("zh-CN", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function deviceIcon(s: SessionDTO): string {
	const u = s.ua;
	if (/iphone|ipod/i.test(u)) return "material-symbols:smartphone";
	if (/ipad/i.test(u)) return "material-symbols:tablet-mac";
	if (/android/i.test(u))
		return /mobile/i.test(u)
			? "material-symbols:smartphone"
			: "material-symbols:tablet-android";
	if (/mac os x/i.test(u)) return "material-symbols:laptop-mac";
	if (/windows/i.test(u)) return "material-symbols:desktop-windows";
	return "material-symbols:devices";
}

async function load() {
	loading = true;
	loadError = "";
	try {
		const res = await fetch("/api/admin/sessions/");
		const data = await res.json();
		if (!res.ok || !data.success) {
			loadError = data.message || i18n(I18nKey.sessionsLoadError);
			return;
		}
		sessions = data.sessions ?? [];
	} catch {
		loadError = i18n(I18nKey.sessionsLoadError);
	} finally {
		loading = false;
	}
}

async function kick(s: SessionDTO) {
	if (!confirm(i18n(I18nKey.sessionsConfirmKick).replace("{device}", s.device)))
		return;
	kicking = s.sid;
	try {
		const res = await fetch(
			`/api/admin/sessions/?sid=${encodeURIComponent(s.sid)}`,
			{ method: "DELETE" },
		);
		const data = await res.json();
		if (res.ok && data.success) {
			sessions = sessions.filter((item) => item.sid !== s.sid);
			onNotify(i18n(I18nKey.sessionsKicked), "success", 3000);
		} else {
			onNotify(data.message || i18n(I18nKey.sessionsKickFail), "error", 6000);
		}
	} catch {
		onNotify(i18n(I18nKey.sessionsKickFail), "error", 6000);
	} finally {
		kicking = null;
	}
}

async function kickAllOther() {
	if (!confirm(i18n(I18nKey.sessionsConfirmKickAll))) return;
	kickingAll = true;
	try {
		const res = await fetch("/api/admin/sessions/?allOther=1", {
			method: "DELETE",
		});
		const data = await res.json();
		if (res.ok && data.success) {
			sessions = sessions.filter((s) => s.isCurrent);
			onNotify(i18n(I18nKey.sessionsKickedAll), "success", 3000);
		} else {
			onNotify(data.message || i18n(I18nKey.sessionsKickFail), "error", 6000);
		}
	} catch {
		onNotify(i18n(I18nKey.sessionsKickFail), "error", 6000);
	} finally {
		kickingAll = false;
	}
}

onMount(load);
</script>

<div class="sessions-page">
	{#if loadError}
		<div class="status-banner error">
			<Icon icon="material-symbols:error-outline" />
			<span>{loadError}</span>
			<button class="sec-btn" onclick={load}>
				<Icon icon="material-symbols:refresh" />
				<span>{i18n(I18nKey.secretsReload)}</span>
			</button>
		</div>
	{/if}

	<div class="toolbar">
		<div class="toolbar-hint">
			<Icon icon="material-symbols:devices-other" class="hint-ok" />
			<span>{i18n(I18nKey.adminSessionsDesc)}</span>
		</div>
		<div class="toolbar-actions">
			<button class="sec-btn" onclick={load} disabled={loading}>
				<Icon icon="material-symbols:refresh" />
				<span>{i18n(I18nKey.secretsReload)}</span>
			</button>
			<button
				class="sec-btn danger"
				onclick={kickAllOther}
				disabled={loading || kickingAll || sessions.length <= 1}
			>
				<Icon icon="material-symbols:devices-off" />
				<span>{i18n(I18nKey.sessionsKickAllOther)}</span>
			</button>
		</div>
	</div>

	{#if loading}
		<div class="status-banner">
			<Icon icon="material-symbols:refresh" class="spin" />
			<span>{i18n(I18nKey.configLoading)}</span>
		</div>
	{:else if sessions.length === 0}
		<div class="sessions-empty">
			<Icon icon="material-symbols:devices-off" class="empty-icon" />
			<span>{i18n(I18nKey.sessionsEmpty)}</span>
		</div>
	{:else}
		{#each sessions as s (s.sid)}
			<div class="session-card">
				<Icon icon={deviceIcon(s)} class="session-icon" />
				<div class="session-main">
					<div class="session-title">
						<span class="session-device">{s.device}</span>
						{#if s.isCurrent}
							<span class="badge current">{i18n(I18nKey.sessionsCurrent)}</span>
						{/if}
						{#if s.remember}
							<span class="badge remember">{i18n(I18nKey.sessionsRemembered)}</span>
						{/if}
					</div>
					<div class="session-meta">
						<span>{i18n(I18nKey.sessionsIp)}: {s.ip}</span>
						<span
							>{i18n(I18nKey.sessionsLoginAt)}: {fmtTime(s.loginAt)}</span
						>
						<span
							>{i18n(I18nKey.sessionsLastActive)}: {fmtTime(s.lastSeenAt)}</span
						>
					</div>
				</div>
				{#if !s.isCurrent}
					<button
						class="sec-btn danger sm"
						onclick={() => kick(s)}
						disabled={kicking === s.sid || kickingAll}
					>
						<Icon icon="material-symbols:block" />
						<span>{i18n(I18nKey.sessionsKick)}</span>
					</button>
				{/if}
			</div>
		{/each}
	{/if}
</div>

<style>
	.sessions-page {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 0.25rem;
	}

	.status-banner {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border-radius: 0.75rem;
		background: hsl(220 14% 94%);
		color: var(--admin-text) !important;
		font-size: 0.925rem;
	}

	.status-banner.error {
		background: hsl(0 72% 95%);
		color: hsl(0 70% 45%) !important;
	}

	.status-banner .spin {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.875rem 1.125rem;
		border-radius: 0.875rem;
		background: var(--card-bg);
		border: 1px solid var(--admin-border);
		flex-wrap: wrap;
	}

	.toolbar-hint {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
		color: var(--admin-muted);
	}

	.hint-ok {
		color: var(--admin-primary, oklch(0.7 0.14 275));
	}

	.toolbar-actions {
		display: flex;
		gap: 0.5rem;
	}

	.sec-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.45rem 0.875rem;
		border-radius: 0.65rem;
		border: 1px solid var(--admin-border);
		background: var(--card-bg);
		color: var(--admin-text);
		font-size: 0.875rem;
		cursor: pointer;
		transition: background 0.15s ease, border-color 0.15s ease;
	}

	.sec-btn:hover:not(:disabled) {
		background: var(--admin-hover-bg);
	}

	.sec-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.sec-btn.danger {
		border-color: hsl(0 60% 80%);
		color: hsl(0 65% 50%);
	}

	.sec-btn.danger:hover:not(:disabled) {
		background: hsl(0 70% 96%);
	}

	.sec-btn.sm {
		padding: 0.35rem 0.7rem;
		font-size: 0.8rem;
	}

	.sessions-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 3rem 1rem;
		color: var(--admin-muted);
		font-size: 0.925rem;
	}

	.empty-icon {
		font-size: 2.25rem;
		opacity: 0.6;
	}

	.session-card {
		display: flex;
		align-items: center;
		gap: 0.875rem;
		padding: 0.9rem 1.125rem;
		border-radius: 0.875rem;
		background: var(--card-bg);
		border: 1px solid var(--admin-border);
	}

	.session-icon {
		font-size: 1.5rem;
		color: var(--admin-primary, oklch(0.7 0.14 275));
		flex-shrink: 0;
	}

	.session-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.session-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.session-device {
		font-weight: 600;
		font-size: 0.95rem;
		color: var(--admin-text);
	}

	.badge {
		font-size: 0.7rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
	}

	.badge.current {
		background: var(--admin-primary, oklch(0.7 0.14 275));
		color: #fff;
	}

	.badge.remember {
		background: hsl(120 45% 90%);
		color: hsl(130 45% 35%);
		border: 1px solid hsl(120 40% 75%);
	}

	.session-meta {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
		font-size: 0.8rem;
		color: var(--admin-muted);
	}
</style>