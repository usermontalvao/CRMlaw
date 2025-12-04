import { createPortal } from 'react-dom';
import ClientForm from './ClientForm';
import type { CreateClientDTO, Client } from '../types/client.types';

interface ClientFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onClientCreated?: (clientId: string, clientName: string) => void;
  prefillData?: Partial<CreateClientDTO>;
}

export const ClientFormModal: React.FC<ClientFormModalProps> = ({
  isOpen,
  onClose,
  onClientCreated,
  prefillData,
}) => {
  if (!isOpen) return null;

  const handleClientSaved = (savedClient: Client) => {
    console.log('✅ Cliente salvo no modal:', savedClient.id, savedClient.full_name);
    if (onClientCreated) {
      onClientCreated(savedClient.id, savedClient.full_name);
    }
    onClose();
  };

  const handleModalClick = (e: React.MouseEvent) => {
    // Previne que clicks no modal fechem ele ou propaguem para o formulário pai
    e.stopPropagation();
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6 md:p-8"
      onSubmit={(e) => e.stopPropagation()}
    >
      {/* Overlay com blur suave */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
        onClick={onClose} 
      />
      
      {/* Container do modal com animação */}
      <div
        className="
          relative w-full max-w-5xl 
          bg-white dark:bg-zinc-900 
          rounded-2xl overflow-hidden 
          shadow-2xl dark:shadow-black/50 
          border border-zinc-200/50 dark:border-zinc-800/50 
          transform transition-all duration-300 ease-out 
          animate-in zoom-in-95 slide-in-from-bottom-4
        "
        onClick={handleModalClick}
      >
        <ClientForm
          client={null}
          prefill={prefillData}
          onBack={onClose}
          onSave={handleClientSaved}
        />
      </div>
    </div>
  );

  // Renderiza o modal fora da hierarquia do DOM atual usando Portal
  return createPortal(modalContent, document.body);
};
