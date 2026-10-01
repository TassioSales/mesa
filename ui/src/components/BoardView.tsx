import clsx from "clsx";
import { AlignLeft, ArrowLeft, ArrowRight, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  addCard,
  addColumn,
  cardObject,
  COLORS,
  editCard,
  moveCard,
  moveColumn,
  removeCard,
  removeColumn,
  renameColumn,
  type Card,
  type Column,
  type Doc,
} from "../../core";
import { useBoard } from "../lib/hooks";
import type { Peer } from "../lib/session";
import { DescEditor, type RemoteCursor, type Selection } from "./DescEditor";
import { Avatar, Button, inputClass } from "./ui";

const noteColor: Record<string, string> = {
  amber: "bg-note-amber",
  rose: "bg-note-rose",
  sky: "bg-note-sky",
  lime: "bg-note-lime",
  violet: "bg-note-violet",
  stone: "bg-note-stone",
};

/** What this user is looking at, to share with others. */
export type Focus = { card: string | null; sel: Selection };

type Props = {
  doc: Doc;
  peers?: Peer[];
  /** Tells the page which card is open and where the caret is, for presence. */
  onFocus?: (focus: Focus) => void;
  compact?: boolean;
  /** Shows the board without letting anything be changed (history view). */
  readOnly?: boolean;
};

/** The board itself. Everything it does is a change to `doc`; it knows nothing about the network. */
export function BoardView({ doc, peers = [], onFocus, compact, readOnly }: Props) {
  const board = useBoard(doc);
  const [open, setOpen] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<{ column: string; index: number } | null>(null);
  const cards = board.columns.flatMap((c) => c.cards);
  const openCard = cards.find((c) => c.id === open) ?? null;

  const openId = openCard?.id ?? null;
  const [sel, setSel] = useState<Selection>(null);
  useEffect(() => onFocus?.({ card: openId, sel: openId ? sel : null }), [onFocus, openId, sel]);

  const select = (id: string | null) => setOpen(id);

  /** Where a card dropped at this pointer position would land, ignoring the dragged card itself. */
  const indexAt = (e: DragEvent<HTMLElement>): number => {
    const els = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-card]")].filter((el) => el.dataset.card !== dragging);
    const i = els.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    return i < 0 ? els.length : i;
  };

  return (
    <div className={clsx("flex items-start gap-4 overflow-x-auto pb-4", compact && "gap-3")} inert={readOnly}>
      {board.columns.map((col, ci) => (
        <ColumnView
          key={col.id}
          doc={doc}
          col={col}
          compact={compact}
          first={ci === 0}
          last={ci === board.columns.length - 1}
          onMove={(delta) => moveColumn(doc, col.id, ci + delta)}
          dropIndex={target?.column === col.id ? target.index : null}
          onDragOver={(e) => {
            if (!dragging) return;
            e.preventDefault();
            const index = indexAt(e);
            if (target?.column !== col.id || target.index !== index) setTarget({ column: col.id, index });
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragging) moveCard(doc, dragging, col.id, indexAt(e));
            setDragging(null);
            setTarget(null);
          }}
        >
          {(card) => (
            <CardView
              key={card.id}
              card={card}
              dragging={dragging === card.id}
              viewers={peers.filter((p) => p.state.card === card.id)}
              onOpen={() => select(card.id)}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", card.id);
                setDragging(card.id);
              }}
              onDragEnd={() => {
                setDragging(null);
                setTarget(null);
              }}
            />
          )}
        </ColumnView>
      ))}
      {!readOnly && <NewColumn onAdd={(title) => addColumn(doc, title)} compact={compact} />}
      {openCard && <CardModal doc={doc} card={openCard} columns={board.columns} peers={peers} onSelection={setSel} onClose={() => select(null)} />}
    </div>
  );
}

