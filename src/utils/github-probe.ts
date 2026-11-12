/**
 * GitHub App 凭据的「握手」探测。
 *
 * 与 `verifyPrivateKey` 的分工：
 * - `verifyPrivateKey` 只比对指纹，回答「你框里贴的私钥，是不是我读到的那个」；
 * - 这里是真的让 GitHub 验一次：签一个 JWT 发给 `/app`，再用 installation token
 *   读一次仓库分支。回答「这套凭据此刻通不通」。
 *
 * 「字段填了没」（configured）只有真/假两个值，与凭据是否有效无关——
 * App ID 与私钥对不上、App 被卸载、分支改名，configured 都还是 true。
 * 所以这一页真正需要的结论只能靠真调，不能靠数格子。
 *
 * 设计约束：
 * - 三段各自独立失败，任一段失败不影响另两段出结论（用户要知道坏在哪一环）；
 * - 每段 8s 超时；第 1 段串行（JWT 是所有请求的前提），2/3 并行；
 * - 结果缓存 60s，避免连点把 GitHub 的 5000 次/小时额度打光；
 * - 永不返回私钥、JWT 或 installation token，只返回结论文字。
 */
import {
	createJwt,
	getConfig,
	getInstallationToken,
	getPrivateKey,
} from "./github-app";

export type ProbeStageId = "app" | "repo" | "installation";

export interface ProbeStage {
	id: ProbeStageId;
	ok: boolean;
	/** 一句话结论，成功与失败都直接显示，不做二次翻译 */
	detail: string;
}

export interface ProbeReport {
	checkedAt: number;
	stages: ProbeStage[];
}

const API = "https://api.github.com";
const TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60_000;
const HEADERS = {
	Accept: "application/vnd.github+json",
	"User-Agent": "Firefly-Blog",
	"X-GitHub-Api-Version": "2022-11-28",
};

let cache: { at: number; report: ProbeReport } | null = null;

/** 手写超时而不是 AbortSignal.timeout：两条部署线（Node / Workers）都稳 */
async function ghFetch(url: string, token: string): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		return await fetch(url, {
			method: "GET",
			signal: controller.signal,
			headers: { ...HEADERS, Authorization: `Bearer ${token}` },
		});
	} finally {
		clearTimeout(timer);
	}
}

/** 把 fetch 层的异常翻成一句人话，避免只显示 "fetch failed" */
function transportError(error: unknown): string {
	const err = error as { name?: string; message?: string };
	if (err?.name === "AbortError") return `超时（${TIMEOUT_MS / 1000}s）`;
	return err?.message ? `请求失败：${err.message}` : "请求失败";
}

function clip(text: string, max = 120): string {
	const one = text.replace(/\s+/g, " ").trim();
	return one.length > max ? `${one.slice(0, max)}…` : one;
}

/** 签发一次 JWT，三段共用。签不出来就把原因带出去，让第 1 段如实报。 */
function signJwt(): { jwt: string | null; error: string } {
	try {
		return { jwt: createJwt(getPrivateKey(), getConfig().appId), error: "" };
	} catch (error) {
		return {
			jwt: null,
			error: error instanceof Error ? clip(error.message, 90) : "私钥不可用",
		};
	}
}

/** 第 1 段：JWT 是否被 GitHub 接受。它一失败，后面两段都没有意义。 */
async function checkApp(
	jwt: string | null,
	signError: string,
): Promise<ProbeStage> {
	if (!jwt) {
		return { id: "app", ok: false, detail: signError || "无法签发 JWT" };
	}
	try {
		const res = await ghFetch(`${API}/app`, jwt);
		if (res.ok) {
			const data = (await res.json()) as { slug?: string; name?: string };
			return {
				id: "app",
				ok: true,
				detail: `GitHub 接受了这个 JWT（App：${data.slug || data.name || "未命名"}）`,
			};
		}
		if (res.status === 401) {
			return {
				id: "app",
				ok: false,
				detail: "GitHub 拒绝了这个 JWT：App ID 与私钥不是同一对",
			};
		}
		return {
			id: "app",
			ok: false,
			detail: `GitHub 返回 ${res.status}：${clip(await res.text())}`,
		};
	} catch (error) {
		return { id: "app", ok: false, detail: transportError(error) };
	}
}

