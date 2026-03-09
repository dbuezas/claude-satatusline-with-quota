#!/usr/bin/env bun
import { $ } from "bun";
import { readFileSync, unlinkSync } from "fs";
import {
  fetchUsage as fetchUsageApi,
  type UsageCache,
} from "./fetch-usage-api";
import { render, type StatusLineInput } from "./render";

const input = JSON.parse(await Bun.stdin.text()) as StatusLineInput;

// --- Git ---
async function getGitBranch(dir: string) {
  if (!dir) return "";
  const gitCheck = await $`git -C ${dir} rev-parse --git-dir`.quiet().nothrow();
  if (gitCheck.exitCode !== 0) return "";
  const [br, d1, d2] = await Promise.all([
    $`git -C ${dir} branch --show-current`.quiet().nothrow(),
    $`git -C ${dir} diff --quiet`.quiet().nothrow(),
    $`git -C ${dir} diff --cached --quiet`.quiet().nothrow(),
  ]);
  const dirty = d1.exitCode !== 0 || d2.exitCode !== 0 ? "*" : "";
  return `${br.text().trim()}${dirty}`;
}

// --- Quota (cached) ---
const USAGE_CACHE = "/tmp/claude-statusline-usage.json";
const USAGE_LOCK = `${USAGE_CACHE}.lock`;
const USAGE_CACHE_AGE = 5 * 60; // seconds
const LOCK_STALE_MS = 15_000;
const LOCK_POLL_MS = 300;

async function acquireLock() {
  try {
    const fd = Bun.file(USAGE_LOCK);
    if (await fd.exists()) {
      const age = Date.now() - fd.lastModified;
      if (age < LOCK_STALE_MS) return false; // someone else is fetching
    }
    await Bun.write(USAGE_LOCK, String(process.pid));
    return true;
  } catch {
    return false;
  }
}

function releaseLockSync() {
  try {
    const owner = readFileSync(USAGE_LOCK, "utf-8").trim();
    if (owner === String(process.pid)) unlinkSync(USAGE_LOCK);
  } catch {
    /* ignore */
  }
}

process.on("SIGTERM", () => {
  releaseLockSync();
  process.exit(0);
});

async function waitForLock() {
  const deadline = Date.now() + LOCK_STALE_MS;
  while (Date.now() < deadline) {
    const lock = Bun.file(USAGE_LOCK);
    if (!(await lock.exists())) return;
    await Bun.sleep(LOCK_POLL_MS);
  }
}
async function doFetch(): Promise<UsageCache> {
  try {
    let usage = await fetchUsageApi(input);
    if (usage.error) {
      usage = await fetchUsageApi(input);
      if (usage.error) return usage;
    }
    await Bun.write(USAGE_CACHE, JSON.stringify(usage, null, 2));
    return usage;
  } finally {
    releaseLockSync();
  }
}

async function getQuota() {
  let usage: UsageCache = { error: "unknown error" };
  let fetchedAt = new Date();
  try {
    const cacheFile = Bun.file(USAGE_CACHE);
    const cacheAge = (await cacheFile.exists())
      ? (Date.now() - cacheFile.lastModified) / 1000
      : Infinity;
    if (cacheAge <= USAGE_CACHE_AGE) {
      usage = (await cacheFile.json()) as UsageCache;
      fetchedAt = new Date(cacheFile.lastModified);
      // Clean up stale lock files
      const lockFile = Bun.file(USAGE_LOCK);
      if (await lockFile.exists()) {
        const lockAge = Date.now() - lockFile.lastModified;
        if (lockAge >= LOCK_STALE_MS) {
          try {
            unlinkSync(USAGE_LOCK);
          } catch {
            /* ignore */
          }
        }
      }
    } else if (!(await acquireLock())) {
      await waitForLock();
      const freshFile = Bun.file(USAGE_CACHE);
      const freshAge = (await freshFile.exists())
        ? (Date.now() - freshFile.lastModified) / 1000
        : Infinity;
      if (freshAge <= USAGE_CACHE_AGE) {
        usage = (await freshFile.json()) as UsageCache;
        fetchedAt = new Date(freshFile.lastModified);
      } else {
        usage = await doFetch();
      }
    } else {
      usage = await doFetch();
    }
  } catch (e) {
    usage = { error: e instanceof Error ? e.message : "unknown error" };
  }
  return { usage, fetchedAt };
}

const dir = input.workspace?.current_dir ?? "";
const [branch, { usage, fetchedAt }] = await Promise.all([
  getGitBranch(dir),
  getQuota(),
]);

render(input, usage, fetchedAt, branch);
