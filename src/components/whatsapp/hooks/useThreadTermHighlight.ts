// ACENDER A PALAVRA PROCURADA DENTRO DAS BOLHAS, enquanto a busca está aberta.
//
// ── Por que faltava ────────────────────────────────────────────────────────
// A busca dentro da conversa já leva até a mensagem certa e a pisca inteira.
// Só que a mensagem certa costuma ser um parágrafo — ou uma transcrição de
// áudio de mil caracteres — e "a bolha é esta" ainda deixa o olho procurando a
// palavra dentro dela. É o último passo da busca, e era o único que continuava
// manual.
//
// ── Por que NÃO é uma prop nova no balão ───────────────────────────────────
// O caminho óbvio seria passar o termo para `MessageBubble` e envolver os
// pedaços casados em `<mark>`. Isso significaria: atravessar a cadeia inteira
// (bolha, álbum, citação, transcrição, legenda de mídia), reescrever o HTML de
// toda mensagem a cada tecla digitada na busca, e correr o risco de o menu do
// clique direito, a seleção de texto e o "copiar" passarem a se comportar
// diferente porque o texto virou vários nós.
//
// A API de destaque do navegador (`CSS.highlights`) faz o mesmo SEM tocar no
// DOM: o destaque é uma coleção de `Range`, pintada pelo `::highlight()` na
// folha de estilo. Nenhum nó é criado, nada re-renderiza, e copiar a mensagem
// devolve exatamente o texto de antes. Onde a API não existe, não acontece
// nada — a busca continua inteira, só sem o grifo.
//
// ── O custo, e o teto ──────────────────────────────────────────────────────
// A varredura é sobre os nós de TEXTO da conversa carregada (não do documento),
// roda com a digitação já parada e tem teto de nós e de casamentos: uma
// conversa longa com o termo "a" não pode virar dez mil `Range`.
import { useEffect } from 'react';
import { ocorrenciasNoTexto } from '../threadSearchText';

/** O nome do destaque na folha de estilo — ver `::highlight(wa-busca)`. */
const NOME = 'wa-busca';

/** Teto de nós de texto varridos por passada. */
const MAX_NOS = 4000;
/** Teto de trechos acesos. Acima disso o grifo deixa de informar e só suja. */
const MAX_TRECHOS = 600;

type ComHighlights = typeof CSS & { highlights?: Map<string, unknown> };

function limpar() {
  const css = CSS as ComHighlights;
  css.highlights?.delete(NOME);
}

/**
 * Mantém acesa, dentro de `raiz`, toda ocorrência de `termo` — enquanto
 * `ativo`. Desliga sozinho ao fechar a busca, ao trocar de conversa e ao
 * desmontar.
 *
 * `versao` é o que manda repetir a varredura quando a conversa muda debaixo da
 * busca: chegou mensagem nova, o "carregar mais" trouxe um bloco antigo, um
 * áudio terminou de transcrever. Sem isso o grifo valeria só para o que estava
 * na tela no instante em que a palavra foi digitada.
 */
export function useThreadTermHighlight(
  raiz: React.RefObject<HTMLElement | null>,
  termo: string,
  ativo: boolean,
  versao: unknown,
): void {
  useEffect(() => {
    const css = CSS as ComHighlights;
    // Navegador sem a API: a busca funciona igual, sem o grifo.
    if (!css.highlights || typeof Highlight === 'undefined') return;

    const alvo = termo.trim();
    const el = raiz.current;
    if (!ativo || alvo.length < 2 || !el) { limpar(); return; }

    // Um quadro de folga: a passada acontece depois de o React ter pintado o
    // bloco que acabou de chegar, senão ela varre a thread anterior.
    const quadro = requestAnimationFrame(() => {
      const faixas: Range[] = [];
      const andarilho = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let nos = 0;
      let no = andarilho.nextNode();
      while (no && nos < MAX_NOS && faixas.length < MAX_TRECHOS) {
        nos += 1;
        const texto = no.nodeValue;
        if (texto && texto.length >= alvo.length) {
          for (const oc of ocorrenciasNoTexto(texto, alvo, MAX_TRECHOS - faixas.length)) {
            const faixa = document.createRange();
            faixa.setStart(no, oc.ini);
            faixa.setEnd(no, oc.fim);
            faixas.push(faixa);
          }
        }
        no = andarilho.nextNode();
      }
      if (faixas.length === 0) { limpar(); return; }
      css.highlights!.set(NOME, new Highlight(...faixas));
    });

    return () => { cancelAnimationFrame(quadro); limpar(); };
  }, [raiz, termo, ativo, versao]);

  // Apaga o grifo se o componente sair de cena com a busca aberta (trocar de
  // módulo, fechar o widget): o destaque é global do documento, e um `Range`
  // pendurado num nó que saiu da árvore não some sozinho.
  useEffect(() => limpar, []);
}
