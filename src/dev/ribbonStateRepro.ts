/**
 * Bancada isolada para o ESTADO DA FAIXA DE OPÇÕES (negrito/itálico/sublinhado/
 * tachado) durante edição intensa.
 *
 * Não faz parte do app (entrada própria em /dev-ribbon-state.html, fora do build
 * de produção). Monta o DocumentEditor com a MESMA configuração do editor de
 * petições, instala o MESMO despachante de `selectionChange` do SyncfusionEditor
 * e a MESMA leitura de formato do PetitionRibbon (`syncFmt`).
 *
 * O que ela mede, passo a passo de um roteiro de estresse:
 *
 *  - `eventos`  — quantas vezes o `selectionChange` chegou ao assinante. Zero
 *                 depois de uma operação que mexe na seleção = faixa cega.
 *  - `faixa`    — o que a faixa mostraria (estado React espelhado aqui).
 *  - `verdade`  — o formato REAL do ponto de inserção, obtido forçando
 *                 `selection.retrieveCurrentFormatProperties()` na hora.
 *  - `travas`   — `isModifyingSelectionInternally` / `skipFormatRetrieval`, os
 *                 dois sinalizadores internos do Syncfusion que, se ficarem
 *                 ligados, congelam o formato (e o evento) até recarregar a
 *                 página — exatamente o sintoma relatado.
 *
 * Divergência entre `faixa` e `verdade` é o bug: o botão fica aceso sem seleção.
 */
import '../styles/syncfusion-editor.css';
import { registerLicense } from '@syncfusion/ej2-base';
import { DocumentEditorContainer, Toolbar } from '@syncfusion/ej2-documenteditor';
import { attachLocalSpellChecker } from '../components/local-spell-checker';

const licenseKey = String(import.meta.env.VITE_SYNCFUSION_LICENSE_KEY || '').trim();
if (licenseKey) registerLicense(licenseKey);

DocumentEditorContainer.Inject(Toolbar);

/* ---------------------------------------------------------------- documento */

const PARAGRAPHS = [
  'Trata-se de recurso inominado interposto contra a sentenca que extinguiu o feito sem resolucao do merito.',
  'O patrono compareceu a audiencia e requereu prazo para esclarecimento da ausencia da parte autora.',
  'A aplicacao rigida do artigo 362 do CPC desconsidera as particularidades do caso concreto.',
  'Ainda que nao seja acolhido o pedido de anulacao, deve ser afastada a condenacao em custas.',
];

const buildSfdt = () => ({
  sections: [
    {
      sectionFormat: { pageWidth: 612, pageHeight: 792, leftMargin: 72, rightMargin: 72, topMargin: 72, bottomMargin: 72 },
      blocks: [
        // Primeiro parágrafo em NEGRITO + SUBLINHADO de propósito: é o cabeçalho
        // típico da peça e o destino de `moveToDocumentStart()`.
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
});

const container = new DocumentEditorContainer({
  height: '100%',
  enableToolbar: false,
  enableSpellCheck: true,
  showPropertiesPane: false,
});
container.appendTo('#host');

const editor: any = container.documentEditor;
editor.spellChecker.languageID = 1046;
editor.spellChecker.allowSpellCheckAndSuggestion = true;
editor.spellChecker.ignoreUppercase = true;
editor.spellChecker.enableOptimizedSpellCheck = false;
attachLocalSpellChecker(editor);

/* ------------------------------------- despachante igual ao SyncfusionEditor */

const listeners = new Set<() => void>();
let eventCount = 0;
editor.selectionChange = () => {
  eventCount += 1;
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // um assinante com erro não pode derrubar os outros
    }
  });
};

/* --------------------------------------- leitura de formato igual à faixa ---*/

type Fmt = { bold: boolean; italic: boolean; underline: boolean; strikethrough: boolean };

const readFmt = (): Fmt => {
  const cf = editor.selection?.characterFormat || {};
  return {
    bold: !!cf.bold,
    italic: !!cf.italic,
    underline: !!cf.underline && cf.underline !== 'None',
    strikethrough: !!cf.strikethrough && cf.strikethrough !== 'None',
  };
};

