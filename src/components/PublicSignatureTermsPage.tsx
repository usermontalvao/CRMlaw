import React, { useMemo } from 'react';
import { Clock, Check, ShieldCheck } from 'lucide-react';
import { BrandLogo } from './ui';
import {
  SIGNATURE_TERMS_VERSION,
  SIGNATURE_TERMS_ALL_VERSIONS,
  getSignatureTerms,
  parseSignatureTermsText,
} from '../constants/signatureTerms';

interface PublicSignatureTermsPageProps {
  /** Versão pedida na URL (ex.: 'v1'). Vazio = versão atual. */
  version?: string | null;
}

function formatDate(iso: string): string {
  try {
    return new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR', {
      day: '2-digit', month: 'long', year: 'numeric',
    });
  } catch {
    return iso;
  }
}

/**
 * Página PÚBLICA e versionada dos Termos de Uso da Assinatura Eletrônica.
 * Rota: /#/termos-assinatura  ou  /#/termos-assinatura/<versao>
 * Permite consultar exatamente a versão que um signatário aceitou.
 */
const PublicSignatureTermsPage: React.FC<PublicSignatureTermsPageProps> = ({ version }) => {
  const terms = getSignatureTerms(version);
  const isCurrent = terms.version === SIGNATURE_TERMS_VERSION;
  const requestedUnknown = !!version && !SIGNATURE_TERMS_ALL_VERSIONS.some((v) => v.version === version);

  const blocks = useMemo(() => parseSignatureTermsText(terms.text, terms.title), [terms]);

  return (
    <div className="relative min-h-[100dvh] overflow-hidden" style={{ background: '#f6f5f2' }}>
      {/* Faixa de marca */}
      <div className="h-[4px] w-full" style={{ background: 'linear-gradient(90deg, #ea580c 0%, #f97316 45%, #fb923c 100%)' }} />

      {/* Monograma "J" gigante e bem apagado ao fundo (igual à tela de login) */}
      <div
        aria-hidden="true"
        className="pointer-events-none select-none fixed"
        style={{
          right: '-3%', bottom: '-14%', zIndex: 0,
          fontFamily: "'Newsreader', Georgia, 'Times New Roman', serif",
          fontSize: 'clamp(360px, 46vw, 760px)', lineHeight: 1, fontWeight: 400,
          color: 'rgba(15,23,42,0.035)',
        }}
      >
        J
      </div>
      {/* Brilho âmbar tênue, canto superior esquerdo */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed"
        style={{
          left: '-10%', top: '-6%', width: 520, height: 520, zIndex: 0,
          background: 'radial-gradient(circle, rgba(249,115,22,0.07), transparent 65%)',
        }}
      />

      <div className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        <div className="flex flex-col lg:flex-row gap-8 lg:gap-12">

          {/* ── SIDEBAR ── */}
          <aside className="lg:w-[290px] flex-shrink-0">
            <div className="lg:sticky lg:top-10 space-y-7">

              {/* Marca */}
              <div className="flex items-center gap-3">
                <BrandLogo iconOnly size="sm" />
                <div className="min-w-0">
                  <div className="font-bold text-slate-900 text-[15px] leading-tight">
                    jurius<span className="text-orange-500">.com.br</span>
                  </div>
                  <div className="text-[10px] tracking-[0.18em] uppercase text-slate-400 font-bold mt-0.5">
                    Assinatura Eletrônica
                  </div>
                </div>
              </div>

              {/* Menu de versões */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 mb-3 px-1">
                  Versões dos Termos
                </p>
                <nav className="space-y-2">
                  {SIGNATURE_TERMS_ALL_VERSIONS.map((v) => {
                    const active = v.version === terms.version;
                    const current = v.version === SIGNATURE_TERMS_VERSION;
                    return (
                      <a
                        key={v.version}
                        href={`#/termos-assinatura/${v.version}`}
                        className={`group relative block rounded-xl border px-4 py-3 transition-all ${
                          active
                            ? 'bg-white border-orange-200 shadow-sm'
                            : 'bg-white/50 border-transparent hover:bg-white hover:border-[#e7e5df]'
                        }`}
                      >
                        {/* Acento lateral quando ativa */}
                        <span
                          className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-7 rounded-full transition-opacity ${
                            active ? 'opacity-100' : 'opacity-0'
                          }`}
                          style={{ background: 'linear-gradient(180deg,#fb923c,#ea580c)' }}
                        />
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-sm font-bold ${active ? 'text-orange-700' : 'text-slate-700'}`}>
                            Versão {v.version}
                          </span>
                          {current && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold">
                              <Check className="w-3 h-3" />
                              Atual
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-[11px] text-slate-400 mt-1">
                          <Clock className="w-3 h-3" />
                          {formatDate(v.publishedAt)}
                        </div>
                      </a>
                    );
                  })}
                </nav>
              </div>

              {/* Selo de confiança */}
              <div className="rounded-xl border border-[#e7e5df] bg-white/70 px-4 py-3 flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-orange-600 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Documento de referência pública. Cada assinatura registra a versão exata aceita pelo signatário.
                </p>
              </div>
            </div>
          </aside>

          {/* ── CONTEÚDO ── */}
          <main className="flex-1 min-w-0">
            {/* Cabeçalho */}
            <div className="mb-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900 text-white text-[11px] font-bold">
                  Versão {terms.version}
                  {isCurrent && <Check className="w-3 h-3 text-emerald-400" />}
                </span>
                <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 font-medium">
                  <Clock className="w-3.5 h-3.5" />
                  Publicada em {formatDate(terms.publishedAt)}
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight mt-3 leading-tight">
                {terms.title}
              </h1>
            </div>

            {requestedUnknown && (
              <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                A versão solicitada não foi encontrada. Exibindo a versão atual ({SIGNATURE_TERMS_VERSION}).
              </div>
            )}

            {/* Card do conteúdo */}
            <div className="rounded-2xl border border-[#e7e5df] bg-white/85 backdrop-blur-sm shadow-sm">
              <div className="p-6 sm:p-9">
                {blocks.length > 0 ? (
                  <div>
                    {blocks.map((b, i) => {
                      if (b.type === 'h2') {
                        return (
                          <h2
                            key={i}
                            className="text-[15px] sm:text-base font-bold text-slate-900 tracking-tight mt-8 first:mt-0 mb-2.5"
                          >
                            {b.text}
                          </h2>
                        );
                      }
                      if (b.type === 'li') {
                        return (
                          <div key={i} className="flex gap-2.5 mb-1.5 pl-1">
                            <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0" />
                            <span className="text-[13.5px] text-slate-600 leading-relaxed">{b.text}</span>
                          </div>
                        );
                      }
                      return (
                        <p key={i} className="text-[13.5px] text-slate-600 leading-relaxed mb-3">
                          {b.text}
                        </p>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    O texto desta versão ainda será publicado.
                  </div>
                )}
              </div>
            </div>

            <p className="text-[11px] text-slate-400 text-center sm:text-left mt-6">
              Jurius · Assinatura Eletrônica — documento de referência pública dos Termos de Uso.
            </p>
          </main>
        </div>
      </div>
    </div>
  );
};

export default PublicSignatureTermsPage;
