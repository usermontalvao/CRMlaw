// A folha ao vivo da tela de gerar documento.
//
// Antes o preenchimento era às cegas: você digitava COMARCA e FINALIDADE sem
// ver onde caíam, e só descobria o resultado no Word já baixado.
//
// COMO ESTA PRÉVIA É FEITA (e por que não é uma leitura de texto):
//
//  1. cada arquivo do kit passa pelo MESMO docxtemplater da geração, com os
//     mesmos delimitadores `[[ ]]`. O que muda é só o valor entregue: ele vai
//     cercado por marcadores invisíveis, para dar cor depois;
//  2. o .docx resultante é desenhado por `docx-preview` — o motor de reserva
//     que a conversão em PDF já usa. É ele que preserva negrito, centralização,
//     tabela, margem e tamanho de folha;
//  3. um passeio pelos nós de texto troca os marcadores por marcações
//     coloridas: azul para o que veio da ficha, laranja para o que falta.
//
// O kit inteiro aparece — principal e anexos, na ordem em que são gerados —,
// porque conferir só o primeiro documento não diz nada sobre os outros cinco.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { renderAsync } from 'docx-preview';
import { AlertTriangle, FileText, Loader2 } from 'lucide-react';

/** Largura de uma folha A4 no CSS do docx-preview, usada para calcular a escala. */
const LARGURA_DA_FOLHA_PX = 794;

// Sentinelas invisíveis. Sobrevivem ao docxtemplater e ao docx-preview porque
// são só texto, e não aparecem para quem lê caso alguma escape da marcação.
const MARCA_PREENCHIDO = '⁣';
const MARCA_VAZIO = '⁢';
const MARCA_ASSINATURA = '⁡';

const CAMPO_DE_ASSINATURA = /^ASSINATURA(_\d+)?$/i;

export interface PreviewDocument {
  id: string;
  name: string;
  blob: Blob;
  /** `principal` sai primeiro; os anexos seguem a ordem do kit. */
  role: 'principal' | 'anexo';
}

export interface DocumentLivePreviewProps {
  documents: PreviewDocument[];
  /** Devolve o valor de um campo, ou vazio quando ele não foi preenchido. */
  resolve: (key: string) => string;
  loading?: boolean;
  error?: string | null;
}

/**
 * Preenche um .docx com os mesmos valores da geração, cercando cada campo por
 * marcadores. Devolve o arquivo pronto para ser desenhado.
 */
