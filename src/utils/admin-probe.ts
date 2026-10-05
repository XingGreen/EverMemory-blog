/**
 * 后台「服务连通性探测」的请求与响应解析逻辑。
 *
 * 从 AdminDashboard.svelte 抽出，使这段逻辑可被单元测试覆盖：
 * 它是纯 JS，不依赖 Svelte 运行时。此前它埋在 3000+ 行的组件里，
 * 一处 Promise.all 解构写错就能让线上「无法连接: undefined」——
 * `pnpm check` 与 `pnpm build` 都发现不了，因为类型与语法都合法。
 *
 * 组件侧仍负责步骤文案推进与 PerformanceResourceTiming 分段读数，
 * 本模块只负责「发一次请求 → 归一化成一份探测结果」。
 */

/** 归一化后的探测结果。server* 字段仅在服务端返回采样值时有意义 */
export interface ProbeResult {
	ok: boolean;
	/** 失败原因；ok 为 true 时为空串 */
	failure: string;
	/** 服务端自报耗时（ms）；旧版端点不返回时为 0 */
	serverMs: number;
	serverMin: number;
	serverMedian: number;
	serverMax: number;
}

/** 探测端点返回体的宽松形状：字段缺失或类型不符都要能降级 */
interface ProbePayload {
	latency?: number;
	min?: number;
	median?: number;
	max?: number;
	message?: string;
}

/** i18n 文案由调用方注入，避免纯逻辑层依赖 @i18n */
export interface ProbeMessages {
	/** 响应不是合法 JSON 时的前缀文案 */
	badResponse: string;
	/** 抛出非 Error / 空值时的兜底文案 */
	networkError: string;
}

const FAILED_ZERO = {
	ok: false,
	serverMs: 0,
	serverMin: 0,
	serverMedian: 0,
	serverMax: 0,
} as const;

/**
 * 把任意 catch 到的值转成可读文案。
 * 浏览器在部分失败场景下抛出的并非 Error，甚至可能是 undefined，
 * 直接 String(err) 会得到「undefined」这种毫无信息量的提示。
 */
export function describeProbeError(
	err: unknown,
	networkError: string,
): string {
	if (err instanceof Error && err.message) return err.message;
	if (typeof err === "string" && err) return err;
	return networkError;
}

/**
 * 并发执行「探测请求」与「步骤文案推进」，返回探测结果。
 *
 * 单独抽出是因为这里是线上事故的高发点：曾写成
 * `const { ok, failure } = await Promise.all([request, stepper])`
 * —— Promise.all 返回数组，按对象解构得到的是全 undefined，
 * UI 于是显示「无法连接: undefined」。该写法类型与语法都合法，
 * `pnpm check` 与 `pnpm build` 都拦不住。
 *
 * stepper 只推进 UI，无返回值；这里显式取第 0 项，让「结果来自 request
 * 而非 stepper」这一约定落在代码里而不是注释里。
 */
export async function runProbeWithStages<T>(
	request: Promise<T>,
	stepper: Promise<unknown>,
): Promise<T> {
	// 用 allSettled 而非 all：stepper 只负责推进 UI 文案，其失败
	// （如 i18n 异常）不该连带作废探测结果——用户仍需要知道服务是否连通。
	const [probe, stages] = await Promise.allSettled([request, stepper]);
	if (probe.status === "rejected") throw probe.reason;
	if (stages.status === "rejected") {
		console.warn("[Probe] 步骤推进失败，不影响探测结果", stages.reason);
	}
	return probe.value;
}

/**
 * 执行一次探测请求并归一化结果。
 *
 * 永不抛错：任何失败都收敛为 `{ ok: false, failure }`，因为调用方需要
 * 区分「探测失败」与「组件自身异常」——前者要展示给用户。
 */
export async function probeAdminService(
	href: string,
	messages: ProbeMessages,
): Promise<ProbeResult> {
	try {
		const res = await fetch(href, { cache: "no-store" });
		// 先取文本再自行解析：端点在鉴权失败时返回的仍是 JSON，
		// 但 dev 代理/中间件异常时会返回 HTML 错误页，
		// 直接 res.json() 抛出的 SyntaxError 无法说明真实原因。
		const raw = await res.text();
		let data: ProbePayload | null = null;
		try {
			data = raw ? (JSON.parse(raw) as ProbePayload) : null;
		} catch {
			data = null;
		}

		if (!res.ok) {
			// 仅在 HTTP 异常时记录诊断信息：需带 content-type 才能区分
			// 「端点返回 JSON」与「dev 代理返回了 HTML 错误页」
			console.warn("[Admin] service-ping 返回异常", {
				status: res.status,
				contentType: res.headers.get("content-type"),
				body: raw.slice(0, 200),
			});
			return {
				...FAILED_ZERO,
				// 优先展示后端给出的原因（如「未授权或会话已失效」），
				// 否则回退到状态码，避免只看到无信息量的 HTTP 401
				failure: data?.message || `HTTP ${res.status}`,
			};
		}

		if (data === null) {
			return {
				...FAILED_ZERO,
				failure: `${messages.badResponse}: ${raw.slice(0, 80)}`,
			};
		}

		const serverMs = typeof data.latency === "number" ? data.latency : 0;
		// 服务端已对 KV 往返做多次采样，此处只取中位数展示：
		// 单次耗时会随抖动大幅波动，取中位更能反映常态水平。
		// 旧版端点不返回这些字段，此时回退为单值。
		const pick = (v: unknown): number =>
			typeof v === "number" ? v : serverMs;

		return {
			ok: true,
			failure: "",
			serverMs,
			serverMin: pick(data.min),
			serverMedian: pick(data.median),
			serverMax: pick(data.max),
		};
	} catch (err) {
		return {
			...FAILED_ZERO,
			failure: describeProbeError(err, messages.networkError),
		};
	}
}