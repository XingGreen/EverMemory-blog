/**
 * Selectors that decide which adapter is loaded at runtime.
 *
 * Both are plain environment variables so the same build can run against a different auth
 * source or storage backend without a code change. They are not secrets, but they are read
 * through `readSecretValue` so local `.env.local` and platform variables behave the same.
 */

import { readSecretValue } from "../secret-io";

export const AUTH_PROVIDER_KEY = "AUTH_PROVIDER";
export const STORAGE_PROVIDER_KEY = "STORAGE_PROVIDER";

const DEFAULT_AUTH_PROVIDER = "github";
const DEFAULT_STORAGE_PROVIDER = "github";

function readSelector(key: string, fallback: string): string {
	try {
		const raw = readSecretValue(key)?.trim().toLowerCase();
		return raw || fallback;
	} catch {
		return fallback;
	}
}

/** Current auth source. `none` disables the primary login, leaving only token fallback. */
export function getAuthProviderId(): string {
	return readSelector(AUTH_PROVIDER_KEY, DEFAULT_AUTH_PROVIDER);
}

/** Current storage backend. `none` makes push/read operations report a missing configuration. */
export function getStorageProviderId(): string {
	return readSelector(STORAGE_PROVIDER_KEY, DEFAULT_STORAGE_PROVIDER);
}
