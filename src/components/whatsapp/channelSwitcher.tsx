// Por qual número esta conversa fala — e como trocar.
//
// O escritório tem mais de um canal, e a mesma pessoa costuma ter uma thread em
// cada um. Quando o canal da conversa aberta está fora do ar, a mensagem não
// falha: fica retida esperando reconexão, e o atendente só descobre depois. Ver
// o canal (com o estado dele) no cabeçalho e poder pular para outro conectado —
// sem procurar a outra conversa na inbox — é o que evita a espera silenciosa.
import React, { useState } from 'react';
import { BellRing, Check, Loader2, Smartphone, AlertTriangle, RefreshCw } from 'lucide-react';
import { conversationName, maskName, prettyPhone } from './format';
import { zc } from '../../styles/layers';
import type {
  WhatsAppChannel, WhatsAppConversation, WhatsAppInstanceStatus, WhatsAppScheduledMessage,
} from '../../types/whatsapp.types';

export const CHANNEL_STATUS_META: Record<WhatsAppInstanceStatus, { label: string; dot: string; text: string }> = {
  connected: { label: 'Conectado', dot: '#16a34a', text: 'text-emerald-700' },
  connecting: { label: 'Reconectando', dot: '#f59e0b', text: 'text-amber-700' },
  disconnected: { label: 'Desconectado', dot: '#dc2626', text: 'text-red-600' },
};

export const channelName = (c: WhatsAppChannel): string => c.name || c.instance_name;

