import { ArrowDown, ArrowUp, CheckCircle2, Circle, Plus, Square, SquareCheck, Trash2, X } from 'lucide-react';
import type { Question, QuestionType } from '@/lib/types';
import { Badge, Button, Card, Field, Input, Select, Textarea, cx } from '../ui';

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  mcq: 'Single choice',
  multi_select: 'Multiple choice',
  short_text: 'Short answer',
  long_text: 'Long answer',
  code: 'Code',
};

export const isChoice = (t: QuestionType) => t === 'mcq' || t === 'multi_select';

export function blankQuestion(type: QuestionType = 'mcq'): Question {
  return { type, prompt: '', options: isChoice(type) ? ['', '', '', ''] : [], correctOptions: isChoice(type) ? [0] : [], points: isChoice(type) ? 1 : 5, rubric: null };
}

export function QuestionCard({
  q,
  index,
  total,
  editable,
  onChange,
  onRemove,
  onMove,
}: {
  q: Question;
  index: number;
  total: number;
  editable: boolean;
  onChange: (q: Question) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const choice = isChoice(q.type);
  const toggleCorrect = (i: number) => {
    if (q.type === 'mcq') return onChange({ ...q, correctOptions: [i] });
    const set = new Set(q.correctOptions);
    if (set.has(i)) set.delete(i);
    else set.add(i);
    onChange({ ...q, correctOptions: [...set].sort((a, b) => a - b) });
  };
  const changeType = (type: QuestionType) => {
    if (isChoice(type) && !choice) onChange({ ...q, type, options: ['', '', '', ''], correctOptions: [0] });
    else if (!isChoice(type)) onChange({ ...q, type, options: [], correctOptions: [] });
    else onChange({ ...q, type, correctOptions: type === 'mcq' ? q.correctOptions.slice(0, 1) : q.correctOptions });
  };

  return (
    <Card className="group">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">{index + 1}</span>
        {editable ? (
          <Select value={q.type} onChange={(e) => changeType(e.target.value as QuestionType)} className="h-8 w-44 text-xs">
            {Object.entries(QUESTION_TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        ) : (
          <Badge tone="violet">{QUESTION_TYPE_LABEL[q.type]}</Badge>
        )}
        <div className="ml-auto flex items-center gap-1">
          {editable ? (
            <>
              <span className="text-xs text-zinc-500">Points</span>
              <Input type="number" min={1} max={100} value={q.points} onChange={(e) => onChange({ ...q, points: Math.max(1, Number(e.target.value) || 1) })} className="h-8 w-16 text-xs" />
              <Button size="xs" variant="ghost" disabled={index === 0} onClick={() => onMove(-1)} icon={<ArrowUp className="size-3.5" />} />
              <Button size="xs" variant="ghost" disabled={index === total - 1} onClick={() => onMove(1)} icon={<ArrowDown className="size-3.5" />} />
              <Button size="xs" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={onRemove} icon={<Trash2 className="size-3.5" />} />
            </>
          ) : (
            <span className="text-xs text-zinc-500">{q.points} pts</span>
          )}
        </div>
      </div>

      {editable ? (
        <Textarea rows={2} value={q.prompt} onChange={(e) => onChange({ ...q, prompt: e.target.value })} placeholder="Question prompt…" />
      ) : (
        <p className="text-sm whitespace-pre-wrap text-zinc-900">{q.prompt}</p>
      )}

      {choice && (
        <div className="mt-3 space-y-2">
          {q.options.map((opt, i) => {
            const correct = q.correctOptions.includes(i);
            const Icon = q.type === 'mcq' ? (correct ? CheckCircle2 : Circle) : correct ? SquareCheck : Square;
            return (
              <div key={i} className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!editable}
                  onClick={() => toggleCorrect(i)}
                  title="Mark as correct"
                  className={cx('shrink-0', editable && 'cursor-pointer', correct ? 'text-emerald-600' : 'text-zinc-300 hover:text-zinc-500')}
                >
                  <Icon className="size-5" />
                </button>
                {editable ? (
                  <>
                    <Input
                      value={opt}
                      onChange={(e) => onChange({ ...q, options: q.options.map((o, j) => (j === i ? e.target.value : o)) })}
                      placeholder={`Option ${i + 1}`}
                      className={cx('h-8', correct && 'border-emerald-300 bg-emerald-50/40')}
                    />
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={q.options.length <= 2}
                      onClick={() =>
                        onChange({
                          ...q,
                          options: q.options.filter((_, j) => j !== i),
                          correctOptions: q.correctOptions.filter((c) => c !== i).map((c) => (c > i ? c - 1 : c)),
                        })
                      }
                      icon={<X className="size-3.5" />}
                    />
                  </>
                ) : (
                  <span className={cx('text-sm', correct ? 'font-medium text-emerald-700' : 'text-zinc-700')}>{opt}</span>
                )}
              </div>
            );
          })}
          {editable && q.options.length < 8 && (
            <Button size="xs" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => onChange({ ...q, options: [...q.options, ''] })}>
              Add option
            </Button>
          )}
        </div>
      )}

      {!choice &&
        (editable ? (
          <Field label="Grading rubric (used by AI)" className="mt-3">
            <Textarea rows={2} value={q.rubric ?? ''} onChange={(e) => onChange({ ...q, rubric: e.target.value || null })} placeholder="What a strong answer must cover…" />
          </Field>
        ) : (
          q.rubric && <p className="mt-2 rounded-lg bg-zinc-50 p-2 text-xs text-zinc-600">Rubric: {q.rubric}</p>
        ))}
    </Card>
  );
}
