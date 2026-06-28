// Dashboard de atendimento (Fase M): volume, SLA, produtividade, por agente.
import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart2, TrendingUp, Loader2, AlertTriangle, Inbox, Users,
  CheckCircle, Clock3, MessageCircle,
} from 'lucide-react';
import { WaDialog } from './ui';

interface DashboardStats {
  by_status: Record<string, number> | null;
  by_agent: { agent_name: string; total: number; waiting_reply: number }[] | null;
  sla_breached: number;
  sla_warning: number;
  unassigned: number;
  opened_today: number;
  closed_today: number;
  messages_sent_today: number;
  avg_first_response_min: number | null;
}

export const AttendanceDashboard: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { supabase } = await import('../../config/supabase');
      const { data, error: rpcError } = await supabase.rpc('whatsapp_dashboard_stats');
      if (rpcError) throw new Error(rpcError.message);
      setStats(data as DashboardStats);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar métricas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const totalOpen = stats ? Object.entries(stats.by_status ?? {}).reduce((s, [, v]) => s + v, 0) : 0;

  const StatCard: React.FC<{
    icon: React.ReactNode; label: string; value: string | number;
    sub?: string; tone?: 'default' | 'danger' | 'warning' | 'success';
  }> = ({ icon, label, value, sub, tone = 'default' }) => {
    const toneMap = {
      default: 'bg-[#f9f8f6] text-slate-600',
      danger: 'bg-red-50 text-red-600',
      warning: 'bg-amber-50 text-amber-700',
      success: 'bg-emerald-50 text-emerald-700',
    };
    return (
      <div className={`rounded-xl p-4 ${toneMap[tone]}`}>
        <div className="flex items-center gap-2 mb-1 text-[11px] font-semibold uppercase tracking-wide opacity-70">
          {icon} {label}
        </div>
        <div className="text-[28px] font-bold leading-none">{value}</div>
        {sub && <div className="text-[11px] mt-1 opacity-60">{sub}</div>}
      </div>
    );
  };

  return (
    <WaDialog
      title="Dashboard de atendimento"
      subtitle={`Atualizado às ${lastRefresh.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}
      icon={<BarChart2 size={18} />}
      onClose={onClose}
      size="lg"
      zIndex={60}
      headerActions={
        <button onClick={load} disabled={loading} title="Atualizar"
          className="shrink-0 rounded-full p-1.5 text-white/80 hover:bg-white/15 hover:text-white disabled:opacity-40 transition">
          <TrendingUp size={16} className={loading ? 'animate-pulse' : ''} />
        </button>
      }
    >
      <div className="p-5 space-y-5">
        {loading && !stats && (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 size={22} className="animate-spin mr-2" /> Carregando métricas…
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 rounded-lg p-3 text-[13px]">
              <AlertTriangle size={15} /> {error}
            </div>
          )}

          {stats && (
            <>
              {/* Linha 1: volume */}
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2.5">Volume</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatCard icon={<Inbox size={13} />} label="Abertas agora" value={totalOpen} />
                  <StatCard icon={<Users size={13} />} label="Sem responsável" value={stats.unassigned}
                    tone={stats.unassigned > 5 ? 'warning' : 'default'} />
                  <StatCard icon={<CheckCircle size={13} />} label="Encerradas hoje" value={stats.closed_today} tone="success" />
                  <StatCard icon={<TrendingUp size={13} />} label="Abertas hoje" value={stats.opened_today} />
                </div>
              </div>

              {/* Linha 2: SLA */}
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2.5">SLA de resposta</p>
                <div className="grid grid-cols-3 gap-3">
                  <StatCard icon={<AlertTriangle size={13} />} label="Estouradas (>4h)" value={stats.sla_breached}
                    tone={stats.sla_breached > 0 ? 'danger' : 'default'}
                    sub={stats.sla_breached > 0 ? 'Requer atenção imediata' : 'Tudo dentro do prazo'} />
                  <StatCard icon={<Clock3 size={13} />} label="Atenção (2-4h)" value={stats.sla_warning}
                    tone={stats.sla_warning > 0 ? 'warning' : 'default'} />
                  <StatCard icon={<Clock3 size={13} />} label="TMR médio (7d)" value={
                    stats.avg_first_response_min != null
                      ? stats.avg_first_response_min < 60
                        ? `${Math.round(stats.avg_first_response_min)}min`
                        : `${Math.floor(stats.avg_first_response_min / 60)}h${String(Math.floor(stats.avg_first_response_min % 60)).padStart(2, '0')}`
                      : '—'
                  } sub="Tempo médio de 1ª resposta" />
                </div>
              </div>

              {/* Linha 3: mensagens */}
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2.5">Produtividade</p>
                <div className="grid grid-cols-2 gap-3">
                  <StatCard icon={<MessageCircle size={13} />} label="Mensagens enviadas hoje" value={stats.messages_sent_today} />
                  <StatCard icon={<CheckCircle size={13} />} label="Taxa de encerramento"
                    value={stats.opened_today > 0 ? `${Math.round((stats.closed_today / (stats.opened_today || 1)) * 100)}%` : '—'}
                    sub={`${stats.closed_today} enc. / ${stats.opened_today} abert.`} />
                </div>
              </div>

              {/* Por agente */}
              {stats.by_agent && stats.by_agent.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2.5">Por agente (conversas abertas)</p>
                  <div className="rounded-xl border border-[#f1f0ec] overflow-hidden">
                    <table className="w-full text-[12.5px]">
                      <thead>
                        <tr className="bg-[#f9f8f6] text-slate-500 text-left">
                          <th className="px-3.5 py-2 font-semibold">Agente</th>
                          <th className="px-3.5 py-2 font-semibold text-right">Total</th>
                          <th className="px-3.5 py-2 font-semibold text-right">Aguardando resp.</th>
                          <th className="px-3.5 py-2 font-semibold text-right">Carga %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.by_agent.map((row, i) => {
                          const pct = totalOpen > 0 ? Math.round((row.total / totalOpen) * 100) : 0;
                          return (
                            <tr key={i} className="border-t border-[#f1f0ec] hover:bg-[#fafaf9]">
                              <td className="px-3.5 py-2 font-medium text-slate-700">{row.agent_name}</td>
                              <td className="px-3.5 py-2 text-right text-slate-600">{row.total}</td>
                              <td className="px-3.5 py-2 text-right">
                                <span className={row.waiting_reply > 0 ? 'text-amber-600 font-semibold' : 'text-slate-400'}>
                                  {row.waiting_reply}
                                </span>
                              </td>
                              <td className="px-3.5 py-2 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <div className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                    <div className="h-full rounded-full bg-amber-500" style={{ width: `${pct}%` }} />
                                  </div>
                                  <span className="text-slate-500 w-7 text-right">{pct}%</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Por status */}
              {stats.by_status && Object.keys(stats.by_status).length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2.5">Por status (abertas)</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(stats.by_status).map(([status, cnt]) => (
                      <span key={status} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-semibold bg-[#f3f2ef] text-slate-600">
                        {cnt} <span className="font-normal opacity-60">{status}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
      </div>
    </WaDialog>
  );
};
