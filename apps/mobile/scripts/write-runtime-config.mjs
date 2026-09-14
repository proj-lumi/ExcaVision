import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env');
const fileValues = {};
if (existsSync(envPath)) {
  for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const splitAt = line.indexOf('=');
    if (splitAt < 1) continue;
    const key = line.slice(0, splitAt).trim();
    let value = line.slice(splitAt + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    fileValues[key] = value;
  }
}

const config = {
  supabaseUrl: process.env.SUPABASE_URL || fileValues.SUPABASE_URL || '',
  supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || fileValues.SUPABASE_PUBLISHABLE_KEY || '',
};
writeFileSync(resolve(process.cwd(), 'public/config.js'), `window.EXCAVISION_CONFIG = ${JSON.stringify(config)};\n`);
console.log('Wrote public/config.js with public customer-app runtime settings.');
