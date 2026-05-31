/**
 * PortalMessages — Placeholder de mensagens (chat com o advogado).
 *
 * MVP exibe placeholder. Integração futura com chat.service.ts.
 */
import React from 'react';
import { MessageSquare, Sparkles, Mail, Phone } from 'lucide-react';
import { PageHeader } from '../components/PortalUI';

export const PortalMessages: React.FC = () => {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Mensagens"
        subtitle="Converse diretamente com seu advogado."
        icon={MessageSquare}
      />

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="bg-gradient-to-br from-orange-50 to-amber-50 p-8 text-center sm:p-12">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-orange-500 to-amber-500 text-white shadow-lg">
            <MessageSquare className="h-9 w-9" />
          </div>
          <h2 className="mt-5 text-xl font-bold text-slate-900">Chat em breve</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
            Em breve você poderá enviar mensagens, anexar arquivos e receber respostas do seu
            advogado diretamente por aqui, com total segurança.
          </p>
          <div className="mx-auto mt-5 inline-flex items-center gap-2 rounded-full bg-amber-100/80 px-3 py-1.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
            <Sparkles className="h-3.5 w-3.5" />
            Funcionalidade em desenvolvimento
          </div>
        </div>

        <div className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <a
            href="mailto:contato@jurius.com.br"
            className="flex items-center gap-3 p-5 transition hover:bg-slate-50"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
              <Mail className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">Enviar e-mail</p>
              <p className="truncate text-xs text-slate-500">contato@jurius.com.br</p>
            </div>
          </a>
          <a
            href="tel:+5511000000000"
            className="flex items-center gap-3 p-5 transition hover:bg-slate-50"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
              <Phone className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">Ligar para o escritório</p>
              <p className="truncate text-xs text-slate-500">Horário comercial</p>
            </div>
          </a>
        </div>
      </div>
    </div>
  );
};

export default PortalMessages;
