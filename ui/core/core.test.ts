import { describe, expect, it } from "vitest";
import { addCard, addColumn, between, diffText, Doc, editText, moveCard, readBoard, removeColumn, type Op } from "./index";

/** Small seeded PRNG so every failure is reproducible from its seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]! };
}

function shuffle<T>(xs: T[], r: ReturnType<typeof rng>): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = r.int(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Everything observable about a document, for equality checks. */
function snapshot(doc: Doc, texts: [string, string][]) {
  const registers: Record<string, unknown> = {};
  for (const o of doc.objects().sort()) for (const f of ["title", "pos", "place", "gone", "color", "v"]) registers[`${o}/${f}`] = doc.get(o, f);
  return { registers, texts: texts.map(([o, f]) => doc.text(o, f)), vector: doc.vector() };
}

describe("fractional index", () => {
  it("always produces a key strictly between its neighbours", () => {
    const r = rng(42);
    const keys: string[] = [];
    for (let i = 0; i < 3000; i++) {
      // Favour the ends and one hot spot: the patterns that make keys grow.
      const at = r.next() < 0.3 ? 0 : r.next() < 0.5 ? keys.length : r.next() < 0.5 ? Math.min(keys.length, 3) : r.int(keys.length + 1);
      const k = between(keys[at - 1], keys[at]);
      if (keys[at - 1] !== undefined) expect(k > keys[at - 1]!).toBe(true);
      if (keys[at] !== undefined) expect(k < keys[at]!).toBe(true);
      keys.splice(at, 0, k);
    }
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("handles the edges", () => {
    expect(between()).toBe("V");
    expect(between("", "1") < "1").toBe(true);
    expect(between("z") > "z").toBe(true);
    expect(() => between("b", "a")).toThrow();
    expect(() => between("a", "a")).toThrow();
  });
});

describe("text", () => {
  it("types, deletes and reads back", () => {
    const d = new Doc("a");
    d.insert("o", "t", 0, "helo");
    d.insert("o", "t", 3, "l");
    expect(d.text("o", "t")).toBe("hello");
    d.delete("o", "t", 0, 1);
    d.insert("o", "t", 0, "J");
    expect(d.text("o", "t")).toBe("Jello");
    expect(d.delete("o", "t", 99, 3)).toBeNull();
  });

  it("converges when two replicas type at the same spot, in either delivery order", () => {
    const base = new Doc("z");
    const seed = base.insert("o", "t", 0, "ac")!;
    const make = (id: string) => {
      const d = new Doc(id);
      d.apply(seed);
      return d;
    };
    const a = make("a");
    const b = make("b");
    const opA = a.insert("o", "t", 1, "XX")!;
    const opB = b.insert("o", "t", 1, "yy")!;
    a.apply(opB);
    b.apply(opA);
    expect(a.text("o", "t")).toBe(b.text("o", "t"));
    // Each replica's run stays together: no "XyXy".
    expect(["aXXyyc", "ayyXXc"]).toContain(a.text("o", "t"));
  });

  it("keeps a concurrent insertion next to a character someone else deleted", () => {
    const a = new Doc("a");
    const b = new Doc("b");
    const init = a.insert("o", "t", 0, "abc")!;
    b.apply(init);
    const del = a.delete("o", "t", 1, 1)!; // a removes "b"
    const ins = b.insert("o", "t", 2, "!")!; // b types after "b"
    a.apply(ins);
    b.apply(del);
    expect(a.text("o", "t")).toBe("a!c");
    expect(b.text("o", "t")).toBe("a!c");
  });

  it("treats an emoji as one character", () => {
    const d = new Doc("a");
    d.insert("o", "t", 0, "a👍🏽b");
    expect(d.text("o", "t")).toBe("a👍🏽b");
    d.delete("o", "t", 1, 1); // the thumb, not half of it
    expect(d.text("o", "t")).toBe("a🏽b");
  });
});

describe("anchors and replay", () => {
  it("keeps a cursor on the same character while others edit around it", () => {
    const a = new Doc("a");
    const b = new Doc("b");
    b.apply(a.insert("o", "t", 0, "hello world")!);
    // b's caret sits right after "hello".
    const caret = b.anchor("o", "t", 5);
    expect(b.position("o", "t", caret)).toBe(5);
    a.insert("o", "t", 0, ">> "); // a types before it
    a.delete("o", "t", 9, 5); // and deletes "world" after it
    b.apply(a.opsSince(b.vector()));
    expect(b.text("o", "t")).toBe(">> hello ");
    expect(b.position("o", "t", caret)).toBe(8);
    // The anchored character itself gets deleted: the caret stays where it was.
    a.delete("o", "t", 6, 2);
    b.apply(a.opsSince(b.vector()));
    expect(b.text("o", "t")).toBe(">> hel ");
    expect(b.position("o", "t", caret)).toBe(6);
    expect(b.position("o", "t", null)).toBe(0);
    expect(b.position("o", "t", { t: 999, r: "nobody" })).toBe(7);
  });

  it("rebuilds the document at any point of its history", () => {
    let clock = 1000;
    const a = new Doc("a", () => clock++);
    a.set("card", "title", "v1");
    a.insert("card", "desc", 0, "abc");
    a.set("card", "title", "v2");
    a.delete("card", "desc", 0, 1);
    const h = a.history();
    expect(h.map((o) => o.w)).toEqual([1000, 1001, 1002, 1003]);
    expect(Doc.replay(h.slice(0, 0)).get("card", "title")).toBeUndefined();
    const at2 = Doc.replay(h.slice(0, 2));
    expect([at2.get("card", "title"), at2.text("card", "desc")]).toEqual(["v1", "abc"]);
    const at4 = Doc.replay(h);
    expect([at4.get("card", "title"), at4.text("card", "desc")]).toEqual(["v2", "bc"]);
  });
});

describe("registers", () => {
  it("resolves concurrent writes the same way everywhere", () => {
    const a = new Doc("a");
    const b = new Doc("b");
    const wa = a.set("card", "title", "from a");
    const wb = b.set("card", "title", "from b");
    a.apply(wb);
    b.apply(wa);
    // Same Lamport time: the replica id breaks the tie.
    expect(a.get("card", "title")).toBe("from b");
    expect(b.get("card", "title")).toBe("from b");
    // A later write wins regardless of replica id.
    const later = a.set("card", "title", "a again");
    b.apply(later);
    expect(b.get("card", "title")).toBe("a again");
  });
});

describe("delivery", () => {
  it("buffers ops that arrive before what they depend on, and ignores duplicates", () => {
    const a = new Doc("a");
    const ops: Op[] = [a.insert("o", "t", 0, "one")!, a.insert("o", "t", 3, " two")!, a.delete("o", "t", 0, 4)!, a.set("o", "title", "x")];
    const b = new Doc("b");
    expect(b.apply(ops[3]!)).toEqual([]);
    expect(b.apply(ops[2]!)).toEqual([]);
    expect(b.apply(ops[1]!)).toEqual([]);
    expect(b.buffered).toBe(3);
    expect(b.apply(ops[0]!).length).toBe(4);
    expect(b.buffered).toBe(0);
    expect(b.text("o", "t")).toBe("two");
    expect(b.apply(ops)).toEqual([]);
    expect(b.history().length).toBe(4);
  });

  it("gives a peer exactly what it is missing", () => {
    const a = new Doc("a");
    const b = new Doc("b");
    a.set("o", "v", 1);
    b.apply(a.history());
    a.set("o", "v", 2);
    b.set("o", "v", 3);
    expect(a.opsSince(b.vector()).map((o) => o.s)).toEqual([2]);
    expect(b.opsSince(a.vector()).map((o) => `${o.r}${o.s}`)).toEqual(["b1"]);
  });
});

describe("convergence fuzz", () => {
  it("replicas that saw the same ops are identical, whatever the order", () => {
    const fields: [string, string][] = [
      ["doc", "body"],
      ["doc", "note"],
    ];
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      const replicas = Array.from({ length: 2 + r.int(3) }, (_, i) => new Doc(`r${i}`));
      let marker = 0;

      for (let step = 0; step < 120; step++) {
        const d = r.pick(replicas);
        const roll = r.next();
        if (roll < 0.4) {
          const [o, f] = r.pick(fields);
          const len = Array.from(d.text(o, f)).length;
          // Every character ever typed is unique, so a duplicate in the result means an op was applied twice.
          let text = "";
          for (let n = 1 + r.int(4); n > 0; n--) text += String.fromCodePoint(0x4e00 + marker++);
          d.insert(o, f, r.int(len + 1), text);
        } else if (roll < 0.55) {
          const [o, f] = r.pick(fields);
          const len = Array.from(d.text(o, f)).length;
          if (len > 0) d.delete(o, f, r.int(len), 1 + r.int(4));
        } else if (roll < 0.7) {
          d.set(r.pick(["x", "y"]), r.pick(["title", "v"]), r.int(1000));
        } else {
          // Deliver a random, shuffled, partly duplicated slice of one log to another replica.
          const from = r.pick(replicas);
          const to = r.pick(replicas);
          if (from === to) continue;
          const slice = from.history().filter(() => r.next() < 0.6);
          to.apply(shuffle([...slice, ...slice.slice(0, 3)], r));
        }
      }

      // Heal: everyone gets everything, shuffled.
      const all = replicas.flatMap((d) => [...d.history()]);
      for (const d of replicas) d.apply(shuffle(all, r));

      const first = snapshot(replicas[0]!, fields);
      for (const d of replicas) {
        expect(d.buffered, `seed ${seed}: ops stuck in the buffer`).toBe(0);
        expect(snapshot(d, fields), `seed ${seed}`).toEqual(first);
      }
      const body = Array.from(first.texts.join(""));
      expect(new Set(body).size, `seed ${seed}: a character was duplicated`).toBe(body.length);
    }
  });
});

describe("board", () => {
  const pair = () => {
    const a = new Doc("a");
    const todo = addColumn(a, "A fazer");
    const done = addColumn(a, "Feito");
    const b = new Doc("b");
    b.apply(a.history());
    return { a, b, todo, done };
  };
  const sync = (a: Doc, b: Doc) => {
    b.apply(a.opsSince(b.vector()));
    a.apply(b.opsSince(a.vector()));
  };
  const titles = (d: Doc) => readBoard(d).columns.map((c) => `${c.title}: ${c.cards.map((x) => x.title).join(",")}`);

  it("orders cards and moves them between columns", () => {
    const { a, todo, done } = pair();
    const c1 = addCard(a, todo, "um");
    addCard(a, todo, "dois");
    const c3 = addCard(a, todo, "três");
    moveCard(a, c3, todo, 0);
    moveCard(a, c1, done, 0);
    expect(titles(a)).toEqual(["A fazer: três,dois", "Feito: um"]);
  });

  it("converges when both sides move the same card", () => {
    const { a, b, todo, done } = pair();
    const card = addCard(a, todo, "disputado");
    addCard(a, done, "outro");
    sync(a, b);
    moveCard(a, card, done, 0);
    moveCard(b, card, done, 1);
    sync(a, b);
    expect(titles(a)).toEqual(titles(b));
    // The card is in exactly one place.
    expect(readBoard(a).columns.flatMap((c) => c.cards).filter((c) => c.id === card).length).toBe(1);
  });

  it("keeps a column alive when someone adds a card while another deletes it", () => {
    const { a, b, todo } = pair();
    addCard(a, todo, "antigo");
    sync(a, b);
    removeColumn(a, todo);
    addCard(b, todo, "novo, offline");
    sync(a, b);
    expect(titles(a)).toEqual(titles(b));
    const col = readBoard(a).columns.find((c) => c.id === todo)!;
    expect(col.revived).toBe(true);
    expect(col.cards.map((c) => c.title)).toEqual(["novo, offline"]);
  });

  it("merges concurrent edits to a description", () => {
    const { a, b, todo } = pair();
    const card = addCard(a, todo, "texto");
    editText(a, `card:${card}`, "desc", "comprar pão");
    sync(a, b);
    editText(a, `card:${card}`, "desc", "comprar pão integral");
    editText(b, `card:${card}`, "desc", "URGENTE: comprar pão");
    sync(a, b);
    expect(readBoard(a).columns[0]!.cards[0]!.desc).toBe("URGENTE: comprar pão integral");
    expect(readBoard(b).columns[0]!.cards[0]!.desc).toBe("URGENTE: comprar pão integral");
  });
});

describe("diffText", () => {
  it("finds the smallest edit", () => {
    expect(diffText("hello", "help")).toEqual({ pos: 3, remove: 2, insert: "p" });
    expect(diffText("", "abc")).toEqual({ pos: 0, remove: 0, insert: "abc" });
    expect(diffText("abc", "abc")).toEqual({ pos: 0, remove: 0, insert: "" });
  });

  it("uses the caret to place an insertion among repeated characters", () => {
    // Typing an "a" at the very start of "aa": the caret ends at 1.
    expect(diffText("aa", "aaa", 1)).toEqual({ pos: 0, remove: 0, insert: "a" });
    // Typing it at the very end: the caret ends at 3.
    expect(diffText("aa", "aaa", 3)).toEqual({ pos: 2, remove: 0, insert: "a" });
    // In the middle.
    expect(diffText("aa", "aaa", 2)).toEqual({ pos: 1, remove: 0, insert: "a" });
  });
});
