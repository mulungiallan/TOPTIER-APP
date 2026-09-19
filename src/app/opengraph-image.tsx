import { ImageResponse } from "next/og";

export const alt = "TOPTIER — AI Trading Signals & Screenshot Analysis";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "linear-gradient(135deg, #0a0e14 0%, #0f2a4a 100%)",
          color: "#ffffff",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 40,
            fontWeight: 800,
            letterSpacing: -1,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "#1b4f9c",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 28,
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
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          <div
            style={{
              fontSize: 76,
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: -2,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span>Every signal is scored.</span>
            <span style={{ color: "#6ea3e8" }}>
              Every trader has a rank.
            </span>
          </div>
          <div
            style={{
              fontSize: 30,
              color: "#9fb8d4",
              maxWidth: 820,
            }}
          >
            AI trading signals, screenshot analysis & transparent proof-of-performance.
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 22,
            color: "#6ea3e8",
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            ⚡ AI Signals
          </span>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            📷 Screenshot Analysis
          </span>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            📈 Live Proof
          </span>
        </div>
      </div>
    ),
    { ...size }
  );
}