/**
 * Os dados do signatário como o laudo os LÊ — antes de qualquer desenho.
 *
 * São quatro leituras que o cliente fazia como métodos privados do serviço de
 * PDF, e que aqui viram funções puras com teste: interpretar o agente de
 * usuário, separar coordenada de endereço, reconhecer o e-mail interno que
 * nunca deve aparecer num documento, e escrever data e hora no fuso do
 * escritório.
 *
 * Porte de `parseUserAgent`, `parseGeolocation`, `isInternalPlaceholderEmail` e
 * `formatCuiabaDateTime` (`pdfSignature.service.ts`).
 *
 * PORTE FIEL: as cadeias de `if` estão na MESMA ordem do cliente. Ela não é
 * arbitrária — "Edg" antes de "Chrome" existe porque o Edge se anuncia como
 * Chrome, e inverter faria todo Edge virar "Google Chrome" no laudo.
 */

/** O fuso do escritório. Todo horário do laudo é lido aqui, nunca no fuso de quem abre. */
export const FUSO_DO_ESCRITORIO = 'America/Cuiaba';

export type AgenteDeUsuario = { aparelho?: string; navegador?: string; sistema?: string };

/**
 * Interpreta a cadeia do agente de usuário.
 *
 * O resultado é RESUMO, e o resumo perde informação de propósito: a cadeia crua
 * vai inteira para a trilha de auditoria, onde ela é o dado. Aqui o que se quer
 * é uma linha legível no cartão.
 */
export function interpretarAgenteDeUsuario(ua: string | null | undefined): AgenteDeUsuario {
  if (!ua) return {};

  let aparelho: string | undefined;
  let navegador: string | undefined;
  let sistema: string | undefined;

  if (ua.includes('iPhone')) aparelho = 'iPhone';
  else if (ua.includes('iPad')) aparelho = 'iPad';
  else if (ua.includes('Android') || ua.includes('Mobile')) aparelho = 'Celular';
  else aparelho = 'Desktop';

  // A ordem é regra: o Edge se anuncia COMO Chrome, e o Chrome se anuncia como
  // Safari. Testar do mais específico para o mais genérico é o que faz o laudo
  // dizer o navegador certo.
  if (ua.includes('Edg')) navegador = 'Microsoft Edge';
  else if (ua.includes('Chrome')) navegador = 'Google Chrome';
  else if (ua.includes('Firefox')) navegador = 'Mozilla Firefox';
  else if (ua.includes('Safari')) navegador = 'Safari';

  if (ua.includes('Windows')) sistema = 'Windows';
  else if (ua.includes('Mac OS X')) sistema = 'macOS';
  else if (ua.includes('Android')) sistema = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) sistema = 'iOS';
  else if (ua.includes('Linux')) sistema = 'Linux';

  return { aparelho, navegador, sistema };
}

export type Geolocalizacao = { coordenadas?: string; endereco?: string };

/**
 * Separa a coluna `signer_geolocation`, que guarda `coordenadas|endereço`.
 *
 * O endereço é opcional e vem da geocodificação reversa; a coordenada é o dado
 * capturado. Um valor sem barra é coordenada, não endereço.
 */
export function interpretarGeolocalizacao(valor: string | null | undefined): Geolocalizacao {
  if (!valor) return {};
  const [coords, endereco] = valor.split('|');
  return {
    coordenadas: coords?.trim() || undefined,
    endereco: endereco?.trim() || undefined,
  };
}

/**
 * O e-mail que o fluxo público inventa para quem assina por link.
 *
 * `public+<algo>@crm.local` não é endereço de ninguém: é chave interna. Impresso
 * no laudo, ele apareceria como se fosse o contato do signatário — um dado
 * falso num documento de prova.
 */
export function ehEmailInternoDePlaceholder(email: string | null | undefined): boolean {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return false;
  return e.startsWith('public+') && e.endsWith('@crm.local');
}

