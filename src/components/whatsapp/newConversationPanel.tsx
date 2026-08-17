// Painel "Nova conversa" — a agenda, no lugar do modal de busca.
//
// O que mudou em relação ao modal antigo, e por quê:
//
//  · DESLIZA SOBRE A LISTA, não abre no meio da tela. É onde o WhatsApp Web
//    põe essa tela, e não é enfeite: a agenda quer ALTURA, e um diálogo
//    centralizado desperdiça as duas faixas de tela acima e abaixo dele.
//    Escolher com quem falar é a mesma tarefa de escolher uma conversa — por
//    isso acontece na mesma coluna, e não por cima de tudo.
//
//  · A LISTA JÁ VEM CHEIA. O modal antigo abria vazio e só mostrava alguém
//    depois de duas letras digitadas: para achar quem você não sabe soletrar,
//    não servia. Aqui a agenda inteira está aberta, separada por letra, e a
//    busca peneira o que já está na mão.
//
//  · UMA LINHA POR NÚMERO. O WhatsApp lista números; clicar já é escolher por
//    onde falar. Some o passo "qual número usar?" que o modal tinha para quem
//    tem celular e fixo.
//
//  · COM ROSTO. A foto não vem do cadastro (quase ninguém tem) e sim da que o
//    próprio WhatsApp já mandou em conversas anteriores — ver `listContactBook`.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Search, Loader2, Phone, UserPlus, Star, X } from 'lucide-react';
import { prettyPhone, prettyDoc, initials } from './format';
import { whatsappService, normalizePhone } from '../../services/whatsapp.service';
import { useToastContext } from '../../contexts/ToastContext';
import { filterContacts, groupByLetter, enterTarget, type ContactEntry } from './contactBook';
import {
  pickInitialChannel, isPreferredChannel, togglePreferred,
  readPreferredChannel, writePreferredChannel,
} from './preferredChannel';
import type { WhatsAppChannel } from '../../types/whatsapp.types';
import type { WhatsAppChannelDepartmentRouting } from '../../services/settings.service';

/** Avatar do contato: foto do WhatsApp quando existe, iniciais quando não. */
const ContactAvatar: React.FC<{ entry: ContactEntry }> = ({ entry }) => {
  // A URL assinada pode ter expirado entre carregar a agenda e rolar até aqui.
  // Sem esta rede, a linha ficaria com o ícone de imagem quebrada — pior do que
  // as iniciais, que sempre funcionam.
  const [quebrou, setQuebrou] = useState(false);
  const mostraFoto = !!entry.avatarUrl && !quebrou;
  return (
    <span className="relative h-11 w-11 flex-shrink-0 overflow-hidden rounded-full bg-[#00a884]/15 text-[13px] font-bold text-[#017561] flex items-center justify-center">
      {mostraFoto
        ? <img src={entry.avatarUrl!} alt="" onError={() => setQuebrou(true)}
            className="h-full w-full object-cover" loading="lazy" />
        : initials(entry.name, '')}
    </span>
  );
};

