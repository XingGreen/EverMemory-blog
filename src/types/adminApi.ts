/**
 * 后台 admin API 的请求/响应形状。
 *
 * 存在的理由：这些接口是手写 REST + 裸 fetch，没有契约约束。返回结构演化时
 * （例如 save/delete 新增 local、remote 两个通道字段），前端只能靠记忆或读实现
 * 来对齐，编译器不会报错。集中定义后，改接口时改这里，调用方会立刻暴露不一致。
 *
 * 只放类型，无运行时产物。
 */

/**
 * 文章在「构建产物」与「GitHub 分支」之间的相对状态。
 * - deployed：两边都有
 * - pending-deploy：GitHub 有、当前构建没有（已提交，等部署）
 * - not-on-github：构建有、GitHub 找不到（未推送，或远端已删）
 * - null：远端清单不可用，本次没判断
 */
export type PostSyncState =
	| "deployed"
	| "pending-deploy"
	| "not-on-github"
	| null;

/** GET /api/admin/posts 的单条文章 */
export type AdminPostSummary = {
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
	password: string;
	/* 列表返回这两个字段是必要的：编辑器以它们初始化表单，
	   缺了就会在保存时把原文件里的值覆盖成默认值（曾导致 passwordHint 丢失、
	   comment 被强制改回 true）。 */
	passwordHint: string;
	comment: boolean;
	image: string;
	pinned: boolean;
	filePath: string;
	syncState: PostSyncState;
	/* 列表可选列：字数与语言代码。旧响应/远端条目可能没有，读的时候按 0 与空串兜底 */
	words?: number;
	lang?: string;
};

export type AdminPostsResponse =
	| { success: true; posts: AdminPostSummary[] }
	| { success: false; message: string };

/**
 * 保存 / 删除等「双通道写入」接口的响应。
 * local 指本地文件系统，remote 指 GitHub；只读部署下 local 恒为 false，
 * 调用方据此区分「已同步」与「仅本地」，不必解析 message 文案。
 */
export type AdminWriteResponse =
	| {
			success: true;
			local: boolean;
			remote: boolean;
			message: string;
			filePath: string;
	  }
	| {
			success: false;
			local?: boolean;
			remote?: boolean;
			message: string;
	  };

/** GET /api/admin/post-content 的响应（正文 + 已解析的 frontmatter） */
export type AdminPostContentResponse =
	| {
			success: true;
			content: string;
			frontmatter: {
				title: string;
				author: string;
				category: string;
				tags: string[];
				published: string;
				updated: string;
				draft: boolean;
				description: string;
				image: string;
				pinned: boolean;
			};
	  }
	| { success: false; message: string };
