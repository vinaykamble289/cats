import { cx } from "../ui";

/** cats mark: two uprights joined by a rising step — a candidate moving forward. */
export function LogoMark({
  className,
  inverted,
}: {
  className?: string;
  inverted?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cx("size-8 shrink-0", className)}
      aria-hidden
    >
      <rect
        width="32"
        height="32"
        rx="7"
        className={inverted ? "fill-zinc-50" : "fill-brand-600"}
      />
      <path
        d="M9.5 8.5h3v15h-3zM19.5 8.5h3v15h-3zM12.5 18.2l7-4.4v3.4l-7 4.4z"
        className={inverted ? "fill-brand-700" : "fill-zinc-50"}
      />
    </svg>
  );
}

export function Logo({
  subtitle,
  className,
}: {
  subtitle?: string;
  className?: string;
}) {
  return (
    <div className={cx("flex items-center gap-2.5", className)}>
      <LogoMark />
      <div className="min-w-0 leading-tight">
        <p className="text-[15px] font-semibold tracking-tight text-zinc-900">
          cats
        </p>
        {subtitle && (
          <p className="truncate text-xs text-zinc-500">{subtitle}</p>
        )}
      </div>
    </div>
  );
}
