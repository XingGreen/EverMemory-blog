<script lang="ts">
import { onMount } from "svelte";

interface TurnstileApi {
	render: (
		container: HTMLElement,
		options: {
			sitekey: string;
			callback: (token: string) => void;
			"expired-callback": () => void;
			"error-callback": () => void;
			theme?: "light" | "dark" | "auto";
			appearance?: "always" | "execute" | "interaction-only";
		},
	) => string;
	remove: (widgetId: string) => void;
	reset: (widgetId: string) => void;
}

interface Props {
	siteKey: string;
	/** 校验通过时回调拿到的 token，一次性有效 */
	onToken: (token: string) => void;
	/** 父组件自增该值以要求本组件清空并重新渲染 widget */
	resetToken?: number;
	/** 脚本加载或校验出错时回调，供父组件提示用户 */
	onError?: () => void;
	theme?: "light" | "dark" | "auto";
}

let {
	siteKey,
	onToken,
	resetToken = 0,
	onError,
	theme = "auto",
}: Props = $props();

const SCRIPT_ID = "cf-turnstile-script";
const SCRIPT_SRC =
	"https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let container: HTMLDivElement | undefined = $state();
let widgetId = $state<string | null>(null);
let loadFailed = $state(false);

/** Turnstile token 一次性有效，任何路径下失效都要通知父组件清空 */
function clearToken() {
	onToken("");
}

function readApi(): TurnstileApi | null {
	const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
	return api && typeof api.render === "function" ? api : null;
}

function mountWidget() {
	const api = readApi();
	if (!api || !container) return;
	widgetId = api.render(container, {
		sitekey: siteKey,
		theme,
		appearance: "always",
		callback: (token) => onToken(token),
		"expired-callback": clearToken,
		"error-callback": () => {
			clearToken();
			loadFailed = true;
			onError?.();
		},
	});
}

function destroyWidget() {
	if (!widgetId) return;
	const api = readApi();
	if (api) {
		try {
			api.remove(widgetId);
		} catch {
			// widget 可能已被 CF 侧清理，忽略
		}
	}
	widgetId = null;
}

onMount(() => {
	if (!siteKey) return;

	/* 轮询句柄必须在卸载时清掉：脚本被 CSP 或拦截器挡掉时 load 事件永不触发，
	   否则 100ms 定时器会一直跑到页面关闭，组件反复挂载还会叠加。 */
	let poll: ReturnType<typeof setInterval> | null = null;

	function stopPolling() {
		if (poll === null) return;
		clearInterval(poll);
		poll = null;
	}

	function onExistingLoad() {
		stopPolling();
		mountWidget();
	}

	const existing = document.getElementById(SCRIPT_ID);
	if (existing) {
		// 组件重挂载时脚本已在，只可能需要直接渲染或轮询等待就绪
		if (readApi()) {
			mountWidget();
		} else {
			poll = setInterval(() => {
				if (readApi()) {
					stopPolling();
					mountWidget();
				}
			}, 100);
			existing.addEventListener("load", onExistingLoad, { once: true });
		}
		return () => {
			stopPolling();
			// load 可能发生在卸载之后：此时不该再渲染 widget
			existing.removeEventListener("load", onExistingLoad);
			destroyWidget();
		};
	}

	const script = document.createElement("script");
	script.id = SCRIPT_ID;
	script.src = SCRIPT_SRC;
	script.async = true;
	script.defer = true;
	script.onload = mountWidget;
	script.onerror = () => {
		loadFailed = true;
		clearToken();
		onError?.();
	};
	document.head.appendChild(script);

	return () => {
		stopPolling();
		destroyWidget();
	};
});

// 父组件每次提交后递增 resetToken：清掉旧 token 并让 widget 重新出题，
// 因为 Cloudflare 的 token 用过一次即失效，不换新则第二次提交必然失败。
$effect(() => {
	void resetToken;
	clearToken();
	if (widgetId === null) return;
	const api = readApi();
	if (!api) return;
	try {
		api.reset(widgetId);
	} catch {
		// 同 destroyWidget
	}
});
</script>

<div class="turnstile-container">
	<div bind:this={container} class="turnstile-slot"></div>
	{#if loadFailed}
		<p class="turnstile-error">人机验证加载失败，请刷新页面重试</p>
	{/if}
</div>

<style>
	.turnstile-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}

	.turnstile-slot {
		display: flex;
		justify-content: center;
	}

	.turnstile-error {
		font-size: 0.8rem;
		color: var(--danger-text, #d93025);
		text-align: center;
	}
</style>