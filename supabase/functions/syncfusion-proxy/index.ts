import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * syncfusion-proxy v10
 *
 * SpellCheckByPage -> { SpellCollection: [{ Text, HasSpellError, Suggestions, WordCollectionForSpellCheck }] }
 * SpellCheck       -> { HasSpellingError, Suggestions }
 *
 * v10: palavras com inicial maiuscula nao sao marcadas como erro
 *      (nomes proprios, termos juridicos, inicio de frase).
 */

const SYNCFUSION_BASE = 'https://document.syncfusion.com/web-services/docx-editor/api/documenteditor/';
const LANGUAGETOOL_API = 'https://api.languagetool.org/v2/check';

const FORCE_ERRORS_DIAGNOSTIC = false;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

(globalThis as any).Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const route = segments[segments.length - 1] ?? '';
  console.log(`[proxy] ${req.method} /${route}`);

  if (route === 'SpellCheckByPage') {
    return handleSpellCheckByPage(req);
  }
  if (route === 'SpellCheck') {
    return handleSpellCheck(req);
  }
  return proxyToSyncfusion(req, route);
});

/* --- SpellCheckByPage --- */

async function handleSpellCheckByPage(req: Request): Promise<Response> {
  try {
    const rawBody = await req.text();
    console.log(`[SpellCheckByPage] body:`, rawBody.slice(0, 500));

    let body: any = {};
    try { body = JSON.parse(rawBody); } catch { }

    const textToCheck: string = String(body.TexttoCheck ?? body.text ?? body.Text ?? '').trim();
    console.log(`[SpellCheckByPage] text: "${textToCheck.slice(0, 200)}"`);

    const words = tokenizeWords(textToCheck);
    console.log(`[SpellCheckByPage] ${words.length} palavras: [${words.slice(0, 10).join(', ')}]`);

    let spellCollection: Array<{ Text: string; HasSpellError: boolean; Suggestions: string[]; WordCollectionForSpellCheck: [] }>;

    if (words.length === 0) {
      spellCollection = [{ Text: '', HasSpellError: false, Suggestions: [], WordCollectionForSpellCheck: [] }];
    } else if (FORCE_ERRORS_DIAGNOSTIC) {
      console.log(`[SpellCheckByPage] DIAGNOSTICO - forcando HasSpellError=true`);
      spellCollection = words.map(word => ({
        Text: word,
        HasSpellError: true,
        Suggestions: ['TESTE_' + word],
        WordCollectionForSpellCheck: [],
      }));
    } else {
      const [ltMatches, wordRanges] = await Promise.all([
        callLanguageTool(textToCheck),
        Promise.resolve(getWordRanges(textToCheck)),
      ]);
      console.log(`[SpellCheckByPage] LT matches: ${ltMatches.length}`);

      // Detectar espacos duplos (ASCII only: espaco e tab)
      const doubleSpaceTargets = new Set<string>();
      const dsRegex = / {2,}|\t{2,}/g;
      let dsM: RegExpExecArray | null;
      while ((dsM = dsRegex.exec(textToCheck)) !== null) {
        const dsEnd = dsM.index + dsM[0].length;
        const wordAfter = wordRanges.find(({ start }) => start >= dsEnd);
        if (wordAfter) {
          doubleSpaceTargets.add(wordAfter.word);
        }
      }

      // Palavras com inicial maiuscula = nome proprio / termo juridico / inicio de frase
      // Nao marcar para evitar falsos positivos em peticoes juridicas
      const startsUpper = (w: string) => w.length > 0 && /^[A-ZÀ-ÖØ-Þ]/.test(w);

      spellCollection = wordRanges.map(({ start, end, word }) => {
        if (startsUpper(word)) {
          return { Text: word, HasSpellError: false, Suggestions: [], WordCollectionForSpellCheck: [] };
        }

        const ltErr = ltMatches.find((m: any) => m.offset >= start && m.offset + m.length <= end);
        const isDoubleSpace = doubleSpaceTargets.has(word);

        if (ltErr) {
          return {
            Text: word,
            HasSpellError: true,
            Suggestions: ltErr.replacements?.slice(0, 5).map((r: any) => r.value) ?? [],
            WordCollectionForSpellCheck: [],
          };
        }
        if (isDoubleSpace) {
          return {
            Text: word,
            HasSpellError: true,
            Suggestions: ['Remover espaco duplo'],
            WordCollectionForSpellCheck: [],
          };
        }
        return { Text: word, HasSpellError: false, Suggestions: [], WordCollectionForSpellCheck: [] };
      });

      if (spellCollection.length === 0) {
        spellCollection = [{ Text: '', HasSpellError: false, Suggestions: [], WordCollectionForSpellCheck: [] }];
      }
    }

    console.log(`[SpellCheckByPage] SpellCollection(${spellCollection.length}):`, JSON.stringify(spellCollection.slice(0, 5)));
    return jsonResponse({ SpellCollection: spellCollection });

  } catch (err: any) {
    console.error(`[SpellCheckByPage] Erro:`, err);
    return jsonResponse({ SpellCollection: [{ Text: '', HasSpellError: false, Suggestions: [], WordCollectionForSpellCheck: [] }] });
  }
}

