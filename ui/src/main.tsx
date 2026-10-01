import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, NavLink, Outlet, Route, Routes } from "react-router";
import "./index.css";
import { BoardPage } from "./pages/BoardPage";
import { HomePage } from "./pages/HomePage";
import { LabPage } from "./pages/LabPage";

function Layout() {
  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-5 border-b-2 border-ink bg-cream/95 px-4 backdrop-blur sm:px-6">
        <Link to="/" className="flex items-center gap-2">
          <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
            <rect x="1.5" y="1.5" width="29" height="29" rx="7" fill="#ffd166" stroke="#1a1a1a" strokeWidth="3" />
            <path d="M8 13h16M11 13v9M21 13v9" stroke="#1a1a1a" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <span className="font-display text-xl font-extrabold tracking-tight">mesa</span>
        </Link>
        <nav className="flex gap-1 text-sm font-semibold">
          {[
            ["/", "Início"],
            ["/lab", "Laboratório"],
          ].map(([to, label]) => (
            <NavLink
              key={to}
              to={to!}
              end
              className={({ isActive }) => `rounded-lg px-3 py-1.5 ${isActive ? "bg-ink text-cream" : "text-ink-2 hover:bg-ink/5 hover:text-ink"}`}
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <Outlet />
    </>
  );
}

function NotFound() {
  return (
    <div className="py-24 text-center">
      <p className="font-display text-6xl font-extrabold">404</p>
      <p className="mt-2 text-ink-2">Não tem nada nesta mesa.</p>
      <Link to="/" className="mt-6 inline-block font-semibold underline">
        Voltar ao início
      </Link>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="m/:id" element={<BoardPage />} />
          <Route path="lab" element={<LabPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
