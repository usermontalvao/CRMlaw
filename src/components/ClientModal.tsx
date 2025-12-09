import React from 'react';
import ClientForm from './ClientForm';

// Wrapper simples com overlay neutro e sem sombras extras
const ClientModal: React.FC<React.ComponentProps<typeof ClientForm>> = (props) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
      <div className="w-full max-w-4xl px-4">
        <ClientForm {...props} />
      </div>
    </div>
  );
};

export default ClientModal;
