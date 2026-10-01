import clsx from "clsx";
import { ArrowLeftRight, RotateCcw, Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import { addCard, addColumn, Doc, editText, setTitle } from "../../core";
import { BoardView } from "../components/BoardView";
import { DescEditor, type RemoteCursor, type Selection } from "../components/DescEditor";
import { Avatar, Button, Panel } from "../components/ui";
import { useRevision } from "../lib/hooks";

const NOTE = "note";

/** Two replicas that start from the same state. */
function makePair(): [Doc, Doc] {
  const a = new Doc("ana");
  setTitle(a, "Laboratório");
  const todo = addColumn(a, "A fazer");
  const done = addColumn(a, "Feito");
  addCard(a, todo, "Escrever o README", "sky");
  addCard(a, todo, "Gravar a demo", "amber");
  addCard(a, done, "Fuzz de convergência", "lime");
  editText(a, NOTE, "text", "A reunião é na quinta.");
  const b = new Doc("bia");
  b.apply(a.history());
  return [a, b];
}

export function LabPage() {
  const [[a, b], setPair] = useState(makePair);
  const [linked, setLinked] = useState(true);
  // Carets are shared like presence would be: only while the link is up.
  const [selA, setSelA] = useState<Selection>(null);
  const [selB, setSelB] = useState<Selection>(null);
  const revA = useRevision(a);
  const revB = useRevision(b);

  // The whole "network": when linked, each side gets what it is missing.
  // Applying is idempotent, so running this on every change is safe.
  useEffect(() => {
    if (!linked) return;
    b.apply(a.opsSince(b.vector()));
    a.apply(b.opsSince(a.vector()));
  }, [a, b, linked, revA, revB]);

  const aheadA = a.opsSince(b.vector()).length;
  const aheadB = b.opsSince(a.vector()).length;
  const same = a.text(NOTE, "text") === b.text(NOTE, "text") && aheadA === 0 && aheadB === 0;

  return (
    <div className="px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-3xl text-center">
        <h1 className="font-display text-4xl font-extrabold tracking-tight">Laboratório de conflitos</h1>
        <p className="mt-2 text-ink-2">
          Ana e Bia são duas réplicas do mesmo documento, dentro desta página, sem servidor. Corte a rede, mexa nos dois lados
          (mova o mesmo cartão, edite a mesma frase) e religue.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <Button
            variant={linked ? "plain" : "primary"}
            icon={linked ? <Unplug className="size-4" /> : <ArrowLeftRight className="size-4" />}
            onClick={() => setLinked(!linked)}
          >
            {linked ? "Cortar a rede" : "Religar a rede"}
          </Button>
          <span
            className={clsx(
              "rounded-full border-2 border-ink px-3 py-1.5 text-xs font-semibold",
              !linked ? "bg-sun" : same ? "bg-note-lime" : "bg-note-sky",
            )}
          >
            {!linked
              ? `rede cortada · Ana tem ${aheadA} op${aheadA === 1 ? "" : "s"} que Bia não viu, Bia tem ${aheadB}`
              : same
                ? "conectadas · réplicas idênticas"
                : "sincronizando…"}
          </span>
          <Button
            variant="ghost"
            icon={<RotateCcw className="size-4" />}
            onClick={() => {
              setPair(makePair());
              setLinked(true);
            }}
          >
            Recomeçar
          </Button>
        </div>
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        <Replica doc={a} name="Ana" color="#e4572e" onSelection={setSelA} other={linked && selB ? { key: "bia", name: "Bia", color: "#2e86ab", ...selB } : null} />
        <Replica doc={b} name="Bia" color="#2e86ab" onSelection={setSelB} other={linked && selA ? { key: "ana", name: "Ana", color: "#e4572e", ...selA } : null} />
      </div>

      <Panel className="mx-auto mt-8 max-w-3xl p-5 text-sm leading-relaxed text-ink-2">
        <h2 className="font-display text-lg font-bold text-ink">O que observar</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li>
            <b>Texto:</b> com a rede cortada, Ana escreve no começo da frase e Bia no fim. Ao religar, as duas edições ficam. Se as
            duas escreverem no mesmo ponto, os trechos ficam um depois do outro, inteiros, na mesma ordem dos dois lados.
          </li>
          <li>
            <b>Mover o mesmo cartão:</b> cada uma arrasta o cartão para uma coluna diferente. Vence a movimentação com o maior
            relógio de Lamport; o cartão nunca aparece duplicado nem some.
          </li>
          <li>
            <b>Apagar × usar:</b> Ana apaga uma coluna enquanto Bia cria um cartão nela. A coluna volta, com um aviso, em vez de o
            cartão desaparecer.
          </li>
          <li>
            <b>Cursores:</b> clique no bloco de notas de uma e veja o cursor aparecer no da outra. Ele é guardado como "depois do
            caractere tal", não como um número de posição, então continua no lugar certo quando alguém escreve antes dele.
          </li>
          <li>
            <b>Vetor de versão:</b> é a lista "até qual operação de cada réplica eu já vi". Sincronizar é comparar dois vetores e
            mandar a diferença.
          </li>
        </ul>
      </Panel>
    </div>
  );
}

function Replica({
  doc,
  name,
  color,
  other,
  onSelection,
}: {
  doc: Doc;
  name: string;
  color: string;
  other: RemoteCursor | null;
  onSelection: (sel: Selection) => void;
}) {
  useRevision(doc);
  const s = doc.stats();
  const vector = Object.entries(doc.vector())
    .sort()
    .map(([r, n]) => `${r}:${n}`)
    .join("  ");
  return (
    <Panel className="min-w-0 overflow-hidden">
      <header className="flex items-center gap-3 border-b-2 border-ink px-4 py-3">
        <Avatar name={name} color={color} />
        <span className="font-display text-lg font-bold">{name}</span>
        <span className="ml-auto font-mono text-[11px] text-ink-3">
          vetor <span className="text-ink-2">{vector}</span> · relógio <span className="text-ink-2">{s.clock}</span> · {s.ops} ops
        </span>
      </header>
      <div className="space-y-4 p-4">
        <div>
          <div className="mb-1.5 text-xs font-semibold text-ink-2">Bloco de notas compartilhado</div>
          <DescEditor doc={doc} object={NOTE} field="text" rows={3} cursors={other ? [other] : []} onSelection={onSelection} />
        </div>
        <BoardView doc={doc} compact />
      </div>
    </Panel>
  );
}
