import { SupabaseClient, createClient } from "@supabase/supabase-js";
import { createSessionSignOutGuard, SessionSignOutError } from "@/lib/sessionSignOut";

// Supabase's project URL and publishable key are public browser configuration.
// Keep production fallbacks so container platforms that do not expose runtime
// variables during `next build` can still initialize the client.
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://saqkzfsmabsgbwdvuras.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_NiIGAQ6Wf--HakVNwFnSmA_zqzSGHRv";

let browserClient: SupabaseClient | null = null;
let signOutGuard: ReturnType<typeof createSessionSignOutGuard> | null = null;

export function isSupabaseConfigured() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export function getSupabase() {
  if (!isSupabaseConfigured()) return null;
  if (browserClient) return browserClient;

  const baseUrl = new URL(supabaseUrl.endsWith("/") ? supabaseUrl : `${supabaseUrl}/`);
  const storageKey = `sb-${baseUrl.hostname.split(".")[0]}-auth-token`;
  let storage: Storage | null = null;
  try { if (typeof window !== "undefined") storage = window.localStorage; } catch { /* existing SDK fallback */ }
  // Capture the underlying transport once; the wrapper must never call itself.
  const transport = globalThis.fetch.bind(globalThis);
  signOutGuard = createSessionSignOutGuard({ storageKey, storage,
    logoutUrl: new URL("auth/v1/logout", baseUrl).href,
    fetch: transport,
    supportsSharedLock: () => typeof navigator !== "undefined" && typeof navigator.locks?.request === "function",
    withSharedLock: async (operation) => await navigator.locks.request(`lock:${storageKey}`, { mode: "exclusive" }, () => operation()),
  });
  browserClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { fetch: signOutGuard.fetch },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
      storageKey,
      storage: signOutGuard.storage,
    },
  });
  signOutGuard.install(browserClient.auth);

  return browserClient;
}

export async function signOutSupabaseSession(expectedUserId?: string) {
  const client = getSupabase();
  if (!client || !signOutGuard) throw new SessionSignOutError("temporarily_unavailable");
  await signOutGuard.signOut(client.auth, expectedUserId);
}
