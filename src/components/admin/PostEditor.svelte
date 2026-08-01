<script lang="ts">
import { onMount } from "svelte";
import Icon from "@/components/common/Icon.svelte";

let {
	post,
	mode,
	onSave,
	onCancel,
	onError,
}: {
	post: any;
	mode: "edit" | "create";
	onSave: () => void;
	onCancel: () => void;
	onError: (msg: string) => void;
} = $props();

let title = $state("");
let author = $state("");
let category = $state("");
let description = $state("");
let content = $state("");
let slug = $state("");
let published = $state("");
let isDraft = $state(false);
let tagInput = $state("");
let tags = $state<string[]>([]);
let isSaving = $state(false);
let activeTab = $state<"editor" | "preview">("editor");
let isLoadingContent = $state(false);

$effect(() => {
	title = post?.title || "";
	author = post?.author || "";
	category = post?.category || "";
	description = post?.description || "";
	slug = post?.slug || "";
	published = post?.published
		? formatDate(post.published)
		: new Date().toISOString().split("T")[0];
	isDraft = post?.draft || false;
	tags = [...(post?.tags || [])];
	isLoadingContent = mode === "edit";
});

function formatDate(dateStr: string): string {
	return new Date(dateStr).toISOString().split("T")[0];
}

function generateSlug(title: string): string {
	if (mode === "create" && !slug && title) {
		slug = title
			.toLowerCase()
			.replace(/[^\w\u4e00-\u9fa5]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.substring(0, 100);
	}
}

$effect(() => {
	if (mode === "create" && !slug && title) {
		generateSlug(title);
	}
});

async function loadContent() {
	if (mode === "edit" && post?.slug) {
		isLoadingContent = true;
		try {
			const response = await fetch(
				`/api/admin/post-content/?slug=${post.slug}`,
			);
			const data = await response.json();
			if (data.success && data.content) {
				content = data.content;
			} else {
				content = "";
			}
		} catch {
			content = "";
		} finally {
			isLoadingContent = false;
		}
	}
}

onMount(loadContent);

function addTag() {
	const tag = tagInput.trim();
	if (tag && !tags.includes(tag)) {
		tags = [...tags, tag];
		tagInput = "";
	}
}

function removeTag(index: number) {
	tags = tags.filter((_, i) => i !== index);
}

function handleTagKeydown(e: KeyboardEvent) {
	if (e.key === "Enter" || e.key === ",") {
		e.preventDefault();
		addTag();
	}
}

async function handleSave() {
	if (!title.trim()) {
		onError("请输入文章标题");
		return;
	}

	if (!slug.trim()) {
		onError("请输入文章标识（URL slug）");
		return;
	}

	isSaving = true;

	try {
		const response = await fetch("/api/admin/save/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				slug,
				title,
				author,
				category,
				tags,
				published,
				description,
				draft: isDraft,
				content,
			}),
		});

		const data = await response.json();

		if (response.ok && data.success) {
			onSave();
		} else {
			console.error("[Editor] 保存失败:", data.message);
			onError(data.message || "保存失败");
		}
	} catch (err) {
		console.error("[Editor] 保存请求异常:", err);
		onError(
			`保存请求失败: ${err instanceof Error ? err.message : String(err)}`,
		);
	} finally {
		isSaving = false;
	}
}
</script>

