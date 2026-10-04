/**
 * 动画速度偏好。
 *
 * 取值范围 0~2：0 = 关闭动画，1 = 原速，2 = 双倍速。
 * 仅作用于当前浏览器（localStorage），不改站点配置、不触发重建。
 *
 * 实现方式是给 :root 写入 --anim-speed 变量：全站动画时长都写成
 * calc(<原值> * var(--anim-speed))，所以改这一个值即可整体缩放动效。
 * 变量必须在首屏绘制前落到 <html> 上，否则会看到一次原速动画再跳变，
 * 因此前台在 Layout 的 <head> 里以阻塞式内联脚本写入。
 */

export const ANIM_SPEED_KEY = "anim_speed";

export const ANIM_SPEED_MIN = 0;
export const ANIM_SPEED_MAX = 2;
export const ANIM_SPEED_DEFAULT = 1;

/** 供界面使用的可选档位 */
export const ANIM_SPEED_PRESETS = [0, 0.5, 1, 1.5, 2] as const;

export type AnimSpeedPreset = (typeof ANIM_SPEED_PRESETS)[number];

export function isValidAnimSpeed(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isFinite(value) &&
		value >= ANIM_SPEED_MIN &&
		value <= ANIM_SPEED_MAX
	);
}

export function clampAnimSpeed(value: number): number {
	if (!Number.isFinite(value)) return ANIM_SPEED_DEFAULT;
	return Math.min(ANIM_SPEED_MAX, Math.max(ANIM_SPEED_MIN, value));
}

export function readAnimSpeed(): number {
	if (typeof localStorage === "undefined") return ANIM_SPEED_DEFAULT;
	try {
		const raw = localStorage.getItem(ANIM_SPEED_KEY);
		if (raw === null) return ANIM_SPEED_DEFAULT;
		const parsed = Number.parseFloat(raw);
		return isValidAnimSpeed(parsed) ? parsed : ANIM_SPEED_DEFAULT;
	} catch {
		// 隐私模式等场景下 localStorage 可能抛错，静默退回默认
		return ANIM_SPEED_DEFAULT;
	}
}

export function writeAnimSpeed(value: number): number {
	const clamped = clampAnimSpeed(value);
	try {
		localStorage.setItem(ANIM_SPEED_KEY, String(clamped));
	} catch {
		// 存不进去也不影响本次会话内的生效
	}
	return clamped;
}

/** 把倍率写到文档根节点，立即作用于全站 */
export function applyAnimSpeed(value: number): number {
	const clamped = clampAnimSpeed(value);
	if (typeof document !== "undefined") {
		document.documentElement.style.setProperty(
			"--anim-speed",
			String(clamped),
		);
		// 未设置时同样显式写一次：部分构建流程会丢弃 :root 里未被引用的
		// 自定义属性声明，先落一个 inline 值可确保 calc() 始终能解析。
		document.documentElement.style.setProperty(
			"--anim-speed-fallback",
			String(clamped),
		);
	}
	return clamped;
}