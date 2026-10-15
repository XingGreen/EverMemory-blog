<script lang="ts">
import { onMount } from "svelte";
import Icon from "@/components/common/Icon.svelte";

interface BanRecord {
	ip: string;
	reason: string;
	by: string;
	bannedAt: number;
	until: number | null;
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

let banned = $state<BanRecord[]>([]);
let loading = $state(true);
let loadError = $state("");
let ip = $state("");
let reason = $state("");
let ttl = $state("");
let submitting = $state(false);
let unbinding = $state<string | null>(null);

async function load() {
	loading = true;
	loadError = "";
	try {
		const res = await fetch("/api/admin/ban/");
		const data = await res.json();
		if (!res.ok || !data.success) {
			loadError = data.message || "读取黑名单失败";
			return;
		}
		banned = data.banned ?? [];
	} catch {
		loadError = "读取黑名单失败";
	} finally {
		loading = false;
	}
}

async function ban() {
	const target = ip.trim();
	if (!target) {
		onNotify("请填写要封禁的 IP", "error", 4000);
		return;
	}
	const ttlSeconds = ttl.trim() === "" ? 0 : Number(ttl);
	if (!Number.isFinite(ttlSeconds) || ttlSeconds < 0) {
		onNotify("有效期需为不小于 0 的秒数（留空为永久）", "error", 4000);
		return;
	}
	if (!confirm(`确认封禁 ${target} 并踢掉其现有会话？`)) return;
	submitting = true;
	try {
		const res = await fetch("/api/admin/ban/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ip: target, reason: reason.trim(), ttlSeconds }),
		});
		const data = await res.json();
		if (res.ok && data.success) {
			onNotify(`已封禁 ${target}`, "success", 4000);
			ip = "";
			reason = "";
			ttl = "";
			await load();
		} else {
			onNotify(data.message || "封禁失败", "error", 6000);
		}
	} catch {
		onNotify("封禁请求失败", "error", 6000);
	} finally {
		submitting = false;
	}
}

async function unban(record: BanRecord) {
	if (!confirm(`确认解除对 ${record.ip} 的封禁？`)) return;
	unbinding = record.ip;
	try {
		const res = await fetch(
			`/api/admin/ban/?ip=${encodeURIComponent(record.ip)}`,
			{ method: "DELETE" },
		);
		const data = await res.json();
		if (res.ok && data.success) {
			onNotify(`已解封 ${record.ip}`, "success", 4000);
			await load();
		} else {
			onNotify(data.message || "解封失败", "error", 6000);
		}
	} catch {
		onNotify("解封请求失败", "error", 6000);
	} finally {
		unbinding = null;
	}
}

function fmtTime(ts: number | null): string {
	if (!ts) return "永久";
	return new Date(ts).toLocaleString("zh-CN", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
}

onMount(load);
</script>

<div class="ban-manager">
	<div class="ban-form card-base">
		<div class="form-row">
			<input
				class="ban-input"
				type="text"
				bind:value={ip}
				placeholder="IP 地址，如 203.0.113.7"
				autocomplete="off"
				spellcheck="false"
			/>
			<input
				class="ban-input short"
				type="text"
				bind:value={ttl}
				placeholder="有效期(秒)，留空=永久"
				autocomplete="off"
			/>
			<button
				class="sec-btn danger"
				type="button"
				onclick={ban}
				disabled={submitting}
			>
				<Icon icon="material-symbols:block" />
				<span>{submitting ? "处理中…" : "封禁并踢会话"}</span>
			</button>
		</div>
		<input
			class="ban-input reason"
			type="text"
			bind:value={reason}
			placeholder="封禁原因（可选，便于日后回溯）"
			autocomplete="off"
		/>
		<p class="ban-hint">
			<Icon icon="material-symbols:info-outline" />
			<span>封禁会同时踢掉该 IP 的现有会话——只挡新登录挡不住已登录的攻击者。</span>
		</p>
	</div>

	{#if loadError}
		<div class="status-banner error">
			<Icon icon="material-symbols:error-outline" />
			<span>{loadError}</span>
			<button class="sec-btn" type="button" onclick={load}>
				<Icon icon="material-symbols:refresh" />
				<span>重新加载</span>
			</button>
		</div>
	{/if}

	{#if loading}
		<div class="status-banner">
			<Icon icon="material-symbols:refresh" class="spin" />
			<span>加载中…</span>
		</div>
	{:else if banned.length === 0}
		<div class="ban-empty">
			<Icon icon="material-symbols:check-circle-outline" class="empty-icon" />
			<span>当前没有封禁记录</span>
		</div>
	{:else}
		{#each banned as record (record.ip)}
			<div class="ban-card card-base">
				<Icon icon="material-symbols:block" class="ban-icon" />
				<div class="ban-main">
					<div class="ban-ip">{record.ip}</div>
					<div class="ban-meta">
						<span>原因：{record.reason}</span>
						<span>操作者：{record.by}</span>
						<span>封禁于：{fmtTime(record.bannedAt)}</span>
						<span>解封于：{fmtTime(record.until)}</span>
					</div>
				</div>
				<button
					class="sec-btn"
					type="button"
					onclick={() => unban(record)}
					disabled={unbinding === record.ip}
				>
					<Icon icon="material-symbols:lock-open-outline" />
					<span>解封</span>
				</button>
			</div>
		{/each}
	{/if}
</div>

<style>
	.ban-manager {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.ban-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1.25rem 1.5rem;
	}

	.form-row {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.ban-input {
		flex: 1;
		min-width: 12rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--input-border);
		border-radius: var(--radius-md);
		background: var(--card-bg);
		color: var(--deep-text);
		font-size: 0.875rem;
		font-family: inherit;
	}

	.ban-input.short {
		flex: 0 1 12rem;
	}

	.ban-input:focus {
		outline: none;
		border-color: var(--primary);
	}

	.ban-hint {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.8rem;
		color: var(--content-meta);
	}

	.status-banner {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border-radius: 0.75rem;
		background: var(--muted);
		color: var(--deep-text);
		font-size: 0.925rem;
	}

	.status-banner.error {
		background: color-mix(in srgb, var(--destructive) 12%, var(--card-bg));
		color: var(--destructive);
	}

	.status-banner :global(.spin) {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.ban-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 2.5rem 1rem;
		color: var(--content-meta);
		font-size: 0.925rem;
	}

	.ban-empty :global(.empty-icon) {
		font-size: 2.25rem;
		opacity: 0.6;
	}

	.ban-card {
		display: flex;
		align-items: center;
		gap: 0.875rem;
		padding: 0.9rem 1.125rem;
	}

	.ban-card :global(.ban-icon) {
		font-size: 1.5rem;
		color: var(--destructive);
		flex-shrink: 0;
	}

	.ban-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.ban-ip {
		font-weight: 600;
		font-size: 0.95rem;
		color: var(--deep-text);
		font-family: var(--font-mono, ui-monospace, monospace);
	}

	.ban-meta {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
		font-size: 0.8rem;
		color: var(--content-meta);
	}

	.sec-btn {
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
		transition: background 0.15s ease, border-color 0.15s ease;
	}

	.sec-btn:hover:not(:disabled) {
		background: var(--btn-card-bg-hover);
	}

	.sec-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.sec-btn.danger {
		border-color: color-mix(in srgb, var(--destructive) 45%, var(--line-divider));
		color: var(--destructive);
	}

	.sec-btn.danger:hover:not(:disabled) {
		background: color-mix(in srgb, var(--destructive) 10%, var(--card-bg));
	}
</style>
