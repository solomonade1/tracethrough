/** Returns the reasons a desktop release tag must not be published; empty when it may be. */
export function checkDesktopRelease(options: { tag: string; repo?: string; mainRef?: string }): string[];
