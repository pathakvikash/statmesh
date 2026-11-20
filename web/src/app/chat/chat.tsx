"use client";
import { ChatPanel } from "@/components/ai/ChatPanel";
import type { GeoOpt, SrcOpt } from "./scope-bar";

/** The full-page chat: the engine lives in components/ai/ChatPanel (shared with the assistant sidebar). */
export function Chat({ sources = [], geos = [], hosted = false }: { sources?: SrcOpt[]; geos?: GeoOpt[]; hosted?: boolean }) {
  return <ChatPanel sources={sources} geos={geos} hosted={hosted} />;
}
