import { format, formatDistanceToNowStrict, isValid, parseISO } from "date-fns";
import type { ApplicationStage, ApplicationStatus } from "./types";

export const COMPANY_NAME = import.meta.env.VITE_COMPANY_NAME || "cats";

function toDate(d: string | Date | null | undefined): Date | null {
  if (!d) return null;
  const date = typeof d === "string" ? parseISO(d) : d;
  return isValid(date) ? date : null;
}

export const fmtDate = (d: string | Date | null | undefined) =>
  toDate(d) ? format(toDate(d)!, "d MMM yyyy") : "—";
export const fmtDateTime = (d: string | Date | null | undefined) =>
  toDate(d) ? format(toDate(d)!, "d MMM yyyy, h:mm a") : "—";
export const fmtTime = (d: string | Date | null | undefined) =>
  toDate(d) ? format(toDate(d)!, "h:mm a") : "—";
export const fromNow = (d: string | Date | null | undefined) =>
  toDate(d) ? `${formatDistanceToNowStrict(toDate(d)!)} ago` : "—";
export const until = (d: string | Date | null | undefined) =>
  toDate(d) ? `in ${formatDistanceToNowStrict(toDate(d)!)}` : "—";

export function fmtMoney(
  amount: number | null | undefined,
  currency = "INR",
): string {
  if (amount === null || amount === undefined) return "—";
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

export function fmtBytes(n: number | null | undefined): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function initials(name: string | null | undefined): string {
  return (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

/** 'ai_screening' -> 'Ai screening' style fallback label */
export function humanize(value: string | null | undefined): string {
  if (!value) return "—";
  const s = value.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const STAGES: ApplicationStage[] = [
  "applied",
  "screening",
  "shortlisted",
  "assessment",
  "ai_interview",
  "interview",
  "offer",
  "pre_joining",
  "joined",
];

export const STAGE_LABEL: Record<ApplicationStage, string> = {
  applied: "Applied",
  screening: "Resume review",
  shortlisted: "Shortlisted",
  assessment: "Assessment",
  ai_interview: "AI interview",
  interview: "Interviews",
  offer: "Offer",
  pre_joining: "Pre-joining",
  joined: "Joined",
};

/**
 * Tailwind classes for each stage's dot / bar segment.
 * Stages are ordered, so they use one sequential ramp (light → deep pine),
 * ending in the success hue for "joined".
 */
export const STAGE_COLOR: Record<ApplicationStage, string> = {
  applied: "bg-zinc-300",
  screening: "bg-brand-200",
  shortlisted: "bg-brand-300",
  assessment: "bg-brand-400",
  ai_interview: "bg-brand-500",
  interview: "bg-brand-600",
  offer: "bg-brand-700",
  pre_joining: "bg-brand-900",
  joined: "bg-emerald-500",
};

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  active: "Active",
  on_hold: "On hold",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  hired: "Hired",
};

export const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  recruiter: "Recruiter",
  hiring_manager: "Hiring manager",
  reviewer: "Reviewer",
  interviewer: "Interviewer",
};

export const ROUND_KIND_LABEL: Record<string, string> = {
  ai_screening: "AI screening",
  ai_proctored: "AI proctored",
  human: "Live interview",
};

export const RECOMMENDATION_LABEL: Record<string, string> = {
  strong_hire: "Strong hire",
  hire: "Hire",
  lean_hire: "Lean hire",
  lean_no_hire: "Lean no hire",
  no_hire: "No hire",
};

export const DECISION_LABEL: Record<string, string> = {
  strong_yes: "Strong yes",
  yes: "Yes",
  maybe: "Maybe",
  no: "No",
};

/** Maps any status-like value to a Badge tone */
export function toneFor(
  value: string | null | undefined,
): "gray" | "blue" | "green" | "amber" | "red" | "violet" {
  switch (value) {
    case "open":
    case "active":
    case "sent":
    case "invited":
    case "scheduled":
    case "uploaded":
    case "in_progress":
    case "bgv_in_progress":
    case "collecting_documents":
    case "queued":
    case "sending":
      return "blue";
    case "filled":
    case "hired":
    case "joined":
    case "accepted":
    case "graded":
    case "evaluated":
    case "verified":
    case "cleared":
    case "bgv_cleared":
    case "completed":
    case "documents_submitted":
    case "strong_hire":
    case "hire":
    case "strong_yes":
    case "yes":
    case "strong_fit":
    case "good_fit":
      return "green";
    case "on_hold":
    case "negotiating":
    case "pending":
    case "started":
    case "submitted":
    case "maybe":
    case "lean_hire":
    case "partial_fit":
      return "amber";
    case "rejected":
    case "declined":
    case "failed":
    case "flagged":
    case "bgv_flagged":
    case "no":
    case "no_hire":
    case "lean_no_hire":
    case "poor_fit":
    case "dropped":
      return "red";
    default:
      return "gray";
  }
}

export function scoreTone(score: number | null | undefined): string {
  if (score === null || score === undefined) return "text-zinc-400";
  if (score >= 75) return "text-emerald-600";
  if (score >= 50) return "text-amber-600";
  return "text-red-600";
}
