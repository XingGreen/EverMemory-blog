import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FriendLink } from "@/types/friendsConfig";
import { requireAuth } from "@/utils/auth";
import { IS_PROD_BUILD } from "@/utils/env";

export const prerender = false;

const LINKS_PATH = "src/data/friends.json";

function absPath(): string {
	return path.resolve(process.cwd(), LINKS_PATH);
}

function readLinks(): FriendLink[] {
	const file = absPath();
	if (!existsSync(file)) return [];
	try {
		return JSON.parse(readFileSync(file, "utf-8")) as FriendLink[];
	} catch {
		return [];
	}
}

/**
 * 逐条校验后写盘。
 *
 * 编译期有 `satisfies FriendLink[]` 兜底，但那要等构建才报错；
 * 后台写入的是运行时的任意 JSON，结构错了会让**下一次构建直接失败**，
 * 所以这里必须先挡一道。
 */
function validate(
	input: unknown,
): { ok: true; links: FriendLink[] } | { ok: false; message: string } {
	if (!Array.isArray(input)) return { ok: false, message: "links 必须是数组" };

	const links: FriendLink[] = [];
	for (let i = 0; i < input.length; i++) {
		const raw = input[i] as Record<string, unknown>;
		const at = `第 ${i + 1} 项`;
		if (typeof raw !== "object" || raw === null) {
			return { ok: false, message: `${at}不是对象` };
		}

		const title = typeof raw.title === "string" ? raw.title.trim() : "";
		if (!title) return { ok: false, message: `${at}缺少名称` };

		const siteurl = typeof raw.siteurl === "string" ? raw.siteurl.trim() : "";
		if (!/^https?:\/\/\S+$/.test(siteurl)) {
			return {
				ok: false,
				message: `${at}的站点地址不合法（需以 http(s):// 开头）`,
			};
		}

		const imgurl = typeof raw.imgurl === "string" ? raw.imgurl.trim() : "";
		const desc = typeof raw.desc === "string" ? raw.desc.trim() : "";
		const tags = Array.isArray(raw.tags)
			? raw.tags.filter((t): t is string => typeof t === "string" && !!t.trim())
			: [];

		links.push({
			title,
			siteurl,
			imgurl,
			desc,
			tags,
			weight: Number.isFinite(raw.weight) ? Number(raw.weight) : 0,
			enabled: raw.enabled !== false,
		});
	}
	return { ok: true, links };
}

function toJson(links: FriendLink[]): string {
	return `${JSON.stringify(links, null, "\t")}\n`;
}

export async function GET({ request }) {
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	return new Response(
		JSON.stringify({
			success: true,
			links: readLinks(),
			/* 生产环境项目目录只读，页据此提示「改不了」而不是让用户白填表单 */
			writable: !IS_PROD_BUILD,
		}),
		{ status: 200, headers: { "Content-Type": "application/json" } },
	);
}

export async function POST({ request }) {
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	if (IS_PROD_BUILD) {
		return new Response(
			JSON.stringify({
				success: false,
				message: "当前部署环境为只读，友链需在本地修改后推送",
			}),
			{ status: 403, headers: { "Content-Type": "application/json" } },
		);
	}

	try {
		const body = await request.json();
		const result = validate(body?.links);
		if (!result.ok) {
			return new Response(
				JSON.stringify({ success: false, message: result.message }),
				{ status: 400, headers: { "Content-Type": "application/json" } },
			);
		}

		const file = absPath();
		const before = existsSync(file) ? readFileSync(file, "utf-8") : "";
		const next = toJson(result.links);
		if (before === next) {
			return new Response(
				JSON.stringify({
					success: true,
					message: "内容没有变化",
					count: result.links.length,
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}
		writeFileSync(file, next, "utf-8");

		return new Response(
			JSON.stringify({
				success: true,
				message: `已保存 ${result.links.length} 条友链`,
				count: result.links.length,
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	} catch (error) {
		return new Response(
			JSON.stringify({
				success: false,
				message: error instanceof Error ? error.message : String(error),
			}),
			{ status: 500, headers: { "Content-Type": "application/json" } },
		);
	}
}
