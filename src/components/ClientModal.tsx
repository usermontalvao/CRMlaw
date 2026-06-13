import React from 'react';
import { Modal } from './ui';

type ModalSize = 'lg' | 'xl';

interface ClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  subtitle?: React.ReactNode;
  size?: ModalSize;
  icon?: React.ReactNode;
  headerActions?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

const sizeMap: Record<ModalSize, 'lg' | '2xl' | 'xl'> = {
  lg: '2xl',
  xl: 'xl',
};

const ClientModal: React.FC<ClientModalProps> = ({
  isOpen,
  onClose,
  title,
  eyebrow = 'Clientes',
  subtitle,
  size = 'xl',
  icon,
  headerActions,
  footer,
  children,
}) => (
  <Modal
    open={isOpen}
    onClose={onClose}
    title={title}
    eyebrow={eyebrow}
    subtitle={subtitle}
    size={sizeMap[size]}
    icon={icon}
    headerActions={headerActions}
    zIndex={70}
    footer={footer}
    accentBarClassName="bg-amber-500"
  >
    {children}
  </Modal>
);

export default ClientModal;
