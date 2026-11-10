import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, KeyRound, MailPlus, Pencil, Plus, RotateCcw, Trash2, UserPlus, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fromNow, ROLE_LABEL } from '@/lib/format';
import { useApiMutation, useDebounced, useDepartments } from '@/lib/hooks';
import type { Department, Paginated, Role, User } from '@/lib/types';
import { Avatar, Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, Field, Input, Menu, Modal, SearchInput, Segmented, Select, Spinner, Table, Td, Th, Tr } from '@/components/ui';

const ROLES: Role[] = ['admin', 'recruiter', 'hiring_manager', 'reviewer', 'interviewer'];
const ROLE_HELP: Record<Role, string> = {
  admin: 'Full access including team & settings',
  recruiter: 'Runs the hiring process end-to-end',
  hiring_manager: 'Views jobs & candidates, gives interview feedback',
  reviewer: 'Reviews resumes assigned to them',
  interviewer: 'Conducts interviews and submits feedback',
};
type Access = 'invite' | 'password';
type Status = '' | 'true' | 'false';
const ROLE_TONE: Record<Role, 'violet' | 'blue' | 'green' | 'amber' | 'gray'> = { admin: 'violet', recruiter: 'blue', hiring_manager: 'green', reviewer: 'amber', interviewer: 'gray' };

