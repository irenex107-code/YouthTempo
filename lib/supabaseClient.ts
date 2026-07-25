import { SupabaseClient, createClient } from "@supabase/supabase-js";

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

export function isSupabaseConfigured() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export function getSupabase() {
  if (!isSupabaseConfigured()) return null;
  if (browserClient) return browserClient;

  browserClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  });

  return browserClient;
}
