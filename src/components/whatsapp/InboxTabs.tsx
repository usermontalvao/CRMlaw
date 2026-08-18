// As abas da inbox: Todas / Não lidas / Minhas / Agendadas / Ligações.
//
// ELAS SÃO ÍCONES, e a razão é de espaço com consequência. Cinco rótulos
// escritos por extenso, cada um com o seu contador, não cabem na largura da
// coluna da lista: a barra quebrava em duas linhas, e a segunda linha come a
// altura justamente da lista de conversas, que é o conteúdo da tela.
//
// A saída NÃO foi esconder abas atrás de um menu — o que se esconde num menu o
// atendente esquece que existe, e a aba de ligações nasceria morta. A saída é
// dizer cada aba com um ícone e ABRIR EM PALAVRA a que está ativa: a barra fica
// com uma etiqueta escrita, a do lugar onde você está, e quatro ícones ao lado.
//
// O CONTADOR APARECE ONDE ELE É UMA PERGUNTA. Nas abas fechadas ele vai NO
// CANTO DO ÍCONE, sobreposto — o mesmo distintivo que o cabeçalho do CRM usa nos
// ícones de tarefas e notificações — porque sobreposto ele não custa largura
// nenhuma. Medido: com o contador ao lado do ícone a barra pedia 370 px e a
// coluna do widget embutido tem 274; três abas ficavam fora da tela.
//
// "TODAS" NÃO TEM CONTADOR, e é a única. O número dela é inventário ("quantas
// conversas existem"), não pendência: ninguém age por causa dele, e ele é
// justamente o maior — quatro dígitos ou um "99+" permanente, ocupando o lugar
// onde os números que pedem ação precisam ser vistos. O total continua no
// `title` da aba, para quem quiser conferir.
//
// O VERMELHO É PENDÊNCIA, e só ele. Duas abas podem gritar: "Agendadas" quando
// uma mensagem falhou na entrega (ninguém volta na conversa para conferir), e
// "Ligações" quando existe uma chamada perdida que ninguém retornou. As duas
// gritam mesmo com o atendente parado em outra aba — é o único jeito de a
// pendência ser vista por quem não estava procurando por ela.
import React from 'react';
import {
  AlertTriangle, CalendarClock, Inbox, Mail, PhoneCall, PhoneMissed, UserRound,
} from 'lucide-react';

export type InboxTab = 'all' | 'unread' | 'mine' | 'scheduled' | 'calls';

export interface InboxTabsProps {
  active: InboxTab;
  onChange: (tab: InboxTab) => void;
  counts: { all: number; unread: number; mine: number };
  /** Agendadas MINHAS ainda na fila. O histórico de enviadas não é pendência. */
  scheduledPending: number;
  /** Agendadas que não foram entregues — o vermelho da aba. */
  scheduledFailed: number;
  /** Perdidas que ninguém retornou (ver `callHistory#unreturnedMissedIds`). */
  callsUnreturned: number;
  className?: string;
}

export const InboxTabs: React.FC<InboxTabsProps> = ({
  active, onChange, counts, scheduledPending, scheduledFailed, callsUnreturned, className = '',
}) => {
  const abas: Array<[InboxTab, string, React.ElementType, number, boolean]> = [
    // `0` no lugar do total: o contador de "Todas" não é desenhado (ver o
    // cabeçalho). O total real vai no `title`, logo abaixo.
    ['all', 'Todas', Inbox, 0, false],
    ['unread', 'Não lidas', Mail, counts.unread, false],
    ['mine', 'Minhas', UserRound, counts.mine, false],
    ['scheduled', 'Agendadas', scheduledFailed > 0 ? AlertTriangle : CalendarClock, scheduledPending, scheduledFailed > 0],
    ['calls', 'Ligações', callsUnreturned > 0 ? PhoneMissed : PhoneCall, callsUnreturned, callsUnreturned > 0],
  ];

  return (
    // `overflow-x-auto` é rede de segurança, não desenho: com os contadores no
    // canto a barra cabe nas larguras reais do CRM, mas uma fonte maior no
    // sistema do usuário não pode esconder uma aba sem deixar rastro.
    <div className={`flex items-center gap-1.5 overflow-x-auto ${className}`}>
      {abas.map(([key, label, Icone, count, alerta]) => {
        const ativa = active === key;
        const numero = count > 99 ? '99+' : String(count);
        return (
          <button key={key} type="button" onClick={() => onChange(key)}
            title={key === 'all' ? `${label} (${counts.all})` : count > 0 ? `${label} (${count})` : label}
            aria-label={count > 0 ? `${label}, ${count}` : label}
            aria-current={ativa ? 'page' : undefined}
            className={`relative inline-flex shrink-0 items-center gap-1.5 rounded-full py-1 text-[12px] font-semibold transition ${
              ativa ? 'px-3' : 'px-2'
            } ${
              ativa
                ? (alerta ? 'bg-red-600 text-white' : 'bg-amber-600 text-white')
                : (alerta ? 'text-red-600 hover:bg-red-50' : 'text-slate-500 hover:bg-[#f3f2ef]')
            }`}>
            <Icone size={14} className="shrink-0" />
            {/* O nome só na aba ativa: é o rótulo do lugar onde você está, e é
                ele que dispensa os outros quatro. */}
            {ativa && <span>{label}</span>}
            {count > 0 && (ativa ? (
              // Na aba aberta o contador fica na linha, ao lado do nome: há
              // espaço, e ali ele se lê melhor do que sobreposto.
              <span className="min-w-[16px] rounded-full bg-white/25 px-1 text-[10px] font-bold leading-[15px] tabular-nums text-white">
                {numero}
              </span>
            ) : (
              <span className={`pointer-events-none absolute -top-0.5 -right-0.5 min-w-[15px] rounded-full px-[3px] text-[9px] font-bold leading-[15px] tabular-nums ring-2 ring-white ${
                alerta ? 'bg-red-600 text-white' : 'bg-slate-400 text-white'
              }`}>
                {numero}
              </span>
            ))}
          </button>
        );
      })}
    </div>
  );
};

export default InboxTabs;
