/**
 * Runs before every test file (jest `setupFiles`). Session storage resolves to
 * a path under the OS temp directory that nothing creates unless a test writes
 * a session, so no test can touch ~/.config/mcp-instagram or migrate a legacy
 * ./data/session.json (migration is skipped when IG_SESSION_DIR is set).
 */

import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(tmpdir(), `mcp-instagram-test-${randomUUID()}`);
process.env.IG_SESSION_DIR = join(root, "session");
process.env.XDG_CONFIG_HOME = join(root, "config");
