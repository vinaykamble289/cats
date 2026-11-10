import { useState } from 'react';
import { ArrowRightLeft, ClipboardCheck, FileSearch, PlayCircle, Star, X, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useApiMutation } from '@/lib/hooks';
import { SendTestDialog, StartInterviewsDialog } from '@/components/actions';
import { Button } from '@/components/ui';
import { MoveStageDialog, RejectDialog, ReviewRequestDialog } from './PipelineDialogs';

type Dialog = 'review' | 'test' | 'interviews' | 'reject' | 'move' | null;

/** Floating action bar for bulk pipeline operations on selected applications. */
export function BulkActionBar({ ids, jobId, defaultReviewerIds, onClear }: { ids: string[]; jobId?: string; defaultReviewerIds?: string[]; onClear: () => void }) {
  const [dialog, setDialogState] = useState<Dialog>(null);
  // Snapshot the selection when a dialog opens so results stay visible after the selection is cleared.
  const [target, setTarget] = useState<string[]>([]);
  const setDialog = (d: Dialog) => {
    if (d) setTarget(ids);
    setDialogState(d);
  };
  const shortlist = useApiMutation(() => api.post<{ updated: number }>('/applications/bulk/stage', { applicationIds: ids, stage: 'shortlisted', status: 'active' }), {
    success: (r) => `${r.updated} candidate(s) shortlisted`,
    invalidate: [['applications'], ['activity']],
    onSuccess: onClear,
  });
  const close = () => setDialog(null);

  return (
    <>
      {ids.length > 0 && (
        <div className="fixed inset-x-0 bottom-6 z-30 flex justify-center px-4">
          <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900 p-1.5 pl-4 text-white shadow-xl">
            <span className="mr-2 text-sm font-medium whitespace-nowrap">{ids.length} selected</span>
            <Button size="sm" variant="ghost" className="text-zinc-200 hover:bg-white/10 hover:text-white" icon={<FileSearch className="size-4" />} onClick={() => setDialog('review')}>
              Review
            </Button>
            <Button size="sm" variant="ghost" className="text-zinc-200 hover:bg-white/10 hover:text-white" icon={<Star className="size-4" />} loading={shortlist.isPending} onClick={() => shortlist.mutate()}>
              Shortlist
            </Button>
            <Button size="sm" variant="ghost" className="text-zinc-200 hover:bg-white/10 hover:text-white" icon={<ClipboardCheck className="size-4" />} onClick={() => setDialog('test')}>
              Send test
            </Button>
            <Button size="sm" variant="ghost" className="text-zinc-200 hover:bg-white/10 hover:text-white" icon={<PlayCircle className="size-4" />} onClick={() => setDialog('interviews')}>
              Interviews
            </Button>
            <Button size="sm" variant="ghost" className="text-zinc-200 hover:bg-white/10 hover:text-white" icon={<ArrowRightLeft className="size-4" />} onClick={() => setDialog('move')}>
              Move
            </Button>
            <Button size="sm" variant="ghost" className="text-red-300 hover:bg-red-500/20 hover:text-red-200" icon={<XCircle className="size-4" />} onClick={() => setDialog('reject')}>
              Reject
            </Button>
            <button onClick={onClear} className="ml-1 cursor-pointer rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white" aria-label="Clear selection">
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}
      <ReviewRequestDialog open={dialog === 'review'} onClose={close} applicationIds={target} defaultReviewerIds={defaultReviewerIds} onDone={onClear} />
      <RejectDialog open={dialog === 'reject'} onClose={close} applicationIds={target} onDone={onClear} />
      <MoveStageDialog open={dialog === 'move'} onClose={close} applicationIds={target} onDone={onClear} />
      <SendTestDialog open={dialog === 'test'} onClose={close} applicationIds={target} jobId={jobId} onDone={onClear} />
      <StartInterviewsDialog open={dialog === 'interviews'} onClose={close} applicationIds={target} jobId={jobId} onDone={onClear} />
    </>
  );
}
