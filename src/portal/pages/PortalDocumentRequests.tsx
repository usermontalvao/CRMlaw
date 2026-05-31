/**
 * PortalDocumentRequests — Solicitações de documentos do escritório.
 * Mobile-first: câmera nativa, múltiplos arquivos, feedback em tempo real.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  FolderOpen, Camera, Upload, CheckCircle2, Clock, XCircle,
  Loader2, ChevronRight, AlertCircle, FileText, RotateCcw,
  Sparkles, Check, X, Plus,
} from 'lucide-react';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { clientPortalService, type DocumentRequest, type DocumentRequestItem } from '../services/clientPortal.service';
import { PageHeader, EmptyState, formatDate } from '../components/PortalUI';

// ── Status helpers ─────────────────────────────────────────────────────────

const REQUEST_STATUS: Record<string, { label: string; color: string }> = {
  pending:   { label: 'Aguardando',    color: 'text-amber-700 bg-amber-50 ring-amber-200' },
  partial:   { label: 'Em andamento',  color: 'text-blue-700 bg-blue-50 ring-blue-200' },
  complete:  { label: 'Completo',      color: 'text-emerald-700 bg-emerald-50 ring-emerald-200' },
  reviewed:  { label: 'Revisado',      color: 'text-slate-600 bg-slate-100 ring-slate-200' },
  cancelled: { label: 'Cancelado',     color: 'text-slate-400 bg-slate-50 ring-slate-100' },
};

const ITEM_STATUS: Record<string, { icon: React.ReactNode; color: string }> = {
  pending:  { icon: <Clock className="h-4 w-4" />,         color: 'text-slate-400' },
  uploaded: { icon: <Loader2 className="h-4 w-4 animate-spin" />, color: 'text-blue-500' },
  approved: { icon: <CheckCircle2 className="h-4 w-4" />,  color: 'text-emerald-500' },
  rejected: { icon: <XCircle className="h-4 w-4" />,       color: 'text-rose-500' },
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
    <div className="flex flex-col items-center gap-4 py-12 px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
        <CheckCircle2 className="h-8 w-8 text-emerald-500" />
      </div>
      <p className="text-lg font-bold text-slate-900">Enviado com sucesso!</p>
      <p className="text-sm text-slate-500">O escritório irá revisar seu documento em breve.</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-5 pb-6">
      {/* Header do item */}
      <div className="rounded-2xl bg-orange-50 p-4 ring-1 ring-orange-100">
        <p className="text-sm font-bold text-orange-900">{item.label}</p>
        {item.description && <p className="mt-1 text-xs text-orange-700">{item.description}</p>}
      </div>

      {/* Área de upload */}
      <div>
        <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">
          Arquivos selecionados ({files.length})
        </p>

        {/* Grid de previews */}
        {files.length > 0 && (
          <div className="mb-3 grid grid-cols-3 gap-2">
            {files.map((f, i) => (
              <div key={i} className="relative aspect-square overflow-hidden rounded-xl bg-slate-100">
                {previews[i] ? (
                  <img src={previews[i]} alt={f.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2">
                    <FileText className="h-6 w-6 text-slate-400" />
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
        )}

        {/* Botões de adicionar */}
        <div className="grid grid-cols-2 gap-2">
          {/* Câmera — abre câmera nativa no mobile */}
          <button
            onClick={() => cameraRef.current?.click()}
            className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-orange-200 bg-orange-50/50 py-5 text-orange-600 transition active:scale-95 hover:border-orange-400"
          >
            <Camera className="h-7 w-7" />
            <span className="text-xs font-semibold">Tirar foto</span>
          </button>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            onChange={e => addFiles(e.target.files)}
          />

          {/* Arquivo */}
          <button
            onClick={() => fileRef.current?.click()}
            className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 py-5 text-slate-500 transition active:scale-95 hover:border-slate-400"
          >
            <Upload className="h-7 w-7" />
            <span className="text-xs font-semibold">Selecionar arquivo</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf,.docx,.doc"
            multiple
            className="hidden"
            onChange={e => addFiles(e.target.files)}
          />
        </div>
      </div>

      {files.length > 1 && (
        <div className="flex items-start gap-2 rounded-xl bg-blue-50 px-3 py-2.5">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
          <p className="text-[11px] text-blue-700">
            {files.length} arquivos serão <strong>mesclados automaticamente em um único PDF</strong> pela IA, na ordem acima.
          </p>
        </div>
      )}

      {error && (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200">{error}</p>
      )}

      {/* Ações */}
      <div className="flex gap-3">
        <button
          onClick={onClose}
          disabled={uploading}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          onClick={handleSubmit}
          disabled={uploading || files.length === 0}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-orange-500 py-3 text-sm font-bold text-white shadow-sm hover:bg-orange-600 active:scale-[0.98] disabled:opacity-60"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {uploading ? 'Enviando...' : 'Enviar'}
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

  return (
    <div className={`rounded-2xl border bg-white p-4 shadow-sm transition ${
      item.status === 'approved' ? 'border-emerald-200' :
      item.status === 'rejected' ? 'border-rose-200' :
      item.status === 'uploaded' ? 'border-blue-200' :
      'border-slate-200'
    }`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 shrink-0 ${statusInfo.color}`}>
          {statusInfo.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-slate-900">{item.label}</p>
            {!item.required && (
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                Opcional
              </span>
            )}
          </div>

          {item.description && (
            <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>
          )}

          {/* Upload info */}
          {upload && (
            <div className="mt-2 space-y-1.5">
              {upload.processing_status === 'pending' && (
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Aguardando processamento...
                </div>
              )}
              {upload.processing_status === 'processing' && (
                <div className="flex items-center gap-1.5 text-xs text-blue-600">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Convertendo para PDF e identificando...
                </div>
              )}
              {(upload.processing_status === 'ready' || upload.processing_status === 'error') && (
                <div className="flex items-center gap-1.5 flex-wrap text-xs text-slate-600">
                  <FileText className="h-3 w-3 shrink-0 text-orange-500" />
                  <span className="font-medium truncate max-w-[160px]">{upload.final_name || 'documento.pdf'}</span>
                  {upload.ai_document_type && (
                    <span className="rounded-full bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700 ring-1 ring-orange-100">
                      {upload.ai_document_type}
                    </span>
                  )}
                  {item.status === 'approved' && (
                    <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                      Aprovado ✓
                    </span>
                  )}
                </div>
              )}
              {item.status === 'rejected' && upload.rejection_reason && (
                <div className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-2.5 py-2 text-xs text-rose-700">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{upload.rejection_reason}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Botão de ação */}
      {canUpload && !open && (
        <button
          onClick={() => setOpen(true)}
          className={`mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold transition active:scale-[0.98] ${
            item.status === 'rejected'
              ? 'bg-rose-500 text-white hover:bg-rose-600'
              : item.status === 'uploaded'
              ? 'border border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100'
              : 'bg-orange-500 text-white hover:bg-orange-600'
          }`}
        >
          {item.status === 'rejected'
            ? <><RotateCcw className="h-4 w-4" /> Reenviar</>
            : item.status === 'uploaded'
            ? <><Plus className="h-4 w-4" /> Enviar outro arquivo</>
            : <><Camera className="h-4 w-4" /> Enviar documento</>}
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
    <div className="space-y-5">
      <PageHeader
        title="Documentos"
        subtitle={pendingCount > 0
          ? `${pendingCount} solicitação${pendingCount > 1 ? 'ões' : ''} aguardando envio`
          : 'Documentos solicitados pelo escritório'}
        icon={FolderOpen}
      />

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map(i => (
            <div key={i} className="h-32 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      ) : requests.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="Sem solicitações"
          description="O escritório ainda não solicitou nenhum documento."
        />
      ) : (
        <div className="space-y-4">
          {requests.map((req) => {
            const isExpanded = expanded.has(req.id);
            const s = REQUEST_STATUS[req.status] || REQUEST_STATUS.pending;
            const doneCount = req.items.filter(i => i.status === 'approved' || i.status === 'uploaded').length;
            const totalCount = req.items.length;

            return (
              <div key={req.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                {/* Header da solicitação */}
                <button
                  onClick={() => toggleExpand(req.id)}
                  className="flex w-full items-start gap-3 p-4 text-left hover:bg-slate-50/60 transition"
                >
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600 ring-1 ring-orange-100">
                    <FolderOpen className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-slate-900">{req.title}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${s.color}`}>
                        {s.label}
                      </span>
                    </div>
                    {req.description && (
                      <p className="mt-0.5 text-xs text-slate-500 line-clamp-1">{req.description}</p>
                    )}
                    <div className="mt-2 flex items-center gap-3">
                      {/* Barra de progresso */}
                      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-orange-400 transition-all"
                          style={{ width: totalCount ? `${(doneCount / totalCount) * 100}%` : '0%' }}
                        />
                      </div>
                      <span className="text-[11px] font-semibold text-slate-500">
                        {doneCount}/{totalCount}
                      </span>
                      {req.due_date && (
                        <span className="text-[11px] text-slate-400">
                          Prazo: {formatDate(req.due_date)}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className={`mt-1 h-4 w-4 shrink-0 text-slate-300 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                </button>

                {/* Lista de itens */}
                {isExpanded && (
                  <div className="border-t border-slate-100 p-4 space-y-3">
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
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PortalDocumentRequests;
