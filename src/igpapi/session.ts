/**
 * Session persistence utilities for IGPAPI
 */

import { promises as fs } from "fs";
import { join } from "path";
import type { IgApiClient } from "instagram-private-api";

const SESSION_DIR = join(process.cwd(), "data");
const SESSION_FILE = join(SESSION_DIR, "session.json");

/**
 * Ensure the session directory exists
 */
async function ensureSessionDir(): Promise<void> {
  try {
    await fs.mkdir(SESSION_DIR, { recursive: true });
  } catch (error) {
    // Directory might already exist, ignore error
  }
}

/**
 * Save IGPAPI session state to file
 */
export async function saveSession(ig: IgApiClient): Promise<void> {
  try {
    await ensureSessionDir();
    const serialized = await ig.state.serialize();
    await fs.writeFile(SESSION_FILE, JSON.stringify(serialized, null, 2), "utf-8");
  } catch (error) {
    throw new Error(`Failed to save session: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Load IGPAPI session state from file
 */
export async function loadSession(ig: IgApiClient): Promise<boolean> {
  try {
    const sessionData = await fs.readFile(SESSION_FILE, "utf-8");
    const session = JSON.parse(sessionData);
    await ig.state.deserialize(session);
    return true;
  } catch (error) {
    // Session file doesn't exist or is invalid
    return false;
  }
}

/**
 * Check if session file exists
 */
export async function sessionExists(): Promise<boolean> {
  try {
    await fs.access(SESSION_FILE);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete saved session file
 */
export async function deleteSession(): Promise<void> {
  try {
    await fs.unlink(SESSION_FILE);
  } catch (error) {
    // File might not exist, ignore error
  }
}