function ColumnView({
  doc,
  col,
  compact,
  first,
  last,
  onMove,
  dropIndex,
  onDragOver,
  onDrop,
  children,
}: {
  doc: Doc;
  col: Column;
  compact?: boolean;
  first: boolean;
  last: boolean;
  onMove: (delta: number) => void;
  dropIndex: number | null;
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
  children: (card: Card) => React.ReactNode;
}) {
  const [adding, setAdding] = useState(false);
  const marker = <div className="h-1 rounded-full bg-tomato" />;
  return (
    <section
      className={clsx("flex shrink-0 flex-col rounded-2xl border-2 border-ink bg-paper shadow-hard", compact ? "w-56" : "w-72")}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <header className="group flex items-center gap-1 border-b-2 border-ink px-3 py-2">
        <InlineText
          value={col.title}
          onCommit={(t) => renameColumn(doc, col.id, t)}
          className="min-w-0 flex-1 font-display text-[15px] font-bold"
          label="Nome da coluna"
        />
        <span className="rounded-full bg-ink/10 px-1.5 font-mono text-[11px] text-ink-2">{col.cards.length}</span>
        <div className="flex opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <IconButton label="Mover para a esquerda" disabled={first} onClick={() => onMove(-1)}>
            <ArrowLeft className="size-3.5" />
          </IconButton>
          <IconButton label="Mover para a direita" disabled={last} onClick={() => onMove(1)}>
            <ArrowRight className="size-3.5" />
          </IconButton>
          <IconButton
            label="Apagar coluna"
            onClick={() => (col.cards.length === 0 || confirm(`Apagar "${col.title}" e seus ${col.cards.length} cartões?`)) && removeColumn(doc, col.id)}
          >
            <Trash2 className="size-3.5" />
          </IconButton>
        </div>
      </header>
      {col.revived && (
        <p className="border-b-2 border-ink bg-note-rose px-3 py-1.5 text-[11px] leading-snug">
          Esta coluna foi apagada em outro lugar enquanto alguém punha um cartão nela. Ela fica até esvaziar.
        </p>
      )}
      <div className="flex min-h-16 flex-col gap-2 p-2.5">
        {col.cards.map((card, i) => (
          <div key={card.id} className="flex flex-col gap-2">
            {dropIndex === i && marker}
            {children(card)}
          </div>
        ))}
        {dropIndex !== null && dropIndex >= col.cards.length && marker}
        {adding ? (
          <QuickAdd
            placeholder="Título do cartão"
            onAdd={(title) => addCard(doc, col.id, title, COLORS[Math.floor(Math.random() * 5)])}
            onDone={() => setAdding(false)}
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-ink-3 hover:bg-ink/5 hover:text-ink"
          >
            <Plus className="size-3.5" /> Adicionar cartão
          </button>
        )}
      </div>
    </section>
  );
}

