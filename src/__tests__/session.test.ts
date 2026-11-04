/**
 * Unit tests for session file location, permissions and legacy migration
 */

import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { InstagramClient } from "../instagram/index.js";
import type { SessionState } from "../instagram/index.js";
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
/** A session file written by instagram-private-api (mcp-instagram <= 0.1). */
const SAMPLE_STATE = {
  constants: { APP_VERSION: "222.0.0.13.114" },
  cookies: JSON.stringify({
    version: "tough-cookie@2.5.0",
    cookies: [
      { key: "sessionid", value: "42%3AlegacySession%3A1%3AAYabcdefghijklmnop", domain: "instagram.com" },
      { key: "ds_user_id", value: "42", domain: "instagram.com" },
      { key: "tracker", value: "x", domain: "example.com" },
    ],
  }),
  deviceString: "26/8.0.0; 480dpi; 1080x1920; samsung; SM-G930F; herolte; samsungexynos8890",
  uuid: "11111111-1111-4111-8111-111111111111",
  phoneId: "22222222-2222-4222-8222-222222222222",
  deviceId: "android-0123456789abcdef",
  adid: "33333333-3333-4333-8333-333333333333",
};

/** A session in the current format. */
function sampleSession(username = "alice"): SessionState {
  const client = new InstagramClient({ fetch: (async () => new Response("{}")) as unknown as typeof fetch });
  client.setAuthorization({ ds_user_id: "42", sessionid: "42%3Acurrent%3A1%3AAYzz", should_use_header_over_cookies: true });
  client.setAccount("42", username);
  return client.serialize();
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
      const session = sampleSession();
      expect(await sessionExists()).toBe(false);

      await saveSession(session);
      expect(getSessionFilePath()).toBe(join(root, "sessions", "session.json"));
      expect(await sessionExists()).toBe(true);
      expect(JSON.parse(await fs.readFile(getSessionFilePath(), "utf-8"))).toEqual(session);
      expect(await loadSession()).toEqual(session);

      await deleteSession();
      expect(await sessionExists()).toBe(false);
      await expect(deleteSession()).resolves.toBeUndefined();
    });

    (isWindows ? it.skip : it)("writes the file 0600 and creates the directory 0700", async () => {
      await saveSession(sampleSession());
      expect(await mode(getSessionFilePath())).toBe(0o600);
      expect(await mode(join(root, "sessions"))).toBe(0o700);
    });

    (isWindows ? it.skip : it)("tightens a world-readable session file on load", async () => {
      await fs.mkdir(join(root, "sessions"), { recursive: true });
      await fs.writeFile(getSessionFilePath(), JSON.stringify(SAMPLE_STATE), { mode: 0o644 });
      await fs.chmod(getSessionFilePath(), 0o644);
      expect(await loadSession()).not.toBeNull();
      expect(await mode(getSessionFilePath())).toBe(0o600);
    });

    it("leaves no temp files behind after saving", async () => {
      await saveSession(sampleSession());
      await saveSession(sampleSession());
      expect(await fs.readdir(join(root, "sessions"))).toEqual(["session.json"]);
    });

    it("returns null for a missing or corrupt session file", async () => {
      expect(await loadSession()).toBeNull();
      await fs.mkdir(join(root, "sessions"), { recursive: true });
      await fs.writeFile(getSessionFilePath(), "{not json");
      expect(await loadSession()).toBeNull();
    });

    (isWindows ? it.skip : it)("refuses an IG_SESSION_DIR that other users can write to", async () => {
      const shared = join(root, "shared");
      await fs.mkdir(shared);
      await fs.chmod(shared, 0o777);
      process.env.IG_SESSION_DIR = shared;
      await fs.writeFile(join(shared, "session.json"), JSON.stringify(SAMPLE_STATE));

      const original = console.error;
      console.error = () => undefined;
      try {
        expect(await loadSession()).toBeNull();
      } finally {
        console.error = original;
      }
      await expect(saveSession(sampleSession())).rejects.toThrow(/writable by other users/);
    });

    it("does not migrate legacy files into an explicit IG_SESSION_DIR", async () => {
      const workdir = join(root, "work");
      await fs.mkdir(join(workdir, "data"), { recursive: true });
      await fs.writeFile(join(workdir, "data", "session.json"), JSON.stringify(SAMPLE_STATE));
      process.chdir(workdir);

      await migrateLegacySession([join(workdir, "data", "session.json")]);
      expect(await loadSession()).toBeNull();
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

      const restored = await loadSession();
      expect(restored?.version).toBe(2);
      expect(restored?.authorization).toEqual({
        ds_user_id: "42",
        sessionid: "42%3AlegacySession%3A1%3AAYabcdefghijklmnop",
        should_use_header_over_cookies: true,
      });
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

    it("never migrates a session file from the working directory", async () => {
      const planted = join(workdir, "data", "session.json");
      await fs.writeFile(planted, JSON.stringify(SAMPLE_STATE));

      await migrateLegacySession();
      await expect(fs.access(planted)).resolves.toBeUndefined();
      expect(await sessionExists()).toBe(false);
    });

    (isWindows ? it.skip : it)("skips a legacy path that is a symlink", async () => {
      const real = join(root, "elsewhere.json");
      await fs.writeFile(real, JSON.stringify(SAMPLE_STATE));
      const link = join(workdir, "data", "session.json");
      await fs.symlink(real, link);

      await migrateLegacySession([link]);
      expect(await sessionExists()).toBe(false);
      await expect(fs.access(real)).resolves.toBeUndefined();
    });

    it("prefers an existing session over a legacy one", async () => {
      const current = sampleSession("current");
      await saveSession(current);
      const legacy = join(workdir, "data", "session.json");
      await fs.writeFile(legacy, JSON.stringify({ ...SAMPLE_STATE, deviceString: "legacy" }));

      await migrateLegacySession([legacy]);
      expect(await loadSession()).toEqual(current);
      await expect(fs.access(legacy)).resolves.toBeUndefined();
    });
  });
});

