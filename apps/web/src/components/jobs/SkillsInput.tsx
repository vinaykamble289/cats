import { useState } from 'react';
import { X } from 'lucide-react';
import { cx } from '@/components/ui';

export interface SkillItem {
  name: string;
  isRequired: boolean;
}

/** Chip input for skills. Enter/comma adds; click a chip to toggle required/nice-to-have. */
export function SkillsInput({ value, onChange, withRequired = true, placeholder = 'Type a skill and press Enter' }: { value: SkillItem[]; onChange: (v: SkillItem[]) => void; withRequired?: boolean; placeholder?: string }) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const names = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const next = [...value];
    for (const name of names) if (!next.some((s) => s.name.toLowerCase() === name.toLowerCase())) next.push({ name, isRequired: true });
    onChange(next);
    setText('');
  };
  return (
    <div>
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 shadow-xs focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20">
        {value.map((s, i) => (
          <span
            key={s.name}
            className={cx(
              'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
              s.isRequired || !withRequired ? 'bg-brand-50 text-brand-700 ring-brand-200' : 'bg-zinc-50 text-zinc-600 ring-zinc-200',
            )}
          >
            <button
              type="button"
              disabled={!withRequired}
              title={withRequired ? 'Click to toggle required / nice-to-have' : undefined}
              className={cx(withRequired && 'cursor-pointer')}
              onClick={() => onChange(value.map((v, j) => (j === i ? { ...v, isRequired: !v.isRequired } : v)))}
            >
              {s.name}
              {withRequired && !s.isRequired && <span className="ml-1 text-[10px] text-zinc-400">nice</span>}
            </button>
            <button type="button" className="cursor-pointer text-current/60 hover:text-current" onClick={() => onChange(value.filter((_, j) => j !== i))}>
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ',') && text.trim()) {
              e.preventDefault();
              add(text);
            } else if (e.key === 'Backspace' && !text && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => text.trim() && add(text)}
          placeholder={value.length ? '' : placeholder}
          className="min-w-32 flex-1 border-0 bg-transparent px-1 text-sm outline-none placeholder:text-zinc-400"
        />
      </div>
      {withRequired && value.length > 0 && <p className="mt-1 text-xs text-zinc-500">Click a skill to toggle required / nice-to-have.</p>}
    </div>
  );
}
