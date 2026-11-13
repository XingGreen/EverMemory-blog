<script lang="ts">
import { onMount } from "svelte";
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import {
	type AdminSecretItem,
	SECRET_GROUPS,
	SECRET_ROWS,
	type SecretRow,
} from "@/utils/admin-secrets";
import ConfirmDialog from "./ConfirmDialog.svelte";

type SecretItemDTO = AdminSecretItem & {
	configured: boolean;
	managed?: boolean;
	preview?: string;
};

let {
	onNotify,
	onStateChange,
}: {
	onNotify: (
		message: string,
		type: "success" | "error",
		duration?: number,
	) => void;
	/**
	 * 把保存栏所需的状态与操作上报给父级。
	 * 保存栏渲染在 AdminPage 的 footer 槽位（滚动容器之外、始终可见），
	 * 而状态在本组件内部，因此需要这一层上报。
	 */
	onStateChange?: (state: {
		writable: boolean;
		loading: boolean;
		saving: boolean;
		changedCount: number;
		/** 未保存改动的逐行 diff（新增/替换/移除），供保存栏展开显示 */
		diffRows: SecretDiffRow[];
		scrollToField: (key: string) => void;
		save: () => void;
		discard: () => void;
	}) => void;
} = $props();

let items = $state<SecretItemDTO[]>([]);
let writable = $state(false);
/** 私钥来源：.env 里 / .key 文件里 / 没有 */
let privateKeySource = $state<"env" | "file" | "none">("none");
let loading = $state(true);
/** 被 Git 跟踪的密钥文件：这些是真正的泄漏风险 */
let leakedFiles = $state<string[]>([]);
/**
 * 当前要高亮的字段。
 * 不能用 classList 直接加类：那个类名不出现在模板里，Svelte 会把它当作
 * 未使用的 CSS 规则删掉，动画就永远不会触发。
 */
let flashKey = $state("");
let loadError = $state("");
let saving = $state(false);
// 每个密钥的输入草稿：本地开发环境直接回填明文，便于查看与局部修改
let drafts = $state<Record<string, string>>({});
// 回填时的原始值，用于判断是否发生修改
let draftsOrigin = $state<Record<string, string>>({});
// 密码类输入框的显隐切换
let showInput = $state<Record<string, boolean>>({});
/**
 * 握手结果：拿当前配置真的去问一次 GitHub。
 * 三段的 id 由服务端给（app / repo / installation），文案也在服务端——
 * 那些句子要带上 App 名、仓库名、提交日期，在前端拼不回来。
 */
type ProbeStageView = { id: string; ok: boolean; detail: string };
let probe = $state<{ running: boolean; at: number; stages: ProbeStageView[] }>({
	running: false,
	at: 0,
	stages: [],
});
const probeAt = $derived(
	probe.at ? new Date(probe.at).toLocaleTimeString() : "",
);
// 导出弹窗
let exportOpen = $state(false);
let exportBusy = $state(false);

// 「配置全部完成」提示是否已被用户关闭。
// 持久化到 localStorage：点「知道了」后刷新页面不再出现。
// 但配置状态发生变化（从未完成 → 全部完成）时自动重置，
// 让这条提示在「重新配齐」后再次出现，而不是永久静音。
// 与 admin-sidebar-collapsed 同一套做法（try/catch 兜底隐私模式）。
const SUCCESS_DISMISSED_KEY = "admin-secrets-success-dismissed";

function readSuccessDismissed(): boolean {
	try {
		return localStorage.getItem(SUCCESS_DISMISSED_KEY) === "1";
	} catch {
		return false;
	}
}

function clearSuccessDismissed() {
	try {
		localStorage.removeItem(SUCCESS_DISMISSED_KEY);
	} catch {
		// localStorage 不可用：内存状态重置即可
	}
}

let successDismissed = $state(false);

function dismissSuccess() {
	successDismissed = true;
	try {
		localStorage.setItem(SUCCESS_DISMISSED_KEY, "1");
	} catch {
		// localStorage 不可用时仅本次会话生效
	}
}

/* ── 密钥泄露检测 ──
   判据完全来自 git（见 docs/todo 单管理员博客：初始化、会话与凭据安全设计.md）：
   只被追踪 → 警告；已 commit 未 push → 严重；已 push → 危险。 */
type LeakLevel = "safe" | "warning" | "serious" | "danger" | "unknown";
interface LeakResult {
	file: string;
	exists: boolean;
	tracked: boolean;
	commits: string[];
	pushedCommits: string[];
	level: LeakLevel;
}

let leakBusy = $state(false);
let leakChecked = $state(false);
let leakAvailable = $state(true);
let leakReason = $state("");
let leakResults = $state<LeakResult[]>([]);

async function checkLeak() {
	leakBusy = true;
	try {
		const res = await fetch("/api/admin/secret-leak-check/");
		const data = await res.json();
		if (!data.success) {
			onNotify(data.message || "检测失败", "error");
			return;
		}
		leakAvailable = data.available !== false;
		leakReason = data.reason ?? "";
		// 只展示实际存在或被追踪的文件，不存在的候选不占版面
		leakResults = (data.results ?? []).filter(
			(r: LeakResult) => r.exists || r.tracked,
		);
		leakChecked = true;
	} catch {
		onNotify("检测请求失败", "error");
	} finally {
		leakBusy = false;
	}
}

function leakLabel(level: LeakLevel): string {
	switch (level) {
		case "safe":
			return i18n(I18nKey.secretsLeakSafe);
		case "warning":
			return i18n(I18nKey.secretsLeakWarning);
		case "serious":
			return i18n(I18nKey.secretsLeakSerious);
		case "danger":
			return i18n(I18nKey.secretsLeakDanger);
		default:
			return "";
	}
}
// 正在轮换的托管密钥 key（用于按钮 loading 态）
let rotating = $state("");
// 当前展开三点菜单的配置项 key（同一时刻只允许一个）
let menuOpen = $state("");
// 「重新上传」触发后记录目标 key（用于聚焦对应文件框，当前仅作语义标记）
let reuploadTarget = $state("");
// 私钥查看弹窗：目标 key 与展示模式（原文 / base64）
let viewTarget = $state("");
let viewMode = $state<"text" | "base64">("text");

