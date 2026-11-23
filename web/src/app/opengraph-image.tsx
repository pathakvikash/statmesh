import { ImageResponse } from "next/og";
import { Mark } from "@/components/Logo";

export const alt = "statmesh: public statistics, every number sourced";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 96, background: "#0F1020", color: "#fff", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
          <Mark size={160} />
          <div style={{ fontSize: 112, fontWeight: 700, letterSpacing: -3 }}>statmesh</div>
        </div>
        <div style={{ marginTop: 48, fontSize: 44, color: "#C7C9F5" }}>Public statistics, every number sourced.</div>
      </div>
    ),
    size,
  );
}
