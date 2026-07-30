/**
 * Bancada de ESTRESSE do editor de petições com as peças REAIS do app:
 * `SyncfusionEditor` + `PetitionRibbon` montados de verdade, mais o atalho
 * global Ctrl+B/I/U copiado do PetitionEditorModule.
 *
 * Entrada própria em /dev-ribbon-stress.html — fora do build de produção.
 *
 * A pergunta que ela responde: **o botão aceso na faixa corresponde ao formato
 * que o editor tem agora?** Depois de cada operação comparamos
 *
 *   `dom`   — a classe `is-active` do botão (o que o usuário vê);
 *   `cache` — `selection.characterFormat` (o que o Syncfusion diz agora).
 *
 * Divergência = faixa cega: o botão continua aceso sem seleção nenhuma, que é
 * o defeito relatado em produção. O roteiro tem uma parte determinística (as
 * sequências suspeitas, uma a uma) e uma rajada aleatória longa, que é onde os
 * travamentos de estado costumam aparecer.
 */
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import SyncfusionEditor, { type SyncfusionEditorRef } from '../components/SyncfusionEditor';
import PetitionRibbon from '../components/PetitionRibbon';

const PARAGRAPHS = [
  'Trata-se de recurso inominado interposto contra a sentenca que extinguiu o feito sem resolucao do merito.',
  'O patrono compareceu a audiencia e requereu prazo para esclarecimento da ausencia da parte autora.',
  'A aplicacao rigida do artigo 362 do CPC desconsidera as particularidades do caso concreto.',
  'Ainda que nao seja acolhido o pedido de anulacao, deve ser afastada a condenacao em custas processuais.',
  'O artigo 51 da Lei 9099 autoriza a isencao quando a ausencia decorrer de forca maior ou motivo justificavel.',
];

const SFDT = {
  sections: [
    {
      sectionFormat: { pageWidth: 612, pageHeight: 792, leftMargin: 72, rightMargin: 72, topMargin: 72, bottomMargin: 72 },
      blocks: [
        {
          paragraphFormat: { textAlignment: 'Center' },
          inlines: [
            {
              characterFormat: { bold: true, underline: 'Single', fontSize: 12, fontFamily: 'Arial' },
              text: 'EXCELENTISSIMO SENHOR DOUTOR JUIZ DE DIREITO',
            },
          ],
        },
        ...PARAGRAPHS.map((text) => ({
          paragraphFormat: { textAlignment: 'Justify', firstLineIndent: 36 },
          inlines: [{ characterFormat: { fontSize: 12, fontFamily: 'Arial' }, text }],
        })),
      ],
    },
  ],
};

type Marks = { bold: boolean; italic: boolean; underline: boolean; strikethrough: boolean };

const show = (m: Marks) => [m.bold ? 'N' : '-', m.italic ? 'I' : '-', m.underline ? 'S' : '-', m.strikethrough ? 'T' : '-'].join('');
const same = (a: Marks, b: Marks) =>
  a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.strikethrough === b.strikethrough;

/** O que o usuário vê: classe `is-active` dos botões da faixa. */
const domMarks = (): Marks => {
  const on = (title: string) => {
    const el = document.querySelector<HTMLElement>(`.pet-iconbtn[title="${title}"]`);
    return !!el?.classList.contains('is-active');
  };
  return { bold: on('Negrito'), italic: on('Itálico'), underline: on('Sublinhado'), strikethrough: on('Tachado') };
};

