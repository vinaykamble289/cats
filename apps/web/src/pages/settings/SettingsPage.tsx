import { useSearchParams } from 'react-router-dom';
import { PageHeader, Tabs } from '@/components/ui';
import { DepartmentsTab, TeamTab } from '@/components/settings/TeamSettings';
import { DocumentTypesTab, SystemStatusTab, TemplatesTab, VendorsTab } from '@/components/settings/WorkspaceSettings';

type Tab = 'team' | 'departments' | 'templates' | 'vendors' | 'documents' | 'system';
const TABS: { value: Tab; label: string }[] = [
  { value: 'team', label: 'Team & roles' },
  { value: 'departments', label: 'Departments' },
  { value: 'templates', label: 'Email templates' },
  { value: 'vendors', label: 'BGV vendors' },
  { value: 'documents', label: 'Joining documents' },
  { value: 'system', label: 'System status' },
];

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.value === params.get('tab'))?.value ?? 'team') as Tab;
  return (
    <div>
      <PageHeader title="Settings" subtitle="Team, communication templates and pre-joining configuration" />
      <Tabs className="mb-6" tabs={TABS} value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} />
      {tab === 'team' && <TeamTab />}
      {tab === 'departments' && <DepartmentsTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'vendors' && <VendorsTab />}
      {tab === 'documents' && <DocumentTypesTab />}
      {tab === 'system' && <SystemStatusTab />}
    </div>
  );
}
