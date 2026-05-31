/**
 * PortalDocuments — Documentos compartilhados com o cliente.
 *
 * Layout premium com busca, filtros por tipo, cards visuais
 * e download direto. Ícone muda conforme o mime type.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  FileText,
  FileImage,
  FileSpreadsheet,
  FileArchive,
  FileVideo,
  FileAudio,
  File as FileIcon,
  Search,
  Download,
  Eye,
  FolderOpen,
} from 'lucide-react';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { clientPortalService } from '../services/clientPortal.service';
import {
  PageHeader,
  EmptyState,
  SkeletonCard,
  formatFileSize,
  formatDate,
  formatRelative,
} from '../components/PortalUI';

interface DocumentItem {
  id: string;
  name?: string;
  filename?: string;
  size?: number;
  mime_type?: string;
  created_at?: string;
  url?: string;
  storage_path?: string;
  description?: string;
}

type FilterKey = 'all' | 'pdf' | 'image' | 'doc' | 'other';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'pdf', label: 'PDFs' },
  { key: 'image', label: 'Imagens' },
  { key: 'doc', label: 'Documentos' },
  { key: 'other', label: 'Outros' },
];

function classify(d: DocumentItem): FilterKey {
  const mt = (d.mime_type || '').toLowerCase();
  const nm = (d.name || d.filename || '').toLowerCase();
  if (mt.includes('pdf') || nm.endsWith('.pdf')) return 'pdf';
  if (mt.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(nm)) return 'image';
  if (
    mt.includes('word') ||
    mt.includes('officedocument') ||
    mt.includes('msword') ||
    /\.(docx?|odt|rtf|txt)$/i.test(nm)
  )
    return 'doc';
  return 'other';
}

function iconFor(d: DocumentItem) {
  const k = classify(d);
  const nm = (d.name || d.filename || '').toLowerCase();
  if (k === 'pdf') return { Icon: FileText, color: 'from-rose-500 to-red-500', ring: 'ring-rose-100' };
  if (k === 'image') return { Icon: FileImage, color: 'from-violet-500 to-purple-500', ring: 'ring-violet-100' };
  if (k === 'doc') return { Icon: FileText, color: 'from-slate-500 to-slate-600', ring: 'ring-blue-100' };
  if (/\.(xlsx?|csv|ods)$/i.test(nm)) {
    return { Icon: FileSpreadsheet, color: 'from-emerald-500 to-green-500', ring: 'ring-emerald-100' };
  }
  if (/\.(zip|rar|7z|tar|gz)$/i.test(nm)) {
    return { Icon: FileArchive, color: 'from-amber-500 to-orange-500', ring: 'ring-amber-100' };
  }
  if (/\.(mp4|mov|webm|avi)$/i.test(nm)) {
    return { Icon: FileVideo, color: 'from-fuchsia-500 to-pink-500', ring: 'ring-fuchsia-100' };
  }
  if (/\.(mp3|wav|ogg|m4a)$/i.test(nm)) {
    return { Icon: FileAudio, color: 'from-cyan-500 to-sky-500', ring: 'ring-cyan-100' };
  }
  return { Icon: FileIcon, color: 'from-slate-500 to-slate-600', ring: 'ring-slate-100' };
}

export const PortalDocuments: React.FC = () => {
  const { session } = useClientAuth();
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');

  useEffect(() => {
    if (!session) return;
    let mounted = true;
    setLoading(true);
    clientPortalService
      .listDocuments(session.user.id)
      .then((data) => {
        if (mounted) setDocs(data as DocumentItem[]);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [session]);

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: docs.length, pdf: 0, image: 0, doc: 0, other: 0 };
    docs.forEach((d) => {
      const k = classify(d);
      c[k]++;
    });
    return c;
  }, [docs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs.filter((d) => {
      if (filter !== 'all' && classify(d) !== filter) return false;
      if (!q) return true;
      const haystack = `${d.name || ''} ${d.filename || ''} ${d.description || ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [docs, search, filter]);

  const totalBytes = useMemo(() => docs.reduce((acc, d) => acc + Number(d.size || 0), 0), [docs]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documentos"
        subtitle={
          docs.length
            ? `${docs.length} arquivo${docs.length > 1 ? 's' : ''} • ${formatFileSize(totalBytes)} no total`
            : 'Acesse os documentos compartilhados pelo seu advogado.'
        }
        icon={FolderOpen}
      />

      {/* Busca + filtros */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome do arquivo..."
            className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
          />
        </div>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold ring-1 transition ${
                filter === f.key
                  ? 'bg-orange-500 text-white ring-orange-500 shadow-sm'
                  : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {f.label}
              <span
                className={`rounded-full px-1.5 text-[10px] ${
                  filter === f.key ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {counts[f.key]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title={docs.length === 0 ? 'Nenhum documento ainda' : 'Nada encontrado'}
          description={
            docs.length === 0
              ? 'Quando seu advogado compartilhar documentos, eles aparecerão aqui.'
              : 'Tente outro termo ou ajuste o filtro.'
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((d) => {
            const { Icon, color, ring } = iconFor(d);
            const name = d.name || d.filename || 'Documento';
            return (
              <div
                key={d.id}
                className="group flex flex-col rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${color} text-white shadow-sm ring-4 ${ring}`}
                  >
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-semibold text-slate-900" title={name}>
                      {name}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatFileSize(d.size)} • {formatRelative(d.created_at)}
                    </p>
                  </div>
                </div>

                {d.description && (
                  <p className="mt-3 line-clamp-2 text-xs text-slate-600">{d.description}</p>
                )}

                <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                  <span className="text-[10px] uppercase tracking-wider text-slate-400">
                    {formatDate(d.created_at)}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {d.url && (
                      <a
                        href={d.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-200"
                        title="Visualizar"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Ver</span>
                      </a>
                    )}
                    {d.url && (
                      <a
                        href={d.url}
                        download={name}
                        className="inline-flex items-center gap-1 rounded-lg bg-orange-500 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-orange-600"
                        title="Baixar"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Baixar</span>
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PortalDocuments;
