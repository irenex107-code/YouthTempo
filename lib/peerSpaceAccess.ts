import type { SupabaseClient } from "@supabase/supabase-js";
import { STUDENT_CONSENT_POLICY_VERSION } from "@/lib/studentConsent";

export const ADULT_PEER_SPACE_CODE = "adult_peer_space";
export const INITIAL_PEER_SPACE_RULES_VERSION = "2026-09-17";

export function isPeerSpaceAccessApiEnabled() {
  return process.env.PEER_SPACE_ACCESS_API_ENABLED === "true";
}

type AdultConsentFacts = {
  age_band?: string | null;
  consent_basis?: string | null;
  policy_version?: string | null;
  status?: string | null;
  student_assented_at?: string | null;
} | null;

type MembershipFacts = {
  id: string;
  user_id: string;
  space_id: string;
  cohort_id: string;
  status: string;
  accepted_rules_version: string | null;
  accepted_rules_at: string | null;
  created_at: string;
};

type SpaceFacts = {
  id: string;
  code: string;
  age_scope: string;
  status: string;
  rules_version: string;
};

type CohortFacts = {
  id: string;
  space_id: string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
};

type RoomFacts = {
  id: string;
  space_id: string;
  room_type: string;
  status: "staffed_open" | "read_only" | "paused" | "closed";
};

export type PeerSpaceEligibilityFacts = {
  authenticatedUserId: string;
  profileRole?: string | null;
  consent: AdultConsentFacts;
  membership?: MembershipFacts | null;
  space?: SpaceFacts | null;
  cohort?: CohortFacts | null;
  now?: Date;
};

export type PeerSpaceAccessDecision =
  | { available: false }
  | {
      available: true;
      membershipId: string;
      spaceId: string;
      membershipStatus: "invited" | "active";
      rulesVersion: string;
      rulesAccepted: boolean;
      room: RoomFacts | null;
    };

export function hasCurrentAdultSelfConsent(consent: AdultConsentFacts) {
  return Boolean(
    consent
    && consent.age_band === "18_plus"
    && consent.consent_basis === "adult_self"
    && consent.policy_version === STUDENT_CONSENT_POLICY_VERSION
    && consent.status === "active"
    && consent.student_assented_at,
  );
}

function cohortIsOpen(cohort: CohortFacts, now: Date) {
  const nowMs = now.getTime();
  const startsAtMs = cohort.starts_at ? Date.parse(cohort.starts_at) : null;
  const endsAtMs = cohort.ends_at ? Date.parse(cohort.ends_at) : null;
  return (
    cohort.status === "active"
    && (startsAtMs === null || (Number.isFinite(startsAtMs) && startsAtMs <= nowMs))
    && (endsAtMs === null || (Number.isFinite(endsAtMs) && endsAtMs > nowMs))
  );
}

export function isEligibleForAdultPeerSpace({
  authenticatedUserId,
  profileRole,
  consent,
  membership,
  space,
  cohort,
  now = new Date(),
}: PeerSpaceEligibilityFacts) {
  return Boolean(
    profileRole === "学生"
    && hasCurrentAdultSelfConsent(consent)
    && membership
    && membership.user_id === authenticatedUserId
    && ["invited", "active"].includes(membership.status)
    && space
    && membership.space_id === space.id
    && space.code === ADULT_PEER_SPACE_CODE
    && space.age_scope === "18_plus"
    && ["invite_only", "active"].includes(space.status)
    && cohort
    && membership.cohort_id === cohort.id
    && membership.space_id === cohort.space_id
    && cohortIsOpen(cohort, now),
  );
}

function unique(values: string[]) {
  return [...new Set(values)];
}

