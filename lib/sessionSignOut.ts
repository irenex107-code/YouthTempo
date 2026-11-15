import type { SupabaseClient } from "@supabase/supabase-js";

type AuthClient = SupabaseClient["auth"];
type SignOutOptions = { scope?: "global" | "local" | "others"; youthTempoExpectedUserId?: string };
type SignOutResult = Awaited<ReturnType<AuthClient["signOut"]>>;
type SignOutHook = { _signOut: (options?: SignOutOptions) => Promise<SignOutResult> };
type SessionTarget = { userId: string; token: string; sessionId: string | null };
type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export class SessionSignOutError extends Error {
  constructor(public readonly code: "session_changed" | "not_supported" | "temporarily_unavailable") {
    super("Account sign-out unavailable");
    this.name = "SessionSignOutError";
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function tokenIdentity(token: string) {
  try {
    const body = token.split(".")[1];
    if (!body) return null;
    const payload: unknown = JSON.parse(atob(body.replaceAll("-", "+").replaceAll("_", "/")));
    return object(payload) && typeof payload.sub === "string"
      ? { userId: payload.sub, sessionId: typeof payload.session_id === "string" ? payload.session_id : null } : null;
  } catch { return null; }
}

/** Browser-only adaptation tested against the pinned SDK's sign-out hook.
 * _signOut runs inside the SDK Auth lock. Its lifetime ends BEFORE the SDK drains
 * same-tab queued Auth operations, so a later B login keeps its own storage rules.
 * Provider authentication remains authoritative; this guard only fences UI races.
 */
export function createSessionSignOutGuard(options: {
  storageKey: string;
  storage: BrowserStorage | null;
  logoutUrl: string;
  fetch: typeof fetch;
  supportsSharedLock: () => boolean;
  withSharedLock: <T>(operation: () => Promise<T>) => Promise<T>;
}) {
  let target: SessionTarget | null = null;
  let installedAuth: AuthClient | null = null;

  function storedTarget(): SessionTarget | null {
    if (!options.storage) throw new SessionSignOutError("not_supported");
    let raw: string | null;
    try { raw = options.storage.getItem(options.storageKey); }
    catch { throw new SessionSignOutError("temporarily_unavailable"); }
    if (!raw) return null;
    try {
      const value: unknown = JSON.parse(raw);
      if (!object(value) || !object(value.user) || typeof value.user.id !== "string" || typeof value.access_token !== "string") {
        throw new Error("invalid_session");
      }
      const identity = tokenIdentity(value.access_token);
      if (identity && identity.userId !== value.user.id) throw new Error("invalid_session");
      return { userId: value.user.id, token: value.access_token, sessionId: identity?.sessionId ?? null };
    } catch { throw new SessionSignOutError("session_changed"); }
  }

  function matchesToken(token: string, bound: SessionTarget) {
    if (token === bound.token) return true;
    const identity = tokenIdentity(token);
    // Supabase token refresh retains session_id. A fresh login, including one for
    // the same user, must not be erased by an older session's outstanding logout.
    return bound.sessionId !== null && identity?.userId === bound.userId && identity.sessionId === bound.sessionId;
  }

  const storage = options.storage ? {
    getItem: (key: string) => options.storage!.getItem(key),
    setItem: (key: string, value: string) => options.storage!.setItem(key, value),
    removeItem: (key: string) => {
      if (target && key === options.storageKey) {
        const current = storedTarget();
        if (current && (current.userId !== target.userId || !matchesToken(current.token, target))) {
          throw new SessionSignOutError("session_changed");
        }
      }
      options.storage!.removeItem(key);
    },
  } : undefined;

  const guardedFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (target && url.origin + url.pathname === options.logoutUrl) {
      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
      const token = headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
      if (!matchesToken(token, target)) throw new SessionSignOutError("session_changed");
    }
    return options.fetch(input, init);
  };

  function install(auth: AuthClient) {
    const hook = auth as unknown as SignOutHook;
    const original = hook._signOut;
    if (typeof original !== "function") return;
    const verifyOtp = auth.verifyOtp;
    if (typeof verifyOtp !== "function") return;
    // The installed SDK locks initialize, exchangeCodeForSession, setSession
    // and refreshSession, but verifyOtp saves its new session without a lock.
    // Serialize both ordinary email OTP and token-hash redirects with logout.
    // Await initialization BEFORE acquiring the same lock to avoid nesting it.
    auth.verifyOtp = async (params) => {
      await auth.initialize();
      if (!options.supportsSharedLock()) return verifyOtp.call(auth, params);
      return options.withSharedLock(() => verifyOtp.call(auth, params));
    };
    hook._signOut = async (command = {}) => {
      if (!options.supportsSharedLock() || !options.storage) throw new SessionSignOutError("not_supported");
      const bound = storedTarget();
      if (!bound) {
        if (command.youthTempoExpectedUserId) throw new SessionSignOutError("session_changed");
        return { error: null };
      }
      if (command.youthTempoExpectedUserId && bound.userId !== command.youthTempoExpectedUserId) {
        throw new SessionSignOutError("session_changed");
      }
      if (target) throw new SessionSignOutError("temporarily_unavailable");
      target = bound;
      try { return await original.call(auth, { scope: command.scope }); }
      finally { target = null; }
    };
    installedAuth = auth;
  }

  async function signOut(auth: AuthClient, expectedUserId?: string) {
    if (auth !== installedAuth || !options.supportsSharedLock()) throw new SessionSignOutError("not_supported");
    const command: SignOutOptions = { scope: "global", ...(expectedUserId ? { youthTempoExpectedUserId: expectedUserId } : {}) };
    try {
      const { error } = await auth.signOut(command);
      if (error) throw new SessionSignOutError("temporarily_unavailable");
    } catch (error) {
      if (error instanceof SessionSignOutError) throw error;
      throw new SessionSignOutError("temporarily_unavailable");
    }
  }

  return { storage, fetch: guardedFetch, install, signOut };
}
