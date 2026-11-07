/**
 * 验证云端草稿的读写一致性：
 *   1. POST 一份带标记的内容
 *   2. 立即 GET，确认返回的就是刚写的那份
 *   3. 再 POST 一份新的，确认 GET 立刻反映最新
 *
 * 用来判断「接口返回旧数据」到底是存储没更新，还是读到了旧快照。
 */
import { readFileSync } from "node:fs";

const ORIGIN = "http://localhost:4321";
const slug = process.argv[2] ?? "probe-consistency";

const env = readFileSync(".env.local", "utf8");
const token = env
	.split(/\r?\n/)
	.find((l) => l.startsWith("ADMIN_BREAKGLASS_TOKEN="))
	.split("=")
	.slice(1)
	.join("=")
	.replace(/^["']|["']$/g, "");

const verify = await fetch(`${ORIGIN}/api/admin/verify/`, {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({ token }),
});
const cookie = (verify.headers.getSetCookie?.() ?? [])
	.map((c) => c.split(";")[0])
	.join("; ");

const post = (payload) =>
	fetch(`${ORIGIN}/api/admin/draft/`, {
		method: "POST",
		headers: { "Content-Type": "application/json", cookie },
		body: JSON.stringify({ slug, ...payload }),
	}).then((r) => r.json());

const get = () =>
	fetch(`${ORIGIN}/api/admin/draft/?slug=${encodeURIComponent(slug)}`, {
		headers: { cookie },
	}).then((r) => r.json());

const marker = (n) => `<!-- round-${n} -->`;

for (const round of [1, 2]) {
	const written = await post({
		title: `探针 ${round}`,
		content: `内容第 ${round} 轮 ${marker(round)}`,
		device: "Probe",
	});
	const read = await get();
	const stored = read.draft?.content ?? "";
	console.log(
		`第 ${round} 轮 | 写入成功: ${written.success} | 读到标记: ${stored.includes(marker(round))} | 内容: ${JSON.stringify(stored.slice(0, 40))}`,
	);
}

/* 清理探针数据 */
await fetch(`${ORIGIN}/api/admin/draft/?slug=${encodeURIComponent(slug)}`, {
	method: "DELETE",
	headers: { cookie },
});
console.log("探针草稿已清理");
