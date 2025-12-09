import { createPortal } from 'react-dom';
import ClientForm from './ClientForm';
import type { CreateClientDTO, Client } from '../types/client.types';

interface ClientFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onClientCreated?: (clientId: string, clientName: string) => void;
  prefillData?: Partial<CreateClientDTO>;
}

// Desativado para evitar overlay duplicado; use ClientForm via ClientsModule
export const ClientFormModal: React.FC<ClientFormModalProps> = () => null;
