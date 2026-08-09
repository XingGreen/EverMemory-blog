<script lang="ts">
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import {
	CONFIG_ITEMS,
	getConfigDescKey,
	getConfigLabelKey,
} from "@/utils/admin-settings";

let {
	onNavigate,
	searchTerm,
	onSearchChange,
}: {
	onNavigate: (key: string) => void;
	searchTerm: string;
	onSearchChange: (value: string) => void;
} = $props();

const filteredItems = $derived(
	CONFIG_ITEMS.filter((item) => {
		if (!searchTerm.trim()) return true;
		const term = searchTerm.toLowerCase();
		return (
			item.label.toLowerCase().includes(term) ||
			item.description.toLowerCase().includes(term) ||
			item.file.toLowerCase().includes(term) ||
			item.key.toLowerCase().includes(term)
		);
	}),
);

function fileLabel(item: (typeof CONFIG_ITEMS)[number]): string {
	return item.file;
}

function handleKeydown(event: KeyboardEvent, key: string) {
	if (event.key === "Enter" || event.key === " ") {
		event.preventDefault();
		onNavigate(key);
	}
}
</script>

<div class="settings-overview">
	{#if filteredItems.length === 0}
		<div class="empty-state">
			<div class="empty-ring">
				<Icon icon="material-symbols:search-off" size="2xl" />
			</div>
			<p>{i18n(I18nKey.searchNoResults)}</p>
			<button class="empty-reset" onclick={() => onSearchChange("")}>
				{i18n(I18nKey.search)}
			</button>
		</div>
	{:else}
		<ul class="config-list" role="list">
			{#each filteredItems as item, index (item.key)}
				<li class="config-item" style="--index: {index}">
					<button
						class="config-card"
						type="button"
						onclick={() => onNavigate(item.key)}
						onkeydown={(e) => handleKeydown(e, item.key)}
						aria-label="{i18n(getConfigLabelKey(item.key))} - {fileLabel(item)}"
					>
						<div class="card-body">
							<div class="card-main">
								<div class="config-icon">
									<Icon icon={item.icon} size="xl" />
								</div>
								<div class="config-info">
									<h3>{i18n(getConfigLabelKey(item.key))}</h3>
									<p>{i18n(getConfigDescKey(item.key))}</p>
								</div>
								<div class="config-action">
									<span class="edit-label">{i18n(I18nKey.postEdit)}</span>
								</div>
							</div>
							<div class="config-file">
								<Icon icon="material-symbols:article" size="xs" />
								<code>{fileLabel(item)}</code>
							</div>
						</div>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.settings-overview {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		padding: 0.25rem;
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		padding: 4rem 1.5rem;
		text-align: center;
		background: var(--card-bg);
		border: 1px dashed var(--line-color);
		border-radius: var(--radius-2xl);
	}

	.empty-ring {
		width: 4rem;
		height: 4rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		background: var(--btn-regular-bg);
		color: var(--content-meta);
	}

	.empty-state p {
		font-size: 0.9375rem;
		color: var(--content-meta);
	}

	.empty-reset {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--primary);
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 0.375rem 0.75rem;
		border-radius: var(--radius-md);
		transition: background 0.15s ease;
	}

	.empty-reset:hover {
		background: color-mix(in srgb, var(--primary) 10%, transparent);
	}

	.config-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
		gap: 1rem;
	}

	.config-item {
		display: flex;
	}

	.config-card {
		position: relative;
		display: flex;
		width: 100%;
		padding: 0;
		text-align: left;
		font-family: inherit;
		cursor: pointer;
		background: var(--card-bg);
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-2xl);
		overflow: hidden;
		transition: transform 0.25s var(--ease-decelerate, cubic-bezier(0.25, 0.46, 0.45, 0.94)),
			box-shadow 0.25s var(--ease-decelerate, cubic-bezier(0.25, 0.46, 0.45, 0.94)),
			border-color 0.2s ease;
	}

	.config-card:hover,
	.config-card:focus-visible {
		transform: translateY(-3px);
		border-color: color-mix(in srgb, var(--primary) 50%, var(--line-divider));
		box-shadow: var(--shadow-card-hover);
	}

	.config-card:focus-visible {
		outline: none;
	}

	.config-card:hover .edit-label,
	.config-card:focus-visible .edit-label {
		color: var(--primary);
	}

	.card-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.card-main {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		padding: 1.25rem;
	}

	.config-icon {
		width: 2.75rem;
		height: 2.75rem;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-xl);
		background: color-mix(in srgb, var(--primary) 10%, transparent);
		color: var(--primary);
		transition: transform 0.25s var(--ease-decelerate, cubic-bezier(0.25, 0.46, 0.45, 0.94)),
			background 0.2s ease;
	}

	.config-card:hover .config-icon,
	.config-card:focus-visible .config-icon {
		transform: scale(1.05);
		background: color-mix(in srgb, var(--primary) 15%, transparent);
	}

	.config-info {
		flex: 1;
		min-width: 0;
	}

	.config-info h3 {
		font-size: 1rem;
		font-weight: 600;
		color: var(--deep-text);
		margin-bottom: 0.25rem;
		transition: color 0.2s ease;
	}

	.config-card:hover .config-info h3,
	.config-card:focus-visible .config-info h3 {
		color: var(--primary);
	}

	.config-info p {
		font-size: 0.8125rem;
		color: var(--content-meta);
		line-height: 1.55;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.config-action {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
		color: var(--content-meta);
		transition: color 0.2s ease;
	}

	.edit-label {
		font-size: 0.8125rem;
		font-weight: 500;
		opacity: 0;
		transform: translateX(-6px);
		transition: opacity 0.2s ease, transform 0.2s ease;
	}

	.config-card:hover .edit-label,
	.config-card:focus-visible .edit-label {
		opacity: 1;
		transform: translateX(0);
	}

	.config-file {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.625rem 1.25rem;
		background: var(--btn-regular-bg);
		border-top: 1px solid var(--line-divider);
		color: var(--content-meta);
	}

	.config-file code {
		font-size: 0.75rem;
		font-family: var(--font-mono, monospace);
		word-break: break-all;
		color: var(--content-meta);
	}

	@media (max-width: 768px) {
		.config-list {
			grid-template-columns: 1fr;
		}

		.edit-label {
			display: none;
		}
	}
</style>
