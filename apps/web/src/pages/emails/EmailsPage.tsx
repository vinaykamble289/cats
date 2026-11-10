import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Mail, RotateCw } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDateTime, fromNow, humanize } from "@/lib/format";
import { useApiMutation, useDebounced } from "@/lib/hooks";
import type { EmailLog, Paginated } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  SearchInput,
  Segmented,
  Spinner,
  Table,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { EmailDetailDrawer } from "@/components/candidates/EmailViews";

type StatusFilter = "all" | "queued" | "sent" | "failed";
const PAGE_SIZE = 50;

function RetryButton({ id }: { id: string }) {
  const retry = useApiMutation(() => api.post(`/emails/${id}/retry`), {
    success: "Email re-queued",
    invalidate: [["emails"]],
  });
  return (
    <Button
      size="xs"
      variant="outline"
      icon={<RotateCw className="size-3" />}
      loading={retry.isPending}
      onClick={(e) => {
        e.stopPropagation();
        retry.mutate();
      }}
    >
      Retry
    </Button>
  );
}

export default function EmailsPage() {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const search = useDebounced(q);

  const list = useQuery({
    queryKey: ["emails", "list", { status, search, page }],
    queryFn: () =>
      api.get<Paginated<EmailLog>>("/emails", {
        status: status === "all" ? undefined : status,
        q: search,
        page,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: (prev) => prev,
    refetchInterval: 15_000,
  });

  return (
    <div>
      <PageHeader
        title="Email log"
        subtitle="Every email cats sends — delivered asynchronously with automatic retries."
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={[
            { value: "all", label: "All" },
            { value: "queued", label: "Queued" },
            { value: "sent", label: "Sent" },
            { value: "failed", label: "Failed" },
          ]}
        />
        <SearchInput
          value={q}
          onChange={(v) => {
            setQ(v);
            setPage(1);
          }}
          placeholder="Search recipient or subject…"
          className="w-full sm:w-72"
        />
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
          icon={<Mail className="size-5" />}
          title="No emails"
          description="Emails to candidates, reviewers and vendors will be listed here."
        />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Recipient</Th>
                <Th>Subject</Th>
                <Th>Type</Th>
                <Th>Status</Th>
                <Th>When</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {list.data.data.map((e) => (
                <Tr key={e.id} onClick={() => setOpenId(e.id)}>
                  <Td>
                    <p className="max-w-56 truncate text-zinc-800">
                      {e.toEmail}
                    </p>
                    {e.candidateId && (
                      <Link
                        to={`/candidates/${e.candidateId}`}
                        onClick={(ev) => ev.stopPropagation()}
                        className="text-xs text-brand-600 hover:underline"
                      >
                        View candidate
                      </Link>
                    )}
                  </Td>
                  <Td>
                    <p className="max-w-md truncate font-medium text-zinc-900">
                      {e.subject}
                    </p>
                    {e.lastError && (
                      <p className="max-w-md truncate text-xs text-red-600">
                        {e.lastError}
                      </p>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-zinc-500">
                    {humanize(e.templateKey)}
                  </Td>
                  <Td>
                    <StatusBadge value={e.status} />
                    {e.attempts > 1 && (
                      <span className="ml-1 text-xs text-zinc-400">
                        ×{e.attempts}
                      </span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-zinc-500">
                    <span title={fmtDateTime(e.sentAt ?? e.createdAt)}>
                      {fromNow(e.sentAt ?? e.createdAt)}
                    </span>
                  </Td>
                  <Td className="text-right">
                    {e.status === "failed" && <RetryButton id={e.id} />}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={list.data.total}
            onChange={setPage}
          />
        </>
      )}
      <EmailDetailDrawer emailId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
