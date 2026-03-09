import { $ } from "bun";
import { userInfo } from "os";
import type { StatusLineInput } from "./render";

export interface UsageCache {
  error?: string;
  five_hour?: { utilization?: number; resets_at?: string };
  seven_day?: { utilization?: number; resets_at?: string };
}

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const KEYCHAIN_ACCOUNT = process.env.USER || userInfo().username;
const KEYCHAIN_SERVICE = "Claude Code-credentials";

interface KeychainCreds {
  claudeAiOauth?: { accessToken?: string };
}

async function readKeychain() {
  const creds =
    await $`security find-generic-password -a ${KEYCHAIN_ACCOUNT} -s ${KEYCHAIN_SERVICE} -w`
      .quiet()
      .nothrow();
  const text = creds.text().trim();
  if (!text) return null;
  return JSON.parse(text) as KeychainCreds;
}

async function callUsageApi(
  token: string,
  version: string,
): Promise<UsageCache> {
  const resp = await fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
      "Content-Type": "application/json",
      "User-Agent": `claude-code/${version}`,
    },
    signal: AbortSignal.timeout(3000),
  });
  if (!resp.ok) return { error: `API ${resp.status}` };
  const data = (await resp.json()) as UsageCache;
  if (!data.five_hour) return { error: "bad response" };
  return data;
}

export async function fetchUsage(input: StatusLineInput): Promise<UsageCache> {
  const { version } = input;
  try {
    const kc = await readKeychain();
    if (!kc) return { error: "no credentials" };
    const token = kc.claudeAiOauth?.accessToken;
    if (!token) return { error: "no token" };
    return await callUsageApi(token, version);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return { error: msg };
  }
}

// Self-test when run directly: bun run fetch-usage-api.ts
if (import.meta.main) {
  const usage = await fetchUsage({ version: "2.1.70" } as StatusLineInput);
  console.log(JSON.stringify(usage, null, 2));
}
