import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Check, Eye, Loader2, LockKeyhole, Save, ShieldCheck, Users,
} from 'lucide-react';
import { whatsappService, type StaffOption } from '../../services/whatsapp.service';
import type {
  WhatsAppChannel, WhatsAppChannelVisibility,
} from '../../types/whatsapp.types';

export interface ChannelAccessMember {
  channel_id: string;
  user_id: string;
}

interface ChannelAccessDraft {
  mode: WhatsAppChannelVisibility;
  userIds: string[];
}

interface ChannelAccessManagerProps {
  channels: WhatsAppChannel[];
  staff: StaffOption[];
  requirePin?: (options: any) => Promise<boolean>;
  onFeedback?: (type: 'error' | 'success', message: string) => void;
  onChannelsChange?: (channels: WhatsAppChannel[]) => void;
  /** Usado pelo harness visual; no produto real os vínculos vêm do Supabase. */
  initialMemberships?: ChannelAccessMember[];
}

const normalizedRole = (role?: string | null) => (role || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

const isAdministrator = (member: StaffOption) => normalizedRole(member.role) === 'administrador';

const sameIds = (left: string[], right: string[]) => {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
};

const ChannelAccessManager: React.FC<ChannelAccessManagerProps> = ({
  channels,
  staff,
  requirePin,
  onFeedback,
  onChannelsChange,
  initialMemberships,
}) => {
  const [drafts, setDrafts] = useState<Record<string, ChannelAccessDraft>>({});
  const [savedDrafts, setSavedDrafts] = useState<Record<string, ChannelAccessDraft>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const orderedStaff = useMemo(() => [...staff].sort((a, b) => {
    if (isAdministrator(a) !== isAdministrator(b)) return isAdministrator(a) ? -1 : 1;
    return a.name.localeCompare(b.name, 'pt-BR');
  }), [staff]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const rows = initialMemberships ?? await whatsappService.listChannelMembers();
        if (cancelled) return;
        const next = Object.fromEntries(channels.map(channel => [
          channel.id,
          {
            mode: channel.visibility_mode || 'all',
            userIds: rows.filter(row => row.channel_id === channel.id).map(row => row.user_id),
          } satisfies ChannelAccessDraft,
        ]));
        setDrafts(next);
        setSavedDrafts(next);
      } catch (cause) {
        if (cancelled) return;
        const message = cause instanceof Error ? cause.message : 'Não foi possível carregar os acessos.';
        setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [channels, initialMemberships, reloadToken]);

  const updateDraft = (channelId: string, patch: Partial<ChannelAccessDraft>) => {
    setDrafts(previous => ({
      ...previous,
      [channelId]: { ...(previous[channelId] ?? { mode: 'all', userIds: [] }), ...patch },
    }));
  };

  const toggleMember = (channelId: string, userId: string) => {
    const current = drafts[channelId] ?? { mode: 'restricted' as const, userIds: [] };
    const selected = current.userIds.includes(userId);
    updateDraft(channelId, {
      userIds: selected ? current.userIds.filter(id => id !== userId) : [...current.userIds, userId],
    });
  };

  const saveChannel = async (channel: WhatsAppChannel) => {
    const draft = drafts[channel.id];
    if (!draft) return;
    const pinOk = requirePin ? await requirePin({
      action: 'update_whatsapp_channel_access',
      resourceType: 'whatsapp_channel',
      resourceId: channel.id,
      sensitivity: 'high',
      title: 'Alterar acesso ao canal',
      description: `Confirme com seu PIN quem pode ver o canal “${channel.name || channel.instance_name}”.`,
      actionLabel: 'Salvar acessos',
    }) : true;
    if (!pinOk) return;

    setSavingId(channel.id);
    setError(null);
    try {
      // Administradores sempre têm visão ampliada por policy e não precisam de
      // uma linha redundante na tabela de membros.
      const explicitUsers = draft.userIds.filter(userId => {
        const member = staff.find(item => item.user_id === userId);
        return member ? !isAdministrator(member) : true;
      });
      if (!initialMemberships) {
        await whatsappService.updateChannelAccess(channel.id, draft.mode, explicitUsers);
      }
      const persisted = { ...draft, userIds: explicitUsers };
      setSavedDrafts(previous => ({ ...previous, [channel.id]: persisted }));
      setDrafts(previous => ({ ...previous, [channel.id]: persisted }));
      onChannelsChange?.(channels.map(item => item.id === channel.id
        ? { ...item, visibility_mode: draft.mode }
        : item));
      onFeedback?.('success', `Acesso do canal “${channel.name || channel.instance_name}” atualizado.`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Não foi possível salvar os acessos.';
      setError(message);
      onFeedback?.('error', message);
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[220px] items-center justify-center gap-2 text-sm text-slate-500">
        <Loader2 size={18} className="animate-spin" /> Carregando acessos…
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="flex items-start gap-3">
          <ShieldCheck size={18} className="mt-0.5 shrink-0 text-amber-700" />
          <div>
            <p className="text-[13px] font-semibold text-amber-950">Uma regra para WhatsApp e Leads</p>
            <p className="mt-1 text-xs leading-relaxed text-amber-800">
              O acesso definido aqui controla os canais exibidos na inbox, ao iniciar uma conversa e no filtro do funil de Leads. Administradores sempre enxergam todos os canais.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          <AlertTriangle size={15} className="shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" onClick={() => setReloadToken(token => token + 1)} className="shrink-0 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 font-semibold hover:bg-red-100">
            Tentar novamente
          </button>
        </div>
      )}

      {channels.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">
          Nenhum canal de WhatsApp configurado.
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {channels.map(channel => {
            const draft = drafts[channel.id] ?? { mode: channel.visibility_mode || 'all', userIds: [] };
            const saved = savedDrafts[channel.id] ?? { mode: channel.visibility_mode || 'all', userIds: [] };
            const dirty = draft.mode !== saved.mode || !sameIds(draft.userIds, saved.userIds);
            const selectedCount = draft.userIds.filter(userId => {
              const member = staff.find(item => item.user_id === userId);
              return member ? !isAdministrator(member) : true;
            }).length;

            return (
              <section key={channel.id} data-channel-id={channel.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3.5">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: channel.color || '#ea6c00' }} />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold text-slate-900">{channel.name || channel.instance_name}</h3>
                    <p className="truncate text-[11px] text-slate-500">
                      {channel.phone_number || channel.instance_name}
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${channel.status === 'connected' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {channel.status === 'connected' ? 'Conectado' : 'Offline'}
                  </span>
                </div>

                <div className="space-y-4 p-4">
                  <div>
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Quem vê este canal</p>
                    <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
                      <button
                        type="button"
                        onClick={() => updateDraft(channel.id, { mode: 'all' })}
                        className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${draft.mode === 'all' ? 'bg-white text-amber-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        <Users size={14} /> Toda a equipe
                      </button>
                      <button
                        type="button"
                        onClick={() => updateDraft(channel.id, { mode: 'restricted' })}
                        className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${draft.mode === 'restricted' ? 'bg-white text-amber-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        <LockKeyhole size={14} /> Selecionar pessoas
                      </button>
                    </div>
                  </div>

                  {draft.mode === 'all' ? (
                    <div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800">
                      <Eye size={15} className="shrink-0" /> Todos os usuários ativos verão este canal no WhatsApp e em Leads.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {orderedStaff.map(member => {
                        const admin = isAdministrator(member);
                        const checked = admin || draft.userIds.includes(member.user_id);
                        return (
                          <label
                            key={member.user_id}
                            className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${admin ? 'cursor-default border-amber-100 bg-amber-50/60' : 'cursor-pointer border-slate-200 hover:border-amber-200 hover:bg-amber-50/30'}`}
                          >
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={checked}
                              disabled={admin}
                              onClick={() => { if (!admin) toggleMember(channel.id, member.user_id); }}
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${checked ? 'border-amber-600 bg-amber-600 text-white' : 'border-slate-300 bg-white text-transparent'} ${admin ? 'opacity-70' : ''}`}
                            >
                              <Check size={13} />
                            </button>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-semibold text-slate-800">{member.name}</span>
                              <span className="block truncate text-[10.5px] text-slate-500">{member.role || 'Colaborador'}</span>
                            </span>
                            {admin && <span className="text-[10px] font-semibold text-amber-700">Sempre vê</span>}
                          </label>
                        );
                      })}
                      {selectedCount === 0 && (
                        <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
                          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                          Nenhum colaborador selecionado. Apenas administradores e pessoas já responsáveis por uma conversa terão acesso.
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                    <p className="text-[11px] text-slate-500">
                      {draft.mode === 'all' ? 'Acesso amplo' : `${selectedCount} pessoa${selectedCount === 1 ? '' : 's'} selecionada${selectedCount === 1 ? '' : 's'}`}
                    </p>
                    <button
                      type="button"
                      onClick={() => void saveChannel(channel)}
                      disabled={!dirty || savingId === channel.id}
                      className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {savingId === channel.id ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      {savingId === channel.id ? 'Salvando…' : 'Salvar canal'}
                    </button>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ChannelAccessManager;
