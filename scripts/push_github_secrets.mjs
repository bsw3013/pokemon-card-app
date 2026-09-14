// One-time helper: reads .env.local and pushes each VITE_* value as a
// GitHub Actions repository secret, so the GitHub Actions build has the
// same Firebase/Gemini/GitHub config that .env.local provides locally.
//
// Usage (PowerShell, from the project root):
//   npm install tweetnacl tweetnacl-sealedbox-js --no-save
//   $env:GITHUB_TOKEN="<your PAT with repo scope>"
//   node scripts/push_github_secrets.mjs
//
// Nothing is printed to the console except secret NAMES, never values.

import fs from "node:fs";
import sealedbox from "tweetnacl-sealedbox-js";

const OWNER = "bsw3013";
const REPO = "pokemon-card-app";
const ENV_FILE = ".env.local";
const KEYS = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
  "VITE_GEMINI_API_KEY",
  "VITE_GITHUB_TOKEN",
  "VITE_GITHUB_OWNER",
  "VITE_GITHUB_REPO",
  "VITE_GITHUB_BACKUP_PATH",
];

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("GITHUB_TOKEN env var not set. See the usage comment at the top of this script.");
  process.exit(1);
}

function parseEnvFile(path) {
  const text = fs.readFileSync(path, "utf8");
  const out = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

async function gh(path, opts = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "push-github-secrets-script",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${opts.method || "GET"} ${path} -> ${res.status}: ${body}`);
  }
  return res.status === 204 ? null : res.json();
}

function base64ToUint8Array(b64) {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

async function main() {
  const env = parseEnvFile(ENV_FILE);
  const { key: publicKeyB64, key_id } = await gh(`/repos/${OWNER}/${REPO}/actions/secrets/public-key`);
  const publicKey = base64ToUint8Array(publicKeyB64);

  for (const name of KEYS) {
    const value = env[name];
    if (value === undefined || value === "") {
      console.log(`skip ${name} (not set in ${ENV_FILE})`);
      continue;
    }
    const messageBytes = new TextEncoder().encode(value);
    const encryptedBytes = sealedbox.seal(messageBytes, publicKey);
    const encrypted_value = Buffer.from(encryptedBytes).toString("base64");

    await gh(`/repos/${OWNER}/${REPO}/actions/secrets/${name}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encrypted_value, key_id }),
    });
    console.log(`set ${name}`);
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
