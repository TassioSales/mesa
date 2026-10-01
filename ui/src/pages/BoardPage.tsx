import clsx from "clsx";
import { Check, CloudOff, History, Link2, LoaderCircle, Plane, RefreshCw, Wifi } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { addColumn, setTitle } from "../../core";
import { BoardView, type Focus } from "../components/BoardView";
import { HistoryView } from "../components/HistoryView";
import { Avatar, Button } from "../components/ui";
import { useBoard, useRevision, useSession } from "../lib/hooks";
import { loadIdentity, rememberBoard } from "../lib/identity";
import type { Session, Snapshot } from "../lib/session";

const VALID = /^[a-z0-9]{4,32}$/;

export function BoardPage() {
  const { id = "" } = useParams();
  if (!VALID.test(id)) {
    return (
      <div className="py-24 text-center">
        <p className="font-display text-3xl font-bold">Código inválido</p>
        <p className="mt-2 text-ink-2">O código de uma mesa tem de 4 a 32 letras minúsculas e números.</p>
        <Link to="/" className="mt-6 inline-block font-semibold underline">
          Voltar
        </Link>
      </div>
    );
  }
  return <Opened key={id} id={id} />;
}

function Opened({ id }: { id: string }) {
  const { session, state } = useSession(id);
  if (!session || !state) {
    return (
      <div className="flex items-center justify-center gap-3 py-24 text-ink-2">
        <LoaderCircle className="size-5 animate-spin" /> Abrindo o que está guardado neste aparelho…
      </div>
    );
  }
  return <Loaded id={id} session={session} state={state} />;
}

