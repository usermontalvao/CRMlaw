import React, { useEffect, useState } from 'react';
import {
  Mail, Phone, FileText, LogOut, Clock, ShieldCheck,
  UserCircle2, MessageCircle, Pencil, X, Check, Lock,
  Loader2, AlertCircle, CheckCircle2, Info, MapPin, Briefcase,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { clientPortalService, type ClientProfile, type ProfileUpdateRequest } from '../services/clientPortal.service';
import { formatCPF, formatDate } from '../components/PortalUI';
import { ClientAvatar } from '../components/ClientAvatar';

const MARITAL_OPTIONS: { value: string; label: string }[] = [
  { value: 'solteiro', label: 'Solteiro(a)' },
  { value: 'casado', label: 'Casado(a)' },
  { value: 'divorciado', label: 'Divorciado(a)' },
  { value: 'viuvo', label: 'Viúvo(a)' },
  { value: 'uniao_estavel', label: 'União Estável' },
];

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits.length ? `(${digits}` : '';
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

const FIELD_LABELS: Record<string, string> = {
  full_name: 'Nome completo',
  email: 'E-mail',
  phone: 'Telefone',
  birth_date: 'Data de nascimento',
  marital_status: 'Estado civil',
  profession: 'Profissão',
  nationality: 'Nacionalidade',
  address_street: 'Rua',
  address_number: 'Número',
  address_neighborhood: 'Bairro',
  address_city: 'Cidade',
  address_state: 'UF',
  address_zip_code: 'CEP',
};

const inputCls = 'w-full rounded-lg border border-slate-200 bg-[#f8f7f5] px-3 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100';

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{label}</label>
    {children}
  </div>
);

