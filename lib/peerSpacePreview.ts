export type PeerSpacePreviewState =
  | "rules"
  | "loading"
  | "open"
  | "read-only"
  | "paused"
  | "unavailable";

/**
 * This flag is only for reviewing non-production peer-space UI shells. It is not an
 * authorization decision and is deliberately impossible to enable in a
 * production build.
 */
export function isPeerSpaceUiPreviewEnabled() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.PEER_SPACE_UI_PREVIEW_ENABLED === "true"
  );
}
