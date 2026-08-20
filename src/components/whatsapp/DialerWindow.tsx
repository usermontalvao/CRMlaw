// O DISCADOR — a janela de "tenho um número (ou um nome) e quero falar agora".
//
// Até aqui, ligar exigia uma conversa: o número saía da thread, do cartão de
// contato recebido ou do histórico. Quem tinha o telefone no papel, no e-mail
// ou na capa do processo não tinha por onde discar. Esta janela é essa porta, e
// ela é do ESCRITÓRIO INTEIRO — mora na raiz do app (ver `WaCallsHost`), não
// dentro do módulo WhatsApp, e por isso abre com o processo, o prazo ou a
// agenda na tela.
//
// TRÊS DECISÕES DE DESENHO, e as três têm motivo:
//
//  1. É JANELA, NÃO MODAL. Sem scrim, sem foco preso, sem "feche isto antes de
//     continuar": o CRM continua clicável atrás dela. Consultar o processo
//     ENQUANTO se liga é o caso comum, não a exceção — e um diálogo modal
//     tornaria isso impossível. Ela arrasta, minimiza para uma barra fina e
//     sobrevive à troca de módulo, exatamente como o painel da chamada.
//
//  2. VESTIDA COMO O PAINEL DA CHAMADA. Cartão branco, borda `#e7e5df`, sombra
//     de janela — os mesmos valores do `ActiveCallWidget`, que é a peça com que
//     ela se reveza no canto da tela. Um primeiro rascunho tentou o oposto (um
//     painel escuro, "de instrumento"): no modo claro ele aparecia como um
//     buraco preto no meio do CRM, e a janela da chamada que o substituía um
//     segundo depois era branca. Duas peças que se trocam no mesmo lugar não
//     podem ser de dois mundos.
//
//  3. O CAMPO ACEITA AS DUAS COISAS que a pessoa pode ter em mãos — número e
//     nome. Quem decide qual chegou é `dialerInput` (módulo puro, testado); a
//     tela só desenha o que ele responde. Enquanto for nome, o botão verde fica
//     apagado de propósito: quem escolhe o destino é a lista, porque um nome
//     pode ter dois telefones e adivinhar qual é seria o começo do erro.
//
// E UMA REGRA QUE VEM DE FORA: o número que sai daqui passa pela MESMA porta de
// todas as outras ligações do CRM (`placeCall` → `resolveCallablePhone`). O
// discador não disca: ele oferece um número. Quem recusa um LID, quem escolhe
// entre candidatos e quem gera o registro continua sendo o store.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check, ChevronDown, Delete, GripHorizontal, Loader2, Minus, Phone, PhoneMissed,
  PhoneOutgoing, RefreshCw, Search, Star, Video, X,
} from 'lucide-react';
import { useWaCalls } from '../../hooks/useWaCalls';
import { dialerStore, type DialerSnapshot } from '../../services/wacalls/dialerStore';
import {
  dialBlockMessage, formatDialed, onlyDigits, readDial,
} from '../../services/wacalls/dialerInput';
import { displayLine, lineBlockText } from '../../services/wacalls/callLine';
import { callLogService, type CallLogRow } from '../../services/callLog.service';
import { whatsappService, normalizePhone } from '../../services/whatsapp.service';
import { filterContacts, type ContactEntry } from './contactBook';
import { useContactProbes } from './contactProbes';
import { useDraggablePosition } from './callModals';
import { defaultCallWidgetPosition } from './callWidgetPlacement';
import { callHistoryIdentity } from './callHistory';
import { initials } from './format';
import { LAYER } from '../../styles/layers';
import { setDialerReady } from '../../utils/phoneDial';

/** Onde a janela guarda a posição — chave própria, separada da do painel da chamada. */
const POSITION_KEY = 'wa-dialer-position';
const CARD_SIZE = { width: 340, height: 470 };
/**
 * Acima dos modais de módulo — é o que faz dele uma janela e não um diálogo:
 * consultar o processo ENQUANTO se liga é o caso comum. Acima do painel da
 * chamada não: quem está falando tem prioridade na tela. Ver `styles/layers`.
 */
const Z_DIALER = LAYER.DIALER;

/** Quantas linhas de resultado cabem sem a janela virar uma lista de rolagem infinita. */
const MAX_RESULTOS = 6;