/** 弹窗中当前展示的私钥内容。
 *
 * 注意：草稿里的私钥来自 .env.local，那里存的是 Base64（保存时由
 * quoteEnvValue 自动转换）。所以「原文」视图需要先解码，否则展示的
 * 会是一串 Base64；「Base64」视图则直接展示草稿本身（已是 Base64），
 * 若草稿本就是 PEM 明文（本次刚上传）则现场编码。
 */
const viewContent = $derived.by(() => {
	if (!viewTarget) return "";
	const raw = drafts[viewTarget] ?? "";
	const isPlainPem = raw.includes("-----BEGIN");

	if (viewMode === "text") {
		if (isPlainPem) return raw;
		try {
			const decoded = atob(raw.trim());
			// 解码结果必须是 PEM，否则按原文展示（可能是别的编码）
			return decoded.includes("-----BEGIN") ? decoded : raw;
		} catch {
			return raw;
		}
	}

	// Base64 视图
	if (!isPlainPem) return raw;
	try {
		const bytes = new TextEncoder().encode(raw);
		let bin = "";
		for (const b of bytes) bin += String.fromCharCode(b);
		return btoa(bin);
	} catch {
		return "";
	}
});

/** 点击页面其他位置时收起三点菜单 */
function closeMenuOnOutside(e: MouseEvent) {
	if (!menuOpen) return;
	const el = e.target as Element | null;
	if (el?.closest(".field-menu-wrap")) return;
	menuOpen = "";
}

/** Esc 收起三点菜单 */
function closeMenuOnEsc(e: KeyboardEvent) {
	if (e.key === "Escape" && menuOpen) menuOpen = "";
}

/**
 * 放弃修改：把所有草稿回滚到载入时的 baseline。
 * 对应参考项目 settings-savebar 的「放弃修改」。
 */
function discardAll() {
	drafts = { ...draftsOrigin };
	uploadNames = {};
	uploadError = {};
	syncAddress();
}

/**
 * 跑一轮握手。刻意用 `force=1`：用户点了按钮就是要一次新的结论，
 * 拿 60s 内的缓存告诉他「通了」没有意义——他很可能刚改完某个字段。
 *
 * 失败不抛错：三段结论由服务端逐段给出，网络层失败才提示一次 toast。
 */
async function runProbe() {
	probe = { ...probe, running: true };
	try {
		const res = await fetch("/api/admin/secrets/probe/?force=1", {
			cache: "no-store",
		});
		const data = (await res.json()) as {
			success?: boolean;
			message?: string;
			checkedAt?: number;
			stages?: ProbeStageView[];
		};
		if (data.success && Array.isArray(data.stages)) {
			probe = {
				running: false,
				at: data.checkedAt ?? Date.now(),
				stages: data.stages,
			};
			return;
		}
		onNotify?.(data.message || "验证失败", "error", 8000);
	} catch (error) {
		onNotify?.(
			error instanceof Error ? error.message : "验证失败",
			"error",
			8000,
		);
	} finally {
		probe = { ...probe, running: false };
	}
}

/** 有未保存改动时，离开页面前拦截（对应参考项目 enableBeforeUnload） */
function onBeforeUnload(e: BeforeUnloadEvent) {
	if (changedCount > 0) {
		e.preventDefault();
		e.returnValue = "";
	}
}

const groups = $derived(
	SECRET_GROUPS.map((g) => ({
		...g,
		items: items.filter((item) => item.group === g.id),
	})),
);

// 配置完成度：只统计 required 必配项
const requiredItems = $derived(items.filter((item) => item.required));
const requiredConfiguredCount = $derived(
	requiredItems.filter((item) => item.configured).length,
);
const missingRequired = $derived(
	requiredItems.filter((item) => !item.configured),
);
const allRequiredConfigured = $derived(
	requiredItems.length > 0 && requiredConfiguredCount === requiredItems.length,
);

/**
 * 配置状态从「未完成」变为「全部完成」时，重置关闭标记，
 * 让成功提示重新出现——否则用户点过一次「知道了」后，
 * 即使后来清空再重新配齐，也永远不会再看到这条提示。
 *
 * 必须跳过数据加载阶段：items 异步载入，期间 allRequiredConfigured
 * 会经历 false（空数据）→ true（载入后），若直接比较就会把
 * 用户的关闭意图冲掉（实测刷新后提示又出现）。
 * 因此以 loading 结束后的首个稳定值作为基线，之后再变化才算真实转变。
 */
let prevAllConfigured: boolean | null = null;
$effect(() => {
	// 数据未就绪时不参与判定，也不更新基线
	if (loading || loadError) return;
	const current = allRequiredConfigured;
	if (prevAllConfigured === null) {
		// 首次拿到稳定值：只记录基线，不重置
		prevAllConfigured = current;
		return;
	}
	// 仅在「从未完成变成完成」时重置
	if (prevAllConfigured === false && current === true) {
		successDismissed = false;
		clearSuccessDismissed();
	}
	prevAllConfigured = current;
});

function isDirty(item: SecretItemDTO): boolean {
	const draft = (drafts[item.key] ?? "").trim();
	// 非敏感项已预填原值，直接与草稿比较
	if (!item.sensitive) return draft !== (draftsOrigin[item.key] ?? "");
	// 敏感项：预填了原值则比较差异，否则「有输入即修改」
	if (item.key in draftsOrigin) return draft !== (draftsOrigin[item.key] ?? "");
	return draft !== "";
}

const changedCount = $derived(items.filter(isDirty).length);

/**
 * 滚动到指定字段并短暂高亮。
 * 字段容器通过 data-secret-key 定位（见模板），滚动容器是
 * .admin-page-body（AdminPage 内唯一可滚区域）。
 */
function scrollToField(key: string) {
	const field = document.querySelector(`[data-secret-key="${key}"]`);
	if (!field) return;
	const body = document.querySelector(".admin-page-body");
	field.scrollIntoView({ behavior: "smooth", block: "center" });
	// 高亮：加类后 1.6s 移除，与 CSS 过渡时长对应
	flashKey = key;
	setTimeout(() => {
		if (flashKey === key) flashKey = "";
	}, 1600);
	// 兜底：scrollIntoView 在 zoom 容器里偶有偏差，显式校正
	if (body) {
		const fieldRect = field.getBoundingClientRect();
		const bodyRect = body.getBoundingClientRect();
		if (fieldRect.top < bodyRect.top || fieldRect.bottom > bodyRect.bottom) {
			body.scrollTop += fieldRect.top - bodyRect.top - 80;
		}
	}
}

