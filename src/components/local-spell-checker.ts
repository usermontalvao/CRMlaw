// Corretor ortográfico pt-BR local (Hunspell real via WASM — hunspell-asm).
//
// O Syncfusion DocumentEditor delega TODO o spell check ao serviço web
// (`serviceUrl` + /SpellCheck | /SpellCheckByPage). O endpoint público de demo
// não tem dicionário pt-BR — marca "de", "que", "na" como erro — e a latência /
// falha das respostas por página faz o texto do fim da página sumir durante o
// scroll (o modo otimizado re-renderiza a página quando a resposta chega).
//
// Este módulo sobrescreve `spellChecker.callSpellChecker` respondendo
// localmente com os MESMOS formatos JSON que o serviço:
//   - palavra:  { HasSpellingError, Suggestions }
//   - por página: { HasSpellingError, SpellCollection: [{ Text, HasSpellError }] }
//   - AddWord:  persiste em localStorage (dicionário do usuário)

import affUrl from 'dictionary-pt-br/index.aff?url';
import dicUrl from 'dictionary-pt-br/index.dic?url';

type Checker = {
  correct: (word: string) => boolean;
  suggest: (word: string) => string[];
  add: (word: string) => unknown;
};

const USER_DICT_KEY = 'crm-spell-user-dict-v1';

// Abreviações e termos forenses comuns que não constam no Hunspell
const LEGAL_EXTRA_WORDS = [
  'nº', 'nºs', 'art', 'arts', 'inc', 'incs', 'fls', 'fl', 'cf', 'obs',
  'proc', 'ss', 'reclamada', 'reclamadas', 'reclamante', 'reclamantes',
  'reclamatória', 'reclamatórias', 'trabalhista', 'trabalhistas',
  'insalubridade', 'periculosidade', 'súmula', 'súmulas', 'ementa',
  'liminarmente', 'tutela', 'sucumbência', 'sucumbenciais', 'honorários',
  'contracheque', 'contracheques', 'holerite', 'holerites',
  'whatsapp', 'email', 'e-mail', 'site', 'online',
];