export async function loadPeerSpaceAccess(
  supabase: SupabaseClient,
  authenticatedUserId: string,
  now = new Date(),
): Promise<PeerSpaceAccessDecision> {
  const [{ data: profile, error: profileError }, { data: consent, error: consentError }] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", authenticatedUserId).maybeSingle(),
    supabase
      .from("student_consents")
      .select("age_band,consent_basis,policy_version,status,student_assented_at")
      .eq("student_user_id", authenticatedUserId)
      .maybeSingle(),
  ]);
  if (profileError) throw profileError;
  if (consentError) throw consentError;
  if (profile?.role !== "学生" || !hasCurrentAdultSelfConsent(consent)) return { available: false };

  const { data: membershipRows, error: membershipError } = await supabase
    .from("peer_space_memberships")
    .select("id,user_id,space_id,cohort_id,status,accepted_rules_version,accepted_rules_at,created_at")
    .eq("user_id", authenticatedUserId)
    .in("status", ["invited", "active"])
    .order("created_at", { ascending: false })
    .limit(20);
  if (membershipError) throw membershipError;
  const memberships = (membershipRows || []) as MembershipFacts[];
  if (!memberships.length) return { available: false };

  const [{ data: spaceRows, error: spaceError }, { data: cohortRows, error: cohortError }] = await Promise.all([
    supabase
      .from("peer_spaces")
      .select("id,code,age_scope,status,rules_version")
      .in("id", unique(memberships.map((membership) => membership.space_id))),
    supabase
      .from("peer_space_cohorts")
      .select("id,space_id,status,starts_at,ends_at")
      .in("id", unique(memberships.map((membership) => membership.cohort_id))),
  ]);
  if (spaceError) throw spaceError;
  if (cohortError) throw cohortError;

  const spaces = new Map(((spaceRows || []) as SpaceFacts[]).map((space) => [space.id, space]));
  const cohorts = new Map(((cohortRows || []) as CohortFacts[]).map((cohort) => [cohort.id, cohort]));
  const membership = memberships
    .sort((left, right) => Number(right.status === "active") - Number(left.status === "active"))
    .find((candidate) => isEligibleForAdultPeerSpace({
      authenticatedUserId,
      profileRole: profile.role,
      consent,
      membership: candidate,
      space: spaces.get(candidate.space_id),
      cohort: cohorts.get(candidate.cohort_id),
      now,
    }));
  if (!membership) return { available: false };

  const space = spaces.get(membership.space_id);
  if (!space) return { available: false };
  const { data: room, error: roomError } = await supabase
    .from("peer_space_rooms")
    .select("id,space_id,room_type,status")
    .eq("space_id", membership.space_id)
    .eq("room_type", "everyone")
    .maybeSingle();
  if (roomError) throw roomError;
  if (!room) throw new Error("Peer Space public room is not configured.");

  const acceptedCurrentRules = (
    membership.status === "active"
    && membership.accepted_rules_version === space.rules_version
    && Boolean(membership.accepted_rules_at)
  );
  let hasActiveRoomMembership = false;
  if (acceptedCurrentRules) {
    const { data: roomMembership, error: roomMembershipError } = await supabase
      .from("peer_space_room_memberships")
      .select("id")
      .eq("room_id", room.id)
      .eq("membership_id", membership.id)
      .eq("status", "active")
      .is("visible_until", null)
      .maybeSingle();
    if (roomMembershipError) throw roomMembershipError;
    hasActiveRoomMembership = Boolean(roomMembership);
  }

  const rulesAccepted = acceptedCurrentRules;
  return {
    available: true,
    membershipId: membership.id,
    spaceId: membership.space_id,
    membershipStatus: membership.status as "invited" | "active",
    rulesVersion: space.rules_version,
    rulesAccepted,
    room: hasActiveRoomMembership ? (room as RoomFacts) : null,
  };
}

export function publicPeerSpaceAccess(decision: PeerSpaceAccessDecision) {
  if (!decision.available) return { available: false as const };
  return {
    available: true as const,
    rulesVersion: decision.rulesVersion,
    rulesAccepted: decision.rulesAccepted,
    room: decision.room
      ? {
          id: decision.room.id,
          code: "everyone" as const,
          status: decision.room.status,
        }
      : null,
  };
}
