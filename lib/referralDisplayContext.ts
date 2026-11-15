export const YOUNG_ADULT_REFERRAL_DISPLAY_CONTEXT = "young_adult" as const;

export type ReferralDisplayContext = typeof YOUNG_ADULT_REFERRAL_DISPLAY_CONTEXT;

export const YOUNG_ADULT_REFERRAL_HREF = `/referral?displayContext=${YOUNG_ADULT_REFERRAL_DISPLAY_CONTEXT}`;

export function normalizeReferralDisplayContext(value: unknown): ReferralDisplayContext | undefined {
  return value === YOUNG_ADULT_REFERRAL_DISPLAY_CONTEXT
    ? YOUNG_ADULT_REFERRAL_DISPLAY_CONTEXT
    : undefined;
}
