/**
 * PortalDocumentRequests — Solicitações de documentos do escritório.
 * Mobile-first: câmera nativa, múltiplos arquivos, feedback em tempo real.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  FolderOpen, Camera, Upload, CheckCircle2, Clock, XCircle,
  Loader2, ChevronRight, AlertCircle, FileText, RotateCcw,
  Check, X, Plus,
} from 'lucide-react';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { clientPortalService, type DocumentRequest, type DocumentRequestItem } from '../services/clientPortal.service';
import { EmptyState, formatDate } from '../components/PortalUI';

// ── Status helpers ─────────────────────────────────────────────────────────

const REQUEST_STATUS: Record<string, { label: string; dot: string; text: string }> = {
  pending:   { label: 'Aguardando',   dot: 'bg-amber-500',   text: 'text-amber-700'   },
  partial:   { label: 'Em andamento', dot: 'bg-orange-500',  text: 'text-orange-700'  },
  complete:  { label: 'Completo',     dot: 'bg-emerald-500', text: 'text-emerald-700' },
  reviewed:  { label: 'Revisado',     dot: 'bg-slate-400',   text: 'text-slate-500'   },
  cancelled: { label: 'Cancelado',    dot: 'bg-slate-300',   text: 'text-slate-400'   },
};

const ITEM_STATUS: Record<string, { icon: React.ReactNode; color: string }> = {
  pending:  { icon: <Clock className="h-4 w-4" />,                    color: 'text-slate-400'   },
  uploaded: { icon: <Loader2 className="h-4 w-4 animate-spin" />,     color: 'text-amber-500'   },
  approved: { icon: <CheckCircle2 className="h-4 w-4" />,             color: 'text-emerald-500' },
  rejected: { icon: <XCircle className="h-4 w-4" />,                  color: 'text-rose-500'    },
};

// ── Upload drawer ──────────────────────────────────────────────────────────

interface UploadDrawerProps {
  item: DocumentRequestItem;
  clientId: string;
  portalUserId: string;
  onDone: () => void;
  onClose: () => void;
}

const UploadDrawer: React.FC<UploadDrawerProps> = ({ item, clientId, portalUserId, onDone, onClose }) => {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Re-abre o drawer para enviar mais arquivos (substituindo o anterior)
  const isResend = item.status === 'uploaded' || item.status === 'rejected';
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const addFiles = (newFiles: FileList | null) => {
    if (!newFiles?.length) return;
    const arr = Array.from(newFiles);
    setFiles(prev => [...prev, ...arr]);
    arr.forEach(f => {
      if (f.type.startsWith('image/')) {
        const url = URL.createObjectURL(f);
        setPreviews(prev => [...prev, url]);
      } else {
        setPreviews(prev => [...prev, '']);
      }
    });
  };

  const removeFile = (idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
    setPreviews(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    if (!files.length) return;
    setUploading(true); setError(null);
    const result = await clientPortalService.uploadDocumentFiles(
      portalUserId, item.id, clientId, files
    );
    setUploading(false);
    if (!result) { setError('Falha no envio. Tente novamente.'); return; }
    setDone(true);
    setTimeout(() => { onDone(); }, 1500);
  };

  if (done) return (
    <div className="flex flex-col items-center gap-3 py-10 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
        <CheckCircle2 className="h-6 w-6 text-emerald-600" />
      </div>
      <p className="text-sm font-semibold text-slate-900">Enviado com sucesso!</p>
      <p className="text-xs text-slate-500">O escritório irá revisar seu documento em breve.</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-4 pb-4">
      {/* Identificação do item */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-sm font-semibold text-slate-900">{item.label}</p>
        {item.description && <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>}
      </div>

      {/* Previews */}
      {files.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
            Arquivos selecionados ({files.length})
          </p>
          <div className="grid grid-cols-3 gap-2">
            {files.map((f, i) => (
              <div key={i} className="relative aspect-square overflow-hidden rounded-lg bg-slate-100">
                {previews[i] ? (
                  <img src={previews[i]} alt={f.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2">
                    <FileText className="h-5 w-5 text-slate-400" />
                    <p className="line-clamp-2 text-center text-[10px] text-slate-500">{f.name}</p>
                  </div>
                )}
                <button
                  onClick={() => removeFile(i)}
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900/70 text-white"
                >
                  <X className="h-3 w-3" />
                </button>
                <div className="absolute bottom-1 left-1 rounded bg-slate-900/60 px-1 text-[9px] font-bold text-white">
                  {i + 1}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Botões de adicionar */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => cameraRef.current?.click()}
          className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-slate-200 bg-white py-5 text-slate-500 transition hover:border-slate-400 active:scale-95"
        >
          <Camera className="h-6 w-6" />
          <span className="text-xs font-medium">Tirar foto</span>
        </button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={e => addFiles(e.target.files)} />

        <button
          onClick={() => fileRef.current?.click()}
          className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-slate-200 bg-white py-5 text-slate-500 transition hover:border-slate-400 active:scale-95"
        >
          <Upload className="h-6 w-6" />
          <span className="text-xs font-medium">Selecionar arquivo</span>
        </button>
        <input ref={fileRef} type="file" accept="image/*,application/pdf,.docx,.doc" multiple className="hidden" onChange={e => addFiles(e.target.files)} />
      </div>

      {files.length > 1 && (
        <p className="text-[12px] text-slate-500">
          {files.length} arquivos serão mesclados automaticamente em um único PDF na ordem acima.
        </p>
      )}

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
      )}

      <div className="flex gap-3">
        <button
          onClick={onClose}
          disabled={uploading}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          onClick={handleSubmit}
          disabled={uploading || files.length === 0}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 active:scale-[0.98] disabled:opacity-60"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {uploading ? 'Enviando…' : 'Enviar'}
        </button>
      </div>
    </div>
  );
};

