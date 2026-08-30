/**
 * Regras puras de IDENTIDADE e INTEGRIDADE das assinaturas.
 *
 * Vive sem nenhum import, pelo mesmo motivo de `assinaturaPublica.ts`: é o que
 * `node --test` carrega pelo ts-node sem esbarrar na cadeia de imports do app.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O MODELO CANÔNICO: existem DOIS identificadores públicos, e só dois.
 *
 *   · PROTOCOLO DO ENVELOPE — o UUID da solicitação. Vale o kit inteiro.
 *       ex.: 70F1A4A0-325C-432E-9D35-A5FDE77B7534
 *   · CÓDIGO DE VERIFICAÇÃO DO DOCUMENTO — um por PDF assinado.
 *       ex.: A8162AF5EEAB20D8
 *
 * `envelope_verification_code` e `signature_signers.verification_hash` são
 * INTERNOS/LEGADOS. Continuam existindo para resolver links antigos, mas não
 * podem ser apresentados como se fossem uma terceira e uma quarta identidade —
 * era exatamente essa confusão que fazia a tela pública exibir um código
 * DIFERENTE do que a pessoa tinha digitado.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ═══════════════════════════════════════════════════════════════════════════
// 1. HASH — comparação
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Põe um SHA-256 na forma comparável.
 *
 * ARMADILHA REAL: o cliente (`pdfSignature.service.ts`) grava o hash em
 * MAIÚSCULAS e a Edge Function calcula em minúsculas. Comparar cru com `!==`
 * acusaria divergência em 100% dos envelopes — um alarme falso que, pior,
 * ensinaria a ignorar o alarme. Toda comparação de hash passa por aqui.
 */
export function normalizarSha256(valor: string | null | undefined): string {
  return String(valor ?? '').trim().toLowerCase();
}

