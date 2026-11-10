import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bot,
  Eye,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { ROUND_KIND_LABEL } from "@/lib/format";
import { useApiMutation, useDepartments } from "@/lib/hooks";
import type { InterviewPlanRound, Job, RoundKind } from "@/lib/types";
import { Markdown } from "@/components/Markdown";
import {
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  PageHeader,
  PageLoader,
  Segmented,
  Select,
  Textarea,
} from "@/components/ui";
import { SkillsInput, type SkillItem } from "@/components/jobs/SkillsInput";
import { UserMultiSelect, UserSelect } from "@/components/jobs/UserMultiSelect";

const DEFAULT_PLAN: InterviewPlanRound[] = [
  {
    name: "AI Screening",
    kind: "ai_screening",
    durationMin: 20,
    questionCount: 6,
    passScore: 60,
    focusAreas: null,
  },
  {
    name: "Technical Interview",
    kind: "ai_proctored",
    durationMin: 45,
    questionCount: 8,
    passScore: 65,
    focusAreas: null,
  },
  {
    name: "Hiring Manager Round",
    kind: "human",
    durationMin: 45,
    questionCount: 6,
    passScore: 60,
    focusAreas: null,
  },
];

interface FormState {
  title: string;
  departmentId: string;
  location: string;
  employmentType: Job["employmentType"];
  workMode: Job["workMode"];
  experienceMin: string;
  experienceMax: string;
  salaryMin: string;
  salaryMax: string;
  currency: string;
  openings: string;
  priority: Job["priority"];
  targetDate: string;
  description: string;
  hiringManagerId: string | null;
  recruiterId: string | null;
}

const blank: FormState = {
  title: "",
  departmentId: "",
  location: "",
  employmentType: "full_time",
  workMode: "onsite",
  experienceMin: "",
  experienceMax: "",
  salaryMin: "",
  salaryMax: "",
  currency: "INR",
  openings: "1",
  priority: "medium",
  targetDate: "",
  description: "",
  hiringManagerId: null,
  recruiterId: null,
};