const TECLAS: Array<[string, string]> = [
  ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
  ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
  ['+', 'DDI'], ['0', ''], ['⌫', ''],
];

/** A janela do React para o `dialerStore`. */
export function useDialer(): DialerSnapshot {
  return React.useSyncExternalStore(dialerStore.subscribe, dialerStore.getSnapshot);
}

/** Um destino oferecido pela lista: sempre com telefone, nunca com apelido interno. */
interface Alvo {
  key: string;
  name: string;
  phone: string;
  /** Linha de baixo: o número, ou o que aconteceu na última ligação. */
  detail: string;
  clientId: string | null;
  conversationId: string | null;
  avatarUrl: string | null;
  /** Chamada perdida — a linha fica vermelha, como no histórico. */
  missed?: boolean;
}

/** As últimas ligações viram destinos, sem repetir o mesmo número duas vezes. */
function alvosDoHistorico(rows: readonly CallLogRow[]): Alvo[] {
  const vistos = new Set<string>();
  const saida: Alvo[] = [];
  for (const row of rows) {
    const identidade = callHistoryIdentity({
      id: row.id,
      direction: row.direction,
      outcome: row.outcome,
      phone: row.phone || '',
      peerLid: row.peerLid,
      contactName: row.contactName ?? null,
      startedAt: row.startedAt,
      conversationId: row.conversationId,
    });
    // Sem telefone de verdade não há para onde ligar: a linha existe no
    // histórico, mas no discador ela seria um botão que não faz nada.
    if (!identidade.callable || !row.phone) continue;
    const chave = normalizePhone(row.phone);
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    const perdida = row.outcome === 'missed';
    saida.push({
      key: `hist:${chave}`,
      name: identidade.title,
      phone: row.phone,
      detail: perdida ? 'Chamada perdida' : formatDialed(row.phone) || row.phone,
      clientId: row.clientId ?? null,
      conversationId: row.conversationId ?? null,
      avatarUrl: null,
      missed: perdida,
    });
    if (saida.length >= MAX_RESULTOS) break;
  }
  return saida;
}

/** O rosto do destino: foto pública do WhatsApp quando existe, iniciais quando não. */
const Rosto: React.FC<{ alvo: Alvo; foto: string | null }> = ({ alvo, foto }) => (
  foto
    ? <img src={foto} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
    : (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e7e5df] text-[10.5px] font-bold text-slate-500">
        {initials(alvo.name, alvo.phone)}
      </span>
    )
);

