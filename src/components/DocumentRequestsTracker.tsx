/**
 * DocumentRequestsTracker — Drawer discreto no header para acompanhar
 * e criar solicitações de documentos.
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X, FolderOpen, CheckCircle2, Clock, XCircle,
  ChevronDown, ChevronRight, Loader2, Check, Edit2, Trash2,
  Plus, Calendar, User, RefreshCw, FolderCheck, Search, Send,
  Eye, Download, FileText, AlertCircle, Pencil, Maximize2, ExternalLink,
} from 'lucide-react';
import { supabase } from '../config/supabase';
import { clientService } from '../services/client.service';

// ── Tipos ──────────────────────────────────────────────────────────────────

interface TrackerUpload {
  id: string;
  processing_status: string; // pending | processing | ready | error
  review_status: string;     // pending | approved | rejected
  final_name?: string | null;
  ai_document_type?: string | null;
  pages_count?: number | null;
  processed_path?: string | null;
  rejection_reason?: string | null;
}

interface TrackerItem {
  id: string;
  label: string;
  required: boolean;
  sort_order: number;
  status: string;
  upload?: TrackerUpload | null;
}

interface TrackerRequest {
  id: string;
  title: string;
  description?: string | null;
  due_date?: string | null;
  status: string;
  created_at: string;
  client_id: string;
  client_name: string;
  items: TrackerItem[];
}

type ClientResult = Awaited<ReturnType<typeof clientService.searchClients>>[number];

// ── Helpers ────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  pending:   'text-amber-700 bg-amber-50 ring-1 ring-amber-200',
  partial:   'text-blue-700 bg-blue-50 ring-1 ring-blue-200',
  complete:  'text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200',
  reviewed:  'text-slate-500 bg-slate-100 ring-1 ring-slate-200',
  cancelled: 'text-slate-400 bg-slate-50 ring-1 ring-slate-100',
};
const STATUS_LABEL: Record<string, string> = {
  pending: 'Aguardando', partial: 'Em andamento', complete: 'Completo',
  reviewed: 'Revisado', cancelled: 'Cancelado',
};
const QUICK_ITEMS = [
  'RG (frente e verso)', 'CPF', 'CNH (frente e verso)',
  'Comprovante de residência', 'Certidão de nascimento', 'Certidão de casamento',
  'Contracheque / Holerite', 'Contrato de trabalho', 'Laudo médico',
  'Procuração', 'Nota fiscal', 'Comprovante bancário', 'Passaporte',
];

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : null;
const isOverdue = (due?: string | null) =>
  due ? new Date(due + 'T23:59:59') < new Date() : false;

const getSignedUrl = async (path: string): Promise<string | null> => {
  const { data } = await supabase.storage.from('client-documents').createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
};

// ── Modal: Preview de documento ───────────────────────────────────────────

interface PreviewModalProps {
  path: string;
  fileName: string;
  onClose: () => void;
}

const PreviewModal: React.FC<PreviewModalProps> = ({ path, fileName, onClose }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    getSignedUrl(path).then(u => {
      if (u) { setUrl(u); setLoading(false); }
      else { setError(true); setLoading(false); }
    });
  }, [path]);

  // Fecha com Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-3 sm:p-6">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[3px]" onClick={onClose} />

      {/* Container do modal */}
      <div
        className="relative z-10 flex flex-col w-full rounded-2xl overflow-hidden"
        style={{
          maxWidth: 860,
          height: 'min(90vh, 820px)',
          boxShadow: '0 32px 80px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.06)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Barra topo laranja */}
        <div className="h-1 w-full bg-gradient-to-r from-orange-500 to-amber-400 flex-shrink-0" />

        {/* Header branco */}
        <div className="flex items-center gap-3 bg-[#f8f7f5] border-b border-slate-100 px-4 py-3 flex-shrink-0">
          <div className="w-8 h-8 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center flex-shrink-0">
            <FileText className="h-4 w-4 text-orange-500" />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate leading-tight">{fileName}</p>
            <p className="text-[10px] text-slate-400 leading-tight">Documento do cliente</p>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            {url && (
              <>
                <a href={url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#e7e5df] px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
                  title="Abrir em nova aba">
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Nova aba</span>
                </a>
                <button
                  onClick={async () => {
                    try {
                      const resp = await fetch(url);
                      const blob = await resp.blob();
                      const blobUrl = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = blobUrl;
                      a.download = fileName;
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
                    } catch { window.open(url, '_blank'); }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 px-2.5 py-1.5 text-xs font-semibold text-white transition"
                  title="Baixar">
                  <Download className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Baixar</span>
                </button>
              </>
            )}
            <button onClick={onClose}
              className="ml-1 rounded-lg p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Área do PDF */}
        <div className="flex-1 bg-[#f4f4f4] relative min-h-0">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#f8f7f5]">
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-orange-100 flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
                </div>
                <p className="text-sm text-slate-500 font-medium">Carregando documento...</p>
              </div>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#f8f7f5]">
              <div className="flex flex-col items-center gap-3 text-center px-8">
                <div className="w-12 h-12 rounded-2xl bg-rose-100 flex items-center justify-center">
                  <AlertCircle className="h-6 w-6 text-rose-500" />
                </div>
                <p className="text-sm text-slate-700 font-semibold">Não foi possível carregar</p>
                <p className="text-xs text-slate-400">Tente baixar o arquivo diretamente</p>
              </div>
            </div>
          )}

          {url && (
            <iframe
              src={url}
              className="w-full h-full border-0"
              title={fileName}
              style={{ display: loading ? 'none' : 'block' }}
              onLoad={() => setLoading(false)}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

// ── Modal base ────────────────────────────────────────────────────────────

const ModalShell: React.FC<{ onClose: () => void; children: React.ReactNode }> = ({ onClose, children }) =>
  createPortal(
    <div className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto px-3 py-8">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-[#f8f7f5] rounded-2xl shadow-2xl ring-1 ring-black/5 overflow-hidden my-auto">
        <div className="h-1 w-full bg-gradient-to-r from-orange-500 to-amber-400" />
        {children}
      </div>
    </div>,
    document.body
  );

// ── Modal: Nova Solicitação ────────────────────────────────────────────────

interface CreateModalProps { onClose: () => void; onCreated: () => void; }

const CreateRequestModal: React.FC<CreateModalProps> = ({ onClose, onCreated }) => {
  const [step, setStep] = useState<'client' | 'form'>('client');
  const [clientQuery, setClientQuery] = useState('');
  const [clientResults, setClientResults] = useState<ClientResult[]>([]);
  const [clientLoading, setClientLoading] = useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientResult | null>(null);
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [items, setItems] = useState([{ label: '', required: true }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (clientQuery.trim().length < 2) { setClientResults([]); return; }
    setClientLoading(true);
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(async () => {
      try {
        const res = await clientService.searchClients(clientQuery.trim());
        setClientResults(res.slice(0, 8));
      } catch { setClientResults([]); }
      finally { setClientLoading(false); }
    }, 280);
    return () => { if (searchRef.current) clearTimeout(searchRef.current); };
  }, [clientQuery]);

  const addItem = (label = '') => setItems(prev => [...prev, { label, required: true }]);
  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));

  const handleSave = async () => {
    if (!selectedClient) return;
    const valid = items.filter(i => i.label.trim());
    if (!title.trim()) { setError('Informe um título.'); return; }
    if (valid.length === 0) { setError('Adicione pelo menos um documento.'); return; }
    setSaving(true); setError(null);
    try {
      const { data: req, error: re } = await supabase
        .from('document_requests')
        .insert({ client_id: selectedClient.id, title: title.trim(), description: description.trim() || null, due_date: dueDate || null })
        .select('id').single();
      if (re || !req) throw new Error(re?.message || 'Erro');
      await supabase.from('document_request_items').insert(
        valid.map((item, i) => ({ request_id: req.id, label: item.label.trim(), required: item.required, sort_order: i }))
      );
      onCreated();
    } catch (err: any) { setError(err.message || 'Erro ao salvar.'); }
    finally { setSaving(false); }
  };

  return (
    <ModalShell onClose={onClose}>
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            {step === 'client' ? 'Selecionar cliente' : 'Nova solicitação'}
          </p>
          <h2 className="text-sm font-bold text-slate-900">
            {step === 'client' ? 'Para quem é a solicitação?' : selectedClient?.full_name}
          </h2>
        </div>
        <div className="flex items-center gap-1">
          {step === 'form' && (
            <button onClick={() => { setStep('client'); setSelectedClient(null); setClientQuery(''); setError(null); }}
              className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 transition">
              ← Trocar cliente
            </button>
          )}
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
      </div>

      {step === 'client' && (
        <div className="p-5 space-y-3">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <input autoFocus type="text" value={clientQuery} onChange={e => setClientQuery(e.target.value)}
              placeholder="Digite o nome do cliente..."
              className="w-full rounded-xl border border-[#e7e5df] pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400" />
            {clientLoading && <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-slate-400" />}
          </div>
          {clientResults.length > 0 && (
            <div className="space-y-1">
              {clientResults.map(c => (
                <button key={c.id} onClick={() => { setSelectedClient(c); setStep('form'); }}
                  className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left hover:bg-orange-50 border border-transparent hover:border-orange-200 transition-all">
                  <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-orange-600">{(c.full_name || '?').charAt(0).toUpperCase()}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{c.full_name}</p>
                    {c.email && <p className="text-[11px] text-slate-400 truncate">{c.email}</p>}
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0 ml-auto" />
                </button>
              ))}
            </div>
          )}
          {clientQuery.trim().length >= 2 && !clientLoading && clientResults.length === 0 && (
            <p className="text-center text-sm text-slate-400 py-4">Nenhum cliente encontrado</p>
          )}
          {clientQuery.trim().length < 2 && (
            <p className="text-center text-xs text-slate-300 py-4">Digite pelo menos 2 caracteres para buscar</p>
          )}
        </div>
      )}

      {step === 'form' && (
        <>
          <div className="overflow-y-auto max-h-[65vh] p-5 space-y-4">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Título *</label>
              <input autoFocus type="text" value={title} onChange={e => setTitle(e.target.value)}
                placeholder="Ex: Documentos para audiência trabalhista"
                className="w-full rounded-xl border border-[#e7e5df] px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Instruções (opcional)</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Instruções gerais para o cliente..." rows={2}
                className="w-full rounded-xl border border-[#e7e5df] px-3.5 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Prazo (opcional)</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                className="w-full rounded-xl border border-[#e7e5df] px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400" />
            </div>
            <div>
              <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Documentos *</label>
              <div className="space-y-2 mb-3">
                {items.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input type="text" value={item.label}
                      onChange={e => setItems(prev => prev.map((it, i) => i === idx ? { ...it, label: e.target.value } : it))}
                      placeholder="Nome do documento"
                      className="flex-1 rounded-lg border border-[#e7e5df] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400" />
                    <label className="flex items-center gap-1 text-[10px] text-slate-500 cursor-pointer whitespace-nowrap">
                      <input type="checkbox" checked={item.required}
                        onChange={e => setItems(prev => prev.map((it, i) => i === idx ? { ...it, required: e.target.checked } : it))}
                        className="rounded accent-orange-500" />
                      Obrig.
                    </label>
                    <button onClick={() => removeItem(idx)} className="rounded-lg p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-400 transition">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mb-2.5 flex flex-wrap gap-1.5">
                {QUICK_ITEMS.filter(q => !items.some(i => i.label === q)).slice(0, 6).map(q => (
                  <button key={q} onClick={() => addItem(q)}
                    className="inline-flex items-center gap-1 rounded-full border border-[#e7e5df] bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600 hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700 transition">
                    <Plus className="h-3 w-3" /> {q}
                  </button>
                ))}
              </div>
              <button onClick={() => addItem()} className="flex items-center gap-1.5 text-xs font-semibold text-orange-600 hover:text-orange-700 transition">
                <Plus className="h-3.5 w-3.5" /> Adicionar documento
              </button>
            </div>
            {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200">{error}</p>}
          </div>
          <div className="flex gap-3 border-t border-slate-100 px-5 py-4">
            <button onClick={onClose} disabled={saving}
              className="flex-1 rounded-xl border border-[#e7e5df] py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              Cancelar
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-orange-500 py-2.5 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {saving ? 'Criando...' : 'Criar solicitação'}
            </button>
          </div>
        </>
      )}
    </ModalShell>
  );
};

// ── Modal: Editar Lista ────────────────────────────────────────────────────

interface EditListModalProps { request: TrackerRequest; onClose: () => void; onSaved: () => void; }

const EditListModal: React.FC<EditListModalProps> = ({ request, onClose, onSaved }) => {
  const [title, setTitle] = useState(request.title);
  const [description, setDescription] = useState(request.description || '');
  const [dueDate, setDueDate] = useState(request.due_date || '');
  const [items, setItems] = useState(
    request.items.sort((a, b) => a.sort_order - b.sort_order)
      .map(i => ({ id: i.id, label: i.label, required: i.required, isNew: false, toDelete: false }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addItem = (label = '') =>
    setItems(prev => [...prev, { id: crypto.randomUUID(), label, required: true, isNew: true, toDelete: false }]);
  const removeItem = (idx: number) =>
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, toDelete: true } : it));
  const visibleItems = items.filter(i => !i.toDelete);

  const handleSave = async () => {
    const valid = visibleItems.filter(i => i.label.trim());
    if (!title.trim()) { setError('Informe um título.'); return; }
    if (valid.length === 0) { setError('Adicione pelo menos um documento.'); return; }
    setSaving(true); setError(null);
    try {
      await supabase.from('document_requests').update({ title: title.trim(), description: description.trim() || null, due_date: dueDate || null }).eq('id', request.id);
      const toDelete = items.filter(i => !i.isNew && i.toDelete);
      if (toDelete.length) await supabase.from('document_request_items').delete().in('id', toDelete.map(i => i.id));
      const toInsert = valid.filter(i => i.isNew);
      if (toInsert.length) {
        await supabase.from('document_request_items').insert(
          toInsert.map((item, idx) => ({ request_id: request.id, label: item.label.trim(), required: item.required, sort_order: valid.indexOf(item) + idx }))
        );
      }
      for (const item of valid.filter(i => !i.isNew))
        await supabase.from('document_request_items').update({ sort_order: valid.indexOf(item) }).eq('id', item.id);
      onSaved();
    } catch (err: any) { setError(err.message || 'Erro ao salvar.'); }
    finally { setSaving(false); }
  };

  return (
    <ModalShell onClose={onClose}>
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Editar solicitação</p>
          <h2 className="text-sm font-bold text-slate-900">{request.client_name}</h2>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
      </div>
      <div className="overflow-y-auto max-h-[65vh] p-5 space-y-4">
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Título *</label>
          <input type="text" value={title} onChange={e => setTitle(e.target.value)}
            className="w-full rounded-xl border border-[#e7e5df] px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400" />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Instruções</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
            className="w-full rounded-xl border border-[#e7e5df] px-3.5 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400" />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Prazo</label>
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
            className="w-full rounded-xl border border-[#e7e5df] px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400" />
        </div>
        <div>
          <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Lista de documentos *</label>
          <div className="space-y-2 mb-3">
            {visibleItems.map((item, idx) => (
              <div key={item.id} className="flex items-center gap-2">
                <input type="text" value={item.label}
                  onChange={e => { const label = e.target.value; setItems(prev => prev.map(it => it.id === item.id ? { ...it, label } : it)); }}
                  placeholder="Nome do documento"
                  className="flex-1 rounded-lg border border-[#e7e5df] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400" />
                <label className="flex items-center gap-1 text-[10px] text-slate-500 cursor-pointer whitespace-nowrap">
                  <input type="checkbox" checked={item.required}
                    onChange={e => { const required = e.target.checked; setItems(prev => prev.map(it => it.id === item.id ? { ...it, required } : it)); }}
                    className="rounded accent-orange-500" />
                  Obrig.
                </label>
                <button onClick={() => removeItem(items.findIndex(it => it.id === item.id))}
                  className="rounded-lg p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-400 transition">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {QUICK_ITEMS.filter(q => !visibleItems.some(i => i.label === q)).slice(0, 6).map(q => (
              <button key={q} onClick={() => addItem(q)}
                className="inline-flex items-center gap-1 rounded-full border border-[#e7e5df] bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600 hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700 transition">
                <Plus className="h-3 w-3" /> {q}
              </button>
            ))}
          </div>
          <button onClick={() => addItem()} className="flex items-center gap-1.5 text-xs font-semibold text-orange-600 hover:text-orange-700 transition">
            <Plus className="h-3.5 w-3.5" /> Adicionar documento
          </button>
        </div>
        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200">{error}</p>}
      </div>
      <div className="flex gap-3 border-t border-slate-100 px-5 py-4">
        <button onClick={onClose} disabled={saving}
          className="flex-1 rounded-xl border border-[#e7e5df] py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          Cancelar
        </button>
        <button onClick={handleSave} disabled={saving}
          className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-orange-500 py-2.5 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-60">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {saving ? 'Salvando...' : 'Salvar alterações'}
        </button>
      </div>
    </ModalShell>
  );
};

// ── Item de documento com upload ──────────────────────────────────────────

interface ItemRowProps {
  item: TrackerItem;
  actionLoading: string | null;
  isReviewed: boolean;
  onCheck: () => void;
  onRename: (uploadId: string, newName: string) => void;
}

const ItemRow: React.FC<ItemRowProps> = ({ item, actionLoading, isReviewed, onCheck, onRename }) => {
  const itemLoading = actionLoading === item.id + '-item';
  const isApproved = item.status === 'approved';
  const u = item.upload;
  const hasFile = !!u;
  const isReady = u?.processing_status === 'ready';
  const isProcessing = u?.processing_status === 'pending' || u?.processing_status === 'processing';
  const hasError = u?.processing_status === 'error';

  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const startRename = () => {
    setRenameDraft(u?.final_name || u?.ai_document_type || '');
    setRenaming(true);
  };

  const saveRename = async () => {
    if (!u || !renameDraft.trim()) { setRenaming(false); return; }
    setRenameLoading(true);
    await supabase.from('document_uploads').update({ final_name: renameDraft.trim() }).eq('id', u.id);
    onRename(u.id, renameDraft.trim());
    setRenaming(false);
    setRenameLoading(false);
  };

  return (
    <div className={`rounded-xl border overflow-hidden transition-all ${
      isApproved ? 'border-emerald-200 bg-emerald-50/40' :
      hasFile && isReady ? 'border-blue-200 bg-blue-50/30' :
      hasFile && isProcessing ? 'border-amber-200 bg-amber-50/20' :
      hasFile && hasError ? 'border-rose-200 bg-rose-50/20' :
      'border-[#e7e5df] bg-slate-50/60'
    }`}>
      {/* Linha principal: label + check */}
      <button
        onClick={onCheck}
        disabled={itemLoading || isReviewed || !hasFile}
        className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-all ${
          !hasFile || isReviewed ? 'cursor-default' : 'cursor-pointer hover:brightness-95'
        }`}
      >
        <div className="shrink-0 w-5 h-5 flex items-center justify-center">
          {itemLoading
            ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
            : isApproved
            ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            : hasFile && isReady
            ? <Clock className="h-4 w-4 text-blue-400" />
            : hasFile && isProcessing
            ? <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
            : hasFile && hasError
            ? <AlertCircle className="h-4 w-4 text-rose-400" />
            : <Clock className="h-4 w-4 text-slate-300" />}
        </div>
        <span className={`flex-1 text-xs font-medium truncate ${
          isApproved ? 'text-emerald-700 line-through' : 'text-slate-700'
        }`}>
          {item.label}
        </span>
        {item.required && !isApproved && <span className="shrink-0 text-[9px] font-bold text-rose-400">*</span>}
      </button>

      {/* Seção do arquivo — só aparece quando há upload */}
      {hasFile && (
        <div className={`border-t px-3 py-2 flex items-center gap-2 ${
          isApproved ? 'border-emerald-200' : isReady ? 'border-blue-100' : 'border-slate-100'
        }`}>
          <FileText className="h-3.5 w-3.5 text-slate-400 shrink-0" />

          {/* Nome do arquivo + renomear */}
          <div className="flex-1 min-w-0">
            {renaming ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={e => setRenameDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setRenaming(false); }}
                  className="flex-1 rounded border border-orange-300 px-2 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-orange-200 min-w-0"
                />
                <button onClick={saveRename} disabled={renameLoading}
                  className="shrink-0 rounded bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-orange-600 disabled:opacity-60">
                  {renameLoading ? '...' : 'OK'}
                </button>
                <button onClick={() => setRenaming(false)}
                  className="shrink-0 rounded border border-[#e7e5df] px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-50">
                  ✕
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1 min-w-0">
                <span className="text-[11px] text-slate-600 font-medium truncate">
                  {u?.final_name || u?.ai_document_type || 'Arquivo recebido'}
                </span>
                {u?.ai_document_type && u.final_name !== u.ai_document_type && (
                  <span className="shrink-0 rounded-full bg-orange-50 px-1.5 py-0.5 text-[9px] font-semibold text-orange-600 ring-1 ring-orange-100">
                    IA
                  </span>
                )}
                {u?.pages_count && (
                  <span className="shrink-0 text-[10px] text-slate-400">{u.pages_count}p</span>
                )}
              </div>
            )}
          </div>

          {/* Ações do arquivo */}
          {!renaming && (
            <div className="flex items-center gap-1 shrink-0">
              {/* Corrigir nome (IA errou) */}
              <button onClick={startRename}
                className="rounded p-1 text-slate-400 hover:text-orange-500 hover:bg-orange-50 transition" title="Corrigir nome">
                <Pencil className="h-3 w-3" />
              </button>

              {/* Visualizar → abre modal */}
              {isReady && u?.processed_path && (
                <button
                  onClick={() => setPreviewOpen(true)}
                  className="rounded p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition"
                  title="Visualizar documento"
                >
                  <Eye className="h-3.5 w-3.5" />
                </button>
              )}

              {/* Download via blob (cross-origin safe) */}
              {isReady && u?.processed_path && (
                <button
                  onClick={async () => {
                    const url = await getSignedUrl(u.processed_path!);
                    if (!url) return;
                    try {
                      const resp = await fetch(url);
                      const blob = await resp.blob();
                      const blobUrl = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = blobUrl;
                      a.download = u.final_name || u.ai_document_type || 'documento.pdf';
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
                    } catch { window.open(url, '_blank'); }
                  }}
                  className="rounded p-1 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition"
                  title="Baixar"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
              )}

              {/* Status de processamento */}
              {isProcessing && (
                <span className="text-[10px] text-amber-600 font-medium">Processando...</span>
              )}
              {hasError && (
                <span className="text-[10px] text-rose-500 font-medium">Erro</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Modal de preview */}
      {previewOpen && u?.processed_path && (
        <PreviewModal
          path={u.processed_path}
          fileName={u.final_name || u.ai_document_type || item.label || 'documento.pdf'}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
};

// ── Card individual de solicitação ─────────────────────────────────────────

interface CardProps {
  req: TrackerRequest;
  expanded: boolean;
  onToggle: () => void;
  actionLoading: string | null;
  editingDeadline: string | null;
  deadlineDraft: string;
  onDeadlineDraftChange: (v: string) => void;
  onStartEditDeadline: () => void;
  onCancelDeadlineEdit: () => void;
  onSaveDeadline: () => void;
  onCancel: () => void;
  onMarkReviewed: () => void;
  onEditList: () => void;
  onItemCheck: (item: TrackerItem) => void;
  onUploadRename: (uploadId: string, newName: string) => void;
}

const RequestCard: React.FC<CardProps> = ({
  req, expanded, onToggle, actionLoading, editingDeadline, deadlineDraft,
  onDeadlineDraftChange, onStartEditDeadline, onCancelDeadlineEdit, onSaveDeadline,
  onCancel, onMarkReviewed, onEditList, onItemCheck, onUploadRename,
}) => {
  const doneCount = req.items.filter(i => i.status === 'approved').length;
  const uploadedCount = req.items.filter(i =>
    i.status === 'approved' || i.status === 'uploaded' || !!i.upload
  ).length;
  const totalCount = req.items.length;
  // Barra usa uploadedCount; cor verde quando completo ou todos aprovados
  const progress = totalCount > 0 ? (uploadedCount / totalCount) * 100 : 0;
  const barGreen = req.status === 'complete' || req.status === 'reviewed' || doneCount === totalCount;
  const overdue = isOverdue(req.due_date);
  const isReviewed = req.status === 'reviewed';

  const cancelLoading = actionLoading === req.id + '-cancel';
  const reviewLoading = actionLoading === req.id + '-review';
  const deadlineLoading = actionLoading === req.id + '-deadline';
  const isEditingThisDeadline = editingDeadline === req.id;

  return (
    <div className={`rounded-2xl border overflow-hidden transition-all ${
      isReviewed ? 'border-slate-100 bg-slate-50/50' : 'border-[#e7e5df] bg-[#f8f7f5] shadow-sm'
    }`}>
      {/* Cabeçalho */}
      <button onClick={onToggle}
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50/70 transition-colors">
        <div className="mt-0.5 flex-shrink-0">
          {isReviewed ? <FolderCheck className="h-4 w-4 text-slate-300" /> : <FolderOpen className="h-4 w-4 text-orange-500" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-xs font-bold truncate ${isReviewed ? 'text-slate-400' : 'text-slate-900'}`}>{req.title}</span>
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold shrink-0 ${STATUS_STYLE[req.status] || STATUS_STYLE.pending}`}>
              {STATUS_LABEL[req.status] || req.status}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 flex-wrap">
            <User className="h-3 w-3 shrink-0" />
            <span className="font-medium text-slate-500 truncate max-w-[110px]">{req.client_name}</span>
            <span>·</span>
            <span>{uploadedCount}/{totalCount} enviados</span>
            {req.due_date && (
              <>
                <span>·</span>
                <span className={overdue && !isReviewed ? 'text-rose-500 font-semibold' : ''}>
                  {overdue && !isReviewed ? '⚠ ' : ''}prazo {fmtDate(req.due_date)}
                </span>
              </>
            )}
          </div>
          {totalCount > 0 && (
            <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${barGreen ? 'bg-emerald-500' : 'bg-orange-400'}`}
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
        {/* Botão "Concluído" direto no card quando completo e fechado */}
        {!isReviewed && req.status === 'complete' && !expanded && (
          <button
            onClick={e => { e.stopPropagation(); onMarkReviewed(); }}
            disabled={!!reviewLoading}
            className="shrink-0 flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors disabled:opacity-60"
          >
            {reviewLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderCheck className="h-3 w-3" />}
            Concluído
          </button>
        )}

        <div className="shrink-0 text-slate-300 mt-0.5">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
      </button>

      {/* Expandido */}
      {expanded && (
        <div className="border-t border-slate-100 px-4 py-3 space-y-2">
          {/* Itens */}
          {req.items.map(item => (
            <ItemRow
              key={item.id}
              item={item}
              actionLoading={actionLoading}
              isReviewed={isReviewed}
              onCheck={() => onItemCheck(item)}
              onRename={onUploadRename}
            />
          ))}

          {/* Prazo inline */}
          {!isReviewed && (
            <div className="flex items-center gap-2 pt-1">
              <Calendar className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              {isEditingThisDeadline ? (
                <div className="flex items-center gap-1.5 flex-1">
                  <input type="date" value={deadlineDraft} onChange={e => onDeadlineDraftChange(e.target.value)} autoFocus
                    className="flex-1 rounded-lg border border-orange-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-orange-100" />
                  <button onClick={onSaveDeadline} disabled={deadlineLoading}
                    className="rounded-lg bg-orange-500 px-2 py-1 text-xs font-bold text-white hover:bg-orange-600 disabled:opacity-60">
                    {deadlineLoading ? '...' : 'OK'}
                  </button>
                  <button onClick={onCancelDeadlineEdit}
                    className="rounded-lg border border-[#e7e5df] px-2 py-1 text-xs text-slate-500 hover:bg-slate-50">✕</button>
                </div>
              ) : (
                <button onClick={onStartEditDeadline}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-orange-600 transition-colors">
                  {req.due_date
                    ? <span className={overdue ? 'text-rose-500 font-semibold' : ''}>{overdue ? '⚠ ' : ''}Prazo: {fmtDate(req.due_date)}</span>
                    : <span className="text-slate-400">Definir prazo</span>}
                  <Edit2 className="h-2.5 w-2.5 ml-0.5" />
                </button>
              )}
            </div>
          )}

          {/* Ações da solicitação */}
          {!isReviewed && (
            <div className="flex items-center gap-2 pt-1">
              <button onClick={onEditList}
                className="flex items-center gap-1.5 rounded-lg border border-[#e7e5df] px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                <Edit2 className="h-3 w-3" /> Editar lista
              </button>
              {(req.status === 'complete' || doneCount === totalCount) && totalCount > 0 && (
                <button onClick={onMarkReviewed} disabled={!!reviewLoading}
                  className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors disabled:opacity-60">
                  {reviewLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderCheck className="h-3 w-3" />}
                  Concluído
                </button>
              )}
              <button onClick={onCancel} disabled={!!cancelLoading}
                className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-rose-400 hover:bg-rose-50 transition-colors disabled:opacity-60">
                {cancelLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                Cancelar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Painel principal ───────────────────────────────────────────────────────

interface Props { open: boolean; onClose: () => void; onBadgeCountChange: (count: number) => void; }

export const DocumentRequestsTracker: React.FC<Props> = ({ open, onClose, onBadgeCountChange }) => {
  const [requests, setRequests] = useState<TrackerRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [editingDeadline, setEditingDeadline] = useState<string | null>(null);
  const [deadlineDraft, setDeadlineDraft] = useState('');
  const [editListRequest, setEditListRequest] = useState<TrackerRequest | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('document_requests')
        .select(`
          id, title, description, due_date, status, created_at, client_id,
          clients(id, full_name),
          document_request_items(
            id, label, required, sort_order, status,
            document_uploads(
              id, processing_status, review_status, rejection_reason,
              final_name, ai_document_type, pages_count, processed_path
            )
          )
        `)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false });

      if (data) {
        const formatted: TrackerRequest[] = data.map((r: any) => ({
          id: r.id, title: r.title, description: r.description,
          due_date: r.due_date, status: r.status, created_at: r.created_at,
          client_id: r.client_id,
          client_name: r.clients?.full_name || 'Cliente',
          items: (r.document_request_items || [])
            .sort((a: any, b: any) => a.sort_order - b.sort_order)
            .map((item: any) => ({
              ...item,
              upload: item.document_uploads?.[0] || null,
            })),
        }));
        setRequests(formatted);
        const count = formatted.filter(r => ['pending', 'partial', 'complete'].includes(r.status)).length;
        onBadgeCountChange(count);
      }
    } finally { setLoading(false); }
  }, [onBadgeCountChange]);

  useEffect(() => { if (open) load(); }, [open, load]);

  useEffect(() => {
    supabase.from('document_requests').select('id', { count: 'exact', head: true })
      .in('status', ['pending', 'partial', 'complete'])
      .then(({ count }) => onBadgeCountChange(count || 0));
  }, [onBadgeCountChange]);

  const toggle = (id: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const handleCancel = async (reqId: string) => {
    setActionLoading(reqId + '-cancel');
    await supabase.from('document_requests').update({ status: 'cancelled' }).eq('id', reqId);
    await load(); setActionLoading(null);
  };

  const handleMarkReviewed = async (reqId: string) => {
    setActionLoading(reqId + '-review');
    await supabase.from('document_requests').update({ status: 'reviewed' }).eq('id', reqId);
    await load(); setActionLoading(null);
  };

  const handleSaveDeadline = async (reqId: string) => {
    setActionLoading(reqId + '-deadline');
    await supabase.from('document_requests').update({ due_date: deadlineDraft || null }).eq('id', reqId);
    setEditingDeadline(null);
    await load(); setActionLoading(null);
  };

  const handleItemCheck = async (item: TrackerItem, reqId: string) => {
    const newStatus = item.status === 'approved' ? 'pending' : 'approved';
    setActionLoading(item.id + '-item');
    await supabase.from('document_request_items').update({ status: newStatus }).eq('id', item.id);
    const req = requests.find(r => r.id === reqId);
    if (req) {
      const allItems = req.items.map(i => i.id === item.id ? { ...i, status: newStatus } : i);
      const approved = allItems.filter(i => i.status === 'approved').length;
      const newReqStatus = approved === allItems.length ? 'complete' : approved > 0 ? 'partial' : 'pending';
      await supabase.from('document_requests').update({ status: newReqStatus }).eq('id', reqId);
    }
    await load(); setActionLoading(null);
  };

  // Atualiza o nome do upload localmente (otimista) após renomear
  const handleUploadRename = (uploadId: string, newName: string) => {
    setRequests(prev => prev.map(r => ({
      ...r,
      items: r.items.map(it =>
        it.upload?.id === uploadId ? { ...it, upload: { ...it.upload!, final_name: newName } } : it
      ),
    })));
  };

  const activeRequests = requests.filter(r => ['pending', 'partial', 'complete'].includes(r.status));
  const reviewedRequests = requests.filter(r => r.status === 'reviewed');

  if (!open) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[150] bg-slate-900/30 backdrop-blur-[2px]" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-[151] flex flex-col w-full max-w-sm bg-white shadow-2xl border-l border-[#e7e5df]"
        style={{ animation: 'slideInRight 0.22s cubic-bezier(0.4,0,0.2,1)' }}>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-orange-100 flex items-center justify-center">
              <FolderOpen className="h-4 w-4 text-orange-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">Sol. de Documentos</p>
              <p className="text-[10px] text-slate-400">{activeRequests.length} ativa{activeRequests.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => load()} disabled={loading}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Botão nova solicitação */}
        <div className="px-4 py-3 border-b border-slate-100 flex-shrink-0">
          <button onClick={() => setShowCreate(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 hover:bg-orange-600 active:scale-[0.98] px-4 py-2.5 text-sm font-bold text-white transition-all shadow-sm shadow-orange-200">
            <Plus className="h-4 w-4" /> Nova solicitação
          </button>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : requests.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center px-6">
              <FolderCheck className="h-10 w-10 text-slate-200 mb-3" />
              <p className="text-sm font-semibold text-slate-400">Nenhuma solicitação ainda</p>
              <p className="text-xs text-slate-300 mt-1">Clique em "Nova solicitação" para começar</p>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {activeRequests.length > 0 && (
                <>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">Ativas · {activeRequests.length}</p>
                  {activeRequests.map(req => (
                    <RequestCard key={req.id} req={req}
                      expanded={expanded.has(req.id)} onToggle={() => toggle(req.id)}
                      actionLoading={actionLoading} editingDeadline={editingDeadline} deadlineDraft={deadlineDraft}
                      onDeadlineDraftChange={setDeadlineDraft}
                      onStartEditDeadline={() => { setEditingDeadline(req.id); setDeadlineDraft(req.due_date || ''); }}
                      onCancelDeadlineEdit={() => setEditingDeadline(null)}
                      onSaveDeadline={() => handleSaveDeadline(req.id)}
                      onCancel={() => handleCancel(req.id)}
                      onMarkReviewed={() => handleMarkReviewed(req.id)}
                      onEditList={() => setEditListRequest(req)}
                      onItemCheck={item => handleItemCheck(item, req.id)}
                      onUploadRename={handleUploadRename}
                    />
                  ))}
                </>
              )}
              {reviewedRequests.length > 0 && (
                <>
                  <div className="pt-1">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-300 px-1">Revisadas · {reviewedRequests.length}</p>
                  </div>
                  {reviewedRequests.map(req => (
                    <RequestCard key={req.id} req={req}
                      expanded={expanded.has(req.id)} onToggle={() => toggle(req.id)}
                      actionLoading={actionLoading} editingDeadline={editingDeadline} deadlineDraft={deadlineDraft}
                      onDeadlineDraftChange={setDeadlineDraft}
                      onStartEditDeadline={() => { setEditingDeadline(req.id); setDeadlineDraft(req.due_date || ''); }}
                      onCancelDeadlineEdit={() => setEditingDeadline(null)}
                      onSaveDeadline={() => handleSaveDeadline(req.id)}
                      onCancel={() => handleCancel(req.id)}
                      onMarkReviewed={() => handleMarkReviewed(req.id)}
                      onEditList={() => setEditListRequest(req)}
                      onItemCheck={item => handleItemCheck(item, req.id)}
                      onUploadRename={handleUploadRename}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {showCreate && <CreateRequestModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
      {editListRequest && <EditListModal request={editListRequest} onClose={() => setEditListRequest(null)} onSaved={() => { setEditListRequest(null); load(); }} />}

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0.6; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </>,
    document.body
  );
};

export default DocumentRequestsTracker;
