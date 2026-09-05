/**
 * O PRAZO DO ENVELOPE DE ASSINATURA — do calendário para o instante certo.
 *
 * O assistente pergunta uma DATA ("bloquear após 10/09/2026") e o banco guarda
 * um INSTANTE (`signature_requests.expires_at`, timestamptz). A conversão entre
 * as duas coisas parece não ter nada dentro, e tem: mandada crua, a data
 * `2026-09-10` é lida pelo Postgres na sessão do PostgREST, que é UTC, e vira
 * `2026-09-10 00:00:00+00` — ou seja, **09/09/2026 às 20:00 em Cuiabá**.
 *
 * O efeito é um envelope que fecha 28 horas antes do que a tela promete: a
 * pessoa lê "válido até 10/09" e o link para de aceitar assinatura às oito da
 * noite do dia 9. Conferido no banco em 04/09/2026 — `'2026-09-10'::timestamptz`
 * devolve exatamente isso.
 *
 * A resposta é dizer o fuso, e dizer o FIM do dia: quem escolhe "dia 10" quer o
 * dia 10 inteiro.
 *
 * POR QUE O DESLOCAMENTO É FIXO em −04:00, e não lido de configuração: Cuiabá
 * não tem horário de verão desde 2019, e o documento assinado é ancorado nesse
 * mesmo fuso do começo ao fim (o laudo é gravado com "(Cuiabá)" no papel, e a
 * Edge Function que o monta não lê configuração de escritório). O prazo tem de
 * concordar com o documento, não com um ajuste que o documento não conhece.
 *
 * Sem imports de propósito: a cadeia de `import` relativo sem extensão quebra o
 * `npm test` (ver a nota do projeto sobre `ts-node`).
 */

/** O fuso do escritório, em deslocamento fixo. Ver o cabeçalho. */
export const DESLOCAMENTO_DO_ESCRITORIO = '-04:00';

/** `2026-09-10` → `2026-09-10T23:59:59.999-04:00`. Vazio/ inválido → `null`. */
export function fimDoDiaNoEscritorio(dataEscolhida: string | null | undefined): string | null {
  const texto = String(dataEscolhida ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return null;

  // A data precisa EXISTIR no calendário. `2026-02-31` casa com a expressão
  // acima e viraria 03/03 sem ninguém perceber — um prazo silenciosamente
  // deslocado é pior do que um prazo recusado.
  const [ano, mes, dia] = texto.split('-').map(Number);
  const conferencia = new Date(Date.UTC(ano, mes - 1, dia));
  if (conferencia.getUTCFullYear() !== ano
    || conferencia.getUTCMonth() !== mes - 1
    || conferencia.getUTCDate() !== dia) {
    return null;
  }

  return `${texto}T23:59:59.999${DESLOCAMENTO_DO_ESCRITORIO}`;
}
