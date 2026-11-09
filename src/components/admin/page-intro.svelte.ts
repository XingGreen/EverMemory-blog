import { getContext, setContext } from "svelte";

const PAGE_INTRO_KEY = Symbol("admin-page-intro");

export type PageIntroStore = { value: string };

/**
 * 当前页说明文字的跨组件共享（后台外壳 → 移动顶栏）。
 *
 * 窄屏下页面自身的说明段落是隐藏的，问号入口放在顶栏标题旁，
 * 因此说明文字要从 AdminPage 冒泡到 AdminDashboard，这里用 context 传递，
 * 避免把每个页面的文案在顶栏再抄一份。
 */
export function createPageIntroStore(): PageIntroStore {
	const store = $state<PageIntroStore>({ value: "" });
	setContext(PAGE_INTRO_KEY, store);
	return store;
}

export function usePageIntroStore(): PageIntroStore | undefined {
	return getContext<PageIntroStore | undefined>(PAGE_INTRO_KEY);
}
