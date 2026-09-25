/**
 * 新手指引（Onboarding Tour）的状态持久化（仅客户端）
 * 首次进入控制台自动弹出；关闭/完成后标记，可在控制台随时重新查看。
 */
const TOUR_STORAGE_KEY = "firefly_admin_tour_done";

/** 是否已看过（或跳过）引导 */
export function isTourDone(): boolean {
	try {
		return localStorage.getItem(TOUR_STORAGE_KEY) === "1";
	} catch {
		return true;
	}
}

/** 标记引导已完成 */
export function markTourDone(): void {
	try {
		localStorage.setItem(TOUR_STORAGE_KEY, "1");
	} catch {
		// localStorage 不可用时静默忽略
	}
}

/** 重置引导标记（用于"重新查看指引"） */
export function resetTour(): void {
	try {
		localStorage.removeItem(TOUR_STORAGE_KEY);
	} catch {
		// 同上
	}
}
