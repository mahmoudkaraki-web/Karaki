// Karaki app icon (MAK, 18 Oct 2026: "Crest K as an icon, pearl on navy"). A heater shield in pearl on deep navy with a
// high contrast serif K drawn as shapes (no font), 1024 px, opaque as iOS requires.
const path = require("path");
const sharp = require(require.resolve("sharp", { paths: ["C:/Users/mahmo/OneDrive - Be Smart Me/BeSmart APPs - BeSmart APPs/besmart-pos-app"] }));
const out = process.argv[2];
const dx = -17; // the K sits optically centred: its outline 17 px right of the middle, its ink 16 px left (the heavy stem pulls the eye left)
const P = pts => pts.map(([x, y]) => `${x + dx},${y}`).join(" ");
const R = (x1, y1, x2, y2) => `<rect x="${x1 + dx}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}"/>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs>
  <radialGradient id="navy" cx="50%" cy="38%" r="75%">
    <stop offset="0" stop-color="#132650"/><stop offset="0.6" stop-color="#0B1838"/><stop offset="1" stop-color="#050C20"/>
  </radialGradient>
  <linearGradient id="pearl" gradientUnits="userSpaceOnUse" x1="232" y1="196" x2="792" y2="866">
    <stop offset="0" stop-color="#FCFAF5"/><stop offset="0.38" stop-color="#EDE6DA"/>
    <stop offset="0.62" stop-color="#F7F2EB"/><stop offset="0.82" stop-color="#E7E2EC"/><stop offset="1" stop-color="#DCD4C6"/>
  </linearGradient>
  <linearGradient id="field" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#0F1F44"/><stop offset="1" stop-color="#09152F"/>
  </linearGradient>
</defs>
<rect width="1024" height="1024" fill="url(#navy)"/>
<path d="M232 196 H792 V520 C792 704 662 804 512 866 C362 804 232 704 232 520 Z" fill="url(#field)" stroke="url(#pearl)" stroke-width="16" stroke-linejoin="round"/>
<path d="M262 226 H762 V520 C762 686 646 776 512 832 C378 776 262 686 262 520 Z" fill="none" stroke="#EDE6DA" stroke-opacity="0.55" stroke-width="4" stroke-linejoin="round"/>
<g fill="url(#pearl)" transform="translate(530 500) scale(0.9) translate(-530 -500)">
  ${R(400, 334, 452, 686)}
  ${R(366, 320, 486, 336)}
  ${R(366, 684, 486, 700)}
  <polygon points="${P([[452, 520], [630, 334], [654, 334], [452, 552]])}"/>
  ${R(598, 320, 690, 336)}
  <polygon points="${P([[486, 488], [540, 456], [712, 686], [640, 686]])}"/>
  ${R(612, 684, 728, 700)}
</g>
</svg>`;
(async () => {
  await sharp(Buffer.from(svg)).flatten({ background: "#050C20" }).removeAlpha().png().toFile(out);
  await sharp(out).resize(180).toFile(out.replace(/\.png$/, "-180.png"));
  await sharp(out).resize(60).toFile(out.replace(/\.png$/, "-60.png"));
  const m = await sharp(out).metadata();
  console.log("icon", m.width, "x", m.height, "channels", m.channels, "alpha", m.hasAlpha);
})();
