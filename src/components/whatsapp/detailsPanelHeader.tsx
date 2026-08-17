// Topo do painel de detalhes: quem é o contato e em que pé está o atendimento.
//
// O que havia aqui era um cabeçalho de 40px de avatar seguido de um bloco em que
// "Responsável", "Setor" e "Etiquetas" dividiam duas colunas — e as etiquetas,
// que são a parte que MUDA e que tem controle, ficavam espremidas em metade da
// largura, com uma etiqueta acima do seletor e outra abaixo. O olho não achava
// onde começava cada coisa.
//
// A separação aqui é por natureza da informação:
//   · identidade  — quem é (foto grande, nome, telefone);
//   · atendimento — responsável, setor e a única etapa editável do funil.
import React, { useState } from 'react';
import { Building2, Check, Copy, Phone, Target, UserRound, ZoomIn } from 'lucide-react';
import { Avatar } from './avatar';
import { conversationName, maskName, maskPhoneFull, prettyPhone } from './format';
import type { WhatsAppConversation } from '../../types/whatsapp.types';

/**
 * Copia um texto, com o caminho antigo como rede de segurança.
 *
 * `navigator.clipboard` só existe em origem segura e com permissão; num acesso
 * por IP na rede do escritório, ou num navegador mais velho, ele simplesmente
 * não está lá. Sem o segundo caminho, o botão não faria nada e ninguém saberia
 * por quê. Devolve se conseguiu — quem chama só comemora se deu certo.
 */
async function escreverNaAreaDeTransferencia(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch { /* segue para o caminho antigo */ }
  try {
    const campo = document.createElement('textarea');
    campo.value = texto;
    campo.setAttribute('readonly', '');
    campo.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(campo);
    campo.select();
    const ok = document.execCommand('copy');
    campo.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Identidade do contato: foto grande, nome e telefone copiável. */
export const ContactIdentity: React.FC<{
  conversation: WhatsAppConversation;
  privateMode: boolean;
  /** Abre a foto ampliada. Ausente quando o contato não tem foto. */
  onOpenPhoto?: () => void;
}> = ({ conversation, privateMode, onOpenPhoto }) => {
  const [copied, setCopied] = useState(false);
  const nome = privateMode ? maskName(conversationName(conversation)) : conversationName(conversation);

  // Copiar o número é o gesto mais repetido daqui: é o que se cola no processo,
  // no cadastro, na petição. No modo privado o número está mascarado na tela e
  // copiar seria justamente o furo que o modo existe para tapar.
  const copiarTelefone = async () => {
    if (privateMode) return;
    if (!(await escreverNaAreaDeTransferencia(conversation.contact_phone))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="wa-panel-hero -mx-3.5 -mt-3.5 mb-1 px-3.5 pb-4 pt-5">
      <div className="flex flex-col items-center gap-2.5 text-center">
        <div className="wa-avatar-hero relative">
          <Avatar
            url={conversation.contact_avatar_url}
            name={conversationName(conversation)}
            phone={conversation.contact_phone}
            size={84}
            onClick={onOpenPhoto}
          />
          {onOpenPhoto && (
            <span className="wa-avatar-zoom pointer-events-none absolute inset-0 flex items-center justify-center rounded-full text-white">
              <ZoomIn size={22} />
            </span>
          )}
        </div>
        <div className="min-w-0 max-w-full">
          <p className="truncate text-[15px] font-bold leading-tight text-slate-800">{nome}</p>
          <button
            onClick={copiarTelefone}
            disabled={privateMode}
            title={privateMode ? undefined : 'Copiar número'}
            className="wa-phone-copy mt-1 inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[12px] text-slate-500 disabled:cursor-default"
          >
            {copied
              ? <Check size={12} className="flex-shrink-0 text-emerald-600" />
              : <Phone size={12} className="flex-shrink-0 text-slate-300" />}
            <span className="truncate">{privateMode ? maskPhoneFull() : prettyPhone(conversation.contact_phone)}</span>
            {!privateMode && !copied && <Copy size={11} className="wa-phone-copy-icon flex-shrink-0 text-slate-300" />}
          </button>
        </div>
      </div>
    </div>
  );
};

/** Um dado de estado do atendimento: rótulo pequeno, valor legível. */
const Campo: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  /** Cor da etapa do funil; sem ela o valor sai no cinza padrão. */
  tone?: string;
}> = ({ icon, label, value, tone }) => (
  <div className="min-w-0">
    <p className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">
      {icon}{label}
    </p>
    <p className="mt-0.5 truncate text-[12.5px] font-semibold" style={tone ? { color: tone } : undefined}>
      <span className={tone ? '' : 'text-slate-700'}>{value}</span>
    </p>
  </div>
);

/**
 * Estado do atendimento: responsável, setor e etapa do funil.
 *
 * A etapa vive AQUI, e não junto das etiquetas, apesar de ser derivada delas: o
 * que ela responde ("em que ponto do funil está") é a mesma pergunta de
 * responsável e setor. Ao lado das etiquetas ela parecia uma etiqueta repetida.
 */
export const AttendanceSummary: React.FC<{
  assignee: string;
  department: string;
  stage?: { stageLabel: string; color: string } | null;
  stageControl?: React.ReactNode;
}> = ({ assignee, department, stage, stageControl }) => (
  <div className="rounded-xl border border-[#f1f0ec] bg-[#fbfaf8] p-2.5">
    <div className="grid grid-cols-2 gap-2">
      <Campo icon={<UserRound size={10} />} label="Responsável" value={assignee} />
      <Campo icon={<Building2 size={10} />} label="Setor" value={department} />
    </div>
    {(stage || stageControl) && (
      <div className="mt-2 border-t border-[#f1f0ec] pt-2">
        <p className="mb-0.5 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">
          <Target size={10} />Etapa
        </p>
        {stageControl ?? (stage && (
          <p className="truncate text-[12.5px] font-semibold" style={{ color: stage.color }}>{stage.stageLabel}</p>
        ))}
      </div>
    )}
  </div>
);
