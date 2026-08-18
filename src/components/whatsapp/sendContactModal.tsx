// Enviar um contato da agenda do escritório como CARTÃO (vCard).
//
// O que faltava. Dá para receber um cartão de contato desde sempre, mas não
// havia como MANDAR um: quando o cliente pedia o telefone do perito, do
// despachante ou do outro advogado do caso, o atendente digitava o número no
// meio de uma frase. Do outro lado isso é um texto — a pessoa copia dígito por
// dígito para a agenda, e é ali que o número chega errado e a ligação vai parar
// em outro lugar. Um cartão de verdade se salva com um toque e já vem com botão
// de ligar e de abrir conversa.
//
// A agenda é a MESMA da "Nova conversa" (`whatsapp_contact_book`): a unidade da
// lista é o NÚMERO, não a pessoa — cliente com celular e fixo aparece duas
// vezes, e escolher já é escolher qual número vai no cartão. Ver `contactBook.ts`.
import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, Send, UserRound } from 'lucide-react';
import { WaDialog, WaDialogBody, waInput } from './ui';
import { filterContacts, type ContactEntry } from './contactBook';
import { prettyPhone } from './format';
import { ContactAvatar } from './contactAvatar';
import { whatsappService } from '../../services/whatsapp.service';

export const SendContactModal: React.FC<{
  /** Para onde o cartão vai — a conversa aberta. */
  conversationId: string;
  /** Nome de quem vai receber, só para o cabeçalho dizer para onde isto vai. */
  targetName: string;
  onClose: () => void;
  onSent: () => void;
  onError: (message: string) => void;
}> = ({ conversationId, targetName, onClose, onSent, onError }) => {
  const [agenda, setAgenda] = useState<ContactEntry[] | null>(null);
  const [query, setQuery] = useState('');
  const [enviando, setEnviando] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    whatsappService.listContactBook()
      .then(lista => { if (vivo) setAgenda(lista); })
      .catch(() => { if (vivo) setAgenda([]); });
    return () => { vivo = false; };
  }, []);

  // A peneira é local: a agenda inteira cabe na memória (poucas centenas de
  // linhas) e ir ao servidor a cada tecla é o que tornava o modal antigo lento.
  const filtrados = useMemo(
    () => (agenda ? filterContacts(agenda, query).slice(0, 60) : []),
    [agenda, query],
  );

  const enviar = async (entry: ContactEntry) => {
    setEnviando(entry.phone);
    try {
      await whatsappService.sendContact({
        conversationId,
        contacts: [{ name: entry.name, phone: entry.phone }],
      });
      onSent();
      onClose();
    } catch (e: any) {
      onError(e?.message || 'Não foi possível enviar o contato.');
    } finally {
      setEnviando(null);
    }
  };

  return (
    <WaDialog
      title="Enviar contato"
      subtitle={targetName ? `para ${targetName}` : undefined}
      icon={<UserRound size={18} />}
      onClose={onClose}
      size="sm"
    >
      <WaDialogBody>
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar por nome, documento ou número"
            className={`${waInput} pl-9`}
          />
        </div>

        <div className="mt-3 max-h-[46vh] overflow-y-auto rounded-xl border border-[#e7e5df]">
          {agenda === null ? (
            <p className="flex items-center justify-center gap-2 py-8 text-[13px] text-slate-400">
              <Loader2 size={14} className="animate-spin" /> Carregando a agenda…
            </p>
          ) : filtrados.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-slate-400">
              {query ? 'Ninguém com esse nome ou número.' : 'A agenda está vazia.'}
            </p>
          ) : filtrados.map(entry => (
            <button
              key={`${entry.clientId}:${entry.phone}`}
              type="button"
              disabled={!!enviando}
              onClick={() => { void enviar(entry); }}
              className="flex w-full items-center gap-2.5 border-b border-[#f0eeea] px-3 py-2 text-left transition last:border-b-0 hover:bg-amber-50 disabled:opacity-50"
            >
              {/* O mesmo rosto da agenda de "Nova conversa": é a MESMA lista,
                  e um contato com duas caras em duas telas do mesmo módulo é
                  o tipo de detalhe que faz duvidar se é a mesma pessoa. */}
              <ContactAvatar name={entry.name} url={entry.avatarUrl} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-slate-800">{entry.name}</span>
                <span className="block text-[11.5px] tabular-nums text-slate-400">
                  {prettyPhone(entry.phone)} · {entry.phoneKind === 'mobile' ? 'celular' : 'fixo'}
                </span>
              </span>
              {enviando === entry.phone
                ? <Loader2 size={15} className="flex-shrink-0 animate-spin text-amber-600" />
                : <Send size={15} className="flex-shrink-0 text-slate-300" />}
            </button>
          ))}
        </div>
      </WaDialogBody>
    </WaDialog>
  );
};

export default SendContactModal;
