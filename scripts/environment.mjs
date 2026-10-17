import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));

export function option(args, name) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : undefined;
}

export function readEnvironment(directory, environment) {
  if (!["production", "staging"].includes(environment)) {
    throw new Error("Select --environment production or --environment staging explicitly.");
  }
  const file = `${directory}/.env.${environment}`;
  try {
    return parseEnv(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`Missing ${file}. Copy ${file}.example and fill in fresh credentials.`);
    throw error;
  }
}

export function operationalEnvironment(args, { destructive = false, read = readEnvironment } = {}) {
  const environment = option(args, "environment");
  if (!["production", "staging"].includes(environment)) throw new Error("Select --environment production or --environment staging explicitly.");
  const values = read("scripts", environment);
  const projectRef = values.SUPABASE_PROJECT_REF;
  if (!/^[a-z]{20}$/.test(projectRef ?? "")) throw new Error("Set a valid SUPABASE_PROJECT_REF in the selected scripts environment file.");
  if (values.SUPABASE_API_URL !== `https://${projectRef}.supabase.co`) {
    throw new Error("SUPABASE_API_URL must match the selected SUPABASE_PROJECT_REF exactly.");
  }
  if (!values.SUPABASE_SECRET_KEY || /CHANGE_ME|REPLACE_ME/.test(values.SUPABASE_SECRET_KEY)) {
    throw new Error("Set SUPABASE_SECRET_KEY in the selected scripts environment file.");
  }
  if (destructive && !args.includes("--dry-run")) {
    if (!args.includes(`--confirm-${environment}`) || option(args, "project-ref") !== projectRef) {
      throw new Error(`Deletion requires --confirm-${environment} and --project-ref matching the selected file. Use --dry-run first.`);
    }
  }
  return { environment, projectRef, values };
}
