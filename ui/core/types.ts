/**
 * Wire and storage types. Everything a replica does is an Op; replicas that
 * have applied the same set of ops, in any order, are in the same state.
 */

/** Identifies one element (a character, a register write). Lamport time first, replica breaks ties. */
export type Id = { t: number; r: string };

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

type Envelope = {
  /** Replica that created the op. */
  r: string;
  /** Position in that replica's own log, starting at 1 with no gaps. Used for sync. */
  s: number;
  /** Lamport time. Used for ordering and conflict resolution. */
  t: number;
  /** Object the op is about. */
  o: string;
  /** Field of the object. */
  f: string;
  /** Wall-clock time (ms) when the op was created. For display only: never used to order anything. */
  w?: number;
};

/** Last-writer-wins register write. */
export type SetOp = Envelope & { k: "set"; v: Json };

/** Insert the characters of `x` after element `a` (null = start). They take ids (t, r), (t+1, r), … */
export type InsOp = Envelope & { k: "ins"; a: Id | null; x: string };

/** Delete runs of consecutive elements: [t, r, length]. */
export type RemOp = Envelope & { k: "rem"; d: [number, string, number][] };

export type Op = SetOp | InsOp | RemOp;

/** Highest contiguous sequence number seen from each replica. */
export type Vector = Record<string, number>;

/** Total order on ids: Lamport time, then replica id. */
export function compareIds(a: Id, b: Id): number {
  return a.t !== b.t ? a.t - b.t : a.r < b.r ? -1 : a.r > b.r ? 1 : 0;
}

/** How many Lamport ticks an op consumes. */
export function span(op: Op): number {
  return op.k === "ins" ? Math.max(1, charCount(op.x)) : 1;
}

/**
 * Text is split by code point, not UTF-16 unit, so an emoji is one element
 * and can never be torn in half by a concurrent edit.
 */
export function chars(s: string): string[] {
  return Array.from(s);
}

export function charCount(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}
