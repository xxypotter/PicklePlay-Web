/**
 * Generates the PWA icons: `node scripts/make-icons.mjs`.
 *
 * Uses sharp, which Next.js already depends on, so this adds nothing to the
 * dependency tree. Committed output means the build needs no image step.
 *
 * The maskable variant keeps the ball well inside the safe zone, because
 * Android crops maskable icons to whatever shape the launcher uses.
 */
import { writeFile } from "node:fs/promises";
import sharp from "sharp";

const GREEN = "#15803d";

/** A pickleball: white circle, holes punched out, on the brand green. */
function svg({ size, padding }) {
  const c = size / 2;
  const r = (size / 2) * (1 - padding);
  const holeR = r * 0.13;

  // Three rings of holes, offset so they don't line up in obvious columns.
  const holes = [];
  for (const [ring, count, offset] of [
    [0.0, 1, 0],
    [0.45, 6, 0],
    [0.78, 8, 22.5],
  ]) {
    for (let i = 0; i < count; i++) {
      const angle = ((i * 360) / count + offset) * (Math.PI / 180);
      holes.push(
        `<circle cx="${(c + Math.cos(angle) * r * ring).toFixed(1)}" cy="${(
          c +
          Math.sin(angle) * r * ring
        ).toFixed(1)}" r="${holeR.toFixed(1)}" fill="${GREEN}"/>`,
      );
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="${GREEN}"/>
    <circle cx="${c}" cy="${c}" r="${r.toFixed(1)}" fill="#ffffff"/>
    ${holes.join("")}
  </svg>`;
}

const targets = [
  { file: "public/icon-192.png", size: 192, padding: 0.16 },
  { file: "public/icon-512.png", size: 512, padding: 0.16 },
  // ~20% inset keeps the ball clear of any launcher crop.
  { file: "public/icon-maskable-512.png", size: 512, padding: 0.3 },
  { file: "src/app/apple-icon.png", size: 180, padding: 0.16 },
];

for (const { file, size, padding } of targets) {
  const png = await sharp(Buffer.from(svg({ size, padding })))
    .png()
    .toBuffer();
  await writeFile(file, png);
  console.log(`wrote ${file} (${size}x${size})`);
}