/** Estado que a faixa mostraria: só muda quando o `selectionChange` chega. */
let ribbon: Fmt = readFmt();
listeners.add(() => {
  ribbon = readFmt();
});

/**
 * Formato REAL do ponto de inserção agora — força o Syncfusion a reler, sem
 * depender do evento. É o oráculo contra o qual comparamos a faixa.
 */
const truth = (): Fmt => {
  try {
    editor.selection.retrieveCurrentFormatProperties();
  } catch {
    // se nem forçado dá para ler, o que sobra é o valor em cache
  }
  return readFmt();
};

const locks = () => ({
  modificandoInternamente: !!editor.selection?.isModifyingSelectionInternally,
  formatoCongelado: !!editor.selection?.skipFormatRetrieval,
});

const same = (a: Fmt, b: Fmt) =>
  a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.strikethrough === b.strikethrough;

const show = (f: Fmt) =>
  [f.bold ? 'N' : '-', f.italic ? 'I' : '-', f.underline ? 'S' : '-', f.strikethrough ? 'T' : '-'].join('');

/* --------------------------------------------------------------- roteiro ---*/

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Step = { nome: string; run: () => void | Promise<void> };

type Report = {
  passo: string;
  eventos: number;
  faixa: string;
  verdade: string;
  divergente: boolean;
  travas: ReturnType<typeof locks>;
};

/** Offset "paragrafo;bloco;posicao" do corpo (o índice 1 pula o cabeçalho). */
const at = (paragrafo: number, posicao: number) => `0;${paragrafo};${posicao}`;

const selectRange = (paragrafo: number, de: number, ate: number) =>
  editor.selection.select(at(paragrafo, de), at(paragrafo, ate));

const caret = (paragrafo: number, posicao: number) =>
  editor.selection.select(at(paragrafo, posicao), at(paragrafo, posicao));

const steps: Step[] = [
  { nome: 'cursor em texto normal', run: () => caret(2, 5) },
  { nome: 'seleciona trecho normal', run: () => selectRange(2, 5, 25) },
  { nome: 'aplica negrito na selecao', run: () => editor.editor.toggleBold() },
  { nome: 'clica em outro paragrafo (sem selecao)', run: () => caret(3, 10) },
  { nome: 'seleciona e sublinha', run: () => { selectRange(3, 5, 20); editor.editor.toggleUnderline('Single'); } },
  { nome: 'colapsa o cursor depois do sublinhado', run: () => caret(3, 40) },
  { nome: 'Ctrl+B com cursor colapsado (formato pendente)', run: () => { caret(4, 10); editor.editor.toggleBold(); } },
  { nome: 'digita com o negrito pendente', run: () => editor.editor.insertText('teste') },
  { nome: 'move o cursor para tras (deveria desligar o negrito)', run: () => caret(1, 3) },
  { nome: 'tachado na selecao', run: () => { selectRange(1, 3, 12); editor.editor.toggleStrikethrough(); } },
  { nome: 'desfaz (undo)', run: () => editor.editorHistory.undo() },
  { nome: 'refaz (redo)', run: () => editor.editorHistory.redo() },
  {
    nome: 'captura da IA: selectAll + moveToDocumentStart',
    run: () => {
      // exatamente o que `getText()` faz no SyncfusionEditor
      editor.selection.selectAll();
      const _t = editor.selection.text;
      void _t;
      editor.selection.moveToDocumentStart();
    },
  },
  { nome: 'IA restaura a selecao anterior', run: () => selectRange(2, 5, 25) },
  { nome: 'foco de volta no editor (focusIn)', run: () => editor.focusIn() },
  { nome: 'cursor em texto normal de novo', run: () => caret(4, 20) },
  {
    nome: 'menu do botao direito sobre palavra (selectCurrentWord)',
    run: () => {
      const selection = editor.documentHelper.selection;
      const originalStart = selection.start.clone();
      const originalEnd = selection.end.clone();
      try {
        selection.isModifyingSelectionInternally = true;
        selection.selectCurrentWord();
        void selection.text;
      } finally {
        selection.start = originalStart;
        selection.end = originalEnd;
        selection.isModifyingSelectionInternally = false;
      }
    },
  },
  { nome: 'cursor apos o menu do botao direito', run: () => caret(2, 30) },
  { nome: 'seleciona o cabecalho (negrito+sublinhado reais)', run: () => editor.selection.select('0;0;0', '0;0;20') },
  { nome: 'volta para o corpo', run: () => caret(2, 8) },
];

