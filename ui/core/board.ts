import type { Doc } from "./doc";
import { between } from "./fracindex";

/**
 * A kanban board on top of a Doc.
 *
 *   board            title
 *   col:<id>         title, pos, gone
 *   card:<id>        title, place {c: column, p: position}, color, gone, + text field "desc"
 *
 * `place` is a single register on purpose: a card's column and its position
 * inside it always change together, so two concurrent moves can't leave it
 * with the column from one and the position from the other.
 */

export type Card = { id: string; title: string; column: string; pos: string; color: string; desc: string };
export type Column = { id: string; title: string; pos: string; cards: Card[]; revived: boolean };
export type Board = { title: string; columns: Column[] };

export const COLORS = ["amber", "rose", "sky", "lime", "violet", "stone"] as const;

const COL = "col:";
const CARD = "card:";

/** A fresh object id: unique because (replica, revision) is. */
function newId(doc: Doc): string {
  return `${doc.replica}.${doc.revision.toString(36)}`;
}

/** Reads the whole board. Pure function of the document state. */
export function readBoard(doc: Doc): Board {
  const columns = new Map<string, Column>();
  const gone = new Set<string>();
  const cards: Card[] = [];
  for (const obj of doc.objects()) {
    if (obj.startsWith(COL)) {
      const id = obj.slice(COL.length);
      const pos = doc.get(obj, "pos");
      if (typeof pos !== "string") continue; // half-created: title arrived, position hasn't
      if (doc.get(obj, "gone") === true) gone.add(id);
      columns.set(id, { id, title: str(doc.get(obj, "title")), pos, cards: [], revived: false });
    } else if (obj.startsWith(CARD)) {
      if (doc.get(obj, "gone") === true) continue;
      const place = doc.get(obj, "place");
      if (!isPlace(place)) continue;
      const id = obj.slice(CARD.length);
      cards.push({
        id,
        title: str(doc.get(obj, "title")),
        column: place.c,
        pos: place.p,
        color: str(doc.get(obj, "color")) || "amber",
        desc: doc.text(obj, "desc"),
      });
    }
  }
  for (const card of cards) columns.get(card.column)?.cards.push(card);
  const out: Column[] = [];
  for (const col of columns.values()) {
    if (gone.has(col.id)) {
      // Someone deleted this column while someone else put a card in it.
      // Losing the card would be worse than keeping the column.
      if (col.cards.length === 0) continue;
      col.revived = true;
    }
    col.cards.sort(byPos);
    out.push(col);
  }
  out.sort(byPos);
  return { title: str(doc.get("board", "title")) || "Mesa sem nome", columns: out };
}

const byPos = (a: { pos: string; id: string }, b: { pos: string; id: string }) =>
  a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

const str = (v: unknown) => (typeof v === "string" ? v : "");

function isPlace(v: unknown): v is { c: string; p: string } {
  return typeof v === "object" && v !== null && typeof (v as { c: unknown }).c === "string" && typeof (v as { p: unknown }).p === "string";
}

/** A key that sorts at `index` among `items` (which must not include the item being placed). */
function keyAt(items: { pos: string }[], index: number): string {
  const i = Math.max(0, Math.min(index, items.length));
  const lo = items[i - 1]?.pos ?? "";
  let hi = items[i]?.pos ?? "";
  // Two items can share a key after concurrent inserts at the same spot.
  if (hi && lo >= hi) hi = "";
  return between(lo, hi);
}

export function setTitle(doc: Doc, title: string): void {
  doc.set("board", "title", title);
}

export function addColumn(doc: Doc, title: string): string {
  const id = newId(doc);
  const cols = readBoard(doc).columns;
  doc.set(COL + id, "title", title);
  doc.set(COL + id, "pos", keyAt(cols, cols.length));
  return id;
}

export function renameColumn(doc: Doc, id: string, title: string): void {
  doc.set(COL + id, "title", title);
}

export function moveColumn(doc: Doc, id: string, index: number): void {
  const others = readBoard(doc).columns.filter((c) => c.id !== id);
  doc.set(COL + id, "pos", keyAt(others, index));
}

/** Deletes a column and the cards in it. */
export function removeColumn(doc: Doc, id: string): void {
  const col = readBoard(doc).columns.find((c) => c.id === id);
  for (const card of col?.cards ?? []) doc.set(CARD + card.id, "gone", true);
  doc.set(COL + id, "gone", true);
}

export function addCard(doc: Doc, column: string, title: string, color: string = "amber"): string {
  const id = newId(doc);
  const cards = readBoard(doc).columns.find((c) => c.id === column)?.cards ?? [];
  doc.set(CARD + id, "title", title);
  doc.set(CARD + id, "color", color);
  doc.set(CARD + id, "place", { c: column, p: keyAt(cards, cards.length) });
  return id;
}

export function editCard(doc: Doc, id: string, patch: { title?: string; color?: string }): void {
  if (patch.title !== undefined) doc.set(CARD + id, "title", patch.title);
  if (patch.color !== undefined) doc.set(CARD + id, "color", patch.color);
}

/** Moves a card to `index` of `column` (index counted without the card itself). */
export function moveCard(doc: Doc, id: string, column: string, index: number): void {
  const cards = (readBoard(doc).columns.find((c) => c.id === column)?.cards ?? []).filter((c) => c.id !== id);
  doc.set(CARD + id, "place", { c: column, p: keyAt(cards, index) });
}

export function removeCard(doc: Doc, id: string): void {
  doc.set(CARD + id, "gone", true);
}

/** The document object that holds a card's fields and its description text. */
export const cardObject = (id: string) => CARD + id;

/**
 * Turns "the text was A and is now B" into the smallest insert/delete at the
 * right place. `caret` (where the cursor ended up, in characters) settles
 * the ambiguity when the same character repeats: typing "a" into "aa" should
 * insert where the user typed, not at the first spot that produces "aaa".
 */
export function diffText(before: string, after: string, caret?: number): { pos: number; remove: number; insert: string } {
  const a = Array.from(before);
  const b = Array.from(after);
  let suffix = 0;
  const maxSuffix = Math.min(a.length, b.length, caret === undefined ? Infinity : b.length - caret);
  while (suffix < maxSuffix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  let prefix = 0;
  const maxPrefix = Math.min(a.length, b.length) - suffix;
  while (prefix < maxPrefix && a[prefix] === b[prefix]) prefix++;
  return { pos: prefix, remove: a.length - prefix - suffix, insert: b.slice(prefix, b.length - suffix).join("") };
}

/** Applies a text change to a card description as CRDT operations. */
export function editText(doc: Doc, object: string, field: string, next: string, caret?: number): void {
  const d = diffText(doc.text(object, field), next, caret);
  if (d.remove > 0) doc.delete(object, field, d.pos, d.remove);
  if (d.insert) doc.insert(object, field, d.pos, d.insert);
}