// 把保存栏状态上报给父级（保存栏渲染在 AdminPage footer，位于滚动容器外）
$effect(() => {
	onStateChange?.({
		writable,
		loading,
		saving,
		changedCount,
		diffRows,
		scrollToField,
		save,
		discard: discardAll,
	});
});

async function load() {
	loading = true;
	loadError = "";
	try {
		const res = await fetch("/api/admin/secrets/");
		const data = await res.json();
		if (data.success) {
			items = data.items;
			leakedFiles = (data.audit ?? [])
				.filter((a: { tracked: boolean }) => a.tracked)
				.map((a: { path: string }) => a.path);
			writable = data.writable;
			privateKeySource = data.privateKeySource ?? "none";
			// 本地开发环境：直接把明文回填到表单，便于查看与局部修改
			drafts = {};
			draftsOrigin = {};
			showInput = {};
			for (const item of items) {
				const value = item.value ?? "";
				if (value) {
					drafts[item.key] = value;
					draftsOrigin[item.key] = value;
				}
			}
			syncAddress();
		} else {
			loadError = data.message || "读取密钥状态失败";
		}
	} catch (err) {
		loadError = err instanceof Error ? err.message : "网络请求失败";
	} finally {
		loading = false;
	}
}

/** 点击眼镜：切换该字段明文的显示/隐藏（值已预填，无需再请求后端） */
function toggleReveal(item: SecretItemDTO) {
	showInput[item.key] = !showInput[item.key];
}

/**
 * 切回本标签页时重新读取环境变量。
 *
 * .env.local 可能被本页面之外的操作修改（手动编辑文件、另一个标签页保存、
 * 部署脚本写入），而组件只在挂载时读一次，页面会一直显示旧值。
 * 这里在页面重新可见时重读一次，覆盖「改完文件切回浏览器」这个最常见的
 * 场景，且不带来轮询开销。
 *
 * 有未保存改动时跳过：否则用户正在编辑的草稿会被服务端值覆盖。
 * 用户仍可用页面上的「刷新」按钮显式重读。
 */
function handleVisibilityChange() {
	if (document.visibilityState !== "visible") return;
	if (loading || saving) return;
	if (changedCount > 0) return;
	void load();
}

$effect(() => {
	if (typeof document === "undefined") return;
	document.addEventListener("visibilitychange", handleVisibilityChange);
	return () => {
		document.removeEventListener("visibilitychange", handleVisibilityChange);
	};
});

/** 上传文件名（仅用于回显，不参与保存） */
let uploadNames = $state<Record<string, string>>({});
/** 上传校验错误 */
let uploadError = $state<Record<string, string>>({});

const PEM_MAX_BYTES = 100 * 1024;

/**
 * 读取上传的 PEM 私钥文件并写入草稿。
 * 不做格式强校验（只拦明显错误），真正的语法校验交给保存接口；
 * 这里重点拦住「选错文件」与「文件过大」两类常见失误。
 */
async function readPemFile(
	event: Event & { currentTarget: HTMLInputElement },
	item: SecretItemDTO,
) {
	const file = event.currentTarget.files?.[0];
	// 允许重复选择同一文件：清空 value，否则 change 不再触发
	event.currentTarget.value = "";
	if (!file) return;

	uploadError[item.key] = "";
	if (file.size > PEM_MAX_BYTES) {
		uploadError[item.key] = i18n(I18nKey.secretsUploadTooLarge);
		return;
	}

	let text = "";
	try {
		text = await file.text();
	} catch {
		uploadError[item.key] = i18n(I18nKey.secretsUploadReadFailed);
		return;
	}

	if (!text.includes("-----BEGIN")) {
		uploadError[item.key] = i18n(I18nKey.secretsUploadInvalid);
		return;
	}

	drafts[item.key] = text;
	uploadNames[item.key] = file.name;
}

function buildEntries(): { key: string; value?: string; delete?: boolean }[] {
	const entries: { key: string; value?: string; delete?: boolean }[] = [];
	for (const item of items) {
		const draft = (drafts[item.key] ?? "").trim();
		if (item.key in draftsOrigin) {
			const origin = draftsOrigin[item.key] ?? "";
			if (draft === origin) continue;
			// 清空输入框即视为删除该配置项（用户手动清空即可移除）
			if (!draft) {
				entries.push({ key: item.key, delete: true });
				continue;
			}
			entries.push({ key: item.key, value: draft });
		} else if (draft) {
			entries.push({ key: item.key, value: draft });
		}
	}
	return entries;
}

async function save() {
	const entries = buildEntries();
	if (entries.length === 0) {
		onNotify("没有需要保存的修改", "error", 5000);
		return;
	}
	await doSave(entries);
}

async function doSave(
	entries: { key: string; value?: string; delete?: boolean }[],
) {
	saving = true;
	try {
		const res = await fetch("/api/admin/secrets/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ entries }),
		});
		const data = await res.json();
		if (res.ok && data.success) {
			onNotify(data.message || "保存成功", "success", 10000);
			await load();
			return;
		}
		// 危险操作需「新鲜」登录态：跳 GitHub OAuth 重新授权（prompt=login）
		if (res.status === 403 && data.code === "STEP_UP_REQUIRED") {
			onNotify("身份凭证已过期，正在跳转重新验证…", "error", 6000);
			const next = encodeURIComponent(location.pathname);
			window.location.href = `/api/admin/auth/github/?force=1&next=${next}`;
			return;
		}
		onNotify(data.message || "保存失败", "error", 10000);
	} catch (err) {
		onNotify(
			`保存请求失败: ${err instanceof Error ? err.message : String(err)}`,
			"error",
			10000,
		);
	} finally {
		saving = false;
	}
}

/* ── 写入前 diff ──
   页脚那行「还有 N 项未保存」展开后就是这个列表：新增（追加到末尾）、替换
   （就地改那一行）、移除（清空即删行）。写入实现是逐行 patch，所以这三类动作
   就是全部，不会有额外的格式变化。

   行由 buildEntries() 派生——列表与真正提交的条目同源，不两处各算一遍。 */
