// Modal de vínculo de cliente à conversa. Autocontido (extraído de
// WhatsAppModule.tsx).
//
// A "Nova conversa" morava aqui e saiu: virou painel deslizante com a agenda
// inteira, em `newConversationPanel.tsx`. O modal antigo abria vazio, dependia
// de duas letras digitadas para mostrar alguém e não dizia se o número tinha
// WhatsApp — ver o cabeçalho de lá.
import React, { useEffect, useState } from 'react';
import { Link2, AlertCircle, Search, Loader2, Phone } from 'lucide-react';
import { WaDialog, WaDialogBody, waInput } from './ui';
import { prettyPhone, prettyDoc, initials } from './format';
import { whatsappService, normalizePhone } from '../../services/whatsapp.service';
import type { WhatsAppClientLite } from '../../types/whatsapp.types';

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
