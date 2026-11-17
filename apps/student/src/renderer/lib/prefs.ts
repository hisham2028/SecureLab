/** Small per-computer UI preferences. Storage can be unavailable; never let that break the app. */
export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(`securelab:${key}`);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(`securelab:${key}`, value);
  } catch {
    // Preferences are a convenience only.
  }
}
