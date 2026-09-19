import { ImageResponse } from "next/og";

export const alt = "TOPTIER — AI Trading Signals & Screenshot Analysis";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function TwitterImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 32,
          background: "linear-gradient(135deg, #0a0e14 0%, #0f2a4a 100%)",
          color: "#ffffff",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: "64px 72px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            fontSize: 44,
            fontWeight: 800,
            letterSpacing: -1,
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: "#1b4f9c",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 32,
              fontWeight: 900,
            }}
          >
            T
          </div>
          <span>
            TOP<span style={{ color: "#6ea3e8" }}>TIER</span>
          </span>
        </div>
        <div
          style={{
            fontSize: 72,
            fontWeight: 800,
            lineHeight: 1.1,
            letterSpacing: -2,
          }}
        >
          AI Trading Signals & Screenshot Analysis
        </div>
        <div
          style={{
            fontSize: 30,
            color: "#9fb8d4",
            maxWidth: 880,
          }}
        >
          Scored signals. Ranked traders. Transparent proof-of-performance.
        </div>
      </div>
    ),
    { ...size }
  );
}