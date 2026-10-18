// Makes the app icon and splash picture: three household seals (terracotta, olive, slate)
// overlapping on linen. Needs sharp (not a dependency of the app; run with NODE_PATH pointing
// at any node_modules that has it, for example the Q&I iOS repo's).
//   NODE_PATH="C:\dev\nm\BeSmart APPs - BeSmart APPs\besmart-qi-ios\node_modules" node scripts/make-assets.js
const sharp = require('sharp');
const path = require('path');

function seals(size, bg) {
  const s = size;
  const u = s / 1024;
  const box = 360 * u;
  const r = 84 * u;
  const seal = (x, y, fill, stroke) =>
    `<rect x="${x * u}" y="${y * u}" width="${box}" height="${box}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${22 * u}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
    ${bg ? `<rect width="${s}" height="${s}" fill="${bg}"/>` : ''}
    ${seal(212, 212, '#5B5F97', bg || '#F5F0E7')}
    ${seal(332, 332, '#3F6B5C', bg || '#F5F0E7')}
    ${seal(452, 452, '#B4532A', bg || '#F5F0E7')}
  </svg>`;
}

(async () => {
  const out = (f) => path.join(__dirname, '..', 'assets', f);
  await sharp(Buffer.from(seals(1024, '#F5F0E7'))).png().toFile(out('icon.png'));
  await sharp(Buffer.from(seals(1024, null))).png().toFile(out('splash-icon.png'));
  console.log('assets/icon.png and assets/splash-icon.png written');
})();