function UserModal({ open, onClose, user }: { open: boolean; onClose: () => void; user?: User }) {
  const { data: departments } = useDepartments();
  const [form, setForm] = useState({ email: '', fullName: '', role: 'reviewer' as Role, departmentId: '', title: '', sendInvite: true, access: 'invite' as Access, password: '' });
  useEffect(() => {
    if (!open) return;
    setForm(
      user
        ? { email: user.email, fullName: user.fullName, role: user.role, departmentId: user.departmentId ?? '', title: user.title ?? '', sendInvite: false, access: 'invite', password: '' }
        : { email: '', fullName: '', role: 'reviewer', departmentId: '', title: '', sendInvite: true, access: 'invite', password: '' },
    );
  }, [open, user]);
  const withPassword = !user && form.access === 'password';
  const save = useApiMutation(
    () =>
      user
        ? api.patch(`/users/${user.id}`, { fullName: form.fullName, role: form.role, departmentId: form.departmentId || null, title: form.title || null })
        : api.post('/users', {
            email: form.email,
            fullName: form.fullName,
            role: form.role,
            departmentId: form.departmentId || undefined,
            title: form.title || undefined,
            sendInvite: !withPassword && form.sendInvite,
            password: withPassword ? form.password : undefined,
          }),
    {
      success: user ? 'Team member updated' : withPassword ? 'User created. They can sign in now.' : form.sendInvite ? 'Invitation sent' : 'Team member added',
      invalidate: [['users'], ['departments']],
      onSuccess: onClose,
    },
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={user ? 'Edit team member' : 'Add team member'}
      description={user ? user.email : withPassword ? 'Share the password with them securely. They can sign in right away.' : 'They receive an email to set their password and sign in.'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} disabled={!form.email || !form.fullName || (withPassword && form.password.length < 8)} onClick={() => save.mutate()}>
            {user ? 'Save' : withPassword ? 'Create user' : form.sendInvite ? 'Send invite' : 'Add member'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {!user && (
          <Field label="Email" required className="sm:col-span-2">
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoFocus />
          </Field>
        )}
        <Field label="Full name" required>
          <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        </Field>
        <Field label="Title">
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Engineering Manager" />
        </Field>
        <Field label="Department">
          <Select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
            <option value="">—</option>
            {(departments ?? []).map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Role" hint={ROLE_HELP[form.role]}>
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </Select>
        </Field>
        {!user && (
          <div className="space-y-3 sm:col-span-2">
            <Segmented<Access>
              options={[
                { value: 'invite', label: 'Email invitation' },
                { value: 'password', label: 'Set password now' },
              ]}
              value={form.access}
              onChange={(access) => setForm({ ...form, access })}
            />
            {withPassword ? (
              <Field label="Password" required hint="At least 8 characters">
                <Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </Field>
            ) : (
              <Checkbox checked={form.sendInvite} onChange={(e) => setForm({ ...form, sendInvite: e.target.checked })} label="Send invitation email now" />
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function SetPasswordModal({ user, onClose }: { user?: User; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  useEffect(() => {
    setPassword('');
    setConfirm('');
  }, [user]);
  const save = useApiMutation(() => api.post(`/users/${user!.id}/password`, { password }), { success: 'Password updated', invalidate: [['users']], onSuccess: onClose });
  return (
    <Modal
      open={!!user}
      onClose={onClose}
      size="sm"
      title="Set password"
      description={user?.email}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} disabled={password.length < 8 || password !== confirm} onClick={() => save.mutate()}>Set password</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="New password" hint="At least 8 characters">
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </Field>
        <Field label="Confirm password" error={confirm && password !== confirm ? 'Passwords do not match' : undefined}>
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function TeamTab() {
  const { me, hasRole } = useAuth();
  const isAdmin = hasRole('admin');
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState<Status>('');
  const [modal, setModal] = useState<{ open: boolean; user?: User }>({ open: false });
  const [passwordFor, setPasswordFor] = useState<User>();
  const [deleting, setDeleting] = useState<User | null>(null);
  const search = useDebounced(q);
  const list = useQuery({
    queryKey: ['users', 'list', { search, role, status }],
    queryFn: () => api.get<Paginated<User>>('/users', { q: search, role, active: status || undefined, pageSize: 200 }),
  });
  const update = useApiMutation((v: { id: string; body: Partial<User> }) => api.patch(`/users/${v.id}`, v.body), { success: 'Updated', invalidate: [['users']] });
  const resend = useApiMutation((id: string) => api.post(`/users/${id}/resend-invite`), { success: 'Invitation re-sent' });
  const sendReset = useApiMutation((id: string) => api.post(`/users/${id}/reset-password`), { success: 'Password reset email sent' });
  const remove = useApiMutation((id: string) => api.delete(`/users/${id}`), { success: 'User deleted', invalidate: [['users'], ['departments']] });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search team…" className="w-full sm:w-64" />
        <Select value={role} onChange={(e) => setRole(e.target.value)} className="w-full sm:w-44">
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value as Status)} className="w-full sm:w-40">
          <option value="">All statuses</option>
          <option value="true">Active</option>
          <option value="false">Deactivated</option>
        </Select>
        {isAdmin && (
          <Button className="sm:ml-auto" icon={<UserPlus className="size-4" />} onClick={() => setModal({ open: true })}>
            Add member
          </Button>
        )}
      </div>
      {list.isLoading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : !list.data?.data.length ? (
        <EmptyState icon={<Users className="size-5" />} title="No team members found" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Member</Th>
              <Th>Role</Th>
              <Th>Department</Th>
              <Th>Last active</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {list.data.data.map((u) => (
              <Tr key={u.id} className={!u.isActive ? 'opacity-50' : undefined}>
                <Td>
                  <div className="flex items-center gap-3">
                    <Avatar name={u.fullName || u.email} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-zinc-900">
                        {u.fullName || '—'} {u.id === me?.id && <span className="text-xs font-normal text-zinc-400">(you)</span>}
                      </p>
                      <p className="truncate text-xs text-zinc-500">{u.email}{u.title ? ` · ${u.title}` : ''}</p>
                    </div>
                  </div>
                </Td>
                <Td>
                  {isAdmin && u.id !== me?.id ? (
                    <Select value={u.role} onChange={(e) => update.mutate({ id: u.id, body: { role: e.target.value as Role } })} className="h-8 w-40 text-xs">
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                      ))}
                    </Select>
                  ) : (
                    <Badge tone={ROLE_TONE[u.role]}>{ROLE_LABEL[u.role]}</Badge>
                  )}
                </Td>
                <Td className="text-zinc-500">{u.departmentName ?? '—'}</Td>
                <Td className="text-zinc-500">
                  {!u.isActive ? <Badge tone="red">Deactivated</Badge> : u.hasLoggedIn ? fromNow(u.lastLoginAt) : <Badge tone="amber">Invited</Badge>}
                </Td>
                <Td className="text-right">
                  {isAdmin && u.id !== me?.id && (
                    <Menu
                      trigger={<Button size="xs" variant="ghost" icon={<Pencil className="size-3.5" />}>Manage</Button>}
                      items={[
                        { label: 'Edit details', icon: <Pencil className="size-4" />, onClick: () => setModal({ open: true, user: u }) },
                        !u.hasLoggedIn && u.isActive && { label: 'Resend invite', icon: <MailPlus className="size-4" />, onClick: () => resend.mutate(u.id) },
                        { label: 'Set password', icon: <KeyRound className="size-4" />, onClick: () => setPasswordFor(u) },
                        u.hasLoggedIn && u.isActive && { label: 'Send password reset', icon: <RotateCcw className="size-4" />, onClick: () => sendReset.mutate(u.id) },
                        { label: u.isActive ? 'Deactivate' : 'Reactivate', danger: u.isActive, onClick: () => update.mutate({ id: u.id, body: { isActive: !u.isActive } }) },
                        !u.hasLoggedIn && { label: 'Delete', icon: <Trash2 className="size-4" />, danger: true, onClick: () => setDeleting(u) },
                      ]}
                    />
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <UserModal open={modal.open} user={modal.user} onClose={() => setModal({ open: false })} />
      <SetPasswordModal user={passwordFor} onClose={() => setPasswordFor(undefined)} />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => remove.mutateAsync(deleting!.id)}
        danger
        title="Delete user?"
        message={`${deleting?.fullName || deleting?.email} has never signed in. They and their sign-in account will be removed permanently.`}
        confirmLabel="Delete"
      />
    </div>
  );
}

export function DepartmentsTab() {
  const { hasRole } = useAuth();
  const { data, isLoading } = useDepartments();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<Department | null>(null);
  const [editName, setEditName] = useState('');
  const [deleting, setDeleting] = useState<Department | null>(null);
  const create = useApiMutation(() => api.post('/departments', { name }), { success: 'Department added', invalidate: [['departments']], onSuccess: () => setName('') });
  const rename = useApiMutation(() => api.patch(`/departments/${editing!.id}`, { name: editName }), { success: 'Renamed', invalidate: [['departments']], onSuccess: () => setEditing(null) });
  const remove = useApiMutation((id: string) => api.delete(`/departments/${id}`), { success: 'Department deleted', invalidate: [['departments'], ['users']] });

  return (
    <Card className="max-w-2xl">
      <form
        className="mb-5 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New department name, e.g. Engineering" />
        <Button type="submit" icon={<Plus className="size-4" />} loading={create.isPending} disabled={!name.trim()}>Add</Button>
      </form>
      {isLoading ? (
        <Spinner />
      ) : !data?.length ? (
        <EmptyState icon={<Building2 className="size-5" />} title="No departments yet" />
      ) : (
        <ul className="divide-y divide-zinc-100">
          {data.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-2.5">
              {editing?.id === d.id ? (
                <form
                  className="flex flex-1 gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    rename.mutate();
                  }}
                >
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus className="h-8" />
                  <Button size="sm" type="submit" loading={rename.isPending}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                </form>
              ) : (
                <>
                  <Building2 className="size-4 text-zinc-400" />
                  <span className="flex-1 text-sm font-medium text-zinc-800">{d.name}</span>
                  <span className="text-xs text-zinc-500">{d.userCount} member{d.userCount === 1 ? '' : 's'}</span>
                  <Button size="xs" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => { setEditing(d); setEditName(d.name); }} />
                  {hasRole('admin') && <Button size="xs" variant="ghost" className="text-red-500 hover:bg-red-50" icon={<Trash2 className="size-3.5" />} onClick={() => setDeleting(d)} />}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => remove.mutateAsync(deleting!.id)}
        danger
        title="Delete department?"
        message={`“${deleting?.name}” will be removed. Members and jobs will no longer be assigned to it.`}
        confirmLabel="Delete"
      />
    </Card>
  );
}