/** O que o Syncfusion diz agora, sem forçar releitura. */
const cacheMarks = (editor: any): Marks => {
  const cf = editor?.selection?.characterFormat || {};
  return {
    bold: !!cf.bold,
    italic: !!cf.italic,
    underline: !!cf.underline && cf.underline !== 'None',
    strikethrough: !!cf.strikethrough && cf.strikethrough !== 'None',
  };
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Row = {
  passo: string;
  dom: string;
  cache: string;
  divergente: boolean;
  travas: string;
  eventos: number;
};

const Harness: React.FC = () => {
  const editorRef = useRef<SyncfusionEditorRef | null>(null);
  const [ready, setReady] = useState(false);
  const [log, setLog] = useState<string>('aguardando o editor…');
  const startedRef = useRef(false);

  // Mesmo atalho global do PetitionEditorModule (Ctrl+B / Ctrl+I / Ctrl+U).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const dentro = Boolean(target?.closest('.e-de-ctn')) || Boolean(target?.closest('.e-documenteditorcontainer'));
      if (!dentro) return;
      const sync = editorRef.current?.getEditor?.() as any;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        const key = e.key.toLowerCase();
        if (key === 'b') { e.preventDefault(); sync?.editor?.toggleBold?.(); editorRef.current?.focus?.(); }
        if (key === 'i') { e.preventDefault(); sync?.editor?.toggleItalic?.(); editorRef.current?.focus?.(); }
        if (key === 'u') { e.preventDefault(); sync?.editor?.toggleUnderline?.(); editorRef.current?.focus?.(); }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!ready || startedRef.current) return;
    startedRef.current = true;
    // Exposto de propósito: dá para sondar cada hipótese no console sem
    // reescrever o roteiro a cada pergunta nova.
    (window as any).__ref = editorRef;
    void run(editorRef, setLog);
  }, [ready]);

  return (
    <div style={{ position: 'absolute', inset: '0 0 240px 0', display: 'flex', flexDirection: 'column' }}>
      <PetitionRibbon editorRef={editorRef} ready={ready} entityLabel="bancada" />
      <div style={{ flex: 1, minHeight: 0 }}>
        <SyncfusionEditor
          ref={editorRef}
          enableToolbar={false}
          showPropertiesPane={false}
          showRuler={false}
          onReady={() => setReady(true)}
        />
      </div>
      <pre
        id="out"
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, height: 240, margin: 0, padding: '10px 14px',
          overflow: 'auto', background: '#0f172a', color: '#e2e8f0', fontSize: 12, whiteSpace: 'pre-wrap', zIndex: 99,
        }}
      >
        {log}
      </pre>
    </div>
  );
};

/* ------------------------------------------------------------- roteiro ---- */

