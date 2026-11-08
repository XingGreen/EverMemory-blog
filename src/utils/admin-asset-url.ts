/**
 * 后台资源地址换算。
 *
 * 后台（编辑预览 / 历史版本）走运行时渲染，拿不到 Astro 构建期对相对图片路径的
 * 改写，因此统一换算到 `/api/admin/post-asset/`，由它按相对文章文件的位置取图。
 *
 * 绝对地址（http、//、data:、以 `/` 开头的站内路径）原样返回。
 */

const DEFAULT_POST_DIR = "src/content/posts";

/** 文章文件所在目录；没有文件路径时按内容目录根处理 */
export function postDirOf(filePath?: string): string {
	const value = (filePath ?? "").trim().replace(/\\/g, "/");
	if (!value) return DEFAULT_POST_DIR;
	const slash = value.lastIndexOf("/");
	return slash > 0 ? value.slice(0, slash) : DEFAULT_POST_DIR;
}

/** 拼接并消掉 `.` / `..`，不依赖 node:path（组件里也要用） */
export function joinAssetPath(baseDir: string, relative: string): string {
	const segments = `${baseDir}/${relative}`.replace(/\\/g, "/").split("/");
	const stack: string[] = [];
	for (const segment of segments) {
		if (!segment || segment === ".") continue;
		if (segment === "..") {
			stack.pop();
			continue;
		}
		stack.push(segment);
	}
	return stack.join("/");
}

export function isAbsoluteAsset(value: string): boolean {
	return (
		/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(value) ||
		value.startsWith("data:") ||
		value.startsWith("/") ||
		value.startsWith("#")
	);
}

/** 把正文 / frontmatter 里的图片地址换算成后台可用的 URL */
export function resolveAdminAsset(raw: string, filePath?: string): string {
	const value = (raw ?? "").trim();
	if (!value || isAbsoluteAsset(value)) return value;
	const resolved = joinAssetPath(postDirOf(filePath), value);
	return `/api/admin/post-asset/?path=${encodeURIComponent(resolved)}`;
}

/**
 * 批量改写渲染结果里的 `src`：只处理相对路径，其余（外链、站内绝对路径、
 * data URI）保持原样，避免把本来正常的图片改坏。
 */
export function rewriteRelativeSrc(html: string, filePath?: string): string {
	return html.replace(
		/(\ssrc=)(["'])([^"']+)\2/gi,
		(match, prefix: string, quote: string, value: string) => {
			if (isAbsoluteAsset(value.trim())) return match;
			return `${prefix}${quote}${resolveAdminAsset(value, filePath)}${quote}`;
		},
	);
}
