export const FULL_APP_VERSION = __APP_VERSION__;

export function getDisplayAppVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return version;
  return `${match[1]}.${match[2]}`;
}

export const DISPLAY_APP_VERSION = getDisplayAppVersion(FULL_APP_VERSION);
export const DISPLAY_APP_VERSION_LABEL = `v${DISPLAY_APP_VERSION}`;
