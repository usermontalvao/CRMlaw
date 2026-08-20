// Encaminhar uma mensagem para outras conversas do WhatsApp — o que antes só
// dava para fazer copiando o texto na mão, e para mídia não dava de jeito
// nenhum (o arquivo teria que ser baixado e reenviado).
import React, { useMemo, useState } from 'react';
import { Forward, Search, Loader2, Check } from 'lucide-react';
import { WaDialog, WaDialogBody, waInput } from './ui';
import { Avatar } from './avatar';
import { prettyPhone, typeLabel } from './format';
import { waPlainText } from './waRichText';
import { fold } from './contactBook';
import type { WhatsAppConversation, WhatsAppMessage } from '../../types/whatsapp.types';

/** Quantos destinos por vez. O mesmo limite do WhatsApp, e um freio saudável:
 *  encaminhar em massa é disparo, não atendimento. */
const MAX_TARGETS = 5;

/** Resumo de uma linha da mensagem que está sendo encaminhada. */
export function forwardPreviewLabel(m: WhatsAppMessage): string {
  const text = m.content ? waPlainText(m.content) : '';
  if (m.type === 'text') return text || 'Mensagem';
  const kind = m.file_name || typeLabel(m.type);
  return text ? `${kind} · ${text}` : kind;
}

export const ForwardMessageModal: React.FC<{
  message: WhatsAppMessage;
  conversations: WhatsAppConversation[];
  /** Conversa de onde a mensagem saiu — não faz sentido encaminhar para ela mesma. */
  currentConversationId: string | null;
  sending: boolean;
  onClose: () => void;
  onConfirm: (targets: WhatsAppConversation[]) => void;
}> = ({ message, conversations, currentConversationId, sending, onClose, onConfirm }) => {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);

  const options = useMemo(() => {
    const q = fold(query).trim();
    return conversations
      .filter(c => c.id !== currentConversationId && !c.is_blocked)
      .filter(c => {
        if (!q) return true;
        const name = fold(c.client_name || c.contact_name || '');
        if (name.includes(q)) return true;
        // Só compara telefone quando a busca tem dígito: `includes('')` é sempre
        // verdadeiro e deixava passar a lista inteira em qualquer busca por nome.
        const digits = q.replace(/\D/g, '');
        return digits.length > 0 && (c.contact_phone || '').replace(/\D/g, '').includes(digits);
      })
      .slice(0, 80);
  }, [conversations, currentConversationId, query]);

  const toggle = (id: string) => {
    setPicked(prev => prev.includes(id)
      ? prev.filter(x => x !== id)
      : prev.length >= MAX_TARGETS ? prev : [...prev, id]);
  };

  const targets = conversations.filter(c => picked.includes(c.id));
  const full = picked.length >= MAX_TARGETS;

  return (
    <WaDialog
      title="Encaminhar mensagem"
      subtitle={forwardPreviewLabel(message)}
      icon={<Forward size={17} />}
      size="md"
      onClose={onClose}
      footer={
        <div className="flex items-center gap-3">
          <span className="text-[11.5px] text-slate-500">
            {picked.length === 0
              ? 'Escolha para quem enviar'
              : `${picked.length} de ${MAX_TARGETS} ${picked.length === 1 ? 'conversa' : 'conversas'}`}
          </span>
          <button type="button" onClick={onClose} disabled={sending}
            className="ml-auto rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50">
            Cancelar
          </button>
          <button type="button" onClick={() => onConfirm(targets)} disabled={sending || picked.length === 0}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Forward size={14} />}
            Encaminhar
          </button>
        </div>
      }
    >
      <WaDialogBody>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={e => setQuery(e.target.value)} autoFocus
            placeholder="Buscar por nome ou telefone" className={`${waInput} pl-8`} />
        </div>

        {full && (
          <p className="mt-2 text-[11px] text-amber-600">
            Limite de {MAX_TARGETS} conversas por encaminhamento.
          </p>
        )}

        <div className="mt-2 max-h-[46vh] space-y-0.5 overflow-y-auto">
          {options.length === 0 && (
            <p className="px-2 py-6 text-center text-[12.5px] text-slate-400">Nenhuma conversa encontrada.</p>
          )}
          {options.map(c => {
            const selected = picked.includes(c.id);
            const name = c.client_name || c.contact_name || prettyPhone(c.contact_phone);
            return (
              <button key={c.id} type="button" onClick={() => toggle(c.id)}
                disabled={!selected && full}
                aria-pressed={selected}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${
                  selected ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'hover:bg-slate-50'
                } disabled:cursor-not-allowed disabled:opacity-40`}>
                <Avatar url={c.contact_avatar_url ?? null} name={name} phone={c.contact_phone} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-slate-800">{name}</span>
                  <span className="block truncate text-[11.5px] text-slate-400">{prettyPhone(c.contact_phone)}</span>
                </span>
                <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border transition ${
                  selected ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 text-transparent'
                }`}>
                  <Check size={13} strokeWidth={3} />
                </span>
              </button>
            );
          })}
        </div>
      </WaDialogBody>
    </WaDialog>
  );
};
