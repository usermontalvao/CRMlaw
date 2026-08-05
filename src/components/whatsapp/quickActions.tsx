// Ações rápidas da conversa, no painel de detalhes.
//
// Antes era uma grade de seis botões cinzentos iguais. Uma grade plana não tem
// hierarquia: "Exportar histórico" e "Bloquear contato" pediam a mesma atenção
// do olho que "Modelos", e a ação mais usada do dia ficava do mesmo tamanho da
// que se usa uma vez por mês. Quando tudo tem o mesmo peso, nada tem peso, e a
// pessoa lê os seis rótulos toda vez para achar um.
//
// Agora são três degraus, na ordem em que um atendimento acontece:
//
//   1. AGIR      — o que se faz com a conversa agora (triar, passar adiante,
//                  responder com um modelo). Fundo branco e borda: são botões,
//                  e parecem botões.
//   2. CONSULTAR — o que se olha antes de agir (histórico, resumo, exportação).
//                  Cinza, sem borda: presentes, mas em segundo plano.
//   3. BLOQUEAR  — a única irreversível. Sai da grade e vira uma linha só,
//                  discreta, que só fica vermelha quando a mão chega perto.
//                  Separada porque errar o alvo aqui custa caro.
import React from 'react';
import {
  History, MessageSquare, Sparkles, Download, Ban, ShieldOff, ArrowRightLeft, Mail,
} from 'lucide-react';

interface AcaoProps {
  icon: React.ReactNode;
  label: string;
  title: string;
  onClick: () => void;
  /** Primeiro degrau: parece botão (branco + borda). */
  primary?: boolean;
}

const Acao: React.FC<AcaoProps> = ({ icon, label, title, onClick, primary }) => (
  <button
    onClick={onClick}
    title={title}
    className={`wa-quick flex items-center justify-center gap-1 rounded-lg py-1.5 text-[10.5px] font-semibold transition ${
      primary
        ? 'border border-[#e7e5df] bg-white text-slate-600 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700'
        : 'bg-[#f3f2ef] text-slate-500 hover:bg-slate-200'
    }`}
  >
    {icon}
    <span className="truncate">{label}</span>
  </button>
);

export interface QuickActionsProps {
  /** Devolve a conversa à fila de não lidas e sai dela. */
  onMarkUnread: () => void;
  onTransfer: () => void;
  onTemplates: () => void;
  onTimeline: () => void;
  /** Só com cliente vinculado — o resumo lê o cadastro. */
  onSummary?: () => void;
  /** Só com mensagens carregadas — não há o que exportar de uma thread vazia. */
  onExport?: () => void;
  /** Só com permissão de bloqueio. */
  onBlock?: () => void;
  onUnblock?: () => void;
  blocked: boolean;
}

export const QuickActions: React.FC<QuickActionsProps> = ({
  onMarkUnread, onTransfer, onTemplates, onTimeline,
  onSummary, onExport, onBlock, onUnblock, blocked,
}) => {
  const consultar = [
    { key: 'hist', icon: <History size={13} />, label: 'Histórico', title: 'Histórico da conversa', onClick: onTimeline },
    onSummary ? { key: 'ia', icon: <Sparkles size={13} />, label: 'Resumo IA', title: 'Resumo por IA', onClick: onSummary } : null,
    onExport ? { key: 'exp', icon: <Download size={13} />, label: 'Exportar', title: 'Exportar histórico (.txt)', onClick: onExport } : null,
  ].filter(Boolean) as Array<{ key: string; icon: React.ReactNode; label: string; title: string; onClick: () => void }>;

  return (
    <div className="space-y-2">
      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Ações rápidas</p>

      {/* 1. Agir */}
      <div className="grid grid-cols-3 gap-1.5">
        <Acao primary onClick={onMarkUnread}
          icon={<Mail size={13} />} label="Não lida"
          title="Marcar como não lida e voltar para a fila — para responder depois" />
        <Acao primary onClick={onTransfer}
          icon={<ArrowRightLeft size={13} />} label="Transferir"
          title="Transferir a conversa para outro setor ou atendente" />
        <Acao primary onClick={onTemplates}
          icon={<MessageSquare size={13} />} label="Modelos"
          title="Usar modelo de mensagem" />
      </div>

      {/* 2. Consultar */}
      {consultar.length > 0 && (
        <div className={`grid gap-1.5 ${consultar.length === 3 ? 'grid-cols-3' : consultar.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {consultar.map(a => (
            <Acao key={a.key} icon={a.icon} label={a.label} title={a.title} onClick={a.onClick} />
          ))}
        </div>
      )}

      {/* 3. A irreversível, longe das outras. */}
      {blocked
        ? onUnblock && (
            <button onClick={onUnblock} title="Desbloquear contato"
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-red-50 py-1.5 text-[10.5px] font-semibold text-red-600 transition hover:bg-red-100">
              <ShieldOff size={13} /> Desbloquear contato
            </button>
          )
        : onBlock && (
            <button onClick={onBlock} title="Bloquear contato"
              className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-[10.5px] font-semibold text-slate-400 transition hover:bg-red-50 hover:text-red-600">
              <Ban size={13} /> Bloquear contato
            </button>
          )}
    </div>
  );
};
