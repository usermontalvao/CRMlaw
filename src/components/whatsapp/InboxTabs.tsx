// A barra da inbox, em duas peças — e a divisão é a razão de o nome de cada
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
// Zerar ao abrir não é detalhe: um vermelho que fica aceso mesmo depois de a
// pessoa olhar vira paisagem, e paisagem não avisa nada. Foi o defeito da
// primeira versão da aba de ligações, contado em `callHistory.ts`.
import React from 'react';
import { AlertTriangle, CalendarClock, PhoneCall, PhoneMissed } from 'lucide-react';

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

export default InboxTabs;
