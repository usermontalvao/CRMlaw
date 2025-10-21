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
      className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4"
      onSubmit={(e) => e.stopPropagation()}
    >
      <div 
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" 
        onClick={onClose}
      />
      <div 
        className="relative bg-white rounded-lg shadow-2xl w-full max-w-full sm:max-w-4xl max-h-[95vh] sm:max-h-[90vh] overflow-hidden"
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
