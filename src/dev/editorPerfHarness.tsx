/**
 * Bancada de DESEMPENHO do editor de petições — as peças REAIS (`SyncfusionEditor`),
 * sem CRM em volta e sem login. Entrada própria em /dev-editor-perf.html.
 *
 * As duas perguntas que ela responde:
 *
 *   1) **Por que travar ao digitar em documento grande?** Mede o tempo que o
 *      navegador passa BLOQUEADO (long tasks) durante uma rajada de teclas,
 *      e cronometra separadamente cada peça que roda no `contentChange`.
 *
 *   2) **Por que a colagem de conteúdo grande fica eternamente carregando?**
 *      Dispara um evento de `paste` REAL (ClipboardEvent + DataTransfer) no
 *      alvo de input do Syncfusion e cronometra até a tela voltar, olhando
 *      também o spinner (`.e-spinner-pane`) que o Syncfusion levanta.
 *
 * Nada aqui entra no build de produção (o input do Vite só tem index + PWA_APPS).
 */
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import SyncfusionEditor, { type SyncfusionEditorRef } from '../components/SyncfusionEditor';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const PARAGRAFO =
  'Trata-se de recurso inominado interposto contra a sentenca que extinguiu o feito sem resolucao do merito, '
  + 'ao argumento de que a ausencia da parte autora a audiencia de instrucao configuraria abandono da causa, '
  + 'sem que fosse considerada a justificativa apresentada nos autos pelo patrono constituido.';

/** Documento grande de mentira, com o tamanho de uma peça real. */
const bigSfdt = (paragrafos: number) => JSON.stringify({
  sections: [
    {
      sectionFormat: { pageWidth: 612, pageHeight: 792, leftMargin: 72, rightMargin: 72, topMargin: 72, bottomMargin: 72 },
      blocks: Array.from({ length: paragrafos }, (_, i) => ({
        paragraphFormat: { textAlignment: 'Justify', firstLineIndent: 36 },
        inlines: [{ characterFormat: { fontSize: 12, fontFamily: 'Arial' }, text: `${i + 1}. ${PARAGRAFO}` }],
      })),
    },
  ],
});

/** HTML de colagem externa, no formato que o Word/Chrome colocam na área de transferência. */
const bigHtml = (paragrafos: number) =>
  `<html xmlns:o="urn:schemas-microsoft-com:office:office"><body>${
    Array.from({ length: paragrafos }, (_, i) =>
      `<p style="font-family:Arial;font-size:12pt;margin:0cm"><span style="mso-fareast-font-family:Times">${i + 1}. ${PARAGRAFO}</span></p>`).join('')
  }</body></html>`;

const bigText = (paragrafos: number) =>
  Array.from({ length: paragrafos }, (_, i) => `${i + 1}. ${PARAGRAFO}`).join('\n');

/* ------------------------------------------------- medidor de bloqueio ---- */

type Blocking = { total: number; maior: number; tarefas: number };

/**
 * Quanto tempo o navegador ficou SEM poder responder ao usuário.
 * `longtask` = qualquer tarefa acima de 50ms na thread principal.
 */
const medirBloqueio = async (fn: () => void | Promise<void>): Promise<{ ms: number; block: Blocking }> => {
  const block: Blocking = { total: 0, maior: 0, tarefas: 0 };
  let observer: PerformanceObserver | null = null;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        block.tarefas += 1;
        block.total += entry.duration;
        block.maior = Math.max(block.maior, entry.duration);
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch {
    observer = null;
  }

  const t0 = performance.now();
  await fn();
  const ms = performance.now() - t0;
  // Dá um respiro para o observer entregar as últimas entradas.
  await sleep(400);
  observer?.disconnect();
  return { ms, block };
};

const fmt = (n: number) => `${Math.round(n)}ms`;
const fmtBlock = (b: Blocking) => `bloqueio ${fmt(b.total)} em ${b.tarefas} tarefa(s), pior ${fmt(b.maior)}`;

/* -------------------------------------------------------------- paste ----- */

const editableDivDe = (editor: any): HTMLElement | null =>
  editor?.documentHelper?.editableDiv ?? null;

const spinnerVisivel = (): boolean =>
  Array.from(document.querySelectorAll<HTMLElement>('.e-spinner-pane'))
    .some((el) => getComputedStyle(el).display !== 'none' && el.offsetParent !== null);

/** Colagem de verdade: o mesmo evento que o navegador entrega no Ctrl+V. */
const dispararPaste = (alvo: HTMLElement, dados: { html?: string; text?: string; rtf?: string }) => {
  const dt = new DataTransfer();
  if (dados.text) dt.setData('text/plain', dados.text);
  if (dados.html) dt.setData('text/html', dados.html);
  if (dados.rtf) {
    try { dt.setData('text/rtf', dados.rtf); } catch { /* alguns navegadores recusam o tipo */ }
  }
  const evento = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  alvo.dispatchEvent(evento);
};

/* --------------------------------------------------------------- tela ----- */

const Harness: React.FC = () => {
  const editorRef = useRef<SyncfusionEditorRef | null>(null);
  const [ready, setReady] = useState(false);
  const [log, setLog] = useState('aguardando o editor…');
  const contentChanges = useRef(0);

  useEffect(() => {
    if (!ready) return;
    (window as any).__ref = editorRef;
    (window as any).__bigHtml = bigHtml;
    (window as any).__bigText = bigText;
    void roteiro(editorRef, setLog, contentChanges);
  }, [ready]);

  return (
    <div style={{ position: 'absolute', inset: '0 0 300px 0' }}>
      <SyncfusionEditor
        ref={editorRef}
        enableToolbar={false}
        showPropertiesPane={false}
        showRuler={false}
        onReady={() => setReady(true)}
        onContentChange={() => { contentChanges.current += 1; }}
      />
      <pre
        id="out"
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, height: 300, margin: 0, padding: '10px 14px',
          overflow: 'auto', background: '#0f172a', color: '#e2e8f0', fontSize: 12, whiteSpace: 'pre-wrap', zIndex: 99,
        }}
      >
        {log}
      </pre>
    </div>
  );
};

