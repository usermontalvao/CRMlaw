import React, { useEffect, useMemo, useState } from 'react';
import {
  FileSignature,
  ExternalLink,
  CheckCircle2,
  Clock,
  Users,
  CalendarClock,
  AlertTriangle,
  PenTool,
  ChevronRight,
  Eye,
} from 'lucide-react';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { clientPortalService } from '../services/clientPortal.service';
import {
  EmptyState,
  SkeletonCard,
  StatusBadge,
  formatDate,
  formatRelative,
} from '../components/PortalUI';

interface Signer {
  id: string;
  email?: string;
  auth_email?: string;
  name?: string;
  status?: string;
  access_token?: string;
  token?: string;
  public_token?: string;
  order?: number;
  signed_at?: string;
}

interface SignatureRequest {
  id: string;
  title?: string;
  document_name?: string;
  status?: string;
  created_at?: string;
  expires_at?: string;
  public_token?: string;
  signers?: Signer[];
  deleted_at?: string | null;
  archived_at?: string | null;
  blocked_at?: string | null;
}

type Tab = 'pending' | 'signed' | 'all';

function isBlocked(s: SignatureRequest): boolean {
  if (s.deleted_at || s.archived_at || s.blocked_at) return true;
  return (s.status || '').toLowerCase() === 'cancelled';
}

function resolveSignUrl(s: SignatureRequest, clientEmail?: string): string | null {
  const all = s.signers || [];

  // 1. match por email ou auth_email
  const me = findMe(all, clientEmail);
  const myToken = me?.access_token || me?.token || (me as any)?.public_token;
  if (myToken) return `/#/assinar/${myToken}`;

  // 2. qualquer token disponível
  for (const sg of all) {
    const t = sg.access_token || sg.token || (sg as any)?.public_token;
    if (t) return `/#/assinar/${t}`;
  }

  return null;
}

function findMe(signers: Signer[], clientEmail?: string): Signer | undefined {
  if (!clientEmail) return undefined;
  const e = clientEmail.toLowerCase();
  return signers.find(
    (sg) =>
      sg.email?.toLowerCase() === e ||
      (sg as any).auth_email?.toLowerCase() === e
  );
}

function getStatus(s: SignatureRequest, clientEmail?: string): { isPending: boolean; isExpired: boolean; label: string; badge: string; iAmSigner: boolean } {
  const all = s.signers || [];
  const me = findMe(all, clientEmail);
  const allSigned = all.length > 0 && all.every((sg) => sg.status === 'signed');

  // Servidor confirmou como concluído
  if (s.status === 'signed' || s.status === 'completed') {
    return { isPending: false, isExpired: false, label: 'Concluído', badge: 'signed', iAmSigner: !!me };
  }

  // Expirado
  const expired = !!s.expires_at && new Date(s.expires_at) < new Date();
  if (s.status === 'expired' || expired) {
    return { isPending: false, isExpired: true, label: 'Expirado', badge: 'expired', iAmSigner: !!me };
  }

  // Eu assinei
  if (me?.status === 'signed') {
    return { isPending: false, isExpired: false, label: 'Você assinou', badge: 'signed', iAmSigner: true };
  }

  // Eu sou signatário mas ainda não assinei
  if (me && me.status !== 'signed') {
    return { isPending: true, isExpired: false, label: 'Assinar agora', badge: 'pending', iAmSigner: true };
  }

  // Não estou na lista de signatários
  if (allSigned) {
    // Todos já assinaram — processo concluído
    return { isPending: false, isExpired: false, label: 'Concluído', badge: 'signed', iAmSigner: false };
  }

  // Pendente genérico (processo em andamento, aguardando outros)
  return { isPending: false, isExpired: false, label: 'Em andamento', badge: 'in_progress', iAmSigner: false };
}