type SecretDiffRow = {
	key: string;
	label: string;
	kind: "add" | "replace" | "remove";
	/** 展示用文本：超长截断，敏感项一律留空 */
	from: string;
	to: string;
	masked: boolean;
};

const diffRows = $derived.by<SecretDiffRow[]>(() => {
	const byKey = new Map(items.map((i) => [i.key, i]));
	const clip = (v: string) =>
		!v ? "" : v.length > 40 ? `${v.slice(0, 40)}…` : v;
	return buildEntries().map((entry) => {
		const item = byKey.get(entry.key);
		const masked = item?.sensitive === true;
		return {
			key: entry.key,
			label: item?.label ?? entry.key,
			kind: entry.delete
				? "remove"
				: entry.key in draftsOrigin
					? "replace"
					: "add",
			from: masked ? "" : clip(draftsOrigin[entry.key] ?? ""),
			to: masked ? "" : clip(entry.value ?? ""),
			masked,
		} satisfies SecretDiffRow;
	});
});

function timestampForFilename(): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * 导出接口要求 5 分钟内的强认证，凭据过期时返回 403 + STEP_UP_REQUIRED。
 * 统一在这里引导重新授权，否则用户只看到一句「HTTP 403」不知道该做什么。
 * 返回 true 表示已接管（正在跳转），调用方直接收工。
 */
async function handleStepUp(res: Response): Promise<boolean> {
	if (res.status !== 403) return false;
	const data = (await res.json().catch(() => null)) as {
		code?: string;
	} | null;
	if (data?.code !== "STEP_UP_REQUIRED") return false;
	onNotify("身份凭证已过期，正在跳转重新验证…", "error", 6000);
	const next = encodeURIComponent(location.pathname);
	window.location.href = `/api/admin/auth/github/?force=1&next=${next}`;
	return true;
}

async function downloadEnv() {
	exportBusy = true;
	try {
		const res = await fetch("/api/admin/secrets/export/?format=env");
		if (!res.ok) {
			if (await handleStepUp(res)) return;
			throw new Error(`HTTP ${res.status}`);
		}
		const text = await res.text();
		const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `evermemory-env-${timestampForFilename()}.env`;
		a.click();
		URL.revokeObjectURL(url);
		onNotify(i18n(I18nKey.secretsExportEnvDone), "success", 8000);
	} catch (err) {
		onNotify(
			`导出失败: ${err instanceof Error ? err.message : String(err)}`,
			"error",
			8000,
		);
	} finally {
		exportBusy = false;
	}
}

async function copyVercelCommands() {
	exportBusy = true;
	try {
		const res = await fetch("/api/admin/secrets/export/?format=vercel");
		if (!res.ok) {
			if (await handleStepUp(res)) return;
			throw new Error(`HTTP ${res.status}`);
		}
		const text = await res.text();
		await navigator.clipboard.writeText(text);
		onNotify(i18n(I18nKey.secretsExportCopied), "success", 8000);
	} catch (err) {
		onNotify(
			`复制失败: ${err instanceof Error ? err.message : String(err)}`,
			"error",
			8000,
		);
	} finally {
		exportBusy = false;
	}
}

async function rotate(item: SecretItemDTO) {
	if (rotating) return;
	const confirmed = await askConfirm({
		title: `轮换密钥「${item.label}」？`,
		body: i18n(I18nKey.secretsRotateConfirm).replace("{label}", item.label),
		hint: "旧密钥会立即失效，正在使用它的服务和脚本都要同步更新。",
		confirmText: "轮换",
		cancelText: "取消",
		tone: "danger",
	});
	if (!confirmed) return;

	rotating = item.key;
	try {
		const res = await fetch("/api/admin/secrets/rotate/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ key: item.key }),
		});
		const data = await res.json();
		// 危险操作需「新鲜」登录态：跳 GitHub OAuth 重新授权（prompt=login）
		if (res.status === 403 && data.code === "STEP_UP_REQUIRED") {
			onNotify(i18n(I18nKey.secretsStepUpRequired), "error", 6000);
			const next = encodeURIComponent(location.pathname);
			window.location.href = `/api/admin/auth/github/?force=1&next=${next}`;
			return;
		}
		if (res.ok && data.success) {
			onNotify(
				data.message || i18n(I18nKey.secretsRotateDone),
				"success",
				10000,
			);
			await load();
			return;
		}
		onNotify(data.message || i18n(I18nKey.secretsRotateFailed), "error", 10000);
	} catch (err) {
		onNotify(
			`${i18n(I18nKey.secretsRotateFailed)}: ${err instanceof Error ? err.message : String(err)}`,
			"error",
			10000,
		);
	} finally {
		rotating = "";
	}
}

/* ── 行模型 ──
   页面按「问题」排版，不按环境变量排版：一行可能对应 1–3 个 key。
   存储侧仍然是 ADMIN_SECRETS，保存时按 key 拆回去，两边不重复定义。 */
const itemByKey = $derived(new Map(items.map((i) => [i.key, i])));

function rowsOf(groupId: string): SecretRow[] {
	return SECRET_ROWS.filter((r) => r.group === groupId);
}

/**
 * 这一行算不算「配好了」。
 *
 * 多数行要求每个 key 都在；但私钥那行的两个 key 是**二选一**
 * （内联 Base64 与 .pem 路径），用 every 会把它永远判成未配置。
 */
function rowConfigured(row: SecretRow): boolean {
	const has = (k: string) => {
		const it = itemByKey.get(k);
		return it?.configured === true || it?.managed === true;
	};
	return row.shape === "upload" ? row.keys.some(has) : row.keys.every(has);
}

const probeApp = $derived(probe.stages.find((s) => s.id === "app") ?? null);
const probeRepo = $derived(probe.stages.find((s) => s.id === "repo") ?? null);
const probeInstall = $derived(
	probe.stages.find((s) => s.id === "installation") ?? null,
);

/**
 * 组级结论。一组只回答一个问题：
 * GitHub 组答「能不能写进去」，认证组答「配了几项」，人机验证答「开没开」。
 * 可选行（webhook）不参与计数——它空着也是对的。
 */
