/**
 * Break-glass token adapter.
 *
 * A second way in when the primary provider is unavailable. It yields no remote identity and
 * grants exactly the same dashboard permissions as any other login method — the login method
 * never decides what you can do.
 */

import { isBreakglassConfigured, verifyBreakglassToken } from "../../auth";
import type { AuthProvider, AuthTokenResult } from "../types";

export const breakglassAuthProvider: AuthProvider = {
	id: "breakglass",
	kind: "token",
	label: "Break-glass token",
	capabilities: { stepUp: false, remoteIdentity: false },

	isConfigured: () => isBreakglassConfigured(),

	async verifyToken(token: string): Promise<AuthTokenResult> {
		if (!isBreakglassConfigured()) {
			return { ok: false, error: "breakglass_disabled" };
		}
		if (!verifyBreakglassToken(token)) {
			return { ok: false, error: "invalid_token" };
		}
		return { ok: true, identity: { id: "breakglass", login: "admin" } };
	},
};
