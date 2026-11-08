/**
 * 后台正文里的本地图片。
 *
 * 前台由 Astro 内容集合在构建期把 `./images/x.avif` 重写成带哈希的资源地址；
 * 后台的预览与历史版本走的是运行时渲染，拿不到那一步，相对路径会以
 * `/admin/posts/edit/...` 为基准去请求，必然 404。
 *
 * 因此这里提供一个后台专用的取图端点：把仓库内的相对路径还原成真实文件，
 * 本机直接读盘，只读部署（Vercel / Workers）回源到 GitHub raw。
 */

import fs from "node:fs";
import path from "node:path";
import { requireAuth } from "@/utils/auth";
import { getConfig, getInstallationToken } from "@/utils/github-app";

export const prerender = false;

/** 只允许取内容目录与 public 下的资源，避免把配置、密钥之类的文件读出去 */
const ALLOWED_PREFIXES = ["src/content/", "public/"];

const MIME_BY_EXT: Record<string, string> = {
	".avif": "image/avif",
	".webp": "image/webp",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".bmp": "image/bmp",
	".ico": "image/x-icon",
	".mp4": "video/mp4",
	".webm": "video/webm",
};

function notFound(): Response {
	return new Response("Not found", { status: 404 });
}

/** 去掉 `..`、开头的 `./` 与多余分隔符，再确认落在允许的目录里 */
function normalizeAssetPath(raw: string): string | null {
	const cleaned = raw
		.replace(/\\/g, "/")
		.replace(/^\/+/, "")
		.split("/")
		.filter((segment) => segment && segment !== "." && segment !== "..")
		.join("/");
	if (!cleaned) return null;
	if (!ALLOWED_PREFIXES.some((prefix) => cleaned.startsWith(prefix))) {
		return null;
	}
	return cleaned;
}

function mimeOf(filePath: string): string {
	return (
		MIME_BY_EXT[path.extname(filePath).toLowerCase()] ??
		"application/octet-stream"
	);
}

function assetResponse(
	body: Uint8Array | ArrayBuffer,
	filePath: string,
): Response {
	/* 统一拷成 Uint8Array：Buffer 的 ArrayBufferLike 泛型不被 BodyInit 接受 */
	const bytes =
		body instanceof Uint8Array ? Uint8Array.from(body) : new Uint8Array(body);
	return new Response(bytes, {
		status: 200,
		headers: {
			"Content-Type": mimeOf(filePath),
			/* 内容按路径寻址、同一路径内容不变（改动会换文件名），可以放心长缓存 */
			"Cache-Control": "private, max-age=86400",
		},
	});
}

/**
 * 生产环境回源：仓库是公开的时直接取 raw；私有仓库需要 App token，
 * 这里只在 raw 失败时再走一次带鉴权的 API。
 */
async function fetchFromRemote(filePath: string): Promise<Response | null> {
	const { owner, repo, branch } = getConfig();
	if (!owner || !repo) return null;

	try {
		const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
		const raw = await fetch(rawUrl, { signal: AbortSignal.timeout(15_000) });
		if (raw.ok) return assetResponse(await raw.arrayBuffer(), filePath);
	} catch {
		// 落到下面的鉴权分支
	}

	try {
		const token = await getInstallationToken();
		const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`;
		const res = await fetch(apiUrl, {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github.v3.raw",
				"User-Agent": "Firefly-Blog",
			},
			signal: AbortSignal.timeout(15_000),
		});
		if (!res.ok) return null;
		return assetResponse(await res.arrayBuffer(), filePath);
	} catch {
		return null;
	}
}

export async function GET({ request, url }: { request: Request; url: URL }) {
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) {
		return auth.response;
	}

	const filePath = normalizeAssetPath(url.searchParams.get("path") ?? "");
	if (!filePath) return notFound();

	const localRoot = process.cwd();
	const absolute = path.join(localRoot, filePath);
	const relative = path.relative(localRoot, absolute);
	/* 双保险：normalize 之后仍不允许跳出项目根目录 */
	if (relative.startsWith("..") || path.isAbsolute(relative)) return notFound();

	try {
		if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
			return assetResponse(fs.readFileSync(absolute), filePath);
		}
	} catch {
		// 读盘失败就当作本地没有，继续回源
	}

	const remote = await fetchFromRemote(filePath);
	return remote ?? notFound();
}
