/**
 * O CRONÔMETRO DE FASES — onde o minuto da assinatura é gasto.
 *
 * A montagem do PDF no aparelho de quem assina leva ~8 s por documento (medido
 * em 04/09/2026: 48 s num kit de 6). Antes de otimizar qualquer coisa é preciso
 * saber ONDE esse tempo está, porque as duas hipóteses plausíveis pedem
 * soluções opostas:
 *
 *   · se o peso é a REDE (a mesma assinatura e a mesma selfie baixadas uma vez
 *     por documento), cache resolve e é barato;
 *   · se o peso é a RASTERIZAÇÃO (o `html2canvas` desenhando o DOCX a 2,5×),
 *     cache é consolo — só tirar o desenho do navegador resolve.
 *
 * Otimizar sem medir é escolher uma das duas no escuro.
 *
 * A REGRA DE PROJETO QUE ESTE MÓDULO SEGUE: ele mostra o que NÃO foi medido.
 * Um relatório que só soma as fases instrumentadas dá 100% sempre, e some com o
 * tempo que ninguém cronometrou — que é justamente onde um gargalo
 * desconhecido se esconde. Por isso `formatarResumo` recebe o relógio de parede
 * e imprime a diferença como "não medido".
 *
 * Ver `docs/assinatura-montagem-no-servidor.md`.
 */

/** Uma medição: uma fase levou tantos milissegundos. */
export type Amostra = { fase: string; ms: number };

/** Uma linha do relatório, já somada por fase. */
export type LinhaDoResumo = {
  fase: string;
  /** Soma de todas as passagens por esta fase. */
  ms: number;
  /** Quantas vezes a fase rodou — é o que denuncia trabalho repetido. */
  vezes: number;
  /** Fatia do relógio de parede, de 0 a 1. */
  fatia: number;
};

/**
 * Soma as amostras por fase e ordena da mais cara para a mais barata.
 *
 * A ordem é por tempo, não por ordem de execução: quem lê o relatório quer
 * saber o que atacar, e a primeira linha tem de ser a resposta.
 */
export function resumir(amostras: readonly Amostra[], relogioDeParede: number): LinhaDoResumo[] {
  const porFase = new Map<string, { ms: number; vezes: number }>();
  for (const a of amostras) {
    const atual = porFase.get(a.fase) ?? { ms: 0, vezes: 0 };
    atual.ms += a.ms;
    atual.vezes += 1;
    porFase.set(a.fase, atual);
  }

  const base = relogioDeParede > 0 ? relogioDeParede : 0;
  return [...porFase.entries()]
    .map(([fase, v]) => ({ fase, ms: v.ms, vezes: v.vezes, fatia: base > 0 ? v.ms / base : 0 }))
    .sort((a, b) => b.ms - a.ms);
}

/** `12.345` → `12,3 s`; abaixo de 1 s fica em ms, que é como se lê tempo curto. */
export function formatarDuracao(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
  return `${Math.round(ms)} ms`;
}

/**
 * O relatório em texto.
 *
 * A última linha é a que mais importa e a que quase todo cronômetro esquece: o
 * tempo do relógio de parede que NENHUMA fase reivindicou. Se ele for grande, a
 * conclusão não é "as fases medidas são o problema" — é "falta instrumentar".
 */
export function formatarResumo(
  amostras: readonly Amostra[],
  relogioDeParede: number,
  titulo = 'tempo da assinatura',
): string {
  const linhas = resumir(amostras, relogioDeParede);
  const medido = linhas.reduce((s, l) => s + l.ms, 0);
  const naoMedido = Math.max(0, relogioDeParede - medido);

  const largura = Math.max(10, ...linhas.map((l) => l.fase.length), 'não medido'.length);
  const corpo = linhas.map((l) => {
    const pct = (l.fatia * 100).toFixed(1).padStart(5);
    const vezes = l.vezes > 1 ? `  ×${l.vezes}` : '';
    return `  ${l.fase.padEnd(largura)}  ${formatarDuracao(l.ms).padStart(8)}  ${pct}%${vezes}`;
  });

  const pctNaoMedido = relogioDeParede > 0 ? (naoMedido / relogioDeParede) * 100 : 0;
  corpo.push(
    `  ${'não medido'.padEnd(largura)}  ${formatarDuracao(naoMedido).padStart(8)}  `
    + `${pctNaoMedido.toFixed(1).padStart(5)}%`,
  );

  return [
    `── ${titulo}: ${formatarDuracao(relogioDeParede)} ──`,
    ...corpo,
  ].join('\n');
}

/**
 * O cronômetro em si. `agora` entra por parâmetro para o teste não depender de
 * relógio de verdade — e para o navegador poder passar `performance.now()`, que
 * é monotônico (o `Date.now()` anda para trás quando o relógio do aparelho é
 * ajustado no meio da medição).
 */
export function criarCronometro(agora: () => number) {
  let amostras: Amostra[] = [];
  let comecouEm: number | null = null;

  return {
    /** Zera e marca o início do relógio de parede. */
    comecar(): void {
      amostras = [];
      comecouEm = agora();
    },

    /**
     * Abre uma fase e devolve a função que a fecha.
     *
     * Devolver o "fechar" em vez de aceitar um nome nos dois lados é o que
     * impede o erro clássico: fechar uma fase que nunca foi aberta, ou abrir
     * duas com o mesmo nome e perder a primeira.
     */
    fase(nome: string): () => void {
      const de = agora();
      let fechada = false;
      return () => {
        if (fechada) return;   // fechar duas vezes não pode contar duas vezes
        fechada = true;
        amostras.push({ fase: nome, ms: Math.max(0, agora() - de) });
      };
    },

    /** Mede uma promessa inteira, fechando a fase mesmo se ela estourar. */
    async medir<T>(nome: string, tarefa: () => Promise<T>): Promise<T> {
      const fechar = this.fase(nome);
      try { return await tarefa(); } finally { fechar(); }
    },

    /** O relógio de parede desde `comecar()`. */
    decorrido(): number {
      return comecouEm === null ? 0 : Math.max(0, agora() - comecouEm);
    },

    amostras(): readonly Amostra[] {
      return amostras;
    },

    relatorio(titulo?: string): string {
      return formatarResumo(amostras, this.decorrido(), titulo);
    },
  };
}

/**
 * O cronômetro da assinatura — um só, compartilhado.
 *
 * É singleton de propósito: as fases moram em dois arquivos (o laço de
 * `PublicSigningPage` e o desenho em `pdfSignature.service`), e passar um
 * cronômetro por seis camadas de parâmetro para instrumentar seria uma cirurgia
 * maior que a medição. Instrumentação não deve reescrever o código que mede.
 */
export const cronometroDaAssinatura = criarCronometro(
  () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
);
