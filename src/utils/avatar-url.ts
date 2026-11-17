import { profileConfig } from "@/config";
import { readSecretValue } from "@/utils/secret-io";

// 解析后台使用的头像 URL：src 目录下的图片需在构建时经 import.meta.glob 解析为产物路径
export function resolveAvatarUrl(): string {
	let avatarUrl = profileConfig.avatar || "";
	if (
		avatarUrl &&
		!avatarUrl.startsWith("http") &&
		!avatarUrl.startsWith("/")
	) {
		const images = import.meta.glob(
			"/src/assets/images/*.{avif,webp,jpg,jpeg,png,gif,svg}",
			{
				eager: true,
				query: "?url",
				import: "default",
			},
		);
		avatarUrl = (images[`/src/${avatarUrl}`] as string) || avatarUrl;
	}
	return avatarUrl;
}

/**
 * 后台侧边栏头像：跟随当前登录账号（ADMIN_GITHUB_ID 白名单里的那个）。
 * GitHub 头像 CDN 支持按数字 ID 直取，无需调用 API；
 * 未配置 ID 时回退到博主头像（profileConfig.avatar）。
 */
export function resolveAdminAvatarUrl(): string {
	const adminId = readSecretValue("ADMIN_GITHUB_ID").trim();
	if (adminId && /^\d+$/.test(adminId)) {
		return `https://avatars.githubusercontent.com/u/${adminId}`;
	}
	return resolveAvatarUrl();
}
