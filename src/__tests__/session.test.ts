/**
 * Unit tests for session file location, permissions and legacy migration
 */

import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { IgApiClient } from "instagram-private-api";
import {
  deleteSession,
  getSessionDir,
  getSessionFilePath,
  loadSession,
  migrateLegacySession,
  saveSession,
  sessionExists,
} from "../igpapi/session.js";

const isWindows = process.platform === "win32";
const SAMPLE_STATE = { cookies: '{"version":"tough-cookie@4","cookies":[]}', deviceString: "test-device" };

function fakeClient(state: Record<string, unknown> = SAMPLE_STATE) {
  const restored: unknown[] = [];
  const ig = {
    state: {
      serialize: async () => ({ ...state }),
      deserialize: async (value: unknown) => {
        restored.push(value);
      },
    },
  } as unknown as IgApiClient;
  return { ig, restored };
}

async function mode(path: string): Promise<number> {
  return (await fs.stat(path)).mode & 0o777;
}

describe("getSessionDir", () => {
  it("prefers IG_SESSION_DIR", () => {
    expect(getSessionDir({ IG_SESSION_DIR: "/tmp/custom" }, "linux")).toBe("/tmp/custom");
  });

  it("uses an absolute XDG_CONFIG_HOME", () => {
    expect(getSessionDir({ XDG_CONFIG_HOME: "/xdg" }, "linux")).toBe(join("/xdg", "mcp-instagram"));
  });

  it("ignores a relative XDG_CONFIG_HOME, per the XDG spec", () => {
    expect(getSessionDir({ XDG_CONFIG_HOME: "relative/dir" }, "darwin")).toMatch(/\.config[\\/]mcp-instagram$/);
  });

  it("defaults to ~/.config/mcp-instagram", () => {
    expect(getSessionDir({}, "linux")).toMatch(/\.config[\\/]mcp-instagram$/);
  });

  it("uses APPDATA on Windows", () => {
    expect(getSessionDir({ APPDATA: "C:\\Users\\me\\AppData\\Roaming" }, "win32")).toContain("mcp-instagram");
  });
});

describe("session persistence", () => {
  const savedEnv = { IG_SESSION_DIR: process.env.IG_SESSION_DIR, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  const savedCwd = process.cwd();
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), "mcp-instagram-session-"));
  });

  afterEach(async () => {
    process.chdir(savedCwd);
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  });

  describe("with IG_SESSION_DIR", () => {
    beforeEach(() => {
      process.env.IG_SESSION_DIR = join(root, "sessions");
    });

    it("saves, loads and deletes the session", async () => {
      const { ig } = fakeClient();
      expect(await sessionExists()).toBe(false);

      await saveSession(ig);
      expect(getSessionFilePath()).toBe(join(root, "sessions", "session.json"));
      expect(await sessionExists()).toBe(true);
      expect(JSON.parse(await fs.readFile(getSessionFilePath(), "utf-8"))).toEqual(SAMPLE_STATE);

      const { ig: other, restored } = fakeClient();
      expect(await loadSession(other)).toBe(true);
      expect(restored).toEqual([SAMPLE_STATE]);

      await deleteSession();
      expect(await sessionExists()).toBe(false);
      await expect(deleteSession()).resolves.toBeUndefined();
    });

    (isWindows ? it.skip : it)("writes the file 0600 and creates the directory 0700", async () => {
      await saveSession(fakeClient().ig);
      expect(await mode(getSessionFilePath())).toBe(0o600);
      expect(await mode(join(root, "sessions"))).toBe(0o700);
    });

    (isWindows ? it.skip : it)("tightens a world-readable session file on load", async () => {
      await fs.mkdir(join(root, "sessions"), { recursive: true });
      await fs.writeFile(getSessionFilePath(), JSON.stringify(SAMPLE_STATE), { mode: 0o644 });
      await fs.chmod(getSessionFilePath(), 0o644);
      expect(await loadSession(fakeClient().ig)).toBe(true);
      expect(await mode(getSessionFilePath())).toBe(0o600);
    });

    it("leaves no temp files behind after saving", async () => {
      await saveSession(fakeClient().ig);
      await saveSession(fakeClient().ig);
      expect(await fs.readdir(join(root, "sessions"))).toEqual(["session.json"]);
    });

    it("returns false for a missing or corrupt session file", async () => {
      expect(await loadSession(fakeClient().ig)).toBe(false);
      await fs.mkdir(join(root, "sessions"), { recursive: true });
      await fs.writeFile(getSessionFilePath(), "{not json");
      expect(await loadSession(fakeClient().ig)).toBe(false);
    });

    it("does not migrate legacy files into an explicit IG_SESSION_DIR", async () => {
      const workdir = join(root, "work");
      await fs.mkdir(join(workdir, "data"), { recursive: true });
      await fs.writeFile(join(workdir, "data", "session.json"), JSON.stringify(SAMPLE_STATE));
      process.chdir(workdir);

      await migrateLegacySession([join(workdir, "data", "session.json")]);
      expect(await loadSession(fakeClient().ig)).toBe(false);
      await expect(fs.access(join(workdir, "data", "session.json"))).resolves.toBeUndefined();
    });
  });

  describe("default location (XDG_CONFIG_HOME pointed at a temp dir)", () => {
    let workdir: string;

    beforeEach(async () => {
      delete process.env.IG_SESSION_DIR;
      process.env.XDG_CONFIG_HOME = join(root, "config");
      workdir = join(root, "work");
      await fs.mkdir(join(workdir, "data"), { recursive: true });
      process.chdir(workdir);
    });

    it("moves a legacy ./data/session.json into the config directory", async () => {
      const legacy = join(workdir, "data", "session.json");
      await fs.writeFile(legacy, JSON.stringify(SAMPLE_STATE), { mode: 0o644 });
      const original = console.error;
      const logged: string[] = [];
      console.error = (...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      };
      try {
        // Explicit candidates, so the test never touches a real ./data in the repo.
        await migrateLegacySession([legacy]);
      } finally {
        console.error = original;
      }

      const { ig, restored } = fakeClient();
      expect(await loadSession(ig)).toBe(true);

      expect(logged.join("\n")).toContain("Moved session file");
      expect(restored).toEqual([SAMPLE_STATE]);
      expect(getSessionFilePath()).toBe(join(root, "config", "mcp-instagram", "session.json"));
      await expect(fs.access(legacy)).rejects.toThrow();
      if (!isWindows) {
        expect(await mode(getSessionFilePath())).toBe(0o600);
      }
    });

    it("leaves an unrelated ./data/session.json alone", async () => {
      const foreign = join(workdir, "data", "session.json");
      await fs.writeFile(foreign, JSON.stringify({ token: "belongs to another app" }));

      await migrateLegacySession([foreign]);
      await expect(fs.access(foreign)).resolves.toBeUndefined();
      expect(await sessionExists()).toBe(false);
    });

    it("prefers an existing session over a legacy one", async () => {
      await saveSession(fakeClient({ ...SAMPLE_STATE, deviceString: "current" }).ig);
      const legacy = join(workdir, "data", "session.json");
      await fs.writeFile(legacy, JSON.stringify({ ...SAMPLE_STATE, deviceString: "legacy" }));

      await migrateLegacySession([legacy]);
      const { ig, restored } = fakeClient();
      expect(await loadSession(ig)).toBe(true);
      expect(restored).toEqual([{ ...SAMPLE_STATE, deviceString: "current" }]);
      await expect(fs.access(legacy)).resolves.toBeUndefined();
    });
  });
});
