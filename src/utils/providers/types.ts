/**
 * Platform-neutral contracts for authentication and content storage.
 *
 * The admin backend must not call a platform SDK directly. Every capability it needs is
 * expressed here; a concrete platform is added by writing one adapter and registering it in
 * `registry.ts`.
 */

/** Identity returned by an auth source. */
export interface AuthIdentity {
	/** Stable identifier from the auth source (GitHub numeric id, GitLab uid, …) */
	id: string;
	/** Human-readable name, used in audit logs and the dashboard */
	login: string;
	avatarUrl?: string;
}

export type AuthProviderKind = "oauth" | "token";

export interface AuthBeginContext {
	request: Request;
	/** Path to return to after a successful login; already sanitized by the caller */
	next: string;
	/** Ask the provider to re-prompt for credentials (step-up confirmation) */
	forceLogin?: boolean;
}

export interface AuthBeginResult {
	url: string;
	/** One-shot cookie carrying state/verifier until the callback runs */
	transactionCookie?: string;
	/** Cookie name, so the callback can clear it in one place */
	transactionCookieName?: string;
}

export interface AuthCompleteContext {
	request: Request;
	code: string;
	redirectUri: string;
	verifier: string;
}

export type AuthCompleteResult =
	| { ok: true; identity: AuthIdentity }
	| { ok: false; error: string };

export type AuthTokenResult =
	| { ok: true; identity: AuthIdentity }
	| { ok: false; error: string };

/**
 * One way to prove you are the administrator.
 *
 * Sessions, cookies, and step-up windows stay in the shared session layer: a provider only
 * answers "who is this", never "how long is the session".
 */
export interface AuthProvider {
	readonly id: string;
	readonly kind: AuthProviderKind;
	readonly label: string;
	readonly capabilities: {
		/** A fresh login can act as step-up confirmation for sensitive writes */
		stepUp: boolean;
		/** Login yields a remote identity */
		remoteIdentity: boolean;
	};
	/** True when every credential this provider needs is present. */
	isConfigured(): boolean;
	/** OAuth providers: build the authorize URL and the transaction cookie. */
	beginLogin?(ctx: AuthBeginContext): Promise<AuthBeginResult | null>;
	/** OAuth providers: exchange the code for an identity and check membership. */
	completeLogin?(ctx: AuthCompleteContext): Promise<AuthCompleteResult>;
	/** Token providers: validate the secret directly. */
	verifyToken?(token: string): Promise<AuthTokenResult>;
}

export type StorageReadReason = "not-found" | "auth" | "server" | "network";

export type StorageReadResult =
	| { ok: true; content: string }
	| { ok: false; reason: StorageReadReason; status?: number; message: string };

export interface StorageEntry {
	name: string;
	path: string;
	type: string;
	sha?: string;
}

export interface StorageFileChange {
	path: string;
	/** `null` deletes the file inside the same commit */
	content: string | null;
}

export interface StorageCommitResult {
	ok: boolean;
	commitOid?: string;
	message?: string;
}

/**
 * One place content can live: a git repository, an object store, or a database.
 *
 * Capability checks live on the provider (`isConfigured`), not on the login method: whether
 * the dashboard can push is decided by storage credentials, never by how the user signed in.
 */
export interface StorageProvider {
	readonly id: string;
	readonly label: string;
	/** True when every credential this provider needs is present. */
	isConfigured(): boolean;
	readFile(path: string): Promise<StorageReadResult>;
	writeFile(path: string, content: string, message: string): Promise<boolean>;
	deleteFile(path: string, message: string): Promise<boolean>;
	listFiles(directory: string): Promise<StorageEntry[]>;
	commitFiles(
		files: StorageFileChange[],
		message: { headline: string; body?: string },
	): Promise<StorageCommitResult>;
	/** Recursively list Markdown files with their blob sha (used by sync diffing). */
	listMarkdownWithSha?(
		directory: string,
	): Promise<Array<{ path: string; sha: string }>>;
	/** Recursively list Markdown file paths. */
	listMarkdownPaths?(directory: string): Promise<string[]>;
	/** Resolve a post slug to its storage path, or null when it does not exist. */
	resolvePath?(slug: string): Promise<string | null>;
	/** Round-trip latency in ms; throws when the platform is unreachable. */
	testConnection(): Promise<number>;
}
