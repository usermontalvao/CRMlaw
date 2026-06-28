// Tipos compartilhados entre o orquestrador `WhatsAppModule` e seus subcomponentes
// extraídos (painéis Client-360, modais, etc.). Centralizá-los aqui evita
// dependências circulares e duplicação de assinaturas entre os arquivos.
import type { WaModal } from '../WaWorkspace';

/** Opções de um diálogo de confirmação imperativo (hook `useConfirm`). */
export type ConfirmOpts = {
  message: string;
  title?: string;
  confirmLabel?: string;
  tone?: 'danger' | 'default';
};

/** Abre um diálogo de confirmação e resolve `true`/`false` conforme a escolha. */
export type ConfirmFn = (opts: ConfirmOpts) => Promise<boolean>;

/** Abre um modal/painel do workspace do WhatsApp (processo, requerimento, etc.). */
export type WaOpenWorkspaceFn = (modal: WaModal) => void;
