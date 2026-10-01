import { Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Doc } from "../../core";
import { author, describe, steps as groupSteps } from "../lib/history";
import { useRevision } from "../lib/hooks";
import { BoardView } from "./BoardView";
import { Avatar, Button } from "./ui";

/**
 * Time travel. The document is nothing but its log of operations, so the
 * board at any past moment is that log replayed up to there. Nothing extra
 * is stored to make this possible.
 */
export function HistoryView({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const rev = useRevision(doc);
  const steps = useMemo(() => groupSteps(doc.history()), [doc, rev]);
  const [at, setAt] = useState(steps.length);
  const [playing, setPlaying] = useState(false);
  const index = Math.min(at, steps.length);
  const step = index > 0 ? steps[index - 1] : undefined;
  const past = useMemo(() => Doc.replay(doc.history().slice(0, step?.end ?? 0)), [doc, step?.end]);

  useEffect(() => {
    if (!playing) return;
    if (index >= steps.length) return setPlaying(false);
    const t = setTimeout(() => setAt(index + 1), 450);
    return () => clearTimeout(t);
  }, [playing, index, steps.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setAt((v) => Math.max(0, Math.min(v, steps.length) - 1));
      if (e.key === "ArrowRight") setAt((v) => Math.min(steps.length, v + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, steps.length]);

  const who = step ? author(doc, step.replica) : null;

  return (
    <div>
      <div className="mb-5 rounded-2xl border-2 border-ink bg-note-violet p-4 shadow-hard">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="primary"
            icon={playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            onClick={() => {
              if (!playing && index >= steps.length) setAt(0);
              setPlaying(!playing);
            }}
          >
            {playing ? "Pausar" : index >= steps.length ? "Rever do início" : "Reproduzir"}
          </Button>
          <div className="flex">
            <Button size="sm" variant="ghost" aria-label="Passo anterior" disabled={index === 0} onClick={() => setAt(index - 1)}>
              <SkipBack className="size-3.5" />
            </Button>
            <Button size="sm" variant="ghost" aria-label="Próximo passo" disabled={index >= steps.length} onClick={() => setAt(index + 1)}>
              <SkipForward className="size-3.5" />
            </Button>
          </div>
          <input
            type="range"
            aria-label="Momento do histórico"
            className="min-w-40 flex-1 accent-[var(--color-ink)]"
            min={0}
            max={steps.length}
            value={index}
            onChange={(e) => {
              setPlaying(false);
              setAt(Number(e.target.value));
            }}
          />
          <span className="font-mono text-xs tabular-nums">
            {index} / {steps.length}
          </span>
          <Button size="sm" icon={<X className="size-3.5" />} onClick={onClose}>
            Voltar ao presente
          </Button>
        </div>
        <div className="mt-3 flex min-h-7 items-center gap-2.5 text-sm">
          {step && who ? (
            <>
              <Avatar name={who.name} color={who.color} size={24} />
              <span>
                <b>{who.name}</b> {describe(step, past)}
              </span>
              {step.at && <span className="ml-auto font-mono text-xs text-ink-2">{new Date(step.at).toLocaleString("pt-BR")}</span>}
            </>
          ) : (
            <span className="text-ink-2">O começo: a mesa ainda vazia.</span>
          )}
        </div>
      </div>
      <BoardView doc={past} readOnly />
    </div>
  );
}
