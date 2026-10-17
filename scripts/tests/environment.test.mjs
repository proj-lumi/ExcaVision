import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { operationalEnvironment, readEnvironment, root } from "../environment.mjs";

const reference = "a".repeat(20);
const values = { SUPABASE_PROJECT_REF: reference, SUPABASE_API_URL: `https://${reference}.supabase.co`, SUPABASE_SECRET_KEY: "test-only-private-value" };
const read = () => ({ ...values });

test("operator tools require an explicit environment", () => {
  assert.throws(() => operationalEnvironment([], { read }), /Select --environment/);
  assert.throws(() => operationalEnvironment(["--environment", "preview"], { read }), /Select --environment/);
  assert.throws(() => readEnvironment("scripts", "../production"), /Select --environment/);
});

test("dry run selects the environment without deletion confirmation", () => {
  const result = operationalEnvironment(["--environment", "staging", "--dry-run"], { read, destructive: true });
  assert.equal(result.environment, "staging");
  assert.equal(result.projectRef, reference);
});

test("deletion requires the matching environment flag AND exact project reference", () => {
  const base = ["--environment", "staging"];
  for (const args of [base, [...base, "--confirm-production", "--project-ref", reference], [...base, "--confirm-staging", "--project-ref", "b".repeat(20)]]) {
    assert.throws(() => operationalEnvironment(args, { read, destructive: true }), /Deletion requires/);
  }
  assert.doesNotThrow(() => operationalEnvironment([...base, "--confirm-staging", "--project-ref", reference], { read, destructive: true }));
});

test("mismatched URL, missing credential and placeholder credential fail closed", () => {
  for (const overrides of [{ SUPABASE_API_URL: "https://wrong.example.com" }, { SUPABASE_SECRET_KEY: "" }, { SUPABASE_SECRET_KEY: "REPLACE_ME" }]) {
    assert.throws(() => operationalEnvironment(["--environment", "staging", "--dry-run"], { read: () => ({ ...values, ...overrides }), destructive: true }));
  }
});

test("all six scopes have matching production/staging template keys", () => {
  for (const scope of ["apps/admin", "apps/mobile", "apps/landing", "supabase", "scripts", "firmware/node"]) {
    const templates = ["production", "staging"].map((target) => parseEnv(readFileSync(`${root}${scope}/.env.${target}.example`, "utf8")));
    assert.deepEqual(Object.keys(templates[0]).sort(), Object.keys(templates[1]).sort(), scope);
    for (const template of templates) {
      for (const value of Object.values(template)) assert(!/sb_secret_|eyJ[A-Za-z0-9_-]+\./.test(value), `${scope}: actual credential-like value in template`);
    }
  }
});

test("frontend commands explicitly select staging and production", () => {
  for (const app of ["admin", "mobile", "landing"]) {
    const { scripts } = JSON.parse(readFileSync(`${root}apps/${app}/package.json`, "utf8"));
    assert.match(scripts.dev, /staging/);
    assert.match(scripts["build:staging"], /staging/);
    assert.match(scripts["build:production"], /production/);
  }
});

test("fixture identities, contacts and device addresses are synthetic", () => {
  function walk(value) {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (["full_name", "requester_name"].includes(key) && item) assert.match(item, /^Demo Person \d+$/);
      if (["email", "contact_email"].includes(key) && item) assert.match(item, /@example\.invalid$/);
      if (["phone", "contact_phone"].includes(key) && item) assert.match(item, /^0000000\d{4}$/);
      if (key === "mac_address") assert.match(item, /^02:00:00:00:/);
      if (key === "address_label") assert.match(item, /\(synthetic\)$/);
      walk(item);
    }
  }
  for (const app of ["admin", "mobile"]) {
    const text = readFileSync(`${root}apps/${app}/app/data/mock.json`, "utf8");
    assert(!/\b09\d{9}\b/.test(text));
    walk(JSON.parse(text));
  }
});
