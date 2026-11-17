/** Parses "v1.6.0" or "1.6.0" into numbers; anything else (pre-releases, junk) is null. */
export function parseVersion(value: string | undefined | null): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec((value ?? '').trim());

  if (!match) {
    return null;
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True when `candidate` is a strictly higher X.Y.Z than `installed`. */
export function isNewerVersion(candidate: string, installed: string) {
  const next = parseVersion(candidate);
  const current = parseVersion(installed);

  if (!next || !current) {
    return false;
  }

  for (let index = 0; index < 3; index += 1) {
    const a = next[index] ?? 0;
    const b = current[index] ?? 0;

    if (a !== b) {
      return a > b;
    }
  }

  return false;
}

export function displayVersion(tag: string) {
  return tag.trim().replace(/^v/, '');
}
