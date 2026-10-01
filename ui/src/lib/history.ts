import type { Doc, Op } from "../../core";

/** A run of ops that reads as one action: a typing burst, or the three writes that create a card. */
export type Step = {
  /** How many ops of the log are applied after this step. */
  end: number;
  replica: string;
  at?: number;
  ops: Op[];
};

const BURST_MS = 1500;

/** Groups a log into steps: consecutive ops by the same replica on the same object, close in time. */
export function steps(log: readonly Op[]): Step[] {
  const out: Step[] = [];
  for (let i = 0; i < log.length; i++) {
    const op = log[i]!;
    const last = out[out.length - 1];
    const prev = last?.ops[last.ops.length - 1];
    if (last && prev && prev.r === op.r && prev.o === op.o && Math.abs((op.w ?? 0) - (prev.w ?? 0)) <= BURST_MS) {
      last.ops.push(op);
      last.end = i + 1;
    } else {
      out.push({ end: i + 1, replica: op.r, at: op.w, ops: [op] });
    }
  }
  return out;
}

const q = (s: unknown) => `“${typeof s === "string" && s ? s : "sem título"}”`;

/**
 * Says what a step did, in words. `after` is the document right after the
 * step, used to look up the titles of the things it touched.
 */
export function describe(step: Step, after: Doc): string {
  const o = step.ops[0]!.o;
  const fields = new Set(step.ops.map((op) => op.f));
  const value = (f: string) => step.ops.findLast((op) => op.k === "set" && op.f === f) as (Op & { k: "set" }) | undefined;
  const title = q(after.get(o, "title"));

  if (o === "board") return `renomeou a mesa para ${q(value("title")?.v)}`;
  if (o.startsWith("who:")) return "entrou na mesa";
  if (o.startsWith("col:")) {
    if (value("gone")?.v === true) return `apagou a coluna ${title}`;
    if (fields.has("title") && fields.has("pos")) return `criou a coluna ${title}`;
    if (fields.has("title")) return `renomeou uma coluna para ${title}`;
    return `moveu a coluna ${title}`;
  }
  if (o.startsWith("card:")) {
    const place = after.get(o, "place") as { c?: string } | undefined;
    const column = q(place?.c ? after.get(`col:${place.c}`, "title") : "");
    if (value("gone")?.v === true) return `apagou o cartão ${title}`;
    if (fields.has("title") && fields.has("place")) return `criou o cartão ${title} em ${column}`;
    if (fields.has("place")) return `moveu ${title} para ${column}`;
    if (fields.has("desc")) {
      const typed = step.ops.flatMap((op) => (op.k === "ins" ? [op.x] : [])).join("");
      const removed = step.ops.reduce((n, op) => n + (op.k === "rem" ? op.d.reduce((m, run) => m + run[2], 0) : 0), 0);
      const parts = [typed && `escreveu ${q(typed.length > 40 ? typed.slice(0, 40) + "…" : typed)}`, removed && `apagou ${removed} caractere${removed > 1 ? "s" : ""}`];
      return `${parts.filter(Boolean).join(" e ")} na descrição de ${title}`;
    }
    if (fields.has("title")) return `renomeou um cartão para ${title}`;
    if (fields.has("color")) return `mudou a cor de ${title}`;
  }
  if (step.ops.some((op) => op.k !== "set")) return "editou um texto";
  return `alterou ${o}`;
}

/** Display name and colour of whoever was behind a replica, if they introduced themselves. */
export function author(doc: Doc, replica: string): { name: string; color: string } {
  const who = doc.get(`who:${replica}`, "id") as { name?: string; color?: string } | undefined;
  return { name: who?.name || replica, color: who?.color || "#86837a" };
}