/** Aceita `Date`, ISO, ou nada — e devolve `null` em vez de `Invalid Date`. */
export function paraData(valor: string | Date | null | undefined): Date | null {
  if (!valor) return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Data e hora no fuso do escritório.
 *
 * `withSeconds` não é enfeite: na trilha, o aceite dos termos e a assinatura
 * caem no mesmo minuto o tempo todo, e sem os segundos os dois eventos parecem
 * simultâneos — justamente onde a ordem importa.
 *
 * O texto de ausência é `Nao informado`, sem acento, igual ao do cliente: os
 * dois lados são comparados na bancada e uma diferença de acento apareceria
 * como divergência de conteúdo.
 */
export function formatarDataHoraDoEscritorio(
  valor: string | Date | null | undefined,
  opcoes?: { comSegundos?: boolean },
): string {
  const partes = partesNoFuso(valor, FUSO_DO_ESCRITORIO, opcoes);
  return partes ? `${partes.data}, ${partes.hora}` : 'Nao informado';
}

/**
 * O fuso de BRASÍLIA — o relógio dos prazos processuais.
 *
 * O escritório é UTC-4 e Brasília é UTC-3: uma hora de diferença, o ano
 * inteiro (o horário de verão acabou em 2019). Num documento que vira prova,
 * "17:57" sem dizer de onde é uma afirmação ambígua, e a ambiguidade cai
 * justamente sobre a hora de um ato jurídico.
 */
export const FUSO_DE_BRASILIA = 'America/Sao_Paulo';

/** Data e hora separadas, num fuso. `null` quando não há instante. */
function partesNoFuso(
  valor: string | Date | null | undefined,
  fuso: string,
  opcoes?: { comSegundos?: boolean },
): { data: string; hora: string } | null {
  const data = paraData(valor);
  if (!data) return null;

  // `formatToParts` em vez de partir a string formatada: o separador entre data
  // e hora muda com a implementação de `Intl`, e um `split(', ')` que falhasse
  // devolveria hora vazia sem erro nenhum.
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso,
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    ...(opcoes?.comSegundos ? { second: '2-digit' as const } : {}),
  }).formatToParts(data);

  const de = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  const hora = [de('hour'), de('minute'), ...(opcoes?.comSegundos ? [de('second')] : [])]
    .filter(Boolean).join(':');
  return { data: `${de('day')}/${de('month')}/${de('year')}`, hora };
}

/** Data e hora no fuso de Brasília. */
export function formatarDataHoraDeBrasilia(
  valor: string | Date | null | undefined,
  opcoes?: { comSegundos?: boolean },
): string {
  const partes = partesNoFuso(valor, FUSO_DE_BRASILIA, opcoes);
  return partes ? `${partes.data}, ${partes.hora}` : 'Nao informado';
}

/**
 * O MESMO instante nos dois relógios, para os momentos que o laudo AFIRMA.
 *
 * A data de Brasília só é repetida quando ela DIFERE — e ela difere de
 * verdade: das 23h às 24h em Cuiabá, Brasília já virou o dia. Omitir a data
 * nessa faixa faria o documento dizer que o ato foi praticado às 00:12 do dia
 * anterior. É a hora em que menos se quer estar errado, e é por isso que a
 * regra tem teste próprio.
 */
export function formatarDataHoraNosDoisFusos(
  valor: string | Date | null | undefined,
  opcoes?: { comSegundos?: boolean },
): string {
  const cuiaba = partesNoFuso(valor, FUSO_DO_ESCRITORIO, opcoes);
  const brasilia = partesNoFuso(valor, FUSO_DE_BRASILIA, opcoes);
  if (!cuiaba || !brasilia) return 'Nao informado';

  const ladoDeBrasilia = brasilia.data === cuiaba.data
    ? brasilia.hora
    : `${brasilia.data}, ${brasilia.hora}`;
  return `${cuiaba.data}, ${cuiaba.hora} (Cuiabá) · ${ladoDeBrasilia} (Brasília)`;
}