function CardView({
  card,
  dragging,
  viewers,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  card: Card;
  dragging: boolean;
  viewers: Peer[];
  onOpen: () => void;
  onDragStart: (e: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  return (
    <article
      data-card={card.id}
      draggable
      tabIndex={0}
      role="button"
      onClick={onOpen}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={clsx(
        "cursor-grab rounded-lg border-2 border-ink px-3 py-2 text-sm shadow-hard-sm transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sea active:cursor-grabbing",
        noteColor[card.color] ?? noteColor.amber,
        dragging && "opacity-40",
      )}
    >
      <p className="leading-snug font-medium break-words">{card.title || <span className="text-ink-3">sem título</span>}</p>
      {(card.desc || viewers.length > 0) && (
        <div className="mt-1.5 flex items-center gap-2">
          {card.desc && <AlignLeft className="size-3.5 text-ink-2" aria-label="Tem descrição" />}
          <div className="ml-auto flex -space-x-1.5">
            {viewers.map((p) => (
              <Avatar key={p.id} name={p.state.name ?? "?"} color={p.state.color ?? "#888"} size={20} title={`${p.state.name} está com este cartão aberto`} />
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

function CardModal({
  doc,
  card,
  columns,
  peers,
  onSelection,
  onClose,
}: {
  doc: Doc;
  card: Card;
  columns: Column[];
  peers: Peer[];
  onSelection: (sel: Selection) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const others = peers.filter((p) => p.state.card === card.id);
  const cursors: RemoteCursor[] = others
    .filter((p) => p.state.sel)
    .map((p) => ({ key: p.id, name: p.state.name ?? "?", color: p.state.color ?? "#888", anchor: p.state.sel!.anchor, head: p.state.sel!.head }));

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-ink/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal aria-label="Cartão" className={clsx("pop w-full max-w-xl rounded-2xl border-2 border-ink shadow-hard", noteColor[card.color] ?? noteColor.amber)}>
        <div className="flex items-start gap-3 border-b-2 border-ink px-5 py-4">
          <InlineText
            value={card.title}
            onCommit={(t) => editCard(doc, card.id, { title: t })}
            className="min-w-0 flex-1 font-display text-xl font-bold"
            label="Título do cartão"
            autoFocus={!card.title}
          />
          <IconButton label="Fechar" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="space-y-4 rounded-b-2xl bg-paper px-5 py-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Cor">
              {COLORS.map((c) => (
                <button
                  key={c}
                  role="radio"
                  aria-checked={card.color === c}
                  aria-label={c}
                  onClick={() => editCard(doc, card.id, { color: c })}
                  className={clsx("size-6 rounded-full border-2 border-ink", noteColor[c], card.color === c && "ring-2 ring-ink ring-offset-2 ring-offset-paper")}
                />
              ))}
            </div>
            <label className="ml-auto flex items-center gap-2 text-xs text-ink-2">
              Coluna
              <select
                value={card.column}
                onChange={(e) => moveCard(doc, card.id, e.target.value, Number.MAX_SAFE_INTEGER)}
                className="h-8 rounded-lg border-2 border-ink bg-paper px-2 text-xs font-medium"
              >
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-semibold text-ink-2">Descrição</span>
              {others.length > 0 && (
                <span className="flex items-center gap-1.5 text-ink-3">
                  {others.map((p) => (
                    <Avatar key={p.id} name={p.state.name ?? "?"} color={p.state.color ?? "#888"} size={18} />
                  ))}
                  também {others.length > 1 ? "estão" : "está"} aqui
                </span>
              )}
            </div>
            <DescEditor key={card.id} doc={doc} object={cardObject(card.id)} field="desc" cursors={cursors} onSelection={onSelection} placeholder="Escreva à vontade. Se duas pessoas escreverem ao mesmo tempo, os dois textos ficam." />
          </div>

          <div className="flex justify-between">
            <Button
              size="sm"
              variant="danger"
              icon={<Trash2 className="size-3.5" />}
              onClick={() => {
                removeCard(doc, card.id);
                onClose();
              }}
            >
              Apagar cartão
            </Button>
            <Button size="sm" onClick={onClose}>
              Fechar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NewColumn({ onAdd, compact }: { onAdd: (title: string) => void; compact?: boolean }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className={clsx("shrink-0", compact ? "w-56" : "w-72")}>
      {adding ? (
        <div className="rounded-2xl border-2 border-ink bg-paper p-2.5 shadow-hard">
          <QuickAdd placeholder="Nome da coluna" onAdd={onAdd} onDone={() => setAdding(false)} once />
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex h-11 w-full items-center gap-2 rounded-2xl border-2 border-dashed border-ink/40 px-4 text-sm font-semibold text-ink-3 hover:border-ink hover:bg-paper hover:text-ink"
        >
          <Plus className="size-4" /> Nova coluna
        </button>
      )}
    </div>
  );
}

/** A small form that adds on Enter and closes on Escape or when emptied. */
function QuickAdd({ placeholder, onAdd, onDone, once }: { placeholder: string; onAdd: (title: string) => void; onDone: () => void; once?: boolean }) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const title = value.trim();
        if (!title) return onDone();
        onAdd(title);
        setValue("");
        if (once) onDone();
      }}
    >
      <input
        autoFocus
        value={value}
        maxLength={200}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onDone()}
        onBlur={() => !value.trim() && onDone()}
        className={inputClass + " h-9"}
      />
    </form>
  );
}

/** Text that turns into an input on focus and commits on blur or Enter. */
function InlineText({ value, onCommit, className, label, autoFocus }: { value: string; onCommit: (v: string) => void; className?: string; label: string; autoFocus?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const commit = () => {
    if (draft !== null && draft.trim() && draft !== value) onCommit(draft.trim());
    setDraft(null);
  };
  return (
    <input
      ref={ref}
      aria-label={label}
      autoFocus={autoFocus}
      value={draft ?? value}
      maxLength={200}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") ref.current?.blur();
        if (e.key === "Escape") {
          setDraft(null);
          e.stopPropagation();
          requestAnimationFrame(() => ref.current?.blur());
        }
      }}
      className={clsx("truncate rounded bg-transparent px-1 py-0.5 hover:bg-ink/5 focus:bg-paper focus:outline-none focus:ring-2 focus:ring-ink", className)}
    />
  );
}

function IconButton({ label, children, ...rest }: { label: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className="grid size-7 place-items-center rounded-md text-ink-2 hover:bg-ink/10 hover:text-ink disabled:opacity-25 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
