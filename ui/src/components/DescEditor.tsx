import { useLayoutEffect, useRef, type ReactNode } from "react";
import { diffText, editText, type Doc, type Id } from "../../core";
import { useRevision } from "../lib/hooks";

/** Someone else's selection, as stable anchors into the text. */
export type RemoteCursor = { key: string | number; name: string; color: string; anchor: Id | null; head: Id | null };

/** This editor's selection, to be shared. Null when it loses focus. */
export type Selection = { anchor: Id | null; head: Id | null } | null;

/** Length in characters (code points), the unit the CRDT counts in. */
const cp = (s: string) => Array.from(s).length;

/** UTF-16 offset of the nth character. */
function utf16(text: string, chars: number): number {
  let i = 0;
  for (const ch of text) {
    if (chars-- <= 0) break;
    i += ch.length;
  }
  return i;
}

// Extra room at the top so a name tag above the first line is not clipped.
const box = "rounded-lg border-2 px-3 pt-4 pb-2.5 text-sm leading-relaxed [scrollbar-gutter:stable]";

/**
 * A textarea bound to a text CRDT, with other people's cursors.
 *
 * Typing turns into the smallest insert/delete at the caret. When a remote
 * edit arrives, the text is replaced and the caret is moved by exactly what
 * was inserted or removed before it, so it stays on the same character
 * while someone else types above.
 *
 * A textarea can't draw anything inside itself, so remote cursors live in a
 * mirror behind it: a div with the same text, font and wrapping whose text
 * is transparent, leaving only the carets and selection highlights visible
 * through the textarea's transparent background.
 */
export function DescEditor({
  doc,
  object,
  field,
  placeholder,
  rows = 8,
  cursors = [],
  onSelection,
}: {
  doc: Doc;
  object: string;
  field: string;
  placeholder?: string;
  rows?: number;
  cursors?: RemoteCursor[];
  onSelection?: (sel: Selection) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const rev = useRevision(doc);
  const text = doc.text(object, field);

  useLayoutEffect(() => {
    const el = ref.current!;
    if (el.value === text) return;
    const d = diffText(el.value, text);
    const added = cp(d.insert);
    const move = (offset: number) => {
      let c = cp(el.value.slice(0, offset));
      if (c >= d.pos + d.remove) c += added - d.remove;
      else if (c > d.pos) c = d.pos + added; // the caret was inside what got replaced
      return utf16(text, c);
    };
    const start = move(el.selectionStart);
    const end = move(el.selectionEnd);
    el.value = text;
    if (document.activeElement === el) el.setSelectionRange(start, end);
  }, [text, rev]);

  const report = () => {
    const el = ref.current;
    if (!el || !onSelection) return;
    if (document.activeElement !== el) return onSelection(null);
    const backward = el.selectionDirection === "backward";
    const a = cp(el.value.slice(0, backward ? el.selectionEnd : el.selectionStart));
    const h = cp(el.value.slice(0, backward ? el.selectionStart : el.selectionEnd));
    onSelection({ anchor: doc.anchor(object, field, a), head: doc.anchor(object, field, h) });
  };

  return (
    <div className="relative rounded-lg bg-paper">
      <div ref={mirror} aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden border-transparent break-words whitespace-pre-wrap text-transparent ${box}`}>
        {mirrorContent(doc, object, field, text, cursors)}
      </div>
      <textarea
        ref={ref}
        rows={rows}
        placeholder={placeholder}
        spellCheck={false}
        defaultValue={text}
        onInput={(e) => {
          const el = e.currentTarget;
          editText(doc, object, field, el.value, cp(el.value.slice(0, el.selectionStart)));
          report();
        }}
        onSelect={report}
        onFocus={report}
        onBlur={() => onSelection?.(null)}
        onScroll={(e) => {
          if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop;
        }}
        className={`relative block w-full resize-y border-ink bg-transparent placeholder:text-ink-3 focus:outline-none focus:ring-4 focus:ring-sun/60 ${box}`}
      />
    </div>
  );
}

/** The text cut at every cursor boundary, with highlights and carets in between. */
function mirrorContent(doc: Doc, object: string, field: string, text: string, cursors: RemoteCursor[]): ReactNode {
  if (cursors.length === 0) return text;
  const ranges = cursors.map((c) => {
    const a = utf16(text, doc.position(object, field, c.anchor));
    const h = utf16(text, doc.position(object, field, c.head));
    return { ...c, from: Math.min(a, h), to: Math.max(a, h), caret: h };
  });
  const cuts = [...new Set([0, text.length, ...ranges.flatMap((r) => [r.from, r.to])])].sort((x, y) => x - y);
  const out: ReactNode[] = [];
  for (let i = 0; i < cuts.length; i++) {
    const at = cuts[i]!;
    for (const r of ranges) {
      if (r.caret !== at) continue;
      out.push(
        <span key={`c${r.key}`} className="relative">
          <span className="absolute top-0 -left-px h-[1.35em] w-0.5 rounded-full" style={{ background: r.color }} />
          <span
            className="absolute -top-3.5 -left-px rounded-sm rounded-bl-none px-1 text-[9px] leading-[1.4] font-bold whitespace-nowrap text-white"
            style={{ background: r.color }}
          >
            {r.name}
          </span>
        </span>,
      );
    }
    const next = cuts[i + 1];
    if (next === undefined) break;
    const cover = ranges.find((r) => r.from <= at && r.to >= next && r.to > r.from);
    out.push(
      <span key={`t${at}`} style={cover ? { background: `${cover.color}33` } : undefined}>
        {text.slice(at, next)}
      </span>,
    );
  }
  return out;
}
