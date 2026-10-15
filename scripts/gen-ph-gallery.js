const path = require("path");
const fs = require("fs");
const sharp = require("sharp");

const OUT_DIR = path.join(__dirname, "..", "public", "product-hunt");
const ICON = path.join(__dirname, "..", "public", "icon-source.png");

const W = 1270;
const H = 1270;

const slides = [
  {
    tag: "SIGNALS",
    title: "Daily AI Trading Signals",
    subtitle: "The two highest-confidence setups,\nranked and explained every day.",
  },
  {
    tag: "BOTS",
    title: "Automated Trading Bots",
    subtitle: "Put your strategy on autopilot\nand trade around the clock.",
  },
  {
    tag: "ANALYZER",
    title: "Free Screenshot Analyzer",
    subtitle: "Upload any chart and get an\ninstant AI breakdown. Unlimited.",
  },
];

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function lines(text, y, size) {
  const parts = text.split("\n");
  const lh = size * 1.35;
  return parts
    .map((p, i) => {
      return `<text x="635" y="${y + i * lh}" text-anchor="middle" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="${size}" font-weight="400" fill="#a9b4c2">${esc(
        p
      )}</text>`;
    })
    .join("\n");
}

function buildSvg(slide, iconB64) {
  const iconSize = 380;
  const iconX = (W - iconSize) / 2;
  const iconY = 315;
  const cardPad = 26;
  const eyebrowY = 860;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0a0e14"/>
      <stop offset="1" stop-color="#141b24"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.34" r="0.62">
      <stop offset="0" stop-color="#d6a344" stop-opacity="0.20"/>
      <stop offset="0.55" stop-color="#d6a344" stop-opacity="0.05"/>
      <stop offset="1" stop-color="#d6a344" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#d6a344" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#d6a344" stop-opacity="1"/>
      <stop offset="1" stop-color="#d6a344" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="iconClip">
      <rect x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}" rx="84"/>
    </clipPath>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>

  <circle cx="150" cy="1080" r="240" fill="#d6a344" opacity="0.03"/>
  <circle cx="1150" cy="200" r="200" fill="#d6a344" opacity="0.03"/>

  <text x="635" y="196" text-anchor="middle" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="46" font-weight="700" letter-spacing="14" fill="#d6a344">TOPTIER</text>
  <text x="635" y="240" text-anchor="middle" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="24" font-weight="400" letter-spacing="6" fill="#6f7b8a">TRADE SMARTER, NOT HARDER</text>

  <rect x="${iconX - cardPad}" y="${iconY - cardPad}" width="${iconSize + cardPad * 2}" height="${iconSize + cardPad * 2}" rx="110" fill="#141b24" stroke="#232c38" stroke-width="2"/>
  <image x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}" clip-path="url(#iconClip)" xlink:href="data:image/png;base64,${iconB64}" href="data:image/png;base64,${iconB64}"/>

  <text x="635" y="${eyebrowY}" text-anchor="middle" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="26" font-weight="700" letter-spacing="8" fill="#d6a344">${esc(
    slide.tag
  )}</text>

  <rect x="${W / 2 - 320}" y="${eyebrowY + 26}" width="640" height="3" rx="1.5" fill="url(#gold)"/>

  <text x="635" y="${eyebrowY + 108}" text-anchor="middle" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="66" font-weight="700" fill="#edf1f5">${esc(
    slide.title
  )}</text>

  ${lines(slide.subtitle, eyebrowY + 178, 34)}
</svg>`;
}

(async () => {
  const iconB64 = fs.readFileSync(ICON).toString("base64");
  let n = 1;
  for (const slide of slides) {
    const svg = buildSvg(slide, iconB64);
    const out = path.join(OUT_DIR, `gallery-${n}.png`);
    await sharp(Buffer.from(svg))
      .png({ quality: 95 })
      .toFile(out);
    const meta = await sharp(out).metadata();
    console.log(`${path.basename(out)} -> ${meta.width}x${meta.height}`);
    n++;
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
