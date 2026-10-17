// Embed Inter 400 for offline portal use; heavier weights are synthesized.
// Source: @fontsource/inter (SIL Open Font License 1.1).
// Usage: node scripts/build-portal-fonts.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fontDir = resolve(root, "apps/landing/node_modules/@fontsource/inter/files");
const target = resolve(root, "firmware/node/include/PortalFonts.h");

const faces = [
  { symbol: "PORTAL_FONT_INTER_400", weight: 400, file: "inter-latin-400-normal.woff2" },
];

const chunks = ["// GENERATED FILE — do not edit by hand.", "// Source: @fontsource/inter latin woff2 (SIL Open Font License 1.1)", "// Rebuild: node scripts/build-portal-fonts.mjs", "", "#ifndef PORTAL_FONTS_H", "#define PORTAL_FONTS_H", "", "#include <Arduino.h>", ""];

for (const face of faces) {
  const path = resolve(fontDir, face.file);
  if (!existsSync(path)) throw new Error(`Missing font file: ${path}`);
  const base64 = readFileSync(path).toString("base64");
  chunks.push(`// Inter ${face.weight} (latin subset), ${base64.length} base64 chars`);
  chunks.push(`static const char ${face.symbol}[] PROGMEM =`);
  for (let offset = 0; offset < base64.length; offset += 96) {
    chunks.push(`  "${base64.slice(offset, offset + 96)}"`);
  }
  chunks.push("  ;");
  chunks.push("");
}

chunks.push("#endif");
writeFileSync(target, `${chunks.join("\n")}\n`);
console.log(`Wrote ${target}`);
