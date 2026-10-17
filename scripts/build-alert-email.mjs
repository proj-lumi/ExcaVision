// Embed the email template for Edge Functions, which cannot read repo files at runtime.
// Usage: node scripts/build-alert-email.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(root, "supabase/templates/alert.html");
const targetPath = resolve(root, "supabase/functions/_shared/alertEmailHtml.ts");

const html = readFileSync(sourcePath, "utf8");
// A JS template literal needs backslashes, backticks and ${ delimiters escaped.
const literal = html
  .replace(/\\/g, "\\\\")
  .replace(/`/g, "\\`")
  .replace(/\$\{/g, "\\${");

const output = `// GENERATED FILE — do not edit by hand.
// Source: supabase/templates/alert.html
// Rebuild: node scripts/build-alert-email.mjs

export const ALERT_EMAIL_HTML = \`${literal}\`;
`;

writeFileSync(targetPath, output);
console.log(`Wrote ${targetPath} (${output.length} bytes) from ${sourcePath}`);
