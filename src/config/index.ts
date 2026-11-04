/**
 * Configuration management
 */

export interface Config {
  igpapi?: {
    username?: string;
    password?: string;
    /** `sessionid` cookie from a browser login (IG_SESSION_ID). */
    sessionId?: string;
  };
}

let config: Config = {};

export function getConfig(): Config {
  return config;
}

export function setConfig(newConfig: Config): void {
  config = { ...config, ...newConfig };
}

export function loadConfigFromEnv(): Config {
  return {
    igpapi: {
      username: process.env.IG_USERNAME,
      password: process.env.IG_PASSWORD,
      sessionId: process.env.IG_SESSION_ID?.trim() || undefined,
    },
  };
}