function Loaded({ id, session, state }: { id: string; session: Session; state: Snapshot }) {
  const { doc } = session;
  const board = useBoard(doc);
  const location = useLocation();
  const me = useRef(loadIdentity()).current;
  const [focus, setFocus] = useState<Focus>({ card: null, sel: null });
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState(false);
  const fresh = (location.state as { title?: string } | null)?.title;

  // A board created on the home page starts with a title and three columns.
  // A board opened by code starts empty: someone else may already have set it up.
  const seeded = useRef(false);
  useEffect(() => {
    if (!fresh || seeded.current || doc.history().length > 0) return;
    seeded.current = true;
    setTitle(doc, fresh);
    for (const t of ["A fazer", "Fazendo", "Feito"]) addColumn(doc, t);
    window.history.replaceState({}, "");
  }, [doc, fresh]);

  useEffect(() => rememberBoard(id, board.title), [id, board.title]);
  useEffect(() => {
    document.title = `${board.title} · mesa`;
    return () => void (document.title = "mesa");
  }, [board.title]);
  // Presence follows the caret, so it is throttled: at most one message every 60 ms.
  useEffect(() => {
    const t = setTimeout(() => session.setPresence({ name: me.name, color: me.color, card: focus.card, sel: focus.sel }), 60);
    return () => clearTimeout(t);
  }, [session, me, focus, state.status]);

  // The first time this replica changes something, it signs the document,
  // so the history can say who did what. Read-only visits leave no trace.
  useEffect(() => {
    const key = `who:${doc.replica}`;
    let signed = doc.get(key, "id") !== undefined;
    return doc.onLocal(() => {
      if (signed) return;
      signed = true;
      doc.set(key, "id", { name: me.name, color: me.color });
    });
  }, [doc, me]);

  const empty = board.columns.length === 0;

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 sm:px-6">
        <TitleInput title={board.title} onCommit={(t) => setTitle(doc, t)} />
        <button
          onClick={() => {
            navigator.clipboard?.writeText(window.location.href);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="flex items-center gap-1.5 rounded-lg border-2 border-ink bg-paper px-2.5 py-1 font-mono text-xs shadow-hard-sm hover:bg-white"
          title="Copiar o link para convidar alguém"
        >
          {copied ? <Check className="size-3.5 text-leaf" /> : <Link2 className="size-3.5" />}
          {copied ? "link copiado" : id}
        </button>

        <div className="ml-auto flex items-center gap-3">
          <div className="flex -space-x-2">
            <Avatar name={me.name} color={me.color} title={`${me.name} (você)`} />
            {state.peers.map((p) => (
              <Avatar key={p.id} name={p.state.name ?? "?"} color={p.state.color ?? "#888"} />
            ))}
          </div>
          <StatusPill state={state} />
          <Button
            size="sm"
            icon={<History className="size-3.5" />}
            aria-pressed={history}
            onClick={() => setHistory(!history)}
            title="Volta o quadro a qualquer momento do passado"
          >
            Histórico
          </Button>
          <Button
            size="sm"
            variant={state.airplane ? "primary" : "plain"}
            icon={<Plane className="size-3.5" />}
            aria-pressed={state.airplane}
            onClick={() => session.setAirplane(!state.airplane)}
            title="Desliga a rede só para esta aba, para ver o trabalho offline e a fusão ao voltar"
          >
            {state.airplane ? "Voltar a conectar" : "Modo avião"}
          </Button>
        </div>
      </div>

      <div className="flex-1 px-4 sm:px-6">
        {history ? (
          <HistoryView doc={doc} onClose={() => setHistory(false)} />
        ) : (
          <>
        {empty && (
          <div className="mb-5 max-w-xl rounded-2xl border-2 border-ink bg-paper p-5 shadow-hard">
            <p className="font-display text-lg font-bold">Esta mesa ainda está vazia</p>
            <p className="mt-1 text-sm text-ink-2">
              {state.status === "online"
                ? "Ninguém criou nada aqui ainda. Comece com três colunas ou crie as suas."
                : "Não há nada guardado neste aparelho e ainda não deu para falar com o servidor. Você pode começar mesmo assim: tudo será enviado quando a rede voltar."}
            </p>
            <Button className="mt-4" variant="primary" onClick={() => ["A fazer", "Fazendo", "Feito"].forEach((t) => addColumn(doc, t))}>
              Criar A fazer / Fazendo / Feito
            </Button>
          </div>
        )}
        <BoardView doc={doc} peers={state.peers} onFocus={setFocus} />
          </>
        )}
      </div>

      <Footer session={session} state={state} />
    </div>
  );
}

function StatusPill({ state }: { state: Snapshot }) {
  const { status, pending, airplane } = state;
  const base = "flex items-center gap-1.5 rounded-full border-2 border-ink px-2.5 py-1 text-xs font-semibold";
  if (status === "online" && pending === 0) {
    return (
      <span className={clsx(base, "bg-note-lime")}>
        <Wifi className="size-3.5" /> sincronizado
      </span>
    );
  }
  if (status === "online" || status === "syncing") {
    return (
      <span className={clsx(base, "bg-note-sky")}>
        <RefreshCw className="size-3.5 animate-spin" /> sincronizando{pending > 0 && ` ${pending}`}
      </span>
    );
  }
  return (
    <span className={clsx(base, airplane ? "bg-sun" : "bg-note-stone")} title="Suas alterações ficam guardadas neste aparelho">
      <CloudOff className="size-3.5" />
      {status === "connecting" ? "conectando…" : "offline"}
      {pending > 0 && <span className="rounded-full bg-ink px-1.5 text-[10px] text-paper">{pending} a enviar</span>}
    </span>
  );
}

function TitleInput({ title, onCommit }: { title: string; onCommit: (t: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      aria-label="Nome da mesa"
      value={draft ?? title}
      maxLength={80}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft?.trim() && draft !== title) onCommit(draft.trim());
        setDraft(null);
      }}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className="min-w-0 rounded-lg bg-transparent px-1 font-display text-2xl font-extrabold tracking-tight hover:bg-ink/5 focus:bg-paper focus:outline-none focus:ring-2 focus:ring-ink"
      style={{ width: `${Math.max(8, (draft ?? title).length + 1)}ch` }}
    />
  );
}

function Footer({ session, state }: { session: Session; state: Snapshot }) {
  useRevision(session.doc);
  const s = session.doc.stats();
  const items: [string, string | number][] = [
    ["réplica", session.doc.replica],
    ["operações", s.ops],
    ["relógio", s.clock],
    ["recebidas", state.received],
    ["caracteres (com lápides)", `${s.elements - s.tombstones} (+${s.tombstones})`],
  ];
  return (
    <footer className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t-2 border-ink/10 px-4 py-3 font-mono text-[11px] text-ink-3 sm:px-6">
      {items.map(([k, v]) => (
        <span key={k}>
          {k} <span className="text-ink-2">{v}</span>
        </span>
      ))}
    </footer>
  );
}
