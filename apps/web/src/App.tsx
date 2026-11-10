import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import type { Role } from '@/lib/types';
import { AppShell } from '@/components/layout/AppShell';
import { Button, PageLoader } from '@/components/ui';
import Login from '@/pages/Login';

const Landing = lazy(() => import('@/pages/Landing'));

// HR workspace
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const JobsList = lazy(() => import('@/pages/jobs/JobsList'));
const JobForm = lazy(() => import('@/pages/jobs/JobForm'));
const JobDetail = lazy(() => import('@/pages/jobs/JobDetail'));
const CandidatesList = lazy(() => import('@/pages/candidates/CandidatesList'));
const CandidateDetail = lazy(() => import('@/pages/candidates/CandidateDetail'));
const ReviewQueue = lazy(() => import('@/pages/reviews/ReviewQueue'));
const TestsList = lazy(() => import('@/pages/assessments/TestsList'));
const TestDetail = lazy(() => import('@/pages/assessments/TestDetail'));
const InvitationResult = lazy(() => import('@/pages/assessments/InvitationResult'));
const InterviewsList = lazy(() => import('@/pages/interviews/InterviewsList'));
const RoundDetail = lazy(() => import('@/pages/interviews/RoundDetail'));
const OffersList = lazy(() => import('@/pages/offers/OffersList'));
const OfferDetail = lazy(() => import('@/pages/offers/OfferDetail'));
const OnboardingList = lazy(() => import('@/pages/onboarding/OnboardingList'));
const CaseDetail = lazy(() => import('@/pages/onboarding/CaseDetail'));
const EmailsPage = lazy(() => import('@/pages/emails/EmailsPage'));
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'));

// Candidate-facing
const CareersList = lazy(() => import('@/pages/public/CareersList'));
const CareerApply = lazy(() => import('@/pages/public/CareerApply'));
const AssessmentPortal = lazy(() => import('@/pages/public/AssessmentPortal'));
const InterviewPortal = lazy(() => import('@/pages/public/InterviewPortal'));
const OfferPortal = lazy(() => import('@/pages/public/OfferPortal'));
const OnboardingPortal = lazy(() => import('@/pages/public/OnboardingPortal'));

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading, error, signOut } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader />;
  // Visitors who aren't signed in see the public landing page at the site root.
  if (!session && location.pathname === '/') return <Landing />;
  if (!session) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (error)
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <ShieldAlert className="mx-auto mb-3 size-10 text-amber-500" />
          <h1 className="text-lg font-semibold">Access not available</h1>
          <p className="mt-1 text-sm text-zinc-500">{error.message}</p>
          <Button variant="outline" className="mt-4" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    );
  return <>{children}</>;
}

function RoleGate({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { hasRole } = useAuth();
  if (!hasRole(...roles)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/welcome" element={<Landing />} />

        {/* Public candidate portal */}
        <Route path="/careers" element={<CareersList />} />
        <Route path="/careers/:slug" element={<CareerApply />} />
        <Route path="/portal/assessment/:token" element={<AssessmentPortal />} />
        <Route path="/portal/interview/:token" element={<InterviewPortal />} />
        <Route path="/portal/offer/:token" element={<OfferPortal />} />
        <Route path="/portal/onboarding/:token" element={<OnboardingPortal />} />

        {/* HR workspace */}
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="jobs" element={<RoleGate roles={['recruiter', 'hiring_manager']}><JobsList /></RoleGate>} />
          <Route path="jobs/new" element={<RoleGate roles={['recruiter']}><JobForm /></RoleGate>} />
          <Route path="jobs/:id" element={<RoleGate roles={['recruiter', 'hiring_manager']}><JobDetail /></RoleGate>} />
          <Route path="jobs/:id/edit" element={<RoleGate roles={['recruiter']}><JobForm /></RoleGate>} />
          <Route path="candidates" element={<RoleGate roles={['recruiter', 'hiring_manager']}><CandidatesList /></RoleGate>} />
          <Route path="candidates/:id" element={<CandidateDetail />} />
          <Route path="reviews" element={<ReviewQueue />} />
          <Route path="assessments" element={<RoleGate roles={['recruiter', 'hiring_manager']}><TestsList /></RoleGate>} />
          <Route path="assessments/:id" element={<RoleGate roles={['recruiter', 'hiring_manager']}><TestDetail /></RoleGate>} />
          <Route path="assessments/results/:invitationId" element={<InvitationResult />} />
          <Route path="interviews" element={<InterviewsList />} />
          <Route path="interviews/:id" element={<RoundDetail />} />
          <Route path="offers" element={<RoleGate roles={['recruiter', 'hiring_manager']}><OffersList /></RoleGate>} />
          <Route path="offers/:id" element={<RoleGate roles={['recruiter', 'hiring_manager']}><OfferDetail /></RoleGate>} />
          <Route path="onboarding" element={<RoleGate roles={['recruiter']}><OnboardingList /></RoleGate>} />
          <Route path="onboarding/:id" element={<RoleGate roles={['recruiter']}><CaseDetail /></RoleGate>} />
          <Route path="emails" element={<RoleGate roles={['recruiter']}><EmailsPage /></RoleGate>} />
          <Route path="settings" element={<RoleGate roles={['recruiter']}><SettingsPage /></RoleGate>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
