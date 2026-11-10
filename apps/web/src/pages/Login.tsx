import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { Mail } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { COMPANY_NAME } from "@/lib/format";
import { Button, Field, Input, Segmented } from "@/components/ui";
import { Logo, LogoMark } from "@/components/layout/Logo";

const STEPS = [
  {
    title: "Post a job",
    body: "Write it yourself or start from a draft. Share one link with candidates.",
  },
  {
    title: "Review applicants",
    body: "Resumes are read and ranked against the role, so you start with the best fits.",
  },
  {
    title: "Test and interview",
    body: "Send assessments, run interviews and collect feedback in one place.",
  },
  {
    title: "Offer and onboard",
    body: "Send the offer, collect documents and run checks before day one.",
  },
];

export default function Login() {
  const { session, loading } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [isRecovery] = useState(
    () =>
      window.location.hash.includes("type=invite") ||
      window.location.hash.includes("type=recovery"),
  );
  const [newPassword, setNewPassword] = useState("");

  const from = (location.state as { from?: string } | null)?.from ?? "/";

  if (!loading && session && !isRecovery) return <Navigate to={from} replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "password") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: `${window.location.origin}/login`,
            shouldCreateUser: false,
          },
        });
        if (error) throw error;
        setSent(true);
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setPasswordForInvite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Password set. Welcome aboard!");
    window.location.replace("/");
  }

  return (
    <div className="grid min-h-full bg-zinc-50 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="hidden bg-brand-900 p-12 text-brand-50 lg:flex lg:flex-col lg:justify-between xl:p-16">
        <div className="flex items-center gap-2.5">
          <LogoMark inverted />
          <span className="text-[15px] font-semibold tracking-tight">cats</span>
        </div>
        <div className="max-w-md">
          <h1 className="font-display text-[44px] leading-[1.08] font-normal text-white">
            From job post to first day, in one calm place.
          </h1>
          <ol className="mt-12 space-y-6">
            {STEPS.map((s, i) => (
              <li key={s.title} className="grid grid-cols-[2rem_1fr] gap-x-3">
                <span className="tabular pt-0.5 text-sm text-brand-300">
                  0{i + 1}
                </span>
                <div>
                  <p className="text-[15px] font-medium text-white">
                    {s.title}
                  </p>
                  <p className="mt-0.5 text-sm leading-relaxed text-brand-200/80">
                    {s.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <p className="text-xs text-brand-300/80">
          {COMPANY_NAME} · Talent acquisition
        </p>
      </div>

      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <Logo />
          </div>
          {isRecovery && session ? (
            <form onSubmit={setPasswordForInvite} className="space-y-5">
              <div>
                <h2 className="font-display text-3xl font-medium text-zinc-900">
                  Set your password
                </h2>
                <p className="mt-2 text-[15px] text-zinc-500">
                  You were invited to cats. Choose a password to finish setting
                  up your account.
                </p>
              </div>
              <Field label="New password" hint="At least 8 characters.">
                <Input
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoFocus
                />
              </Field>
              <Button type="submit" className="w-full" size="lg" loading={busy}>
                Save & continue
              </Button>
            </form>
          ) : sent ? (
            <div className="text-center">
              <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                <Mail className="size-6" />
              </div>
              <h2 className="font-display text-3xl font-medium text-zinc-900">
                Check your inbox
              </h2>
              <p className="mt-2 text-[15px] text-zinc-500">
                We sent a sign-in link to{" "}
                <span className="font-medium text-zinc-800">{email}</span>. It
                may take a minute to arrive.
              </p>
              <Button
                variant="ghost"
                className="mt-6"
                onClick={() => setSent(false)}
              >
                Use a different email
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-5">
              <div>
                <h2 className="font-display text-3xl font-medium text-zinc-900">
                  Welcome back
                </h2>
                <p className="mt-2 text-[15px] text-zinc-500">
                  Sign in to your recruiting workspace.
                </p>
              </div>
              <Segmented
                value={mode}
                onChange={setMode}
                options={[
                  { value: "password", label: "Password" },
                  { value: "magic", label: "Email me a link" },
                ]}
              />
              {mode === "magic" && (
                <p className="-mt-2 text-[13px] text-zinc-500">
                  No password needed — we'll email you a one-time sign-in link.
                </p>
              )}
              <Field label="Work email">
                <Input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  autoFocus
                />
              </Field>
              {mode === "password" && (
                <Field label="Password">
                  <Input
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
              )}
              <Button type="submit" className="w-full" size="lg" loading={busy}>
                {mode === "password" ? "Sign in" : "Send sign-in link"}
              </Button>
              <p className="border-t border-zinc-200 pt-5 text-[13px] leading-relaxed text-zinc-500">
                Access is by invitation only. Need an account? Ask your
                workspace admin to invite you. On a brand-new workspace, the
                first person to sign in becomes the admin.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
