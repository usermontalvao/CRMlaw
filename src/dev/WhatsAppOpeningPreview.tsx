// DEV-ONLY: bancada da abertura de conversa (?waopeningpreview=1).
//
// O que se vê aqui é o intervalo entre clicar num botão verde do CRM (ficha do
// cliente, lead, requerimento…) e a conversa aparecer dentro do widget. É um
// intervalo curto e invisível em desenvolvimento — a máquina é rápida e o banco
// está do lado —, o que o tornava impossível de julgar sem uma bancada: era
// preciso confiar que "aquele meio segundo" estava bonito.
//
// Aqui ele fica de pé pelo tempo que se quiser, na largura real do painel
// flutuante, com e sem nome do contato (a segunda coluna é o caso do número
// digitado à mão, que não tem cadastro nenhum por trás).
import React, { useState } from 'react';
import { ConversationOpening } from '../components/whatsapp/conversationOpening';

const Painel: React.FC<{ titulo: string; name?: string | null; phone: string }> = ({ titulo, name, phone }) => (
  <div>
    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{titulo}</p>
    <div
      className="relative overflow-hidden rounded-[24px] border border-slate-900/[0.10] bg-white"
      style={{ width: 380, height: 520, boxShadow: '0 24px 56px -20px rgba(15,23,42,.28)' }}
    >
      <ConversationOpening name={name} phone={phone} />
    </div>
  </div>
);

export const WhatsAppOpeningPreview: React.FC = () => {
  const [visivel, setVisivel] = useState(true);
  return (
    <div className="min-h-screen bg-[#f4f4f1] p-8">
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-lg font-semibold text-slate-800">Abrindo conversa</h1>
        <button
          type="button"
          onClick={() => setVisivel(v => !v)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
        >
          {visivel ? 'Esconder' : 'Mostrar'}
        </button>
      </div>
      {visivel && (
        <div className="flex flex-wrap gap-8">
          <Painel titulo="Com cadastro" name="Maria Aparecida de Souza" phone="5565992216459" />
          <Painel titulo="Número solto" phone="556530280000" />
        </div>
      )}
    </div>
  );
};

export default WhatsAppOpeningPreview;
