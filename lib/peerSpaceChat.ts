import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPeerSpaceAccess } from "@/lib/peerSpaceAccess";

export type PeerRoom = {
  id: string;
  space_id: string;
  room_code: string;
  room_type: "everyone" | "theme";
  status: "staffed_open" | "read_only" | "paused" | "closed";
  title_zh: string;
  title_en: string;
  description_zh: string;
  description_en: string;
  guidelines_zh: string;
  guidelines_en: string;
};

export type PeerRoomMembership = {
  id: string;
  room_id: string;
  membership_id: string;
  status: "active" | "left" | "removed";
  visible_from: string;
  visible_until: string | null;
};

export function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value);
}

export function roomNickname(roomMembershipId: string, locale: "zh-CN" | "en") {
  const digits = String(parseInt(createHash("sha256").update(roomMembershipId).digest("hex").slice(0, 8), 16) % 10000).padStart(4, "0");
  return locale === "en" ? `Room peer ${digits}` : `房间同伴 ${digits}`;
}

export async function loadPeerSpaceChatContext(supabase: SupabaseClient, userId: string) {
  const decision = await loadPeerSpaceAccess(supabase, userId);
  if (!decision.available) return { available: false as const };
  const [{ data: roomRows, error: roomError }, { data: membershipRows, error: membershipError }] = await Promise.all([
    supabase.from("peer_space_rooms")
      .select("id,space_id,room_code,room_type,status,title_zh,title_en,description_zh,description_en,guidelines_zh,guidelines_en")
      .eq("space_id", decision.spaceId).order("created_at", { ascending: true }),
    supabase.from("peer_space_room_memberships")
      .select("id,room_id,membership_id,status,visible_from,visible_until")
      .eq("membership_id", decision.membershipId)
      .eq("status", "active")
      .is("visible_until", null),
  ]);
  if (roomError) throw roomError;
  if (membershipError) throw membershipError;
  const joinedByRoom = new Map(((membershipRows || []) as PeerRoomMembership[])
    .map((membership) => [membership.room_id, membership]));
  const rooms = ((roomRows || []) as PeerRoom[]).map((room) => ({
    ...room,
    membership: joinedByRoom.get(room.id) || null,
  }));
  return {
    available: true as const,
    membershipId: decision.membershipId,
    rulesAccepted: decision.rulesAccepted,
    rooms,
  };
}

export async function loadPeerSpaceRoomAccess(
  supabase: SupabaseClient,
  userId: string,
  roomId: string,
) {
  const context = await loadPeerSpaceChatContext(supabase, userId);
  if (!context.available || !context.rulesAccepted) return null;
  const room = context.rooms.find((candidate) => candidate.id === roomId);
  return room?.membership ? { room, membership: room.membership, membershipId: context.membershipId } : null;
}
