import path from "node:path";
import type { UserConfig } from "vitest/config";

const config: UserConfig = {
	test: {
		// 后台工具链（鉴权/会话/存储）全在Node 侧，无 DOM 依赖
		environment: "node",
		include: ["tests/**/*.test.ts"],
		setupFiles: ["./tests/setup.ts"],
	},
	resolve: {
		alias: {
			// 与 tsconfig.json 的 paths 保持一致；缺一个就会解析失败
			"@components": path.resolve(import.meta.dirname, "./src/components"),
			"@assets": path.resolve(import.meta.dirname, "./src/assets"),
			"@constants": path.resolve(import.meta.dirname, "./src/constants"),
			"@utils": path.resolve(import.meta.dirname, "./src/utils"),
			"@i18n": path.resolve(import.meta.dirname, "./src/i18n"),
			"@layouts": path.resolve(import.meta.dirname, "./src/layouts"),
			"@": path.resolve(import.meta.dirname, "./src"),
		},
	},
};

export default config;