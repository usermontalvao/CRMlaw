// A barra da inbox, em três peças — e a divisão é a razão de o nome de cada
// aba ter voltado a ser escrito.
//
// Antes as cinco viviam na mesma barra: Todas / Não lidas / Minhas / Agendadas
// / Ligações. Cinco nomes por extenso, com os contadores, pedem 389 px na
// fonte real do CRM; a coluna da lista no mínimo (`LIST_MIN`, 312 px) oferece
// 280 px úteis. Não havia tipografia que fechasse essa conta — por isso a
// versão anterior deste arquivo dizia cada aba com um ícone e abria em palavra
// só a que estava ativa.
//
// A saída não foi encolher texto, foi olhar o que aquelas cinco coisas são.
// "Todas", "Não lidas" e "Minhas" FILTRAM A MESMA LISTA de conversas.
// "Agendadas" e "Ligações" não filtram nada: elas SUBSTITUEM a lista por outro
// conteúdo (a fila de agendamentos, o histórico de chamadas). São dois tipos de
// controle diferentes empilhados na mesma barra, e era essa mistura — não a
// largura da coluna — que criava a briga por espaço.
//
// Separados, cada um cabe: os três FILTROS ficam na barra com o nome escrito
// por extenso a 12 px, pedindo 211 px; as duas VISTAS (`InboxViewSwitch`) vão
// para a ponta da mesma linha, depois de um fio, em forma de ícone com o
// contador no canto — 289 px no total.
//
// AS VISTAS CONTINUAM EM ÍCONE, e isso é escolha, não desistência. O
// cabeçalho da lista, medido, já usa 313 px dos 308 que a coluna oferece:
// título, estado da conexão e quatro botões. Não havia lugar para dois nomes
// escritos lá em cima, e trazê-los escritos para cá custaria 150 px — a mesma
// conta que tirou os nomes dos filtros na versão anterior. O nome de cada
// vista vive no `title` e no `aria-label`.
//
// O CONTADOR VOLTOU PARA A LINHA NOS FILTROS. Sobreposto ao canto do ícone ele
// não custava largura, e era isso que o justificava; com o nome escrito ao lado
// ele passa a colidir com a aba seguinte. Nas vistas, que seguem em ícone, ele
// segue sobreposto pelo mesmo motivo de antes.
//
// "TODAS" NÃO TEM CONTADOR, e é a única. O número dela é inventário ("quantas
// conversas existem"), não pendência: ninguém age por causa dele, e ele é
// justamente o maior — quatro dígitos ou um "99+" permanente. O total continua
// no `title` da aba, para quem quiser conferir.
//
// O VERMELHO É NOVIDADE QUE NINGUÉM VIU, e ele SOME quando a vista é aberta.
// As duas que gritam são as vistas: "Agendadas" quando uma mensagem
// falhou na entrega (ninguém volta na conversa para conferir) e "Ligações"
// quando chegou chamada perdida depois da última olhada. As duas gritam com o
// atendente parado em outra vista — é o único jeito de a novidade alcançar quem
// não a procurava.
//
// A TERCEIRA PEÇA VEIO DEPOIS, e a mesma conta a explica. `InboxWaitingMenu`
// responde "quem está esperando?" — as conversas paradas na sua resposta e as
// paradas na do cliente. É FILTRO (recorta a mesma lista), então fica à
// esquerda do fio; mas escrever os dois nomes custaria ~150 px, que a barra não
// tem. Um ícone de ampulheta custa 24, e os nomes vão por extenso dentro do
// menu, onde não disputam largura com ninguém.
//
// Zerar ao abrir não é detalhe: um vermelho que fica aceso mesmo depois de a
// pessoa olhar vira paisagem, e paisagem não avisa nada. Foi o defeito da
// primeira versão da aba de ligações, contado em `callHistory.ts`.
import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CalendarClock, Hourglass, Inbox, PhoneCall, PhoneMissed, Reply, Send } from 'lucide-react';
import { WAITING_FILTERS, type WaitingFilter } from './inboxStatusScope';

export type InboxTab = 'all' | 'unread' | 'mine' | 'scheduled' | 'calls';

/** Vistas que substituem a lista, em oposição aos filtros que a recortam. */
export const INBOX_VIEWS: InboxTab[] = ['scheduled', 'calls'];

export interface InboxTabsProps {
  active: InboxTab;
  onChange: (tab: InboxTab) => void;
  counts: { all: number; unread: number; mine: number };
  className?: string;
}

/**
 * Os três filtros da lista de conversas, com o nome escrito por extenso.
 * Quando a vista ativa é "Agendadas" ou "Ligações" nenhum deles aparece
 * marcado — e clicar em qualquer um devolve a lista, que é a saída óbvia de
 * volta para as conversas.
 */
