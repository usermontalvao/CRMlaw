// Pré-cadastro: nome de exibição + telefone de quem está falando agora.
//
// Existe porque metade das conversas do dia é com gente que ainda não é cliente
// — e era justamente nessas que o painel travava tudo. Marcar uma reunião com
// alguém não exige CPF, endereço nem ficha completa; exige saber quem é e por
// qual número falar. É esse o registro mínimo que este formulário cria.
//
// O telefone não é editável de propósito: ele vem da conversa aberta. Deixar
// digitar aqui seria abrir a porta para o pré-cadastro nascer apontando para um
// número que ninguém está atendendo.
import React, { useState } from 'react';
import { Loader2, Phone, UserPlus, X } from 'lucide-react';
import { whatsappService } from '../../services/whatsapp.service';
import { useToastContext } from '../../contexts/ToastContext';
import { prettyPhone } from './format';
import { zc } from '../../styles/layers';

export const PreCadastroModal: React.FC<{
  conversationId: string;
  phone: string;
  /** Nome de exibição do WhatsApp — chute inicial, quase sempre certo. */
  suggestedName?: string | null;
  /** Frase curta dizendo para que serve, quando vem de uma ação específica. */
  reason?: string | null;
  onClose: () => void;
  /** Recebe o registro recém-criado e já vinculado à conversa. */
  onCreated: (clientId: string, fullName: string) => void;
}> = ({ conversationId, phone, suggestedName, reason, onClose, onCreated }) => {
  const toast = useToastContext();
  const [name, setName] = useState(suggestedName?.trim() || '');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const novo = await whatsappService.createQuickContact({ fullName: name, phone });
      await whatsappService.linkClient(conversationId, novo.id);
      toast.success('Pré-cadastro criado.', 'Ele não entra na lista de clientes.');
      onCreated(novo.id, novo.full_name);
    } catch (e: any) {
      toast.error('Falha ao criar pré-cadastro', e?.message);
      setSaving(false);
    }
  };

  return (
    <div className={`fixed inset-0 ${zc.MODAL} flex items-center justify-center bg-black/50 p-4`} onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 px-4 pt-4">
          <div>
            <p className="text-[14px] font-bold text-slate-800">Pré-cadastro</p>
            <p className="text-[11.5px] text-slate-500 mt-0.5">
              {reason || 'Anote quem é para poder trabalhar esta conversa.'}
            </p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg text-slate-400 hover:bg-slate-100 flex items-center justify-center flex-shrink-0">
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-3 space-y-2.5">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Nome de exibição</label>
            <input value={name} onChange={e => setName(e.target.value)} autoFocus
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
              placeholder="Como esta pessoa aparece para a equipe"
              className="w-full px-3 py-2 text-[13.5px] rounded-lg bg-[#f3f2ef] border border-transparent focus:bg-white focus:border-sky-300 outline-none" />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Telefone</label>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#f3f2ef] text-[13px] text-slate-500">
              <Phone size={13} className="flex-shrink-0" /> {prettyPhone(phone)}
            </div>
          </div>
          <p className="text-[11px] leading-snug text-slate-400">
            Não é cliente: fica fora da lista, da busca e das estatísticas do módulo Clientes.
            Quando virar cliente, é um clique — e tudo que já estiver marcado continua no lugar.
          </p>
        </div>

        <div className="flex justify-end gap-2 px-4 pb-4">
          <button onClick={onClose} className="px-3 py-1.5 text-[12.5px] font-semibold text-slate-500 hover:text-slate-700">Cancelar</button>
          <button onClick={submit} disabled={saving || !name.trim()}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-sky-600 text-white text-[12.5px] font-semibold hover:bg-sky-700 disabled:opacity-50 transition">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />} Criar pré-cadastro
          </button>
        </div>
      </div>
    </div>
  );
};
