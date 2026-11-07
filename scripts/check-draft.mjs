import { readFileSync } from "node:fs";

const raw = readFileSync("src/content/posts/demodemodemodemo.md", "utf8");
const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
const fm = m ? m[1] : "";
const body = m ? m[2] : raw;

const pick = (key) => {
	const line = fm.split("\n").find((l) => l.startsWith(`${key}:`));
	return line
		? line
				.slice(key.length + 1)
				.trim()
				.replace(/^["']|["']$/g, "")
		: undefined;
};

const draft = JSON.parse(
	readFileSync(".data/persist/admin_draft%3Ademodemodemodemo.json", "utf8"),
).v;

console.log("正文 :", {
	title: pick("title"),
	description: pick("description")?.slice(0, 30),
	len: body.trim().length,
	head: JSON.stringify(body.trim().slice(0, 30)),
});

console.log("草稿 :", {
	title: draft.title,
	description: (draft.description ?? "").slice(0, 30),
	len: (draft.content ?? "").trim().length,
	head: JSON.stringify((draft.content ?? "").trim().slice(0, 30)),
	device: draft.device,
	savedAt: new Date(draft.savedAt).toISOString(),
});

console.log("---");
console.log("content 相同:", (draft.content ?? "").trim() === body.trim());
console.log("title 相同  :", (draft.title ?? "") === (pick("title") ?? ""));
console.log(
	"desc 相同   :",
	(draft.description ?? "") === (pick("description") ?? ""),
);

/* 差异定位：从头和尾各取一截，找出草稿多出来的部分 */
const a = body.trim();
const b = (draft.content ?? "").trim();
let head = 0;
while (head < a.length && head < b.length && a[head] === b[head]) head++;
let tail = 0;
while (
	tail < a.length - head &&
	tail < b.length - head &&
	a[a.length - 1 - tail] === b[b.length - 1 - tail]
)
	tail++;

console.log("---");
console.log("公共前缀长度:", head);
console.log("公共后缀长度:", tail);
console.log("正文中段:", JSON.stringify(a.slice(head, a.length - tail)));
console.log("草稿中段:", JSON.stringify(b.slice(head, b.length - tail)));
