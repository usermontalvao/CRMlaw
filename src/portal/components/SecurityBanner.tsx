import React, { useEffect, useState } from 'react';
import { ShieldCheck, Phone, MessageCircle, BadgeCheck, ChevronDown } from 'lucide-react';
import { clientPortalService } from '../services/clientPortal.service';

function formatPhone(d?: string): string {
  const n = (d || '').replace(/\D/g, '');
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return d || '';
}

export const SecurityBanner: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const [contact, setContact] = useState<{ name?: string; phone?: string; oab?: string } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    clientPortalService.getOfficeContact().then((response) => {
      if (mounted) setContact(response);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const phoneDigits = (contact?.phone || '').replace(/\D/g, '');
  const waNumber = phoneDigits ? (phoneDigits.startsWith('55') ? phoneDigits : `55${phoneDigits}`) : '';
  const phonePretty = formatPhone(contact?.phone);

  return (
    <section className="relative overflow-hidden rounded-[22px] border border-amber-200 bg-[linear-gradient(180deg,#fffaf0_0%,#fffdf8_100%)] shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
      <div className={`pointer-events-none absolute right-0 top-0 rounded-full bg-amber-100 blur-3xl ${compact ? 'h-24 w-24' : 'h-32 w-32'}`} />

      <button
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className={`relative flex w-full items-center gap-3 text-left ${compact ? 'p-3.5' : 'p-4 sm:p-5'}`}
      >
        <div className={`flex shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 ring-1 ring-amber-200 ${compact ? 'h-9 w-9' : 'h-11 w-11'}`}>
          <ShieldCheck className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
        </div>

        <div className="min-w-0 flex-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-700">Alerta de segurança</span>
          <div className={`flex items-center gap-2 ${compact ? 'mt-0.5' : 'mt-1'}`}>
            <p className={`font-bold leading-tight text-slate-900 ${compact ? 'text-[13px]' : 'text-sm'}`}>
              Cuidado com o golpe do falso advogado
            </p>
            {!open && (
              <p className="truncate text-xs text-slate-500">
                Confirme sempre pelo canal oficial
              </p>
            )}
          </div>
        </div>

        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-slate-400 ring-1 ring-slate-200 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}>
          <ChevronDown className="h-4 w-4" />
        </div>
      </button>

      <div className={`relative grid transition-all duration-300 ease-out ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          <div className={`${compact ? 'px-3.5 pb-3.5' : 'px-4 pb-4 sm:px-5 sm:pb-5'}`}>
            <p className="max-w-xl text-[13px] leading-relaxed text-slate-600">
              O escritório <strong className="font-semibold text-slate-900">nunca</strong> pede PIX ou dados por mensagem.
              Recebeu cobrança ou pedido urgente? <strong className="font-semibold text-slate-900">Confirme sempre</strong> pelo canal oficial abaixo.
            </p>

            {contact?.name && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center gap-1.5">
                  <BadgeCheck className="h-4 w-4 text-emerald-500" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Canal oficial verificado</span>
                </div>
                <p className="mt-1.5 text-sm font-bold text-slate-900">{contact.name}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                  {contact.oab && <span>{contact.oab}</span>}
                  {contact.oab && phonePretty && <span className="text-slate-300">·</span>}
                  {phonePretty && <span className="font-semibold text-slate-700">{phonePretty}</span>}
                </div>

                {phoneDigits && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <a
                      href={`https://wa.me/${waNumber}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-slate-800 active:scale-[0.98]"
                    >
                      <MessageCircle className="h-3.5 w-3.5 text-emerald-400" /> WhatsApp oficial
                    </a>
                    <a
                      href={`tel:+${waNumber}`}
                      className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 active:scale-[0.98]"
                    >
                      <Phone className="h-3.5 w-3.5 text-amber-500" /> Ligar
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default SecurityBanner;
