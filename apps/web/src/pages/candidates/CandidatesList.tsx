import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { UploadCloud, UserPlus, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fromNow } from '@/lib/format';
import { useDebounced, useJobs } from '@/lib/hooks';
import type { Candidate, Paginated } from '@/lib/types';
import { Avatar, Badge, Button, EmptyState, ErrorState, Input, Modal, PageHeader, Pagination, SearchInput, Select, Spinner, Table, Td, Th, Tr } from '@/components/ui';
import { CandidateFormModal, sourceLabel } from '@/components/candidates/CandidateFormModal';
import { ResumeUploader } from '@/components/candidates/ResumeUploader';

const SOURCES = ['career_page', 'manual_upload', 'bulk_upload', 'email', 'referral', 'linkedin', 'job_board', 'agency', 'other'];
const PAGE_SIZE = 25;

export default function CandidatesList() {
  const navigate = useNavigate();
  const { isHR } = useAuth();
  const { data: jobs } = useJobs();
  const [q, setQ] = useState('');
  const [skill, setSkill] = useState('');
  const [source, setSource] = useState('');
  const [jobId, setJobId] = useState('');
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const search = useDebounced(q);
  const skillQ = useDebounced(skill);

  const list = useQuery({
    queryKey: ['candidates', 'list', { search, skillQ, source, jobId, page }],
    queryFn: () => api.get<Paginated<Candidate>>('/candidates', { q: search, skill: skillQ, source, jobId, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  });

  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };
  const hasFilters = !!(search || skillQ || source || jobId);

  return (
    <div>
      <PageHeader
        title="Candidates"
        subtitle={list.data ? `${list.data.total.toLocaleString()} people in your talent pool` : 'Your talent pool'}
        actions={
          isHR && (
            <>
              <Button variant="outline" icon={<UserPlus className="size-4" />} onClick={() => setAddOpen(true)}>
                Add manually
              </Button>
              <Button icon={<UploadCloud className="size-4" />} onClick={() => setUploadOpen(true)}>
                Upload resumes
              </Button>
            </>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={q} onChange={resetPage(setQ)} placeholder="Search name, email, title, company…" className="w-full sm:w-80" />
        <Input value={skill} onChange={(e) => resetPage(setSkill)(e.target.value)} placeholder="Skill (e.g. React)" className="w-full sm:w-40" />
        <Select value={source} onChange={(e) => resetPage(setSource)(e.target.value)} className="w-full sm:w-44">
          <option value="">All sources</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {sourceLabel(s)}
            </option>
          ))}
        </Select>
        <Select value={jobId} onChange={(e) => resetPage(setJobId)(e.target.value)} className="w-full sm:w-56">
          <option value="">All jobs</option>
          {(jobs ?? []).map((j) => (
            <option key={j.id} value={j.id}>
              {j.title} ({j.code})
            </option>
          ))}
        </Select>
        {list.isFetching && !list.isLoading && <Spinner className="size-4" />}
      </div>

      {list.isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner className="size-6" />
        </div>
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.data.length ? (
        <EmptyState
          icon={<Users className="size-5" />}
          title={hasFilters ? 'No candidates match your filters' : 'No candidates yet'}
          description={hasFilters ? 'Try a different search.' : 'Upload resumes and AI will build profiles for you.'}
          action={
            isHR &&
            !hasFilters && (
              <Button icon={<UploadCloud className="size-4" />} onClick={() => setUploadOpen(true)}>
                Upload resumes
              </Button>
            )
          }
        />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Candidate</Th>
                <Th>Current role</Th>
                <Th>Experience</Th>
                <Th>Skills</Th>
                <Th>Source</Th>
                <Th className="text-center">Jobs</Th>
                <Th>Added</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.data.map((c) => (
                <Tr key={c.id} onClick={() => navigate(`/candidates/${c.id}`)}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <Avatar name={c.fullName} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-zinc-900">{c.fullName}</p>
                        <p className="truncate text-xs text-zinc-500">{c.email}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <p className="max-w-56 truncate">{c.currentTitle ?? '—'}</p>
                    {c.currentCompany && <p className="max-w-56 truncate text-xs text-zinc-500">{c.currentCompany}</p>}
                  </Td>
                  <Td className="whitespace-nowrap">{c.experienceYears !== null ? `${c.experienceYears} yrs` : '—'}</Td>
                  <Td>
                    <div className="flex max-w-72 flex-wrap gap-1">
                      {c.skills.slice(0, 4).map((s) => (
                        <Badge key={s}>{s}</Badge>
                      ))}
                      {c.skills.length > 4 && <span className="text-xs text-zinc-400">+{c.skills.length - 4}</span>}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap text-zinc-500">{sourceLabel(c.source)}</Td>
                  <Td className="text-center">{c.applicationCount ?? 0}</Td>
                  <Td className="whitespace-nowrap text-zinc-500">{fromNow(c.createdAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onChange={setPage} />
        </>
      )}

      <CandidateFormModal open={addOpen} onClose={() => setAddOpen(false)} defaultJobId={jobId || undefined} />
      <Modal open={uploadOpen} onClose={() => setUploadOpen(false)} title="Upload resumes" description="Bulk upload supported — AI extracts each candidate's profile." size="lg">
        <ResumeUploader allowJobPick jobId={jobId || undefined} />
      </Modal>
    </div>
  );
}
