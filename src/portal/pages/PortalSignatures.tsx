import React, { useEffect, useMemo, useState } from 'react';
import {
  FileSignature,
  ExternalLink,
  CheckCircle2,
  Users,
  PenTool,
  Eye,
} from 'lucide-react';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { clientPortalService } from '../services/clientPortal.service';
import {
  EmptyState,
  SkeletonCard,
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
  const me = findMe(all, clientEmail);
  const myToken = me?.access_token || me?.token || me?.public_token;
  if (myToken) return `/#/assinar/${myToken}`;

  for (const sg of all) {
    const token = sg.access_token || sg.token || sg.public_token;
    if (token) return `/#/assinar/${token}`;
  }

  return null;
}

function findMe(signers: Signer[], clientEmail?: string): Signer | undefined {
  if (!clientEmail) return undefined;
  const email = clientEmail.toLowerCase();
  return signers.find(
    (sg) => sg.email?.toLowerCase() === email || sg.auth_email?.toLowerCase() === email,
  );
}

function getStatus(
  s: SignatureRequest,
  clientEmail?: string,
): { isPending: boolean; isExpired: boolean; label: string; badge: string; iAmSigner: boolean } {
  const all = s.signers || [];
  const me = findMe(all, clientEmail);
  const allSigned = all.length > 0 && all.every((sg) => sg.status === 'signed');

  if (s.status === 'signed' || s.status === 'completed') {
    return { isPending: false, isExpired: false, label: 'Concluído', badge: 'signed', iAmSigner: !!me };
  }

  const expired = !!s.expires_at && new Date(s.expires_at) < new Date();
  if (s.status === 'expired' || expired) {
    return { isPending: false, isExpired: true, label: 'Expirado', badge: 'expired', iAmSigner: !!me };
  }

  if (me?.status === 'signed') {
    return { isPending: false, isExpired: false, label: 'Você assinou', badge: 'signed', iAmSigner: true };
  }

  if (me && me.status !== 'signed') {
    return { isPending: true, isExpired: false, label: 'Assinar agora', badge: 'pending', iAmSigner: true };
  }

  if (allSigned) {
    return { isPending: false, isExpired: false, label: 'Concluído', badge: 'signed', iAmSigner: false };
  }

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
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [session]);

  const clientEmail = session?.client.email ?? undefined;

  const counts = useMemo(() => {
    let pending = 0;
    let signed = 0;
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
      if (tab === 'signed') return !st.isPending && !st.isExpired;
      return true;
    });
  }, [items, tab, clientEmail]);

  const signedItems = useMemo(
    () => items.filter((s) => {
      const st = getStatus(s, clientEmail);
      return !st.isPending && !st.isExpired;
    }),
    [items, clientEmail],
  );

  const tabs = [
    { key: 'pending' as Tab, label: 'Pendentes', count: counts.pending },
    { key: 'signed' as Tab, label: 'Assinados', count: counts.signed },
    { key: 'all' as Tab, label: 'Todos', count: counts.all },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Header app-style */}
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-orange-50 text-orange-500">
          <PenTool className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">Assinaturas</h1>
          <p className="text-[12px] text-slate-400">
            {items.length
              ? `${counts.pending} pendente${counts.pending !== 1 ? 's' : ''} · ${counts.signed} assinado${counts.signed !== 1 ? 's' : ''}`
              : 'Documentos que precisam da sua assinatura'}
          </p>
        </div>
      </div>

      {!loading && counts.pending > 0 && (
        <div className="flex items-center gap-3 rounded-2xl bg-orange-500 px-4 py-3 text-white shadow-[0_4px_14px_rgba(249,115,22,0.25)]">
          <PenTool className="h-4 w-4 shrink-0" />
          <p className="text-sm font-semibold">
            {counts.pending} documento{counts.pending !== 1 ? 's' : ''} aguardando sua assinatura
          </p>
        </div>
      )}

      {/* Tabs pill-style */}
      <div className="flex gap-2">
        {tabs.map((tabItem) => {
          const active = tab === tabItem.key;
          return (
            <button
              key={tabItem.key}
              onClick={() => setTab(tabItem.key)}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold transition ${
                active ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 shadow-[0_1px_4px_rgba(15,23,42,0.08)]'
              }`}
            >
              {tabItem.label}
              <span className={`min-w-[18px] rounded-full px-1.5 text-[11px] font-bold tabular-nums ${active ? 'bg-white/20 text-white' : 'text-slate-400'}`}>
                {tabItem.count}
              </span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex flex-col gap-3"><SkeletonCard /><SkeletonCard /></div>
      ) : filtered.length === 0 ? (
        tab === 'pending' && signedItems.length > 0 ? (
          <div className="flex flex-col gap-4">
            <EmptyState
              icon={CheckCircle2}
              title="Nenhuma assinatura pendente"
              description="No momento, não há nada aguardando sua assinatura. Os documentos já assinados aparecem logo abaixo."
            />
            <section className="flex flex-col gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Arquivos já assinados</h2>
                <p className="mt-1 text-xs text-slate-500">Abra aqui os documentos já concluídos, sem precisar trocar de aba.</p>
              </div>
              {signedItems.map((item) => (
                <SignatureCard key={item.id} item={item} clientEmail={clientEmail} />
              ))}
            </section>
          </div>
        ) : (
          <EmptyState
            icon={tab === 'pending' ? CheckCircle2 : FileSignature}
            title={tab === 'pending' ? 'Nenhuma assinatura pendente' : tab === 'signed' ? 'Nenhum documento assinado' : 'Sem documentos'}
            description={tab === 'pending' ? 'Quando houver um documento aguardando você, ele aparecerá aqui.' : 'Os documentos que você já assinou aparecerão nesta lista.'}
          />
        )
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((item) => (
            <SignatureCard key={item.id} item={item} clientEmail={clientEmail} />
          ))}
        </div>
      )}
    </div>
  );
};

const SignatureCard: React.FC<{ item: SignatureRequest; clientEmail?: string }> = ({ item: s, clientEmail }) => {
  const st = getStatus(s, clientEmail);
  const signUrl = resolveSignUrl(s, clientEmail);
  const docUrl = s.public_token ? `/#/documento/${s.public_token}` : null;

  const signedCount = (s.signers || []).filter((sg) => sg.status === 'signed').length;
  const totalSigners = s.signers?.length || 0;
  const progress = totalSigners > 0 ? Math.round((signedCount / totalSigners) * 100) : 0;

  const actionUrl = st.isPending && st.iAmSigner ? signUrl : (docUrl || signUrl);
  const mySigner = findMe(s.signers || [], clientEmail);
  const multi = totalSigners > 1;

  const handleCardClick = () => {
    if (!actionUrl) return;
    // iOS Safari blocks window.open for hash-based URLs — use location.href for same-origin docs
    window.location.href = actionUrl;
  };

  const accentColor = st.isPending ? 'bg-orange-500' : st.isExpired ? 'bg-slate-300' : 'bg-emerald-500';
  const badgeColor = st.isPending
    ? 'bg-orange-50 text-orange-600'
    : st.isExpired
    ? 'bg-slate-100 text-slate-400'
    : 'bg-emerald-50 text-emerald-600';

  return (
    <div
      role={actionUrl ? 'button' : undefined}
      tabIndex={actionUrl ? 0 : undefined}
      onClick={handleCardClick}
      onKeyDown={(e) => e.key === 'Enter' && handleCardClick()}
      className={`overflow-hidden rounded-2xl bg-white shadow-[0_2px_10px_rgba(15,23,42,0.07)] transition ${
        actionUrl ? 'cursor-pointer active:scale-[0.99]' : ''
      }`}
    >
      <div className="flex">
        {/* Left accent bar */}
        <div className={`w-1 shrink-0 ${accentColor}`} />

        <div className="flex-1 px-4 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100">
                <FileSignature className="h-4 w-4 text-slate-500" strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Documento</p>
                <p className="mt-0.5 truncate text-[15px] font-bold text-slate-900">
                  {s.title || s.document_name || 'Documento para assinar'}
                </p>
              </div>
            </div>
            <span className={`mt-0.5 shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${badgeColor}`}>
              {st.label}
            </span>
          </div>

          <p className="mt-2.5 tabular-nums text-[12px] text-slate-400">
            {st.isExpired
              ? `Expirou em ${formatDate(s.expires_at)}`
              : st.isPending
              ? `Solicitado ${formatRelative(s.created_at)}`
              : mySigner?.signed_at
              ? `Assinado em ${formatDate(mySigner.signed_at)}`
              : 'Documento concluído'}
          </p>

          {multi && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {signedCount} de {totalSigners} assinaram
                </span>
                <span className="tabular-nums font-semibold">{progress}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className={`h-full rounded-full ${st.isPending ? 'bg-orange-500' : 'bg-emerald-500'}`} style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {st.iAmSigner && st.isPending && signUrl && (
            <div className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 px-4 py-3 text-[13px] font-semibold text-white shadow-[0_4px_12px_rgba(249,115,22,0.3)] transition active:bg-orange-600">
              <PenTool className="h-4 w-4" strokeWidth={1.75} /> Assinar agora
              <ExternalLink className="h-3.5 w-3.5 opacity-70" />
            </div>
          )}

          {!st.isPending && !st.isExpired && actionUrl && (
            <a
              href={docUrl || actionUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-100 px-4 py-2.5 text-[13px] font-semibold text-slate-600 transition active:bg-slate-200"
            >
              <Eye className="h-4 w-4" strokeWidth={1.75} /> Ver documento
              <ExternalLink className="h-3.5 w-3.5 opacity-50" />
            </a>
          )}

          {st.iAmSigner && st.isPending && !signUrl && (
            <p className="mt-2.5 text-[12px] text-slate-400">
              Entre em contato com o escritório para obter o link de assinatura.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default PortalSignatures;
