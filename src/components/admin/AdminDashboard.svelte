<script lang="ts">
	import { onMount } from "svelte";
	import Icon from "@/components/common/Icon.svelte";
	import VerifyScreen from "./VerifyScreen.svelte";
	import PostList from "./PostList.svelte";
	import PostEditor from "./PostEditor.svelte";
	import DeleteConfirmModal from "./DeleteConfirmModal.svelte";

	type Post = {
		id: string;
		slug: string;
		title: string;
		author: string;
		category: string;
		tags: string[];
		published: string;
		updated: string | null;
		draft: boolean;
		description: string;
		image: string;
		pinned: boolean;
		filePath: string;
	};

	type ViewMode = "list" | "edit" | "create";

	let isVerified = $state(false);
	let privateKey = $state("");
	let posts = $state<Post[]>([]);
	let isLoading = $state(true);
	let error = $state("");
	let viewMode = $state<ViewMode>("list");
	let editingPost = $state<Post | null>(null);
	let showDeleteModal = $state(false);
	let deletingPost = $state<Post | null>(null);
	let toast = $state<{ message: string; type: "success" | "error" } | null>(null);

	onMount(() => {
		const stored = sessionStorage.getItem("admin_verified");
		const storedKey = sessionStorage.getItem("admin_private_key");
		if (stored === "true" && storedKey) {
			isVerified = true;
			privateKey = storedKey;
			loadPosts();
		}
	});

	async function loadPosts() {
		isLoading = true;
		error = "";
		try {
			const response = await fetch("/api/admin/posts/");
			const data = await response.json();
			if (data.success) {
				posts = data.posts;
			} else {
				error = data.message || "获取文章列表失败";
			}
		} catch {
			error = "网络请求失败";
		} finally {
			isLoading = false;
		}
	}

	function handleVerify(key: string, success: boolean) {
		if (success) {
			isVerified = true;
			privateKey = key;
			sessionStorage.setItem("admin_verified", "true");
			sessionStorage.setItem("admin_private_key", key);
			loadPosts();
			showToast("验证成功", "success");
		} else {
			showToast("私钥验证失败", "error");
		}
	}

	function handleLogout() {
		isVerified = false;
		privateKey = "";
		sessionStorage.removeItem("admin_verified");
		sessionStorage.removeItem("admin_private_key");
		showToast("已退出", "success");
	}

	function handleEditPost(post: Post) {
		editingPost = post;
		viewMode = "edit";
	}

	function handleCreatePost() {
		editingPost = null;
		viewMode = "create";
	}

	function handleSaveSuccess() {
		viewMode = "list";
		editingPost = null;
		loadPosts();
		showToast("保存成功", "success");
	}

	function handleCancelEdit() {
		viewMode = "list";
		editingPost = null;
	}

	function handleDeleteClick(post: Post) {
		deletingPost = post;
		showDeleteModal = true;
	}

	async function handleConfirmDelete() {
		if (!deletingPost) return;

		try {
			const response = await fetch("/api/admin/delete/", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					slug: deletingPost.slug,
					title: deletingPost.title,
				}),
			});
			const data = await response.json();
			if (data.success) {
				showToast("删除成功", "success");
				loadPosts();
			} else {
				console.error("[Admin] 删除失败:", data.message);
				showToast(data.message || "删除失败", "error", 10000);
			}
		} catch (err) {
			console.error("[Admin] 删除请求异常:", err);
			showToast(`删除请求失败: ${err instanceof Error ? err.message : String(err)}`, "error", 10000);
		} finally {
			showDeleteModal = false;
			deletingPost = null;
		}
	}

	function showToast(message: string, type: "success" | "error", duration = 3000) {
		toast = { message, type };
		if (type === "error") {
			console.error("[Toast] Error:", message);
		}
		setTimeout(() => {
			toast = null;
		}, duration);
	}

	function closeToast() {
		toast = null;
	}
</script>