function verdictOf(groupId: string): {
	text: string;
	tone: "ok" | "warn" | "idle";
} {
	if (groupId === "github") {
		if (probe.running) return { text: "验证中…", tone: "idle" };
		if (probe.stages.length === 0) return { text: "未验证", tone: "idle" };
		const addr = addressOf();
		return probeRepo?.ok
			? { text: `✓ 能写入 ${addr}`, tone: "ok" }
			: { text: "✕ 仓库读不到", tone: "warn" };
	}

	const rows = rowsOf(groupId).filter((r) => r.shape !== "optional");
	const done = rows.filter(rowConfigured).length;

	if (groupId === "turnstile") {
		return done === rows.length && rows.length > 0
			? { text: "已启用", tone: "ok" }
			: { text: "未启用", tone: "idle" };
	}
	return {
		text: `${done} / ${rows.length} 已配`,
		tone: done === rows.length ? "ok" : "warn",
	};
}

/* ── 仓库地址 ──
   owner / repo / branch 从来不是三个概念，是一个地址的三个片段。
   输入框里显示 `owner/repo@branch`，解析成功才写回三个草稿；
   解析不了就保持原样并提示格式，不把半截地址拆进草稿。 */
let addressRaw = $state("");
let addressError = $state("");

function addressOf(): string {
	const owner = (drafts.GITHUB_OWNER ?? "").trim();
	const repo = (drafts.GITHUB_REPO ?? "").trim();
	const branch = (drafts.GITHUB_BRANCH ?? "").trim();
	if (!owner && !repo && !branch) return "";
	return `${owner}/${repo}${branch ? `@${branch}` : ""}`;
}

function syncAddress() {
	addressRaw = addressOf();
	addressError = "";
}

function setAddress(raw: string) {
	addressRaw = raw;
	const trimmed = raw.trim();
	if (!trimmed) {
		addressError = "";
		drafts.GITHUB_OWNER = "";
		drafts.GITHUB_REPO = "";
		drafts.GITHUB_BRANCH = "";
		return;
	}
	const m = trimmed.match(/^([^/\s]+)\/([^@\s]+)(?:@(\S+))?$/);
	if (!m) {
		addressError = "格式：owner/repo@branch";
		return;
	}
	addressError = "";
	drafts.GITHUB_OWNER = m[1];
	drafts.GITHUB_REPO = m[2];
	drafts.GITHUB_BRANCH = m[3] ?? "";
}

/** 打开某一行的文件选择框（.pem 上传） */
function pickFile(key: string) {
	const el = document.getElementById(`pem-input-${key}`);
	el?.click();
}

onMount(() => {
	successDismissed = readSuccessDismissed();
	load();
});
/** 轮换密钥前的确认 */
let confirmState = $state<{
	title: string;
	body: string;
	hint?: string;
	confirmText: string;
	cancelText: string;
	tone: "default" | "danger";
} | null>(null);
let confirmResolve: ((ok: boolean) => void) | null = null;

function askConfirm(info: NonNullable<typeof confirmState>): Promise<boolean> {
	confirmState = info;
	return new Promise<boolean>((resolve) => {
		confirmResolve = resolve;
	});
}

function answerConfirm(ok: boolean) {
	confirmState = null;
	const resolve = confirmResolve;
	confirmResolve = null;
	resolve?.(ok);
}
</script>

<ConfirmDialog
	open={confirmState !== null}
	title={confirmState?.title ?? ""}
	body={confirmState?.body ?? ""}
	hint={confirmState?.hint}
	confirmText={confirmState?.confirmText ?? ""}
	cancelText={confirmState?.cancelText ?? ""}
	tone={confirmState?.tone ?? "default"}
	onConfirm={() => answerConfirm(true)}
	onCancel={() => answerConfirm(false)}
/>

