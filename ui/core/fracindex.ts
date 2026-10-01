/**
 * Fractional indexing: order keys that always leave room in between.
 *
 * Items are sorted by a string key. To put something between two items you
 * generate a key between theirs, so a move touches one item and concurrent
 * moves of different items never conflict. Keys are base-62 "fractions"
 * compared as plain strings.
 */

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;

/**
 * Returns a key strictly between `a` and `b`. An empty `a` means "before
 * everything" and an empty `b` means "after everything". Requires a < b
 * when both are given.
 */
export function between(a = "", b = ""): string {
  if (a && b && a >= b) throw new RangeError(`fracindex: ${a} is not below ${b}`);
  let out = "";
  let open = b === ""; // no upper bound left to respect
  for (let i = 0; ; i++) {
    const lo = i < a.length ? digit(a[i]!) : 0;
    const hi = open ? BASE : i < b.length ? digit(b[i]!) : BASE;
    if (hi - lo > 1) return out + DIGITS[(lo + hi) >> 1];
    // No room at this digit: copy the lower one and look further right.
    out += DIGITS[lo];
    if (hi - lo === 1) open = true; // now anything above the rest of `a` is below `b`
  }
}

function digit(c: string): number {
  const d = DIGITS.indexOf(c);
  if (d < 0) throw new RangeError(`fracindex: invalid character ${JSON.stringify(c)}`);
  return d;
}
