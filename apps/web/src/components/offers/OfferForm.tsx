import { fmtMoney } from '@/lib/format';
import { Field, Input, Textarea } from '../ui';

export interface OfferFormValues {
  designation: string;
  baseSalary: number | '';
  variablePay: number | '';
  joiningBonus: number | '';
  equity: string;
  currency: string;
  joiningDate: string;
  location: string;
  benefits: string;
  additionalTerms: string;
}

export const emptyOffer = (currency = 'INR'): OfferFormValues => ({
  designation: '',
  baseSalary: '',
  variablePay: '',
  joiningBonus: '',
  equity: '',
  currency,
  joiningDate: '',
  location: '',
  benefits: '',
  additionalTerms: '',
});

export function fromVersion(v: Partial<Record<keyof OfferFormValues, unknown>>): OfferFormValues {
  const num = (x: unknown) => (x === null || x === undefined ? '' : Number(x));
  const str = (x: unknown) => (x === null || x === undefined ? '' : String(x));
  return {
    designation: str(v.designation),
    baseSalary: num(v.baseSalary),
    variablePay: num(v.variablePay),
    joiningBonus: num(v.joiningBonus),
    equity: str(v.equity),
    currency: str(v.currency) || 'INR',
    joiningDate: str(v.joiningDate),
    location: str(v.location),
    benefits: str(v.benefits),
    additionalTerms: str(v.additionalTerms),
  };
}

/** Converts the form to an API body (empty strings -> null / 0). */
export function toBody(v: OfferFormValues) {
  return {
    designation: v.designation.trim(),
    baseSalary: Number(v.baseSalary) || 0,
    variablePay: Number(v.variablePay) || 0,
    joiningBonus: Number(v.joiningBonus) || 0,
    equity: v.equity.trim() || null,
    currency: v.currency.trim().toUpperCase() || 'INR',
    joiningDate: v.joiningDate || null,
    location: v.location.trim() || null,
    benefits: v.benefits.trim() || null,
    additionalTerms: v.additionalTerms.trim() || null,
  };
}

export function OfferFormFields({ value, onChange, salaryHint }: { value: OfferFormValues; onChange: (v: OfferFormValues) => void; salaryHint?: string }) {
  const set = <K extends keyof OfferFormValues>(k: K, v: OfferFormValues[K]) => onChange({ ...value, [k]: v });
  const numInput = (k: 'baseSalary' | 'variablePay' | 'joiningBonus') => (
    <Input type="number" min={0} step="1000" value={value[k]} onChange={(e) => set(k, e.target.value === '' ? '' : Number(e.target.value))} />
  );
  const total = (Number(value.baseSalary) || 0) + (Number(value.variablePay) || 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Designation" required className="sm:col-span-2">
          <Input value={value.designation} onChange={(e) => set('designation', e.target.value)} />
        </Field>
        <Field label="Currency">
          <Input value={value.currency} maxLength={3} onChange={(e) => set('currency', e.target.value.toUpperCase())} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Base salary (annual)" required hint={salaryHint}>
          {numInput('baseSalary')}
        </Field>
        <Field label="Variable pay">{numInput('variablePay')}</Field>
        <Field label="Joining bonus">{numInput('joiningBonus')}</Field>
      </div>
      <div className="rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
        Total fixed + variable CTC: <strong className="text-zinc-900">{fmtMoney(total, value.currency || 'INR')}</strong>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Joining date">
          <Input type="date" value={value.joiningDate} onChange={(e) => set('joiningDate', e.target.value)} />
        </Field>
        <Field label="Location">
          <Input value={value.location} onChange={(e) => set('location', e.target.value)} />
        </Field>
        <Field label="Equity / ESOPs">
          <Input value={value.equity} onChange={(e) => set('equity', e.target.value)} placeholder="e.g. 1,000 ESOPs" />
        </Field>
      </div>
      <Field label="Benefits">
        <Textarea rows={3} value={value.benefits} onChange={(e) => set('benefits', e.target.value)} placeholder="Health insurance, learning budget, …" />
      </Field>
      <Field label="Additional terms">
        <Textarea rows={3} value={value.additionalTerms} onChange={(e) => set('additionalTerms', e.target.value)} />
      </Field>
    </div>
  );
}
