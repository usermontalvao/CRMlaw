// O conteúdo do modal "Link de Preenchimento".
//
// São dois links, e a diferença entre eles importa:
//   - o de uso único vale 7 dias, serve a um preenchimento e nasce NOVO cada
//     vez que a janela abre. Reaproveitar um token já enviado colocaria dois
//     clientes no mesmo formulário;
//   - o permalink é fixo por modelo e existe para divulgação.
//
// Componente próprio para poder ser visto fora do login, na bancada
// `?docspreview=1`.
import React from 'react';
import { CheckCircle2, Copy } from 'lucide-react';

export type TemplateFillLinkKind = 'unique' | 'permanent';

export interface TemplateFillLinkPanelProps {
  uniqueLink: string;
  permanentLink: string;
  copiedKind: TemplateFillLinkKind | null;
  onCopy: (kind: TemplateFillLinkKind) => void;
}

const inputClass =
  'h-[34px] w-full flex-1 rounded border border-slate-300 bg-white px-3 font-mono text-[13px] text-slate-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white';

const TemplateFillLinkPanel: React.FC<TemplateFillLinkPanelProps> = ({
  uniqueLink,
  permanentLink,
  copiedKind,
  onCopy,
}) => (
  <>
    <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
      O cliente abre o link, preenche os dados e segue para a assinatura no final. Escolha qual mandar.
    </p>

    <div className="flex flex-col gap-3">
      {uniqueLink && (
        <div className="rounded-xl border-2 border-primary-300 bg-primary-50/60 p-4 dark:border-primary-500/50 dark:bg-primary-500/10">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-900 dark:text-zinc-100">Para um cliente</span>
            <span className="rounded-full bg-primary-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              recomendado
            </span>
          </div>
          <p className="mb-3 text-xs text-slate-600 dark:text-zinc-400">
            Vale por 7 dias e para um preenchimento. <strong>Toda vez que você abre esta janela sai um link novo</strong> —
            é o que impede duas pessoas de caírem no mesmo formulário.
          </p>
          <div className="flex flex-col gap-2 @sm:flex-row">
            <input type="text" readOnly value={uniqueLink} onFocus={(e) => e.currentTarget.select()} className={inputClass} />
            <button
              type="button"
              onClick={() => onCopy('unique')}
              className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold shadow-sm ring-1 ring-inset transition sm:w-auto ${
                copiedKind === 'unique'
                  ? 'bg-emerald-600 text-white ring-emerald-700 hover:bg-emerald-700'
                  : 'bg-primary-500 text-white ring-primary-600 hover:bg-primary-600'
              }`}
            >
              {copiedKind === 'unique' ? (
                <><CheckCircle2 className="h-4 w-4" />Copiado!</>
              ) : (
                <><Copy className="h-4 w-4" />Copiar</>
              )}
            </button>
          </div>
        </div>
      )}

      {permanentLink && (
        <div className="rounded-xl border border-[#e7e5df] bg-slate-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/60">
          <p className="mb-1 text-sm font-semibold text-slate-900 dark:text-zinc-100">Para divulgar</p>
          <p className="mb-3 text-xs text-slate-600 dark:text-zinc-400">
            Sempre o mesmo endereço, sem prazo. Serve para o site, a bio do Instagram ou um envio em massa — qualquer
            pessoa com o link preenche.
          </p>
          <div className="flex flex-col gap-2 @sm:flex-row">
            <input type="text" readOnly value={permanentLink} onFocus={(e) => e.currentTarget.select()} className={inputClass} />
            <button
              type="button"
              onClick={() => onCopy('permanent')}
              className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ring-1 ring-inset transition sm:w-auto ${
                copiedKind === 'permanent'
                  ? 'bg-emerald-600 text-white ring-emerald-700 hover:bg-emerald-700'
                  : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-100 dark:bg-zinc-800 dark:text-zinc-200 dark:ring-zinc-600 dark:hover:bg-zinc-700'
              }`}
            >
              {copiedKind === 'permanent' ? (
                <><CheckCircle2 className="h-4 w-4" />Copiado!</>
              ) : (
                <><Copy className="h-4 w-4" />Copiar</>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  </>
);

export default TemplateFillLinkPanel;
