import type { ReactNode } from "react";
import { COMPANY_NAME } from "@/lib/format";
import { cx } from "../ui";
import { LogoMark } from "./Logo";

/** Calm, branded layout for candidate-facing pages (careers, test, interview, offer, documents). */
export function PortalShell({
  children,
  wide,
  bare,
}: {
  children: ReactNode;
  wide?: boolean;
  bare?: boolean;
}) {
  return (
    <div className="flex min-h-full flex-col bg-zinc-50">
      {!bare && (
        <header className="border-b border-zinc-200 bg-white">
          <div
            className={cx(
              "mx-auto flex h-16 items-center gap-3 px-4 sm:px-6",
              wide ? "max-w-6xl" : "max-w-3xl",
            )}
          >
            <LogoMark className="size-7" />
            <span className="text-[15px] font-semibold tracking-tight text-zinc-900">
              {COMPANY_NAME}
            </span>
            <span className="h-4 w-px bg-zinc-300" aria-hidden />
            <span className="text-sm text-zinc-500">Careers</span>
          </div>
        </header>
      )}
      <main
        className={cx(
          "page-in mx-auto w-full flex-1 px-4 py-8 sm:px-6 sm:py-12",
          wide ? "max-w-6xl" : "max-w-3xl",
        )}
      >
        {children}
      </main>
      {!bare && (
        <footer className="border-t border-zinc-200 py-6 text-center text-xs text-zinc-400">
          Questions? Reply to any email from our recruiting team. · Powered by
          cats
        </footer>
      )}
    </div>
  );
}

/** Centered message card for portal states (expired link, submitted, etc.) */
export function PortalMessage({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-zinc-200 bg-white px-8 py-10 text-center">
      {icon && (
        <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand-700 [&_svg]:size-6">
          {icon}
        </div>
      )}
      <h1 className="font-display text-2xl font-medium text-zinc-900">
        {title}
      </h1>
      {children && (
        <div className="mt-3 text-[15px] leading-relaxed text-zinc-600">
          {children}
        </div>
      )}
    </div>
  );
}
