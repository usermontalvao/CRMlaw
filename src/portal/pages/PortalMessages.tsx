import React from 'react';
import { Mail, Phone } from 'lucide-react';

export const PortalMessages: React.FC = () => {
  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight text-slate-900 sm:text-[26px]">Contato</h1>
        <p className="mt-1 text-sm text-slate-500">Fale com o escritório pelos canais abaixo.</p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
        <a href="mailto:contato@jurius.com.br" className="flex items-center gap-3 p-4 transition hover:bg-slate-50">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <Mail className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-slate-900">E-mail</p>
            <p className="truncate text-xs text-slate-500">contato@jurius.com.br</p>
          </div>
        </a>
        <a href="tel:+5511000000000" className="flex items-center gap-3 p-4 transition hover:bg-slate-50">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <Phone className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-slate-900">Telefone</p>
            <p className="truncate text-xs text-slate-500">Horário comercial</p>
          </div>
        </a>
      </section>
    </div>
  );
};

export default PortalMessages;