export const NewConversationPanel: React.FC<{
  channels: WhatsAppChannel[];
  channelRouting: WhatsAppChannelDepartmentRouting[];
  onClose: () => void;
  onOpened: (conversationId: string) => void;
}> = ({ channels, channelRouting, onClose, onOpened }) => {
  const toast = useToastContext();
  const [query, setQuery] = useState('');
  const [agenda, setAgenda] = useState<ContactEntry[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [preferred, setPreferred] = useState<string | null>(() => readPreferredChannel());
  const [channelId, setChannelId] = useState(() => pickInitialChannel(readPreferredChannel(), channels.map(c => c.id)));
  const [busy, setBusy] = useState(false);
  const rolagemRef = useRef<HTMLDivElement>(null);

  // A agenda é buscada UMA VEZ, na abertura. Enquanto o painel estiver de pé
  // ela não muda: buscar de novo a cada tecla é exatamente o que fazia o modal
  // antigo depender do servidor para peneirar.
  useEffect(() => {
    let vivo = true;
    whatsappService.listContactBook()
      .then(lista => { if (vivo) { setAgenda(lista); setErro(null); } })
      .catch((e: any) => { if (vivo) { setAgenda([]); setErro(e?.message || 'Não foi possível carregar a agenda.'); } });
    return () => { vivo = false; };
  }, []);

  // Esc fecha, como em qualquer tela sobreposta do módulo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Canal pode cair ou reconectar com o painel aberto — `channels` só traz os
  // conectados. Sem isto a seleção apontaria para um id fora da lista.
  useEffect(() => {
    const ids = channels.map(c => c.id);
    setChannelId(atual => (ids.includes(atual) ? atual : pickInitialChannel(preferred, ids)));
  }, [channels, preferred]);

  const filtrados = useMemo(() => filterContacts(agenda || [], query), [agenda, query]);
  const secoes = useMemo(() => groupByLetter(filtrados), [filtrados]);

  // Rolar de volta ao topo a cada peneirada: sem isto, apagar a busca deixava a
  // lista parada no meio do alfabeto, longe do que se acabou de digitar.
  useEffect(() => { rolagemRef.current?.scrollTo({ top: 0 }); }, [query]);

  const digits = query.replace(/\D/g, '');
  const typedPhone = digits.length >= 10 ? normalizePhone(query) : '';
  // Número digitado que JÁ está na agenda não vira oferta avulsa — abrir por ali
  // perderia o vínculo com o cadastro que a linha da agenda carrega.
  const telefoneInedito = typedPhone && !filtrados.some(e => e.phone === typedPhone) ? typedPhone : '';

  const abrir = async (phone: string, entry: ContactEntry | null) => {
    if (!channelId) { toast.warning('Selecione um canal conectado'); return; }
    setBusy(true);
    try {
      const { conversation_id } = await whatsappService.openConversation({
        phone,
        channelId,
        clientId: entry?.clientId ?? null,
        contactName: entry?.name ?? null,
        departmentId: channelRouting.find(item => item.channel_id === channelId)?.default_department_id || null,
      });
      onOpened(conversation_id);
    } catch (e: any) {
      toast.error('Falha ao abrir conversa', e.message);
    } finally { setBusy(false); }
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || busy) return;
    const alvo = enterTarget(telefoneInedito, filtrados);
    if (!alvo) return;
    e.preventDefault();
    if (alvo.kind === 'phone') void abrir(alvo.phone, null);
    else void abrir(alvo.entry.phone, alvo.entry);
  };

  const marcarPreferido = () => {
    const next = togglePreferred(preferred, channelId);
    writePreferredChannel(next);
    setPreferred(next);
  };

  const carregando = agenda === null;
  const ehPadrao = isPreferredChannel(preferred, channelId);

  return (
    <div
      // Cobre a coluna da lista inteira, incluindo o cabeçalho de busca —
      // é ele que o painel SUBSTITUI enquanto está aberto.
      className="wa-newconv absolute inset-0 z-20 flex flex-col bg-white"
      role="dialog" aria-modal="true" aria-label="Nova conversa"
    >
      {/* Cabeçalho: a seta de voltar, como no WhatsApp */}
      <div className="flex-shrink-0 bg-[#00a884] px-3 pb-3 pt-4 text-white">
        <div className="flex items-center gap-4">
          <button onClick={onClose} title="Voltar (Esc)" aria-label="Voltar"
            className="rounded-full p-1 transition hover:bg-white/15">
            <ArrowLeft size={20} />
          </button>
          <h2 className="text-[16px] font-semibold">Nova conversa</h2>
        </div>
      </div>

      {/* Busca */}
      <div className="flex-shrink-0 border-b border-[#e7e5df] px-3 py-2.5">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input autoFocus value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onSearchKeyDown}
            placeholder="Pesquisar nome, CPF/CNPJ ou número"
            className="w-full rounded-lg border border-transparent bg-[#f3f2ef] py-2 pl-9 pr-8 text-[13px] outline-none focus:border-amber-300 focus:bg-white" />
          {query && (
            <button onClick={() => setQuery('')} title="Limpar busca" aria-label="Limpar busca"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600">
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Canal — só quando há escolha a fazer. A estrela fixa o padrão. */}
      {channels.length > 1 && (
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-[#f1f0ec] bg-[#faf9f7] px-3 py-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Enviar por</span>
          <select value={channelId} onChange={e => setChannelId(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-[#e2e0d9] bg-white px-2 py-1 text-[12px] text-slate-700 outline-none focus:border-amber-300">
            {channels.map(c => <option key={c.id} value={c.id}>{c.name || c.instance_name}</option>)}
          </select>
          <button type="button" onClick={marcarPreferido} disabled={!channelId}
            title={ehPadrao ? 'Este é o canal padrão. Clique para deixar de usá-lo.' : 'Usar este canal como padrão nas próximas conversas'}
            aria-pressed={ehPadrao}
            className={`inline-flex flex-shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold transition disabled:opacity-40 ${
              ehPadrao ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'text-slate-400 hover:bg-white hover:text-amber-600'
            }`}>
            <Star size={12} fill={ehPadrao ? 'currentColor' : 'none'} />
            {ehPadrao ? 'Padrão' : 'Padrão'}
          </button>
        </div>
      )}

      {/* Agenda */}
      <div ref={rolagemRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {/* Número que não está na agenda: a saída para quem ainda não é cadastro. */}
        {telefoneInedito && (
          <button onClick={() => abrir(telefoneInedito, null)} disabled={busy}
            className="flex w-full items-center gap-3 border-b border-[#f1f0ec] px-3 py-3 text-left transition hover:bg-[#00a884]/10 disabled:opacity-50">
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white">
              <UserPlus size={19} />
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-slate-800">Conversar com este número</p>
              <p className="text-[12px] text-slate-400">{prettyPhone(telefoneInedito)} · não está na agenda</p>
            </div>
          </button>
        )}

        {carregando ? (
          <div className="flex items-center justify-center gap-2 py-14 text-[13px] text-slate-400">
            <Loader2 size={16} className="animate-spin" /> Carregando a agenda…
          </div>
        ) : erro ? (
          <p className="px-6 py-12 text-center text-[13px] text-red-600">{erro}</p>
        ) : secoes.length === 0 ? (
          !telefoneInedito && (
            <p className="px-6 py-12 text-center text-[13px] text-slate-400">
              {query.trim()
                ? <>Ninguém na agenda com <strong className="text-slate-500">{query.trim()}</strong>.<br />Digite um número completo para conversar mesmo assim.</>
                : 'Nenhum cliente com telefone cadastrado.'}
            </p>
          )
        ) : (
          <>
            {!query.trim() && (
              <p className="px-3 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Contatos ({filtrados.length})
              </p>
            )}
            {secoes.map(secao => (
              <div key={secao.letter}>
                {/* Cabeçalho de letra grudado no topo enquanto a seção passa.
                    Fundo sólido de propósito: desfoque em elemento grudento
                    obriga o navegador a recompor a faixa a cada quadro da
                    rolagem (mesma razão do divisor de data da conversa). */}
                <div className="sticky top-0 z-[1] bg-white/97 px-3 py-1.5 text-[12px] font-bold text-[#00a884]">
                  {secao.letter}
                </div>
                {secao.entries.map(entry => (
                  <button key={`${entry.clientId}-${entry.phone}`}
                    onClick={() => abrir(entry.phone, entry)} disabled={busy}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-[#f5f4f1] disabled:opacity-50">
                    <ContactAvatar entry={entry} />
                    <div className="min-w-0 flex-1 border-b border-[#f1f0ec] pb-2.5">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-[14px] text-slate-800">{entry.name}</p>
                        {entry.isPreCadastro && (
                          <span className="flex-shrink-0 rounded bg-slate-100 px-1 py-px text-[9px] font-bold uppercase text-slate-500">
                            pré-cadastro
                          </span>
                        )}
                      </div>
                      <p className="truncate text-[12.5px] text-slate-400">
                        {prettyPhone(entry.phone)}
                        {entry.phoneKind === 'phone' && <span className="text-slate-300"> · fixo</span>}
                        {entry.doc && <span className="text-slate-300"> · {prettyDoc(entry.doc)}</span>}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </>
        )}
      </div>

      {busy && (
        <div className="flex flex-shrink-0 items-center justify-center gap-2 border-t border-[#f1f0ec] bg-[#faf9f7] py-2 text-[12px] text-slate-500">
          <Loader2 size={13} className="animate-spin" /> Abrindo conversa…
        </div>
      )}
    </div>
  );
};

export default NewConversationPanel;
