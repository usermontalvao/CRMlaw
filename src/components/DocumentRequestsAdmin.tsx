/**
 * DocumentRequestsAdmin â€” Painel admin para criar e gerenciar
 * solicitaÃ§Ãµes de documentos para um cliente especÃ­fico.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  FolderOpen, Plus, Trash2, Check, X, Loader2, ChevronDown,
  CheckCircle2, Clock, XCircle, AlertCircle, Download, Eye,
  GripVertical, FileText, Send,
} from 'lucide-react';
import { supabase } from '../config/supabase';
import type { Client } from '../types/client.types';

// â”€â”€ Tipos â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface DocUpload {
  id: string;
  processing_status: string;
  review_status: string;
  rejection_reason?: string | null;
  final_name?: string | null;
  ai_document_type?: string | null;
  ai_confidence?: number | null;
  pages_count?: number | null;
  uploaded_at: string;
  processed_path?: string | null;
}

interface DocItem {
  id: string;
  label: string;
  description?: string | null;
  required: boolean;
  sort_order: number;
  status: string;
  upload?: DocUpload | null;
}

interface DocRequest {
  id: string;
  title: string;
  description?: string | null;
  due_date?: string | null;
  status: string;
  created_at: string;
  items: DocItem[];
}

const STATUS_STYLE: Record<string, string> = {
  pending:   'text-amber-700 bg-amber-50 ring-amber-200',
  partial:   'text-blue-700 bg-blue-50 ring-blue-200',
  complete:  'text-emerald-700 bg-emerald-50 ring-emerald-200',
  reviewed:  'text-slate-600 bg-slate-100 ring-slate-200',
  cancelled: 'text-slate-400 bg-slate-50 ring-slate-100',
};
const STATUS_LABEL: Record<string, string> = {
  pending: 'Aguardando', partial: 'Em andamento', complete: 'Completo',
  reviewed: 'Revisado', cancelled: 'Cancelado',
};

// SugestÃµes rÃ¡pidas de documentos
const QUICK_ITEMS = [
  'RG (frente e verso)', 'CPF', 'CNH (frente e verso)', 'Passaporte',
  'Comprovante de residÃªncia', 'CertidÃ£o de nascimento', 'CertidÃ£o de casamento',
  'Carteira de trabalho', 'Contracheque / Holerite', 'Contrato de trabalho',
  'Laudo mÃ©dico / Exame', 'ProcuraÃ§Ã£o', 'Nota fiscal', 'Comprovante bancÃ¡rio',
];

// â”€â”€ Modal de criaÃ§Ã£o â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface CreateModalProps {
  client: Client;
  onClose: () => void;
  onCreated: () => void;
}

const CreateRequestModal: React.FC<CreateModalProps> = ({ client, onClose, onCreated }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [items, setItems] = useState([{ label: '', description: '', required: true }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addItem = (label = '') => {
    setItems(prev => [...prev, { label, description: '', required: true }]);
  };

  const removeItem = (idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    const validItems = items.filter(i => i.label.trim());
    if (!title.trim()) { setError('Informe um tÃ­tulo para a solicitaÃ§Ã£o.'); return; }
    if (validItems.length === 0) { setError('Adicione pelo menos um documento.'); return; }

    setSaving(true); setError(null);
    try {
      // Cria solicitaÃ§Ã£o
      const { data: req, error: re } = await supabase
        .from('document_requests')
        .insert({
          client_id: client.id,
          title: title.trim(),
          description: description.trim() || null,
          due_date: dueDate || null,
        })
        .select('id')
        .single();
      if (re || !req) throw new Error(re?.message || 'Erro ao criar solicitaÃ§Ã£o');

      // Cria itens
      await supabase.from('document_request_items').insert(
        validItems.map((item, i) => ({
          request_id: req.id,
          label: item.label.trim(),
          description: item.description.trim() || null,
          required: item.required,
          sort_order: i,
        }))
      );

      // NotificaÃ§Ã£o disparada automaticamente pelo trigger no banco
      onCreated();
    } catch (err: any) {
      setError(err.message || 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto px-3 py-6 sm:px-6">
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-[#f8f7f5] rounded-2xl shadow-2xl ring-1 ring-black/5 overflow-hidden my-auto">
        <div className="h-1.5 w-full bg-gradient-to-r from-orange-500 to-amber-400" />

        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Nova solicitaÃ§Ã£o</p>
            <h2 className="text-base font-bold text-slate-900">{client.full_name}</h2>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto max-h-[70vh] p-5 space-y-5">
          {/* TÃ­tulo */}
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
              TÃ­tulo da solicitaÃ§Ã£o *
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Ex: Documentos para audiÃªncia trabalhista"
              className="w-full rounded-xl border border-[#e7e5df] px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400"
            />
          </div>

          {/* DescriÃ§Ã£o */}
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
              InstruÃ§Ãµes (opcional)
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="InstruÃ§Ãµes gerais para o cliente..."
              rows={2}
              className="w-full rounded-xl border border-[#e7e5df] px-3.5 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400"
            />
          </div>

          {/* Prazo */}
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
              Prazo para envio (opcional)
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              className="w-full rounded-xl border border-[#e7e5df] px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400"
            />
          </div>

          {/* Lista de documentos */}
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500">
              Documentos necessÃ¡rios *
            </label>

            <div className="space-y-2 mb-3">
              {items.map((item, idx) => (
                <div key={idx} className="flex gap-2 items-start">
                  <div className="flex-1 space-y-1.5">
                    <input
                      type="text"
                      value={item.label}
                      onChange={e => setItems(prev => prev.map((it, i) => i === idx ? { ...it, label: e.target.value } : it))}
                      placeholder="Nome do documento"
                      className="w-full rounded-lg border border-[#e7e5df] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400"
                    />
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={item.required}
                          onChange={e => setItems(prev => prev.map((it, i) => i === idx ? { ...it, required: e.target.checked } : it))}
                          className="rounded accent-orange-500"
                        />
                        ObrigatÃ³rio
                      </label>
                    </div>
                  </div>
                  <button
                    onClick={() => removeItem(idx)}
                    className="mt-2 rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* SugestÃµes rÃ¡pidas */}
            <div className="mb-2">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">AdiÃ§Ã£o rÃ¡pida</p>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_ITEMS.filter(q => !items.some(i => i.label === q)).slice(0, 8).map(q => (
                  <button
                    key={q}
                    onClick={() => addItem(q)}
                    className="inline-flex items-center gap-1 rounded-full border border-[#e7e5df] bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700 transition"
                  >
                    <Plus className="h-3 w-3" /> {q}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => addItem()}
              className="flex items-center gap-1.5 text-xs font-semibold text-orange-600 hover:text-orange-700"
            >
              <Plus className="h-3.5 w-3.5" /> Adicionar documento personalizado
            </button>
          </div>

          {error && (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200">{error}</p>
          )}
        </div>

        <div className="flex gap-3 border-t border-slate-100 px-5 py-4">
          <button onClick={onClose} disabled={saving}
            className="flex-1 rounded-xl border border-[#e7e5df] py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-orange-500 py-2.5 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {saving ? 'Enviando...' : 'Criar solicitaÃ§Ã£o'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

// â”€â”€ Componente principal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface Props { client: Client; }

export const DocumentRequestsAdmin: React.FC<Props> = ({ client }) => {
  const [requests, setRequests] = useState<DocRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [reviewLoading, setReviewLoading] = useState<string | null>(null);
  const [rejectInput, setRejectInput] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('document_requests')
      .select(`
        id, title, description, due_date, status, created_at,
        document_request_items (
          id, label, description, required, sort_order, status,
          document_uploads (
            id, processing_status, review_status, rejection_reason,
            final_name, ai_document_type, ai_confidence, pages_count,
            uploaded_at, processed_path
          )
        )
      `)
      .eq('client_id', client.id)
      .order('created_at', { ascending: false });

    if (data) {
      const formatted: DocRequest[] = data.map((r: any) => ({
        ...r,
        items: (r.document_request_items || [])
          .sort((a: any, b: any) => a.sort_order - b.sort_order)
          .map((item: any) => ({
            ...item,
            upload: item.document_uploads?.[0] || null,
          })),
      }));
      setRequests(formatted);
    }
    setLoading(false);
  }, [client.id]);

  useEffect(() => { load(); }, [load]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const handleApprove = async (uploadId: string, itemId: string) => {
    setReviewLoading(uploadId);
    await supabase.from('document_uploads').update({ review_status: 'approved', reviewed_at: new Date().toISOString() }).eq('id', uploadId);
    await supabase.from('document_request_items').update({ status: 'approved' }).eq('id', itemId);
    // Notifica cliente
    await supabase.from('portal_client_notifications').insert({
      client_id: client.id, type: 'document_upload_approved',
      title: 'Documento aprovado âœ“',
      message: 'O escritÃ³rio aprovou um dos documentos enviados por vocÃª.',
      metadata: { upload_id: uploadId, request_item_id: itemId },
    }).then(() => null, () => null);
    await load();
    setReviewLoading(null);
  };

  const handleReject = async (uploadId: string, itemId: string) => {
    setReviewLoading(uploadId);
    await supabase.from('document_uploads').update({ review_status: 'rejected', rejection_reason: rejectReason || 'Documento nÃ£o aceito.', reviewed_at: new Date().toISOString() }).eq('id', uploadId);
    await supabase.from('document_request_items').update({ status: 'rejected' }).eq('id', itemId);
    // Notifica cliente
    await supabase.from('portal_client_notifications').insert({
      client_id: client.id, type: 'document_upload_rejected',
      title: 'Documento nÃ£o aprovado',
      message: rejectReason ? `Motivo: ${rejectReason}` : 'O escritÃ³rio solicitou o reenvio do documento.',
      metadata: { upload_id: uploadId, request_item_id: itemId },
    }).then(() => null, () => null);
    await load();
    setReviewLoading(null); setRejectInput(null); setRejectReason('');
  };

  const getSignedUrl = async (path: string) => {
    const { data } = await supabase.storage.from('client-documents').createSignedUrl(path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
          SolicitaÃ§Ãµes de documentos ({requests.length})
        </p>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-orange-600 transition"
        >
          <Plus className="h-3.5 w-3.5" /> Nova solicitaÃ§Ã£o
        </button>
      </div>

      {loading ? (
        <div className="flex h-20 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      ) : requests.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-[#e7e5df] py-8 text-center">
          <FolderOpen className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-xs text-slate-400">Nenhuma solicitaÃ§Ã£o ainda</p>
          <button onClick={() => setShowCreate(true)}
            className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-orange-600 hover:underline">
            <Plus className="h-3.5 w-3.5" /> Criar primeira solicitaÃ§Ã£o
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map(req => {
            const isOpen = expanded.has(req.id);
            const doneCount = req.items.filter(i => i.status === 'approved' || i.status === 'uploaded').length;

            return (
              <div key={req.id} className="overflow-hidden rounded-xl border border-[#e7e5df] bg-[#f8f7f5]">
                <button
                  onClick={() => toggleExpand(req.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50/60 transition"
                >
                  <FolderOpen className="h-4 w-4 shrink-0 text-orange-500" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-slate-900 truncate">{req.title}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${STATUS_STYLE[req.status] || STATUS_STYLE.pending}`}>
                        {STATUS_LABEL[req.status] || req.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      {doneCount}/{req.items.length} docs Â· {new Date(req.created_at).toLocaleDateString('pt-BR')}
                      {req.due_date && ` Â· prazo ${new Date(req.due_date).toLocaleDateString('pt-BR')}`}
                    </p>
                  </div>
                  <ChevronDown className={`h-4 w-4 text-slate-300 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {isOpen && (
                  <div className="border-t border-slate-100 px-4 py-3 space-y-3">
                    {req.items.map(item => (
                      <div key={item.id} className={`rounded-xl border p-3 ${
                        item.status === 'approved' ? 'border-emerald-200 bg-emerald-50/30' :
                        item.status === 'rejected' ? 'border-rose-200 bg-rose-50/30' :
                        item.upload ? 'border-blue-200 bg-blue-50/30' :
                        'border-[#e7e5df]'
                      }`}>
                        <div className="flex items-start gap-2">
                          <div className="mt-0.5 shrink-0">
                            {item.status === 'approved' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> :
                             item.status === 'rejected' ? <XCircle className="h-4 w-4 text-rose-500" /> :
                             item.upload ? <Clock className="h-4 w-4 text-blue-500" /> :
                             <Clock className="h-4 w-4 text-slate-400" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-slate-800">{item.label}</p>
                            {item.upload?.final_name && (
                              <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                <FileText className="h-3 w-3 text-orange-500 shrink-0" />
                                <span className="text-[11px] text-slate-600 font-medium">{item.upload.final_name}</span>
                                {item.upload.ai_document_type && (
                                  <span className="rounded-full bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700 ring-1 ring-orange-100">
                                    {item.upload.ai_document_type}
                                  </span>
                                )}
                                {item.upload.pages_count && (
                                  <span className="text-[10px] text-slate-400">{item.upload.pages_count}p</span>
                                )}
                              </div>
                            )}
                          </div>

                          {/* AÃ§Ãµes de revisÃ£o */}
                          {item.upload && item.upload.processing_status === 'ready' && item.upload.review_status === 'pending' && (
                            <div className="flex gap-1.5 shrink-0">
                              {item.upload.processed_path && (
                                <button onClick={() => getSignedUrl(item.upload!.processed_path!)}
                                  className="rounded-lg border border-[#e7e5df] p-1.5 text-slate-500 hover:bg-slate-100" title="Visualizar">
                                  <Eye className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {rejectInput === item.upload.id ? (
                                <div className="flex gap-1">
                                  <input type="text" value={rejectReason}
                                    onChange={e => setRejectReason(e.target.value)}
                                    placeholder="Motivo"
                                    className="w-28 rounded-lg border border-[#e7e5df] px-2 py-1 text-xs focus:outline-none" />
                                  <button onClick={() => { setRejectInput(null); setRejectReason(''); }}
                                    className="rounded-lg border border-[#e7e5df] px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-50">âœ•</button>
                                  <button disabled={!!reviewLoading}
                                    onClick={() => handleReject(item.upload!.id, item.id)}
                                    className="rounded-lg bg-rose-500 px-2 py-1 text-xs font-bold text-white hover:bg-rose-600 disabled:opacity-60">
                                    {reviewLoading === item.upload.id ? '...' : 'OK'}
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <button onClick={() => { setRejectInput(item.upload!.id); setRejectReason(''); }}
                                    className="rounded-lg border border-rose-200 px-2 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50">
                                    Rejeitar
                                  </button>
                                  <button disabled={!!reviewLoading}
                                    onClick={() => handleApprove(item.upload!.id, item.id)}
                                    className="rounded-lg bg-emerald-500 px-2 py-1.5 text-xs font-bold text-white hover:bg-emerald-600 disabled:opacity-60">
                                    {reviewLoading === item.upload.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                  </button>
                                </>
                              )}
                            </div>
                          )}

                          {item.upload?.processed_path && item.status === 'approved' && (
                            <button onClick={() => getSignedUrl(item.upload!.processed_path!)}
                              className="shrink-0 rounded-lg border border-[#e7e5df] p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50" title="Baixar">
                              <Download className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <CreateRequestModal
          client={client}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
    </div>
  );
};

export default DocumentRequestsAdmin;

