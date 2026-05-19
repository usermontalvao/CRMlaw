import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield, Clock, CheckCheck, X, Loader2, RefreshCw,
  Infinity, CalendarDays, AlertCircle, Check, Timer,
} from 'lucide-react';
import { accessRequestService, type ModuleAccessRequest, type DurationType } from '../services/accessRequest.service';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../config/supabase';

const MODULE_LABELS: Record<string, string> = {
  leads: 'Leads', clientes: 'Clientes', documentos: 'Documentos',
  cloud: 'Cloud', assinaturas: 'Assinaturas Digitais', processos: 'Processos',
  requerimentos: 'Requerimentos', prazos: 'Prazos', intimacoes: 'Intimações',
  financeiro: 'Financeiro', agenda: 'Agenda', tarefas: 'Tarefas',
  chat: 'Mensagens', peticoes: 'Editor de Petições', configuracoes: 'Configurações',
};

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  pending:  { label: 'Pendente',  cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  approved: { label: 'Aprovado',  cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  denied:   { label: 'Negado',    cls: 'bg-red-100 text-red-600 border-red-200' },
};

type DurationUnit = 'permanent' | 'days' | 'hours';

interface ApproveModalState {
  request: ModuleAccessRequest;
  durationUnit: DurationUnit;
  durationDays: number;
  durationHours: number;
  adminNotes: string;
}

interface DenyModalState {
  request: ModuleAccessRequest;
  adminNotes: string;
}

function avatarUrl(name: string, photo?: string | null) {
  if (photo) return photo;
  return `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}&backgroundColor=f59e0b&textColor=ffffff&fontSize=38&fontWeight=700`;
}

export const AccessRequestsAdmin: React.FC = () => {
  const { user } = useAuth();
  const [requests, setRequests] = useState<ModuleAccessRequest[]>([]);
  const [avatarMap, setAvatarMap] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [approveModal, setApproveModal] = useState<ApproveModalState | null>(null);
  const [denyModal, setDenyModal] = useState<DenyModalState | null>(null);
  const [processing, setProcessing] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

  const loadAvatars = useCallback(async (reqs: ModuleAccessRequest[]) => {
    if (!reqs.length) return;
    const ids = [...new Set(reqs.map(r => r.requester_id))];
    const { data } = await supabase.from('profiles').select('user_id, avatar_url').in('user_id', ids);
    if (data) {
      const map: Record<string, string | null> = {};
      data.forEach(p => { map[p.user_id] = p.avatar_url ?? null; });
      setAvatarMap(map);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = filter === 'pending'
        ? await accessRequestService.listPending()
        : await accessRequestService.listAll();
      console.log('[AccessRequestsAdmin] Solicitações carregadas:', data.length, data);
      setRequests(data);
      loadAvatars(data);
    } catch (e: any) {
      const msg = e?.message ?? 'Erro desconhecido ao carregar solicitações.';
      console.error('[AccessRequestsAdmin] Erro ao carregar:', msg, e);
      setLoadError(msg);
      showToast(msg, 'err');
    } finally {
      setLoading(false);
    }
  }, [filter, loadAvatars]);

  useEffect(() => { load(); }, [load]);

  const showToast = (msg: string, type: 'ok' | 'err') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const handleApprove = async () => {
    if (!approveModal || !user?.id) return;
    const { durationUnit, durationDays, durationHours } = approveModal;

    if (durationUnit === 'days' && (!durationDays || durationDays < 1)) {
      showToast('Informe a quantidade de dias.', 'err');
      return;
    }
    if (durationUnit === 'hours' && (!durationHours || durationHours < 1)) {
      showToast('Informe a quantidade de horas.', 'err');
      return;
    }

    setProcessing(true);
    try {
      const durationType: DurationType = durationUnit === 'permanent' ? 'permanent' : 'temporary';

      await accessRequestService.approve(approveModal.request.id, user.id, {
        durationType,
        durationDays: durationUnit === 'days' ? durationDays : undefined,
        durationHours: durationUnit === 'hours' ? durationHours : undefined,
        adminNotes: approveModal.adminNotes || undefined,
      });

      showToast('Acesso concedido com sucesso!', 'ok');
      setApproveModal(null);
      await load();
    } catch (e: any) {
      showToast(e?.message ?? 'Erro ao aprovar.', 'err');
    } finally {
      setProcessing(false);
    }
  };

  const handleDeny = async () => {
    if (!denyModal || !user?.id) return;
    setProcessing(true);
    try {
      await accessRequestService.deny(denyModal.request.id, user.id, denyModal.adminNotes || undefined);
      showToast('Solicitação negada.', 'ok');
      setDenyModal(null);
      await load();
    } catch (e: any) {
      showToast(e?.message ?? 'Erro ao negar.', 'err');
    } finally {
      setProcessing(false);
    }
  };

  const pending = requests.filter(r => r.status === 'pending');

  // Duration label for approved items
  const getDurationLabel = (req: ModuleAccessRequest) => {
    if (!req.expires_at) return null;
    const diffMs = new Date(req.expires_at).getTime() - new Date(req.created_at).getTime();
    const diffHours = diffMs / 3_600_000;
    if (diffHours < 24) return `${Math.round(diffHours)}h`;
    return `${Math.round(diffHours / 24)}d`;
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-bold text-slate-800">Solicitações de Acesso</h3>
          {pending.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-white">{pending.length}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-semibold">
            <button onClick={() => setFilter('pending')}
              className={`px-3 py-1.5 transition ${filter === 'pending' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
              Pendentes
            </button>
            <button onClick={() => setFilter('all')}
              className={`px-3 py-1.5 transition ${filter === 'all' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
              Todas
            </button>
          </div>
          <button onClick={load} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-slate-400 gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Carregando...</span>
        </div>
      ) : loadError ? (
        <div className="flex flex-col items-center justify-center py-10 border-2 border-dashed border-red-200 rounded-2xl bg-red-50 gap-3">
          <AlertCircle className="w-7 h-7 text-red-400" />
          <p className="text-sm font-semibold text-red-600">Erro ao carregar solicitações</p>
          <p className="text-xs text-red-400 max-w-xs text-center">{loadError}</p>
          <button onClick={load} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-100 hover:bg-red-200 text-red-700 text-xs font-semibold transition">
            <RefreshCw className="w-3 h-3" /> Tentar novamente
          </button>
        </div>
      ) : requests.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-2xl">
          <Shield className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-400 font-medium">Nenhuma solicitação {filter === 'pending' ? 'pendente' : 'encontrada'}</p>
          <button onClick={load} className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 text-xs font-semibold hover:bg-slate-50 transition">
            <RefreshCw className="w-3 h-3" /> Recarregar
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {requests.map(req => {
            const sc = STATUS_CFG[req.status];
            const isExpired = req.expires_at && new Date(req.expires_at) < new Date();
            const photo = avatarMap[req.requester_id];
            return (
              <div key={req.id} className="border border-slate-200 rounded-2xl overflow-hidden bg-white">
                <div className={`h-0.5 w-full ${req.status === 'pending' ? 'bg-amber-400' : req.status === 'approved' ? 'bg-emerald-400' : 'bg-red-400'}`} />

                <div className="px-5 py-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <img
                        src={avatarUrl(req.requester_name, photo)}
                        alt={req.requester_name}
                        className="w-9 h-9 rounded-xl object-cover flex-shrink-0 mt-0.5"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(req.requester_name)}&backgroundColor=f59e0b&textColor=ffffff&fontSize=38&fontWeight=700`;
                        }}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-slate-800">{req.requester_name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-medium">{req.requester_role}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${sc.cls}`}>{sc.label}</span>
                          {isExpired && <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-50 text-red-500 border border-red-200 font-bold">Expirado</span>}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Módulo: <span className="font-semibold text-slate-700">{req.module_label || MODULE_LABELS[req.module_key] || req.module_key}</span>
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">{new Date(req.created_at).toLocaleString('pt-BR')}</p>
                      </div>
                    </div>

                    {req.status === 'pending' && (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => setDenyModal({ request: req, adminNotes: '' })}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-semibold transition"
                        >
                          <X className="w-3 h-3" /> Negar
                        </button>
                        <button
                          onClick={() => setApproveModal({ request: req, durationUnit: 'permanent', durationDays: 30, durationHours: 4, adminNotes: '' })}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold transition shadow-sm"
                        >
                          <Check className="w-3 h-3" /> Aprovar
                        </button>
                      </div>
                    )}

                    {req.status === 'approved' && (() => {
                      if (!req.expires_at) return (
                        <div className="flex items-center gap-1.5 text-xs text-emerald-600 flex-shrink-0">
                          <Infinity className="w-3 h-3" />
                          <span className="font-semibold">Permanente</span>
                        </div>
                      );
                      const diffMs = new Date(req.expires_at).getTime() - new Date(req.resolved_at || req.created_at).getTime();
                      const diffH = diffMs / 3_600_000;
                      const label = diffH < 23 ? `${Math.round(diffH)}h` : `${Math.round(diffH / 24)} dias`;
                      const expired = new Date(req.expires_at) < new Date();
                      return (
                        <div className={`flex flex-col items-end gap-0.5 flex-shrink-0 ${expired ? 'text-red-400' : 'text-slate-400'}`}>
                          <div className="flex items-center gap-1 text-xs font-semibold">
                            <Clock className="w-3 h-3" />
                            <span>por {label}</span>
                          </div>
                          <span className="text-[10px]">
                            {expired ? 'Expirado' : 'expira'} {new Date(req.expires_at).toLocaleDateString('pt-BR')}
                          </span>
                        </div>
                      );
                    })()}
                  </div>

                  {req.justification && (
                    <div className="mt-3 px-3 py-2.5 bg-slate-50 rounded-xl border border-slate-100">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Justificativa</p>
                      <p className="text-xs text-slate-600 leading-relaxed">{req.justification}</p>
                    </div>
                  )}

                  {req.admin_notes && (
                    <div className="mt-2 px-3 py-2 bg-amber-50 rounded-xl border border-amber-100">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-amber-600 mb-1">Nota do Admin</p>
                      <p className="text-xs text-amber-800">{req.admin_notes}</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Modal Aprovar ────────────────────────────────────────────────── */}
      {approveModal && (() => {
        const req = approveModal.request;
        const photo = avatarMap[req.requester_id];
        const { durationUnit, durationDays, durationHours } = approveModal;

        const expiresAt = durationUnit === 'days'
          ? new Date(Date.now() + durationDays * 86_400_000)
          : durationUnit === 'hours'
          ? new Date(Date.now() + durationHours * 3_600_000)
          : null;

        return (
          <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4" onClick={() => !processing && setApproveModal(null)}>
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div
              className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200"
              onClick={e => e.stopPropagation()}
            >
              {/* Thin amber top bar */}
              <div className="h-1 w-full bg-gradient-to-r from-emerald-400 to-emerald-500" />

              {/* Header */}
              <div className="px-6 pt-5 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <img
                    src={avatarUrl(req.requester_name, photo)}
                    alt={req.requester_name}
                    className="w-10 h-10 rounded-xl object-cover flex-shrink-0"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(req.requester_name)}&backgroundColor=f59e0b&textColor=ffffff&fontSize=38&fontWeight=700`;
                    }}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <CheckCheck className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                      <p className="text-sm font-bold text-slate-800">Aprovar acesso</p>
                    </div>
                    <p className="text-xs text-slate-500 truncate mt-0.5">
                      {req.requester_name} · {req.module_label || MODULE_LABELS[req.module_key] || req.module_key}
                    </p>
                  </div>
                  <button
                    onClick={() => setApproveModal(null)}
                    className="ml-auto text-slate-300 hover:text-slate-500 transition"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="px-6 py-5 space-y-5">
                {/* Duração */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2.5">Duração do acesso</p>

                  {/* Pill selector */}
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { unit: 'permanent' as DurationUnit, label: 'Permanente', icon: <Infinity className="w-3.5 h-3.5" /> },
                        { unit: 'days' as DurationUnit, label: 'Por dias', icon: <CalendarDays className="w-3.5 h-3.5" /> },
                        { unit: 'hours' as DurationUnit, label: 'Por horas', icon: <Timer className="w-3.5 h-3.5" /> },
                      ] as const
                    ).map(opt => (
                      <button
                        key={opt.unit}
                        onClick={() => setApproveModal(m => m ? { ...m, durationUnit: opt.unit } : m)}
                        className={`flex flex-col items-center gap-1 px-3 py-2.5 rounded-xl border text-xs font-semibold transition ${
                          durationUnit === opt.unit
                            ? 'border-emerald-400 bg-emerald-50 text-emerald-700 shadow-sm'
                            : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        {opt.icon}
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {/* Days input */}
                  {durationUnit === 'days' && (
                    <div className="mt-3 flex items-center gap-3">
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={durationDays}
                        onChange={e => setApproveModal(m => m ? { ...m, durationDays: Number(e.target.value) } : m)}
                        className="w-20 border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono text-center focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                      />
                      <span className="text-sm text-slate-500">dias</span>
                      {expiresAt && (
                        <span className="text-xs text-slate-400">
                          expira em {expiresAt.toLocaleDateString('pt-BR')}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Hours input */}
                  {durationUnit === 'hours' && (
                    <div className="mt-3 flex items-center gap-3">
                      <input
                        type="number"
                        min={1}
                        max={72}
                        value={durationHours}
                        onChange={e => setApproveModal(m => m ? { ...m, durationHours: Number(e.target.value) } : m)}
                        className="w-20 border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono text-center focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                      />
                      <span className="text-sm text-slate-500">horas</span>
                      {expiresAt && (
                        <span className="text-xs text-slate-400">
                          expira em {expiresAt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                  )}

                  {durationUnit === 'permanent' && (
                    <p className="mt-2 text-xs text-slate-400">O acesso não expirará automaticamente.</p>
                  )}
                </div>

                {/* Notas */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                    Observação <span className="text-slate-300 font-normal normal-case tracking-normal">(opcional)</span>
                  </p>
                  <textarea
                    rows={2}
                    placeholder="Ex: Acesso liberado para o projeto X..."
                    value={approveModal.adminNotes}
                    onChange={e => setApproveModal(m => m ? { ...m, adminNotes: e.target.value } : m)}
                    className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm resize-none focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition placeholder:text-slate-300"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between px-6 pb-5 pt-1 gap-3">
                <button
                  onClick={() => setApproveModal(null)}
                  disabled={processing}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleApprove}
                  disabled={processing}
                  className="flex-[2] inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-semibold transition shadow-sm"
                >
                  {processing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
                  {processing ? 'Aprovando...' : 'Confirmar aprovação'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Modal Negar ──────────────────────────────────────────────────── */}
      {denyModal && (() => {
        const req = denyModal.request;
        const photo = avatarMap[req.requester_id];
        return (
          <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4" onClick={() => !processing && setDenyModal(null)}>
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div
              className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200"
              onClick={e => e.stopPropagation()}
            >
              <div className="h-1 w-full bg-gradient-to-r from-red-400 to-red-500" />

              <div className="px-6 pt-5 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <img
                    src={avatarUrl(req.requester_name, photo)}
                    alt={req.requester_name}
                    className="w-10 h-10 rounded-xl object-cover flex-shrink-0"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(req.requester_name)}&backgroundColor=f59e0b&textColor=ffffff&fontSize=38&fontWeight=700`;
                    }}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <X className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                      <p className="text-sm font-bold text-slate-800">Negar acesso</p>
                    </div>
                    <p className="text-xs text-slate-500 truncate mt-0.5">
                      {req.requester_name} · {req.module_label || MODULE_LABELS[req.module_key] || req.module_key}
                    </p>
                  </div>
                  <button onClick={() => setDenyModal(null)} className="ml-auto text-slate-300 hover:text-slate-500 transition">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="px-6 py-5 space-y-4">
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-xl">
                  <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                  <p className="text-xs text-red-700">O usuário receberá uma notificação informando a negativa.</p>
                </div>

                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                    Motivo <span className="text-slate-300 font-normal normal-case tracking-normal">(opcional)</span>
                  </p>
                  <textarea
                    rows={3}
                    placeholder="Ex: Acesso não autorizado para este cargo..."
                    value={denyModal.adminNotes}
                    onChange={e => setDenyModal(m => m ? { ...m, adminNotes: e.target.value } : m)}
                    className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm resize-none focus:outline-none focus:border-red-300 focus:ring-2 focus:ring-red-50 transition placeholder:text-slate-300"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between px-6 pb-5 pt-1 gap-3">
                <button
                  onClick={() => setDenyModal(null)}
                  disabled={processing}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleDeny}
                  disabled={processing}
                  className="flex-[2] inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-semibold transition shadow-sm"
                >
                  {processing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                  {processing ? 'Negando...' : 'Confirmar negativa'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[99999] flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg border text-sm font-medium ${
          toast.type === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {toast.type === 'ok' ? <CheckCheck className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}
    </div>
  );
};

export default AccessRequestsAdmin;
