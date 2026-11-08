/**
 * GitHub OAuth adapter.
 *
 * Wraps the existing GitHub-specific helpers so the routes only touch the `AuthProvider`
 * contract. Membership (the single-admin allowlist) is enforced here, not in the routes.
 */

import {
	buildAuthorizeUrl,
	exchangeCodeForToken,
	fetchGitHubIdentity,
	generatePkce,
	generateState,
	getOAuthConfig,
	isAuthorizedIdentity,
	resolveRedirectUri,
} from "../../github-oauth";
import type {
	AuthBeginContext,
	AuthBeginResult,
	AuthCompleteContext,
	AuthCompleteResult,
	AuthProvider,
} from "../types";

export const GITHUB_OAUTH_TX_COOKIE = "admin_oauth_tx";
const TX_MAX_AGE = 600;

export interface OAuthTransaction {
	state: string;
	verifier: string;
	next: string;
	redirectUri: string;
}

/** Serialize the transaction into a full `Set-Cookie` value (HttpOnly, 10 minutes). */
export function serializeTransaction(
	tx: OAuthTransaction,
	cookieName = GITHUB_OAUTH_TX_COOKIE,
): string {
	return `${cookieName}=${encodeURIComponent(JSON.stringify(tx))}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${TX_MAX_AGE}`;
}

/** Parse the transaction cookie; returns null on malformed or incomplete data. */
export function parseTransaction(raw: string | null): OAuthTransaction | null {
	if (!raw) return null;
	try {
		const tx = JSON.parse(raw) as OAuthTransaction;
		if (typeof tx.state !== "string" || typeof tx.verifier !== "string") {
			return null;
		}
		return tx;
	} catch {
		return null;
	}
}

/** Clear the transaction cookie. */
export function clearTransactionCookie(
	cookieName = GITHUB_OAUTH_TX_COOKIE,
): string {
	return `${cookieName}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export const githubOAuthAuthProvider: AuthProvider = {
	id: "github",
	kind: "oauth",
	label: "GitHub",
	capabilities: { stepUp: true, remoteIdentity: true },

	isConfigured: () => getOAuthConfig() !== null,

	async beginLogin(ctx: AuthBeginContext): Promise<AuthBeginResult | null> {
		const config = getOAuthConfig();
		if (!config) return null;

		const { verifier, challenge } = generatePkce();
		const state = generateState();
		const redirectUri = resolveRedirectUri(ctx.request);

		return {
			url: buildAuthorizeUrl({
				clientId: config.clientId,
				redirectUri,
				state,
				challenge,
				forceLogin: ctx.forceLogin === true,
			}),
			transactionCookie: serializeTransaction({
				state,
				verifier,
				next: ctx.next,
				redirectUri,
			}),
			transactionCookieName: GITHUB_OAUTH_TX_COOKIE,
		};
	},

	async completeLogin(ctx: AuthCompleteContext): Promise<AuthCompleteResult> {
		const config = getOAuthConfig();
		if (!config) return { ok: false, error: "oauth_disabled" };

		const token = await exchangeCodeForToken({
			clientId: config.clientId,
			clientSecret: config.clientSecret,
			code: ctx.code,
			redirectUri: ctx.redirectUri,
			verifier: ctx.verifier,
		});
		if (!token) return { ok: false, error: "token_exchange_failed" };

		const identity = await fetchGitHubIdentity(token);
		if (!identity) return { ok: false, error: "identity_fetch_failed" };

		// Allowlist: any account other than the configured one is rejected without telling
		// the caller whether the account exists or is simply not the administrator.
		if (!isAuthorizedIdentity(identity, config)) {
			return { ok: false, error: "not_authorized" };
		}

		return {
			ok: true,
			identity: {
				id: identity.id,
				login: identity.login || "admin",
				avatarUrl: identity.avatarUrl,
			},
		};
	},
};
