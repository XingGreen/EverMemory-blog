#!/usr/bin/env node
/**
 * 提交信息校验（零依赖，供 .git/hooks/commit-msg 调用）。
 *
 * 拦截三类问题，都是这个仓库真实踩过的：
 *   1. 格式不符 Conventional Commits —— 无法被工具解析
 *   2. 标题过长或含破折号 —— 后半句本该放进正文
 *   3. 正文混入对话记录 —— 「上一轮」「我的」「实测」「你看到」这类词
 *
 * 第 3 条是重点。commit 只描述改了什么，不记录对话经过、
 * 不写论证、不写评价；那些属于 PR 描述或 issue。
 */
import { readFileSync } from "node:fs";

const TYPES = [
	"feat",
	"fix",
	"refactor",
	"perf",
	"style",
	"docs",
	"test",
	"build",
	"ci",
	"chore",
	"revert",
];

/** 标题上限。Conventional Commits 建议 50；这里放宽到 100：
    上限按「字符」算，中文 72 字已经很宽裕，英文 72 字符只够一句话，
    正常的英文描述会被误伤。100 仍然逼着写短句。 */
const MAX_SUBJECT = 100;

/** 正文里不该出现的对话痕迹。只收「只在对话里才会出现」的词——
    像「实测」这类有技术含义的说法不能算，否则会拦住正常的技术记录。 */
const BANNED = [
	"上一轮",
	"上一版",
	"我改",
	"我把",
	"我在",
	"使用者看到",
	"你说",
	"你报",
	"你看到",
	"你日志",
	"用户反馈",
	"按你要求",
	"抱歉",
];

const msgFile = process.argv[2];
if (!msgFile) {
	console.error("[commit-msg] 缺少提交信息文件路径");
	process.exit(1);
}

const raw = readFileSync(msgFile, "utf-8");

// 注释行与模板空行不计入
const lines = raw
	.split("\n")
	.filter((l) => !l.startsWith("#"))
	.map((l) => l.replace(/\s+$/, ""));

while (lines.length > 0 && lines[0].trim() === "") lines.shift();
const subject = lines[0] ?? "";
const body = lines.slice(1).join("\n");

const errors = [];
/** 针对性的改法建议：光说「格式不符」用户还得自己猜 */
const hints = [];

/* 0. git 自己生成的消息直接放行：revert / merge 的标题由 git 拼出，
   格式不受提交者控制，拦下来只会逼人加 --no-verify。 */
if (/^(Revert |Merge )/.test(subject)) process.exit(0);

/* 1. 格式：type(scope): subject —— scope 可省略。
      scope 允许 / . _ ：本仓库真实存在 api/admin、docs/flows 这类分层名字。 */
const re = new RegExp(`^(${TYPES.join("|")})(\\([a-z0-9/._-]+\\))?: .+`);
if (!re.test(subject)) {
	errors.push(
		`标题格式不符，应为「type(scope): 描述」，type 取 ${TYPES.join(" / ")}`,
	);
	if (/^[\u4e00-\u9fa5]/.test(subject)) {
		/* 中文开头时不要再提「缺冒号」，那会把人带偏 */
		hints.push(
			"标题以中文开头了，需要先用英文 type 打头，例如 fix(sync): 修复同步面板",
		);
	} else if (/[：]/.test(subject)) {
		hints.push("用了全角冒号「：」，应改成半角「: 」并空一格再写描述");
	} else if (!/^[a-z]+(\([^)]*\))?:/.test(subject)) {
		hints.push("type 后面缺冒号，正确写法是 fix(sync): 描述（冒号后半角空格）");
	}
	const typeGuess = subject.match(/^([a-zA-Z]+)/)?.[1]?.toLowerCase();
	if (typeGuess && !TYPES.includes(typeGuess)) {
		hints.push(
			`「${typeGuess}」不在允许的 type 里，最近的一项是 chore / docs / fix`,
		);
	}
}

/* 2. 标题长度 */
if (subject.length > MAX_SUBJECT) {
	errors.push(`标题 ${subject.length} 字符，超过 ${MAX_SUBJECT}`);
}

/* 3. 标题里的破折号：后半句应移入正文 */
if (/—{2,}/.test(subject)) {
	errors.push("标题含「——」，后半句请移入正文");
}

/* 4. 正文与标题都禁用对话痕迹：标题里写「上一轮漏改的」比正文里更糟 */
for (const word of BANNED) {
	if (subject.includes(word) || body.includes(word)) {
		errors.push(`含对话痕迹「${word}」，应只描述改了什么`);
	}
}

/* 5. 全空 */
if (!subject.trim()) {
	errors.push("提交信息为空");
}

if (errors.length > 0) {
	console.error("\n[commit-msg] 提交信息被拒绝：\n");
	/* 回显被拒的标题：不显示的话，用户只能对着规则猜自己哪里写错了 */
	console.error(`  你写的标题：「${subject || "（空）"}」`);
	console.error(`  长度 ${subject.length} 字符，上限 ${MAX_SUBJECT}\n`);
	for (const e of errors) console.error(`  × ${e}`);
	if (hints.length > 0) {
		console.error("\n  改法：");
		for (const h of hints) console.error(`  → ${h}`);
	}
	console.error("\n参考格式：");
	console.error("  fix(sync): 远端不可达时保留条目并标记 unknown");
	console.error("");
	console.error("  - 移除远端失败时清空 items 的分支");
	console.error("  - 新增 unknown 状态并禁用其操作\n");
	process.exit(1);
}
