import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addCard, addColumn, editText, readBoard, type Op, type Vector } from "../../core";
import { IndexedDbStore, MemoryStore } from "./persist";
import { Session } from "./session";

/** A stand-in for the Go server that follows the same protocol, in memory. */
class FakeServer {
  log: Op[] = [];
  vector: Vector = {};
  sockets = new Set<FakeSocket>();
  nextId = 1;
  /** Drop the n next acks, to exercise retries. */
  dropAcks = 0;

  handle(sock: FakeSocket, msg: { type: string; vector?: Vector; ops?: Op[]; state?: unknown }) {
    if (msg.type === "hello") {
      sock.id = this.nextId++;
      sock.deliver({ type: "welcome", have: { ...this.vector }, you: sock.id });
      const missing = this.log.filter((op) => op.s > (msg.vector?.[op.r] ?? 0));
      if (missing.length) sock.deliver({ type: "ops", ops: missing });
      sock.deliver({ type: "synced" });
    } else if (msg.type === "ops") {
      const fresh: Op[] = [];
      let gap = false;
      for (const op of msg.ops ?? []) {
        const have = this.vector[op.r] ?? 0;
        if (op.s <= have) continue;
        if (op.s !== have + 1) {
          gap = true;
          break;
        }
        this.vector[op.r] = op.s;
        this.log.push(op);
        fresh.push(op);
      }
      if (fresh.length) for (const other of this.sockets) if (other !== sock) other.deliver({ type: "ops", ops: fresh });
      if (this.dropAcks > 0) this.dropAcks--;
      else sock.deliver({ type: gap ? "have" : "ack", have: { ...this.vector } });
    }
  }
}

let server: FakeServer;

class FakeSocket {
  static OPEN = 1;
  readyState = 0;
  id = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(_url: string) {
    setTimeout(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      server.sockets.add(this);
      this.onopen?.();
    });
  }

  send(data: string) {
    const msg = JSON.parse(data);
    setTimeout(() => this.readyState === 1 && server.handle(this, msg));
  }

  deliver(msg: unknown) {
    const data = JSON.stringify(msg);
    setTimeout(() => this.readyState === 1 && this.onmessage?.({ data }));
  }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    server.sockets.delete(this);
    setTimeout(() => this.onclose?.());
  }
}

async function until(cond: () => boolean, what: string) {
  for (let i = 0; i < 400; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timeout esperando: ${what}`);
}

const cards = (s: Session) => readBoard(s.doc).columns.flatMap((c) => c.cards.map((x) => `${c.title}/${x.title}/${x.desc}`));

const live: Session[] = [];
let docId = "";

/** Opens a session as a separate device would: no shared tab channel unless asked. */
async function open(store = new MemoryStore(), url: string | null = "ws://fake", crossTab = false) {
  const s = new Session(docId, store, url, crossTab);
  live.push(s);
  await s.start();
  if (url) await until(() => s.snapshot().status === "online", "sessão online");
  return s;
}

beforeEach(() => {
  server = new FakeServer();
  docId = `mesa${Math.random().toString(36).slice(2, 8)}`;
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
});

afterEach(() => {
  for (const s of live.splice(0)) s.close();
});

describe("session", () => {
  it("relays edits between two online replicas", async () => {
    const a = await open();
    const b = await open();
    const col = addColumn(a.doc, "A fazer");
    addCard(a.doc, col, "comprar café");
    await until(() => cards(b).length === 1, "cartão chegar em b");
    expect(cards(b)).toEqual(["A fazer/comprar café/"]);
    await until(() => a.snapshot().pending === 0, "ack");
  });

  it("merges work done offline on both sides", async () => {
    const a = await open();
    const b = await open();
    const col = addColumn(a.doc, "Ideias");
    const card = addCard(a.doc, col, "texto");
    editText(a.doc, `card:${card}`, "desc", "pão");
    await until(() => cards(b).length === 1 && a.snapshot().pending === 0, "estado inicial");

    a.setAirplane(true);
    await until(() => a.snapshot().status === "offline", "a offline");
    editText(a.doc, `card:${card}`, "desc", "pão integral");
    addCard(a.doc, col, "feito no avião");
    editText(b.doc, `card:${card}`, "desc", "comprar pão");
    addCard(b.doc, col, "feito em terra");
    await new Promise((r) => setTimeout(r, 30));
    expect(a.snapshot().pending).toBeGreaterThan(0);
    expect(cards(a)).not.toEqual(cards(b));

    a.setAirplane(false);
    await until(() => a.snapshot().pending === 0 && cards(a).length === 3 && cards(b).length === 3, "convergência");
    expect(cards(a)).toEqual(cards(b));
    expect(cards(a)[0]).toBe("Ideias/texto/comprar pão integral");
  });

  it("works with no server at all and remembers across reloads", async () => {
    const store = new MemoryStore();
    const first = await open(store, null);
    const col = addColumn(first.doc, "Só aqui");
    addCard(first.doc, col, "persistido");
    await new Promise((r) => setTimeout(r, 10));
    first.close();

    const second = await open(store, null);
    expect(cards(second)).toEqual(["Só aqui/persistido/"]);
    expect(second.doc.replica).not.toBe(first.doc.replica);
  });

  it("uploads what a previous page load did offline", async () => {
    const store = new MemoryStore();
    const offline = await open(store, null);
    addCard(offline.doc, addColumn(offline.doc, "Offline"), "nunca enviado");
    await new Promise((r) => setTimeout(r, 10));
    offline.close();
    expect(server.log.length).toBe(0);

    const later = await open(store);
    await until(() => later.snapshot().pending === 0, "upload do log antigo");
    expect(server.log.length).toBe(5);
    expect(new Set(server.log.map((o) => o.r))).toEqual(new Set([offline.doc.replica]));
  });

  it("syncs two tabs of the same browser with no server", async () => {
    const store = new MemoryStore();
    const tab1 = await open(store, null, true);
    const tab2 = await open(store, null, true);
    addCard(tab1.doc, addColumn(tab1.doc, "Entre abas"), "sem rede");
    await until(() => cards(tab2).length === 1, "aba 2 receber pela BroadcastChannel");
    expect(cards(tab2)).toEqual(["Entre abas/sem rede/"]);
    expect(tab2.snapshot().received).toBe(5);
  });

  it("recovers when an ack is lost and the connection drops", async () => {
    const a = await open();
    server.dropAcks = 1;
    addColumn(a.doc, "Sem ack");
    await until(() => server.log.length === 2, "servidor gravar");
    expect(a.snapshot().pending).toBe(2);
    for (const s of [...server.sockets]) s.close(); // connection dies before the ack
    await until(() => a.snapshot().status === "online" && a.snapshot().pending === 0, "reconectar e reconciliar");
    expect(server.log.length).toBe(2); // resent, but stored once
  });
});

describe("IndexedDbStore", () => {
  it("is idempotent and keeps application order", async () => {
    const store = new IndexedDbStore(`t${Math.random()}`);
    const op = (r: string, s: number): Op => ({ k: "set", r, s, t: s, o: "o", f: "f", v: `${r}${s}` });
    await store.append("d", [op("a", 1), op("b", 1), op("a", 2)]);
    await store.append("d", [op("a", 2), op("a", 3), op("b", 1)]); // two repeats
    await store.append("other", [op("z", 1)]);
    const loaded = await store.load("d");
    expect(loaded.map((o) => `${o.r}${o.s}`)).toEqual(["a1", "b1", "a2", "a3"]);
    expect((await store.load("other")).length).toBe(1);
  });
});
