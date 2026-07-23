// One-off generator for the default social-share card, used only when a
// page has no real, license-cleared cemetery photo to show. Text-only,
// on-brand with the site's own parchment palette (Base-Claude.astro CSS
// vars) — never a photo, never implies a real cemetery image exists.
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const svg = `
<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#faf7f1" />
  <rect x="40" y="40" width="1120" height="550" fill="none" stroke="#e2d9c8" stroke-width="2" />
  <text x="600" y="290" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="72" font-weight="600" fill="#27221a">Resting Places</text>
  <text x="600" y="350" text-anchor="middle" font-family="system-ui, sans-serif" font-size="28" fill="#6d6355">A reference directory of the world's cemeteries</text>
  <text x="600" y="400" text-anchor="middle" font-family="system-ui, sans-serif" font-size="22" fill="#47604c">restingplaces.site</text>
</svg>`;

const outPath = path.join(process.cwd(), 'public', 'og-default-Claude.png');
await sharp(Buffer.from(svg)).png().toFile(outPath);
console.log(`[og] wrote ${outPath}`);
