import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  Briefcase,
  CalendarClock,
  Camera,
  Check,
  ClipboardCheck,
  Code2,
  FileSearch,
  FileText,
  Globe,
  Handshake,
  History,
  KeyRound,
  LayoutGrid,
  Mail,
  Menu as MenuIcon,
  MessageSquareText,
  Mic,
  MousePointerClick,
  PenLine,
  ShieldCheck,
  Sparkles,
  Upload,
  UserCheck,
  Users,
  Video,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { COMPANY_NAME } from "@/lib/format";
import { LogoMark } from "@/components/layout/Logo";
import { cx } from "@/components/ui";

/* ------------------------------------------------------------------ Content
 * Everything below describes features that exist in this product today.
 * No customer logos, usage numbers or testimonials — there are none to show.
 */

const JOURNEY = [
  { icon: <PenLine />, label: "Post a job" },
  { icon: <Globe />, label: "Careers page" },
  { icon: <FileSearch />, label: "Screen resumes" },
  { icon: <UserCheck />, label: "Team reviews" },
  { icon: <ClipboardCheck />, label: "Assessments" },
  { icon: <Video />, label: "Interviews" },
  { icon: <Handshake />, label: "Offers" },
  { icon: <ShieldCheck />, label: "Pre-joining" },
];

const MODULES: {
  icon: ReactNode;
  title: string;
  body: string;
  points: string[];
}[] = [
  {
    icon: <Briefcase />,
    title: "Jobs & requisitions",
    body: "Create a job with its openings, skills, experience range and work mode. Plan the interview rounds for that role in the same place.",
    points: [
      "Draft the job description with AI, then edit it yourself",
      "Mark skills as required or nice-to-have",
      "Open, pause, close or mark jobs as filled",
    ],
  },
  {
    icon: <Globe />,
    title: "Careers page",
    body: "Every open job is published to a clean public careers page. Candidates search by role, skill or location and apply in a couple of minutes.",
    points: [
      "Filter by remote, hybrid or on-site",
      "Resume upload in PDF or Word",
      "No candidate account or password needed",
    ],
  },
  {
    icon: <FileSearch />,
    title: "Resume screening",
    body: "Resumes are parsed into structured profiles and compared with the job, so each applicant gets a match score with the reasons behind it.",
    points: [
      "Strengths and gaps listed for every match",
      "Upload resumes in bulk for sourced candidates",
      "Re-run the match after a job changes",
    ],
  },
  {
    icon: <UserCheck />,
    title: "Team resume reviews",
    body: "Send shortlisted resumes to colleagues for a second opinion. Reviewers get a focused queue and record a clear decision.",
    points: [
      'Decisions from "strong yes" to "no", with notes',
      "Due dates so nothing sits waiting",
      "Every review stays on the candidate record",
    ],
  },
  {
    icon: <ClipboardCheck />,
    title: "Online assessments",
    body: "Build tests with choice, written and coding questions, or let AI generate a first draft. Answers are graded automatically.",
    points: [
      "Pass mark, time limit and question shuffling per test",
      "Browser proctoring with optional webcam",
      "Re-grade or resend invitations any time",
    ],
  },
  {
    icon: <Video />,
    title: "AI & live interviews",
    body: "Run an AI screening interview that adapts its questions, then schedule live rounds with your panel and collect structured feedback.",
    points: [
      "Candidates type or speak their answers",
      "Calendar invites for live rounds",
      "Full transcript and evaluation for AI rounds",
    ],
  },
  {
    icon: <Handshake />,
    title: "Offers & negotiation",
    body: "Prepare an offer with salary breakdown, benefits and terms. Candidates review it on a private page and can accept, decline or ask for changes.",
    points: [
      "Every revision is kept as a version",
      "Message thread for negotiation",
      "Withdraw or mark accepted when needed",
    ],
  },
  {
    icon: <ShieldCheck />,
    title: "Pre-joining & checks",
    body: "Once an offer is accepted, the new hire uploads the documents you ask for. Your team reviews each one and starts background verification.",
    points: [
      "Your own list of required documents",
      "Verify or reject each document",
      "Track verification with your vendors",
    ],
  },
];