{#if !isVerified}
	<VerifyScreen onVerify={handleVerify} />
{:else}
	<div class="admin-wrapper">
		<div class="card-base admin-header">
			<div class="header-content">
				<div class="header-title">
					<div class="title-icon">
						<Icon icon="material-symbols:article-outline" class="text-xl" />
					</div>
					<div class="title-text">
						<h1>文章管理</h1>
						<span class="subtitle">管理你的博客文章</span>
					</div>
				</div>
			</div>
			<div class="header-actions">
				{#if viewMode === "list"}
					<button class="action-btn primary" onclick={handleCreatePost}>
						<Icon icon="material-symbols:edit-calendar-outline-rounded" class="text-sm" />
						<span>新建文章</span>
					</button>
				{/if}
				<button class="action-btn secondary" onclick={handleLogout}>
					<Icon icon="material-symbols:arrow-back" class="text-sm" />
					<span>退出</span>
				</button>
			</div>
		</div>

		<div class="admin-content">
			{#if viewMode === "list"}
				<PostList
					posts={posts}
					isLoading={isLoading}
					error={error}
					onEdit={handleEditPost}
					onDelete={handleDeleteClick}
					onRefresh={loadPosts}
				/>
			{:else if viewMode === "edit" && editingPost}
				<PostEditor
					post={editingPost}
					mode="edit"
					onSave={handleSaveSuccess}
					onCancel={handleCancelEdit}
					onError={(msg) => showToast(msg, "error", 10000)}
				/>
			{:else if viewMode === "create"}
				<PostEditor
					post={null}
					mode="create"
					onSave={handleSaveSuccess}
					onCancel={handleCancelEdit}
					onError={(msg) => showToast(msg, "error", 10000)}
				/>
			{/if}
		</div>
	</div>

	{#if showDeleteModal && deletingPost}
		<DeleteConfirmModal
			title={deletingPost.title}
			onConfirm={handleConfirmDelete}
			onCancel={() => {
				showDeleteModal = false;
				deletingPost = null;
			}}
		/>
	{/if}

	{#if toast}
		<div class={`toast ${toast.type}`}>
			<Icon
				icon={toast.type === "success" ? "material-symbols:check" : "material-symbols:error-outline"}
				class="text-lg"
			/>
			<span class="toast-message">{toast.message}</span>
			<button class="toast-close" onclick={closeToast} aria-label="关闭通知">
				<Icon icon="material-symbols:close" class="text-sm" />
			</button>
		</div>
	{/if}
{/if}

<style>
	.admin-wrapper {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.admin-header {
		padding: 1.25rem 1.5rem;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
	}

	.header-content {
		flex: 1;
	}

	.header-title {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.title-icon {
		width: 2.5rem;
		height: 2.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--primary);
		color: white;
		border-radius: var(--radius-md);
	}

	.title-text h1 {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--deep-text);
		line-height: 1.2;
	}

	.subtitle {
		font-size: 0.875rem;
		color: var(--content-meta);
		margin-top: 0.25rem;
		display: block;
	}

	.header-actions {
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.action-btn {
		padding: 0.5rem 1rem;
		border: none;
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-family: inherit;
	}

	.action-btn.primary {
		background: var(--primary);
		color: white;
	}

	.action-btn.primary:hover {
		opacity: 0.9;
		transform: translateY(-1px);
	}

	.action-btn.secondary {
		background: var(--btn-regular-bg);
		color: var(--deep-text);
	}

	.action-btn.secondary:hover {
		background: var(--btn-regular-bg-hover);
	}

	.admin-content {
		flex: 1;
	}

	.toast {
		position: fixed;
		top: 5rem;
		right: 2rem;
		padding: 0.75rem 1.25rem;
		border-radius: var(--radius-md);
		color: white;
		font-weight: 500;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		animation: slideIn 0.3s ease-out;
		z-index: 9999;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.toast.success {
		background: #22c55e;
	}

	.toast.error {
		background: #ef4444;
	}

	.toast-message {
		flex: 1;
		min-width: 0;
		word-break: break-word;
	}

	.toast-close {
		background: rgba(255, 255, 255, 0.2);
		border: none;
		border-radius: 50%;
		width: 1.5rem;
		height: 1.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		color: white;
		padding: 0;
		flex-shrink: 0;
		transition: background 0.2s;
	}

	.toast-close:hover {
		background: rgba(255, 255, 255, 0.4);
	}

	.toast-close:focus {
		outline: 2px solid white;
		outline-offset: 2px;
	}

	@keyframes slideIn {
		from {
			opacity: 0;
			transform: translateX(100%);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}

	@media (max-width: 768px) {
		.admin-header {
			flex-direction: column;
			align-items: stretch;
			text-align: center;
		}

		.header-title {
			justify-content: center;
		}

		.header-actions {
			justify-content: center;
		}

		.toast {
			top: 5rem;
			left: 1rem;
			right: 1rem;
		}
	}
</style>