export const DialerWindow: React.FC = () => {
  const { open, minimized, draft, label } = useDialer();

  // "Existe discador nesta tela?" — a resposta que os botões de telefone
  // espalhados pelo CRM consultam ANTES de deixar o clique virar `tel:`.
  // Ela mora aqui porque esta janela só é montada quem tem permissão de discar
  // (ver `WaCallsHost`): estar na tela já é a permissão respondida.
  useEffect(() => {
    setDialerReady(true);
    return () => setDialerReady(false);
  }, []);

  const waCalls = useWaCalls();
  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { pos, dragging, handlers } = useDraggablePosition(cardRef, {
    storageKey: POSITION_KEY, fallbackSize: CARD_SIZE, place: defaultCallWidgetPosition,
  });

  const [agenda, setAgenda] = useState<ContactEntry[] | null>(null);
  const [recentes, setRecentes] = useState<CallLogRow[] | null>(null);
  /**
   * O número respondeu "não tem WhatsApp" e a pessoa insiste assim mesmo.
   *
   * Um número sem conta não some da tela nem vira botão morto: a sondagem pode
   * estar desatualizada, e o operador às vezes sabe de coisa que o cache não
   * sabe. Mas ligar vira DOIS gestos, e o segundo diz o que está fazendo — é a
   * mesma regra do painel "Nova conversa" para conversa com número sem conta.
   */
  const [insistir, setInsistir] = useState(false);
  /** A lista de linhas está aberta? (Só existe havendo mais de uma.) */
  const [trocandoLinha, setTrocandoLinha] = useState(false);
  /** O botão de atualizar está rodando? (Só para a seta girar.) */
  const [atualizando, setAtualizando] = useState(false);

  const estado = useMemo(() => readDial(draft), [draft]);

  // Trocar o número desarma a insistência: quem digita outro destino não herda
  // a permissão dada ao anterior.
  useEffect(() => { setInsistir(false); }, [estado.phone]);

  // A agenda e o histórico são buscados na PRIMEIRA abertura e ficam. Quem abre
  // o discador dez vezes num dia não paga dez consultas — e a lista de recentes
  // é relida ao fim de cada chamada, que é quando ela muda de verdade.
  useEffect(() => {
    if (!open) return;
    let vivo = true;
    if (agenda === null) {
      whatsappService.listContactBook()
        .then(lista => { if (vivo) setAgenda(lista); })
        .catch(() => { if (vivo) setAgenda([]); });
    }
    if (recentes === null) {
      callLogService.listRecent(40)
        .then(lista => { if (vivo) setRecentes(lista); })
        .catch(() => { if (vivo) setRecentes([]); });
    }
    return () => { vivo = false; };
  }, [open, agenda, recentes]);

  // A chamada que termina muda o histórico: releitura curta, sem realtime (a
  // tabela não está na publicação — ver `useCallHistory`).
  const chamadaAtivaId = waCalls.myCall?.callId ?? null;
  useEffect(() => {
    if (!chamadaAtivaId) return;
    return () => {
      callLogService.listRecent(40).then(setRecentes).catch(() => { /* fica a lista antiga */ });
    };
  }, [chamadaAtivaId]);

  // Foco no campo ao abrir e ao restaurar: o discador nasce pronto para digitar.
  useEffect(() => {
    if (open && !minimized) {
      const id = window.setTimeout(() => inputRef.current?.focus(), 60);
      return () => window.clearTimeout(id);
    }
  }, [open, minimized]);

  const destinos = useMemo<Alvo[]>(() => {
    if (estado.searching) {
      return filterContacts(agenda ?? [], draft).slice(0, MAX_RESULTOS).map(c => ({
        key: `ag:${c.clientId}:${c.phone}`,
        name: c.name,
        phone: c.phone,
        detail: formatDialed(c.phone) || c.phone,
        clientId: c.clientId,
        conversationId: null,
        avatarUrl: c.avatarUrl,
      }));
    }
    if (!draft.trim()) return alvosDoHistorico(recentes ?? []);
    // Digitando número: a agenda ainda ajuda — o número parcial casa com quem
    // já está cadastrado, e a pessoa reconhece o nome antes de terminar de
    // digitar. É o que o celular faz, e o que evita ligar para o número errado.
    const digitos = onlyDigits(draft);
    if (digitos.length < 3) return alvosDoHistorico(recentes ?? []);
    return filterContacts(agenda ?? [], digitos).slice(0, MAX_RESULTOS).map(c => ({
      key: `ag:${c.clientId}:${c.phone}`,
      name: c.name,
      phone: c.phone,
      detail: formatDialed(c.phone) || c.phone,
      clientId: c.clientId,
      conversationId: null,
      avatarUrl: c.avatarUrl,
    }));
  }, [estado.searching, agenda, recentes, draft]);

  // "Tem WhatsApp?" para o número inteiro digitado — a mesma sondagem em lote da
  // agenda, respondida antes do clique (ver `contactProbes`).
  const sondagem = useContactProbes(estado.phone ? [estado.phone] : []);
  const probe = estado.phone ? sondagem.get(normalizePhone(estado.phone)) : undefined;

  const digitar = useCallback((tecla: string) => {
    if (tecla === '⌫') {
      dialerStore.setDraft(draft.slice(0, -1));
      return;
    }
    dialerStore.setDraft(`${draft}${tecla}`);
  }, [draft]);

  const ligar = useCallback((alvo: Alvo | null, comVideo: boolean) => {
    const phone = alvo?.phone ?? estado.phone;
    if (!phone) return;
    const contato = {
      conversationId: alvo?.conversationId ?? null,
      clientId: alvo?.clientId ?? null,
      name: alvo?.name ?? label ?? formatDialed(phone) ?? phone,
      avatarUrl: alvo?.avatarUrl ?? null,
    };
    void (comVideo ? waCalls.placeVideoCall(phone, contato) : waCalls.placeCall(phone, contato));
    // A janela sai da frente na hora: quem assume o canto é o painel da chamada.
    dialerStore.minimize();
  }, [estado.phone, label, waCalls]);

  const aoTeclar = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      // Esc MINIMIZA, não fecha: fechar por reflexo apagaria o número digitado.
      dialerStore.minimize();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const alvo = estado.ready ? null : destinos[0] ?? null;
      if (!estado.ready && !alvo) return;
      ligar(alvo, event.metaKey || event.ctrlKey);
    }
  }, [estado.ready, destinos, ligar]);

  if (!open || typeof document === 'undefined') return null;

  // Com chamada minha de pé, a janela some da tela: o canto é do painel da
  // chamada, e duas janelas escuras empilhadas no mesmo lugar não se leem.
  const emChamada = !!waCalls.myCall && waCalls.myCall.phase !== 'ENDED' && waCalls.myCall.phase !== 'FAILED';
  if (emChamada) return null;

  const linhaOk = waCalls.canCall;
  const semWhats = !!probe && probe.hasWhatsApp === false;
  const podeLigar = estado.ready && linhaOk && (!semWhats || insistir);

  // A LINHA de saída: por qual CANAL a ligação sai, e qual número vai aparecer
  // no celular de quem receber.
  //
  // A lista é dos canais que são DESTA pessoa — inclusive os que ainda não têm
  // voz, marcados como tal. Um canal sem voz não é escolhível, mas precisa
  // aparecer: é o que responde "cadê a opção de trocar de canal?" com a verdade
  // em vez do silêncio. As linhas que não são dela ficam de fora da lista e são
  // nomeadas no rodapé, que é onde cabe explicar.
  const linhasMinhas = waCalls.lines.filter(l => l.authorized);
  const discaveis = linhasMinhas.filter(l => l.sessionId);
  const linhaAtual = displayLine(waCalls.lines, waCalls.sessionId, waCalls.preferredLine);
  const podeTrocarLinha = waCalls.linesReady && linhasMinhas.length > 1;
  const bloqueadas = waCalls.lines.filter(l => !l.authorized);
  /**
   * Ainda não sabemos quais são as linhas.
   *
   * É diferente de "não há linha para você", e a diferença aparecia como um
   * susto: enquanto a sessão do Supabase não é restaurada, a consulta de canais
   * volta vazia (é a RLS fazendo o certo), e a faixa anunciava "Nenhum canal
   * disponível" para quem tem todos. Enquanto não se sabe, se diz que não se
   * sabe.
   */
  const linhaDesconhecida = !waCalls.linesReady;
  const semLinhaMinha = !linhaDesconhecida && discaveis.length === 0;
  const numeroDaLinha = linhaAtual?.phone ? formatDialed(linhaAtual.phone) : '';
  const motivoDaLinha = linhaAtual
    ? lineBlockText(linhaAtual.block, linhaAtual.label)
    : '';
  /** Alguma tentativa em curso — a minha (botão) ou a do próprio CRM. */
  const rodando = atualizando || waCalls.retrying;

  const corpo = minimized ? (
    <motion.div
      ref={cardRef}
      key="dialer-min"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      className="fixed flex items-center gap-3 rounded-full border border-[#e7e5df] bg-white py-2 pl-3.5 pr-2 shadow-[0_16px_40px_-16px_rgba(15,23,42,0.45)]"
      style={{ left: pos.x, top: pos.y, zIndex: Z_DIALER }}
      {...handlers}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${linhaOk ? 'bg-emerald-500' : 'bg-amber-400'}`} />
      <button
        type="button"
        onClick={() => dialerStore.restore()}
        className="min-w-0 text-left"
      >
        <span className="block text-[13px] font-semibold leading-tight tabular-nums text-slate-800">
          {estado.text || 'Discador'}
        </span>
        <span className="block truncate text-[10.5px] text-slate-400">
          {label || (linhaOk ? 'Toque para voltar' : 'Linha indisponível')}
        </span>
      </button>
      <button
        type="button"
        onClick={() => dialerStore.close()}
        aria-label="Fechar discador"
        className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-[#f5f5f3] hover:text-slate-600"
      >
        <X size={14} />
      </button>
    </motion.div>
  ) : (
    <motion.div
      ref={cardRef}
      key="dialer"
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 14, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      role="dialog"
      aria-label="Discador"
      className="fixed w-[340px] overflow-hidden rounded-2xl border border-[#e7e5df] bg-white shadow-[0_20px_50px_-16px_rgba(15,23,42,0.5)]"
      style={{ left: pos.x, top: pos.y, zIndex: Z_DIALER }}
    >
      {/* Tarja da linha — e a alça de arrasto. O estado do serviço fica escrito
          o tempo todo, para o botão apagado nunca ser um mistério. */}
      <div
        {...handlers}
        className={`flex items-center gap-2 border-b border-[#e7e5df] bg-[#f7f6f3] px-3 py-2 ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      >
        <GripHorizontal size={14} className="text-slate-300" />
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${linhaOk ? 'bg-emerald-500' : 'bg-amber-400'}`} />
        <span className="truncate text-[10.5px] font-semibold uppercase tracking-[0.12em] text-slate-400">
          {linhaOk ? 'Linha conectada' : 'Linha indisponível'}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => dialerStore.minimize()}
          aria-label="Minimizar discador"
          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-white hover:text-slate-600"
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          onClick={() => dialerStore.close()}
          aria-label="Fechar discador"
          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-white hover:text-slate-600"
        >
          <X size={14} />
        </button>
      </div>

      {/* A LINHA — por qual canal esta ligação vai sair.
          Ela ganhou faixa própria, e não um canto da tarja de cima, porque é
          uma informação que muda a conversa: o cliente atende olhando para um
          número, e quem liga precisa saber qual é ANTES de discar, não depois.
          Vira lista quando a pessoa tem mais de um canal — inclusive os que
          ainda não têm voz, que aparecem dizendo isso. */}
      <div className="relative border-b border-[#e7e5df] bg-white">
        <div className="flex items-center">
          <button
            type="button"
            disabled={!podeTrocarLinha}
            onClick={() => setTrocandoLinha(v => !v)}
            aria-expanded={podeTrocarLinha ? trocandoLinha : undefined}
            aria-label={podeTrocarLinha ? 'Trocar o canal de saída' : undefined}
            className={`flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-4 pr-2 text-left transition ${
              podeTrocarLinha ? 'hover:bg-[#f7f6f3]' : 'cursor-default'
            }`}
          >
            <PhoneOutgoing
              size={14}
              className={`shrink-0 ${semLinhaMinha ? 'text-amber-500' : 'text-slate-400'}`}
            aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                {linhaDesconhecida ? 'Linha' : semLinhaMinha ? 'Sem linha' : 'Sai por'}
              </span>
              <span className={`block truncate text-[12px] font-semibold ${
                linhaDesconhecida && !linhaAtual ? 'text-slate-400' : 'text-slate-700'
              }`}>
                {linhaAtual?.label || (linhaDesconhecida ? 'Verificando…' : 'Nenhum canal disponível')}
                {numeroDaLinha && (
                  <span className="font-normal text-slate-400"> · {numeroDaLinha}</span>
                )}
              </span>
            </span>
            {podeTrocarLinha && (
              <ChevronDown
                size={14}
                className={`shrink-0 text-slate-400 transition-transform ${trocandoLinha ? 'rotate-180' : ''}`}
              />
            )}
          </button>

          {/* ATUALIZAR. Ele existe porque uma aba fica aberta o dia inteiro: o
              serviço de voz pode ter caído e voltado, e o cadastro de canal e de
              membro pode ter mudado no meio do expediente. O CRM tenta sozinho
              (ver `scheduleRetry` no store), mas quem está olhando para a tela
              parada não deve precisar esperar o próximo degrau — nem recarregar
              a página, que era a única saída antes disto. */}
          <button
            type="button"
            disabled={rodando}
            onClick={() => {
              setAtualizando(true);
              void waCalls.retry().finally(() => setAtualizando(false));
            }}
            title={rodando ? 'Procurando a linha…' : 'Atualizar linhas e serviço de chamadas'}
            aria-label={rodando ? 'Procurando a linha' : 'Atualizar linhas e serviço de chamadas'}
            className="mr-2.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-[#f7f6f3] hover:text-slate-600 disabled:text-slate-300"
          >
            {/* A seta gira também nas tentativas AUTOMÁTICAS: com a linha
                amarela, o CRM já está procurando sozinho, e quem está olhando
                para a tela precisa ver que alguém está fazendo alguma coisa —
                senão clica no botão sem necessidade e conclui que travou. */}
            <RefreshCw size={13} className={rodando ? 'animate-spin' : ''} />
          </button>
        </div>

        {podeTrocarLinha && trocandoLinha && (
          <ul className="absolute inset-x-2 top-full z-10 mt-1 overflow-hidden rounded-xl border border-[#e7e5df] bg-white py-1 shadow-[0_16px_40px_-16px_rgba(15,23,42,0.45)]">
            {linhasMinhas.map(linha => {
              const escolhida = !!linha.sessionId && linha.sessionId === waCalls.sessionId;
              const usavel = !!linha.sessionId;
              const preferida = waCalls.preferredLine === linha.key;
              return (
                <li key={linha.key} className="flex items-center">
                  <button
                    type="button"
                    disabled={!usavel}
                    onClick={() => {
                      if (!linha.sessionId) return;
                      waCalls.setLine(linha.sessionId);
                      setTrocandoLinha(false);
                    }}
                    className={`flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-3 pr-1 text-left transition ${
                      usavel ? 'hover:bg-[#f7f6f3]' : 'cursor-not-allowed'
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[12px] font-semibold ${
                        usavel ? 'text-slate-700' : 'text-slate-400'
                      }`}>
                        {linha.label}
                      </span>
                      <span className="block truncate text-[10.5px] text-slate-400">
                        {formatDialed(linha.phone) || 'número desconhecido'}
                        {/* O canal sem voz diz por que não dá para escolher — a
                            alternativa (sumir com ele) devolveria a pergunta
                            "cadê o outro canal?" sem resposta. */}
                        {linha.block === 'no-voice' && ' · sem voz'}
                        {linha.block === 'offline' && ' · fora do ar'}
                      </span>
                    </span>
                    {escolhida && <Check size={13} className="shrink-0 text-emerald-600" />}
                  </button>

                  {/* A ESTRELA é a linha com que o discador ABRE, e por isso é um
                      botão separado do de escolher: marcar a preferida não é
                      dizer "quero ligar por ela agora", e clicar na estrela não
                      pode fechar a lista como se fosse uma escolha. Clicar de
                      novo desmarca — sem preferida, vale a primeira usável. */}
                  <button
                    type="button"
                    onClick={() => waCalls.setPreferredLine(preferida ? null : linha.key)}
                    title={preferida ? 'Deixar de abrir por esta linha' : 'Abrir sempre por esta linha'}
                    aria-label={preferida ? 'Deixar de abrir por esta linha' : 'Abrir sempre por esta linha'}
                    aria-pressed={preferida}
                    className={`mr-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition hover:bg-[#f7f6f3] ${
                      preferida ? 'text-amber-500' : 'text-slate-300 hover:text-slate-500'
                    }`}
                  >
                    <Star size={13} fill={preferida ? 'currentColor' : 'none'} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* O campo. Um <input> de verdade: colar, apagar, teclado do celular e
          leitor de tela funcionam de graça — um <div> pintado de campo não. */}
      <div className="flex items-center gap-2 px-4 pb-3 pt-4">
        {estado.searching
          ? <Search size={16} className="shrink-0 text-slate-400" />
          : <Phone size={16} className="shrink-0 text-emerald-600" />}
        <input
          ref={inputRef}
          value={estado.text}
          onChange={e => dialerStore.setDraft(e.target.value)}
          onKeyDown={aoTeclar}
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="Número ou nome"
          aria-label="Número ou nome para ligar"
          className="min-w-0 flex-1 bg-transparent text-[22px] font-medium tabular-nums tracking-tight text-slate-900 placeholder:text-[15px] placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-300 focus:outline-none"
        />
        {estado.phone && (
          <span
            className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${
              probe === undefined
                ? 'bg-[#f0eee9] text-slate-400'
                : semWhats
                  ? 'bg-rose-50 text-rose-600'
                  : 'bg-emerald-50 text-emerald-700'
            }`}
          >
            {probe === undefined ? 'verificando…' : semWhats ? 'sem WhatsApp' : 'tem WhatsApp'}
          </span>
        )}
      </div>

      {/* Resultados: a agenda quando se digita nome, as últimas ligações quando
          o campo está vazio. Nunca as duas, para a lista não virar um caldeirão. */}
      <div className="max-h-[168px] overflow-y-auto border-t border-[#e7e5df]">
        <p className="px-4 pb-1 pt-2.5 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          {estado.searching || onlyDigits(draft).length >= 3 ? 'Contatos' : 'Ligações recentes'}
        </p>
        {destinos.length === 0 ? (
          <p className="px-4 pb-3 text-[12px] text-slate-400">
            {agenda === null && recentes === null
              ? 'Carregando…'
              : estado.searching ? 'Ninguém com esse nome na agenda.' : 'Nenhuma ligação ainda.'}
          </p>
        ) : destinos.map(alvo => (
          <button
            key={alvo.key}
            type="button"
            onClick={() => ligar(alvo, false)}
            className="flex w-full items-center gap-2.5 px-4 py-1.5 text-left transition hover:bg-[#f7f6f3]"
          >
            <Rosto alvo={alvo} foto={alvo.avatarUrl} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-slate-800">{alvo.name}</span>
              <span className={`block truncate text-[10.5px] ${alvo.missed ? 'text-rose-600' : 'text-slate-400'}`}>
                {alvo.detail}
              </span>
            </span>
            {alvo.missed
              ? <PhoneMissed size={13} className="shrink-0 text-rose-500" />
              : <Phone size={13} className="shrink-0 text-slate-300" />}
          </button>
        ))}
      </div>

      {/* Teclado — para o mouse, para o toque e para quem não digita rápido. */}
      <div className="grid grid-cols-3 gap-1.5 px-4 pt-3">
        {TECLAS.map(([tecla, letras]) => (
          <button
            key={tecla}
            type="button"
            onClick={() => digitar(tecla)}
            className="rounded-xl border border-[#e7e5df] bg-white py-1 text-center transition hover:bg-[#f5f5f3] active:bg-[#eceae4]"
          >
            <span className="block text-[17px] font-medium leading-tight tabular-nums text-slate-700">
              {tecla === '⌫' ? <Delete size={15} className="mx-auto text-slate-500" /> : tecla}
            </span>
            <span className="block text-[7.5px] font-bold tracking-[0.14em] text-slate-400">
              {letras || ' '}
            </span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 px-4 pb-3 pt-3">
        <button
          type="button"
          disabled={!podeLigar && !(estado.ready && linhaOk && semWhats)}
          onClick={() => {
            if (semWhats && !insistir) { setInsistir(true); return; }
            ligar(null, false);
          }}
          className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-[13.5px] font-bold transition ${
            podeLigar
              ? 'bg-emerald-600 text-white hover:bg-emerald-500'
              : 'cursor-not-allowed bg-[#f0eee9] text-slate-400'
          }`}
        >
          {waCalls.dialing ? <Loader2 size={16} className="animate-spin" /> : <Phone size={16} />}
          {semWhats && !insistir ? 'Ligar assim mesmo' : 'Ligar'}
        </button>
        <button
          type="button"
          disabled={!podeLigar}
          onClick={() => ligar(null, true)}
          aria-label="Ligar com vídeo"
          className={`flex h-[42px] w-[46px] items-center justify-center rounded-xl border border-[#e7e5df] transition ${
            podeLigar ? 'text-slate-600 hover:bg-[#f5f5f3]' : 'cursor-not-allowed text-slate-300'
          }`}
        >
          <Video size={17} />
        </button>
      </div>

      <p className="border-t border-[#e7e5df] bg-[#f7f6f3] px-4 py-2 text-[10.5px] text-slate-500">
        {/* A ORDEM importa: com o serviço fora, TODO canal fica sem voz, e
            dizer "nenhuma conta foi pareada" mandaria o escritório procurar um
            problema de cadastro que não existe. A queda vem primeiro. */}
        {rodando
          ? 'Procurando a linha…'
          : linhaDesconhecida
          ? 'Verificando por qual canal a ligação sai…'
          : waCalls.linkDown
          ? 'Serviço de chamadas indisponível — tentando de novo sozinho.'
          : semLinhaMinha
          ? (motivoDaLinha
            || (bloqueadas.length > 0
              ? `A linha ${bloqueadas.map(l => l.label).join(', ')} é restrita aos membros do canal. Peça acesso a um administrador.`
              : 'Nenhum canal com voz disponível para você.'))
          : semWhats
            ? 'Este número não tem WhatsApp: a chamada não sairia.'
            : dialBlockMessage(estado.block, draft) || 'Enter liga por voz · ⌘Enter liga com vídeo'}
      </p>
    </motion.div>
  );

  return createPortal(<AnimatePresence>{corpo}</AnimatePresence>, document.body);
};

export default DialerWindow;