type TabKey = "screen" | "assess" | "interview" | "offer";
const TABS: { key: TabKey; label: string; icon: ReactNode }[] = [
  { key: "screen", label: "Screening", icon: <FileSearch /> },
  { key: "assess", label: "Assessments", icon: <ClipboardCheck /> },
  { key: "interview", label: "Interviews", icon: <Video /> },
  { key: "offer", label: "Offers & onboarding", icon: <Handshake /> },
];

const DEEP: Record<
  TabKey,
  {
    title: string;
    intro: string;
    items: { title: string; body: string }[];
    visual: ReactNode;
  }
> = {
  screen: {
    title: "Start every day with the strongest applicants on top",
    intro:
      "When a resume arrives, through the careers page or your own upload, it's read and turned into a profile: experience, skills, current role and contact details. The profile is then compared with the job you're hiring for.",
    items: [
      {
        title: "A score you can question",
        body: "Each match shows a 0–100 score, a short summary, and the specific strengths and gaps it found. You can see why, not just a number.",
      },
      {
        title: "Board or list, your choice",
        body: "See every candidate for a job on a drag-and-drop pipeline board, sorted by match, or switch to a list view.",
      },
      {
        title: "Act on many at once",
        body: "Select several candidates to request reviews, shortlist, send a test, start interviews, move stage or reject in one step.",
      },
    ],
    visual: <MatchMock />,
  },
  assess: {
    title: "Test real skills, with integrity built in",
    intro:
      "Assessments are sent as a private link. Candidates take them in the browser, with no installs and no accounts, and answers are graded as soon as they submit.",
    items: [
      {
        title: "Five question types",
        body: "Single choice, multiple choice, short answer, long answer and code. Mix them freely in one test.",
      },
      {
        title: "AI-drafted question sets",
        body: "Describe what to test and get a draft set of questions to review, edit or discard before anyone sees them.",
      },
      {
        title: "Browser proctoring",
        body: "Records tab switches, leaving full-screen, copy and paste, right-clicks and camera status, then shows them alongside the result.",
      },
    ],
    visual: <AssessMock />,
  },
  interview: {
    title: "Screen at any hour, then meet the right people",
    intro:
      "Add AI screening rounds and live rounds to a job’s interview plan. AI rounds run whenever the candidate is ready; live rounds are scheduled with your panel.",
    items: [
      {
        title: "Adaptive AI interviews",
        body: "The AI interviewer asks follow-ups based on earlier answers. Candidates can type or speak, and proctored rounds can use the webcam.",
      },
      {
        title: "Evaluation you can read",
        body: "Each AI round ends with a score and a written evaluation, alongside the complete transcript.",
      },
      {
        title: "Structured panel feedback",
        body: 'Interviewers get calendar invites and a meeting link, then record a recommendation from "strong hire" to "no hire".',
      },
    ],
    visual: <InterviewMock />,
  },
  offer: {
    title: "Close the loop without leaving the workspace",
    intro:
      "Offers and pre-joining live next to the rest of the candidate’s history, so nobody has to dig through inboxes or spreadsheets to know where things stand.",
    items: [
      {
        title: "Clear offer pages",
        body: "Base, variable pay, joining bonus, equity, benefits and terms laid out on one private page the candidate can read on any device.",
      },
      {
        title: "Negotiation in writing",
        body: "Candidates can request changes; you reply in the thread and issue a revised version. Earlier versions stay on record.",
      },
      {
        title: "Documents and checks",
        body: "New hires upload what you ask for. Review each document, then send background verification requests and track their status.",
      },
    ],
    visual: <OfferMock />,
  },
};

const ROLES: { title: string; body: string; icon: ReactNode }[] = [
  {
    icon: <Briefcase />,
    title: "Recruiters",
    body: "Run everything: jobs, candidates, tests, interviews, offers, pre-joining, email templates and workspace settings.",
  },
  {
    icon: <Users />,
    title: "Hiring managers",
    body: "Follow their own jobs and pipelines, review candidates, see results and take part in interviews and offers.",
  },
  {
    icon: <FileSearch />,
    title: "Reviewers",
    body: "Get a simple queue of resumes to assess, with the job context and the resume side by side.",
  },
  {
    icon: <MessageSquareText />,
    title: "Interviewers",
    body: "See only the rounds they’re on, join the meeting, and submit feedback when they’re done.",
  },
];

