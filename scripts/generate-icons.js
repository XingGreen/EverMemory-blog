/**
 * 图标预处理脚本
 * 在构建时自动扫描 Svelte 组件中使用的图标，并生成内联 SVG 数据
 *
 * 使用方法：node scripts/generate-icons.js
 */

import { getIconData, iconToHTML, iconToSVG, replaceIDs } from "@iconify/utils";
import { readdirSync, readFileSync, statSync, watch, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, "..");
const SRC_DIR = join(ROOT_DIR, "src");
const OUTPUT_FILE = join(SRC_DIR, "constants", "icons.ts");

// 支持的图标集及其包名
const ICON_SETS = {
	"material-symbols": "@iconify-json/material-symbols",
	"fa7-solid": "@iconify-json/fa7-solid",
	"fa7-brands": "@iconify-json/fa7-brands",
	"fa7-regular": "@iconify-json/fa7-regular",
	mdi: "@iconify-json/mdi",
	"simple-icons": "@iconify-json/simple-icons",
	mingcute: "@iconify-json/mingcute",
	"svg-spinners": "@iconify-json/svg-spinners",
};

// 图标集数据缓存
const iconSetCache = new Map();

/**
 * 递归获取目录下所有文件
 */
function getAllFiles(dir, extensions = [".svelte", ".astro", ".ts", ".js"]) {
	const files = [];

	function walk(currentDir) {
		const items = readdirSync(currentDir);
		for (const item of items) {
			const fullPath = join(currentDir, item);
			const stat = statSync(fullPath);

			if (stat.isDirectory()) {
				// 跳过 node_modules 和隐藏目录
				if (!item.startsWith(".") && item !== "node_modules") {
					walk(fullPath);
				}
			} else if (extensions.some((ext) => item.endsWith(ext))) {
				files.push(fullPath);
			}
		}
	}

	walk(dir);
	return files;
}

/**
 * 从文件内容中提取图标名称
 */