describe("session file conversion", () => {
  it("carries cookies and device identifiers over from instagram-private-api files", async () => {
    const { sessionStateFromJson } = await import("../instagram/sessionFormat.js");
    const state = sessionStateFromJson(SAMPLE_STATE);
    expect(state?.cookies).toEqual({ sessionid: "42%3AlegacySession%3A1%3AAYabcdefghijklmnop", ds_user_id: "42" });
    expect(state?.userId).toBe("42");
    expect(state?.device.uuid).toBe(SAMPLE_STATE.uuid);
    expect(state?.device.phoneId).toBe(SAMPLE_STATE.phoneId);
    expect(state?.device.androidId).toBe(SAMPLE_STATE.deviceId);
    expect(state?.device.adid).toBe(SAMPLE_STATE.adid);
    expect(state?.device.appVersion).not.toBe("222.0.0.13.114");
  });

  it("prefers the saved ig-set-authorization token over cookies", async () => {
    const { sessionStateFromJson } = await import("../instagram/sessionFormat.js");
    const { formatAuthorizationHeader } = await import("../instagram/client.js");
    const auth = { ds_user_id: "7", sessionid: "7%3Atoken%3A1%3AAYxx" };
    const state = sessionStateFromJson({ ...SAMPLE_STATE, authorization: formatAuthorizationHeader(auth) });
    expect(state?.authorization).toEqual(auth);
  });

  it("rejects files without a session or in an unknown shape", async () => {
    const { sessionStateFromJson } = await import("../instagram/sessionFormat.js");
    expect(sessionStateFromJson({ ...SAMPLE_STATE, cookies: JSON.stringify({ cookies: [] }) })).toBeNull();
    expect(sessionStateFromJson({ version: 2, device: { uuid: "x" }, cookies: {} })).toBeNull();
    expect(sessionStateFromJson({ token: "other app" })).toBeNull();
    expect(sessionStateFromJson("nope")).toBeNull();
  });
});