const n = (v: string) => (v.trim() === "" ? null : Number(v));
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export default function JobForm() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const { data: departments } = useDepartments();
  const [form, setForm] = useState<FormState>(blank);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [reviewers, setReviewers] = useState<string[]>([]);
  const [plan, setPlan] = useState<InterviewPlanRound[]>(DEFAULT_PLAN);
  const [descMode, setDescMode] = useState<"write" | "preview">("write");
  const [aiNotes, setAiNotes] = useState("");
  const [generating, setGenerating] = useState(false);

  const job = useQuery({
    queryKey: ["jobs", id],
    queryFn: () => api.get<Job>(`/jobs/${id}`),
    enabled: editing,
  });

  useEffect(() => {
    const j = job.data;
    if (!j) return;
    setForm({
      title: j.title,
      departmentId: s(j.departmentId),
      location: s(j.location),
      employmentType: j.employmentType,
      workMode: j.workMode,
      experienceMin: s(j.experienceMin),
      experienceMax: s(j.experienceMax),
      salaryMin: s(j.salaryMin),
      salaryMax: s(j.salaryMax),
      currency: j.currency,
      openings: String(j.openings),
      priority: j.priority,
      targetDate: s(j.targetDate),
      description: j.description ?? "",
      hiringManagerId: j.hiringManagerId,
      recruiterId: j.recruiterId,
    });
    setSkills(j.skills ?? []);
    setReviewers(j.reviewerIds ?? []);
    setPlan(j.interviewPlan?.length ? j.interviewPlan : []);
  }, [job.data]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const body = (status?: "draft" | "open") => ({
    title: form.title.trim(),
    departmentId: form.departmentId || null,
    location: form.location.trim() || null,
    employmentType: form.employmentType,
    workMode: form.workMode,
    experienceMin: n(form.experienceMin),
    experienceMax: n(form.experienceMax),
    salaryMin: n(form.salaryMin),
    salaryMax: n(form.salaryMax),
    currency: form.currency.toUpperCase(),
    openings: Math.max(1, Number(form.openings) || 1),
    priority: form.priority,
    targetDate: form.targetDate || null,
    description: form.description,
    hiringManagerId: form.hiringManagerId,
    recruiterId: form.recruiterId,
    skills,
    reviewerIds: reviewers,
    interviewPlan: plan.map((r) => ({
      name: r.name.trim() || ROUND_KIND_LABEL[r.kind],
      kind: r.kind,
      durationMin: r.durationMin,
      questionCount: r.questionCount,
      passScore: r.passScore,
      focusAreas: r.focusAreas || null,
    })),
    ...(status ? { status } : {}),
  });

  const save = useApiMutation(
    async (status: "draft" | "open" | undefined) => {
      if (editing) {
        const updated = await api.patch<Job>(`/jobs/${id}`, body());
        if (status === "open" && updated.status !== "open")
          return api.post<Job>(`/jobs/${id}/status`, { status: "open" });
        return updated;
      }
      return api.post<Job>("/jobs", body(status));
    },
    {
      success: (j) =>
        editing
          ? "Job saved"
          : j.status === "open"
            ? "Job published"
            : "Draft saved",
      invalidate: [["jobs"]],
      onSuccess: (j) => navigate(`/jobs/${j.id}`),
    },
  );

  async function generate() {
    if (!form.title.trim()) return toast.error("Enter a job title first");
    setGenerating(true);
    try {
      const res = await api.post<{ description: string; skills: SkillItem[] }>(
        "/ai/job-description",
        {
          title: form.title,
          department: departments?.find((d) => d.id === form.departmentId)
            ?.name,
          location: form.location || undefined,
          experienceMin: n(form.experienceMin) ?? undefined,
          experienceMax: n(form.experienceMax) ?? undefined,
          skills: skills.map((x) => x.name),
          notes: aiNotes || undefined,
        },
      );
      set("description", res.description);
      setSkills((prev) => {
        const next = [...prev];
        for (const sk of res.skills ?? [])
          if (!next.some((p) => p.name.toLowerCase() === sk.name.toLowerCase()))
            next.push(sk);
        return next;
      });
      setDescMode("preview");
      toast.success("Description generated — review and edit as needed");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGenerating(false);
    }
  }

  const updateRound = (i: number, patch: Partial<InterviewPlanRound>) =>
    setPlan((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const moveRound = (i: number, d: -1 | 1) =>
    setPlan((p) => {
      const next = [...p];
      const [r] = next.splice(i, 1);
      next.splice(i + d, 0, r!);
      return next;
    });

  if (editing && job.isLoading) return <PageLoader />;
  const canSave = form.title.trim().length > 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) save.mutate(editing ? undefined : "draft");
      }}
    >
      <PageHeader
        back={
          <Link
            to={editing ? `/jobs/${id}` : "/jobs"}
            className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"
          >
            <ArrowLeft className="size-4" /> Back
          </Link>
        }
        title={editing ? `Edit ${job.data?.title ?? "job"}` : "Create a job"}
        subtitle={
          editing
            ? job.data?.code
            : "Define the role, who reviews it and how candidates are interviewed."
        }
        actions={
          <>
            {editing ? (
              <>
                <Button
                  type="submit"
                  variant={job.data?.status === "open" ? "primary" : "outline"}
                  disabled={!canSave}
                  loading={save.isPending && save.variables === undefined}
                >
                  Save changes
                </Button>
                {job.data?.status !== "open" && (
                  <Button
                    disabled={!canSave}
                    loading={save.isPending && save.variables === "open"}
                    onClick={() => save.mutate("open")}
                  >
                    Save & publish
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button
                  type="submit"
                  variant="outline"
                  disabled={!canSave}
                  loading={save.isPending && save.variables === "draft"}
                >
                  Save draft
                </Button>
                <Button
                  disabled={!canSave}
                  loading={save.isPending && save.variables === "open"}
                  onClick={() => save.mutate("open")}
                >
                  Publish job
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Basics" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Job title" required className="sm:col-span-2">
                <Input
                  value={form.title}
                  onChange={(e) => set("title", e.target.value)}
                  placeholder="e.g. Senior Backend Engineer"
                  autoFocus={!editing}
                />
              </Field>
              <Field label="Department">
                <Select
                  value={form.departmentId}
                  onChange={(e) => set("departmentId", e.target.value)}
                >
                  <option value="">—</option>
                  {(departments ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Location">
                <Input
                  value={form.location}
                  onChange={(e) => set("location", e.target.value)}
                  placeholder="e.g. Pune, India"
                />
              </Field>
              <Field label="Employment type">
                <Select
                  value={form.employmentType}
                  onChange={(e) =>
                    set(
                      "employmentType",
                      e.target.value as FormState["employmentType"],
                    )
                  }
                >
                  <option value="full_time">Full-time</option>
                  <option value="part_time">Part-time</option>
                  <option value="contract">Contract</option>
                  <option value="internship">Internship</option>
                </Select>
              </Field>
              <Field label="Work mode">
                <Select
                  value={form.workMode}
                  onChange={(e) =>
                    set("workMode", e.target.value as FormState["workMode"])
                  }
                >
                  <option value="onsite">On-site</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="remote">Remote</option>
                </Select>
              </Field>
              <Field label="Experience (years)">
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    step={0.5}
                    placeholder="Min"
                    value={form.experienceMin}
                    onChange={(e) => set("experienceMin", e.target.value)}
                  />
                  <span className="text-zinc-400">–</span>
                  <Input
                    type="number"
                    min={0}
                    step={0.5}
                    placeholder="Max"
                    value={form.experienceMax}
                    onChange={(e) => set("experienceMax", e.target.value)}
                  />
                </div>
              </Field>
              <Field label="Salary range (annual)">
                <div className="flex items-center gap-2">
                  <Input
                    className="w-20"
                    value={form.currency}
                    maxLength={3}
                    onChange={(e) =>
                      set("currency", e.target.value.toUpperCase())
                    }
                  />
                  <Input
                    type="number"
                    min={0}
                    placeholder="Min"
                    value={form.salaryMin}
                    onChange={(e) => set("salaryMin", e.target.value)}
                  />
                  <span className="text-zinc-400">–</span>
                  <Input
                    type="number"
                    min={0}
                    placeholder="Max"
                    value={form.salaryMax}
                    onChange={(e) => set("salaryMax", e.target.value)}
                  />
                </div>
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Job description"
              subtitle="Markdown supported. Shown on the public career page and used for AI matching."
              actions={
                <Segmented
                  value={descMode}
                  onChange={setDescMode}
                  options={[
                    {
                      value: "write",
                      label: (
                        <span className="flex items-center gap-1">
                          <Pencil className="size-3" /> Write
                        </span>
                      ),
                    },
                    {
                      value: "preview",
                      label: (
                        <span className="flex items-center gap-1">
                          <Eye className="size-3" /> Preview
                        </span>
                      ),
                    },
                  ]}
                />
              }
            />
            <div className="mb-4 flex flex-col gap-2 rounded-xl border border-violet-100 bg-violet-50/50 p-3 sm:flex-row sm:items-center">
              <Sparkles className="hidden size-4 shrink-0 text-violet-500 sm:block" />
              <Input
                className="flex-1 bg-white"
                value={aiNotes}
                onChange={(e) => setAiNotes(e.target.value)}
                placeholder="Optional notes for AI: team, tech stack, key responsibilities…"
              />
              <Button
                type="button"
                variant="secondary"
                loading={generating}
                onClick={generate}
                icon={<Sparkles className="size-4" />}
              >
                Generate with AI
              </Button>
            </div>
            {descMode === "write" ? (
              <Textarea
                rows={16}
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder={
                  "## About the role\n…\n\n## Responsibilities\n- …\n\n## Requirements\n- …"
                }
                className="font-mono text-[13px]"
              />
            ) : (
              <div className="min-h-64 rounded-lg border border-zinc-100 p-4">
                <Markdown text={form.description} />
              </div>
            )}
            <Field label="Skills" className="mt-4">
              <SkillsInput value={skills} onChange={setSkills} />
            </Field>
          </Card>

          <Card>
            <CardHeader
              title="Interview plan"
              subtitle="Every candidate you start interviews for goes through these rounds in order. AI rounds are sent automatically; live rounds wait for scheduling."
              actions={
                <Button
                  size="sm"
                  variant="outline"
                  icon={<Plus className="size-4" />}
                  onClick={() =>
                    setPlan((p) => [
                      ...p,
                      {
                        name: "",
                        kind: "human",
                        durationMin: 45,
                        questionCount: 6,
                        passScore: 60,
                        focusAreas: null,
                      },
                    ])
                  }
                >
                  Add round
                </Button>
              }
            />
            {!plan.length && (
              <p className="rounded-lg border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500">
                No rounds — the default plan will be used.
              </p>
            )}
            <ol className="space-y-3">
              {plan.map((r, i) => (
                <li key={i} className="rounded-xl border border-zinc-200 p-4">
                  <div className="flex items-start gap-3">
                    <span className="mt-1.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">
                      {i + 1}
                    </span>
                    <div className="grid flex-1 gap-3 sm:grid-cols-12">
                      <Field label="Round name" className="sm:col-span-5">
                        <Input
                          value={r.name}
                          onChange={(e) =>
                            updateRound(i, { name: e.target.value })
                          }
                          placeholder={ROUND_KIND_LABEL[r.kind]}
                        />
                      </Field>
                      <Field label="Type" className="sm:col-span-4">
                        <Select
                          value={r.kind}
                          onChange={(e) =>
                            updateRound(i, {
                              kind: e.target.value as RoundKind,
                            })
                          }
                        >
                          <option value="ai_screening">AI screening</option>
                          <option value="ai_proctored">AI proctored</option>
                          <option value="human">Live interview</option>
                        </Select>
                      </Field>
                      <Field label="Minutes" className="sm:col-span-3">
                        <Input
                          type="number"
                          min={5}
                          max={240}
                          value={r.durationMin}
                          onChange={(e) =>
                            updateRound(i, {
                              durationMin: Number(e.target.value) || 30,
                            })
                          }
                        />
                      </Field>
                      {r.kind !== "human" && (
                        <>
                          <Field label="Questions" className="sm:col-span-3">
                            <Input
                              type="number"
                              min={1}
                              max={30}
                              value={r.questionCount}
                              onChange={(e) =>
                                updateRound(i, {
                                  questionCount: Number(e.target.value) || 6,
                                })
                              }
                            />
                          </Field>
                          <Field label="Pass score" className="sm:col-span-3">
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              value={r.passScore}
                              onChange={(e) =>
                                updateRound(i, {
                                  passScore: Number(e.target.value),
                                })
                              }
                            />
                          </Field>
                        </>
                      )}
                      <Field
                        label="Focus areas"
                        className={
                          r.kind !== "human"
                            ? "sm:col-span-6"
                            : "sm:col-span-12"
                        }
                      >
                        <Input
                          value={r.focusAreas ?? ""}
                          onChange={(e) =>
                            updateRound(i, { focusAreas: e.target.value })
                          }
                          placeholder="e.g. system design, Node.js, communication"
                        />
                      </Field>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={i === 0}
                        onClick={() => moveRound(i, -1)}
                        icon={<ArrowUp className="size-3.5" />}
                        aria-label="Move up"
                      />
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={i === plan.length - 1}
                        onClick={() => moveRound(i, 1)}
                        icon={<ArrowDown className="size-3.5" />}
                        aria-label="Move down"
                      />
                      <Button
                        size="xs"
                        variant="ghost"
                        className="text-red-500 hover:bg-red-50 hover:text-red-600"
                        onClick={() =>
                          setPlan((p) => p.filter((_, j) => j !== i))
                        }
                        icon={<Trash2 className="size-3.5" />}
                        aria-label="Remove"
                      />
                    </div>
                  </div>
                  <p className="mt-2 ml-10 flex items-center gap-1 text-xs text-zinc-500">
                    {r.kind === "human" ? (
                      <UserRound className="size-3" />
                    ) : (
                      <Bot className="size-3" />
                    )}
                    {r.kind === "ai_screening"
                      ? "Conversational AI interview the candidate takes anytime via a link."
                      : r.kind === "ai_proctored"
                        ? "AI interview with webcam, full-screen and tab-switch monitoring."
                        : "Scheduled video interview with your panel; they submit feedback in cats."}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Hiring details" />
            <div className="space-y-4">
              <Field label="Openings">
                <Input
                  type="number"
                  min={1}
                  value={form.openings}
                  onChange={(e) => set("openings", e.target.value)}
                />
              </Field>
              <Field label="Priority">
                <Select
                  value={form.priority}
                  onChange={(e) =>
                    set("priority", e.target.value as FormState["priority"])
                  }
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </Select>
              </Field>
              <Field label="Target hire date">
                <Input
                  type="date"
                  value={form.targetDate}
                  onChange={(e) => set("targetDate", e.target.value)}
                />
              </Field>
              <Field label="Hiring manager">
                <UserSelect
                  value={form.hiringManagerId}
                  onChange={(v) => set("hiringManagerId", v)}
                  roles={["hiring_manager", "recruiter"]}
                />
              </Field>
              <Field label="Recruiter">
                <UserSelect
                  value={form.recruiterId}
                  onChange={(v) => set("recruiterId", v)}
                  roles={["recruiter"]}
                />
              </Field>
            </div>
          </Card>
          <Card>
            <CardHeader
              title="Resume reviewers"
              subtitle="Default reviewers suggested when sending resumes for review."
            />
            <UserMultiSelect value={reviewers} onChange={setReviewers} />
          </Card>
        </div>
      </div>
    </form>
  );
}