/** Uma linha da lista de canais: identidade, número e estado da conexão. */
const ChannelRow: React.FC<{
  channel: WhatsAppChannel;
  current: boolean;
  busy: boolean;
  onPick: () => void;
}> = ({ channel, current, busy, onPick }) => {
  const meta = CHANNEL_STATUS_META[channel.status];
  return (
    <button onClick={onPick} disabled={current || busy}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition ${current ? 'bg-[#f3f2ef] cursor-default' : 'hover:bg-[#00a884]/10'} disabled:opacity-70`}>
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: channel.color || '#94a3b8' }} />
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-semibold text-slate-800 truncate">{channelName(channel)}</span>
        <span className="flex items-center gap-1.5 text-[10.5px] text-slate-400">
          {channel.phone_number ? prettyPhone(channel.phone_number) : 'sem número'}
          <span className={`inline-flex items-center gap-1 font-semibold ${meta.text}`}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.dot }} />{meta.label}
          </span>
        </span>
      </span>
      {busy ? <Loader2 size={13} className="flex-shrink-0 animate-spin text-slate-400" />
        : current ? <Check size={13} className="flex-shrink-0 text-[#017561]" /> : null}
    </button>
  );
};

/**
 * Chip do cabeçalho: mostra o canal da conversa e abre a lista dos disponíveis.
 * Trocar não move a thread — abre (ou cria) a conversa do mesmo contato no outro
 * canal, que é o que o WhatsApp de fato tem do outro lado: outra conversa.
 */
export const ChannelSwitcher: React.FC<{
  channels: WhatsAppChannel[];
  currentId: string | null;
  busyId?: string | null;
  compact?: boolean;
  onSwitch: (channelId: string) => void;
}> = ({ channels, currentId, busyId, compact, onSwitch }) => {
  const [open, setOpen] = useState(false);
  const current = channels.find(c => c.id === currentId) || null;
  if (channels.length === 0) return null;

  const meta = CHANNEL_STATUS_META[current?.status ?? 'disconnected'];
  const fora = !!current && current.status !== 'connected';

  return (
    <div className="relative flex-shrink-0">
      <button onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}
        title={current ? `Canal: ${channelName(current)} — ${meta.label}` : 'Escolher canal'}
        className={`inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg border text-[12px] font-semibold transition ${fora
          ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
          : 'border-transparent bg-[#f3f2ef] text-slate-600 hover:bg-slate-200'}`}>
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: meta.dot }} />
        {!compact && <span className="max-w-[110px] truncate">{current ? channelName(current) : 'Sem canal'}</span>}
        {compact && <Smartphone size={14} />}
      </button>
      {open && (
        <>
          <button type="button" aria-label="Fechar seletor de canal"
            className="fixed inset-0 z-40 cursor-default bg-transparent"
            onClick={() => setOpen(false)} />
          <div role="menu" className="absolute right-0 top-11 z-50 w-64 rounded-xl bg-white shadow-xl border border-[#e7e5df] py-1.5 overflow-hidden">
            <div className="px-3 py-1 text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Canais disponíveis</div>
            {channels.map(c => (
              <ChannelRow key={c.id} channel={c} current={c.id === currentId} busy={busyId === c.id}
                onPick={() => { setOpen(false); onSwitch(c.id); }} />
            ))}
            <p className="px-3 pt-1.5 pb-1 text-[10.5px] leading-snug text-slate-400 border-t border-[#f1f0ec] mt-1">
              Trocar abre a conversa deste contato no outro número.
            </p>
          </div>
        </>
      )}
    </div>
  );
};

/**
 * Estado das conexões no cabeçalho da inbox — dito com NOME.
 *
 * Antes havia aqui um "Reconectando…" solto, e ele misturava duas coisas que
 * pedem reações opostas: o socket de tempo real do CRM (que só atrasa a lista,
 * e se resolve sozinho) e um NÚMERO do escritório fora do ar (que retém tudo
 * que for escrito e exige revalidar o canal). Quem lia só via a palavra e
 * perguntava "qual canal caiu?" — sem resposta na tela, porque o aviso nunca
 * tinha sido sobre canal nenhum.
 *
 * Agora o chip diz qual é o caso e, quando é canal, diz o nome. O ponto verde
 * também deixou de ser "algum canal conectado": com três números e um fora, ele
 * continuava verde e a queda só aparecia na hora do Enter.
 */
export const ChannelHealthChip: React.FC<{
  channels: WhatsAppChannel[];
  /** Socket de tempo real do CRM caído (a lista está sendo reposta por HTTP). */
  realtimeDown: boolean;
  /** No widget o espaço é curto: só o essencial fica escrito. */
  compact?: boolean;
  /** A lista de canais ainda não chegou — "nenhum canal" ainda não é um fato. */
  loading?: boolean;
}> = ({ channels, realtimeDown, compact, loading }) => {
  const [open, setOpen] = useState(false);
  // Canal desativado no cadastro não está "fora do ar": ele foi desligado de
  // propósito, e acender alarme por ele treina o atendente a ignorar o chip.
  const ativos = channels.filter(c => c.is_active !== false);
  const fora = ativos.filter(c => c.status !== 'connected');
  const caidos = fora.filter(c => c.status === 'disconnected');

  // Um canal fora vale mais que o socket caído: o socket atrasa, o canal impede.
  const grave = caidos.length > 0;
  const tom = fora.length > 0
    ? (grave
      ? { dot: '#dc2626', chip: 'bg-red-50 text-red-700', hover: 'hover:bg-red-100' }
      : { dot: '#f59e0b', chip: 'bg-amber-50 text-amber-700', hover: 'hover:bg-amber-100' })
    : realtimeDown
      ? { dot: '#f59e0b', chip: 'bg-amber-50 text-amber-700', hover: 'hover:bg-amber-100' }
      : { dot: loading ? '#cbd5e1' : ativos.length > 0 ? '#16a34a' : '#9ca3af', chip: 'text-slate-500', hover: 'hover:bg-[#f1f0ec]' };

  // Enquanto a lista não chega, o chip não afirma nada. Dizer "Offline" com
  // base em `channels === []` é confundir "ainda não sei" com "está fora" — e
  // "está fora" é a frase que faz o atendente parar de escrever e ir conferir o
  // celular. Silêncio é melhor do que uma afirmação que se desmente sozinha um
  // segundo depois.
  const rotulo = loading
    ? 'Carregando…'
    : fora.length > 0
    ? (fora.length === 1
      ? `${channelName(fora[0])} ${fora[0].status === 'connecting' ? 'reconectando' : 'fora'}`
      : `${fora.length} canais fora`)
    : realtimeDown
      ? 'Reconectando…'
      : ativos.length > 0 ? 'Online' : 'Offline';

  const dica = loading
    ? 'Consultando o estado dos canais…'
    : fora.length > 0
    ? `${fora.map(c => `${channelName(c)}: ${CHANNEL_STATUS_META[c.status].label.toLowerCase()}`).join(' · ')}`
    : realtimeDown
      ? 'Sem conexão em tempo real com o CRM — a lista está sendo atualizada por sincronização periódica. Seus canais do WhatsApp seguem conectados.'
      : ativos.length > 0 ? 'Conectado ao WhatsApp' : 'Nenhum canal conectado';

  return (
    <div className="relative flex-shrink-0">
      <button type="button" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}
        title={dica}
        className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold transition ${tom.chip} ${tom.hover}`}>
        {fora.length === 0 && realtimeDown
          ? <RefreshCw size={11} className="animate-spin" />
          : <span className="inline-block w-2 h-2 rounded-full" style={{ background: tom.dot }} />}
        {/* Estando tudo no ar, o verde sozinho já diz o mesmo e a palavra
            "Online" custa 45 pixels numa linha de 384 que já carrega busca,
            filtro e três botões. Queda, não: ali o nome precisa estar escrito
            mesmo no widget, senão volta a pergunta "qual canal?". */}
        {(!compact || fora.length > 0 || realtimeDown || loading) && <span className="max-w-[132px] truncate">{rotulo}</span>}
      </button>
      {open && (
        <>
          <button type="button" aria-label="Fechar estado dos canais"
            className={`fixed inset-0 ${zc.POPOVER} cursor-default bg-transparent`}
            onClick={() => setOpen(false)} />
          {/* Abre para a DIREITA, não para a esquerda: o chip é o primeiro item
              do cabeçalho da lista, e um painel de 256px ancorado à direita
              saía pela borda do módulo e ia parar embaixo do menu lateral. Para
              a direita ele cabe inteiro dentro da coluna de conversas. */}
          <div role="menu"
            className={`absolute left-0 top-8 ${zc.POPOVER} w-64 rounded-xl bg-white shadow-xl border border-[#e7e5df] py-1.5 overflow-hidden`}>
            <div className="px-3 py-1 text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Estado dos canais</div>
            {ativos.length === 0 && (
              <p className="px-3 py-2 text-[11.5px] text-slate-500">
                {loading ? 'Consultando os canais…' : 'Nenhum canal ativo cadastrado.'}
              </p>
            )}
            {ativos.map(c => {
              const meta = CHANNEL_STATUS_META[c.status];
              return (
                <div key={c.id} className="flex items-center gap-2.5 px-3 py-2">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.color || '#94a3b8' }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-semibold text-slate-800 truncate">{channelName(c)}</span>
                    <span className="flex items-center gap-1.5 text-[10.5px] text-slate-400">
                      {c.phone_number ? prettyPhone(c.phone_number) : 'sem número'}
                      <span className={`inline-flex items-center gap-1 font-semibold ${meta.text}`}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.dot }} />{meta.label}
                      </span>
                    </span>
                  </span>
                </div>
              );
            })}
            {fora.length > 0 && (
              <p className="px-3 pt-1.5 pb-2 text-[10.5px] leading-snug text-slate-400 border-t border-[#f0eee9]">
                O que for escrito por um canal fora fica <strong>retido</strong> até ele voltar. Revalide o número em
                {' '}<strong>Configurações → Integrações → WhatsApp</strong>.
              </p>
            )}
            {realtimeDown && (
              <p className="px-3 pt-1.5 pb-2 text-[10.5px] leading-snug text-slate-400 border-t border-[#f0eee9]">
                A atualização em tempo real do CRM também está fora: a inbox segue
                sendo reposta por sincronização periódica.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
};

/**
 * Faixa acima do compositor quando o canal da conversa não está conectado.
 *
 * Já foi um modal em tela cheia: escurecia tudo e exigia uma decisão antes de
 * deixar mexer no módulo. Segurava bem a atenção e atrapalhava todo o resto —
 * ler outra conversa, procurar um contato, qualquer coisa passava por dispensar
 * um aviso. Agora o peso está aqui: a faixa NÃO se dispensa, fica de pé
 * enquanto o canal estiver fora e mora colada ao compositor, que é exatamente
 * para onde o olho vai antes de digitar.
 */
export const ChannelDownBanner: React.FC<{
  channel: WhatsAppChannel;
  alternatives: WhatsAppChannel[];
  busyId?: string | null;
  onSwitch: (channelId: string) => void;
}> = ({ channel, alternatives, busyId, onSwitch }) => (
  <div role="alert"
    className="px-4 py-2.5 border-t border-red-200 bg-red-50 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
    <span className="flex-shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-red-100 text-red-600">
      <AlertTriangle size={15} strokeWidth={2.4} />
    </span>
    <p className="flex-1 min-w-[240px] text-[12px] leading-snug text-red-900">
      O canal <strong>{channelName(channel)}</strong>
      {channel.phone_number ? ` (${prettyPhone(channel.phone_number)})` : ''} está{' '}
      {CHANNEL_STATUS_META[channel.status].label.toLowerCase()}. Tudo que você escrever aqui fica{' '}
      <strong>retido</strong> até ele reconectar — o cliente não recebe.
      {alternatives.length === 0 && (
        <> Nenhum outro canal está conectado: revalide o número em <strong>Configurações → Integrações → WhatsApp</strong>.</>
      )}
    </p>
    {alternatives.map(c => (
      <button key={c.id} onClick={() => onSwitch(c.id)} disabled={busyId === c.id}
        title="Trocar e enviar automaticamente as mensagens retidas"
        className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-[#00a884] text-[#017561] text-[12px] font-bold hover:bg-[#00a884]/10 transition disabled:opacity-50">
        {busyId === c.id ? <Loader2 size={12} className="animate-spin" /> : <Smartphone size={12} />}
        Falar pelo {channelName(c)}
      </button>
    ))}
  </div>
);

/**
 * Alerta global das mensagens que ESTE atendente tentou enviar e não chegaram.
 *
 * Diferente da faixa preventiva da conversa, esta sirene representa um fato já
 * ocorrido. Por isso não tem botão de dispensar: sai apenas quando o scheduler
 * confirma o envio, quando o autor cancela, ou quando a pendência é resolvida.
 */
/** Teto do scheduler: depois disso a retida desiste (ver whatsapp-scheduler). */
const HOLD_CEILING_MS = 12 * 60 * 60_000;

/**
 * Por que ESTA mensagem não saiu — dita como aconteceu.
 *
 * A frase era sempre "falhou após 12 horas sem conexão", e virava mentira no caso
 * mais comum: o canal cai no meio do envio ("Connection Closed") e a mensagem
 * falha em segundos, não em meio dia. Quem lê precisa saber se espera o canal
 * voltar ou se aquilo já era.
 */
export const describeHoldFailure = (item: WhatsAppScheduledMessage, failed: number): string => {
  const desde = item.hold_since ? Date.parse(item.hold_since) : NaN;
  const desistiu = !Number.isNaN(desde) && Date.now() - desde >= HOLD_CEILING_MS;
  if (desistiu) {
    return `${failed === 1 ? 'Uma falhou' : `${failed} falharam`} após 12 horas sem conexão`
      + ` e precisa${failed === 1 ? '' : 'm'} de ação.`;
  }
  const bruto = (item.error || '').replace(/^Error:\s*/i, '').replace(/\.$/, '').trim();
  const motivo = /connection (closed|lost)|not connected|desconect/i.test(bruto)
    ? 'o canal caiu no meio do envio'
    : (bruto || 'o envio falhou');
  return failed === 1
    ? `Uma não saiu: ${motivo}.`
    : `${failed} não saíram — a primeira porque ${motivo}.`;
};

export const ReconnectHoldSiren: React.FC<{
  items: WhatsAppScheduledMessage[];
  conversationsById: ReadonlyMap<string, WhatsAppConversation>;
  channelsById: ReadonlyMap<string, WhatsAppChannel>;
  privateMode: boolean;
  onOpen: (conversationId: string) => void;
}> = ({ items, conversationsById, channelsById, privateMode, onOpen }) => {
  if (items.length === 0) return null;

  // Falha definitiva vem primeiro; uma mensagem ainda retida pode se resolver
  // sozinha, a que desistiu já exige alguém.
  const first = items.find(item => item.status === 'failed') ?? items[0];
  const failed = items.filter(item => item.status === 'failed').length;
  const conversation = conversationsById.get(first.conversation_id);
  const channel = first.channel_id ? channelsById.get(first.channel_id) : null;
  const recipient = conversation
    ? (privateMode ? maskName(conversationName(conversation)) : conversationName(conversation))
    : 'um contato';
  const channelLabel = channel ? channelName(channel) : 'o canal usado';

  return (
    <div role="alert" aria-live="assertive"
      className="relative z-20 flex-shrink-0 border-y border-red-300 bg-red-50 px-3 sm:px-5 py-2.5 shadow-[0_3px_12px_rgba(220,38,38,0.12)]">
      <div className="mx-auto flex max-w-[1500px] items-center gap-3">
        {/* Dois pulsos fazem a leitura de sirene mesmo no canto do olho, sem
            animar a faixa inteira (o texto continua confortável de ler). */}
        <span className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-600 text-white shadow-sm">
          <span className="absolute inset-0 rounded-full bg-red-500 opacity-35 animate-ping" aria-hidden="true" />
          <BellRing size={20} className="relative animate-pulse" strokeWidth={2.5} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-extrabold text-red-800">
            {items.length === 1
              ? '1 mensagem sua ainda não chegou ao cliente'
              : `${items.length} mensagens suas ainda não chegaram aos clientes`}
          </p>
          <p className="mt-0.5 text-[11.5px] leading-snug text-red-700">
            {failed > 0
              ? describeHoldFailure(first, failed)
              : `A mensagem para ${recipient} está retida porque ${channelLabel} está indisponível.`}
            {' '}O cliente não recebeu. Abra a pendência para conferir ou trocar de canal.
          </p>
        </div>
        <button type="button" onClick={() => onOpen(first.conversation_id)}
          className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-2 text-[12px] font-bold text-red-700 shadow-sm transition hover:bg-red-100">
          <AlertTriangle size={14} />
          <span className="hidden sm:inline">Ver e resolver</span>
          <span className="sm:hidden">Ver</span>
        </button>
      </div>
    </div>
  );
};