// ── Item card ──────────────────────────────────────────────────────────────

const ItemCard: React.FC<{
  item: DocumentRequestItem;
  clientId: string;
  portalUserId: string;
  onRefresh: () => void;
}> = ({ item, clientId, portalUserId, onRefresh }) => {
  const [open, setOpen] = useState(false);
  const statusInfo = ITEM_STATUS[item.status] || ITEM_STATUS.pending;
  const upload = item.upload;
  // Pode enviar: pendente, rejeitado, ou reenvio mesmo após enviado (enquanto não aprovado)
  const canUpload = item.status !== 'approved';

  // Borda lateral esquerda por status — mesmo padrão do Processo/Assinaturas
  const accentBar = item.status === 'approved' ? 'bg-emerald-500'
    : item.status === 'rejected' ? 'bg-rose-500'
    : item.status === 'uploaded' ? 'bg-amber-400'
    : 'bg-slate-200';

  const badgeStyle = item.status === 'approved' ? 'bg-emerald-50 text-emerald-600'
    : item.status === 'rejected' ? 'bg-rose-50 text-rose-600'
    : item.status === 'uploaded' ? 'bg-amber-50 text-amber-700'
    : 'bg-slate-100 text-slate-500';

  const badgeLabel = item.status === 'approved' ? 'Aprovado'
    : item.status === 'rejected' ? 'Rejeitado'
    : item.status === 'uploaded' ? 'Em revisão'
    : 'Pendente';

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-[0_2px_8px_rgba(15,23,42,0.06)]">
      <div className="flex">
        <div className={`w-1 shrink-0 ${accentBar}`} />
        <div className="flex-1 px-4 py-3.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${statusInfo.color} bg-slate-100`}>
                {statusInfo.icon}
              </div>
              <div className="min-w-0">
                <p className="text-[14px] font-bold text-slate-900">{item.label}</p>
                {item.description && (
                  <p className="mt-0.5 text-[12px] text-slate-400">{item.description}</p>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${badgeStyle}`}>{badgeLabel}</span>
              {!item.required && (
                <span className="text-[10px] font-medium text-slate-400">Opcional</span>
              )}
            </div>
          </div>

          {/* Info do upload */}
          {upload && (
            <div className="mt-2.5 flex flex-col gap-1.5">
              {upload.processing_status === 'pending' && (
                <div className="flex items-center gap-1.5 text-[12px] text-slate-500">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Aguardando processamento…
                </div>
              )}
              {upload.processing_status === 'processing' && (
                <div className="flex items-center gap-1.5 text-[12px] text-amber-700">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Convertendo para PDF e identificando…
                </div>
              )}
              {(upload.processing_status === 'ready' || upload.processing_status === 'error') && (
                <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-slate-600">
                  <FileText className="h-3 w-3 shrink-0 text-slate-400" />
                  <span className="max-w-[160px] truncate font-medium">{upload.final_name || 'documento.pdf'}</span>
                  {upload.ai_document_type && (
                    <span className="text-slate-400">· {upload.ai_document_type}</span>
                  )}
                  {item.status === 'approved' && (
                    <span className="font-semibold text-emerald-700">· Aprovado</span>
                  )}
                </div>
              )}
              {item.status === 'rejected' && upload.rejection_reason && (
                <div className="flex items-start gap-1.5 rounded-2xl bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{upload.rejection_reason}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* CTA */}
      {canUpload && !open && (
        <button
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-center gap-2 border-t border-slate-100 py-3 text-[13px] font-semibold text-orange-500 transition active:bg-orange-50"
        >
          {item.status === 'rejected'
            ? <><RotateCcw className="h-3.5 w-3.5" strokeWidth={2} /> Reenviar documento</>
            : item.status === 'uploaded'
            ? <><Plus className="h-3.5 w-3.5" strokeWidth={2} /> Enviar outro arquivo</>
            : <><Camera className="h-3.5 w-3.5" strokeWidth={1.75} /> Enviar documento</>}
        </button>
      )}

      {open && (
        <div className="mt-3 border-t border-slate-100 pt-4">
          <UploadDrawer
            item={item}
            clientId={clientId}
            portalUserId={portalUserId}
            onDone={() => { setOpen(false); onRefresh(); }}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
};

// ── Página principal ───────────────────────────────────────────────────────

export const PortalDocumentRequests: React.FC = () => {
  const { session } = useClientAuth();
  const [requests, setRequests] = useState<DocumentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = async () => {
    if (!session?.user?.id) return;
    setLoading(true);
    const data = await clientPortalService.listDocumentRequests(session.user.id);
    setRequests(data);
    // Expande automaticamente solicitações pendentes
    const pending = data.filter(r => r.status === 'pending' || r.status === 'partial').map(r => r.id);
    setExpanded(new Set(pending));
    setLoading(false);
  };

  useEffect(() => { load(); }, [session?.user?.id]);

  if (!session) return null;

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const pendingCount = requests.filter(r => r.status === 'pending' || r.status === 'partial').length;

  return (
    <div className="flex flex-col gap-4">
      {/* Header app-style */}
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-orange-50 text-orange-500">
          <FolderOpen className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">Documentos</h1>
          <p className="text-[12px] text-slate-400">
            {pendingCount > 0
              ? `${pendingCount} solicitação${pendingCount > 1 ? 'ões' : ''} aguardando envio`
              : 'Documentos solicitados pelo escritório'}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2].map(i => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : requests.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="Sem solicitações"
          description="O escritório ainda não solicitou nenhum documento."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {requests.map((req) => {
            const isExpanded = expanded.has(req.id);
            const s = REQUEST_STATUS[req.status] || REQUEST_STATUS.pending;
            const doneCount = req.items.filter(i => i.status === 'approved' || i.status === 'uploaded').length;
            const totalCount = req.items.length;
            const isComplete = req.status === 'complete' || req.status === 'reviewed' || doneCount === totalCount;
            const isPending = req.status === 'pending' || req.status === 'partial';

            return (
              <li key={req.id} className="overflow-hidden rounded-2xl bg-white shadow-[0_2px_10px_rgba(15,23,42,0.07)]">
                <div className="flex">
                  {/* Left accent bar */}
                  <div className={`w-1 shrink-0 ${s.dot}`} />
                  <div className="flex-1">
                    {/* Cabeçalho da solicitação */}
                    <button
                      onClick={() => toggleExpand(req.id)}
                      className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition active:bg-slate-50"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                        <FolderOpen className="h-4 w-4" strokeWidth={1.75} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-[15px] font-bold text-slate-900">{req.title}</p>
                          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                            isPending ? 'bg-orange-50 text-orange-600' : isComplete ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'
                          }`}>{s.label}</span>
                        </div>

                        {req.description && (
                          <p className="mt-0.5 line-clamp-1 text-[12px] text-slate-400">{req.description}</p>
                        )}

                        {/* Progresso */}
                        <div className="mt-2.5 flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={`h-full rounded-full transition-all ${isComplete ? 'bg-emerald-500' : 'bg-orange-500'}`}
                              style={{ width: totalCount ? `${(doneCount / totalCount) * 100}%` : '0%' }}
                            />
                          </div>
                          <span className="tabular-nums text-[11px] font-semibold text-slate-400">{doneCount}/{totalCount}</span>
                          {req.due_date && (
                            <span className="tabular-nums text-[11px] text-slate-400">· {formatDate(req.due_date)}</span>
                          )}
                        </div>
                      </div>

                      <ChevronRight className={`h-4 w-4 shrink-0 text-slate-300 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    </button>

                    {/* Lista de itens expandida */}
                    {isExpanded && (
                      <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-4">
                        {req.items.map((item) => (
                          <ItemCard
                            key={item.id}
                            item={item}
                            clientId={session.client.id}
                            portalUserId={session.user.id}
                            onRefresh={load}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default PortalDocumentRequests;
