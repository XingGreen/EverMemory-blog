/**
 * Adapter registry and dynamic selection.
 *
 * Adding a platform = writing one adapter and adding one line here. Nothing else in the
 * codebase needs to change, and no route imports a platform SDK directly.
 */

import { breakglassAuthProvider } from "./auth/breakglass";
import { githubOAuthAuthProvider } from "./auth/github-oauth";
import { getAuthProviderId, getStorageProviderId } from "./config";
import { githubAppStorageProvider } from "./storage/github-app";
import type { AuthProvider, StorageProvider } from "./types";

const AUTH_PROVIDERS: Record<string, AuthProvider> = {
	github: githubOAuthAuthProvider,
	breakglass: breakglassAuthProvider,
};

const STORAGE_PROVIDERS: Record<string, StorageProvider> = {
	github: githubAppStorageProvider,
};

const UNCONFIGURED_STORAGE_MESSAGE = "请配置 GitHub App 凭证";

/**
 * Placeholder used when `STORAGE_PROVIDER=none` or the id is unknown.
 *
 * It exists so callers can stay on one code path: check `isConfigured()` and surface the
 * message instead of crashing or blocking the dashboard.
 */
const unconfiguredStorageProvider: StorageProvider = {
	id: "none",
	label: "Not configured",
	isConfigured: () => false,
	async readFile() {
		return { ok: false, reason: "not-found", message: UNCONFIGURED_STORAGE_MESSAGE };
	},
	async writeFile() {
		return false;
	},
	async deleteFile() {
		return false;
	},
	async listFiles() {
		return [];
	},
	async commitFiles() {
		return { ok: false, message: UNCONFIGURED_STORAGE_MESSAGE };
	},
	async testConnection(): Promise<number> {
		throw new Error(UNCONFIGURED_STORAGE_MESSAGE);
	},
};

/** Primary auth provider chosen by `AUTH_PROVIDER`; null when disabled. */
export function getAuthProvider(): AuthProvider | null {
	const id = getAuthProviderId();
	if (id === "none") return null;
	return AUTH_PROVIDERS[id] ?? null;
}

/** Look a provider up by id, ignoring the selector (used by explicit routes). */
export function getAuthProviderById(id: string): AuthProvider | null {
	return AUTH_PROVIDERS[id] ?? null;
}

/**
 * Fallback providers that stay available regardless of `AUTH_PROVIDER`.
 * Only providers that are actually configured are returned.
 */
export function getFallbackAuthProviders(): AuthProvider[] {
	return [breakglassAuthProvider].filter((provider) => provider.isConfigured());
}

/** Current content store. Never null: unconfigured ones answer with a clear message. */
export function getStorageProvider(): StorageProvider {
	const id = getStorageProviderId();
	if (id === "none") return unconfiguredStorageProvider;
	return STORAGE_PROVIDERS[id] ?? unconfiguredStorageProvider;
}

export {
	AUTH_PROVIDER_KEY,
	STORAGE_PROVIDER_KEY,
	getAuthProviderId,
	getStorageProviderId,
} from "./config";
export type {
	AuthBeginContext,
	AuthBeginResult,
	AuthCompleteContext,
	AuthCompleteResult,
	AuthIdentity,
	AuthProvider,
	AuthProviderKind,
	AuthTokenResult,
	StorageCommitResult,
	StorageEntry,
	StorageFileChange,
	StorageProvider,
	StorageReadReason,
	StorageReadResult,
} from "./types";
