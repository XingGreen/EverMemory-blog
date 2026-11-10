import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 远端运行时（Vercel / Workers）下配置读取的两条通道：
 * 表单数据来自构建快照，源码来自 GitHub。两者互不依赖，任一条可用就不该整页失败。
 */
let remote = true;
let snapshot: Record<string, unknown> | undefined;
let githubSource: string | null = null;

vi.mock("@utils/auth", () => ({
	requireAuth: async () => ({
		authenticated: true,
		payload: { sid: "s1", username: "EM" },
	}),
}));

vi.mock("@utils/admin-settings", () => ({
	getConfigItem: (key: string) => {
		if (key === "site")
			return {
				key,
				file: "src/config/siteConfig.ts",
				exportName: "siteConfig",
				typeName: "SiteConfig",
				kind: "json",
			};
		if (key === "footer-html")
			return {
				key,
				file: "src/config/footerConfig.ts",
				exportName: "",
				typeName: "",
				kind: "html",
			};
		return undefined;
	},
}));

vi.mock("@utils/config-io", () => ({
	isRemoteRuntime: () => remote,
	// 真实实现返回的是整条快照条目 { data, source }，不是配置值本身
	readConfigSnapshot: async (key: string) => snapshot?.[key],
	readConfigSourceFromGitHub: async () => githubSource,
	readConfigJson: () => ({ data: { title: "本地" } }),
	readConfigSource: () => "export const siteConfig = {};",
	saveConfigJson: async () => ({ local: true, github: false }),
	saveConfigJsonRemote: async () => true,
	saveConfigSource: async () => ({ local: true, github: false }),
}));

vi.mock("@utils/providers/registry", () => ({
	getStorageProvider: () => ({
		isConfigured: () => true,
		readFile: async () => ({ ok: false }),
		writeFile: async () => true,
	}),
}));

const loadEndpoint = () => import("@/pages/api/admin/configs/[key]");

const requestFor = (key: string) =>
	new Request(`http://localhost/api/admin/configs/${key}/`);

const readConfig = async (key: string) => {
	const { GET } = await loadEndpoint();
	const res = await GET({ request: requestFor(key), params: { key } });
	return { status: res.status, body: await res.json() };
};

describe("GET /api/admin/configs/[key] — 远端运行时降级", () => {
	afterEach(() => {
		vi.resetModules();
		remote = true;
		snapshot = undefined;
		githubSource = null;
	});

	it("GitHub 读不到时仍返回快照里的配置值", async () => {
		snapshot = { site: { data: { title: "快照标题" }, source: "old source" } };
		githubSource = null;

		const { status, body } = await readConfig("site");

		expect(status).toBe(200);
		expect(body.success).toBe(true);
		// 断言的是「配置值本身」，不是 { data, source } 包装：
		// 返回包装时表单会把 data/source 当成配置字段，整页渲染成空值。
		expect(body.data).toEqual({ title: "快照标题" });
		expect(body.data).not.toHaveProperty("source");
		expect(body.source).toBeNull();
	});

	it("源码可读时同时返回源码，供源码模式编辑", async () => {
		snapshot = { site: { data: { title: "快照标题" }, source: "old source" } };
		githubSource = "export const siteConfig = { title: '新' };";

		const { status, body } = await readConfig("site");

		expect(status).toBe(200);
		expect(body.data).toEqual({ title: "快照标题" });
		expect(body.source).toBe("export const siteConfig = { title: '新' };");
	});

	it("快照与源码都拿不到才报失败", async () => {
		snapshot = undefined;
		githubSource = null;

		const { status, body } = await readConfig("site");

		expect(status).toBe(500);
		expect(body.success).toBe(false);
	});

	it("快照缺失但源码可读：降级为纯源码模式", async () => {
		snapshot = undefined;
		githubSource = "export const siteConfig = {};";

		const { status, body } = await readConfig("site");

		expect(status).toBe(200);
		expect(body.data).toBeNull();
		expect(body.source).toBe("export const siteConfig = {};");
	});

	it("html 配置读不到源码时不拿构建快照顶替", async () => {
		// 拿旧快照顶替会让过期内容冒充当前版本，保存即回滚线上文件
		snapshot = { "footer-html": { source: "<footer>旧</footer>" } };
		githubSource = null;

		const { status, body } = await readConfig("footer-html");

		expect(status).toBe(500);
		expect(body.success).toBe(false);
	});

	it("本地运行时不受影响：读盘取数", async () => {
		remote = false;

		const { status, body } = await readConfig("site");

		expect(status).toBe(200);
		expect(body.data).toEqual({ title: "本地" });
		expect(body.remote).toBe(false);
	});

	it("未知配置项返回 404", async () => {
		const { status } = await readConfig("not-a-key");
		expect(status).toBe(404);
	});
});
