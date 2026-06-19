// Modais de seleção/abertura por cliente: vincular um cliente à conversa e
// iniciar uma nova conversa (busca por nome/CPF/telefone). Extraídos de
// WhatsAppModule.tsx — autocontidos.
import React, { useEffect, useState } from 'react';
import { Link2, AlertCircle, Search, Loader2, Phone, Plus } from 'lucide-react';
import { WaDialog, WaDialogBody, waInput, waLabel } from './ui';
import { prettyPhone, prettyDoc, initials } from './format';
import { whatsappService, normalizePhone } from '../../services/whatsapp.service';
import { useToastContext } from '../../contexts/ToastContext';
import type { WhatsAppClientLite, WhatsAppChannel } from '../../types/whatsapp.types';

// ── Vincular cliente à conversa (com alerta anti-duplicado de telefone) ──
export const ClientPickerModal: React.FC<{
  phone: string;
  onClose: () => void;
  onPick: (c: WhatsAppClientLite) => void;
}> = ({ phone, onClose, onPick }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WhatsAppClientLite[]>([]);
  const [loading, setLoading] = useState(false);
  // Fase F: alerta de duplicado — cliente com o mesmo telefone na base
  const [phoneOwners, setPhoneOwners] = useState<WhatsAppClientLite[]>([]);
  const [confirm, setConfirm] = useState<WhatsAppClientLite | null>(null);

  // Carrega candidatos por telefone uma única vez (anti-duplicado).
  useEffect(() => {
    whatsappService.matchClientsByPhone(phone).then(setPhoneOwners).catch(() => {});
  }, [phone]);

  // Abre já sugerindo por telefone; depois busca pelo que for digitado (debounce).
  useEffect(() => {
    let alive = true;
    const q = query.trim();
    setLoading(true);
    const run = q.length >= 2
      ? whatsappService.searchClients(q)
      : whatsappService.matchClientsByPhone(phone);
    const t = setTimeout(() => {
      run.then(list => { if (alive) setResults(list); })
        .catch(() => { if (alive) setResults([]); })
        .finally(() => { if (alive) setLoading(false); });
    }, q ? 280 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [query, phone]);

  const normPhone = normalizePhone(phone);
  const phoneMatchIds = new Set(phoneOwners.map(o => o.id));

  // Verifica se o cliente escolhido tem telefone diferente e o telefone pertence a outro cliente.
  const handlePick = (c: WhatsAppClientLite) => {
    const clientPhones = [c.mobile, c.phone].map(p => p ? normalizePhone(p) : null).filter(Boolean);
    const phoneIsAlreadyOwned = phoneOwners.length > 0 && !phoneMatchIds.has(c.id);
    if (phoneIsAlreadyOwned && !clientPhones.includes(normPhone)) {
      setConfirm(c); // pede confirmação antes de vincular
    } else {
      onPick(c);
    }
  };

  return (
    <WaDialog title="Vincular cliente" icon={<Link2 size={18} />} onClose={onClose} size="sm">
      <WaDialogBody>
        {/* Alerta de duplicado (Fase F) */}
        {confirm ? (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-4">
            <p className="text-[13px] font-bold text-amber-800 mb-1 flex items-center gap-1.5">
              <AlertCircle size={15} /> Telefone pertence a outro cliente
            </p>
            <p className="text-[12px] text-amber-700 mb-3">
              O número <strong>{prettyPhone(phone)}</strong> já está cadastrado em{' '}
              <strong>{phoneOwners.map(o => o.full_name).join(', ')}</strong>.
              Deseja mesmo vincular a conversa a <strong>{confirm.full_name}</strong>?
            </p>
            <div className="flex gap-2">
              <button onClick={() => { onPick(confirm); setConfirm(null); }}
                className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-[12px] font-semibold hover:bg-amber-700">
                Vincular mesmo assim
              </button>
              <button onClick={() => setConfirm(null)}
                className="px-3 py-1.5 rounded-lg bg-white border border-amber-200 text-[12px] font-semibold text-amber-700 hover:bg-amber-50">
                Cancelar
              </button>
            </div>
          </div>
        ) : (<>
          <div className="relative mb-3">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Nome, CPF/CNPJ ou telefone…"
              className={`${waInput} pl-9`} />
          </div>
          <div className="max-h-[320px] overflow-y-auto -mx-1">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-slate-400"><Loader2 size={18} className="animate-spin" /></div>
            ) : results.length === 0 ? (
              <p className="text-center py-8 text-[13px] text-slate-400">{query.trim().length >= 2 ? 'Nenhum cliente encontrado.' : 'Digite para buscar um cliente.'}</p>
            ) : results.map(c => {
              const isPhoneMatch = phoneMatchIds.has(c.id);
              return (
                <button key={c.id} onClick={() => handlePick(c)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-[#00a884]/10 transition">
                  <span className="w-9 h-9 rounded-full bg-[#00a884]/15 text-[#017561] flex items-center justify-center text-[12px] font-bold flex-shrink-0">
                    {initials(c.full_name, '')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-slate-800 truncate">{c.full_name}</p>
                    <p className="text-[11.5px] text-slate-400 truncate">
                      {[prettyDoc(c.cpf_cnpj), c.mobile || c.phone].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                  {/* Fase F: indica qual candidato tem o telefone desta conversa cadastrado */}
                  {isPhoneMatch && (
                    <span className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-semibold bg-emerald-100 text-emerald-700">
                      <Phone size={9} /> telefone cadastrado
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>)}
      </WaDialogBody>
    </WaDialog>
  );
};

// ── Modal: Nova conversa (Fase 0) ──
// Campo único: busca cliente por nome/CPF/telefone e, se nada casar, permite
// usar o telefone digitado. Reabre conversa existente do mesmo número/canal.
export const NewConversationModal: React.FC<{
  channels: WhatsAppChannel[];
  onClose: () => void;
  onOpened: (conversationId: string) => void;
}> = ({ channels, onClose, onOpened }) => {
  const toast = useToastContext();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WhatsAppClientLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [channelId, setChannelId] = useState(channels[0]?.id || '');
  const [picked, setPicked] = useState<WhatsAppClientLite | null>(null); // cliente c/ +1 telefone
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const q = query.trim();
    if (q.length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const t = setTimeout(() => {
      whatsappService.searchClients(q)
        .then(list => { if (alive) setResults(list); })
        .catch(() => { if (alive) setResults([]); })
        .finally(() => { if (alive) setLoading(false); });
    }, 280);
    return () => { alive = false; clearTimeout(t); };
  }, [query]);

  const digits = query.replace(/\D/g, '');
  const typedPhone = digits.length >= 10 ? normalizePhone(query) : '';

  const open = async (phone: string, client: WhatsAppClientLite | null) => {
    if (!channelId) { toast.warning('Selecione um canal conectado'); return; }
    setBusy(true);
    try {
      const { conversation_id } = await whatsappService.openConversation({
        phone, channelId, clientId: client?.id ?? null, contactName: client?.full_name ?? null,
      });
      onOpened(conversation_id);
    } catch (e: any) {
      toast.error('Falha ao abrir conversa', e.message);
    } finally { setBusy(false); }
  };

  // Telefones únicos do cliente (móvel primeiro), já normalizados.
  const phonesOf = (c: WhatsAppClientLite): string[] => {
    const raw = [c.mobile, c.phone].filter((p): p is string => !!p);
    const norm = raw.map(normalizePhone).filter(Boolean);
    return Array.from(new Set(norm));
  };

  const onPickClient = (c: WhatsAppClientLite) => {
    const phones = phonesOf(c);
    if (phones.length === 0) { toast.warning('Cliente sem telefone cadastrado', 'Digite um número para conversar.'); return; }
    if (phones.length === 1) { void open(phones[0], c); return; }
    setPicked(c); // escolher qual número
  };

  return (
    <WaDialog title="Nova conversa" icon={<Plus size={18} />} onClose={onClose} size="sm">
      <WaDialogBody>
        {channels.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#e0ded8] p-5 text-center text-[12.5px] text-slate-500">
            Nenhum canal conectado. Conecte um número do WhatsApp para iniciar conversas.
          </div>
        ) : picked ? (
          // Passo de escolha de número (cliente com vários telefones).
          <div>
            <button onClick={() => setPicked(null)} className="text-[12px] font-semibold text-[#017561] hover:underline mb-2">← Voltar</button>
            <p className="text-[13px] text-slate-600 mb-2">Qual número de <strong>{picked.full_name}</strong> usar?</p>
            <div className="space-y-1.5">
              {phonesOf(picked).map(ph => (
                <button key={ph} onClick={() => open(ph, picked)} disabled={busy}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left border border-[#e7e5df] hover:bg-[#00a884]/10 hover:border-[#00a884] transition disabled:opacity-50">
                  <Phone size={14} className="text-slate-400" />
                  <span className="text-[13px] font-semibold text-slate-700">{prettyPhone(ph)}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {channels.length > 1 && (
              <>
                <label className={waLabel}>Canal</label>
                <select value={channelId} onChange={e => setChannelId(e.target.value)} className={`${waInput} mb-3`}>
                  {channels.map(c => <option key={c.id} value={c.id}>{c.name || c.instance_name}</option>)}
                </select>
              </>
            )}

            <div className="relative mb-3">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Nome, CPF/CNPJ ou telefone…"
                className={`${waInput} pl-9`} />
            </div>

            <div className="max-h-[320px] overflow-y-auto -mx-1">
              {/* Telefone digitado sem cliente: oferta direta. */}
              {typedPhone && (
                <button onClick={() => open(typedPhone, null)} disabled={busy}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-[#00a884]/10 transition disabled:opacity-50 border border-dashed border-[#00a884] mb-1">
                  <span className="w-9 h-9 rounded-full bg-[#00a884]/15 text-[#017561] flex items-center justify-center flex-shrink-0"><Phone size={16} /></span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800">Conversar com este telefone</p>
                    <p className="text-[11.5px] text-slate-400">{prettyPhone(typedPhone)}</p>
                  </div>
                </button>
              )}

              {loading ? (
                <div className="flex items-center justify-center py-8 text-slate-400"><Loader2 size={18} className="animate-spin" /></div>
              ) : results.length === 0 ? (
                !typedPhone && <p className="text-center py-8 text-[13px] text-slate-400">{query.trim().length >= 2 ? 'Nenhum cliente encontrado.' : 'Busque um cliente ou digite um telefone.'}</p>
              ) : results.map(c => (
                <button key={c.id} onClick={() => onPickClient(c)} disabled={busy}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-[#00a884]/10 transition disabled:opacity-50">
                  <span className="w-9 h-9 rounded-full bg-[#00a884]/15 text-[#017561] flex items-center justify-center text-[12px] font-bold flex-shrink-0">
                    {initials(c.full_name, '')}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800 truncate">{c.full_name}</p>
                    <p className="text-[11.5px] text-slate-400 truncate">
                      {[prettyDoc(c.cpf_cnpj), c.mobile || c.phone].filter(Boolean).join(' · ') || 'sem telefone'}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </WaDialogBody>
    </WaDialog>
  );
};
