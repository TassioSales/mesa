import { ArrowRight, FlaskConical, X } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Avatar, Button, inputClass, Panel } from "../components/ui";
import { forgetBoard, loadIdentity, newBoardId, PALETTE, recentBoards, saveIdentity } from "../lib/identity";

export function HomePage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [code, setCode] = useState("");
  const [me, setMe] = useState(loadIdentity);
  const [recent, setRecent] = useState(recentBoards);
  const cleanCode = code.trim().toLowerCase().split("/").pop() ?? "";
  const update = (patch: Partial<typeof me>) => {
    const next = { ...me, ...patch };
    setMe(next);
    saveIdentity(next);
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <section className="max-w-3xl">
        <h1 className="font-display text-5xl leading-[1.05] font-extrabold tracking-tight sm:text-6xl">
          Um quadro que funciona <span className="bg-sun px-2">sem internet</span> e nunca perde o que você fez.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-2">
          Cada alteração é gravada primeiro no seu aparelho. Quando a rede aparece, todo mundo converge para o mesmo quadro, sem
          tela de conflito e sem "a versão de quem salvou por último".
        </p>
      </section>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <Panel className="p-5">
          <h2 className="font-display text-xl font-bold">Criar uma mesa</h2>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              navigate(`/m/${newBoardId()}`, { state: { title: title.trim() || "Minha mesa" } });
            }}
          >
            <input className={inputClass} value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Nome (ex.: Lançamento do site)" />
            <Button type="submit" variant="primary" icon={<ArrowRight className="size-4" />}>
              Criar
            </Button>
          </form>

          <h2 className="mt-7 font-display text-xl font-bold">Entrar com um código</h2>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (/^[a-z0-9]{4,32}$/.test(cleanCode)) navigate(`/m/${cleanCode}`);
            }}
          >
            <input className={inputClass + " font-mono"} value={code} onChange={(e) => setCode(e.target.value)} placeholder="código ou link" />
            <Button type="submit" disabled={!/^[a-z0-9]{4,32}$/.test(cleanCode)}>
              Entrar
            </Button>
          </form>
        </Panel>

        <Panel className="p-5">
          <h2 className="font-display text-xl font-bold">Como você aparece</h2>
          <div className="mt-4 flex items-center gap-3">
            <Avatar name={me.name} color={me.color} size={44} />
            <input className={inputClass} value={me.name} maxLength={40} aria-label="Seu nome" onChange={(e) => update({ name: e.target.value })} />
          </div>
          <div className="mt-3 flex gap-2" role="radiogroup" aria-label="Sua cor">
            {PALETTE.map((c) => (
              <button
                key={c}
                role="radio"
                aria-checked={me.color === c}
                aria-label={`cor ${c}`}
                onClick={() => update({ color: c })}
                className={`size-7 rounded-full border-2 border-ink ${me.color === c ? "ring-2 ring-ink ring-offset-2 ring-offset-paper" : ""}`}
                style={{ background: c }}
              />
            ))}
          </div>

          <h2 className="mt-7 font-display text-xl font-bold">Mesas neste aparelho</h2>
          {recent.length === 0 ? (
            <p className="mt-2 text-sm text-ink-3">Nenhuma ainda.</p>
          ) : (
            <ul className="mt-2 divide-y-2 divide-ink/10">
              {recent.map((r) => (
                <li key={r.id} className="group flex items-center gap-3 py-2">
                  <Link to={`/m/${r.id}`} className="min-w-0 flex-1">
                    <span className="block truncate font-semibold hover:underline">{r.title}</span>
                    <span className="font-mono text-[11px] text-ink-3">{r.id}</span>
                  </Link>
                  <button
                    aria-label={`Esquecer ${r.title}`}
                    title="Tirar da lista (os dados continuam no aparelho)"
                    onClick={() => {
                      forgetBoard(r.id);
                      setRecent(recentBoards());
                    }}
                    className="rounded p-1 text-ink-3 opacity-0 group-hover:opacity-100 hover:bg-ink/10 hover:text-ink focus:opacity-100"
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Link
        to="/lab"
        className="mt-6 flex items-center gap-4 rounded-2xl border-2 border-ink bg-note-violet p-5 shadow-hard transition-transform hover:-translate-y-0.5"
      >
        <FlaskConical className="size-9 shrink-0" />
        <div>
          <p className="font-display text-xl font-bold">Laboratório de conflitos</p>
          <p className="text-sm text-ink-2">
            Duas réplicas lado a lado e um interruptor de rede. Corte a conexão, edite as duas, religue e veja a fusão acontecer.
          </p>
        </div>
        <ArrowRight className="ml-auto size-5 shrink-0" />
      </Link>

      <section className="mt-12 grid gap-5 text-sm leading-relaxed text-ink-2 md:grid-cols-3">
        {[
          ["Local primeiro", "A interface lê e escreve num documento em memória, gravado no IndexedDB. Não existe carregando… nem botão de salvar."],
          ["Operações, não estado", "Cada alteração vira uma operação com identidade própria. Sincronizar é trocar as que o outro lado ainda não viu."],
          ["Convergência garantida", "Texto usa um CRDT de sequência; campos usam último-escritor-vence com relógio de Lamport. A ordem de chegada não importa."],
        ].map(([t, d]) => (
          <div key={t}>
            <h3 className="font-display text-base font-bold text-ink">{t}</h3>
            <p className="mt-1">{d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
