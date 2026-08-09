import { profileConfig } from "@/config";

// 解析后台使用的头像 URL：src 目录下的图片需在构建时经 import.meta.glob 解析为产物路径
export function resolveAvatarUrl(): string {
	let avatarUrl = profileConfig.avatar || "";
	if (avatarUrl && !avatarUrl.startsWith("http") && !avatarUrl.startsWith("/")) {
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