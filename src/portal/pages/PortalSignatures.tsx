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
    return { isPending: false, isExpired: false, label: 'Conclu?do', badge: 'signed', iAmSigner: !!me };
  }

  const expired = !!s.expires_at && new Date(s.expires_at) < new Date();
  if (s.status === 'expired' || expired) {
    return { isPending: false, isExpired: true, label: 'Expirado', badge: 'expired', iAmSigner: !!me };
  }

  if (me?.status === 'signed') {
    return { isPending: false, isExpired: false, label: 'Voc? assinou', badge: 'signed', iAmSigner: true };
  }

  if (me && me.status !== 'signed') {
    return { isPending: true, isExpired: false, label: 'Assinar agora', badge: 'pending', iAmSigner: true };
  }

  if (allSigned) {
    return { isPending: false, isExpired: false, label: 'Conclu?do', badge: 'signed', iAmSigner: false };
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
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight text-slate-900 sm:text-[26px]">Assinaturas</h1>
        <p className="mt-1 text-sm text-slate-500">
          {items.length
            ? `${counts.pending} pendente${counts.pending !== 1 ? 's' : ''} ? ${counts.signed} assinado${counts.signed !== 1 ? 's' : ''}`
            : 'Documentos que precisam da sua assinatura digital.'}
        </p>
      </header>

      {!loading && counts.pending > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-l-[3px] border-orange-200 border-l-orange-500 bg-white px-4 py-3">
          <PenTool className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
          <p className="text-sm text-slate-700">
            <strong className="font-semibold">{counts.pending} documento{counts.pending !== 1 ? 's' : ''}</strong> aguardando sua assinatura.
          </p>
        </div>
      )}

      <div className="flex gap-4 border-b border-slate-200">
        {tabs.map((tabItem) => {
          const active = tab === tabItem.key;
          return (
            <button
              key={tabItem.key}
              onClick={() => setTab(tabItem.key)}
              className={`relative -mb-px flex items-center gap-1.5 border-b-2 pb-3 pt-1 text-sm font-medium transition ${active ? 'border-orange-500 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
            >
              {tabItem.label}
              <span className={`tabular-nums text-[11px] font-semibold ${active ? 'text-orange-700' : 'text-slate-400'}`}>{tabItem.count}</span>
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
      className={`flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 transition sm:p-5 ${
        actionUrl ? 'cursor-pointer hover:border-slate-300 hover:shadow-[0_1px_3px_rgba(15,23,42,0.06)]' : ''
      }${st.isPending ? ' border-l-[3px] border-l-orange-500' : ''}`}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
          <FileSignature className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">
            {s.title || s.document_name || 'Documento para assinar'}
          </p>
          <p className="mt-0.5 tabular-nums text-[11px] text-slate-400">
            {st.isExpired
              ? `Expirou em ${formatDate(s.expires_at)}`
              : st.isPending
              ? `Solicitado ${formatRelative(s.created_at)}`
              : mySigner?.signed_at
              ? `Assinado em ${formatDate(mySigner.signed_at)}`
              : 'Documento concluído'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${st.isPending ? 'bg-orange-500' : st.isExpired ? 'bg-slate-300' : 'bg-emerald-500'}`} />
          <span className={`text-xs font-medium ${st.isPending ? 'text-orange-700' : st.isExpired ? 'text-slate-400' : 'text-emerald-700'}`}>{st.label}</span>
        </div>
      </div>

      {multi && (
        <div className="border-t border-slate-100 pt-3">
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{signedCount} de {totalSigners} assinaram</span>
            <span className="tabular-nums font-medium">{progress}%</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${st.isPending ? 'bg-orange-500' : 'bg-emerald-500'}`} style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {st.iAmSigner && st.isPending && signUrl && (
        <div className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white">
          <PenTool className="h-4 w-4" /> Assinar documento <ExternalLink className="h-3.5 w-3.5 opacity-60" />
        </div>
      )}

      {!st.isPending && !st.isExpired && actionUrl && (
        <a
          href={docUrl || actionUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
        >
          <Eye className="h-4 w-4" /> Ver documento <ExternalLink className="h-3.5 w-3.5 opacity-40" />
        </a>
      )}

      {st.iAmSigner && st.isPending && !signUrl && (
        <p className="border-t border-slate-100 pt-3 text-[13px] text-slate-500">
          Entre em contato com o escrit?rio para obter o link de assinatura.
        </p>
      )}
    </div>
  );
};

export default PortalSignatures;
