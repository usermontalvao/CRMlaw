import React from 'react';
import { MessageSquare, Mail, Phone } from 'lucide-react';

export const PortalMessages: React.FC = () => {
  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight text-slate-900 sm:text-[26px]">Mensagens</h1>
        <p className="mt-1 text-sm text-slate-500">Canais de contato com o escritório.</p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <MessageSquare className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Atendimento integrado</p>
              <p className="text-xs text-slate-500">Em breve disponível diretamente aqui no portal.</p>
            </div>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          <a href="mailto:contato@jurius.com.br" className="flex items-center gap-3 p-4 transition hover:bg-slate-50">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <Mail className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-slate-900">E-mail</p>
              <p className="truncate text-xs text-slate-500">contato@jurius.com.br</p>
            </div>
          </a>
          <a href="tel:+5511000000000" className="flex items-center gap-3 p-4 transition hover:bg-slate-50">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <Phone className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-slate-900">Telefone</p>
              <p className="truncate text-xs text-slate-500">Horário comercial</p>
            </div>
          </a>
        </div>
      </section>
    </div>
  );
};

export default PortalMessages;