const preencherParaPrevia = (data: ArrayBuffer, resolve: (key: string) => string): Blob => {
  const zip = new PizZip(data);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '[[', end: ']]' },
    // Todo campo passa por aqui: o docxtemplater chama o getter para cada
    // marcador, e o `parser` devolve sempre um valor nosso.
    parser: (tag: string) => ({
      get: () => {
        const chave = (tag || '').trim();
        if (CAMPO_DE_ASSINATURA.test(chave)) return `${MARCA_ASSINATURA}${chave}${MARCA_ASSINATURA}`;
        const valor = resolve(chave);
        return valor
          ? `${MARCA_PREENCHIDO}${valor}${MARCA_PREENCHIDO}`
          : `${MARCA_VAZIO}${chave}${MARCA_VAZIO}`;
      },
    }),
    nullGetter: () => '',
  });

  doc.render({});
  return doc.getZip().generate({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
};

/** Troca os marcadores por marcações coloridas. Devolve quantos campos faltam. */
const colorirMarcadores = (raiz: HTMLElement): number => {
  const pendentes = new Set<string>();
  const walker = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
  const alvos: Text[] = [];

  let atual = walker.nextNode();
  while (atual) {
    const texto = atual.textContent || '';
    if (texto.includes(MARCA_PREENCHIDO) || texto.includes(MARCA_VAZIO) || texto.includes(MARCA_ASSINATURA)) {
      alvos.push(atual as Text);
    }
    atual = walker.nextNode();
  }

  for (const no of alvos) {
    const texto = no.textContent || '';
    const partes = texto.split(
      new RegExp(`(${MARCA_PREENCHIDO}[^${MARCA_PREENCHIDO}]*${MARCA_PREENCHIDO}|${MARCA_VAZIO}[^${MARCA_VAZIO}]*${MARCA_VAZIO}|${MARCA_ASSINATURA}[^${MARCA_ASSINATURA}]*${MARCA_ASSINATURA})`),
    );
    if (partes.length === 1) continue;

    const fragmento = document.createDocumentFragment();
    for (const parte of partes) {
      if (!parte) continue;

      const marca = parte[0];
      const dentro = parte.slice(1, -1);

      if (marca === MARCA_PREENCHIDO && parte.endsWith(MARCA_PREENCHIDO) && parte.length > 1) {
        const span = document.createElement('span');
        span.className = 'dlp-fill';
        span.textContent = dentro;
        fragmento.appendChild(span);
        continue;
      }
      if (marca === MARCA_VAZIO && parte.endsWith(MARCA_VAZIO) && parte.length > 1) {
        pendentes.add(dentro.toUpperCase());
        const span = document.createElement('span');
        span.className = 'dlp-hole';
        span.textContent = dentro;
        fragmento.appendChild(span);
        continue;
      }
      if (marca === MARCA_ASSINATURA && parte.endsWith(MARCA_ASSINATURA) && parte.length > 1) {
        const span = document.createElement('span');
        span.className = 'dlp-sign';
        span.textContent = 'assinatura';
        fragmento.appendChild(span);
        continue;
      }

      // Marcador solto (o Word partiu o texto no meio): mostra sem os sentinelas.
      fragmento.appendChild(
        document.createTextNode(
          parte.split(MARCA_PREENCHIDO).join('').split(MARCA_VAZIO).join('').split(MARCA_ASSINATURA).join(''),
        ),
      );
    }
    no.parentNode?.replaceChild(fragmento, no);
  }

  return pendentes.size;
};

const DocumentLivePreview: React.FC<DocumentLivePreviewProps> = ({
  documents,
  resolve,
  loading = false,
  error = null,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const paginasRef = useRef<HTMLDivElement>(null);
  const [escala, setEscala] = useState(1);
  const [desenhando, setDesenhando] = useState(false);
  const [faltando, setFaltando] = useState(0);
  const [falha, setFalha] = useState<string | null>(null);
  const [alturaDesenhada, setAlturaDesenhada] = useState(0);

  const desenhar = useCallback(async () => {
    const alvo = paginasRef.current;
    if (!alvo) return;

    if (documents.length === 0) {
      alvo.innerHTML = '';
      setFaltando(0);
      setAlturaDesenhada(0);
      return;
    }

    setDesenhando(true);
    setFalha(null);
    try {
      const fora = document.createElement('div');
      let pendentes = 0;

      for (const documento of documents) {
        const rotulo = document.createElement('p');
        rotulo.className = 'dlp-label';
        rotulo.textContent = documento.role === 'principal' ? documento.name : `Anexo · ${documento.name}`;
        fora.appendChild(rotulo);

        const caixa = document.createElement('div');
        fora.appendChild(caixa);

        try {
          const preenchido = preencherParaPrevia(await documento.blob.arrayBuffer(), resolve);
          await renderAsync(preenchido, caixa, undefined, {
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            breakPages: true,
            renderHeaders: true,
            renderFooters: true,
            experimental: true,
          });
          pendentes += colorirMarcadores(caixa);
        } catch (err) {
          console.warn(`Prévia falhou em ${documento.name}:`, err);
          const aviso = document.createElement('p');
          aviso.className = 'dlp-warn';
          aviso.textContent = 'Não foi possível desenhar este arquivo. Ele continua sendo gerado normalmente.';
          caixa.appendChild(aviso);
        }
      }

      alvo.innerHTML = '';
      while (fora.firstChild) alvo.appendChild(fora.firstChild);
      setFaltando(pendentes);
      setAlturaDesenhada(alvo.scrollHeight);
    } catch (err) {
      console.warn('Prévia ao vivo falhou:', err);
      setFalha('Não foi possível montar a prévia deste modelo.');
    } finally {
      setDesenhando(false);
    }
  }, [documents, resolve]);

  // Espera curta para não redesenhar o kit inteiro a cada tecla. `desenhar`
  // muda de identidade quando os arquivos ou os valores mudam — é o que
  // dispara o redesenho.
  useEffect(() => {
    const t = setTimeout(() => { void desenhar(); }, 350);
    return () => clearTimeout(t);
  }, [desenhar]);

  // A folha tem largura fixa de papel; a coluna, não. A escala encaixa uma na
  // outra sem cortar nada.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const medir = () => {
      const disponivel = host.clientWidth - 24;
      setEscala(Math.min(1, Math.max(0.35, disponivel / LARGURA_DA_FOLHA_PX)));
      setAlturaDesenhada(paginasRef.current?.scrollHeight ?? 0);
    };

    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(host);
    return () => observador.disconnect();
  }, [documents.length]);

  const vazio = documents.length === 0;
  const problema = error || falha;

  return (
    <div className="flex h-full flex-col gap-3">
      <style>{`
        .dlp-fill { background: #e0f0ff; border-bottom: 1px solid #93c5fd; border-radius: 2px; padding: 0 1px; }
        .dlp-hole {
          background: #ffedd5; border-bottom: 2px solid #f97316; border-radius: 2px;
          padding: 0 3px; color: #9a3412; font-weight: 600;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: .82em;
        }
        .dlp-sign {
          border: 1px dashed #cbd5e1; border-radius: 4px; padding: 0 6px; color: #94a3b8;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: .72em; font-weight: 600; text-transform: uppercase; letter-spacing: .04em;
        }
        .dlp-label {
          margin: 14px 0 6px; font-size: 11px; font-weight: 700; letter-spacing: .06em;
          text-transform: uppercase; color: #94a3b8;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .dlp-label:first-child { margin-top: 0 }
        .dlp-warn {
          padding: 12px; border-radius: 8px; background: #fff7ed; color: #9a3412; font-size: 12px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        /* O docx-preview desenha a folha com sombra própria; aqui ela só encolhe. */
        .dlp-pages .docx-wrapper { background: transparent; padding: 0; gap: 12px; }
        .dlp-pages .docx-wrapper > section.docx { margin: 0 0 12px; box-shadow: 0 2px 10px -4px rgba(15,23,42,.35); }
      `}</style>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-slate-400 dark:text-zinc-500" />
          <h4 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">Prévia do documento</h4>
          {documents.length > 1 && (
            <span className="text-xs text-slate-400 dark:text-zinc-500">
              {documents.length} arquivos
            </span>
          )}
        </div>
        {!loading && !desenhando && !problema && !vazio && (
          faltando > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-2.5 py-1 text-[11px] font-semibold text-primary-800 dark:border-primary-500/40 dark:bg-primary-500/10 dark:text-primary-300">
              <AlertTriangle className="h-3 w-3" />
              {faltando === 1 ? 'falta 1 campo' : `faltam ${faltando} campos`}
            </span>
          ) : (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-400">
              tudo preenchido
            </span>
          )
        )}
      </div>

      <div
        ref={hostRef}
        className="relative min-h-[300px] flex-1 overflow-y-auto rounded-xl border border-[#e7e5df] bg-slate-100/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/40 @lg:max-h-[620px]"
      >
        {(loading || desenhando) && (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-slate-100/80 text-sm text-slate-500 backdrop-blur-[1px] dark:bg-zinc-950/70 dark:text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            {loading ? 'Carregando os arquivos...' : 'Desenhando a folha...'}
          </div>
        )}

        {problema ? (
          <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-2 px-6 text-center">
            <AlertTriangle className="h-6 w-6 text-slate-300 dark:text-zinc-600" />
            <p className="text-sm text-slate-500 dark:text-zinc-400">{problema}</p>
            <p className="text-xs text-slate-400 dark:text-zinc-500">
              O documento continua sendo gerado normalmente — só a prévia não pôde ser montada.
            </p>
          </div>
        ) : vazio && !loading ? (
          <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-2 px-6 text-center">
            <FileText className="h-7 w-7 text-slate-300 dark:text-zinc-600" />
            <p className="text-sm text-slate-500 dark:text-zinc-400">Escolha um modelo para ver a folha</p>
          </div>
        ) : null}

        <div style={{ height: alturaDesenhada ? alturaDesenhada * escala : undefined }}>
          <div
            ref={paginasRef}
            className="dlp-pages origin-top-left"
            style={{ width: LARGURA_DA_FOLHA_PX, transform: `scale(${escala})` }}
          />
        </div>
      </div>

      {!problema && !vazio && (
        <p className="text-[11px] leading-snug text-slate-400 dark:text-zinc-500">
          <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-sky-200 align-middle" /> veio da ficha ou dos campos ·
          <span className="mx-1 inline-block h-2 w-2 rounded-sm bg-primary-400 align-middle" /> ainda em branco. A folha é
          desenhada a partir do próprio .docx, com a formatação do Word.
        </p>
      )}
    </div>
  );
};

export default DocumentLivePreview;