function extractIconNames(content) {
	const icons = new Set();

	// 剔除 <meta> 标签：其 name/property 属性（如 twitter:card）与图标格式冲突，会被误判为图标调用
	const cleaned = content.replace(/<meta\b[^>]*>/gi, "");

	// 匹配各种图标使用模式
	const patterns = [
		// icon="xxx:yyy" 或 icon='xxx:yyy'
		/icon=["']([a-z0-9_-]+:[a-z0-9_-]+)["']/gi,
		// icon: "xxx:yyy" 或 icon: 'xxx:yyy' (TS/JS 配置对象)
		// 同时覆盖 iconOutline / iconFilled 等以 icon 开头的成对状态字段，
		// 使空心/实心两态都能被离线预生成（值必须是 "图标集:图标名" 才会命中，
		// 因此 iconSize: "24" 之类不会误匹配）
		/\bicon\w*\s*:\s*["']([a-z0-9_-]+:[a-z0-9_-]+)["']/gi,
		// icon={`xxx:yyy`}
		/icon=\{[`"']([a-z0-9_-]+:[a-z0-9_-]+)[`"']\}/gi,
		// name="xxx:yyy" (Astro 组件)
		/name=["']([a-z0-9_-]+:[a-z0-9_-]+)["']/gi,
		// getIconSvg("xxx:yyy") 或 getIconSvg('xxx:yyy')
		/getIconSvg\(["']([a-z0-9_-]+:[a-z0-9_-]+)["']\)/gi,
		// hasIcon("xxx:yyy")
		/hasIcon\(["']([a-z0-9_-]+:[a-z0-9_-]+)["']\)/gi,
	];

	for (const pattern of patterns) {
		// 等价于 while ((m = pattern.exec(...)) !== null) 的惯用循环；
		// matchAll 需要 /g 标志，上面所有 pattern 均带
		for (const match of cleaned.matchAll(pattern)) {
			icons.add(match[1]);
		}
	}

	return icons;
}

/**
 * 加载图标集数据
 */
async function loadIconSet(prefix) {
	if (iconSetCache.has(prefix)) {
		return iconSetCache.get(prefix);
	}

	const packageName = ICON_SETS[prefix];
	if (!packageName) {
		console.warn(`⚠️  未知图标集: ${prefix}`);
		return null;
	}

	try {
		// 动态导入图标集 JSON
		const iconSetPath = join(
			ROOT_DIR,
			"node_modules",
			packageName,
			"icons.json",
		);
		const data = JSON.parse(readFileSync(iconSetPath, "utf-8"));
		iconSetCache.set(prefix, data);
		return data;
	} catch (error) {
		console.warn(`⚠️  无法加载图标集 ${packageName}: ${error.message}`);
		return null;
	}
}

/**
 * 获取单个图标的 SVG
 */
async function getIconSvg(iconName) {
	const [prefix, name] = iconName.split(":");
	if (!prefix || !name) {
		console.warn(`⚠️  无效的图标名称: ${iconName}`);
		return null;
	}

	const iconSet = await loadIconSet(prefix);
	if (!iconSet) {
		return null;
	}

	const iconData = getIconData(iconSet, name);
	if (!iconData) {
		console.warn(`⚠️  图标未找到: ${iconName}`);
		return null;
	}

	// 转换为 SVG
	const renderData = iconToSVG(iconData, {
		height: "1em",
		width: "1em",
	});

	let svg = iconToHTML(replaceIDs(renderData.body), renderData.attributes);

	// 确保支持 currentColor
	if (!svg.includes("currentColor")) {
		svg = svg.replace("<svg", '<svg fill="currentColor"');
	}

	return svg;
}

/**
 * 生成 icons.ts 文件
 */
function generateIconsFile(iconsMap) {
	const iconEntries = Array.from(iconsMap.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, svg]) => `\t"${name}":\n\t\t'${svg.replace(/'/g, "\\'")}'`)
		.join(",\n");

	const content = `/**
 * 自动生成的图标数据文件
 * 由 scripts/generate-icons.js 在构建时生成
 * 请勿手动编辑此文件
 */

const iconSvgData: Record<string, string> = {
${iconEntries}
};

/**
 * 根据 iconify 格式的图标名获取内联 SVG HTML
 * @param iconName 图标名称，如 "material-symbols:search"
 * @returns SVG HTML 字符串
 */
export function getIconSvg(iconName: string): string {
	return iconSvgData[iconName] || "";
}

/**
 * 检查图标是否可用
 */
export function hasIcon(iconName: string): boolean {
	return iconName in iconSvgData;
}

/**
 * 获取所有可用图标名称
 */
export function getAvailableIcons(): string[] {
	return Object.keys(iconSvgData);
}

export default iconSvgData;
`;

	return content;
}

/**
 * 主函数
 */
async function main(options = {}) {
	const { quiet = false } = options;
	const log = quiet ? () => {} : console.log.bind(console);

	log("🔍 扫描源文件中的图标使用...\n");

	// 获取所有源文件
	const files = getAllFiles(SRC_DIR);
	log(`📁 找到 ${files.length} 个源文件\n`);

	// 收集所有使用的图标
	const allIcons = new Set();

	for (const file of files) {
		// 跳过 icons.ts 文件本身
		if (file.endsWith("icons.ts")) continue;

		const content = readFileSync(file, "utf-8");
		const icons = extractIconNames(content);

		for (const icon of icons) {
			allIcons.add(icon);
		}
	}

	log(`🎨 发现 ${allIcons.size} 个不同的图标:\n`);

	// 按图标集分组显示
	const iconsBySet = {};
	for (const icon of allIcons) {
		const [prefix] = icon.split(":");
		if (!iconsBySet[prefix]) {
			iconsBySet[prefix] = [];
		}
		iconsBySet[prefix].push(icon);
	}

	for (const [prefix, icons] of Object.entries(iconsBySet)) {
		log(`   ${prefix}: ${icons.length} 个图标`);
	}
	log("");

	// 获取所有图标的 SVG
	const iconsMap = new Map();
	let successCount = 0;
	let failCount = 0;
	const missing = [];

	for (const iconName of allIcons) {
		const svg = await getIconSvg(iconName);
		if (svg) {
			iconsMap.set(iconName, svg);
			successCount++;
		} else {
			failCount++;
			missing.push(iconName);
		}
	}

	log(`✅ 成功加载 ${successCount} 个图标`);
	if (failCount > 0) {
		log(`❌ 失败 ${failCount} 个图标: ${missing.join(", ")}`);
	}

	// 生成输出文件
	const output = generateIconsFile(iconsMap);
	writeFileSync(OUTPUT_FILE, output, "utf-8");

	log(`\n📝 已生成: ${OUTPUT_FILE}`);
	log(`📦 文件大小: ${(Buffer.byteLength(output, "utf-8") / 1024).toFixed(2)} KB\n`);

	return { successCount, failCount, missing, output };
}

/**
 * watch 模式：监听 src/ 下源码变化，自动重新生成图标表。
 *
 * 背景：图标表是构建产物，新增图标引用后若忘记跑 `pnpm icons`，
 * 运行时会报「Icon not found」。此前已踩过两次（轮换按钮、私钥弹窗）。
 * dev 时由 `pnpm dev` 并行启动本脚本，保存文件即自动补全。
 *
 * 防抖 400ms：编辑器保存常触发多次事件（写入 + 元数据）。
 */
function startWatch() {
	let timer = null;
	let lastOutput = null;

	const rebuild = async () => {
		try {
			const result = await main({ quiet: true });
			// 仅在产物内容变化时提示，避免无意义的刷屏
			if (result.output !== lastOutput) {
				lastOutput = result.output;
				const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
				console.log(
					`[icons] ${time} 已更新图标表（${result.successCount} 个图标）`,
				);
				if (result.failCount > 0) {
					console.warn(
						`[icons] ⚠️  以下图标未找到，请检查名称拼写: ${result.missing.join(", ")}`,
					);
				}
			}
		} catch (err) {
			console.error("[icons] 生成失败:", err);
		}
	};

	const schedule = () => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(rebuild, 400);
	};

	// 先跑一次，确保启动时产物是最新的
	main({ quiet: true })
		.then((r) => {
			lastOutput = r.output;
			console.log(
				`[icons] watch 已启动（当前 ${r.successCount} 个图标），监听 src/ 变化…`,
			);
			if (r.failCount > 0) {
				console.warn(
					`[icons] ⚠️  以下图标未找到: ${r.missing.join(", ")}`,
				);
			}
		})
		.catch((err) => console.error("[icons] 初次生成失败:", err));

	// 监听 src/ 递归变化；icons.ts 自身写入需忽略，否则会自触发死循环
	watch(
		SRC_DIR,
		{ recursive: true },
		(eventType, filename) => {
			if (!filename) return;
			if (filename.endsWith("icons.ts")) return;
			if (!/\.(svelte|astro|ts|js|mjs)$/.test(filename)) return;
			schedule();
		},
	);

	// 保持进程存活
	process.stdin.resume();
}

if (process.argv.includes("--watch")) {
	startWatch();
} else {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
