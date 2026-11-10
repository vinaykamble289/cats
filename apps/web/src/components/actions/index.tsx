/**
 * Cross-domain action dialogs & candidate panels.
 * Owned by the assessments/interviews/offers/onboarding UI; used by the jobs pipeline and candidate pages.
 * Signatures are fixed - implementations live in the sibling files.
 */
export { SendTestDialog } from './SendTestDialog';
export { StartInterviewsDialog } from './StartInterviewsDialog';
export { CreateOfferDialog } from './CreateOfferDialog';
export { CandidateAssessments, CandidateInterviews, CandidateOffers, CandidateOnboarding } from './CandidatePanels';
