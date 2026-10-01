import { compareIds, type Id } from "./types";

type Node = {
  id: Id;
  ch: string;
  deleted: boolean;
  next: Node | null;
};

const key = (t: number, r: string) => `${t}@${r}`;

/**
 * Replicated Growable Array: a sequence CRDT for text.
 *
 * Every character has a unique id and remembers which character it was
 * typed after. Concurrent insertions at the same spot are ordered by id,
 * newest first, so every replica ends up with the same sequence regardless
 * of delivery order. Deleted characters stay as tombstones so that later
 * insertions that refer to them still find their place.
 */
export class Rga {
  private head: Node = { id: { t: 0, r: "" }, ch: "", deleted: true, next: null };
  private index = new Map<string, Node>();
  private cache: string | null = "";
  private visible = 0;

  has(id: Id): boolean {
    return this.index.has(key(id.t, id.r));
  }

  /** Number of visible characters. */
  get length(): number {
    return this.visible;
  }

  /** Total elements including tombstones. */
  get size(): number {
    return this.index.size;
  }

  /**
   * Integrates a run of characters typed together after `after`.
   * The first character is placed by the RGA rule: skip every element to the
   * right whose id is greater (a concurrent insertion at the same spot that
   * wins, or something typed after it). The rest follow consecutively,
   * because nothing can have been inserted between them yet.
   */
  insert(after: Id | null, first: Id, text: string[]): void {
    if (this.has(first)) return; // already integrated
    let cur = after ? this.index.get(key(after.t, after.r)) : this.head;
    if (!cur) throw new Error(`rga: origin ${after!.t}@${after!.r} is missing`);
    while (cur.next && compareIds(cur.next.id, first) > 0) cur = cur.next;
    for (let i = 0; i < text.length; i++) {
      const node: Node = { id: { t: first.t + i, r: first.r }, ch: text[i]!, deleted: false, next: cur.next };
      cur.next = node;
      this.index.set(key(node.id.t, node.id.r), node);
      cur = node;
    }
    this.visible += text.length;
    this.cache = null;
  }

  /** Tombstones `n` consecutive ids starting at (t, r). Idempotent. */
  remove(t: number, r: string, n: number): void {
    for (let i = 0; i < n; i++) {
      const node = this.index.get(key(t + i, r));
      if (node && !node.deleted) {
        node.deleted = true;
        this.visible--;
        this.cache = null;
      }
    }
  }

  toString(): string {
    if (this.cache === null) {
      let out = "";
      for (let n = this.head.next; n; n = n.next) if (!n.deleted) out += n.ch;
      this.cache = out;
    }
    return this.cache;
  }

  /** Id of the visible character at `pos - 1`, i.e. what an insertion at `pos` goes after. */
  idBefore(pos: number): Id | null {
    if (pos <= 0) return null;
    let seen = 0;
    for (let n = this.head.next; n; n = n.next) {
      if (!n.deleted && ++seen === pos) return n.id;
    }
    throw new RangeError(`rga: position ${pos} is past the end (${this.visible})`);
  }

  /**
   * Caret position right after element `id`: the number of visible
   * characters up to and including it. A deleted element resolves to where
   * it used to be, which is what makes an id a stable anchor for a cursor.
   */
  positionAfter(id: Id | null): number {
    if (!id) return 0;
    let seen = 0;
    for (let n = this.head.next; n; n = n.next) {
      if (!n.deleted) seen++;
      if (n.id.t === id.t && n.id.r === id.r) return seen;
    }
    return this.visible; // not here yet: its insertion is still on the way
  }

  /** Ids of `len` visible characters starting at `pos`, compressed into runs. */
  runs(pos: number, len: number): [number, string, number][] {
    const out: [number, string, number][] = [];
    let seen = 0;
    for (let n = this.head.next; n && len > 0; n = n.next) {
      if (n.deleted) continue;
      if (seen++ < pos) continue;
      const last = out[out.length - 1];
      if (last && last[1] === n.id.r && last[0] + last[2] === n.id.t) last[2]++;
      else out.push([n.id.t, n.id.r, 1]);
      len--;
    }
    if (len > 0) throw new RangeError("rga: deletion runs past the end");
    return out;
  }
}