/* --- SpellCheck (word-by-word) --- */

async function handleSpellCheck(req: Request): Promise<Response> {
  try {
    const rawBody = await req.text();
    console.log(`[SpellCheck] body:`, rawBody.slice(0, 300));

    let body: any = {};
    try { body = JSON.parse(rawBody); } catch { }

    const word: string = String(body.TexttoCheck ?? body.text ?? body.Text ?? '').trim();
    console.log(`[SpellCheck] word: "${word}"`);

    if (!word) {
      return jsonResponse({ HasSpellingError: false, Suggestions: [] });
    }

    // Palavras com inicial maiuscula = nome proprio / termo juridico -> ignorar
    if (/^[A-ZÀ-ÖØ-Þ]/.test(word)) {
      return jsonResponse({ HasSpellingError: false, Suggestions: [] });
    }

    if (FORCE_ERRORS_DIAGNOSTIC) {
      console.log(`[SpellCheck] DIAGNOSTICO - forcando HasSpellingError=true`);
      return jsonResponse({ HasSpellingError: true, Suggestions: ['TESTE_' + word] });
    }

    const ltMatches = await callLanguageTool(word);
    console.log(`[SpellCheck] LT matches: ${ltMatches.length}`);
    if (ltMatches.length > 0) {
      const suggestions = ltMatches[0].replacements?.slice(0, 5).map((r: any) => r.value) ?? [];
      return jsonResponse({ HasSpellingError: true, Suggestions: suggestions });
    }
    return jsonResponse({ HasSpellingError: false, Suggestions: [] });

  } catch (err: any) {
    console.error(`[SpellCheck] Erro:`, err);
    return jsonResponse({ HasSpellingError: false, Suggestions: [] });
  }
}

/* --- Helpers --- */

function tokenizeWords(text: string): string[] {
  return [...text.matchAll(/[A-Za-zÀ-ÿ]+(?:'[A-Za-zÀ-ÿ]+)*/g)].map(m => m[0]);
}

function getWordRanges(text: string): Array<{ start: number; end: number; word: string }> {
  const regex = /[A-Za-zÀ-ÿ]+(?:'[A-Za-zÀ-ÿ]+)*/g;
  const ranges: Array<{ start: number; end: number; word: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length, word: m[0] });
  }
  return ranges;
}

async function callLanguageTool(text: string): Promise<any[]> {
  try {
    const resp = await fetch(LANGUAGETOOL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ text, language: 'pt-BR', enabledOnly: 'false' }),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const all: any[] = data.matches ?? [];
    return all.filter((m: any) =>
      m.rule?.id?.includes('MORFOLOGIK') ||
      m.rule?.category?.id === 'TYPOS' ||
      m.rule?.category?.id === 'TYPOGRAPHY'
    );
  } catch { return []; }
}

/* --- Proxy Syncfusion original --- */

async function proxyToSyncfusion(req: Request, route: string): Promise<Response> {
  try {
    const targetUrl = SYNCFUSION_BASE + route;
    const contentType = req.headers.get('content-type') ?? '';
    const bodyInit: BodyInit = contentType.includes('form-data') ? await req.formData() : await req.blob();
    const resp = await fetch(targetUrl, { method: req.method, body: bodyInit });
    const responseBody = await resp.arrayBuffer();
    return new Response(responseBody, {
      status: resp.status,
      headers: { ...corsHeaders, 'Content-Type': resp.headers.get('Content-Type') ?? 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
