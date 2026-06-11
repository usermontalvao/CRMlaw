import React, { useEffect, useMemo, useState } from 'react';
import {
  FileText, FileImage, FileSpreadsheet, FileArchive,
  FileVideo, FileAudio, File as FileIcon,
  Search, Download, Eye, FolderOpen, X,
} from 'lucide-react';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { clientPortalService } from '../services/clientPortal.service';
import { EmptyState, SkeletonCard, formatFileSize, formatDate, formatRelative } from '../components/PortalUI';

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
  { key: 'all',   label: 'Todos'      },
  { key: 'pdf',   label: 'PDFs'       },
  { key: 'image', label: 'Imagens'    },
  { key: 'doc',   label: 'Documentos' },
  { key: 'other', label: 'Outros'     },
];

function classify(d: DocumentItem): FilterKey {
  const mt = (d.mime_type || '').toLowerCase();
  const nm = (d.name || d.filename || '').toLowerCase();
  if (mt.includes('pdf') || nm.endsWith('.pdf')) return 'pdf';
  if (mt.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(nm)) return 'image';
  if (mt.includes('word') || mt.includes('officedocument') || mt.includes('msword') || /\.(docx?|odt|rtf|txt)$/i.test(nm)) return 'doc';
  return 'other';
}

function iconFor(d: DocumentItem): React.ComponentType<{ className?: string }> {
  const k = classify(d);
  const nm = (d.name || d.filename || '').toLowerCase();
  if (k === 'pdf')   return FileText;
  if (k === 'image') return FileImage;
  if (k === 'doc')   return FileText;
  if (/\.(xlsx?|csv|ods)$/i.test(nm))    return FileSpreadsheet;
  if (/\.(zip|rar|7z|tar|gz)$/i.test(nm)) return FileArchive;
  if (/\.(mp4|mov|webm|avi)$/i.test(nm)) return FileVideo;
  if (/\.(mp3|wav|ogg|m4a)$/i.test(nm))  return FileAudio;
  return FileIcon;
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
    clientPortalService.listDocuments(session.user.id)
      .then((data) => { if (mounted) setDocs(data as DocumentItem[]); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [session]);

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: docs.length, pdf: 0, image: 0, doc: 0, other: 0 };
    docs.forEach((d) => { c[classify(d)]++; });
    return c;
  }, [docs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs.filter((d) => {
      if (filter !== 'all' && classify(d) !== filter) return false;
      if (!q) return true;
      return `${d.name || ''} ${d.filename || ''} ${d.description || ''}`.toLowerCase().includes(q);
    });
  }, [docs, search, filter]);

  const totalBytes = useMemo(() => docs.reduce((acc, d) => acc + Number(d.size || 0), 0), [docs]);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight text-slate-900 sm:text-[26px]">Documentos</h1>
        <p className="mt-1 text-sm text-slate-500">
          {docs.length
            ? `${docs.length} arquivo${docs.length > 1 ? 's' : ''} · ${formatFileSize(totalBytes)}`
            : 'Acesse os documentos compartilhados pelo seu advogado.'}
        </p>
      </header>

      {/* Busca — idêntica ao Processo */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome do arquivo"
          className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-10 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 transition hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Filtros — mesmo estilo preto/branco do Processo */}
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {FILTERS.map((f) => {
          const on = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-medium transition ${
                on ? 'bg-slate-900 text-white' : 'bg-[#f8f7f5] text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {f.label}
              <span className={`tabular-nums text-[11px] font-semibold ${on ? 'text-white/60' : 'text-slate-400'}`}>{counts[f.key]}</span>
            </button>
          );
        })}
      </div>

      {/* Lista — mesmo padrão de linhas do Processo */}
      {loading ? (
        <div className="flex flex-col gap-3"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title={docs.length === 0 ? 'Nenhum documento ainda' : 'Nada encontrado'}
          description={docs.length === 0
            ? 'Quando seu advogado compartilhar documentos, eles aparecerão aqui.'
            : 'Tente outro termo ou ajuste o filtro.'}
        />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {filtered.map((d) => {
            const Icon = iconFor(d);
            const name = d.name || d.filename || 'Documento';
            return (
              <li key={d.id}>
                <div className="group flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-[#f8f7f5] p-4 transition hover:border-slate-300 hover:shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
                  {/* Ícone neutro — igual ao padrão do portal */}
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                    <Icon className="h-4 w-4" />
                  </div>

                  {/* Dados do arquivo */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
                    <p className="mt-0.5 tabular-nums text-[11px] text-slate-400">
                      {formatFileSize(d.size)}
                      {d.created_at && <> · {formatRelative(d.created_at)}</>}
                    </p>
                    {d.description && <p className="mt-0.5 line-clamp-1 text-[12px] text-slate-500">{d.description}</p>}
                  </div>

                  {/* Ações */}
                  {d.url && (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <a
                        href={d.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                        title="Visualizar"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Ver</span>
                      </a>
                      <a
                        href={d.url}
                        download={name}
                        onClick={(e) => e.stopPropagation()}
                        className="flex h-8 items-center gap-1 rounded-lg bg-slate-900 px-2.5 text-xs font-medium text-white transition hover:bg-slate-700"
                        title="Baixar"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Baixar</span>
                      </a>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default PortalDocuments;
