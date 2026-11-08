# Provider Architecture

The backend never calls a platform SDK directly. Authentication and content storage are
expressed as two interfaces, and a concrete platform is one adapter behind each of them.

## Layers

```text
route handlers (src/pages/api/admin/**)
        │
        ├── getAuthProvider()      → AuthProvider
        └── getStorageProvider()   → StorageProvider
                │
                ├── providers/auth/github-oauth.ts   → utils/github-oauth.ts
                ├── providers/auth/breakglass.ts     → utils/auth.ts
                └── providers/storage/github-app.ts  → utils/github-app.ts
                        │
                        └── providers/registry.ts + providers/config.ts
```

Routes depend on the interfaces only. The GitHub SDK lives below the adapters, so replacing
the platform means adding a file, not touching the routes.

## AuthProvider

```ts
interface AuthProvider {
	id: string;
	kind: "oauth" | "token";
	label: string;
	capabilities: { stepUp: boolean; remoteIdentity: boolean };
	isConfigured(): boolean;
	beginLogin?(ctx: AuthBeginContext): Promise<AuthBeginResult | null>;
	completeLogin?(ctx: AuthCompleteContext): Promise<AuthCompleteResult>;
	verifyToken?(token: string): Promise<AuthTokenResult>;
}
```

- `beginLogin` builds the authorize URL and the one-shot transaction cookie.
- `completeLogin` exchanges the code, fetches the identity, and enforces membership.
- `verifyToken` validates a fallback secret directly.

Sessions, cookies, and the step-up window stay in `src/utils/auth.ts`: a provider answers
"who is this", never "how long is the session".

Current implementations: `github` (OAuth, allowlist via `ADMIN_GITHUB_ID`) and `breakglass`
(token, enabled by `ADMIN_BREAKGLASS_TOKEN`).

## StorageProvider

```ts
interface StorageProvider {
	id: string;
	label: string;
	isConfigured(): boolean;
	readFile(path): Promise<StorageReadResult>;
	writeFile(path, content, message): Promise<boolean>;
	deleteFile(path, message): Promise<boolean>;
	listFiles(directory): Promise<StorageEntry[]>;
	commitFiles(files, message): Promise<StorageCommitResult>;
	listMarkdownWithSha?(directory): Promise<Array<{ path: string; sha: string }>>;
	listMarkdownPaths?(directory): Promise<string[]>;
	resolvePath?(slug: string): Promise<string | null>;
	testConnection(): Promise<number>;
}
```

Current implementation: `github` (GitHub App). A GitLab API, S3/R2 bucket, or database
adapter implements the same methods and is registered in the same map.

## Configuration

| Variable | Values | Default | Effect |
| :--- | :--- | :--- | :--- |
| `AUTH_PROVIDER` | `github` \| `none` | `github` | Primary login method |
| `STORAGE_PROVIDER` | `github` \| `none` | `github` | Content backend |

Both are read through `readSecretValue`, so `.env.local` and platform variables behave
identically. Unknown values fall back to the unconfigured provider rather than throwing.

## Dynamic loading

`providers/registry.ts` holds two maps:

```ts
const AUTH_PROVIDERS = { github: githubOAuthAuthProvider, breakglass: breakglassAuthProvider };
const STORAGE_PROVIDERS = { github: githubAppStorageProvider };
```

Selection happens at call time, not at import time, so a single build can serve different
backends depending on environment variables:

- `getAuthProvider()` returns the provider named by `AUTH_PROVIDER`, or `null` when `none`.
- `getFallbackAuthProviders()` always returns configured token providers, independent of the
  primary selection.
- `getStorageProvider()` never returns `null`. When nothing is configured it returns a
  placeholder whose methods answer "请配置 GitHub App 凭证", so callers keep one code path.

## Permission model

The login method never decides permissions.

- Every authenticated session can use the full dashboard: editing, drafts, revisions, taxonomy,
  sessions, and secrets.
- Operations that need a remote repository are gated by **storage credentials**, not by how the
  user signed in: `storage.isConfigured()`.
- When storage is unconfigured, the dashboard still opens. Push, sync, and remote config writes
  return `400` with `请配置 GitHub App 凭证`; nothing blocks the login itself.

## Adding a platform

1. Create `src/utils/providers/auth/<platform>.ts` or `storage/<platform>.ts` implementing the
   interface.
2. Add one line to the corresponding map in `registry.ts`.
3. Set `AUTH_PROVIDER` / `STORAGE_PROVIDER`, or leave them alone for a multi-provider setup.

No route, component, or shared utility needs to change.
