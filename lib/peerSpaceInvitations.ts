import type { SupabaseClient, User } from "@supabase/supabase-js";

export const PEER_SPACE_INVITATIONS_API_ENABLED =
  process.env.PEER_SPACE_INVITATIONS_API_ENABLED === "true";

export type PeerSpaceInvitationKind = "adult_pilot" | "verified_university_student";
export type PeerSpaceEvidenceSource = "trusted_roster" | "direct_review";

export function normalizeInvitationEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : null;
}

export function validInvitationKind(value: unknown): value is PeerSpaceInvitationKind {
  return value === "adult_pilot" || value === "verified_university_student";
}

export function validEvidenceSource(value: unknown): value is PeerSpaceEvidenceSource {
  return value === "trusted_roster" || value === "direct_review";
}

export async function claimAdultPeerSpaceInvitation(
  supabase: SupabaseClient,
  user: User,
) {
  const email = normalizeInvitationEmail(user.email);
  // A session proves control of the account; the invitation must also match a
  // confirmed login email. Never create or confirm an Auth user on their behalf.
  if (!email || !user.email_confirmed_at) return null;
  const { data, error } = await supabase.rpc("claim_peer_space_email_invitation", {
    p_user_id: user.id,
    p_email: email,
  });
  if (error) throw error;
  return typeof data === "string" ? data : null;
}