const CANDIDATE: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <Globe />,
    title: "Find a role",
    body: "A searchable careers page that works on phones as well as laptops.",
  },
  {
    icon: <Upload />,
    title: "Apply in minutes",
    body: "Upload a resume, add contact details, done. No account to create.",
  },
  {
    icon: <Mail />,
    title: "Hear back by email",
    body: "Every next step arrives as an email with a private, secure link.",
  },
  {
    icon: <BadgeCheck />,
    title: "Respond on any device",
    body: "Take a test, do an interview, read an offer or upload documents.",
  },
];

const DETAILS: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <Sparkles />,
    title: "AI that assists, people who decide",
    body: "Match scores, evaluations and drafts are suggestions. Your team can re-run, re-grade, edit or override them.",
  },
  {
    icon: <History />,
    title: "A timeline for every candidate",
    body: "Applications, stage changes, reviews, test scores, interviews and offers appear in one activity feed.",
  },
  {
    icon: <Mail />,
    title: "Email log with retry",
    body: "See every email the system sent and whether it went out or failed. Retry a failed send in one click.",
  },
  {
    icon: <PenLine />,
    title: "Editable email templates",
    body: "Adjust the wording of invitations and updates, or draft a one-off email with AI help.",
  },
  {
    icon: <CalendarClock />,
    title: "Calendar invites",
    body: "Live interview rounds send calendar invitations to candidates and panelists.",
  },
  {
    icon: <KeyRound />,
    title: "Invite-only access",
    body: "Team members join by invitation and only see what their role allows.",
  },
];