/* ------------------------------------------------------------- roteiro ---- */

const roteiro = async (
  editorRef: React.RefObject<SyncfusionEditorRef | null>,
  setLog: (s: string) => void,
  contentChanges: React.MutableRefObject<number>,
) => {
  const linhas: string[] = [];
  const diz = (s: string) => { linhas.push(s); setLog(linhas.join('\n')); };
  const ed = (): any => editorRef.current?.getEditor?.();

  const PARAGRAFOS = Number(new URLSearchParams(location.search).get('p') || 600);
  const COLAGEM = Number(new URLSearchParams(location.search).get('c') || 400);

  diz(`documento de ${PARAGRAFOS} parágrafos; colagem de ${COLAGEM} parágrafos`);

  /* 1) abrir o documento grande */
  const abrir = await medirBloqueio(async () => {
    editorRef.current?.loadSfdt?.(bigSfdt(PARAGRAFOS));
    await sleep(4000);
  });
  const paginas = ed()?.pageCount;
  diz(`\n[1] abrir documento: ${fmt(abrir.ms)} — ${paginas} páginas`);

  /* 2) quanto custa CADA peça que roda no contentChange */
  const serial = await medirBloqueio(async () => { ed()?.serialize?.(); });
  const sfdt = ed()?.serialize?.() || '';
  diz(`\n[2] peças do contentChange (documento de ${paginas} páginas):`);
  diz(`    editor.serialize()          ${fmt(serial.ms)}  → ${(sfdt.length / 1024).toFixed(0)} KB de SFDT`);

  const parse = await medirBloqueio(async () => { JSON.parse(sfdt); });
  diz(`    JSON.parse do SFDT          ${fmt(parse.ms)}`);

  // Mesma travessia do editor-issues-scanner (extractTextFromSfdt).
  const parsed = JSON.parse(sfdt);
  const extrai = (node: any): string => {
    if (!node) return '';
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(extrai).join('');
    if (typeof node === 'object') {
      let out = '';
      if (typeof node.tlp === 'string') out += node.tlp;
      else if (typeof node.text === 'string') out += node.text;
      for (const key of Object.keys(node)) {
        if (key === 'tlp' || key === 'text') continue;
        out += extrai(node[key]);
      }
      return out;
    }
    return '';
  };
  const walk = await medirBloqueio(async () => { extrai(parsed); });
  diz(`    travessia do scanner        ${fmt(walk.ms)}`);
  diz(`    → TOTAL por rajada de teclas: ${fmt(serial.ms + parse.ms + walk.ms)} (roda 1,5s após parar de digitar)`);

  const wc = await medirBloqueio(async () => { editorRef.current?.getWordCount?.(); });
  diz(`    getWordCount()              ${fmt(wc.ms)} (roda 900ms após parar de digitar)`);

  /* 3) digitar de verdade */
  ed()?.selection?.select?.('0;3;0', '0;3;0');
  editorRef.current?.focus?.();
  await sleep(200);
  const antes = contentChanges.current;
  const digitar = await medirBloqueio(async () => {
    const editor = ed();
    for (let i = 0; i < 30; i++) {
      editor?.editor?.insertText?.('a');
      await sleep(30);
    }
    // O tempo de travamento aparece DEPOIS: os debounces de 900ms e 1500ms.
    await sleep(2500);
  });
  diz(`\n[3] digitar 30 caracteres + esperar os debounces: ${fmt(digitar.ms)}`);
  diz(`    ${fmtBlock(digitar.block)} — ${contentChanges.current - antes} contentChange`);

  /* 4) colar conteúdo grande de fora */
  const alvo = editableDivDe(ed());
  if (!alvo) {
    diz('\n[4] colagem: alvo de input do Syncfusion não encontrado — pulei');
    return;
  }

  const html = bigHtml(COLAGEM);
  const texto = bigText(COLAGEM);
  diz(`\n[4] colando ${(html.length / 1024).toFixed(0)} KB de HTML (com marcas do Word) …`);

  let spinnerSubiu = false;
  const vigia = window.setInterval(() => { if (spinnerVisivel()) spinnerSubiu = true; }, 100);

  const paginasAntes = ed()?.pageCount;
  const colar = await medirBloqueio(async () => {
    dispararPaste(alvo, { html, text: texto });
    // Espera o documento crescer (ou desistir depois de 120s).
    const limite = performance.now() + 120000;
    while (performance.now() < limite) {
      await sleep(250);
      if ((ed()?.pageCount || 0) > (paginasAntes || 0)) break;
    }
  });
  window.clearInterval(vigia);

  diz(`    tempo até a colagem aparecer: ${fmt(colar.ms)}`);
  diz(`    ${fmtBlock(colar.block)}`);
  diz(`    páginas: ${paginasAntes} → ${ed()?.pageCount}`);
  diz(`    spinner do Syncfusion apareceu: ${spinnerSubiu ? 'SIM' : 'não'} | ainda na tela agora: ${spinnerVisivel() ? 'SIM (travado)' : 'não'}`);

  await sleep(3000);
  diz(`    spinner 3s depois: ${spinnerVisivel() ? 'AINDA NA TELA' : 'saiu'}`);
  diz('\nfim.');
};

createRoot(document.getElementById('host')!).render(<Harness />);
