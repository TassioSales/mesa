import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { initials } from "../lib/identity";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "plain" | "ghost" | "danger";
  size?: "sm" | "md";
  icon?: ReactNode;
};

export function Button({ variant = "plain", size = "md", icon, className, children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap transition-transform",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sea disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-2.5 text-xs" : "h-10 px-4 text-sm",
        variant !== "ghost" && "border-2 border-ink shadow-hard-sm active:translate-x-[2px] active:translate-y-[2px] active:shadow-none",
        variant === "primary" && "bg-sun hover:bg-[#ffc94a]",
        variant === "plain" && "bg-paper hover:bg-white",
        variant === "danger" && "bg-note-rose hover:bg-[#ffb0b7]",
        variant === "ghost" && "text-ink-2 hover:bg-ink/5 hover:text-ink",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export function Avatar({ name, color, size = 28, title }: { name: string; color: string; size?: number; title?: string }) {
  return (
    <span
      title={title ?? name}
      className="inline-grid shrink-0 place-items-center rounded-full border-2 border-ink font-bold text-white"
      style={{ width: size, height: size, background: color, fontSize: size * 0.38 }}
    >
      {initials(name) || "?"}
    </span>
  );
}

export const inputClass =
  "h-10 w-full rounded-lg border-2 border-ink bg-paper px-3 text-sm placeholder:text-ink-3 focus:outline-none focus:ring-4 focus:ring-sun/60";

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx("rounded-2xl border-2 border-ink bg-paper shadow-hard", className)}>{children}</div>;
}