export const PortalProfile: React.FC = () => {
  const { session, logout } = useClientAuth();
  const [officePhone, setOfficePhone] = useState<string>('');

  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ClientProfile>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [requests, setRequests] = useState<ProfileUpdateRequest[]>([]);

  useEffect(() => {
    let mounted = true;
    clientPortalService.getOfficeContact().then((contact) => {
      if (mounted && contact?.phone) {
        const digits = contact.phone.replace(/\D/g, '');
        setOfficePhone(digits.startsWith('55') ? digits : `55${digits}`);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const loadProfile = async (userId: string) => {
    setProfileLoading(true);
    const [loadedProfile, loadedRequests] = await Promise.all([
      clientPortalService.getProfile(userId),
      clientPortalService.listProfileRequests(userId),
    ]);
    setProfile(loadedProfile);
    setRequests(loadedRequests);
    setProfileLoading(false);
  };

  useEffect(() => {
    if (session?.user?.id) loadProfile(session.user.id);
  }, [session?.user?.id]);

  if (!session) return null;

  const name = profile?.full_name || session.client.nome || 'Cliente';
  const email = profile?.email || session.client.email || 'Sem e-mail';
  const phone = profile?.phone || session.client.telefone || 'Sem telefone';
  const pending = requests.find((request) => request.status === 'pending');
  const lastApproved = requests.find((request) => request.status === 'approved');
  const lastRejected = requests.find((request) => request.status === 'rejected' && request.rejection_reason && !request.rejection_reason.includes('Substituída'));

  const set = (key: keyof ClientProfile) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const startEdit = () => {
    setForm({
      full_name: profile?.full_name || session.client.nome || '',
      email: profile?.email || session.client.email || '',
      phone: maskPhone(profile?.phone || session.client.telefone || ''),
      birth_date: profile?.birth_date || '',
      marital_status: profile?.marital_status || '',
      profession: profile?.profession || '',
      nationality: profile?.nationality || '',
      address_street: profile?.address_street || '',
      address_number: profile?.address_number || '',
      address_neighborhood: profile?.address_neighborhood || '',
      address_city: profile?.address_city || '',
      address_state: profile?.address_state || '',
      address_zip_code: profile?.address_zip_code || '',
    });
    setSaveError(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setSaveError(null);
  };

  const handleSave = async () => {
    if (!session.user.id) return;

    const base: ClientProfile = {
      full_name: profile?.full_name || session.client.nome || '',
      email: profile?.email || session.client.email || '',
      phone: profile?.phone || session.client.telefone || '',
      birth_date: profile?.birth_date || '',
      marital_status: profile?.marital_status || '',
      profession: profile?.profession || '',
      nationality: profile?.nationality || '',
      address_street: profile?.address_street || '',
      address_number: profile?.address_number || '',
      address_neighborhood: profile?.address_neighborhood || '',
      address_city: profile?.address_city || '',
      address_state: profile?.address_state || '',
      address_zip_code: profile?.address_zip_code || '',
    };

    const rawPhone = (value: string) => value.replace(/\D/g, '');
    const changes: ClientProfile = {};

    (Object.keys(form) as (keyof ClientProfile)[]).forEach((key) => {
      let nextValue = (form[key] || '').toString().trim();
      let baseValue = (base[key] || '').toString();
      if (key === 'phone') {
        nextValue = rawPhone(nextValue);
        baseValue = rawPhone(baseValue);
      }
      if (nextValue && nextValue !== baseValue) {
        changes[key] = (key === 'phone' ? nextValue : form[key]) as never;
      }
    });

    if (Object.keys(changes).length === 0) {
      cancelEdit();
      return;
    }

    setSaving(true);
    setSaveError(null);
    const result = await clientPortalService.requestProfileUpdate(session.user.id, changes);
    setSaving(false);

    if (!result) {
      setSaveError('Não foi possível enviar. Tente novamente.');
      return;
    }

    await loadProfile(session.user.id);
    setEditing(false);
  };

  const handleLogout = () => {
    if (confirm('Deseja realmente sair do portal?')) {
      logout();
      window.location.hash = '';
      window.location.href = '/portal';
    }
  };

  const personalRows = [
    { label: 'Nome', value: profile?.full_name || session.client.nome, icon: <UserCircle2 className="h-4 w-4" /> },
    { label: 'E-mail', value: profile?.email || session.client.email, icon: <Mail className="h-4 w-4" /> },
    { label: 'Telefone', value: profile?.phone || session.client.telefone, icon: <Phone className="h-4 w-4" /> },
    { label: 'Nascimento', value: profile?.birth_date ? formatDate(profile.birth_date) : null, icon: <Clock className="h-4 w-4" /> },
    { label: 'Estado civil', value: MARITAL_OPTIONS.find((option) => option.value === profile?.marital_status)?.label ?? profile?.marital_status, icon: <ShieldCheck className="h-4 w-4" /> },
    { label: 'Profissão', value: profile?.profession, icon: <Briefcase className="h-4 w-4" /> },
    { label: 'Nacionalidade', value: profile?.nationality, icon: <Info className="h-4 w-4" /> },
  ].filter((row) => row.value);

  const addressRows = [
    { label: 'Rua', value: [profile?.address_street, profile?.address_number].filter(Boolean).join(', '), icon: <MapPin className="h-4 w-4" /> },
    { label: 'Bairro', value: profile?.address_neighborhood, icon: <MapPin className="h-4 w-4" /> },
    { label: 'Cidade / UF', value: [profile?.address_city, profile?.address_state].filter(Boolean).join(' — '), icon: <MapPin className="h-4 w-4" /> },
    { label: 'CEP', value: profile?.address_zip_code, icon: <MapPin className="h-4 w-4" /> },
  ].filter((row) => row.value);

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100vh-2.5rem)] lg:overflow-hidden">
      <div className="grid gap-4 lg:min-h-0 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-3">
          <div className="rounded-[22px] border border-slate-200 bg-[#f8f7f5] p-5 shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-50 text-orange-600 ring-1 ring-orange-100">
                  <UserCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <h1 className="text-lg font-bold text-slate-900">Meu perfil</h1>
                  <p className="text-xs text-slate-500">Dados cadastrais</p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                ativo
              </span>
            </div>

            <div className="mt-5 flex items-center gap-3">
              <ClientAvatar size={56} rounded="2xl" className="shadow-none" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-slate-900">{name}</p>
                <p className="mt-0.5 truncate text-[12px] text-slate-500">{email}</p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">CPF</p>
              <div className="mt-1 flex items-center gap-2">
                <Lock className="h-3.5 w-3.5 text-slate-400" />
                <p className="text-sm font-semibold text-slate-900">{formatCPF(profile?.cpf || session.user.cpf)}</p>
              </div>
            </div>

            <div className="mt-3 grid gap-2">
              <SummaryItem icon={<Mail className="h-4 w-4" />} label="E-mail" value={email} />
              <SummaryItem icon={<Phone className="h-4 w-4" />} label="Telefone" value={phone} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <a
              href={officePhone ? `https://wa.me/${officePhone}` : 'mailto:contato@jurius.com.br'}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-3 rounded-[20px] border border-slate-200 bg-[#f8f7f5] p-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)] transition hover:border-emerald-200 hover:shadow-[0_14px_28px_rgba(15,23,42,0.06)]"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white">
                <MessageCircle className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">Preciso de ajuda</p>
                <p className="text-xs text-slate-500">Falar com o escritório</p>
              </div>
              <ChevronRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5" />
            </a>

            <button
              onClick={handleLogout}
              className="group flex items-center gap-3 rounded-[20px] border border-rose-200 bg-[#f8f7f5] p-4 text-left shadow-[0_10px_24px_rgba(15,23,42,0.04)] transition hover:bg-rose-50 hover:shadow-[0_14px_28px_rgba(15,23,42,0.06)]"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500 text-white">
                <LogOut className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-rose-700">Sair do portal</p>
                <p className="text-xs text-rose-600/80">Encerrar sessão</p>
              </div>
            </button>
          </div>
        </aside>

        <section className="flex min-h-0 flex-col rounded-[22px] border border-slate-200 bg-[#f8f7f5] shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">{editing ? 'Atualizar dados' : 'Dados do cliente'}</h2>
              <p className="text-xs text-slate-500">
                {editing ? 'Envie alterações para aprovação do escritório.' : 'Visualize e mantenha seus dados atualizados.'}
              </p>
            </div>

            {!profileLoading && !editing && !pending && (
              <button
                onClick={startEdit}
                className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-orange-600"
              >
                <Pencil className="h-4 w-4" /> Editar
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-5">
            {profileLoading ? (
              <div className="flex h-full min-h-[240px] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
              </div>
            ) : !editing ? (
              <div className="flex flex-col gap-3">
                {pending && (
                  <Banner tone="warning" title="Alteração aguardando aprovação">
                    <p>
                      Enviado em {formatDate(pending.requested_at, { withTime: true })} — o escritório analisará em breve.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {Object.entries(pending.changes).map(([key, value]) => value && (
                        <span key={key} className="rounded-lg bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                          {FIELD_LABELS[key] || key}: {value}
                        </span>
                      ))}
                    </div>
                  </Banner>
                )}

                {!pending && lastApproved && (
                  <Banner tone="success" title="Solicitação aprovada">
                    <p>Sua última solicitação foi aprovada pelo escritório.</p>
                  </Banner>
                )}

                {!pending && lastRejected && (
                  <Banner tone="danger" title="Solicitação não aprovada">
                    <p>{lastRejected.rejection_reason}</p>
                  </Banner>
                )}

                <DataCard title="Dados pessoais" icon={<UserCircle2 className="h-4 w-4" />}>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {personalRows.map((row) => (
                      <DataRow key={row.label} label={row.label} value={row.value as string} />
                    ))}
                  </div>
                </DataCard>

                {addressRows.length > 0 && (
                  <DataCard title="Endereço" icon={<MapPin className="h-4 w-4" />}>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
                      {addressRows.map((row) => (
                        <DataRow key={row.label} label={row.label} value={row.value as string} />
                      ))}
                    </div>
                  </DataCard>
                )}
              </div>
            ) : (
              <div className="flex h-full flex-col">
                <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
                  <div className="flex items-center gap-2">
                    <Lock className="h-3.5 w-3.5 text-slate-400" />
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">CPF não editável</p>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-slate-600">{formatCPF(session.user.cpf)}</p>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                  <div className="grid gap-4">
                    <FormSection title="Dados pessoais">
                      <Field label="Nome completo">
                        <input type="text" value={form.full_name || ''} onChange={set('full_name')} className={inputCls} placeholder="Seu nome completo" />
                      </Field>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="E-mail">
                          <input type="email" value={form.email || ''} onChange={set('email')} className={inputCls} placeholder="seu@email.com" />
                        </Field>
                        <Field label="Telefone">
                          <input
                            type="tel"
                            value={form.phone || ''}
                            onChange={(event) => setForm((current) => ({ ...current, phone: maskPhone(event.target.value) }))}
                            className={inputCls}
                            placeholder="(65) 9 0000-0000"
                            maxLength={16}
                          />
                        </Field>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Data de nascimento">
                          <input type="date" value={form.birth_date || ''} onChange={set('birth_date')} className={inputCls} />
                        </Field>
                        <Field label="Estado civil">
                          <div className="relative">
                            <select value={form.marital_status || ''} onChange={set('marital_status')} className={`${inputCls} appearance-none pr-8`}>
                              <option value="">Selecionar</option>
                              {MARITAL_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                          </div>
                        </Field>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Profissão">
                          <input type="text" value={form.profession || ''} onChange={set('profession')} className={inputCls} placeholder="Ex: Engenheiro" />
                        </Field>
                        <Field label="Nacionalidade">
                          <input type="text" value={form.nationality || ''} onChange={set('nationality')} className={inputCls} placeholder="Ex: Brasileiro(a)" />
                        </Field>
                      </div>
                    </FormSection>

                    <FormSection title="Endereço">
                      <div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
                        <Field label="CEP">
                          <input type="text" value={form.address_zip_code || ''} onChange={set('address_zip_code')} className={inputCls} placeholder="00000-000" maxLength={9} />
                        </Field>
                        <Field label="Rua / Avenida">
                          <input type="text" value={form.address_street || ''} onChange={set('address_street')} className={inputCls} placeholder="Nome da rua" />
                        </Field>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)_100px]">
                        <Field label="Número">
                          <input type="text" value={form.address_number || ''} onChange={set('address_number')} className={inputCls} placeholder="123" />
                        </Field>
                        <Field label="Bairro">
                          <input type="text" value={form.address_neighborhood || ''} onChange={set('address_neighborhood')} className={inputCls} placeholder="Bairro" />
                        </Field>
                        <Field label="UF">
                          <input type="text" value={form.address_state || ''} onChange={set('address_state')} className={inputCls} placeholder="SP" maxLength={2} />
                        </Field>
                      </div>

                      <Field label="Cidade">
                        <input type="text" value={form.address_city || ''} onChange={set('address_city')} className={inputCls} placeholder="Cidade" />
                      </Field>
                    </FormSection>

                    <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                      <p className="text-[11px] leading-relaxed text-slate-500">
                        A alteração ficará <strong>pendente de aprovação</strong> pelo escritório antes de ser efetivada.
                      </p>
                    </div>

                    {saveError && (
                      <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200">{saveError}</p>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex gap-2.5 border-t border-slate-200 pt-4">
                  <button
                    onClick={cancelEdit}
                    disabled={saving}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-[#f8f7f5] py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    <X className="h-4 w-4" /> Cancelar
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-orange-500 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-orange-600 active:scale-[0.98] disabled:opacity-60"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    {saving ? 'Enviando...' : 'Solicitar alteração'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

const SummaryItem: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
    <div className="mt-0.5 text-slate-400">{icon}</div>
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="truncate text-[13px] font-medium text-slate-700">{value}</p>
    </div>
  </div>
);

const Banner: React.FC<{ tone: 'warning' | 'success' | 'danger'; title: string; children: React.ReactNode }> = ({ tone, title, children }) => {
  const styles = {
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    danger: 'border-rose-200 bg-rose-50 text-rose-800',
  }[tone];

  const Icon = tone === 'success' ? CheckCircle2 : AlertCircle;

  return (
    <div className={`rounded-2xl border px-4 py-3 ${styles}`}>
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 text-xs leading-relaxed">
          <p className="font-bold">{title}</p>
          <div className="mt-0.5">{children}</div>
        </div>
      </div>
    </div>
  );
};

const DataCard: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => (
  <div className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-4">
    <div className="mb-3 flex items-center gap-2 text-slate-500">
      {icon}
      <p className="text-[10px] font-bold uppercase tracking-[0.16em]">{title}</p>
    </div>
    {children}
  </div>
);

const DataRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-xl border border-slate-200 bg-[#f8f7f5] px-3 py-2.5">
    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</p>
    <p className="mt-1 text-[13px] font-medium leading-relaxed text-slate-800 break-words">{value}</p>
  </div>
);

const FormSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-4">
    <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{title}</p>
    <div className="grid gap-3">{children}</div>
  </div>
);

export default PortalProfile;
