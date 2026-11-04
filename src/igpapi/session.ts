/**
 * Session persistence for the Instagram client.
 *
 * The session file holds Instagram auth cookies, so it is a bearer credential.
 * It is stored in a per-user config directory rather than the working
 * directory (which under `npx` is the npm cache), written atomically, and made
 * readable only by the owner (directory 0700, file 0600).
 *
 * Location, in order of precedence:
 *   1. $IG_SESSION_DIR
 *   2. %APPDATA%\mcp-instagram on Windows
 *   3. $XDG_CONFIG_HOME/mcp-instagram (if absolute), else ~/.config/mcp-instagram
 */

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IgApiClient } from "instagram-private-api";

const APP_DIR_NAME = "mcp-instagram";
const SESSION_FILE_NAME = "session.json";
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** Directory that holds the session file. Resolved on every call so env changes apply. */
export function getSessionDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  if (env.IG_SESSION_DIR) {
    return resolve(env.IG_SESSION_DIR);
  }
  if (platform === "win32") {
    return join(env.APPDATA || join(homedir(), "AppData", "Roaming"), APP_DIR_NAME);
  }
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".config");
  return join(base, APP_DIR_NAME);
}

/** Full path of the session file. */
export function getSessionFilePath(): string {
  return join(getSessionDir(), SESSION_FILE_NAME);
}

/**
 * Where versions <= 0.0.6 wrote the session: `data/session.json` under the
 * working directory, which `bin/insta-mcp.js` set to the package root.
 *
 * Only the package root is checked. The current working directory is the MCP
 * client's project directory, so a repository could otherwise plant a
 * session for an account it controls.
 */
function getLegacySessionPaths(): string[] {
  return [join(fileURLToPath(new URL("../../", import.meta.url)), "data", SESSION_FILE_NAME)];
}

/** Upper bound for a session file; real ones are a few kilobytes. */
const MAX_SESSION_BYTES = 1024 * 1024;

/**
 * Refuse a session directory that other local users could write to (for
 * example IG_SESSION_DIR=/tmp): they could plant a session or swap files.
 */
async function assertPrivateDirectory(dir: string): Promise<void> {
  if (process.platform === "win32") {
    return;
  }
  const stats = await fs.lstat(dir);
  if (!stats.isDirectory()) {
    throw new Error(`${dir} is not a directory`);
  }
  if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
    throw new Error(`${dir} is owned by another user`);
  }
  if (stats.mode & 0o022) {
    throw new Error(`${dir} is writable by other users; use a private directory for IG_SESSION_DIR`);
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureSessionDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: DIR_MODE });
  // mkdir's mode only applies to directories it creates. Tighten the default
  // directory too, since it is ours. A user-chosen IG_SESSION_DIR is left alone.
  if (!process.env.IG_SESSION_DIR && process.platform !== "win32") {
    await fs.chmod(dir, DIR_MODE);
  }
  await assertPrivateDirectory(dir);
}

/** Write `data` to `file` with mode 0600 via a temp file and rename, so readers never see a partial file. */
async function writePrivateFileAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    // "wx" fails if the name exists, so a pre-planted file or symlink is never written through.
    await fs.writeFile(tmp, data, { encoding: "utf-8", mode: FILE_MODE, flag: "wx" });
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true });
    throw error;
  }
}

/** True if `data` looks like a serialized instagram-private-api state, not some other app's file. */
function looksLikeIgSession(data: string): boolean {
  try {
    const parsed: unknown = JSON.parse(data);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      "cookies" in parsed &&
      ("deviceString" in parsed || "constants" in parsed)
    );
  } catch {
    return false;
  }
}

/**
 * Move a session written by an older version into the default location.
 * Skipped when IG_SESSION_DIR is set (an explicit location is never populated
 * from elsewhere) or when a session already exists.
 */
export async function migrateLegacySession(
  candidates: string[] = getLegacySessionPaths()
): Promise<void> {
  if (process.env.IG_SESSION_DIR) {
    return;
  }
  const target = getSessionFilePath();
  if (await fileExists(target)) {
    return;
  }
  for (const legacy of candidates) {
    if (legacy === target) {
      continue;
    }
    try {
      // Regular files only: no symlinks, FIFOs or devices.
      const stats = await fs.lstat(legacy).catch(() => null);
      if (!stats || !stats.isFile() || stats.size > MAX_SESSION_BYTES) {
        continue;
      }
      const data = await fs.readFile(legacy, "utf-8");
      if (!looksLikeIgSession(data)) {
        continue;
      }
      await ensureSessionDir(dirname(target));
      await writePrivateFileAtomic(target, data);
      await fs.rm(legacy, { force: true });
      console.error(`[mcp-instagram] Moved session file from ${legacy} to ${target}`);
    } catch (error) {
      console.error(
        `[mcp-instagram] Could not move legacy session file ${legacy}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    return;
  }
}

/**
 * Save IGPAPI session state to file
 */
export async function saveSession(ig: IgApiClient): Promise<void> {
  const file = getSessionFilePath();
  try {
    await ensureSessionDir(dirname(file));
    const serialized = await ig.state.serialize();
    await writePrivateFileAtomic(file, JSON.stringify(serialized));
  } catch (error) {
    throw new Error(`Failed to save session: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Load IGPAPI session state from file.
 * Returns false if there is no session or it cannot be parsed.
 */
export async function loadSession(ig: IgApiClient): Promise<boolean> {
  await migrateLegacySession();
  const file = getSessionFilePath();
  try {
    await assertPrivateDirectory(dirname(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(
        `[mcp-instagram] Not loading the saved session: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return false;
  }
  let raw: string;
  try {
    const stats = await fs.lstat(file);
    if (!stats.isFile() || stats.size > MAX_SESSION_BYTES) {
      return false;
    }
    raw = await fs.readFile(file, "utf-8");
  } catch {
    return false;
  }
  // Files written by older versions may be world-readable.
  if (process.platform !== "win32") {
    await fs.chmod(file, FILE_MODE).catch(() => undefined);
  }
  try {
    await ig.state.deserialize(JSON.parse(raw));
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if session file exists
 */
export async function sessionExists(): Promise<boolean> {
  return fileExists(getSessionFilePath());
}

/**
 * Delete saved session file
 */
export async function deleteSession(): Promise<void> {
  await fs.rm(getSessionFilePath(), { force: true });
}
