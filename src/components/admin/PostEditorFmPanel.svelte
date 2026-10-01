<script lang="ts">
import { getContext } from "svelte";
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import { POST_EDITOR_CONTEXT, type FormGroup } from "./postEditorContext";

const { state: editorState, actions } = getContext<{
	state: import("./postEditorContext").PostEditorContextValue["state"];
	actions: import("./postEditorContext").PostEditorContextValue["actions"];
}>(POST_EDITOR_CONTEXT);

/** 分组元数据：key / 标题 / 收起时的字段摘要 */
const GROUPS: { key: FormGroup; title: I18nKey; hint: I18nKey }[] = [
	{
		key: "essential",
		title: I18nKey.postSectionEssential,
		hint: I18nKey.postSectionEssentialHint,
	},
	{
		key: "publish",
		title: I18nKey.postSectionPublish,
		hint: I18nKey.postSectionPublishHint,
	},
	{
		key: "seo",
		title: I18nKey.postSectionSeo,
		hint: I18nKey.postSectionSeoHint,
	},
	{
		key: "advanced",
		title: I18nKey.postSectionAdvanced,
		hint: I18nKey.postSectionAdvancedHint,
	},
];
</script>

<aside class="fm-panel">
	{#each GROUPS as group (group.key)}
		<section class="form-section">
			<button
				type="button"
				class="fm-section-head"
				class:is-open={editorState.openGroups[group.key]}
				aria-expanded={editorState.openGroups[group.key]}
				onclick={() => actions.toggleGroup(group.key)}
			>
				<span class="fm-section-title">{i18n(group.title)}</span>
				{#if !editorState.openGroups[group.key]}
					<span class="fm-section-hint">{i18n(group.hint)}</span>
				{/if}
				<Icon icon="material-symbols:expand_more" class="fm-section-caret" />
			</button>

			{#if editorState.openGroups[group.key]}
				<div class="form-grid">
					{#if group.key === "essential"}
						<div class="form-group">
							<label>
								{i18n(I18nKey.postTitle)} *
								<input
									type="text"
									bind:value={editorState.title}
									placeholder={i18n(I18nKey.postTitlePlaceholder)}
									class="form-input"
								/>
							</label>
						</div>

						<div class="form-group">
							<label>
								{i18n(I18nKey.postSlug)} *
								<input
									type="text"
									bind:value={editorState.slug}
									oninput={actions.handleSlugInput}
									placeholder={i18n(I18nKey.postSlugPlaceholder)}
									class="form-input"
								/>
							</label>
						</div>

						<div class="form-group">
							<label>
								{i18n(I18nKey.postCategory)}
								<input
									type="text"
									bind:value={editorState.category}
									placeholder={i18n(I18nKey.postCategoryPlaceholder)}
									class="form-input"
								/>
							</label>
						</div>
					{:else if group.key === "publish"}
						<div class="form-group">
							<label>
								{i18n(I18nKey.postAuthor)}
								<input
									type="text"
									bind:value={editorState.author}
									placeholder={i18n(I18nKey.postAuthorPlaceholder)}
									class="form-input"
								/>
							</label>
						</div>

						<div class="form-group">
							<label>
								{i18n(I18nKey.postPubDate)}
								<input
									type="date"
									bind:value={editorState.published}
									class="form-input"
								/>
							</label>
						</div>

						<div class="form-group">
							<label>
								{i18n(I18nKey.postUpdateDate)}
								<input
									type="date"
									bind:value={editorState.updated}
									class="form-input"
								/>
							</label>
						</div>

						<div class="form-group full-width switch-row">
							<label class="md3-switch">
								<input type="checkbox" bind:checked={editorState.isDraft} />
								<span class="switch-track">
									<span class="switch-thumb"></span>
								</span>
								<span class="switch-label">{i18n(I18nKey.postDraft)}</span>
							</label>

							<label class="md3-switch">
								<input type="checkbox" bind:checked={editorState.isPinned} />
								<span class="switch-track">
									<span class="switch-thumb"></span>
								</span>
								<span class="switch-label">{i18n(I18nKey.postPinned)}</span>
							</label>

							<label class="md3-switch">
								<input
									type="checkbox"
									bind:checked={editorState.enableComment}
								/>
								<span class="switch-track">
									<span class="switch-thumb"></span>
								</span>
								<span class="switch-label">{i18n(I18nKey.postComments)}</span>
							</label>
						</div>
					{:else if group.key === "seo"}
						<div class="form-group full-width">
							<label>
								{i18n(I18nKey.postSummary)}
								<textarea
									bind:value={editorState.description}
									placeholder={i18n(I18nKey.postSummaryPlaceholder)}
									class="form-textarea"
									rows={2}
								></textarea>
							</label>
						</div>

						<div class="form-group full-width">
							<label>
								{i18n(I18nKey.postCover)}
								<input
									type="text"
									bind:value={editorState.image}
									placeholder={i18n(I18nKey.postCoverPlaceholder)}
									class="form-input"
								/>
							</label>
						</div>

						<div class="form-group">
							<label>
								{i18n(I18nKey.postLang)}
								<input
									type="text"
									bind:value={editorState.lang}
									placeholder={i18n(I18nKey.postLangPlaceholder)}
									class="form-input"
								/>
							</label>
						</div>

						<div class="form-group full-width">
							<label>
								{i18n(I18nKey.postTags)}
								<div class="tags-input-wrapper">
									<div class="tags-list">
										{#each editorState.tags as tag, i (tag)}
											<span class="tag-item">
												{tag}
												<button
													class="tag-remove"
													onclick={() => actions.removeTag(i)}
													aria-label={i18n(I18nKey.postTagRemove)}
												>
													<Icon icon="material-symbols:close" class="text-xs" />
												</button>
											</span>
										{/each}
									</div>
									<input
										type="text"
										bind:value={editorState.tagInput}
										placeholder={i18n(I18nKey.postTagPlaceholder)}
										class="form-input tag-input"
										onkeydown={actions.handleTagKeydown}
									/>
								</div>
							</label>
						</div>
					{:else}
						<div class="form-group">
							<label>
								{i18n(I18nKey.postPassword)}
								<input
									type="text"
									bind:value={editorState.password}
									placeholder={i18n(I18nKey.postPasswordPlaceholder)}
									class="form-input"
								/>
							</label>
						</div>

						<div class="form-group">
							<label>
								{i18n(I18nKey.postPasswordHint)}
								<input
									type="text"
									bind:value={editorState.passwordHint}
									placeholder={i18n(I18nKey.postPasswordHintPlaceholder)}
									class="form-input"
								/>
							</label>
						</div>

						<div class="form-group">
							<label>
								{i18n(I18nKey.postLicenseName)}
								<input
									type="text"
									bind:value={editorState.licenseName}
									placeholder={i18n(I18nKey.postLicenseNamePlaceholder)}
									class="form-input"
								/>
							</label>
						</div>

						<div class="form-group">
							<label>
								{i18n(I18nKey.postLicenseUrl)}
								<input
									type="text"
									bind:value={editorState.licenseUrl}
									placeholder={i18n(I18nKey.postLicenseUrlPlaceholder)}
									class="form-input"
								/>
							</label>
						</div>

						<div class="form-group full-width">
							<label>
								{i18n(I18nKey.postSourceLink)}
								<input
									type="text"
									bind:value={editorState.sourceLink}
									placeholder={i18n(I18nKey.postSourceLinkPlaceholder)}
									class="form-input"
								/>
							</label>
						</div>
					{/if}
				</div>
			{/if}
		</section>
	{/each}
</aside>

<style>
	/* ── 左侧 Front Matter 栏：独立卡片 ── */
	.fm-panel {
		position: sticky;
		top: 1rem;
		max-height: calc(100vh - 7.5rem);
		overflow-y: auto;
		padding: 1.25rem;
		background: var(--card-bg);
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-large);
		box-shadow: var(--shadow-card);
		align-self: start;
		isolation: isolate;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	/* 分组在卡片内以分隔线区分，不再各自成卡 */
	.form-section {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.form-section + .form-section {
		padding-top: 1rem;
		border-top: 1px solid var(--line-divider);
	}

	/* 分组折叠头：整行可点，收起时显示字段摘要提示 */
	.fm-section-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0;
		background: none;
		border: none;
		cursor: pointer;
		font-family: inherit;
		text-align: left;
		color: var(--deep-text);
	}

	.fm-section-title {
		font-size: 0.9375rem;
		font-weight: 600;
		white-space: nowrap;
	}

	.fm-section-hint {
		flex: 1;
		min-width: 0;
		font-size: 0.75rem;
		color: var(--content-meta);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* caret 由 Icon 子组件渲染，需 :global 才能命中 scoped 样式 */
	.fm-section-head :global(.fm-section-caret) {
		flex: none;
		margin-left: auto;
		font-size: 1.25rem;
		color: var(--content-meta);
		transition: transform 0.2s ease;
	}

	.fm-section-head.is-open :global(.fm-section-caret) {
		transform: rotate(180deg);
	}

	.fm-section-head:hover .fm-section-title,
	.fm-section-head:hover :global(.fm-section-caret) {
		color: var(--primary);
	}

	.fm-section-head:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
		border-radius: var(--radius-sm);
	}

	.form-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1rem;
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.form-group > label {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--deep-text);
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.full-width {
		grid-column: 1 / -1;
	}

	.form-input,
	.form-textarea {
		padding: 0.625rem 0.875rem;
		font-size: 0.8125rem;
		background: var(--btn-regular-bg);
		border: 1px solid var(--input-border);
		border-radius: var(--radius-md);
		font-family: inherit;
		color: var(--deep-text);
		transition: border-color 0.15s;
	}

	.form-input:focus,
	.form-textarea:focus {
		outline: none;
		border-color: var(--primary);
	}

	.form-textarea {
		resize: vertical;
		min-height: 80px;
	}

	/* ── MD3 Switch 行 ── */
	.switch-row {
		flex-direction: row;
		align-items: center;
		gap: 1rem;
		padding: 0;
	}

	.md3-switch {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
		font-size: 0.8125rem;
		color: var(--deep-text);
		position: relative;
		user-select: none;
	}

	.md3-switch input {
		position: absolute;
		opacity: 0;
		width: 48px;
		height: 48px;
		margin: 0;
		cursor: pointer;
		z-index: 2;
	}

	.switch-track {
		width: 32px;
		height: 18px;
		border-radius: 10px;
		border: 2px solid var(--content-meta);
		background: transparent;
		position: relative;
		transition: all 0.15s cubic-bezier(0.2, 0, 0, 1);
		flex-shrink: 0;
	}

	.switch-thumb {
		position: absolute;
		top: 50%;
		left: 4px;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--content-meta);
		transform: translateY(-50%);
		transition: all 0.15s cubic-bezier(0.2, 0, 0, 1);
	}

	.md3-switch:hover .switch-track {
		border-color: var(--primary);
	}

	.md3-switch input:checked ~ .switch-track {
		background: var(--primary);
		border-color: var(--primary);
	}

	.md3-switch input:checked ~ .switch-track .switch-thumb {
		left: 18px;
		width: 12px;
		height: 12px;
		background: white;
	}

	.switch-label {
		line-height: 1;
	}

	.tags-input-wrapper {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.tags-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		min-height: 32px;
	}

	.tag-item {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.625rem;
		background: color-mix(in srgb, var(--primary) 12%, transparent);
		border-radius: var(--radius-full);
		font-size: 0.8rem;
		color: var(--primary);
	}

	.tag-remove {
		border: none;
		background: none;
		color: var(--content-meta);
		cursor: pointer;
		padding: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.tag-remove:hover {
		color: #ef4444;
	}

	.tag-input {
		flex: 1;
	}

	@media (max-width: 900px) {
		.fm-panel {
			position: static;
			max-height: none;
		}
	}
</style>