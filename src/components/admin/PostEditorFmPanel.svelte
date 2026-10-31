<script lang="ts">
import { getContext, onMount } from "svelte";
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import DatePicker from "./DatePicker.svelte";
import { type FormGroup, POST_EDITOR_CONTEXT } from "./postEditorContext";
import Select from "./Select.svelte";

const { state: editorState, actions } = getContext<{
	state: import("./postEditorContext").PostEditorContextValue["state"];
	actions: import("./postEditorContext").PostEditorContextValue["actions"];
}>(POST_EDITOR_CONTEXT);

/**
 * 分类 / 标签候选项：来自后台聚合接口（扫描所有文章 frontmatter + registry 登记）。
 */
let taxonomy = $state<{ categories: string[]; tags: string[] }>({
	categories: [],
	tags: [],
});

/* 标签选择器：结构照搬参考项目 features/tags/components/tag-selector.tsx ——
   单容器承载「已选 chips + 输入框」，点击容器聚焦输入并展开候选，
   候选区宽度与容器一致、最高 12.5rem。 */
let tagOpen = $state(false);
let tagBoxEl = $state<HTMLDivElement | undefined>();
let tagInputEl = $state<HTMLInputElement | undefined>();

onMount(() => {
	void (async () => {
		try {
			const res = await fetch("/api/admin/taxonomy/");
			const data = await res.json();
			if (!data?.success || !Array.isArray(data.entries)) return;
			const categories: string[] = [];
			const tags: string[] = [];
			for (const e of data.entries as { kind: string; name: string }[]) {
				if (e.kind === "category") categories.push(e.name);
				else if (e.kind === "tag") tags.push(e.name);
			}
			categories.sort((a, b) => a.localeCompare(b, "zh"));
			tags.sort((a, b) => a.localeCompare(b, "zh"));
			taxonomy = { categories, tags };
		} catch {
			// 接口不可用时退化为空候选，仍可手输
		}
	})();
});

/** 分类候选：首项是「未分类」空值；旧文章的分类若不在聚合结果里则补一项，避免丢值 */
function categoryOptions(): { value: string; label: string }[] {
	const opts = taxonomy.categories.map((c) => ({ value: c, label: c }));
	if (
		editorState.category &&
		!taxonomy.categories.includes(editorState.category)
	) {
		opts.unshift({ value: editorState.category, label: editorState.category });
	}
	return [{ value: "", label: i18n(I18nKey.postCategoryPlaceholder) }, ...opts];
}

/** 按输入内容过滤候选标签 */
function filteredTags(): string[] {
	const q = editorState.tagInput.trim().toLowerCase();
	return q
		? taxonomy.tags.filter((t) => t.toLowerCase().includes(q))
		: taxonomy.tags;
}

/** 输入内容是否是一个尚不存在的新标签（决定候选区顶部是否显示「创建」项） */
function canCreate(): boolean {
	const q = editorState.tagInput.trim();
	return !!q && !taxonomy.tags.some((t) => t.toLowerCase() === q.toLowerCase());
}

/** 勾选 / 取消勾选：选完清空输入并回到输入框，对应参考的选择后 setSearchTerm("") */
function toggleTag(name: string) {
	const tags = editorState.tags;
	editorState.tags = tags.includes(name)
		? tags.filter((t) => t !== name)
		: [...tags, name];
	editorState.tagInput = "";
	tagInputEl?.focus();
	/* 标签也是文章数据的一部分：立即置脏，让刷新/关闭时的 beforeunload 提示生效，
	   不必等 400ms 的草稿定时器把它带出来。 */
	actions.markDirty();
}

/** 新建标签：先登记到 taxonomy（后台接口），再选中；失败也允许本次使用 */
async function createTag() {
	// 列表里标签统一显示为「#foo」，用户手输时可能带上 #，入库前剥掉
	const name = editorState.tagInput.trim().replace(/^#+/, "");
	if (!name) return;
	try {
		await fetch("/api/admin/taxonomy/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "create", kind: "tag", name }),
		});
	} catch {
		// 登记失败不影响本次编辑
	}
	if (!taxonomy.tags.includes(name)) {
		taxonomy = {
			...taxonomy,
			tags: [...taxonomy.tags, name].sort((a, b) => a.localeCompare(b, "zh")),
		};
	}
	toggleTag(name);
}

