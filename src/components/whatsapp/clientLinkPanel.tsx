// Painel "Cliente" do aside: vincula/cria/troca o cliente da conversa e mostra
// histórico de atendimentos anteriores. Extraído do god-module `WhatsAppModule`.
import React, { useState, useEffect } from 'react';
import {
  Loader2, UserCheck, IdCard, Mail, Phone, MapPin, User as UserIcon,
  Pencil, Unlink, ChevronUp, ChevronDown, Link2, UserPlus,
} from 'lucide-react';
import { whatsappService, normalizePhone } from '../../services/whatsapp.service';
import { useToastContext } from '../../contexts/ToastContext';
import { prettyDoc, prettyPhone, formatTime, initials } from './format';
import { ClientPickerModal } from './clientPickerModals';
import type { WhatsAppConversation, WhatsAppClientLite } from '../../types/whatsapp.types';
import type { WaModal } from '../WaWorkspace';

export const ClientLinkPanel: React.FC<{
  conversation: WhatsAppConversation;
  onChanged: () => void;
  onOpenWorkspace: (modal: WaModal) => void;
  embedded?: boolean;
}> = ({ conversation, onChanged, onOpenWorkspace, embedded }) => {
  const toast = useToastContext();
  const [client, setClient] = useState<WhatsAppClientLite | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoChecking, setAutoChecking] = useState(false);
  const [candidates, setCandidates] = useState<WhatsAppClientLite[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Fase E: criação inline de contato
  const [createMode, setCreateMode] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  // Fase E: oferta de atualização de telefone após vincular
  const [phonePrompt, setPhonePrompt] = useState<{ clientId: string; name: string } | null>(null);
  const [addingPhone, setAddingPhone] = useState(false);
  // Fase F: histórico de conversas anteriores do cliente
  type PastConv = Pick<WhatsAppConversation, 'id' | 'contact_phone' | 'status' | 'last_message_at' | 'last_message_preview' | 'last_message_direction' | 'closed_at' | 'contact_reason'>;
  const [history, setHistory] = useState<PastConv[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setClient(null); setCandidates([]); setCreateMode(false);
    setHistory([]); setHistoryOpen(false);
    if (conversation.client_id) {
      setLoading(true);
      whatsappService.getClient(conversation.client_id)
        .then(c => { if (alive) setClient(c); })
        .finally(() => { if (alive) setLoading(false); });
      // Carrega histórico de conversas anteriores em paralelo (Fase F).
      whatsappService.listConversationsByClient(conversation.client_id, conversation.id)
        .then(h => { if (alive) setHistory(h); })
        .catch(() => {});
    } else {
      setPhonePrompt(null);
      // 1 match → vincula automático. Vários → lista para escolher (anti-ambiguidade).
      setAutoChecking(true);
      whatsappService.matchClientsByPhone(conversation.contact_phone)
        .then(list => {
          if (!alive) return;
          if (list.length === 1) return whatsappService.linkClient(conversation.id, list[0].id).then(onChanged);
          setCandidates(list);
        })
        .catch(() => {})
        .finally(() => { if (alive) setAutoChecking(false); });
    }
    return () => { alive = false; };
  }, [conversation.id, conversation.client_id, conversation.contact_phone, onChanged]);

  // Vincula e, se o telefone da conversa não estiver no cadastro, oferece adicioná-lo.
  const link = async (clientId: string | null, picked?: WhatsAppClientLite) => {
    setBusy(true);
    try {
      await whatsappService.linkClient(conversation.id, clientId);
      onChanged();
      if (clientId && picked) {
        const myPhone = normalizePhone(conversation.contact_phone);
        const existing = [picked.mobile, picked.phone].map(p => (p ? normalizePhone(p) : null));
        if (myPhone && !existing.includes(myPhone)) {
          setPhonePrompt({ clientId, name: picked.full_name });
        } else {
          setPhonePrompt(null);
        }
      }
    } catch (e: any) { toast.error('Falha ao vincular', e.message); }
    finally { setBusy(false); setPickerOpen(false); }
  };

  // Cria contato básico inline e vincula imediatamente à conversa.
  const handleCreateContact = async () => {
    setCreating(true);
    try {
      const newClient = await whatsappService.createQuickContact({
        fullName: newName,
        phone: conversation.contact_phone,
      });
      await whatsappService.linkClient(conversation.id, newClient.id);
      setCreateMode(false);
      onChanged();
      toast.success('Contato criado e vinculado.');
    } catch (e: any) { toast.error('Falha ao criar contato', e.message); }
    finally { setCreating(false); }
  };

  // Adiciona o telefone da conversa ao campo correto do cadastro do cliente.
  const handleAddPhone = async () => {
    if (!phonePrompt) return;
    setAddingPhone(true);
    try {
      const { added, field } = await whatsappService.addPhoneToClient(phonePrompt.clientId, conversation.contact_phone);
      setPhonePrompt(null);
      if (added) toast.success(`Telefone adicionado ao campo ${field === 'mobile' ? 'Celular' : 'Telefone'} do cadastro.`);
    } catch (e: any) { toast.error('Falha ao atualizar telefone', e.message); }
    finally { setAddingPhone(false); }
  };

  // Conversa já vinculada a um cliente.
  if (conversation.client_id) {
    // Rótulo amigável de status/tipo do cliente.
    const clientStatusLabel = (c: WhatsAppClientLite) => {
      const typeMap: Record<string, string> = { pessoa_fisica: 'Pessoa física', pessoa_juridica: 'Pessoa jurídica' };
      const statusMap: Record<string, string> = { ativo: 'Ativo', inativo: 'Inativo', lead: 'Lead', ex_cliente: 'Ex-cliente' };
      const parts = [c.client_type ? typeMap[c.client_type] ?? c.client_type : null, c.status ? statusMap[c.status] ?? c.status : null].filter(Boolean);
      return parts.join(' · ');
    };
    return (
      <div className="mt-2 space-y-2">
        {!embedded && <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Cliente</p>}
        <div className="rounded-xl border border-[#e7e5df] p-3">
          {loading ? (
            <div className="flex items-center gap-2 text-slate-400 text-[12.5px]"><Loader2 size={14} className="animate-spin" /> Carregando…</div>
          ) : client ? (
            <>
              <div className="flex items-center gap-2">
                <span className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center flex-shrink-0"><UserCheck size={16} /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold text-slate-800 truncate">{client.full_name}</p>
                  {client.cpf_cnpj && <p className="text-[11.5px] text-slate-400 flex items-center gap-1"><IdCard size={12} /> {prettyDoc(client.cpf_cnpj)}</p>}
                </div>
              </div>

              {/* Fase P: informações de contato e localização expandidas */}
              <div className="mt-2.5 space-y-1">
                {(clientStatusLabel(client)) && (
                  <p className="text-[11px] text-slate-400 font-medium">{clientStatusLabel(client)}</p>
                )}
                {client.email && (
                  <a href={`mailto:${client.email}`} className="flex items-center gap-1.5 text-[12px] text-amber-700 hover:underline truncate">
                    <Mail size={11} className="flex-shrink-0" />
                    <span className="truncate">{client.email}</span>
                  </a>
                )}
                {client.mobile && normalizePhone(client.mobile) !== normalizePhone(conversation.contact_phone) && (
                  <p className="flex items-center gap-1.5 text-[12px] text-slate-500">
                    <Phone size={11} className="flex-shrink-0" />
                    <span>{prettyPhone(client.mobile)}</span>
                    <span className="text-[10px] text-slate-400">celular</span>
                  </p>
                )}
                {client.phone && normalizePhone(client.phone) !== normalizePhone(conversation.contact_phone) && (
                  <p className="flex items-center gap-1.5 text-[12px] text-slate-500">
                    <Phone size={11} className="flex-shrink-0" />
                    <span>{prettyPhone(client.phone)}</span>
                    <span className="text-[10px] text-slate-400">fixo</span>
                  </p>
                )}
                {(client.address_city || client.address_state) && (
                  <p className="flex items-center gap-1.5 text-[12px] text-slate-400">
                    <MapPin size={11} className="flex-shrink-0" />
                    {[client.address_city, client.address_state].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-[#f1f0ec] flex-wrap">
                <button onClick={() => onOpenWorkspace({ type: 'client_view', clientId: client.id })}
                  className="inline-flex items-center gap-1 text-[12px] font-semibold text-slate-500 hover:text-amber-700">
                  <UserIcon size={11} /> Ver
                </button>
                <button onClick={() => onOpenWorkspace({ type: 'client_edit', clientId: client.id })}
                  className="inline-flex items-center gap-1 text-[12px] font-semibold text-slate-500 hover:text-amber-700">
                  <Pencil size={11} /> Editar
                </button>
                <span className="text-slate-200">|</span>
                <button onClick={() => setPickerOpen(true)} disabled={busy} className="text-[12px] font-semibold text-amber-700 hover:underline disabled:opacity-50">Trocar</button>
                <button onClick={() => link(null)} disabled={busy} className="inline-flex items-center gap-1 text-[12px] font-semibold text-slate-400 hover:text-red-500 disabled:opacity-50"><Unlink size={12} /> Desvincular</button>
              </div>
              {/* Fase F: histórico de conversas anteriores */}
              {history.length > 0 && (
                <div className="mt-3 border-t border-[#f1f0ec] pt-3">
                  <button onClick={() => setHistoryOpen(o => !o)}
                    className="flex items-center gap-1 text-[11.5px] font-semibold text-slate-500 hover:text-slate-700 w-full">
                    {historyOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    {history.length} conversa{history.length > 1 ? 's' : ''} anterior{history.length > 1 ? 'es' : ''}
                  </button>
                  {historyOpen && (
                    <div className="mt-2 space-y-1.5">
                      {history.map(h => (
                        <div key={h.id} className="rounded-lg bg-[#f9f8f6] px-3 py-2 text-[11.5px]">
                          <div className="flex items-center justify-between gap-1 mb-0.5">
                            <span className={`px-1.5 py-px rounded text-[9.5px] font-semibold ${h.status === 'closed' ? 'bg-slate-100 text-slate-500' : 'bg-emerald-100 text-emerald-700'}`}>
                              {h.status === 'closed' ? 'Encerrada' : h.status === 'open' ? 'Aberta' : 'Pendente'}
                            </span>
                            <span className="text-slate-400 text-[10px]">{h.last_message_at ? formatTime(h.last_message_at) : '—'}</span>
                          </div>
                          {h.contact_reason && <p className="text-[11px] font-medium text-amber-700 truncate">{h.contact_reason}</p>}
                          <p className="text-slate-500 truncate">{h.last_message_preview || '—'}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="text-[12.5px] text-slate-400">Cliente não encontrado.</p>
          )}
        </div>
        {/* Fase E: banner de oferta de atualização de telefone */}
        {phonePrompt && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-[12px] font-semibold text-amber-800 mb-0.5">Adicionar número ao cadastro?</p>
            <p className="text-[11.5px] text-amber-700 mb-2">{prettyPhone(conversation.contact_phone)} não estava em {phonePrompt.name}.</p>
            <div className="flex items-center gap-2">
              <button onClick={handleAddPhone} disabled={addingPhone}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-600 text-white text-[11.5px] font-semibold hover:bg-amber-700 disabled:opacity-50">
                {addingPhone ? <Loader2 size={11} className="animate-spin" /> : <Phone size={11} />} Adicionar
              </button>
              <button onClick={() => setPhonePrompt(null)} className="text-[11.5px] font-semibold text-slate-500 hover:text-slate-700">Ignorar</button>
            </div>
          </div>
        )}
        {pickerOpen && <ClientPickerModal phone={conversation.contact_phone} onClose={() => setPickerOpen(false)} onPick={c => link(c.id, c)} />}
      </div>
    );
  }

  // Sem cliente: enquanto verifica o telefone, spinner; senão, busca manual ou criação inline.
  return (
    <div className="mt-2 space-y-2">
      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Cliente</p>
      {autoChecking ? (
        <div className="rounded-xl border border-[#e7e5df] p-4 flex items-center gap-2 text-slate-400 text-[12.5px]">
          <Loader2 size={14} className="animate-spin" /> Procurando cliente pelo telefone…
        </div>
      ) : candidates.length > 1 ? (
        <div className="rounded-xl border border-[#e7e5df] overflow-hidden">
          <p className="px-3 py-2 text-[11.5px] text-slate-500 bg-[#faf9f7] border-b border-[#f1f0ec]">
            <span className="font-semibold text-slate-700">{candidates.length} cadastros</span> com este telefone — escolha qual vincular
          </p>
          <div className="divide-y divide-[#f1f0ec]">
            {candidates.map(c => (
              <button key={c.id} onClick={() => link(c.id, c)} disabled={busy}
                className="group w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-amber-50 transition disabled:opacity-50">
                <span className="w-8 h-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-[11px] font-bold flex-shrink-0">{initials(c.full_name, '')}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-slate-800 truncate">{c.full_name}</span>
                  <span className="block text-[11px] text-slate-400">{c.cpf_cnpj ? prettyDoc(c.cpf_cnpj) : 'sem CPF/CNPJ'}</span>
                </span>
                <Link2 size={14} className="text-slate-300 group-hover:text-amber-600 flex-shrink-0 transition" />
              </button>
            ))}
          </div>
          <button onClick={() => setPickerOpen(true)}
            className="w-full px-3 py-2 text-[12px] font-semibold text-amber-700 hover:bg-amber-50 border-t border-[#f1f0ec] transition">
            Buscar outro cliente
          </button>
        </div>
      ) : createMode ? (
        // Fase E: mini-formulário de criação inline
        <div className="rounded-xl border border-[#e7e5df] p-4 space-y-3">
          <p className="text-[12px] font-semibold text-slate-700">Novo contato</p>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nome completo" autoFocus
            className="w-full px-3 py-2 text-[13px] rounded-lg bg-[#f3f2ef] border border-transparent focus:bg-white focus:border-amber-300 outline-none" />
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#f3f2ef] text-[12.5px] text-slate-500">
            <Phone size={13} className="flex-shrink-0" /> {prettyPhone(conversation.contact_phone)}
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setCreateMode(false)} className="px-3 py-1.5 text-[12px] font-semibold text-slate-500 hover:text-slate-700">Cancelar</button>
            <button onClick={handleCreateContact} disabled={creating || !newName.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-[12px] font-semibold hover:bg-amber-700 disabled:opacity-50">
              {creating ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />} Criar e vincular
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[#e0ded8] p-4 text-center">
          <UserIcon size={22} className="mx-auto text-slate-300 mb-2" />
          <p className="text-[12.5px] font-semibold text-slate-600">Sem cliente associado</p>
          <p className="text-[11.5px] text-slate-400 mt-1">Nenhum cadastro com este telefone. Vincule manualmente para ver processos, prazos e documentos aqui.</p>
          <div className="flex items-center justify-center gap-2 mt-3">
            <button onClick={() => setPickerOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f3f2ef] hover:bg-amber-50 text-slate-600 hover:text-amber-700 text-[12px] font-semibold transition">
              <Link2 size={13} /> Buscar cliente
            </button>
            <button onClick={() => { setNewName(conversation.contact_name || ''); setCreateMode(true); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f3f2ef] hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 text-[12px] font-semibold transition">
              <UserPlus size={13} /> Criar contato
            </button>
          </div>
        </div>
      )}
      {pickerOpen && <ClientPickerModal phone={conversation.contact_phone} onClose={() => setPickerOpen(false)} onPick={c => link(c.id, c)} />}
    </div>
  );
};
