import type { RelatedHit } from "@/lib/client";

export const OTHER_SOURCES = "Same topic, other sources";

/** A hit is another source's take on the topic when any " · "-joined part of its reason starts with "Other source". */
export const isOtherSource = (h: Pick<RelatedHit, "reason">) => h.reason.split(" · ").some((p) => p.startsWith("Other source"));

/** Splits hits (order kept) into this source's related series and other sources' versions of the topic. */
export const groupRelated = (hits: RelatedHit[]) => ({
  same: hits.filter((h) => !isOtherSource(h)),
  other: hits.filter(isOtherSource),
});

/** Panel heading: country pages say which country the same-country indicators are about. */
export const exploreHeading = (countryName?: string | null) => (countryName ? `More about ${countryName}` : "Explore next");