function handleTagKey(e: KeyboardEvent) {
	if (e.key === "Enter") {
		e.preventDefault();
		const q = editorState.tagInput.trim().replace(/^#+/, "");
		if (!q) return;
		const exact = taxonomy.tags.find(
			(t) => t.toLowerCase() === q.toLowerCase(),
		);
		if (exact) toggleTag(exact);
		else void createTag();
		return;
	}
	if (
		e.key === "Backspace" &&
		!editorState.tagInput &&
		editorState.tags.length
	) {
		editorState.tags = editorState.tags.slice(0, -1);
		return;
	}
	if (e.key === "Escape") tagOpen = false;
}

/** 点击容器与候选区之外时收起 */
function handleDocClick(e: MouseEvent) {
	if (!tagOpen) return;
	if (tagBoxEl && !tagBoxEl.contains(e.target as Node)) tagOpen = false;
}

/** 参考 DatePicker 的 maxDate=serverToday 语义：发布日期/更新日期不允许选未来 */
function localDateStr(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const todayStr = localDateStr(new Date());

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

<svelte:window onclick={handleDocClick} />

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
				<Icon icon="material-symbols:expand-more" class="fm-section-caret" />
			</button>

			{#if editorState.openGroups[group.key]}
				<div class="form-grid">
					{#if group.key === "essential"}
						<div class="form-group">
							<label>
								{i18n(I18nKey.postTitle)}
								<input
									type="text"
									bind:value={editorState.title}
									placeholder={i18n(I18nKey.postTitlePlaceholder)}
									class="ui-input"
								/>
							</label>
						</div>

<div class="form-group">
						<label>
							{i18n(I18nKey.postSlug)}
							<div class="slug-field">
								<span class="slug-prefix">/posts/</span>
								<input
									type="text"
									bind:value={editorState.slug}
									oninput={actions.handleSlugInput}
									onblur={actions.normalizeSlug}
									placeholder={i18n(I18nKey.postSlugPlaceholder)}
									class="ui-input"
								/>
								<button
									type="button"
									class="slug-generate"
									class:is-verified={editorState.slugVerified}
									onclick={actions.generateSlugFromTitle}
									disabled={!editorState.title}
									title={i18n(I18nKey.postSlugGenerate)}
									aria-label={i18n(I18nKey.postSlugGenerate)}
								>
									<Icon
										icon={editorState.slugVerified
											? "material-symbols:check"
											: "material-symbols:refresh"}
									/>
								</button>
							</div>
						</label>
					</div>

						<div class="form-group">
							<label>
								{i18n(I18nKey.postCategory)}
								<Select
									value={editorState.category}
									options={categoryOptions()}
									placeholder={i18n(I18nKey.postCategoryPlaceholder)}
									onChange={(v) => (editorState.category = v)}
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
								class="ui-input"
							/>
						</label>
					</div>

					<div class="form-group">
						<label>
							{i18n(I18nKey.postPubDate)}
							<DatePicker
								value={editorState.published}
								maxDate={todayStr}
								placeholder={i18n(I18nKey.postPubDate)}
								onChange={(v) => (editorState.published = v)}
							/>
						</label>
					</div>

					<div class="form-group">
						<label>
							{i18n(I18nKey.postUpdateDate)}
							<DatePicker
								value={editorState.updated}
								maxDate={todayStr}
								placeholder={i18n(I18nKey.postUpdateDate)}
								onChange={(v) => (editorState.updated = v)}
							/>
						</label>
					</div>

					<div class="form-group full-width switch-list">
						<label class="md3-switch">
							<input type="checkbox" bind:checked={editorState.isDraft} />
							<span class="switch-label">{i18n(I18nKey.postDraft)}</span>
							<span class="switch-track">
								<span class="switch-thumb"></span>
							</span>
						</label>

						<label class="md3-switch">
							<input type="checkbox" bind:checked={editorState.isPinned} />
							<span class="switch-label">{i18n(I18nKey.postPinned)}</span>
							<span class="switch-track">
								<span class="switch-thumb"></span>
							</span>
						</label>

						<label class="md3-switch">
							<input
								type="checkbox"
								bind:checked={editorState.enableComment}
							/>
							<span class="switch-label">{i18n(I18nKey.postComments)}</span>
							<span class="switch-track">
								<span class="switch-thumb"></span>
							</span>
						</label>
					</div>
					{:else if group.key === "seo"}
						<div class="form-group full-width">
							<label>
								{i18n(I18nKey.postSummary)}
<textarea
								bind:value={editorState.description}
								placeholder={i18n(I18nKey.postSummaryPlaceholder)}
								class="ui-input"
								rows={2}
							></textarea>
							</label>
						</div>

<div class="form-group full-width">
						<label>
							{i18n(I18nKey.postCover)}
							<div class="cover-block">
								{#if editorState.image}
									<div class="cover-preview">
										<img
											src={editorState.image}
											alt={i18n(I18nKey.postCover)}
										/>
										<button
											type="button"
											class="cover-clear"
											onclick={() => (editorState.image = "")}
											aria-label={i18n(I18nKey.postCoverClear)}
										>
											<Icon icon="material-symbols:close" />
										</button>
									</div>
								{:else}
									<p class="cover-empty">
										<Icon icon="material-symbols:image-outline" />
										{i18n(I18nKey.postCoverEmpty)}
									</p>
								{/if}
								<input
									type="text"
									bind:value={editorState.image}
									placeholder={i18n(I18nKey.postCoverPlaceholder)}
									class="ui-input"
								/>
							</div>
						</label>
					</div>

						<div class="form-group">
							<label>
								{i18n(I18nKey.postLang)}
								<input
									type="text"
									bind:value={editorState.lang}
									placeholder={i18n(I18nKey.postLangPlaceholder)}
									class="ui-input"
								/>
							</label>
						</div>

						<div class="form-group full-width">
							<label>
								{i18n(I18nKey.postTags)}
								<!-- 结构照搬参考项目 tag-selector.tsx：已选 chips 与输入框同处一个
								     容器，点击容器即聚焦并展开候选；候选区宽度跟随容器、最高 12.5rem。 -->
								<div class="tag-selector" bind:this={tagBoxEl}>
									<div
										class="tag-selector-box"
										role="group"
										onclick={() => {
											tagInputEl?.focus();
											tagOpen = true;
										}}
									>
										{#each editorState.tags as tag, i (tag)}
											<span class="tag-chip">
												<span class="tag-chip-name">#{tag}</span>
												<button
													class="tag-chip-x"
													type="button"
													aria-label={i18n(I18nKey.postTagRemove)}
													onmousedown={(e) => {
														e.preventDefault();
														e.stopPropagation();
														actions.removeTag(i);
													}}
												>
													<Icon
														icon="material-symbols:close"
														class="tag-chip-icon"
													/>
												</button>
											</span>
										{/each}
										<input
											bind:this={tagInputEl}
											type="text"
											class="tag-selector-input"
											bind:value={editorState.tagInput}
											placeholder={editorState.tags.length === 0
												? i18n(I18nKey.postTagPlaceholder)
												: ""}
											aria-expanded={tagOpen}
											onfocus={() => (tagOpen = true)}
											oninput={() => (tagOpen = true)}
											onkeydown={handleTagKey}
										/>
									</div>

									{#if tagOpen}
										<div class="tag-selector-panel">
											<div class="tag-selector-scroll">
												{#if canCreate()}
													<button
														class="tag-option is-create"
														type="button"
														onclick={() => void createTag()}
													>
														<Icon
															icon="material-symbols:add"
															class="tag-option-icon"
														/>
														<span>{editorState.tagInput.trim()}</span>
													</button>
												{/if}
												{#each filteredTags() as t (t)}
													<button
														class="tag-option"
														type="button"
														aria-pressed={editorState.tags.includes(t)}
														onclick={() => toggleTag(t)}
													>
														<span class="tag-option-name">#{t}</span>
														{#if editorState.tags.includes(t)}
															<Icon
																icon="material-symbols:check"
																class="tag-option-icon is-checked"
															/>
														{/if}
													</button>
												{/each}
												{#if !canCreate() && filteredTags().length === 0}
													<p class="tag-option-empty">{i18n(I18nKey.noData)}</p>
												{/if}
											</div>
										</div>
									{/if}
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
									class="ui-input"
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
									class="ui-input"
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
									class="ui-input"
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
									class="ui-input"
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
									class="ui-input"
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
	/* 作为抽屉内容渲染：外壳（卡片/滚动）由抽屉提供，此处只负责分组排布 */
	.fm-panel {
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
		border-top: 1px solid var(--line-color);
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

	/* 参考 metadata 的 label:text-xs fuwari-text-50(小号灰字);开关识别不到该规则 */
	.form-group > label:not(.md3-switch) {
		font-size: 0.75rem;
		font-weight: 400;
		color: var(--content-meta);
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.full-width {
		grid-column: 1 / -1;
	}

	/* ── 字段外观对齐参考 EDITOR_FIELD_CLASS ──
	   h-10 rounded-xl bg-(--fuwari-btn-regular-bg) text-sm,无边框淡底;
	   只覆盖本面板,不动 ui-base 的全局 .ui-input */
	.fm-panel .ui-input {
		height: 2.5rem;
		padding: 0 0.75rem;
		background: var(--btn-regular-bg);
		border: none;
		border-radius: 0.75rem;
		font-size: 0.875rem;
	}

	.fm-panel textarea.ui-input {
		height: auto;
		min-height: 2.5rem;
		padding-block: 0.625rem;
		resize: none;
		line-height: 1.6;
	}

	.fm-panel .ui-input:hover {
		background: var(--btn-regular-bg-hover);
	}

	/* 无边框后失去聚焦提示,补一处主色 ring(与 ui-base 的 focus-within ring 同手法) */
	.fm-panel .ui-input:focus {
		outline: none;
		border: none;
		box-shadow: 0 0 0 3px color-mix(in oklab, var(--primary) 15%, transparent);
	}

	/* ── slug:前缀 + 生成按钮,参考 /post/ + RefreshCw ── */
	.slug-field {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.slug-field .ui-input {
		flex: 1;
		min-width: 0;
	}

	.slug-prefix {
		flex-shrink: 0;
		font-size: 0.875rem;
		color: var(--content-meta);
	}

	.slug-generate {
		flex-shrink: 0;
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border: none;
		border-radius: 0.75rem;
		background: var(--btn-regular-bg);
		color: var(--content-meta);
		cursor: pointer;
		transition:
			background-color 0.15s,
			color 0.15s,
			opacity 0.15s;
	}

	.slug-generate:hover:not(:disabled) {
		background: var(--btn-regular-bg-hover);
		color: var(--primary);
	}

	.slug-generate.is-verified,
	.slug-generate.is-verified:hover:not(:disabled) {
		background: var(--btn-regular-bg-hover);
		color: var(--primary);
	}

	.slug-generate:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	/* ── 封面:有图预览 / 无图提示,下方始终保留 URL 输入(媒体库就绪前用文本) ── */
	.cover-block {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.cover-preview {
		position: relative;
		aspect-ratio: 16 / 9;
		border-radius: 0.75rem;
		overflow: hidden;
		background: var(--btn-regular-bg);
	}

	.cover-preview img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.cover-clear {
		position: absolute;
		right: 0.5rem;
		bottom: 0.5rem;
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border: none;
		border-radius: 0.5rem;
		background: rgb(0 0 0 / 0.45);
		color: #fff;
		cursor: pointer;
		backdrop-filter: blur(4px);
		transition: background-color 0.15s;
	}

	.cover-clear:hover {
		background: rgb(0 0 0 / 0.55);
	}

	.cover-empty {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 2.5rem;
		padding: 0 0.75rem;
		border-radius: 0.75rem;
		background: var(--btn-regular-bg);
		font-size: 0.875rem;
		color: var(--content-meta);
	}

	/* ── MD3 Switch 设置列表:三行竖排,文字在左、开关在右 ── */
	.switch-list {
		padding: 0;
	}

	.md3-switch {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		width: 100%;
		min-height: 2.5rem;
		cursor: pointer;
		font-size: 0.8125rem;
		color: var(--deep-text);
		position: relative;
		user-select: none;
	}

	.md3-switch input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		opacity: 0;
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

	/* ── 标签选择器 ──
	   尺寸/层级照搬参考项目 tag-selector.tsx 的 Tailwind 值：
	   容器 min-h-10 / rounded-xl / px-2 py-1.5 / gap-1.5，底 fuwari-btn-regular-bg；
	   chip h-7 / rounded-lg / px-2，底 fuwari-card-bg；
	   候选区 absolute top-full mt-1 w-full rounded-xl，内层 max-h-50 / p-1。 */
	.tag-selector {
		position: relative;
	}

	.tag-selector-box {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
		min-height: 2.5rem;
		width: 100%;
		padding: 0.375rem 0.5rem;
		border-radius: 0.75rem;
		background: var(--btn-regular-bg);
		cursor: text;
	}

	.tag-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		height: 1.75rem;
		padding: 0 0.5rem;
		border-radius: 0.5rem;
		background: var(--card-bg);
		color: var(--btn-content);
		font-size: 0.875rem;
	}

	.tag-chip-name {
		max-width: 9.375rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tag-chip-x {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.125rem;
		border: none;
		border-radius: 999px;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.tag-chip-x:hover {
		background: color-mix(in srgb, var(--deep-text) 8%, transparent);
	}

	.tag-chip-icon {
		font-size: 12px;
	}

	.tag-selector-input {
		flex: 1;
		min-width: 5rem;
		height: 1.5rem;
		border: none;
		outline: none;
		background: transparent;
		color: var(--deep-text);
		font-family: inherit;
		font-size: 0.875rem;
	}

	.tag-selector-input::placeholder {
		color: color-mix(in srgb, var(--content-meta) 70%, transparent);
	}

	.tag-selector-panel {
		position: absolute;
		top: 100%;
		left: 0;
		z-index: 50;
		width: 100%;
		margin-top: 0.25rem;
		border-radius: 0.75rem;
		background: var(--card-bg);
		box-shadow:
			0 0 0 1px var(--input-border),
			0 8px 24px rgb(0 0 0 / 0.18);
	}

	.tag-selector-scroll {
		max-height: 12.5rem;
		overflow-y: auto;
		overflow-x: hidden;
		padding: 0.25rem;
		overscroll-behavior: contain;
	}

	.tag-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.75rem;
		border: none;
		border-radius: 0.5rem;
		background: transparent;
		color: var(--content-meta);
		font-family: inherit;
		font-size: 0.875rem;
		text-align: left;
		cursor: pointer;
	}

	.tag-option:hover {
		background: color-mix(in srgb, var(--btn-regular-bg) 70%, transparent);
		color: var(--deep-text);
	}

	.tag-option[aria-pressed="true"] {
		color: var(--primary);
	}

	.tag-option.is-create {
		color: var(--primary);
	}

	.tag-option-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tag-option-icon {
		font-size: 14px;
		flex-shrink: 0;
	}

	.tag-option-icon.is-checked {
		color: var(--primary);
	}

	.tag-option-empty {
		margin: 0;
		padding: 0.5rem 0.75rem;
		font-size: 0.875rem;
		color: var(--content-meta);
	}
</style>