export const InboxTabs: React.FC<InboxTabsProps> = ({ active, onChange, counts, className = '' }) => {
  const abas: Array<[InboxTab, string, number]> = [
    // `0` no lugar do total: o contador de "Todas" não é desenhado (ver o
    // cabeçalho). O total real vai no `title`, logo abaixo.
    ['all', 'Todas', 0],
    ['unread', 'Não lidas', counts.unread],
    ['mine', 'Minhas', counts.mine],
  ];

  return (
    // `overflow-x-auto` é rede de segurança, não desenho: os três nomes cabem
    // com 69 px de folga na largura mais apertada do CRM, mas uma fonte maior
    // no sistema do usuário não pode esconder uma aba sem deixar rastro.
    <div className={`flex items-center gap-2 overflow-x-auto ${className}`}>
      {abas.map(([key, label, count]) => {
        const ativa = active === key;
        const numero = count > 99 ? '99+' : String(count);
        return (
          <button key={key} type="button" onClick={() => onChange(key)}
            title={key === 'all' ? `${label} (${counts.all})` : count > 0 ? `${label} (${count})` : label}
            aria-label={count > 0 ? `${label}, ${count}` : label}
            aria-current={ativa ? 'page' : undefined}
            className={`relative inline-flex shrink-0 items-center gap-1 rounded-full py-1 text-[12px] font-semibold transition ${
              ativa ? 'bg-amber-600 px-2.5 text-white' : 'px-1 text-slate-500 hover:bg-[#f3f2ef]'
            }`}>
            <span>{label}</span>
            {count > 0 && (
              <span className={`text-[10px] font-bold tabular-nums ${ativa ? 'text-white/75' : 'text-slate-400'}`}>
                {numero}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export interface InboxViewSwitchProps {
  active: InboxTab;
  onChange: (tab: InboxTab) => void;
  /** Agendadas MINHAS ainda na fila. O histórico de enviadas não é pendência. */
  scheduledPending: number;
  /** Agendadas que não foram entregues — o vermelho da vista. */
  scheduledFailed: number;
  /** Perdidas ainda não vistas (ver `callHistory#unseenMissedCount`). */
  callsUnseen: number;
  className?: string;
}

/**
 * As duas vistas que trocam a lista inteira, na ponta da barra de filtros.
 * Clicar na que já está aberta devolve as conversas: a vista é a porta de
 * entrada e de saída de si mesma, sem depender de o atendente adivinhar que a
 * volta está nos filtros ao lado.
 */
export const InboxViewSwitch: React.FC<InboxViewSwitchProps> = ({
  active, onChange, scheduledPending, scheduledFailed, callsUnseen, className = '',
}) => {
  const vistas: Array<[InboxTab, string, React.ElementType, number, boolean]> = [
    ['scheduled', 'Agendadas', scheduledFailed > 0 ? AlertTriangle : CalendarClock, scheduledPending, scheduledFailed > 0],
    ['calls', 'Ligações', callsUnseen > 0 ? PhoneMissed : PhoneCall, callsUnseen, callsUnseen > 0],
  ];

  return (
    <div className={`flex shrink-0 items-center gap-0.5 ${className}`}>
      {vistas.map(([key, label, Icone, count, alerta]) => {
        const ativa = active === key;
        const numero = count > 99 ? '99+' : String(count);
        return (
          <button key={key} type="button" onClick={() => onChange(ativa ? 'all' : key)}
            title={ativa ? `${label} — clique para voltar às conversas` : count > 0 ? `${label} (${count})` : label}
            aria-label={count > 0 ? `${label}, ${count}` : label}
            aria-pressed={ativa}
            className={`relative inline-flex shrink-0 items-center justify-center rounded-lg p-1 transition ${
              ativa
                ? (alerta ? 'bg-red-600 text-white' : 'bg-amber-600 text-white')
                : (alerta ? 'text-red-600 hover:bg-red-50' : 'text-slate-500 hover:bg-[#f3f2ef]')
            }`}>
            <Icone size={15} className="shrink-0" />
            {count > 0 && (
              <span className={`pointer-events-none absolute -top-0.5 -right-0.5 min-w-[15px] rounded-full px-[3px] text-[9px] font-bold leading-[15px] tabular-nums ring-2 ring-white ${
                alerta ? 'bg-red-600 text-white' : 'bg-slate-400 text-white'
              }`}>
                {numero}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export interface InboxWaitingMenuProps {
  /** Qual dos dois lados está ligado agora — `null` quando nenhum. */
  active: WaitingFilter | null;
  /** Quantas conversas cada lado traria SOB O ESCOPO ABERTO agora. */
  counts: Record<WaitingFilter, number>;
  /** Escolher o mesmo que já está ligado devolve `null` (desliga). */
  onPick: (waiting: WaitingFilter | null) => void;
  className?: string;
}

const WAITING_LABEL: Record<WaitingFilter, { curto: string; icone: React.ElementType }> = {
  waiting_you: { curto: 'Esperam você', icone: Reply },
  waiting_client: { curto: 'Esperam o cliente', icone: Send },
};

/**
 * "Quem está esperando?" — um ícone só, e o menu com os dois lados da espera.
 *
 * A pergunta é diária ("de quantas eu devo satisfação agora?") e a resposta já
 * existia no módulo: `convStatus` deriva "aguardando você" e "aguardando
 * cliente" da direção da última mensagem, e o seletor de status sabe filtrar
 * por elas. O que faltava era CHEGAR até lá sem abrir o painel de filtros.
 *
 * POR QUE UM ÍCONE, E NÃO DUAS ABAS. As duas medidas do cabeçalho deste arquivo
 * não deixam alternativa: os três filtros mais as duas vistas já pedem 289 px
 * numa coluna que no mínimo oferece 280. Dois controles escritos custariam
 * ~150 px e empurrariam alguma coisa para fora da barra; a ampulheta custa 24,
 * que é o que ainda cabe. O nome de cada lado vive no menu, escrito por
 * extenso, onde não disputa largura com ninguém.
 *
 * O NÚMERO É O ASSUNTO. Cada linha do menu traz a contagem, e ela respeita o
 * escopo aberto (Todas/Não lidas/Minhas) e os filtros de fila — abrir o menu em
 * "Minhas" e ler "4" tem de resultar em quatro linhas na lista, senão o menu
 * mente. Por isso a conta é feita fora, junto com a das abas.
 *
 * SEM DISTINTIVO NO ÍCONE, de propósito. Um número permanente aceso ali seria
 * paisagem em uma semana (é o defeito contado em `callHistory.ts`), e "esperam
 * o cliente" não é pendência de ninguém — é o estado normal de metade da fila.
 *
 * DESLIGAR PRECISA SER UMA LINHA, e a primeira versão errou nisso. Clicar de
 * novo no lado já ligado sempre desligou o filtro, mas isso é conhecimento que
 * não está escrito em lugar nenhum: quem abria o menu via dois lados, um deles
 * aceso, e nenhuma saída — o jeito de voltar à fila inteira era adivinhar o
 * segundo clique ou ir procurar o seletor de status no painel de filtros. Com
 * "Toda a fila" no topo, as três opções são um grupo de rádio comum: o estado
 * desligado é visível, tem nome e se alcança com um clique só. O segundo clique
 * no lado aceso continua funcionando, agora como atalho e não como segredo.
 */
export const InboxWaitingMenu: React.FC<InboxWaitingMenuProps> = ({ active, counts, onPick, className = '' }) => {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);

  return (
    <div ref={caixa} className={`relative shrink-0 ${className}`}>
      <button type="button" onClick={() => setAberto(o => !o)}
        title={active ? WAITING_LABEL[active].curto : 'Quem está esperando?'}
        aria-label={active ? WAITING_LABEL[active].curto : 'Quem está esperando?'}
        aria-haspopup="menu" aria-expanded={aberto}
        className={`inline-flex shrink-0 items-center justify-center rounded-lg p-1 transition ${
          active ? 'bg-amber-600 text-white' : 'text-slate-500 hover:bg-[#f3f2ef]'
        }`}>
        <Hourglass size={15} className="shrink-0" />
      </button>

      {aberto && (
        // `right-0`: a ampulheta mora na ponta direita da barra, e um menu
        // ancorado à esquerda sairia da coluna.
        <div role="menu"
          className="absolute right-0 top-full z-20 mt-1 w-[188px] overflow-hidden rounded-xl border border-black/[0.08] bg-white py-1 shadow-lg">
          {/* O estado DESLIGADO, escrito. Volta para "Abertas" (a fila de
              trabalho), nunca para "Todos os status" — desligar um filtro não
              pode acabar mostrando mais coisa do que antes; ver `pickWaiting`. */}
          <button type="button" role="menuitemradio" aria-checked={active === null}
            onClick={() => { onPick(null); setAberto(false); }}
            title="Toda a fila aberta, sem recorte de espera"
            className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] transition ${
              active === null ? 'bg-amber-50 font-semibold text-amber-800' : 'text-slate-600 hover:bg-[#f3f2ef]'
            }`}>
            <Inbox size={13} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">Toda a fila</span>
          </button>
          {/* Um fio: em cima o escopo inteiro, embaixo os recortes dele. */}
          <div aria-hidden className="my-1 h-px bg-[#efece5]" />
          {WAITING_FILTERS.map(key => {
            const { curto, icone: Icone } = WAITING_LABEL[key];
            const ligado = active === key;
            return (
              <button key={key} type="button" role="menuitemradio" aria-checked={ligado}
                onClick={() => { onPick(ligado ? null : key); setAberto(false); }}
                title={ligado ? `${curto} — clique para desligar o filtro` : curto}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] transition ${
                  ligado ? 'bg-amber-50 font-semibold text-amber-800' : 'text-slate-600 hover:bg-[#f3f2ef]'
                }`}>
                <Icone size={13} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{curto}</span>
                <span className={`text-[11px] font-bold tabular-nums ${ligado ? 'text-amber-700' : 'text-slate-400'}`}>
                  {counts[key] > 99 ? '99+' : counts[key]}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default InboxTabs;