/** Dois hashes são o MESMO quando ambos existem e coincidem byte a byte. */
export function mesmoHash(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizarSha256(a);
  const y = normalizarSha256(b);
  // Hash ausente nunca "confere": ausência de prova não é prova.
  if (!x || !y) return false;
  return x === y;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. SELAGEM — o hash vem DEPOIS do PDF pronto
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A ordem obrigatória, escrita como código em vez de como comentário.
 *
 * O SHA-256 final tem de ser calculado sobre os bytes JÁ FINALIZADOS (com
 * assinatura, certificado, auditoria, rodapé, protocolo, código e QR dentro), e
 * os bytes enviados ao Storage têm de ser EXATAMENTE os mesmos que foram
 * hasheados. Se alguém, um dia, mover o cálculo para antes de carimbar o
 * rodapé, o hash registrado deixa de descrever o arquivo entregue e a
 * conferência pública passa a falhar sem ninguém entender por quê.
 *
 * É também por isso que o SHA-256 final NÃO é impresso dentro do próprio PDF:
 * escrever o hash no documento muda os bytes e produz outro hash.
 */
export async function selarPdfAssinado<TBytes>(params: {
  /** Bytes JÁ finalizados. Nada pode ser desenhado depois daqui. */
  bytesFinais: TBytes;
  calcularSha256: (bytes: TBytes) => Promise<string>;
  enviarAoStorage: (bytes: TBytes) => Promise<void>;
}): Promise<{ sha256: string }> {
  const { bytesFinais, calcularSha256, enviarAoStorage } = params;

  // 1) hash dos bytes finais…
  const sha256 = await calcularSha256(bytesFinais);
  // 2) …e sobe EXATAMENTE a mesma referência. Não uma cópia, não uma
  //    re-serialização: a mesma, para que não exista janela onde os bytes
  //    hasheados e os bytes enviados possam divergir.
  await enviarAoStorage(bytesFinais);

  return { sha256 };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. CONFERÊNCIA de um documento
// ═══════════════════════════════════════════════════════════════════════════

export type StatusIntegridade = 'checking' | 'valid' | 'mismatch' | 'unavailable';

/**
 * O veredito de UM arquivo: o que está no Storage hoje é o que foi registrado?
 *
 * `unavailable` não é uma falha branda de conferência — é a ausência dela. Ver
 * `parecerDoDossie`: "não foi possível verificar" jamais vira "íntegro".
 */
export function conferirDocumento(params: {
  /** SHA-256 gravado em `signature_request_documents.signed_pdf_sha256`. */
  hashRegistrado: string | null | undefined;
  /** SHA-256 recalculado agora, a partir do arquivo baixado. */
  hashAtual: string | null | undefined;
  /** Falso quando o download falhou (404, rede, permissão). */
  arquivoBaixado?: boolean;
}): StatusIntegridade {
  const { hashRegistrado, hashAtual, arquivoBaixado = true } = params;
  if (!arquivoBaixado) return 'unavailable';
  if (!normalizarSha256(hashRegistrado)) return 'unavailable';
  if (!normalizarSha256(hashAtual)) return 'unavailable';
  return mesmoHash(hashRegistrado, hashAtual) ? 'valid' : 'mismatch';
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. O PARECER do dossiê
// ═══════════════════════════════════════════════════════════════════════════

export type Parecer = 'ÍNTEGRO' | 'NÃO ÍNTEGRO' | 'CONFERINDO' | 'INCONCLUSIVO';

/**
 * O parecer global — a única frase do dossiê que um juiz vai ler inteira.
 *
 * A regra que governa tudo: **"não foi possível verificar" NUNCA é "íntegro"**.
 * ÍNTEGRO exige, cumulativamente: cadeia de auditoria íntegra, os documentos
 * esperados existindo, todos baixados, e o hash atual de cada um igual ao
 * registrado. Falta qualquer uma dessas → não é ÍNTEGRO.
 *
 * Precedência (a mais grave vence): uma divergência já provada não pode ficar
 * escondida atrás de um "CONFERINDO" de outro documento ainda em andamento.
 */
export function parecerDoDossie(params: {
  /** `chain_integrity.verified` do servidor. `null`/`undefined` = não apurado. */
  cadeiaVerificada: boolean | null | undefined;
  /** Status de cada documento; `undefined` = conferência ainda não começou. */
  statusDosDocumentos: readonly (StatusIntegridade | undefined)[];
  /** Quantos documentos o envelope DEVERIA ter (documento principal + anexos). */
  documentosEsperados?: number;
}): Parecer {
  const { cadeiaVerificada, statusDosDocumentos, documentosEsperados } = params;

  // 1) Ruptura provada — na cadeia ou em qualquer arquivo.
  if (cadeiaVerificada === false) return 'NÃO ÍNTEGRO';
  if (statusDosDocumentos.some((s) => s === 'mismatch')) return 'NÃO ÍNTEGRO';

  // 2) Envelope sem documento nenhum não é um envelope conferido: é um envelope
  //    que não pôde ser conferido. Sem esta linha, zero documentos passariam
  //    por "nenhuma divergência encontrada" e o laudo diria ÍNTEGRO.
  if (statusDosDocumentos.length === 0) return 'INCONCLUSIVO';
  if (typeof documentosEsperados === 'number'
      && documentosEsperados > statusDosDocumentos.length) {
    return 'INCONCLUSIVO';
  }

  // 3) Conferência em curso.
  if (statusDosDocumentos.some((s) => s === 'checking' || s === undefined)) return 'CONFERINDO';

  // 4) Cadeia não apurada, ou arquivo que não pôde ser lido.
  if (cadeiaVerificada !== true) return 'INCONCLUSIVO';
  if (statusDosDocumentos.some((s) => s !== 'valid')) return 'INCONCLUSIVO';

  return 'ÍNTEGRO';
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. IDENTIFICADORES que o PDF pode imprimir
// ═══════════════════════════════════════════════════════════════════════════

export type LinhaDeIdentificacao = { rotulo: string; valor: string };

/**
 * O que pode ser carimbado no PDF assinado — e nada além disso.
 *
 * Fora desta lista, de propósito:
 *   · `envelope_verification_code` (interno);
 *   · o código/hash do signatário (interno);
 *   · o SHA-256 do documento de origem;
 *   · o SHA-256 do próprio PDF assinado — imprimi-lo mudaria os bytes e
 *     produziria outro hash (dependência circular).
 */
export function identificadoresDoPdf(params: {
  /** UUID da solicitação. */
  protocolo: string | null | undefined;
  /** Código individual DESTE documento. */
  codigoDoDocumento: string | null | undefined;
}): LinhaDeIdentificacao[] {
  const linhas: LinhaDeIdentificacao[] = [];
  const codigo = String(params.codigoDoDocumento ?? '').trim().toUpperCase();
  const protocolo = String(params.protocolo ?? '').trim();
  if (codigo) linhas.push({ rotulo: 'CÓDIGO DE VERIFICAÇÃO', valor: codigo });
  if (protocolo) linhas.push({ rotulo: 'PROTOCOLO', valor: protocolo });
  return linhas;
}

/**
 * A largura que sobra para o PROTOCOLO na tarja do rodapé.
 *
 * Espelha a aritmética de `drawFooterStamp` (variante 'strip'). Existe para que
 * o UUID COMPLETO — 36 caracteres — nunca volte a ser cortado com "…" nem a
 * encavalar na zona do QR Code quando alguém mexer nas margens. O rodapé é o
 * único lugar onde o protocolo aparece em todas as folhas; cortá-lo ali
 * inutiliza a consulta.
 */
export function larguraDisponivelParaProtocolo(params: {
  larguraDaPagina: number;
  /** Nº de caracteres do código do documento (16 no padrão atual). */
  caracteresDoCodigo?: number;
}): number {
  const { larguraDaPagina, caracteresDoCodigo = 16 } = params;
  const marginL = 26;
  const marginR = 16;
  const qrSize = 44;
  const tx = marginL;
  const qrX = larguraDaPagina - marginR - qrSize;
  const valTextX = qrX - 12 - 96;
  const dividerX = valTextX - 16;
  const contentRight = dividerX - 18;
  // Courier: avanço fixo de 0.6 em.
  const larguraDoCodigo = caracteresDoCodigo * 12.5 * 0.6;
  const col2X = tx + Math.max(larguraDoCodigo, 118) + 34;
  return contentRight - col2X;
}

/** Largura, em pontos, de um texto em Courier no corpo indicado. */
export function larguraEmCourier(texto: string, corpo: number): number {
  return texto.length * corpo * 0.6;
}
