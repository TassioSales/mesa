/** Who the user is on this device: a display name and a colour, kept in localStorage. */

export type Identity = { name: string; color: string };

const ANIMALS = ["Capivara", "Tucano", "Onça", "Arara", "Tatu", "Jabuti", "Quati", "Boto", "Lobo-guará", "Sagui", "Tamanduá", "Jacaré"];
const ADJECTIVES = ["Azul", "Curiosa", "Veloz", "Serena", "Astuta", "Dourada", "Noturna", "Risonha"];
export const PALETTE = ["#e4572e", "#2e86ab", "#3a9d6e", "#a23b72", "#d99a00", "#5b5bd6", "#0e7c7b", "#c0392b"];

const KEY = "mesa.identity";
const pick = <T>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)]!;

export function loadIdentity(): Identity {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Identity | null;
    if (saved?.name && saved.color) return saved;
  } catch {
    /* corrupted: start over */
  }
  const fresh = { name: `${pick(ANIMALS)} ${pick(ADJECTIVES)}`, color: pick(PALETTE) };
  saveIdentity(fresh);
  return fresh;
}

export function saveIdentity(id: Identity): void {
  localStorage.setItem(KEY, JSON.stringify(id));
}

export type Recent = { id: string; title: string; at: number };
const RECENT = "mesa.recent";

export function recentBoards(): Recent[] {
  try {
    return (JSON.parse(localStorage.getItem(RECENT) ?? "[]") as Recent[]).filter((r) => r && typeof r.id === "string");
  } catch {
    return [];
  }
}

export function rememberBoard(id: string, title: string): void {
  const list = recentBoards().filter((r) => r.id !== id);
  list.unshift({ id, title, at: Date.now() });
  localStorage.setItem(RECENT, JSON.stringify(list.slice(0, 12)));
}

export function forgetBoard(id: string): void {
  localStorage.setItem(RECENT, JSON.stringify(recentBoards().filter((r) => r.id !== id)));
}

/** A short code that is easy to read aloud: no 0/o, 1/l. */
export function newBoardId(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
