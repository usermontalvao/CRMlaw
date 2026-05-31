import React, { useEffect, useState } from 'react';
import {
  Mail, Phone, FileText, LogOut, Clock, ShieldCheck,
  UserCircle2, MessageCircle, Pencil, X, Check, Lock,
  Loader2, AlertCircle, CheckCircle2, Info, MapPin, Briefcase,
  ChevronDown,
} from 'lucide-react';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { clientPortalService, type ClientProfile, type ProfileUpdateRequest } from '../services/clientPortal.service';
import { formatCPF, formatDate } from '../components/PortalUI';
import { ClientAvatar } from '../components/ClientAvatar';

const MARITAL_OPTIONS: { value: string; label: string }[] = [
  { value: 'solteiro',      label: 'Solteiro(a)' },
  { value: 'casado',        label: 'Casado(a)' },
  { value: 'divorciado',    label: 'Divorciado(a)' },
  { value: 'viuvo',         label: 'Viúvo(a)' },
  { value: 'uniao_estavel', label: 'União Estável' },
];

function maskPhone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0,2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
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

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</label>
    {children}
  </div>
);

const inputCls = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100";

export const PortalProfile: React.FC = () => {
  const { session, logout } = useClientAuth();
  const [officePhone, setOfficePhone] = useState<string>('');

  // Perfil completo carregado do banco
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ClientProfile>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Pending requests
  const [requests, setRequests] = useState<ProfileUpdateRequest[]>([]);

  useEffect(() => {
    let mounted = true;
    clientPortalService.getOfficeContact().then((c) => {
      if (mounted && c?.phone) {
        const d = c.phone.replace(/\D/g, '');
        setOfficePhone(d.startsWith('55') ? d : `55${d}`);
      }
    });
    return () => { mounted = false; };
  }, []);

  const loadProfile = async (userId: string) => {
    setProfileLoading(true);
    const [p, reqs] = await Promise.all([
      clientPortalService.getProfile(userId),
      clientPortalService.listProfileRequests(userId),
    ]);
    setProfile(p);
    setRequests(reqs);
    setProfileLoading(false);
  };

  useEffect(() => {
    if (session?.user?.id) loadProfile(session.user.id);
  }, [session?.user?.id]);

  if (!session) return null;

  const name = profile?.full_name || session.client.nome || 'Cliente';
  const pending = requests.find((r) => r.status === 'pending');

  const set = (k: keyof ClientProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const startEdit = () => {
    setForm({
      full_name:            profile?.full_name            || session.client.nome      || '',
      email:                profile?.email                || session.client.email     || '',
      phone:                maskPhone(profile?.phone || session.client.telefone || ''),
      birth_date:           profile?.birth_date           || '',
      marital_status:       profile?.marital_status       || '',
      profession:           profile?.profession           || '',
      nationality:          profile?.nationality          || '',
      address_street:       profile?.address_street       || '',
      address_number:       profile?.address_number       || '',
      address_neighborhood: profile?.address_neighborhood || '',
      address_city:         profile?.address_city         || '',
      address_state:        profile?.address_state        || '',
      address_zip_code:     profile?.address_zip_code     || '',
    });
    setSaveError(null);
    setEditing(true);
  };

  const cancelEdit = () => { setEditing(false); setSaveError(null); };

  const handleSave = async () => {
    if (!session.user.id) return;
    const base: ClientProfile = {
      full_name:            profile?.full_name            || session.client.nome     || '',
      email:                profile?.email                || session.client.email    || '',
      phone:                profile?.phone                || session.client.telefone || '',
      birth_date:           profile?.birth_date           || '',
      marital_status:       profile?.marital_status       || '',
      profession:           profile?.profession           || '',
      nationality:          profile?.nationality          || '',
      address_street:       profile?.address_street       || '',
      address_number:       profile?.address_number       || '',
      address_neighborhood: profile?.address_neighborhood || '',
      address_city:         profile?.address_city         || '',
      address_state:        profile?.address_state        || '',
      address_zip_code:     profile?.address_zip_code     || '',
    };
    const rawPhone = (v: string) => v.replace(/\D/g, '');
    const changes: ClientProfile = {};
    (Object.keys(form) as (keyof ClientProfile)[]).forEach((k) => {
      let v = (form[k] || '').toString().trim();
      let b = (base[k] || '').toString();
      if (k === 'phone') { v = rawPhone(v); b = rawPhone(b); }
      if (v && v !== b) changes[k] = (k === 'phone' ? v : form[k]) as never;
    });

    if (Object.keys(changes).length === 0) { cancelEdit(); return; }

    setSaving(true); setSaveError(null);
    const result = await clientPortalService.requestProfileUpdate(session.user.id, changes);
    setSaving(false);

    if (!result) { setSaveError('Não foi possível enviar. Tente novamente.'); return; }
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

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-orange-600 ring-1 ring-orange-100">
          <UserCircle2 className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Meu Perfil</h1>
          <p className="text-sm text-slate-500">Seus dados cadastrais no escritório</p>
        </div>
      </div>

      {/* ── Card principal ── */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {/* Hero */}
        <div className="relative bg-gradient-to-br from-slate-900 to-slate-800 px-6 pb-6 pt-8 text-center">
          <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-orange-500 via-amber-400 to-orange-500" />
          <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-orange-500/10 blur-3xl" />
          <div className="relative flex flex-col items-center">
            <ClientAvatar size={88} rounded="2xl" ring className="shadow-xl" />
            <h2 className="mt-3 break-words text-lg font-bold text-white sm:text-xl">{name}</h2>
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-400/30">
              <ShieldCheck className="h-3 w-3" /> Conta ativa
            </span>
          </div>
        </div>

        {/* Corpo */}
        <div className="p-5 sm:p-6">
          {profileLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
            </div>
          ) : !editing ? (
            /* ── Visualização ── */
            <>
              {/* CPF bloqueado */}
              <div className="mb-4 flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-slate-400 ring-1 ring-slate-200">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">CPF</p>
                    <Lock className="h-2.5 w-2.5 text-slate-300" />
                  </div>
                  <p className="mt-0.5 text-sm font-semibold text-slate-900">{formatCPF(session.user.cpf)}</p>
                </div>
              </div>

              {/* Dados pessoais */}
              <Section icon={<UserCircle2 className="h-3.5 w-3.5" />} title="Dados pessoais">
                <Row label="Nome" value={profile?.full_name || session.client.nome} icon={<UserCircle2 className="h-4 w-4" />} />
                <Row label="E-mail" value={profile?.email || session.client.email} icon={<Mail className="h-4 w-4" />} />
                <Row label="Telefone" value={profile?.phone || session.client.telefone} icon={<Phone className="h-4 w-4" />} />
                <Row label="Nascimento" value={profile?.birth_date ? formatDate(profile.birth_date) : null} icon={<Clock className="h-4 w-4" />} />
                <Row label="Estado civil" value={MARITAL_OPTIONS.find((o) => o.value === profile?.marital_status)?.label ?? profile?.marital_status} icon={<ShieldCheck className="h-4 w-4" />} />
                <Row label="Profissão" value={profile?.profession} icon={<Briefcase className="h-4 w-4" />} />
                <Row label="Nacionalidade" value={profile?.nationality} icon={<Info className="h-4 w-4" />} />
              </Section>

              {/* Endereço */}
              {(profile?.address_street || profile?.address_city) && (
                <Section icon={<MapPin className="h-3.5 w-3.5" />} title="Endereço" className="mt-3">
                  <Row label="Rua" value={[profile?.address_street, profile?.address_number].filter(Boolean).join(', ')} icon={<MapPin className="h-4 w-4" />} />
                  <Row label="Bairro" value={profile?.address_neighborhood} icon={<MapPin className="h-4 w-4" />} />
                  <Row label="Cidade / UF" value={[profile?.address_city, profile?.address_state].filter(Boolean).join(' — ')} icon={<MapPin className="h-4 w-4" />} />
                  <Row label="CEP" value={profile?.address_zip_code} icon={<MapPin className="h-4 w-4" />} />
                </Section>
              )}

              {/* Status de solicitação */}
              {pending ? (
                <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-amber-800">Alteração aguardando aprovação</p>
                    <p className="mt-0.5 text-xs text-amber-700">
                      Enviado em {formatDate(pending.requested_at, { withTime: true })} — o escritório analisará em breve.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {Object.entries(pending.changes).map(([k, v]) => v && (
                        <span key={k} className="rounded-lg bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                          {FIELD_LABELS[k] || k}: {v}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ) : requests.find((r) => r.status === 'approved') ? (
                <div className="mt-4 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <p className="text-xs text-emerald-800">Sua última solicitação foi <strong>aprovada</strong> pelo escritório.</p>
                </div>
              ) : requests.find((r) => r.status === 'rejected' && r.rejection_reason && !r.rejection_reason.includes('Substituída')) ? (
                <div className="mt-4 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                  <div>
                    <p className="text-xs font-bold text-rose-800">Solicitação não aprovada</p>
                    <p className="mt-0.5 text-xs text-rose-700">{requests.find((r) => r.status === 'rejected')?.rejection_reason}</p>
                  </div>
                </div>
              ) : null}

              {!pending && (
                <button
                  onClick={startEdit}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-sm font-bold text-white shadow-sm transition active:scale-[0.98] hover:bg-orange-600"
                >
                  <Pencil className="h-4 w-4" /> Atualizar meus dados
                </button>
              )}
            </>
          ) : (
            /* ── Formulário de edição ── */
            <div className="flex flex-col gap-4">
              {/* CPF bloqueado */}
              <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-3.5">
                <Lock className="h-4 w-4 shrink-0 text-slate-400" />
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">CPF — não editável</p>
                  <p className="mt-0.5 text-sm font-semibold text-slate-500">{formatCPF(session.user.cpf)}</p>
                </div>
              </div>

              {/* Dados pessoais */}
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Dados pessoais</p>

              <Field label="Nome completo">
                <input type="text" value={form.full_name || ''} onChange={set('full_name')} className={inputCls} placeholder="Seu nome completo" />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="E-mail">
                  <input type="email" value={form.email || ''} onChange={set('email')} className={inputCls} placeholder="seu@email.com" />
                </Field>
                <Field label="Telefone">
                  <input
                    type="tel"
                    value={form.phone || ''}
                    onChange={(e) => setForm((f) => ({ ...f, phone: maskPhone(e.target.value) }))}
                    className={inputCls}
                    placeholder="(65) 9 0000-0000"
                    maxLength={16}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Data de nascimento">
                  <input type="date" value={form.birth_date || ''} onChange={set('birth_date')} className={inputCls} />
                </Field>
                <Field label="Estado civil">
                  <div className="relative">
                    <select value={form.marital_status || ''} onChange={set('marital_status')} className={`${inputCls} appearance-none pr-8`}>
                      <option value="">Selecionar</option>
                      {MARITAL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  </div>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Profissão">
                  <input type="text" value={form.profession || ''} onChange={set('profession')} className={inputCls} placeholder="Ex: Engenheiro" />
                </Field>
                <Field label="Nacionalidade">
                  <input type="text" value={form.nationality || ''} onChange={set('nationality')} className={inputCls} placeholder="Ex: Brasileiro(a)" />
                </Field>
              </div>

              {/* Endereço */}
              <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Endereço</p>

              <Field label="CEP">
                <input type="text" value={form.address_zip_code || ''} onChange={set('address_zip_code')} className={inputCls} placeholder="00000-000" maxLength={9} />
              </Field>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Field label="Rua / Avenida">
                    <input type="text" value={form.address_street || ''} onChange={set('address_street')} className={inputCls} placeholder="Nome da rua" />
                  </Field>
                </div>
                <Field label="Número">
                  <input type="text" value={form.address_number || ''} onChange={set('address_number')} className={inputCls} placeholder="123" />
                </Field>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Field label="Bairro">
                  <input type="text" value={form.address_neighborhood || ''} onChange={set('address_neighborhood')} className={inputCls} placeholder="Bairro" />
                </Field>
                <Field label="Cidade">
                  <input type="text" value={form.address_city || ''} onChange={set('address_city')} className={inputCls} placeholder="Cidade" />
                </Field>
                <Field label="UF">
                  <input type="text" value={form.address_state || ''} onChange={set('address_state')} className={inputCls} placeholder="SP" maxLength={2} />
                </Field>
              </div>

              {/* Aviso */}
              <div className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                <p className="text-[11px] leading-relaxed text-slate-500">
                  A alteração ficará <strong>pendente de aprovação</strong> pelo escritório antes de ser efetivada.
                </p>
              </div>

              {saveError && (
                <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200">{saveError}</p>
              )}

              <div className="flex gap-2.5">
                <button
                  onClick={cancelEdit}
                  disabled={saving}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
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
      </div>

      {/* ── Ações ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <a
          href={officePhone ? `https://wa.me/${officePhone}` : 'mailto:contato@jurius.com.br'}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition active:scale-[0.99] hover:shadow-md"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white">
            <MessageCircle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">Preciso de ajuda</p>
            <p className="text-xs text-slate-500">Falar com o escritório</p>
          </div>
        </a>

        <button
          onClick={handleLogout}
          className="group flex items-center gap-3 rounded-2xl border border-rose-200 bg-white p-4 text-left shadow-sm transition active:scale-[0.99] hover:bg-rose-50 hover:shadow-md"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500 text-white">
            <LogOut className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-rose-700">Sair do portal</p>
            <p className="text-xs text-rose-600/80">Encerrar sessão neste dispositivo</p>
          </div>
        </button>
      </div>

      <p className="pt-1 text-center text-[11px] text-slate-400">Portal do Cliente · Jurius</p>
    </div>
  );
};

// ── Subcomponentes de visualização ──────────────────────────────────────────

const Section: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode; className?: string }> = ({ icon, title, children, className }) => (
  <div className={`rounded-2xl border border-slate-100 bg-slate-50/40 p-4 ${className || ''}`}>
    <div className="mb-3 flex items-center gap-1.5 text-slate-400">
      {icon}
      <p className="text-[10px] font-bold uppercase tracking-wider">{title}</p>
    </div>
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">{children}</div>
  </div>
);

const Row: React.FC<{ label: string; value?: string | null; icon: React.ReactNode }> = ({ label, value }) => {
  if (!value) return null;
  return (
    <div>
      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-slate-800 break-words">{value}</p>
    </div>
  );
};

export default PortalProfile;
