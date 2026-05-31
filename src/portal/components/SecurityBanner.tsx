/**
 * SecurityBanner — Banner premium anti-golpe do "falso advogado".
 *
 * Recolhido: chama atenção de forma elegante. Expandido: revela o canal
 * OFICIAL do escritório (puxado do perfil do advogado) e ações de contato.
 */
import React, { useEffect, useState } from 'react';
import { ShieldCheck, Phone, MessageCircle, BadgeCheck, ChevronDown } from 'lucide-react';
import { clientPortalService } from '../services/clientPortal.service';

function formatPhone(d?: string): string {
  const n = (d || '').replace(/\D/g, '');
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return d || '';
}

export const SecurityBanner: React.FC = () => {
  const [contact, setContact] = useState<{ name?: string; phone?: string; oab?: string } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    clientPortalService.getOfficeContact().then((c) => { if (mounted) setContact(c); });
    return () => { mounted = false; };
  }, []);

  const phoneDigits = (contact?.phone || '').replace(/\D/g, '');
  const waNumber = phoneDigits ? (phoneDigits.startsWith('55') ? phoneDigits : `55${phoneDigits}`) : '';
  const phonePretty = formatPhone(contact?.phone);

  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 shadow-lg">
      {/* Glow âmbar */}
      <div className="pointer-events-none absolute -right-12 -top-16 h-52 w-52 rounded-full bg-amber-500/15 blur-3xl" />
      {/* Escudo decorativo (watermark) */}
      <ShieldCheck className="pointer-events-none absolute -right-6 bottom-[-1.5rem] h-44 w-44 text-white/[0.04]" strokeWidth={1.5} />

      {/* ── Cabeçalho (sempre visível, clicável) ── */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="relative flex w-full items-center gap-3.5 p-4 text-left sm:p-5"
      >
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-400/15 text-amber-400 ring-1 ring-amber-400/30">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-amber-300">Alerta de segurança</span>
          </div>
          <p className="mt-0.5 text-sm font-bold leading-tight text-white">
            Cuidado com o golpe do falso advogado
          </p>
          {!open && (
            <p className="mt-0.5 truncate text-xs text-slate-400">Toque para ver o canal oficial</p>
          )}
        </div>
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-slate-300 ring-1 ring-white/10 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}>
          <ChevronDown className="h-4 w-4" />
        </div>
      </button>

      {/* ── Conteúdo expansível ── */}
      <div
        className={`relative grid transition-all duration-300 ease-out ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-4 sm:px-5 sm:pb-5">
            <p className="max-w-md text-[13px] leading-relaxed text-slate-300">
              O escritório <strong className="font-semibold text-white">nunca</strong> pede PIX ou dados por mensagem.
              Recebeu cobrança ou pedido urgente? <strong className="font-semibold text-white">Confirme sempre</strong> pelo canal oficial abaixo.
            </p>

            {contact?.name && (
              <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.06] p-3.5 backdrop-blur-sm">
                <div className="flex items-center gap-1.5">
                  <BadgeCheck className="h-4 w-4 text-emerald-400" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">Canal oficial verificado</span>
                </div>
                <p className="mt-1.5 text-sm font-bold text-white">{contact.name}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
                  {contact.oab && <span>{contact.oab}</span>}
                  {contact.oab && phonePretty && <span className="text-slate-600">·</span>}
                  {phonePretty && <span className="font-semibold text-slate-200">{phonePretty}</span>}
                </div>

                {phoneDigits && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <a
                      href={`https://wa.me/${waNumber}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 rounded-lg bg-white px-3 py-2.5 text-xs font-bold text-slate-900 shadow-sm transition hover:bg-slate-100 active:scale-[0.98]"
                    >
                      <MessageCircle className="h-3.5 w-3.5 text-emerald-600" /> WhatsApp oficial
                    </a>
                    <a
                      href={`tel:+${waNumber}`}
                      className="flex items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/5 px-3 py-2.5 text-xs font-bold text-white transition hover:bg-white/10 active:scale-[0.98]"
                    >
                      <Phone className="h-3.5 w-3.5 text-amber-400" /> Ligar
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
