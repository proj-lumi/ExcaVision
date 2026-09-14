import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rootEnv = resolve(process.cwd(), '../../.env');
const fileValues = {};

if (existsSync(rootEnv)) {
  for (const line of readFileSync(rootEnv, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    const raw = trimmed.slice(separator + 1).trim();
    fileValues[key] = raw.replace(/^['"]|['"]$/g, '');
  }
}

const supabaseUrl = process.env.SUPABASE_URL || fileValues.SUPABASE_URL || '';
const supabasePublishableKey =
  process.env.SUPABASE_PUBLISHABLE_KEY || fileValues.SUPABASE_PUBLISHABLE_KEY || '';

const output = `window.EXCAVISION_CONFIG = ${JSON.stringify({
  supabaseUrl,
  supabasePublishableKey,
})};\n`;

writeFileSync(resolve(process.cwd(), 'public/config.js'), output, 'utf8');
console.log('Wrote public/config.js with public Supabase runtime settings.');