const run = async (
  editorRef: React.RefObject<SyncfusionEditorRef | null>,
  setLog: (s: string) => void,
) => {
  const rows: Row[] = [];
  const erros: string[] = [];
  const ed = (): any => editorRef.current?.getEditor?.();

  let eventos = 0;
  const unsubscribe = editorRef.current?.addSelectionChangeListener?.(() => { eventos += 1; });

  editorRef.current?.loadSfdt?.(JSON.stringify(SFDT));
  await sleep(900);

  const at = (p: number, o: number) => `0;${p};${o}`;
  const caret = (p: number, o: number) => ed()?.selection?.select(at(p, o), at(p, o));
  const range = (p: number, a: number, b: number) => ed()?.selection?.select(at(p, a), at(p, b));
  const clickRibbon = (title: string) => {
    const el = document.querySelector<HTMLElement>(`.pet-iconbtn[title="${title}"]`);
    if (!el) throw new Error(`botão "${title}" não encontrado na faixa`);
    el.click();
  };
  const typeKey = (key: string, ctrl = false) => {
    const host = document.querySelector<HTMLElement>('.e-de-ctn') || document.body;
    host.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: ctrl, bubbles: true, cancelable: true }));
  };

  const step = async (passo: string, fn: () => void | Promise<void>, espera = 60) => {
    const antes = eventos;
    try {
      await fn();
    } catch (error) {
      erros.push(`${passo}: ${String((error as Error)?.message || error)}`);
    }
    await sleep(espera);
    const dom = domMarks();
    const cache = cacheMarks(ed());
    const sel = ed()?.selection;
    const travas = [
      sel?.isModifyingSelectionInternally ? 'modificando' : '',
      sel?.skipFormatRetrieval ? 'formato-congelado' : '',
    ].filter(Boolean).join(',');
    rows.push({ passo, dom: show(dom), cache: show(cache), divergente: !same(dom, cache), travas, eventos: eventos - antes });
    return rows[rows.length - 1];
  };

  /* 1) sequências determinísticas — uma suspeita por passo */
  await step('cursor em texto normal', () => caret(2, 5));
  await step('seleciona trecho e clica em Negrito na faixa', () => { range(2, 5, 25); clickRibbon('Negrito'); });
  await step('clica em outro paragrafo (sem selecao)', () => caret(3, 10));
  await step('seleciona e clica em Sublinhado', () => { range(3, 5, 20); clickRibbon('Sublinhado'); });
  await step('colapsa o cursor em texto limpo', () => caret(4, 10));
  await step('Ctrl+B com cursor colapsado', () => { caret(4, 20); typeKey('b', true); });
  await step('move o cursor depois do Ctrl+B pendente', () => caret(5, 10));
  await step('clica em Tachado com o cursor colapsado', () => clickRibbon('Tachado'));
  await step('move o cursor depois do Tachado pendente', () => caret(2, 40));
  await step('Negrito ligado e desligado em sequencia', () => { range(4, 5, 15); clickRibbon('Negrito'); clickRibbon('Negrito'); });
  await step('undo apos as marcacoes', () => ed()?.editorHistory?.undo?.());
  await step('redo', () => ed()?.editorHistory?.redo?.());
  await step('seleciona o cabecalho (negrito+sublinhado reais)', () => ed()?.selection?.select('0;0;0', '0;0;20'));
  await step('volta para paragrafo limpo', () => caret(5, 30));
  await step('getText (selectAll + moveToDocumentStart, igual a IA)', () => { editorRef.current?.getText?.(); });
  await step('restaura selecao apos o getText', () => range(2, 5, 25));
  await step('foco de volta no editor', () => editorRef.current?.focus?.());
  await step('cursor em paragrafo limpo depois do foco', () => caret(5, 12));

  /* 2) rajada aleatória — o "fluxo intenso" */
  const acoes = ['negrito', 'italico', 'sublinhado', 'tachado', 'selecionar', 'cursor', 'digitar', 'undo', 'redo'] as const;
  let semente = 20260730;
  const rnd = () => {
    semente = (semente * 1103515245 + 12345) % 2147483648;
    return semente / 2147483648;
  };
  let divergenciasNaRajada = 0;
  let primeiraDivergencia = '';
  for (let i = 0; i < 240; i++) {
    const acao = acoes[Math.floor(rnd() * acoes.length)];
    const p = 1 + Math.floor(rnd() * 5);
    const a = Math.floor(rnd() * 30);
    try {
      if (acao === 'negrito') clickRibbon('Negrito');
      else if (acao === 'italico') clickRibbon('Itálico');
      else if (acao === 'sublinhado') clickRibbon('Sublinhado');
      else if (acao === 'tachado') clickRibbon('Tachado');
      else if (acao === 'selecionar') range(p, a, a + 8);
      else if (acao === 'cursor') caret(p, a);
      else if (acao === 'digitar') ed()?.editor?.insertText?.('x');
      else if (acao === 'undo') ed()?.editorHistory?.undo?.();
      else if (acao === 'redo') ed()?.editorHistory?.redo?.();
    } catch (error) {
      erros.push(`rajada[${i}] ${acao}: ${String((error as Error)?.message || error)}`);
    }
    if (i % 10 === 0) await sleep(0);
    if (i % 20 === 0) {
      await sleep(40);
      if (!same(domMarks(), cacheMarks(ed()))) {
        divergenciasNaRajada += 1;
        if (!primeiraDivergencia) primeiraDivergencia = `rajada[${i}] ${acao}: dom=${show(domMarks())} cache=${show(cacheMarks(ed()))}`;
      }
    }
  }
  await sleep(120);

  /* 3) a faixa continua viva depois da rajada? */
  await step('APOS RAJADA: cursor em paragrafo limpo', () => caret(5, 40), 120);
  await step('APOS RAJADA: seleciona trecho limpo', () => range(5, 10, 20), 120);
  await step('APOS RAJADA: cursor colapsado de novo', () => caret(3, 3), 120);

  unsubscribe?.();

  const quebras = rows.filter((r) => r.divergente);
  const linhas = rows.map((r) => `${r.divergente ? '✗' : ' '} ${r.passo.padEnd(52)} dom=${r.dom} cache=${r.cache} ev=${r.eventos}${r.travas ? ` [${r.travas}]` : ''}`);
  setLog([
    `passos: ${rows.length} | divergentes: ${quebras.length} | divergencias na rajada: ${divergenciasNaRajada}`,
    primeiraDivergencia ? `primeira na rajada: ${primeiraDivergencia}` : '',
    erros.length ? `erros: ${erros.length}\n${erros.slice(0, 8).map((e) => `  - ${e}`).join('\n')}` : '',
    '',
    ...linhas,
  ].filter(Boolean).join('\n'));

  (window as any).__stress = { rows, erros, divergenciasNaRajada, primeiraDivergencia };
  (window as any).__fase = 'concluido';
};

const host = document.getElementById('host');
if (host) createRoot(host).render(<Harness />);
