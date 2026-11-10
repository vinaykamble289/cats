import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Briefcase,
  ChevronsUpDown,
  ClipboardCheck,
  FileSearch,
  Handshake,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu as MenuIcon,
  Settings,
  ShieldCheck,
  Users,
  Video,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { COMPANY_NAME, ROLE_LABEL } from "@/lib/format";
import type { Role } from "@/lib/types";
import { Avatar, Menu, cx } from "../ui";
import { Logo } from "./Logo";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  roles?: Role[]; // undefined = everyone
}

const NAV: { section?: string; items: NavItem[] }[] = [
  {
    items: [
      { to: "/", label: "Home", icon: <LayoutDashboard /> },
      {
        to: "/jobs",
        label: "Jobs",
        icon: <Briefcase />,
        roles: ["recruiter", "hiring_manager"],
      },
      {
        to: "/candidates",
        label: "Candidates",
        icon: <Users />,
        roles: ["recruiter", "hiring_manager"],
      },
      { to: "/reviews", label: "Resume reviews", icon: <FileSearch /> },
    ],
  },
  {
    section: "Hiring steps",
    items: [
      {
        to: "/assessments",
        label: "Assessments",
        icon: <ClipboardCheck />,
        roles: ["recruiter", "hiring_manager"],
      },
      {
        to: "/interviews",
        label: "Interviews",
        icon: <Video />,
        roles: ["recruiter", "hiring_manager", "interviewer"],
      },
      {
        to: "/offers",
        label: "Offers",
        icon: <Handshake />,
        roles: ["recruiter", "hiring_manager"],
      },
      {
        to: "/onboarding",
        label: "Pre-joining & checks",
        icon: <ShieldCheck />,
        roles: ["recruiter"],
      },
    ],
  },
  {
    section: "Workspace",
    items: [
      {
        to: "/emails",
        label: "Sent emails",
        icon: <Mail />,
        roles: ["recruiter"],
      },
      {
        to: "/settings",
        label: "Settings",
        icon: <Settings />,
        roles: ["recruiter"],
      },
    ],
  },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { me, hasRole, signOut } = useAuth();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5">
        <Logo
          subtitle={
            COMPANY_NAME !== "cats" ? COMPANY_NAME : "Recruiting workspace"
          }
        />
      </div>
      <nav
        aria-label="Main"
        className="scroll-thin flex-1 space-y-6 overflow-y-auto px-3 pt-3 pb-4"
      >
        {NAV.map((group, gi) => {
          const items = group.items.filter(
            (i) => !i.roles || hasRole(...i.roles),
          );
          if (!items.length) return null;
          return (
            <div key={gi}>
              {group.section && (
                <p className="mb-1 px-3 text-xs font-medium text-zinc-400">
                  {group.section}
                </p>
              )}
              <div className="space-y-px">
                {items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cx(
                        "group flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors [&_svg]:size-[18px] [&_svg]:shrink-0",
                        isActive
                          ? "bg-white text-zinc-900 shadow-xs ring-1 ring-zinc-900/[0.07] [&_svg]:text-brand-600"
                          : "text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-900 [&_svg]:text-zinc-400 hover:[&_svg]:text-zinc-600",
                      )
                    }
                  >
                    {item.icon}
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-zinc-200 p-3">
        <Menu
          align="left"
          trigger={
            <button className="flex w-full cursor-pointer items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-zinc-200/50">
              <Avatar name={me?.fullName || me?.email} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-900">
                  {me?.fullName || me?.email}
                </p>
                <p className="truncate text-xs text-zinc-500">
                  {me ? ROLE_LABEL[me.role] : ""}
                </p>
              </div>
              <ChevronsUpDown className="size-4 shrink-0 text-zinc-400" />
            </button>
          }
          items={[
            {
              label: "Sign out",
              icon: <LogOut />,
              onClick: () => void signOut(),
            },
          ]}
        />
      </div>
    </div>
  );
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const section = location.pathname.split("/")[1];

  // Close the mobile drawer whenever the route changes (incl. back/forward).
  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <div className="flex h-full">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-white px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <aside className="hidden w-60 shrink-0 border-r border-zinc-200 bg-zinc-100/70 lg:block">
        <Sidebar />
      </aside>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <div
            className="absolute inset-0 bg-zinc-950/30"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-zinc-50 shadow-xl">
            <button
              aria-label="Close menu"
              className="absolute top-4 right-3 cursor-pointer rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-200/60"
              onClick={() => setMobileOpen(false)}
            >
              <X className="size-5" />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50/95 px-4 lg:hidden">
          <Logo />
          <button
            aria-label="Open menu"
            className="cursor-pointer rounded-lg p-2 text-zinc-700 hover:bg-zinc-200/60"
            onClick={() => setMobileOpen(true)}
          >
            <MenuIcon className="size-5" />
          </button>
        </header>
        <main
          id="main"
          key={section}
          className="page-in flex-1 overflow-y-auto"
        >
          <div className="mx-auto max-w-[1320px] px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
