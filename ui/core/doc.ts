import { Rga } from "./rga";
import { chars, compareIds, span, type Id, type InsOp, type Json, type Op, type RemOp, type SetOp, type Vector } from "./types";

type Register = { v: Json; t: number; r: string };

/** What happened when an op was offered to a document. */
export type Applied = "applied" | "duplicate" | "buffered";

/**
 * A replicated document: objects with last-writer-wins fields and text
 * fields backed by a sequence CRDT.
 *
 * Local changes return the op to persist and send. Remote ops can arrive in
 * any order, more than once: an op waits in a buffer until the ops it
 * depends on are in, and replicas that have seen the same ops are equal.
 */
export class Doc {
  readonly replica: string;
  private clock = 0;
  private seq: Vector = {};
  private registers = new Map<string, Map<string, Register>>();
  private texts = new Map<string, Rga>();
  private log: Op[] = [];
  private waiting: Op[] = [];
  private listeners = new Set<() => void>();
  private localListeners = new Set<(op: Op) => void>();
  private rev = 0;

  /** @param now  Wall clock used to date local ops (shown in the history, never used for ordering). */
  constructor(
    replica: string,
    private now: () => number = Date.now,
  ) {
    if (!replica) throw new Error("doc: replica id is required");
    this.replica = replica;
  }

  /** A read-only reconstruction of a document from a prefix of someone's history. */
  static replay(ops: readonly Op[]): Doc {
    const doc = new Doc("@replay");
    doc.apply(ops);
    return doc;
  }

  // ---- reading -----------------------------------------------------------

  /** Value of a register, or undefined if it was never set. */
  get(object: string, field: string): Json | undefined {
    return this.registers.get(object)?.get(field)?.v;
  }

  /** Ids of every object that has at least one register. */
  objects(): string[] {
    return [...this.registers.keys()];
  }

  /** Current content of a text field ("" if it has none). */
  text(object: string, field: string): string {
    return this.texts.get(textKey(object, field))?.toString() ?? "";
  }

  /**
   * A stable reference to the caret position `pos` in a text: the id of the
   * character before it. Unlike an index, it still points at the same place
   * after other replicas insert or delete text around it.
   */
  anchor(object: string, field: string, pos: number): Id | null {
    const rga = this.texts.get(textKey(object, field));
    return rga ? rga.idBefore(Math.max(0, Math.min(pos, rga.length))) : null;
  }

  /** Where an anchor is now, as a caret position in characters. */
  position(object: string, field: string, anchor: Id | null): number {
    return this.texts.get(textKey(object, field))?.positionAfter(anchor) ?? 0;
  }

  /** Highest contiguous sequence number applied from each replica. */
  vector(): Vector {
    return { ...this.seq };
  }

  /** Changes on every applied op; cheap way to know something moved. */
  get revision(): number {
    return this.rev;
  }

  /** Ops applied here that a peer with `theirs` hasn't seen, in an order it can apply. */
  opsSince(theirs: Vector): Op[] {
    return this.log.filter((op) => op.s > (theirs[op.r] ?? 0));
  }

  /** Every applied op, in application order. */
  history(): readonly Op[] {
    return this.log;
  }

  /** Ops received but still waiting for a dependency. */
  get buffered(): number {
    return this.waiting.length;
  }

