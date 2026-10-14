/**
 * 登录成功「带外告警」：把「有谁、在何时、从哪个 IP、以哪个空间登录成功」
 * 推送到站主自配的 Webhook（邮件网关 / Slack / Discord / Telegram 中转等）。
 *
 * 目的：攻击者一旦拿到密码登录成功，站主即使不在后台也能立刻收到通知——
 * 这是唯一能「攻击者够不着」的告警通道（走站主自己的第三方接收端，不占本项目 KV）。
 *
 * 通过 `ADMIN_ALERT_WEBHOOK` 配置（平台 env 或本地 `.env.local`）；未配置则静默跳过。
 * 载荷同时带 `text`（Slack）与 `content`（Discord），并附结构化字段供自定义接收端解析。
 *
 * 本模块依赖 node:fs（经 secret-io），仅可在服务端 import。
 */
import { readSecretValue } from "./secret-io";

export type LoginAlertSpace = "admin" | "super";

export interface LoginAlertInfo {
	space: LoginAlertSpace;
	username: string;
	ip: string;
	device: string;
	time: string;
}

/** 告警 Webhook 是否已配置 */
export function isAlertConfigured(): boolean {
	return readSecretValue("ADMIN_ALERT_WEBHOOK") !== "";
}

/** 网络超时上限：告警不应显著拖慢登录，超时即放弃（登录照常成功） */
const ALERT_TIMEOUT_MS = 4000;

/**
 * 发送登录告警。**永不抛出**——告警失败绝不能连累登录。
 * 由调用方 `await`（Vercel 等 Serverless 在响应返回后可能冻结实例，
 * fire-and-forget 的 Promise 不保证完成，故这里同步等待到发出/超时为止）。
 */
export async function sendLoginAlert(info: LoginAlertInfo): Promise<void> {
	const url = readSecretValue("ADMIN_ALERT_WEBHOOK");
	if (!url) return;

	const spaceLabel =
		info.space === "super" ? "应急控制台(super)" : "主空间(admin)";
	const message = `[EverMemory] 后台登录成功 · 空间=${spaceLabel} · 用户=${info.username} · IP=${info.ip} · 设备=${info.device} · 时间=${info.time}`;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), ALERT_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				text: message,
				content: message,
				event: "admin_login_success",
				space: info.space,
				username: info.username,
				ip: info.ip,
				device: info.device,
				time: info.time,
			}),
			signal: controller.signal,
		});
		if (!res.ok) {
			console.warn(`[Admin Alert] Webhook 返回 ${res.status}`);
		}
	} catch (error) {
		console.warn(
			"[Admin Alert] 告警发送失败:",
			error instanceof Error ? error.message : error,
		);
	} finally {
		clearTimeout(timer);
	}
}
