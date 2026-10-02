import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

import { version } from "../version.ts";

/**
 * Writes the version identifier shared by the client bundle and Rust server.
 * Reuse the timestamp within a commit: a client-only rebuild must not disagree
 * with the compiled server and trigger a reload banner that never clears.
 */
export function updateVersionFile(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const gitProcess = spawn("git", ["describe", "--tags", "--long"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";

    gitProcess.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    gitProcess.on("close", async (code) => {
      let commitVersion = stdout.trim();

      if (!commitVersion || code !== 0) {
        commitVersion = `${version}-${process.env.GITHUB_SHA || "unknown"}`;
      }

      if (isForCommit(await readVersionFile(), commitVersion)) {
        resolve();
        return;
      }

      const publicVersion = `${commitVersion}-${new Date()
        .toISOString()
        .split(".")[0]
        .replaceAll(":", "-")
        .concat("Z")}`;

      try {
        await writeFile(
          "./version.json",
          `${JSON.stringify({ version: publicVersion })}\n`,
          "utf-8",
        );
        resolve();
      } catch (err) {
        reject(err);
      }
    });

    gitProcess.on("error", reject);
  });
}

/**
 * Whether an existing version string was minted for `commitVersion`, and can
 * therefore be reused instead of getting a fresh timestamp.
 *
 * The trailing separator is load-bearing: without it a `git describe` of
 * `2.9.0-7` would claim an existing `2.9.0-70-g…` string as its own.
 */
export function isForCommit(
  existing: string | undefined,
  commitVersion: string,
): boolean {
  return existing?.startsWith(`${commitVersion}-`) ?? false;
}

/** Current `version.json` value, or undefined when absent/unreadable. */
async function readVersionFile(): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(await readFile("./version.json", "utf-8"));
    return typeof parsed?.version === "string" ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}