/** Digitação contínua — o "fluxo intenso" do relato. */
const typingBurst = async (chars: number) => {
  caret(2, 20);
  for (let i = 0; i < chars; i++) {
    editor.editor.insertText(i % 7 === 0 ? ' ' : 'a');
    if (i % 25 === 0) await sleep(0);
  }
  await sleep(50);
};

const report: Report[] = [];
const erros: string[] = [];

const runStep = async (step: Step) => {
  const before = eventCount;
  try {
    await step.run();
  } catch (error) {
    // Um passo que estoura é DADO, não motivo para parar: é assim que os
    // sinalizadores internos ficam ligados e a faixa congela.
    // eslint-disable-next-line no-console
    console.error(`[passo] ${step.nome}`, error);
    erros.push(`${step.nome}: ${String((error as Error)?.message || error)}`);
  }
  await sleep(30);
  const faixa = ribbon;
  const verdade = truth();
  // `truth()` releu o formato: a faixa passa a valer o mesmo daqui em diante,
  // então guardamos o comparativo ANTES de deixar o estado seguir.
  const row: Report = {
    passo: step.nome,
    eventos: eventCount - before,
    faixa: show(faixa),
    verdade: show(verdade),
    divergente: !same(faixa, verdade),
    travas: locks(),
  };
  report.push(row);
  return row;
};

const main = async () => {
  (window as any).__bench = { editor, report, erros, locks, readFmt };
  (window as any).__fase = 'abrindo documento';
  editor.open(JSON.stringify(buildSfdt()));
  await sleep(600);
  (window as any).__fase = 'documento aberto';

  for (const step of steps) {
    (window as any).__fase = step.nome;
    await runStep(step);
  }
  (window as any).__fase = 'roteiro concluido';

  // Estresse: 400 caracteres digitados, medindo se a faixa continua viva.
  const beforeBurst = eventCount;
  await typingBurst(400);
  report.push({
    passo: 'rajada de 400 caracteres digitados',
    eventos: eventCount - beforeBurst,
    faixa: show(ribbon),
    verdade: show(truth()),
    divergente: !same(ribbon, readFmt()),
    travas: locks(),
  });

  // Depois da rajada, a faixa ainda responde a um clique simples?
  await runStep({ nome: 'cursor apos a rajada', run: () => caret(3, 12) });
  await runStep({ nome: 'seleciona apos a rajada', run: () => selectRange(3, 5, 15) });

  const quebras = report.filter((r) => r.divergente);
  const cegos = report.filter((r) => r.eventos === 0);

  // eslint-disable-next-line no-console
  console.table(report.map((r) => ({
    passo: r.passo,
    eventos: r.eventos,
    faixa: r.faixa,
    verdade: r.verdade,
    divergente: r.divergente ? 'SIM' : '',
    travado: r.travas.modificandoInternamente || r.travas.formatoCongelado ? 'SIM' : '',
  })));

  (window as any).__ribbonReport = report;

  const out = document.getElementById('out');
  if (out) {
    out.textContent = [
      `passos: ${report.length}`,
      `divergentes (faixa != verdade): ${quebras.length}`,
      quebras.map((q) => `  - ${q.passo}: faixa=${q.faixa} verdade=${q.verdade}`).join('\n'),
      `sem evento de selecao: ${cegos.length}`,
      cegos.map((c) => `  - ${c.passo}`).join('\n'),
      `travas ao final: ${JSON.stringify(locks())}`,
      erros.length ? `erros: ${erros.length}\n${erros.map((e) => `  - ${e}`).join('\n')}` : '',
    ].filter(Boolean).join('\n');
  }
};

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[bancada]', error);
  const out = document.getElementById('out');
  if (out) out.textContent = `FALHOU: ${String((error as Error)?.stack || error)}`;
});
