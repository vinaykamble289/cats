import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useApiMutation } from '@/lib/hooks';
import { fmtMoney } from '@/lib/format';
import type { Job, Offer } from '@/lib/types';
import { Button, Modal, Spinner } from '../ui';
import { OfferFormFields, emptyOffer, toBody, type OfferFormValues } from '../offers/OfferForm';

export interface CreateOfferDialogProps {
  open: boolean;
  onClose: () => void;
  applicationId: string;
  candidateName: string;
  /** Prefills designation, currency and salary range */
  jobId: string;
  /** Called with the created offer id */
  onDone?: (offerId: string) => void;
}

export function CreateOfferDialog({ open, onClose, applicationId, candidateName, jobId, onDone }: CreateOfferDialogProps) {
  const navigate = useNavigate();
  const [form, setForm] = useState<OfferFormValues>(emptyOffer());
  const { data: job, isLoading } = useQuery({ queryKey: ['jobs', jobId], queryFn: () => api.get<Job>(`/jobs/${jobId}`), enabled: open && !!jobId });

  useEffect(() => {
    if (open && job) setForm({ ...emptyOffer(job.currency), designation: job.title, location: job.location ?? '', baseSalary: job.salaryMax ?? job.salaryMin ?? '' });
  }, [open, job]);

  const create = useApiMutation((body: ReturnType<typeof toBody> & { applicationId: string }) => api.post<Offer>('/offers', body), {
    success: 'Offer draft created',
    invalidate: [['offers']],
    onSuccess: (offer) => {
      onClose();
      onDone?.(offer.id);
      navigate(`/offers/${offer.id}`);
    },
  });

  const hint = job && (job.salaryMin || job.salaryMax) ? `Job range ${fmtMoney(job.salaryMin, job.currency)} – ${fmtMoney(job.salaryMax, job.currency)}` : undefined;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`Create offer for ${candidateName}`}
      description="Saved as a draft. You can review it before sending."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={create.isPending}
            onClick={() => {
              if (!form.designation.trim() || form.baseSalary === '') return toast.error('Designation and base salary are required');
              create.mutate({ applicationId, ...toBody(form) });
            }}
          >
            Create draft
          </Button>
        </>
      }
    >
      {isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : (
        <OfferFormFields value={form} onChange={setForm} salaryHint={hint} />
      )}
    </Modal>
  );
}