/* ------------------------------------------------------------------ Page */
export default function Landing() {
  const { session } = useAuth();
  const [tab, setTab] = useState<TabKey>("screen");
  const [menu, setMenu] = useState(false);
  const deep = DEEP[tab];

  const primaryCta = session ? (
    <CtaLink to="/" variant="primary">
      Open your workspace <ArrowRight className="size-4" />
    </CtaLink>
  ) : (
    <CtaLink to="/login" variant="primary">
      Sign in to cats <ArrowRight className="size-4" />
    </CtaLink>
  );

  return (
    <div className="min-h-full bg-zinc-50 text-zinc-900">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-zinc-200/80 bg-zinc-50/95">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-4 sm:px-6">
          <Link to="/welcome" className="flex items-center gap-2.5">
            <LogoMark className="size-7" />
            <span className="text-[17px] font-semibold tracking-tight">
              cats
            </span>
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-zinc-600 md:flex">
            <a href="#modules" className="hover:text-zinc-900">
              Features
            </a>
            <a href="#how" className="hover:text-zinc-900">
              How it works
            </a>
            <a href="#teams" className="hover:text-zinc-900">
              For your team
            </a>
            <a href="#candidates" className="hover:text-zinc-900">
              For candidates
            </a>
          </nav>
          <div className="ml-auto hidden items-center gap-2 md:flex">
            <CtaLink to="/careers" variant="ghost">
              Careers
            </CtaLink>
            {session ? (
              <CtaLink to="/" variant="primary" size="sm">
                Open workspace
              </CtaLink>
            ) : (
              <CtaLink to="/login" variant="primary" size="sm">
                Sign in
              </CtaLink>
            )}
          </div>
          <button
            aria-label={menu ? "Close menu" : "Open menu"}
            className="ml-auto cursor-pointer rounded-lg p-2 text-zinc-700 hover:bg-zinc-200/60 md:hidden"
            onClick={() => setMenu((m) => !m)}
          >
            {menu ? <X className="size-5" /> : <MenuIcon className="size-5" />}
          </button>
        </div>
        {menu && (
          <div className="border-t border-zinc-200 bg-zinc-50 px-4 py-3 md:hidden">
            {[
              ["#modules", "Features"],
              ["#how", "How it works"],
              ["#teams", "For your team"],
              ["#candidates", "For candidates"],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                onClick={() => setMenu(false)}
                className="block rounded-lg px-2 py-2.5 text-[15px] text-zinc-700 hover:bg-zinc-100"
              >
                {label}
              </a>
            ))}
            <div className="mt-2 grid grid-cols-2 gap-2 border-t border-zinc-200 pt-3">
              <CtaLink to="/careers" variant="outline">
                Careers
              </CtaLink>
              <CtaLink to={session ? "/" : "/login"} variant="primary">
                {session ? "Workspace" : "Sign in"}
              </CtaLink>
            </div>
          </div>
        )}
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-14 pb-16 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:pt-20 lg:pb-24">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1 text-[13px] text-zinc-600">
              <span className="size-1.5 rounded-full bg-brand-500" />
              Recruiting software for in-house hiring teams
            </p>
            <h1 className="font-display mt-6 text-[44px] leading-[1.05] font-normal text-zinc-900 sm:text-[58px]">
              Hire well, from the first application to the first day.
            </h1>
            <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-zinc-600">
              cats brings job posts, resume screening, team reviews,
              assessments, interviews, offers and pre-joining paperwork into one
              workspace, with AI doing the first read so your team can spend its
              time on people.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {primaryCta}
              <CtaLink to="/careers" variant="outline">
                Browse open roles
              </CtaLink>
            </div>
            <p className="mt-5 text-[13px] text-zinc-500">
              Looking for a job? The careers page is open to everyone. No
              sign-up needed.
            </p>
          </div>
          <HeroBoard />
        </div>
      </section>

      {/* Journey strip */}
      <section
        id="how"
        className="scroll-mt-16 border-y border-zinc-200 bg-white"
      >
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <p className="text-center text-sm font-medium text-zinc-500">
            One workspace covers every step of the journey
          </p>
          <ol className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8 lg:gap-0">
            {JOURNEY.map((s, i) => (
              <li
                key={s.label}
                className="relative flex flex-col items-center gap-2.5 text-center"
              >
                {i < JOURNEY.length - 1 && (
                  <span
                    aria-hidden
                    className="absolute top-5 left-[calc(50%+26px)] hidden h-px w-[calc(100%-52px)] bg-zinc-200 lg:block"
                  />
                )}
                <span className="flex size-10 items-center justify-center rounded-full border border-zinc-200 bg-zinc-50 text-brand-700 [&_svg]:size-[18px]">
                  {s.icon}
                </span>
                <span className="text-[13px] font-medium text-zinc-700">
                  <span className="tabular mr-1 text-zinc-400">{i + 1}.</span>
                  {s.label}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Modules */}
      <section id="modules" className="scroll-mt-16">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
          <SectionHead
            eyebrow="Features"
            title="Eight modules, one candidate record"
            body="Each part of hiring has its own module, and they all share the same candidate. Move someone forward and the next step is ready."
          />
          <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-200 sm:grid-cols-2 lg:grid-cols-4">
            {MODULES.map((m) => (
              <div key={m.title} className="flex flex-col bg-white p-6">
                <span className="flex size-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700 [&_svg]:size-[18px]">
                  {m.icon}
                </span>
                <h3 className="mt-5 text-[16px] font-semibold text-zinc-900">
                  {m.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600">
                  {m.body}
                </p>
                <ul className="mt-4 space-y-2 border-t border-zinc-100 pt-4">
                  {m.points.map((p) => (
                    <li
                      key={p}
                      className="flex gap-2 text-[13px] leading-snug text-zinc-600"
                    >
                      <Check className="mt-0.5 size-3.5 shrink-0 text-brand-600" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Deep dive tabs */}
      <section className="border-y border-zinc-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
          <SectionHead
            eyebrow="A closer look"
            title="What each step actually does"
          />
          <div
            role="tablist"
            className="scroll-thin mx-auto mt-10 flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border border-zinc-200 bg-zinc-100 p-1"
          >
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cx(
                  "flex shrink-0 cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium whitespace-nowrap transition [&_svg]:size-4",
                  tab === t.key
                    ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-900/5 [&_svg]:text-brand-600"
                    : "text-zinc-500 hover:text-zinc-900",
                )}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
          <div
            key={tab}
            className="page-in mt-12 grid items-start gap-12 lg:grid-cols-2"
          >
            <div>
              <h3 className="font-display text-[32px] leading-tight font-normal text-zinc-900">
                {deep.title}
              </h3>
              <p className="mt-4 text-[16px] leading-relaxed text-zinc-600">
                {deep.intro}
              </p>
              <dl className="mt-8 space-y-6">
                {deep.items.map((it) => (
                  <div
                    key={it.title}
                    className="border-l-2 border-brand-200 pl-4"
                  >
                    <dt className="text-[15px] font-semibold text-zinc-900">
                      {it.title}
                    </dt>
                    <dd className="mt-1 text-sm leading-relaxed text-zinc-600">
                      {it.body}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 sm:p-8">
              {deep.visual}
            </div>
          </div>
        </div>
      </section>

      {/* Roles */}
      <section id="teams" className="scroll-mt-16">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
          <SectionHead
            eyebrow="For your team"
            title="Everyone sees what they need, and nothing they don't"
            body="People are invited with a role. The menu and the data they can open follow from that role, so occasional users aren't faced with a wall of options."
          />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ROLES.map((r) => (
              <div
                key={r.title}
                className="rounded-xl border border-zinc-200 bg-white p-6"
              >
                <span className="text-zinc-400 [&_svg]:size-5">{r.icon}</span>
                <h3 className="mt-4 text-[16px] font-semibold">{r.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600">
                  {r.body}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-16 grid gap-x-10 gap-y-8 border-t border-zinc-200 pt-12 sm:grid-cols-2 lg:grid-cols-3">
            {DETAILS.map((d) => (
              <div key={d.title} className="flex gap-4">
                <span className="mt-0.5 shrink-0 text-brand-600 [&_svg]:size-5">
                  {d.icon}
                </span>
                <div>
                  <h3 className="text-[15px] font-semibold">{d.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-600">
                    {d.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Candidate experience */}
      <section
        id="candidates"
        className="scroll-mt-16 bg-brand-900 text-brand-50"
      >
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.2fr] lg:py-24">
          <div>
            <p className="text-sm font-medium text-brand-300">For candidates</p>
            <h2 className="font-display mt-3 text-[36px] leading-tight font-normal text-white sm:text-[44px]">
              A process that respects the applicant's time.
            </h2>
            <p className="mt-5 max-w-md text-[16px] leading-relaxed text-brand-100/85">
              Candidates never need an account or a password. Each step arrives
              by email as a private link that opens straight into the right
              page, whether they're on a phone or a laptop.
            </p>
            <Link
              to="/careers"
              className="mt-8 inline-flex h-11 items-center gap-2 rounded-lg bg-white px-5 text-[15px] font-medium text-brand-900 transition-colors hover:bg-brand-50"
            >
              See open roles at {COMPANY_NAME} <ArrowRight className="size-4" />
            </Link>
          </div>
          <ol className="grid gap-px overflow-hidden rounded-2xl bg-white/10 sm:grid-cols-2">
            {CANDIDATE.map((c, i) => (
              <li
                key={c.title}
                className="bg-brand-900 p-6 ring-1 ring-white/10"
              >
                <div className="flex items-center justify-between">
                  <span className="text-brand-300 [&_svg]:size-5">
                    {c.icon}
                  </span>
                  <span className="tabular text-sm text-brand-300/70">
                    0{i + 1}
                  </span>
                </div>
                <h3 className="mt-6 text-[16px] font-semibold text-white">
                  {c.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-brand-100/80">
                  {c.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Closing CTA */}
      <section>
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
          <div className="grid items-center gap-8 rounded-2xl border border-zinc-200 bg-white p-8 sm:p-12 lg:grid-cols-[1.4fr_1fr]">
            <div>
              <h2 className="font-display text-[32px] leading-tight font-normal sm:text-[40px]">
                Ready when your team is.
              </h2>
              <p className="mt-3 max-w-lg text-[16px] leading-relaxed text-zinc-600">
                Team members sign in with an invitation from their workspace
                admin. Candidates can go straight to the careers page.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
              {primaryCta}
              <CtaLink to="/careers" variant="outline">
                Browse open roles
              </CtaLink>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-200">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2.5">
            <LogoMark className="size-6" />
            <span className="font-medium text-zinc-700">cats</span>
            {COMPANY_NAME !== "cats" && <span>· {COMPANY_NAME}</span>}
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2">
            <a href="#modules" className="hover:text-zinc-900">
              Features
            </a>
            <a href="#candidates" className="hover:text-zinc-900">
              For candidates
            </a>
            <Link to="/careers" className="hover:text-zinc-900">
              Careers
            </Link>
            <Link to="/login" className="hover:text-zinc-900">
              Sign in
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ Building blocks */
function CtaLink({
  to,
  children,
  variant,
  size = "lg",
}: {
  to: string;
  children: ReactNode;
  variant: "primary" | "outline" | "ghost";
  size?: "sm" | "lg";
}) {
  return (
    <Link
      to={to}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors",
        size === "lg" ? "h-11 px-5 text-[15px]" : "h-9 px-4 text-sm",
        variant === "primary" && "bg-brand-600 text-white hover:bg-brand-700",
        variant === "outline" &&
          "border border-zinc-300 bg-white text-zinc-800 hover:border-zinc-400 hover:bg-zinc-50",
        variant === "ghost" &&
          "h-9 px-3 text-sm text-zinc-700 hover:bg-zinc-200/60",
      )}
    >
      {children}
    </Link>
  );
}

function SectionHead({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body?: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-medium text-brand-700">{eyebrow}</p>
      <h2 className="font-display mt-3 text-[34px] leading-tight font-normal text-zinc-900 sm:text-[42px]">
        {title}
      </h2>
      {body && (
        <p className="mt-4 text-[16px] leading-relaxed text-zinc-600">{body}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Illustrative UI previews (sample data) */
function Frame({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cx(
        "overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg select-none",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-2.5">
        <span className="size-2 rounded-full bg-zinc-300" />
        <span className="size-2 rounded-full bg-zinc-300" />
        <span className="size-2 rounded-full bg-zinc-300" />
        <span className="ml-2 text-xs text-zinc-500">{title}</span>
      </div>
      {children}
    </div>
  );
}

function MiniAvatar({ name, tone }: { name: string; tone: string }) {
  return (
    <span
      className={cx(
        "flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
        tone,
      )}
    >
      {name}
    </span>
  );
}

function Score({ n }: { n: number }) {
  return (
    <span
      className={cx(
        "tabular rounded px-1.5 py-0.5 text-[11px] font-semibold",
        n >= 75
          ? "bg-emerald-50 text-emerald-700"
          : n >= 50
            ? "bg-amber-50 text-amber-700"
            : "bg-red-50 text-red-700",
      )}
    >
      {n}
    </span>
  );
}

function HeroBoard() {
  const cols: {
    name: string;
    dot: string;
    cards: [string, string, string, number][];
  }[] = [
    {
      name: "Applied",
      dot: "bg-zinc-300",
      cards: [
        ["AK", "Backend engineer", "bg-sky-100 text-sky-800", 81],
        ["RM", "Backend engineer", "bg-amber-100 text-amber-800", 64],
        ["JT", "Backend engineer", "bg-rose-100 text-rose-700", 42],
      ],
    },
    {
      name: "Resume review",
      dot: "bg-brand-200",
      cards: [
        ["SN", "Backend engineer", "bg-violet-100 text-violet-800", 88],
        ["DP", "Backend engineer", "bg-emerald-100 text-emerald-800", 72],
      ],
    },
    {
      name: "Assessment",
      dot: "bg-brand-400",
      cards: [["LC", "Backend engineer", "bg-brand-100 text-brand-800", 79]],
    },
    {
      name: "Interviews",
      dot: "bg-brand-600",
      cards: [["MV", "Backend engineer", "bg-zinc-200 text-zinc-700", 91]],
    },
  ];
  return (
    <div className="relative">
      <Frame title="Jobs › Backend engineer › Pipeline">
        <div className="flex gap-3 overflow-hidden bg-zinc-50/60 p-4">
          {cols.map((c) => (
            <div
              key={c.name}
              className="w-40 shrink-0 rounded-lg bg-zinc-100/80 p-2 sm:w-44"
            >
              <div className="mb-2 flex items-center gap-1.5 px-1">
                <span className={cx("size-1.5 rounded-full", c.dot)} />
                <span className="text-[11px] font-semibold text-zinc-700">
                  {c.name}
                </span>
                <span className="ml-auto text-[10px] text-zinc-400">
                  {c.cards.length}
                </span>
              </div>
              <div className="space-y-1.5">
                {c.cards.map(([ini, role, tone, score]) => (
                  <div
                    key={ini}
                    className="rounded-md border border-zinc-200 bg-white p-2"
                  >
                    <div className="flex items-center gap-2">
                      <MiniAvatar name={ini} tone={tone} />
                      <div className="min-w-0 flex-1">
                        <div className="h-1.5 w-14 rounded-full bg-zinc-300" />
                        <p className="mt-1 truncate text-[10px] text-zinc-400">
                          {role}
                        </p>
                      </div>
                      <Score n={score} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Frame>
      <div className="absolute -bottom-6 left-4 hidden w-64 rounded-xl border border-zinc-200 bg-white p-4 shadow-xl sm:block lg:-left-8">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-zinc-800">
          <Sparkles className="size-3.5 text-violet-600" /> Fit with this job
          <span className="ml-auto">
            <Score n={88} />
          </span>
        </div>
        <ul className="mt-2.5 space-y-1.5 text-[11px] text-zinc-600">
          <li className="flex gap-1.5">
            <Check className="mt-px size-3 shrink-0 text-emerald-600" /> 5 years
            building REST and event-driven services
          </li>
          <li className="flex gap-1.5">
            <Check className="mt-px size-3 shrink-0 text-emerald-600" /> Has run
            PostgreSQL in production
          </li>
          <li className="flex gap-1.5">
            <span className="mt-px size-3 shrink-0 text-center leading-3 font-bold text-amber-600">
              !
            </span>{" "}
            No Kubernetes experience listed
          </li>
        </ul>
      </div>
    </div>
  );
}

function MatchMock() {
  return (
    <Frame title="Candidate › Resume match">
      <div className="space-y-4 p-5">
        <div className="flex items-center gap-4">
          <div className="relative size-14">
            <svg viewBox="0 0 36 36" className="size-14 -rotate-90">
              <circle
                cx="18"
                cy="18"
                r="15"
                fill="none"
                strokeWidth="3.5"
                style={{ stroke: "var(--color-zinc-100)" }}
              />
              <circle
                cx="18"
                cy="18"
                r="15"
                fill="none"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeDasharray="94.2"
                strokeDashoffset="18.8"
                style={{ stroke: "var(--color-emerald-500)" }}
              />
            </svg>
            <span className="tabular absolute inset-0 flex items-center justify-center text-sm font-semibold">
              80
            </span>
          </div>
          <div>
            <p className="text-sm font-semibold">Strong fit</p>
            <p className="text-xs text-zinc-500">
              Matches 6 of 7 required skills; experience within range.
            </p>
          </div>
        </div>
        <div className="grid gap-4 border-t border-zinc-100 pt-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold text-emerald-700">Strengths</p>
            <ul className="mt-1.5 space-y-1 text-xs text-zinc-600">
              <li>• Led a team of four on a payments product</li>
              <li>• TypeScript and Node.js across recent roles</li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold text-amber-700">Gaps</p>
            <ul className="mt-1.5 space-y-1 text-xs text-zinc-600">
              <li>• No cloud certification mentioned</li>
              <li>• Notice period not stated</li>
            </ul>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 border-t border-zinc-100 pt-4">
          {["Request review", "Shortlist", "Send test", "Start interviews"].map(
            (a, i) => (
              <span
                key={a}
                className={cx(
                  "rounded-md px-2.5 py-1 text-[11px] font-medium",
                  i === 1
                    ? "bg-brand-600 text-white"
                    : "border border-zinc-200 text-zinc-700",
                )}
              >
                {a}
              </span>
            ),
          )}
        </div>
      </div>
    </Frame>
  );
}

function AssessMock() {
  const signals: [ReactNode, string, string][] = [
    [<LayoutGrid key="a" />, "Tab switches", "1"],
    [<MousePointerClick key="b" />, "Copy / paste attempts", "0"],
    [<ShieldCheck key="c" />, "Left full-screen", "0"],
    [<Camera key="d" />, "Camera", "On throughout"],
  ];
  return (
    <div className="space-y-4">
      <Frame title="Assessment › Question 4 of 12">
        <div className="p-5">
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <Code2 className="size-3.5" /> Code · 10 points
            <span className="tabular ml-auto rounded bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-700">
              18:42 left
            </span>
          </div>
          <p className="mt-3 text-sm font-medium text-zinc-900">
            Write a function that returns the first non-repeating character in a
            string.
          </p>
          <pre className="mt-3 overflow-hidden rounded-lg bg-zinc-900 p-3 font-mono text-[11px] leading-relaxed text-zinc-200">
            {`function firstUnique(s) {\n  const seen = new Map();\n  for (const c of s) seen.set(c, (seen.get(c) ?? 0) + 1);\n  …`}
          </pre>
        </div>
      </Frame>
      <Frame title="Result › Integrity signals">
        <ul className="divide-y divide-zinc-100 text-xs">
          {signals.map(([icon, l, v]) => (
            <li
              key={l}
              className="flex items-center gap-2.5 px-5 py-2.5 text-zinc-600 [&_svg]:size-3.5 [&_svg]:text-zinc-400"
            >
              {icon}
              {l}
              <span className="ml-auto font-medium text-zinc-900">{v}</span>
            </li>
          ))}
        </ul>
      </Frame>
    </div>
  );
}

function InterviewMock() {
  return (
    <Frame title="AI screening round">
      <div className="space-y-3 p-5 text-xs">
        <div className="flex gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700">
            <Sparkles className="size-3" />
          </span>
          <p className="rounded-lg rounded-tl-sm bg-zinc-100 px-3 py-2 text-zinc-800">
            You mentioned migrating a service to queues. What problem were you
            solving, and how did you measure it?
          </p>
        </div>
        <div className="flex justify-end">
          <p className="max-w-[85%] rounded-lg rounded-tr-sm bg-brand-600 px-3 py-2 text-white">
            Our order service timed out under peak load. We moved writes to a
            queue and tracked p95 latency before and after…
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-zinc-400">
          <Mic className="size-3.5 text-brand-600" /> Type or speak your answer…
        </div>
        <div className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-zinc-800">
              Panel feedback · Round 2
            </span>
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">
              Hire
            </span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-zinc-500">
            <CalendarClock className="size-3.5" /> Calendar invite sent to
            candidate and 2 panelists
          </div>
        </div>
      </div>
    </Frame>
  );
}

function OfferMock() {
  return (
    <div className="space-y-4">
      <Frame title="Offer › Version 2">
        <div className="p-5">
          <p className="text-[11px] text-zinc-500">Senior backend engineer</p>
          <p className="tabular mt-1 text-2xl font-semibold tracking-tight">
            ₹32,00,000{" "}
            <span className="text-xs font-normal text-zinc-500">
              annual CTC
            </span>
          </p>
          <div className="mt-4 grid grid-cols-3 divide-x divide-zinc-100 rounded-lg border border-zinc-200 text-[11px]">
            {[
              ["Base", "₹28,00,000"],
              ["Variable", "₹4,00,000"],
              ["Joining bonus", "₹1,50,000"],
            ].map(([l, v]) => (
              <div key={l} className="px-3 py-2">
                <p className="text-zinc-500">{l}</p>
                <p className="tabular font-semibold text-zinc-900">{v}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 text-[11px] text-zinc-500">
            <MessageSquareText className="size-3.5" /> Candidate asked about the
            joining date · replied
          </div>
        </div>
      </Frame>
      <Frame title="Pre-joining › Documents">
        <ul className="divide-y divide-zinc-100 text-xs">
          {[
            ["ID proof", "Verified", "text-emerald-700 bg-emerald-50"],
            ["Address proof", "Verified", "text-emerald-700 bg-emerald-50"],
            ["Last 3 payslips", "Uploaded", "text-sky-700 bg-sky-50"],
            [
              "Background verification",
              "Sent to vendor",
              "text-amber-700 bg-amber-50",
            ],
          ].map(([l, s, t]) => (
            <li
              key={l}
              className="flex items-center gap-2.5 px-5 py-2.5 text-zinc-700"
            >
              <FileText className="size-3.5 text-zinc-400" />
              {l}
              <span
                className={cx(
                  "ml-auto rounded px-1.5 py-0.5 text-[11px] font-medium",
                  t,
                )}
              >
                {s}
              </span>
            </li>
          ))}
        </ul>
      </Frame>
      <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
        <Bell className="size-3" /> Sample data shown for illustration.
      </p>
    </div>
  );
}