export const PortalSignatures: React.FC = () => {
  const { session } = useClientAuth();
  const [items, setItems] = useState<SignatureRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('pending');

  useEffect(() => {
    if (!session) return;
    let mounted = true;
    setLoading(true);
    clientPortalService
      .listSignaturesPending(session.user.id)
      .then((data) => {
        if (mounted) setItems((data as SignatureRequest[]).filter((s) => !isBlocked(s)));
      })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [session]);

  const clientEmail = session?.client.email ?? undefined;

  const counts = useMemo(() => {
    let pending = 0, signed = 0;
    items.forEach((s) => {
      if (getStatus(s, clientEmail).isPending) pending++;
      else signed++;
    });
    return { pending, signed, all: items.length };
  }, [items, clientEmail]);

  const filtered = useMemo(() => {
    if (tab === 'all') return items;
    return items.filter((s) => {
      const st = getStatus(s, clientEmail);
      if (tab === 'pending') return st.isPending;
      if (tab === 'signed')  return !st.isPending && !st.isExpired;
      return true;
    });
  }, [items, tab, clientEmail]);

  const TABS = [
    { key: 'pending' as Tab, label: 'Pendentes', count: counts.pending },
    { key: 'signed'  as Tab, label: 'Assinados',  count: counts.signed },
    { key: 'all'     as Tab, label: 'Todos',       count: counts.all },
  ];

  return (
    <div className="flex flex-col gap-4">

      {/* Page title */}
      <div>
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Assinaturas</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          {items.length
            ? `${counts.pending} pendente${counts.pending !== 1 ? 's' : ''} · ${counts.signed} assinado${counts.signed !== 1 ? 's' : ''}`
            : 'Documentos que precisam da sua assinatura digital.'}
        </p>
      </div>

      {/* Alerta urgente */}
      {!loading && counts.pending > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
          <PenTool className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
          <p className="text-sm font-medium text-orange-800">
            <strong>{counts.pending} documento{counts.pending !== 1 ? 's' : ''}</strong> aguardando assinatura. Toque no card para assinar.
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold ring-1 transition ${
              tab === t.key
                ? 'bg-orange-500 text-white ring-orange-500 shadow-sm'
                : 'bg-white text-slate-600 ring-slate-200 active:bg-slate-100'
            }`}
          >
            {t.label}
            <span className={`min-w-[18px] rounded-full px-1.5 text-[10px] font-bold ${tab === t.key ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-500'}`}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex flex-col gap-3"><SkeletonCard /><SkeletonCard /></div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={tab === 'pending' ? CheckCircle2 : FileSignature}
          title={tab === 'pending' ? 'Nenhuma assinatura pendente' : tab === 'signed' ? 'Nenhum documento assinado' : 'Sem documentos'}
          description={tab === 'pending' ? 'Quando houver um documento aguardando você, ele aparecerá aqui.' : 'Os documentos que você já assinou aparecerão nesta lista.'}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((s) => (
            <SignatureCard key={s.id} item={s} clientEmail={clientEmail} />
          ))}
        </div>
      )}
    </div>
  );
};

// ── Card individual ────────────────────────────────────────────────────────────

const SignatureCard: React.FC<{ item: SignatureRequest; clientEmail?: string }> = ({ item: s, clientEmail }) => {
  const st = getStatus(s, clientEmail);
  const signUrl = resolveSignUrl(s, clientEmail);
  const docUrl = s.public_token ? `/#/documento/${s.public_token}` : null;

  const signedCount = (s.signers || []).filter((sg) => sg.status === 'signed').length;
  const totalSigners = s.signers?.length || 0;
  const progress = totalSigners > 0 ? Math.round((signedCount / totalSigners) * 100) : 0;

  const iconTile = st.isPending
    ? 'bg-orange-50 text-orange-600 ring-orange-100'
    : st.isExpired
    ? 'bg-rose-50 text-rose-600 ring-rose-100'
    : 'bg-emerald-50 text-emerald-600 ring-emerald-100';

  // Pendente + sou signatário → sign URL; concluído → doc URL ou sign URL como fallback
  const actionUrl = st.isPending && st.iAmSigner ? signUrl : (docUrl || signUrl);
  const mySigner = (s.signers || []).find((sg) => sg.status === 'signed');
  const multi = totalSigners > 1;

  const handleCardClick = () => {
    if (!actionUrl) return;
    // Documentos assinados abrem em nova aba (viewer vive no CRM)
    if (!st.isPending && docUrl && actionUrl === docUrl) {
      window.open(docUrl, '_blank', 'noopener');
    } else {
      window.location.href = actionUrl;
    }
  };

  return (
    <div
      role={actionUrl ? 'button' : undefined}
      tabIndex={actionUrl ? 0 : undefined}
      onClick={handleCardClick}
      onKeyDown={(e) => e.key === 'Enter' && handleCardClick()}
      className={`flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition sm:p-5 ${
        actionUrl ? 'cursor-pointer active:scale-[0.99] hover:border-orange-200 hover:shadow-md' : ''
      }`}
    >
      {/* Topo: ícone + título + status */}
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ${iconTile}`}>
          <FileSignature className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-bold leading-snug text-slate-900">
            {s.title || s.document_name || 'Documento para assinar'}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {st.isExpired
              ? `Expirou em ${formatDate(s.expires_at)}`
              : st.isPending
              ? `Solicitado ${formatRelative(s.created_at)}`
              : mySigner?.signed_at
              ? `Assinado em ${formatDate(mySigner.signed_at)}`
              : 'Documento concluído'}
          </p>
        </div>
        <StatusBadge status={st.badge} label={st.label} />
      </div>

      {/* Progresso — só quando há vários signatários */}
      {multi && (
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-slate-500">
            <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{signedCount} de {totalSigners} assinaram</span>
            <span className="font-bold text-slate-700">{progress}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${st.isPending ? 'bg-orange-500' : 'bg-emerald-500'}`} style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {/* CTA */}
      {st.iAmSigner && st.isPending && signUrl && (
        <div className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-sm font-bold text-white">
          <PenTool className="h-4 w-4" /> Toque aqui para assinar <ExternalLink className="h-3.5 w-3.5 opacity-70" />
        </div>
      )}
      {!st.isPending && !st.isExpired && actionUrl && (
        <a
          href={docUrl || actionUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
        >
          <Eye className="h-4 w-4" /> Ver documento <ExternalLink className="h-3.5 w-3.5 opacity-40" />
        </a>
      )}
      {st.iAmSigner && st.isPending && !signUrl && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          ⚠ Entre em contato com o escritório para obter o link de assinatura.
        </div>
      )}
    </div>
  );
};

export default PortalSignatures;