  stats() {
    let elements = 0;
    let tombstones = 0;
    for (const t of this.texts.values()) {
      elements += t.size;
      tombstones += t.size - t.length;
    }
    return { ops: this.log.length, objects: this.registers.size, elements, tombstones, clock: this.clock, buffered: this.waiting.length };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Called with every op created here, so it can be persisted and sent. */
  onLocal(listener: (op: Op) => void): () => void {
    this.localListeners.add(listener);
    return () => this.localListeners.delete(listener);
  }

  // ---- local changes -----------------------------------------------------

  /** Writes a register. */
  set(object: string, field: string, value: Json): SetOp {
    const op: SetOp = { k: "set", ...this.stamp(), o: object, f: field, v: value };
    this.commit(op);
    return op;
  }

  /** Inserts text at a position counted in characters (code points). */
  insert(object: string, field: string, pos: number, text: string): InsOp | null {
    const list = chars(text);
    if (list.length === 0) return null;
    const rga = this.rga(object, field);
    const after = rga.idBefore(Math.min(pos, rga.length));
    const op: InsOp = { k: "ins", ...this.stamp(), o: object, f: field, a: after, x: text };
    this.commit(op);
    return op;
  }

  /** Deletes `len` characters starting at `pos`. */
  delete(object: string, field: string, pos: number, len: number): RemOp | null {
    const rga = this.rga(object, field);
    len = Math.min(len, rga.length - pos);
    if (len <= 0) return null;
    const op: RemOp = { k: "rem", ...this.stamp(), o: object, f: field, d: rga.runs(pos, len) };
    this.commit(op);
    return op;
  }

  // ---- remote ops --------------------------------------------------------

  /**
   * Offers ops from elsewhere. Returns the ones that were newly applied (in
   * application order), including ops released from the buffer.
   */
  apply(ops: Op | readonly Op[]): Op[] {
    const applied: Op[] = [];
    for (const op of Array.isArray(ops) ? ops : [ops as Op]) {
      if (this.offer(op) === "applied") applied.push(op);
    }
    // Something new may have unblocked ops that were waiting.
    for (let progress = applied.length > 0; progress && this.waiting.length > 0; ) {
      progress = false;
      const still: Op[] = [];
      for (const op of this.waiting) {
        const result = this.tryApply(op);
        if (result === "applied") {
          applied.push(op);
          progress = true;
        } else if (result === "buffered") still.push(op);
      }
      this.waiting = still;
    }
    if (applied.length > 0) this.notify();
    return applied;
  }

  private offer(op: Op): Applied {
    const result = this.tryApply(op);
    if (result === "buffered" && !this.waiting.some((w) => w.r === op.r && w.s === op.s)) this.waiting.push(op);
    return result;
  }

  private tryApply(op: Op): Applied {
    const seen = this.seq[op.r] ?? 0;
    if (op.s <= seen) return "duplicate";
    if (op.s > seen + 1) return "buffered"; // an earlier op of this replica is missing
    if (!this.ready(op)) return "buffered";
    this.integrate(op);
    return "applied";
  }

  /** True when everything the op refers to is already here. */
  private ready(op: Op): boolean {
    if (op.k === "ins") return op.a === null || this.rga(op.o, op.f).has(op.a);
    if (op.k === "rem") {
      const rga = this.rga(op.o, op.f);
      // A replica's ops arrive in order, so if the last id of a run is here the rest are too.
      return op.d.every(([t, r, n]) => rga.has({ t: t + n - 1, r }));
    }
    return true;
  }

  // ---- internals ---------------------------------------------------------

  /** Envelope for the next local op. The clock itself advances in integrate(). */
  private stamp() {
    return { r: this.replica, s: (this.seq[this.replica] ?? 0) + 1, t: this.clock + 1, w: this.now() };
  }

  private commit(op: Op): void {
    this.integrate(op);
    for (const l of this.localListeners) l(op);
    this.notify();
  }

  private integrate(op: Op): void {
    switch (op.k) {
      case "set": {
        let fields = this.registers.get(op.o);
        if (!fields) this.registers.set(op.o, (fields = new Map()));
        const cur = fields.get(op.f);
        if (!cur || compareIds(op, cur) > 0) fields.set(op.f, { v: op.v, t: op.t, r: op.r });
        break;
      }
      case "ins":
        this.rga(op.o, op.f).insert(op.a, { t: op.t, r: op.r }, chars(op.x));
        break;
      case "rem": {
        const rga = this.rga(op.o, op.f);
        for (const [t, r, n] of op.d) rga.remove(t, r, n);
        break;
      }
    }
    this.seq[op.r] = op.s;
    this.clock = Math.max(this.clock, op.t + span(op) - 1);
    this.log.push(op);
    this.rev++;
  }

  private rga(object: string, field: string): Rga {
    const k = textKey(object, field);
    let rga = this.texts.get(k);
    if (!rga) this.texts.set(k, (rga = new Rga()));
    return rga;
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}

const textKey = (object: string, field: string) => `${object}\u0000${field}`;

/** Id of the element an op created, for callers that need to refer to it. */
export function idOf(op: Op): Id {
  return { t: op.t, r: op.r };
}