const loadUserWords = (): string[] => {
  try {
    const raw = window.localStorage.getItem(USER_DICT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map((w) => String(w)) : [];
  } catch {
    return [];
  }
};

const persistUserWord = (word: string) => {
  try {
    const words = loadUserWords();
    if (!words.includes(word)) {
      words.push(word);
      window.localStorage.setItem(USER_DICT_KEY, JSON.stringify(words));
    }
  } catch {
    // ignore
  }
};

let checkerPromise: Promise<Checker | null> | null = null;

const getChecker = (): Promise<Checker | null> => {
  if (!checkerPromise) {
    checkerPromise = (async () => {
      try {
        // Hunspell real compilado para WASM. Motores JS puros (nspell/typo.js)
        // não aguentam o dicionário pt-BR completo no browser (estouram o
        // limite de propriedades enumeráveis do V8).
        //
        // Import do build CJS de propósito: o build ESM do hunspell-asm faz
        // `import * as runtime` de um UMD e chama o namespace como função —
        // quebra no interop do Vite/esbuild. O build CJS converte limpo.
        const [hunspellModule, affText, dic] = await Promise.all([
          import('hunspell-asm/dist/cjs/index.js'),
          fetch(affUrl).then((r) => r.text()),
          fetch(dicUrl).then((r) => r.arrayBuffer()),
        ]);
        const anyModule: any = hunspellModule;
        const loadModule = anyModule.loadModule ?? anyModule.default?.loadModule;
        const factory = await loadModule();
        // O VERO usa flags UTF-8 multibyte (ex.: "de/Â") sem declarar
        // `FLAG UTF-8` no .aff. Sem a diretiva, este hunspell interpreta os
        // flags como bytes soltos e REJEITA toda palavra com flag acentuado
        // ("de", "advogado", "petição"…). Injetá-la corrige o parsing.
        const affFixed = affText.includes('FLAG ')
          ? affText
          : affText.replace('SET UTF-8', 'SET UTF-8\nFLAG UTF-8');
        const affPath = factory.mountBuffer(new TextEncoder().encode(affFixed), 'pt_BR.aff');
        const dicPath = factory.mountBuffer(new Uint8Array(dic), 'pt_BR.dic');
        const hunspell = factory.create(affPath, dicPath);
        const spell: Checker = {
          correct: (w) => hunspell.spell(w),
          suggest: (w) => hunspell.suggest(w),
          add: (w) => hunspell.addWord(w),
        };
        for (const w of LEGAL_EXTRA_WORDS) spell.add(w);
        for (const w of loadUserWords()) spell.add(w);
        return spell;
      } catch (err) {
        console.warn('[local-spell-checker] falha ao carregar dicionário pt-BR:', err);
        return null;
      }
    })();
  }
  return checkerPromise;
};

// Mesmo conjunto de caracteres que o Syncfusion remove das bordas da palavra
// (manageSpecialCharacters / replaceSpecialChars), + zero-width chars.
const stripEdges = (word: string) =>
  String(word || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/^[#@!$%^&*()\-_+={}[\]:;"”“'’‘,<.>/?`´\s]+/, '')
    .replace(/[#@!$%^&*()\-_+={}[\]:;"”“'’‘,<.>/?`´\s]+$/, '');

const isWordCorrect = (spell: Checker, rawWord: string, ignoreUppercase: boolean): boolean => {
  const word = stripEdges(rawWord);
  if (!word || word.length < 2) return true;
  // Números, datas, CEP, "7º", "2ª", artigos de lei, processos CNJ…
  if (/\d/.test(word)) return true;
  // Siglas e cabeçalhos em caixa alta (TST, CLT, RECLAMATÓRIA…)
  if (ignoreUppercase && word === word.toUpperCase()) return true;

  const candidates = [word];
  const lower = word.toLowerCase();
  if (lower !== word) {
    candidates.push(lower);
    candidates.push(word.charAt(0) + word.slice(1).toLowerCase());
  }
  for (const c of candidates) {
    if (spell.correct(c)) return true;
  }
  // Compostos hifenizados: todas as partes corretas → palavra correta
  if (word.includes('-')) {
    const parts = word.split('-').filter(Boolean);
    if (parts.length > 1 && parts.every((p) => isWordCorrect(spell, p, ignoreUppercase))) {
      return true;
    }
  }
  return false;
};

const buildSuggestions = (spell: Checker, rawWord: string): string[] => {
  const word = stripEdges(rawWord);
  if (!word) return [];
  let suggestions = spell.suggest(word) || [];
  if (suggestions.length === 0 && word !== word.toLowerCase()) {
    suggestions = spell.suggest(word.toLowerCase()) || [];
  }
  return suggestions.slice(0, 5);
};

// Espelha HelperMethods.getSpellCheckData (split por espaço após normalizar
// quebras, tabs, '/', e NBSP) para que as chaves da SpellCollection casem com
// as palavras que o cliente calcula. Divergência pontual não é problema: a
// palavra cai no check individual, que também responde localmente.
const splitPageContent = (content: string): string[] => {
  const tokens = String(content || '')
    .replace(/[\r\n\v\t\/\u00A0 ]/g, ' ')
    .split(' ');
  const unique = new Set<string>();
  for (const token of tokens) {
    const text = stripEdges(token);
    if (text) unique.add(text);
  }
  return Array.from(unique);
};

/**
 * Substitui o transporte XHR do spell checker do Syncfusion por respostas
 * locais (Hunspell pt-BR). Chamar uma vez após o editor ser criado.
 */
export const attachLocalSpellChecker = (documentEditor: any): void => {
  const spellChecker = documentEditor?.spellChecker ?? documentEditor?.spellCheckerModule;
  if (!spellChecker || (spellChecker as any).__localSpellAttached) return;
  (spellChecker as any).__localSpellAttached = true;

  // Limpa o cache de palavras persistido pelas respostas erradas do serviço
  // remoto (uniqueKey → localStorage), senão os falsos erros continuam.
  try {
    const uniqueKey = (spellChecker as any).uniqueKey;
    if (uniqueKey) window.localStorage.removeItem(String(uniqueKey));
  } catch {
    // ignore
  }

  // Dispara o carregamento do dicionário desde já (lazy, ~1s, uma vez por sessão)
  void getChecker();

  spellChecker.callSpellChecker = (
    _languageID: number,
    word: string,
    checkSpelling: boolean,
    checkSuggestion: boolean,
    addWord?: boolean,
    isByPage?: boolean
  ): Promise<string> =>
    getChecker().then((spell) => {
      // Sem dicionário (falha de rede no load): responder "sem erros" para não
      // sujar o documento nem quebrar o render.
      if (!spell) {
        return JSON.stringify({ HasSpellingError: false, Suggestions: [], SpellCollection: [] });
      }

      if (addWord) {
        const clean = stripEdges(word);
        if (clean) {
          persistUserWord(clean);
          try { spell.add(clean); } catch { /* ignore */ }
        }
        return JSON.stringify({ HasSpellingError: false, Suggestions: [] });
      }

      const ignoreUppercase = !!(spellChecker as any).ignoreUppercase;

      if (isByPage) {
        const spellCollection = splitPageContent(word).map((text) => ({
          Text: text,
          HasSpellError: !isWordCorrect(spell, text, ignoreUppercase),
        }));
        return JSON.stringify({
          HasSpellingError: spellCollection.some((e) => e.HasSpellError),
          SpellCollection: spellCollection,
          Suggestions: [],
        });
      }

      const hasError = !isWordCorrect(spell, word, ignoreUppercase);
      const suggestions = hasError && checkSuggestion ? buildSuggestions(spell, word) : [];
      void checkSpelling;
      return JSON.stringify({ HasSpellingError: hasError, Suggestions: suggestions });
    });
};
