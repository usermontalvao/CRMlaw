import React from 'react';
import { BellOff, CalendarDays, Clock3, Infinity as InfinityIcon } from 'lucide-react';
import { Modal, ModalBody } from '../ui/Modal';

export const WHATSAPP_MUTE_OPTIONS = [
  { label: '8 horas', description: 'Reativa automaticamente depois de 8 horas.', durationMs: 8 * 60 * 60 * 1000, icon: Clock3 },
  { label: '1 semana', description: 'Reativa automaticamente depois de 7 dias.', durationMs: 7 * 24 * 60 * 60 * 1000, icon: CalendarDays },
  { label: 'Até eu reativar', description: 'Fica sem prazo e você reativa quando quiser.', durationMs: null, icon: InfinityIcon },
] as const;

interface ConversationMuteModalProps {
  contactName: string;
  onClose: () => void;
  onMute: (durationMs: number | null, label: string) => void;
}

export const ConversationMuteModal: React.FC<ConversationMuteModalProps> = ({
  contactName,
  onClose,
  onMute,
}) => (
  <Modal
    open
    onClose={onClose}
    size="sm"
    eyebrow="WhatsApp"
    title="Silenciar notificações"
    subtitle={contactName}
    icon={<BellOff size={18} />}
  >
    <ModalBody className="space-y-3 p-4 sm:p-5">
      <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        As mensagens continuarão chegando normalmente. Som, aviso visual e notificação do sistema
        ficarão pausados somente para você; os outros atendentes não serão afetados.
      </p>

      <div className="space-y-2">
        {WHATSAPP_MUTE_OPTIONS.map(option => {
          const Icon = option.icon;
          return (
            <button
              key={option.label}
              type="button"
              onClick={() => onMute(option.durationMs, option.label)}
              className="group flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-left transition hover:border-amber-300 hover:bg-amber-50 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-amber-700 dark:hover:bg-amber-950/20"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 transition group-hover:bg-amber-100 group-hover:text-amber-700 dark:bg-zinc-700 dark:text-slate-300">
                <Icon size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{option.label}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-slate-500 dark:text-slate-400">{option.description}</span>
              </span>
              {option.durationMs === null && (
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-slate-500 dark:bg-zinc-700 dark:text-slate-300">
                  Sem prazo
                </span>
              )}
            </button>
          );
        })}
      </div>
    </ModalBody>
  </Modal>
);

export default ConversationMuteModal;
