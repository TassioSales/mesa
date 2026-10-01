import { describe as suite, expect, it } from "vitest";
import { addCard, addColumn, Doc, editCard, editText, moveCard, removeCard, setTitle } from "../../core";
import { author, describe, steps } from "./history";

suite("history", () => {
  it("groups the log into readable steps and replays to each of them", () => {
    let clock = 0;
    const tick = (ms: number) => (clock += ms);
    const doc = new Doc("ana", () => clock);
    doc.set("who:ana", "id", { name: "Ana", color: "#e4572e" });
    tick(5000);
    setTitle(doc, "Lançamento");
    tick(5000);
    const todo = addColumn(doc, "A fazer");
    tick(5000);
    const done = addColumn(doc, "Feito");
    tick(5000);
    const card = addCard(doc, todo, "Escrever o README");
    tick(5000);
    // A typing burst: three edits within the burst window are one step.
    editText(doc, `card:${card}`, "desc", "ol");
    tick(200);
    editText(doc, `card:${card}`, "desc", "olá");
    tick(200);
    editText(doc, `card:${card}`, "desc", "olá!");
    tick(5000);
    moveCard(doc, card, done, 0);
    tick(5000);
    editCard(doc, card, { title: "README pronto" });
    tick(5000);
    removeCard(doc, card);

    const list = steps(doc.history());
    const told = list.map((s) => describe(s, Doc.replay(doc.history().slice(0, s.end))));
    expect(told).toEqual([
      "entrou na mesa",
      "renomeou a mesa para “Lançamento”",
      "criou a coluna “A fazer”",
      "criou a coluna “Feito”",
      "criou o cartão “Escrever o README” em “A fazer”",
      "escreveu “olá!” na descrição de “Escrever o README”",
      "moveu “Escrever o README” para “Feito”",
      "renomeou um cartão para “README pronto”",
      "apagou o cartão “README pronto”",
    ]);
    expect(list[list.length - 1]!.end).toBe(doc.history().length);
    expect(author(doc, "ana").name).toBe("Ana");
    expect(author(doc, "ghost").name).toBe("ghost");
  });
});