<div class="secrets-page">
	{#if loading}
		<p class="state-line">{i18n(I18nKey.configLoading)}</p>
	{:else if loadError}
		<div class="state-line bad">
			<span>{loadError}</span>
			<button type="button" class="link" onclick={() => load()}>重试</button>
		</div>
	{:else}
		<!-- 结论条：只保留一条。全部配齐时说完成，缺东西时说是哪几项。 -->
		{#if missingRequired.length > 0}
			<div class="note warn">
				<span class="note-mark" aria-hidden="true">!</span>
				<span
					>{i18n(I18nKey.secretsStatusMissing)}{missingRequired
						.map((it) => it.label)
						.join("、")}</span
				>
			</div>
		{:else if !successDismissed}
			<div class="note">
				<span class="note-mark ok" aria-hidden="true">✓</span>
				<span>{i18n(I18nKey.secretsStatusAllDone)}</span>
				<span class="grow"></span>
				<button type="button" class="link" onclick={dismissSuccess}
					>{i18n(I18nKey.secretsStatusGotIt)}</button
				>
			</div>
		{/if}

		{#if !writable}
			<div class="note warn">
				<span class="note-mark" aria-hidden="true">!</span>
				<span>{i18n(I18nKey.secretsReadonlyHint)}</span>
			</div>
		{/if}

		{#each groups as group (group.id)}
			{@const groupRows = rowsOf(group.id)}
			{@const verdict = verdictOf(group.id)}
			<section class="pgroup">
				<div class="ghead">
					<h3>{i18n(I18nKey[group.labelKey])}</h3>
					<span class="sub">{group.sub}</span>
					<span class="verdict {verdict.tone}">{verdict.text}</span>
				</div>

				{#each groupRows as row (row.id)}
					{@const first = itemByKey.get(row.keys[0])}
					{@const configured = rowConfigured(row)}
					<div
						class="prow"
						class:locked={row.shape === "optional" && !configured}
						class:field-flash={flashKey === row.keys[0] ||
							flashKey === row.keys[1]}
						data-secret-key={row.keys.join(" ")}
					>
						<div class="left">
							<div class="name">{row.label}</div>
							<p class="how">{row.how}</p>
						</div>

						<div class="right">
							{#if row.shape === "address"}
								<input
									class="ui-input mono"
									class:invalid={addressError}
									type="text"
									value={addressRaw}
									placeholder={row.format}
									spellcheck="false"
									autocomplete="off"
									aria-label={row.label}
									disabled={!writable}
									oninput={(e) => setAddress(e.currentTarget.value)}
								/>
								{#if addressError}
									<p class="trace bad">{addressError}</p>
								{/if}
								<p class="trace">
									{#if probeRepo}
										<b>刚刚验过：</b>{probeRepo.detail}
									{:else if probe.running}
										正在验证…
									{:else}
										<button type="button" class="link" onclick={runProbe}
											>验证连接</button
										>
										<span class="dim">· 还没有验证</span>
									{/if}
								</p>
							{:else if row.shape === "upload"}
								{#if configured && !uploadNames[row.keys[0]]}
									<div class="field-box">
										<span class="ok" aria-hidden="true">✓</span>
										<span>已上传</span>
										<span class="grow"></span>
										<button
											type="button"
											class="link"
											onclick={() => {
												viewTarget = row.keys[0];
												viewMode = "text";
											}}>查看</button
										>
										<button
											type="button"
											class="link"
											onclick={() => pickFile(row.keys[0])}>更换</button
										>
									</div>
								{:else if privateKeySource === "file" && !uploadNames[row.keys[0]]}
									<div class="field-box">
										<span class="ok" aria-hidden="true">✓</span>
										<span>已从本地文件读取</span>
										<span class="grow"></span>
										<button
											type="button"
											class="link"
											onclick={() => pickFile(row.keys[0])}>更换</button
										>
									</div>
								{:else}
									<button
										type="button"
										class="upload-slot"
										onclick={() => pickFile(row.keys[0])}
									>
										{uploadNames[row.keys[0]] || "选择一个 .pem 文件上传"}
									</button>
									<input
										id={`pem-input-${row.keys[0]}`}
										type="file"
										accept=".pem,.key,text/plain"
										class="file-hidden"
										onchange={(e) => first && readPemFile(e, first)}
									/>
								{/if}
								{#if uploadError[row.keys[0]]}
									<p class="trace bad">{uploadError[row.keys[0]]}</p>
								{/if}
								<p class="trace">
									{#if probeApp}
										<b>刚刚验过：</b>{probeApp.detail}
									{:else}
										<span class="dim">上传后点一次「验证连接」</span>
									{/if}
								</p>
								{#if itemByKey.get("GITHUB_PRIVATE_KEY_PATH")}
									<input
										class="ui-input mono small"
										type="text"
										placeholder="或填文件路径，例如 .key/blog.pem"
										spellcheck="false"
										value={drafts.GITHUB_PRIVATE_KEY_PATH ?? ""}
										disabled={!writable}
										oninput={(e) => {
											drafts.GITHUB_PRIVATE_KEY_PATH = e.currentTarget.value;
										}}
									/>
								{/if}
							{:else if row.shape === "managed"}
								<div class="field-box">
									<span class="ok" aria-hidden="true">✓</span>
									<span>已自动生成</span>
									<span class="grow"></span>
									<button
										type="button"
										class="link"
										disabled={rotating === row.keys[0]}
										onclick={() => first && rotate(first)}
										>{rotating === row.keys[0]
											? "轮换中…"
											: i18n(I18nKey.secretsRotate)}</button
									>
								</div>
							{:else if row.shape === "pair"}
								<div class="pair">
									{#each row.keys as key (key)}
										{@const it = itemByKey.get(key)}
										{#if it}
											{#if it.sensitive}
												<div class="eye-wrap">
													<input
														class="ui-input mono"
														type={showInput[key] ? "text" : "password"}
														value={drafts[key] ?? ""}
														placeholder={it.example ?? ""}
														spellcheck="false"
														autocomplete="new-password"
														aria-label={it.label}
														disabled={!writable}
														oninput={(e) => {
															drafts[key] = e.currentTarget.value;
														}}
													/>
													<button
														type="button"
														class="eye"
														aria-label={showInput[key] ? "隐藏" : "显示"}
														onclick={() =>
															(showInput[key] = !showInput[key])}
													>
														<Icon
															icon={showInput[key]
																? "material-symbols:visibility-off-outline-rounded"
																: "material-symbols:visibility-outline-rounded"}
														/>
													</button>
												</div>
											{:else}
												<input
													class="ui-input mono"
													type="text"
													value={drafts[key] ?? ""}
													placeholder={it.example ?? ""}
													spellcheck="false"
													autocomplete="off"
													aria-label={it.label}
													disabled={!writable}
													oninput={(e) => {
														drafts[key] = e.currentTarget.value;
													}}
												/>
											{/if}
										{/if}
									{/each}
								</div>
							{:else}
								{@const it = first}
								{#if it}
									{#if it.sensitive}
										<div class="eye-wrap">
											<input
												class="ui-input mono"
												type={showInput[it.key] ? "text" : "password"}
												value={drafts[it.key] ?? ""}
												placeholder={it.example ?? ""}
												spellcheck="false"
												autocomplete="new-password"
												aria-label={it.label}
												disabled={!writable}
												oninput={(e) => {
													drafts[it.key] = e.currentTarget.value;
												}}
											/>
											<button
												type="button"
												class="eye"
												aria-label={showInput[it.key] ? "隐藏" : "显示"}
												onclick={() =>
													(showInput[it.key] = !showInput[it.key])}
											>
												<Icon
													icon={showInput[it.key]
														? "material-symbols:visibility-off-outline-rounded"
														: "material-symbols:visibility-outline-rounded"}
												/>
											</button>
										</div>
									{:else}
										<input
											class="ui-input mono"
											type="text"
											value={drafts[it.key] ?? ""}
											placeholder={it.example ?? ""}
											spellcheck="false"
											autocomplete="off"
											aria-label={it.label}
											disabled={!writable}
											oninput={(e) => {
												drafts[it.key] = e.currentTarget.value;
											}}
										/>
									{/if}
									{#if row.shape === "optional"}
										<p class="trace dim">可选，留空不影响使用</p>
									{:else if probeInstall && row.id === "install"}
										<p class="trace">
											<b>刚刚验过：</b>{probeInstall.detail}
										</p>
									{/if}
								{/if}
							{/if}
						</div>
					</div>
				{/each}
			</section>
		{/each}

		<!-- 泄漏检测：只在点了之后出结论，不占常驻版面 -->
		<div class="foot-row">
			<button type="button" class="link" disabled={leakBusy} onclick={checkLeak}
				>{leakBusy ? "检测中…" : i18n(I18nKey.secretsLeakCheck)}</button
			>
			<span class="grow"></span>
			<button type="button" class="link" onclick={() => load()} disabled={loading}
				>{i18n(I18nKey.secretsReload)}</button
			>
			<button
				type="button"
				class="link"
				disabled={exportBusy}
				onclick={copyVercelCommands}
				>{i18n(I18nKey.secretsExportCopyVercel)}</button
			>
			<button type="button" class="link" disabled={exportBusy} onclick={downloadEnv}
				>{i18n(I18nKey.secretsExport)}</button
			>
		</div>

		{#if leakChecked}
			<div class="leak">
				{#if !leakAvailable}
					<p class="trace">{leakReason || "当前环境无法检测"}</p>
				{:else if leakResults.length === 0}
					<p class="trace ok-t">没有发现被跟踪的密钥文件</p>
				{:else}
					{#each leakResults as r (r.file)}
						<div class="leak-row" data-level={r.level}>
							<span class="mono dim">{r.file}</span>
							<span class="grow"></span>
							<span class="leak-badge">{leakLabel(r.level)}</span>
						</div>
					{/each}
				{/if}
			</div>
		{/if}
	{/if}
</div>


{#if viewTarget}
	<div class="mask">
		<button
			type="button"
			class="backdrop"
			aria-label="关闭"
			onclick={() => (viewTarget = "")}
		></button>
		<div
			class="dialog"
			role="dialog"
			aria-modal="true"
			aria-label="私钥内容"
			tabindex="-1"
			onkeydown={(e) => {
				if (e.key === "Escape") viewTarget = "";
			}}
		>
			<div class="dialog-head">
				<span class="name">私钥内容</span>
				<span class="grow"></span>
				<button
					type="button"
					class="seg"
					class:on={viewMode === "text"}
					onclick={() => (viewMode = "text")}>原文</button
				>
				<button
					type="button"
					class="seg"
					class:on={viewMode === "base64"}
					onclick={() => (viewMode = "base64")}>Base64</button
				>
			</div>
			<pre class="keybody">{viewContent}</pre>
			<div class="dialog-foot">
				<span class="dim mono">{viewTarget}</span>
				<span class="grow"></span>
				<button
					type="button"
					class="link"
					onclick={() => {
						navigator.clipboard?.writeText(viewContent);
						onNotify?.(i18n(I18nKey.secretsMenuCopied), "success", 2500);
					}}>复制</button
				>
				<button type="button" class="ui-btn ui-btn-ghost" onclick={() => (viewTarget = "")}
					>关闭</button
				>
			</div>
		</div>
	</div>
{/if}

<style>
	/* ── 页面：一行一个问题 ──
	   左栏是「这是什么」，右栏是「它现在怎么样」。行距 14px、分隔线 6% 白，
	   比卡片网格轻——15 个字段排成两列时，眼睛要在四个方向来回跳。 */
	.secrets-page {
		display: flex;
		flex-direction: column;
	}

	.state-line {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem 0;
		font-size: var(--admin-fs-meta, 0.75rem);
		color: var(--content-meta);
	}

	.state-line.bad {
		color: var(--deep-text);
	}

	/* 结论条：只有一条，全站只在最上面 */
	.note {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		margin-bottom: 0.875rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--line-divider);
		border-radius: 10px;
		font-size: var(--admin-fs-meta, 0.75rem);
		color: var(--deep-text);
	}

	.note.warn {
		border-color: color-mix(in srgb, var(--primary) 30%, transparent);
		color: var(--primary);
	}

	.note-mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1rem;
		height: 1rem;
		flex-shrink: 0;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.6875rem;
	}

	.note-mark.ok {
		color: var(--success);
	}

	.note .grow {
		flex: 1;
	}

	/* 分组 */
	.pgroup {
		margin-top: 1.75rem;
	}

	.pgroup:first-of-type {
		margin-top: 0;
	}

	.ghead {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding-bottom: 0.625rem;
		border-bottom: 1px solid var(--line-divider);
	}

	.ghead h3 {
		margin: 0;
		font-size: var(--admin-fs-item, 1.0625rem);
		font-weight: 650;
		letter-spacing: 0.01em;
		color: var(--deep-text);
	}

	.ghead .sub {
		font-size: var(--admin-fs-meta, 0.75rem);
		color: var(--content-meta);
	}

	/* 结论靠右：一组只给一个判断，不给每个字段都发一块牌子 */
	.verdict {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		font-size: var(--admin-fs-meta, 0.75rem);
		font-weight: 500;
		white-space: nowrap;
	}

	.verdict.ok {
		color: var(--success);
	}

	.verdict.warn {
		color: var(--primary);
	}

	.verdict.idle {
		color: var(--content-meta);
	}

	/* 行 */
	.prow {
		display: grid;
		grid-template-columns: 13rem minmax(0, 1fr);
		gap: 1.5rem;
		align-items: start;
		padding: 0.875rem 0;
		border-bottom: 1px solid color-mix(in srgb, var(--deep-text) 6%, transparent);
	}

	.prow:last-of-type {
		border-bottom: 0;
	}

	.prow.locked {
		opacity: 0.62;
	}

	/* 从保存栏清单跳过来的定位提示：整行背景亮两次，左缘压一道主色。
	   只用背景与内阴影，不动 border 与 padding，行高和分栏线都不会跳。 */
	.prow.field-flash {
		border-radius: 8px;
		box-shadow: inset 3px 0 0 var(--primary);
		animation: field-breathe 0.8s ease-in-out 2;
	}

	/* 0.8s × 2 = 1.6s，与 scrollToField 里移除类名的时长一致 */
	@keyframes field-breathe {
		0%,
		100% {
			background: color-mix(in oklab, var(--primary) 6%, transparent);
			box-shadow: inset 3px 0 0 color-mix(in oklab, var(--primary) 35%, transparent);
		}
		50% {
			background: color-mix(in oklab, var(--primary) 14%, transparent);
			box-shadow: inset 3px 0 0 var(--primary);
		}
	}

	/* 关掉动效也保留定位：静态底色 + 左缘主色，1.6s 后照常消失 */
	@media (prefers-reduced-motion: reduce) {
		.prow.field-flash {
			animation: none;
			background: color-mix(in oklab, var(--primary) 12%, transparent);
		}
	}

	.prow .left {
		min-width: 0;
	}

	.prow .name {
		font-size: var(--admin-fs-body, 0.875rem);
		font-weight: 600;
		color: var(--deep-text);
	}

	/* 「我该怎么做」：一句指令，不是说明文。行高放宽到 1.55 便于扫读 */
	.prow .how {
		margin: 0.1875rem 0 0;
		font-size: var(--admin-fs-meta, 0.75rem);
		line-height: 1.55;
		color: var(--content-meta);
	}

	.right {
		min-width: 0;
	}

	/* 后台容器不限宽，输入框不能跟着容器一直拉长：
	   控件与结果行统一封在 32rem，行分隔线仍走满宽。 */
	.prow .right > * {
		max-width: 32rem;
	}

	/* 机器值（仓库地址、ID、密钥）用等宽：字号继承 .ui-input 的 15px，
	   只换字族，不去改尺寸——尺寸归 .ui-input 管。 */
	.ui-input.mono {
		font-family: var(--font-mono, ui-monospace, monospace);
	}

	.ui-input.invalid {
		border-color: var(--destructive);
	}

	/* 只读状态框：和 .ui-input 同一套 token，只是没有光标 */
	.field-box {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		height: 2.25rem;
		padding: 0 0.75rem;
		background: var(--input-bg);
		border: 1px solid var(--input-border);
		border-radius: 10px;
		font-size: 0.9375rem;
		color: var(--deep-text);
		min-width: 0;
	}

	.field-box .grow {
		flex: 1;
	}

	.field-box .ok {
		color: var(--success);
	}

	/* 未上传时的投放区：虚线、等宽提示，点一下开文件框 */
	.upload-slot {
		display: flex;
		align-items: center;
		width: 100%;
		height: 2.25rem;
		padding: 0 0.75rem;
		border: 1px dashed var(--input-border);
		border-radius: 10px;
		background: none;
		font: inherit;
		font-size: 0.9375rem;
		color: var(--content-meta);
		text-align: left;
		cursor: pointer;
		transition:
			border-color 0.15s ease,
			color 0.15s ease;
	}

	.upload-slot:hover {
		border-color: color-mix(in srgb, var(--primary) 55%, transparent);
		color: var(--deep-text);
	}

	.pair {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	/* 密码框：眼睛按钮压在输入框右侧，不另起一列 */
	.eye-wrap {
		position: relative;
	}

	.eye-wrap .ui-input {
		padding-right: 2.25rem;
	}

	.eye {
		position: absolute;
		top: 50%;
		right: 0.5rem;
		transform: translateY(-50%);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		padding: 0;
		border: none;
		background: none;
		color: var(--content-meta);
		cursor: pointer;
	}

	.eye:hover {
		color: var(--deep-text);
	}

	.file-hidden {
		display: none;
	}

	.link {
		padding: 0;
		border: none;
		background: none;
		font: inherit;
		font-size: var(--admin-fs-meta, 0.75rem);
		font-weight: 500;
		color: var(--primary);
		white-space: nowrap;
		cursor: pointer;
	}

	.link:hover:not(:disabled) {
		text-decoration: underline;
	}

	.link:disabled {
		color: var(--content-meta);
		cursor: default;
	}

	.link:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}

	/* 验证痕迹：机器记账的一行，等宽 */
	.trace {
		margin: 0.375rem 0 0;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: var(--admin-fs-data, 0.6875rem);
		line-height: 1.6;
		color: var(--content-meta);
	}

	.trace b {
		color: var(--deep-text);
		font-weight: 500;
	}

	.trace.bad {
		color: var(--destructive);
	}

	.dim {
		color: var(--content-meta);
	}

	.mono {
		font-family: var(--font-mono, ui-monospace, monospace);
	}

	.ok-t {
		color: var(--success);
	}

	/* 底部次级动作 */
	.foot-row {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-top: 1.25rem;
		padding-top: 0.875rem;
		border-top: 1px solid var(--line-divider);
	}

	.foot-row .grow {
		flex: 1;
	}

	/* 泄漏检测结果 */
	.leak {
		margin-top: 0.75rem;
	}

	.leak-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.25rem 0;
		font-size: var(--admin-fs-meta, 0.75rem);
	}

	.leak-badge {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: var(--admin-fs-data, 0.6875rem);
		color: var(--content-meta);
	}

	.leak-row[data-level="warning"] .leak-badge {
		color: var(--primary);
	}

	.leak-row[data-level="serious"] .leak-badge,
	.leak-row[data-level="danger"] .leak-badge {
		color: var(--destructive);
		font-weight: 600;
	}

	/* 私钥查看弹层：只读、等宽、可复制 */
	.mask {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
	}

	/* 铺满的按钮当遮罩：点击关闭，且天然可聚焦 */
	.backdrop {
		position: absolute;
		inset: 0;
		padding: 0;
		border: none;
		background: rgb(0 0 0 / 0.55);
		cursor: default;
	}

	.dialog {
		position: relative;
		display: flex;
		flex-direction: column;
		width: min(46rem, 100%);
		max-height: min(76vh, 40rem);
		border: 1px solid var(--line-divider);
		border-radius: 14px;
		background: var(--card-bg);
		overflow: hidden;
	}

	.dialog-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--line-divider);
	}

	.dialog-head .name {
		font-size: var(--admin-fs-body, 0.875rem);
		font-weight: 600;
		color: var(--deep-text);
	}

	.dialog-head .grow,
	.dialog-foot .grow {
		flex: 1;
	}

	.seg {
		padding: 0.1875rem 0.5rem;
		border: 1px solid var(--line-divider);
		border-radius: 7px;
		background: none;
		font: inherit;
		font-size: var(--admin-fs-data, 0.6875rem);
		color: var(--content-meta);
		cursor: pointer;
	}

	.seg.on {
		border-color: color-mix(in srgb, var(--primary) 45%, transparent);
		color: var(--primary);
	}

	.keybody {
		flex: 1;
		min-height: 0;
		margin: 0;
		padding: 0.875rem 1rem;
		overflow: auto;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: var(--admin-fs-data, 0.6875rem);
		line-height: 1.65;
		color: var(--deep-text);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.dialog-foot {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 1rem;
		border-top: 1px solid var(--line-divider);
		font-size: var(--admin-fs-data, 0.6875rem);
	}

	/* 窄屏：左栏收到标题上方，控件拿满一行 */
	@media (max-width: 860px) {
		.prow {
			grid-template-columns: minmax(0, 1fr);
			gap: 0.5rem;
		}

	}
</style>
