"use client";

export interface Entitlements {
  /** Whether the realtime voice agent is offered. */
  voiceAgent: boolean;
}

// There are no plans on this platform, so features are a fixed setting.
// Voice is off for now; set this to true to show the voice controls again
// (the chat agents cover the same flows either way).
const ENTITLEMENTS: Entitlements = { voiceAgent: false };

export function useEntitlements(): { entitlements: Entitlements; loading: boolean } {
  return { entitlements: ENTITLEMENTS, loading: false };
}