/** 第 2 段：用 installation token 读一次仓库分支——这才是「能不能写入」的证据 */
async function checkRepo(): Promise<ProbeStage> {
	const { owner, repo, branch } = getConfig();
	if (!owner || !repo) {
		return { id: "repo", ok: false, detail: "仓库所有者或仓库名为空" };
	}
	try {
		// 走与真实写入完全相同的取 token 路径：这里通了，写入链路就是通的。
		const token = await getInstallationToken();
		const res = await ghFetch(
			`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(branch)}`,
			token,
		);
		if (res.ok) {
			const data = (await res.json()) as {
				name?: string;
				commit?: { commit?: { committer?: { date?: string } } };
			};
			const at = data.commit?.commit?.committer?.date;
			const when = at ? `，最后提交 ${at.slice(0, 10)}` : "";
			return {
				id: "repo",
				ok: true,
				detail: `能读到 ${owner}/${repo}@${data.name || branch}${when}`,
			};
		}
		if (res.status === 404) {
			return {
				id: "repo",
				ok: false,
				detail: `读不到 ${owner}/${repo}@${branch}：分支或仓库不存在，或 App 未被授予该仓库权限`,
			};
		}
		return {
			id: "repo",
			ok: false,
			detail: `GitHub 返回 ${res.status}：${clip(await res.text())}`,
		};
	} catch (error) {
		return {
			id: "repo",
			ok: false,
			detail:
				error instanceof Error ? clip(error.message, 90) : "无法换取 token",
		};
	}
}

/** 第 3 段：App 被装在哪几个账号上，配置的 Installation ID 在不在其中 */
async function checkInstallation(jwt: string | null): Promise<ProbeStage> {
	const { installationId } = getConfig();
	if (!installationId) {
		return { id: "installation", ok: false, detail: "Installation ID 为空" };
	}
	if (!jwt) {
		return {
			id: "installation",
			ok: false,
			detail: "JWT 无法签发，取不到安装列表",
		};
	}
	try {
		const res = await ghFetch(`${API}/app/installations`, jwt);
		if (!res.ok) {
			return {
				id: "installation",
				ok: false,
				detail: `取安装列表失败：GitHub 返回 ${res.status}`,
			};
		}
		const list = (await res.json()) as Array<{
			id?: number;
			account?: { login?: string };
		}>;
		const hit = list.find((it) => String(it.id) === String(installationId));
		if (hit) {
			return {
				id: "installation",
				ok: true,
				detail: `已安装在 ${hit.account?.login || "未知账号"}（共 ${list.length} 个安装）`,
			};
		}
		const names = list
			.map((it) => it.account?.login)
			.filter(Boolean)
			.slice(0, 3)
			.join("、");
		return {
			id: "installation",
			ok: false,
			detail: names
				? `配置的 ID 不在安装列表里（现有：${names}）`
				: "App 还没有安装到任何账号",
		};
	} catch (error) {
		return { id: "installation", ok: false, detail: transportError(error) };
	}
}

/**
 * 跑一轮探测。`force` 为 false 时 60s 内复用上次结果。
 *
 * 永不抛错：任何异常都收敛成一段失败的 stage，因为调用方要展示它。
 */
export async function probeGitHubApp(force = false): Promise<ProbeReport> {
	if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
		return cache.report;
	}

	const { jwt, error } = signJwt();
	const app = await checkApp(jwt, error);
	const [repo, installation] = await Promise.all([
		app.ok
			? checkRepo()
			: Promise.resolve<ProbeStage>({
					id: "repo",
					ok: false,
					detail: "JWT 签发失败，未尝试读取仓库",
				}),
		checkInstallation(app.ok ? jwt : null),
	]);

	const report: ProbeReport = {
		checkedAt: Date.now(),
		stages: [app, repo, installation],
	};
	cache = { at: report.checkedAt, report };
	return report;
}