<div class="editor-container">
	<div class="editor-header">
		<h2>{mode === "edit" ? "编辑文章" : "新建文章"}</h2>
		<div class="header-actions">
			<button class="btn btn-cancel" onclick={onCancel}>
				<Icon icon="material-symbols:arrow-back" class="text-sm" />
				取消
			</button>
			<button class="btn btn-save" onclick={handleSave} disabled={isSaving}>
				{#if isSaving}
					<span class="spinner"></span>
					保存中...
				{:else}
					<Icon icon="material-symbols:download" class="text-sm" />
					保存文章
				{/if}
			</button>
		</div>
	</div>

	{#if isLoadingContent}
		<div class="loading-state">
			<div class="loader"></div>
			<p>加载文章内容...</p>
		</div>
	{:else}
		<div class="editor-body">
			<div class="form-section">
				<h3>基本信息</h3>
				<div class="form-grid">
					<div class="form-group">
						<label>
							标题 *
							<input type="text" bind:value={title} placeholder="文章标题" class="form-input" />
						</label>
					</div>

					<div class="form-group">
						<label>
							URL 标识 *
							<input
								type="text"
								bind:value={slug}
								placeholder="用于 URL 的标识，如 my-post"
								class="form-input"
							/>
						</label>
					</div>

					<div class="form-group">
						<label>
							作者
							<input type="text" bind:value={author} placeholder="作者名称" class="form-input" />
						</label>
					</div>

					<div class="form-group">
						<label>
							分类
							<input type="text" bind:value={category} placeholder="文章分类" class="form-input" />
						</label>
					</div>

					<div class="form-group">
						<label>
							发布日期
							<input type="date" bind:value={published} class="form-input" />
						</label>
					</div>

					<div class="form-group checkbox-group">
						<label class="checkbox-label">
							<input type="checkbox" bind:checked={isDraft} />
							<span>标记为草稿</span>
						</label>
					</div>
				</div>

				<div class="form-group">
					<label>
						摘要描述
						<textarea
							bind:value={description}
							placeholder="文章的简要描述（用于SEO和摘要显示）"
							class="form-textarea"
							rows={2}
						></textarea>
					</label>
				</div>

				<div class="form-group">
					<label>
						标签
						<div class="tags-input-wrapper">
							<div class="tags-list">
								{#each tags as tag, i}
									<span class="tag-item">
										{tag}
										<button
											class="tag-remove"
											onclick={() => {
												removeTag(i);
											}}
											aria-label="移除标签"
										>
											<Icon icon="material-symbols:close" class="text-xs" />
										</button>
									</span>
								{/each}
							</div>
							<input
								type="text"
								bind:value={tagInput}
								placeholder="输入标签后按回车添加"
								class="form-input tag-input"
								onkeydown={handleTagKeydown}
							/>
						</div>
					</label>
				</div>
			</div>

			<div class="form-section">
				<h3>文章内容</h3>

				<div class="tabs">
					<button
						class={`tab ${activeTab === "editor" ? "active" : ""}`}
						onclick={() => {
							activeTab = "editor";
						}}
					>
						<Icon icon="material-symbols:ink-pen-outline-rounded" class="text-sm" />
						编辑
					</button>
					<button
						class={`tab ${activeTab === "preview" ? "active" : ""}`}
						onclick={() => {
							activeTab = "preview";
						}}
					>
						<Icon icon="material-symbols:visibility-outline-rounded" class="text-sm" />
						预览
					</button>
				</div>

				{#if activeTab === "editor"}
					<textarea
						bind:value={content}
						placeholder="在这里编写 Markdown 格式的文章内容..."
						class="content-editor"
					></textarea>
				{:else}
					<div class="content-preview">
						<pre>{content || "暂无内容预览"}</pre>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.editor-container {
		background: var(--card-bg);
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-large);
		overflow: hidden;
	}

	.editor-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1.25rem 1.5rem;
		border-bottom: 1px solid var(--line-divider);
	}

	.editor-header h2 {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--deep-text);
	}

	.header-actions {
		display: flex;
		gap: 0.75rem;
	}

	.btn {
		padding: 0.5rem 1rem;
		border: none;
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.btn-cancel {
		background: var(--btn-regular-bg);
		color: var(--deep-text);
	}

	.btn-cancel:hover {
		background: var(--btn-regular-bg-hover);
	}

	.btn-save {
		background: var(--primary);
		color: white;
	}

	.btn-save:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px color-mix(in srgb, var(--primary) 40%, transparent);
	}

	.btn-save:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.spinner {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.loading-state {
		text-align: center;
		padding: 3rem;
	}

	.loader {
		width: 40px;
		height: 40px;
		border: 3px solid var(--line-divider);
		border-top-color: var(--primary);
		border-radius: 50%;
		margin: 0 auto 1rem;
		animation: spin 0.8s linear infinite;
	}

	.loading-state p {
		color: var(--content-meta);
	}

	.editor-body {
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	.form-section {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.form-section h3 {
		font-size: 1rem;
		font-weight: 600;
		color: var(--deep-text);
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--line-divider);
	}

	.form-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
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

	.form-input,
	.form-textarea,
	.content-editor {
		padding: 0.625rem 0.875rem;
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		font-family: inherit;
		transition: border-color 0.15s;
		background: var(--card-bg);
		color: var(--deep-text);
	}

	.form-input:focus,
	.form-textarea:focus,
	.content-editor:focus {
		outline: none;
		border-color: var(--primary);
	}

	.form-textarea {
		resize: vertical;
		min-height: 80px;
	}

	.checkbox-group {
		justify-content: flex-end;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
		font-size: 0.875rem;
		color: var(--deep-text);
	}

	.checkbox-label input {
		width: 18px;
		height: 18px;
		cursor: pointer;
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

	.tabs {
		display: flex;
		gap: 0.25rem;
		border-bottom: 1px solid var(--line-divider);
	}

	.tab {
		padding: 0.625rem 1rem;
		border: none;
		background: none;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--content-meta);
		cursor: pointer;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		transition: all 0.15s;
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.tab.active {
		color: var(--primary);
		border-bottom-color: var(--primary);
	}

	.content-editor {
		min-height: 400px;
		font-family: "Monaco", "Consolas", monospace;
		font-size: 0.875rem;
		line-height: 1.6;
		resize: vertical;
	}

	.content-preview {
		min-height: 400px;
		padding: 1rem;
		background: var(--btn-regular-bg);
		border-radius: var(--radius-md);
		border: 1px solid var(--line-divider);
	}

	.content-preview pre {
		white-space: pre-wrap;
		font-family: inherit;
		font-size: 0.875rem;
		line-height: 1.6;
		color: var(--deep-text);
	}

	@media (max-width: 768px) {
		.editor-header {
			flex-direction: column;
			gap: 1rem;
		}

		.header-actions {
			width: 100%;
		}

		.form-grid {
			grid-template-columns: 1fr;
		}
	}
</style>