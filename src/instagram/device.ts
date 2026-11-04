/**
 * Emulated Android app profile.
 *
 * App version, version code and Bloks id must belong together; they are taken
 * from instagrapi's config (MIT, see NOTICE), which tracks the current app.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DeviceProfile } from "./types.js";

export const APP_ID = "567067343352427";

export const APP_PROFILE = {
  appVersion: "449.0.0.52.84",
  versionCode: "1079242191",
  bloksVersionId: "799db3e387d7a21a19c72918b8698b6cd28a1516ade363792c100ed45a0f9f0b",
} as const;

const HARDWARE = {
  androidVersion: 34,
  androidRelease: "14",
  dpi: "480dpi",
  resolution: "1344x2992",
  manufacturer: "Google/google",
  model: "Pixel 8 Pro",
  device: "husky",
  cpu: "husky",
} as const;

/** A new device with fresh identifiers. Persist it with the session and reuse it. */
export function createDeviceProfile(options: { locale?: string; timezoneOffset?: number } = {}): DeviceProfile {
  return {
    ...APP_PROFILE,
    ...HARDWARE,
    locale: options.locale ?? "en_US",
    uuid: randomUUID(),
    phoneId: randomUUID(),
    androidId: `android-${createHash("sha256").update(randomBytes(16)).digest("hex").slice(0, 16)}`,
    adid: randomUUID(),
    // `|| 0` turns UTC's -0 into 0, which survives a JSON round trip unchanged.
    timezoneOffset: options.timezoneOffset ?? (-new Date().getTimezoneOffset() * 60 || 0),
  };
}

/** Keeps a saved device's identifiers but moves it to the current app version. */
export function withCurrentAppProfile(device: DeviceProfile): DeviceProfile {
  return { ...device, ...APP_PROFILE };
}

export function userAgent(device: DeviceProfile): string {
  return (
    `Instagram ${device.appVersion} Android (${device.androidVersion}/${device.androidRelease}; ` +
    `${device.dpi}; ${device.resolution}; ${device.manufacturer}; ${device.model}; ${device.device}; ` +
    `${device.cpu}; ${device.locale}; ${device.versionCode})`
  );
}
