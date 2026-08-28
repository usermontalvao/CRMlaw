/**
 * O AVISO DE PERÍCIA — modelos e montagem.
 *
 * Mora aqui, e não dentro do módulo de Requerimentos, porque dois lugares
 * precisam do mesmo texto: o modal que agenda a perícia e a tela de
 * Configurações onde o modelo do escritório é editado. Duas cópias divergiriam
 * no primeiro ajuste.
 *
 * Sem imports de propósito: módulo puro, para o `node --test` carregá-lo sem
 * arrastar a cadeia do cliente do Supabase (ver as notas sobre ts-node).
 */

/** Qual das duas perícias. A SOCIAL vem primeiro — é a ordem do Meu INSS. */
export type PericiaKind = 'social' | 'medica';

export const PERICIA_LABEL: Record<PericiaKind, string> = {
  social: 'perícia social',
  medica: 'perícia médica',
};

/** Chave do modelo do escritório em `system_settings`. */
export const PERICIA_AVISO_SETTING_KEY = 'requirements_pericia_notice_templates';

export interface PericiaAvisoTemplates {
  social: string;
  medica: string;
}

/**
 * O lembrete que o cliente recebe alguns dias antes da perícia.
 *
 * Tudo que o cabeçalho diz sai do requerimento — protocolo, benefício, data e
 * local — porque é exatamente o que a pessoa não guardou: quem falta à perícia
 * raramente esqueceu que ela existe, esqueceu ONDE e A QUE HORAS.
 *
 * ── UM MODELO PARA CADA PERÍCIA ─────────────────────────────────────────────
 *
 * São duas avaliações diferentes, e o que se leva numa não serve para a outra:
 *
 *  · A MÉDICA olha a doença. Vale o que prova a limitação: laudos, exames,
 *    receitas, relatório do médico que acompanha.
 *
 *  · A SOCIAL olha como a família VIVE. Quem faz é assistente social, e o que
 *    ela precisa ver são as DESPESAS da casa — água, luz, telefone, gás,
 *    aluguel, mercado, remédios — e a renda de todo mundo que mora ali. Levar
 *    laudo para a social é chegar de mãos vazias.
 *
 * Mandar o texto da médica na social foi o primeiro erro encontrado quando este
 * aviso ainda tinha um modelo só.
 *
 * Isto aqui é o texto DE FÁBRICA: o escritório edita o seu em Configurações →
 * Requerimentos, e é para cá que o botão "Restaurar padrão" volta.
 */
export const PERICIA_AVISO_PADRAO: PericiaAvisoTemplates = {
  social: `Olá, *{nome}*! Passando para lembrar da sua *{tipo}* do INSS.

📅 {data}
📍 {local}
📄 Protocolo: {protocolo}
🏷️ Benefício: {beneficio}

*Leve os comprovantes de despesas da casa:* água, luz, telefone/internet, gás, aluguel, compras de mercado e remédios.

Leve também documento oficial com foto, CPF, comprovante de residência e o que mostrar a renda de todos que moram na casa.

⚠️ {instrucoes}

A perícia social avalia como a família vive — o que entra e o que sai. Qualquer dúvida, estou à disposição!`,
  medica: `Olá, *{nome}*! Passando para lembrar da sua *{tipo}* do INSS.

📅 {data}
📍 {local}
📄 Protocolo: {protocolo}
🏷️ Benefício: {beneficio}

*Leve todos os laudos, exames e receitas* que você tiver, mesmo os mais antigos, junto com documento oficial com foto.

⚠️ {instrucoes}

Qualquer dúvida, estou à disposição!`,
};

/**
 * Devolve modelos utilizáveis a partir do que estava salvo.
 *
 * Configuração ausente, corrompida ou com um dos lados em branco cai no padrão
 * de fábrica — daquele lado só. Um modelo vazio produziria mensagem vazia, e a
 * fila do WhatsApp aceitaria sem reclamar.
 */
export function normalizarTemplatesDoAviso(bruto: unknown): PericiaAvisoTemplates {
  const obj = (bruto ?? {}) as Partial<PericiaAvisoTemplates>;
  const usar = (valor: unknown, padrao: string) =>
    typeof valor === 'string' && valor.trim() ? valor : padrao;
  return {
    social: usar(obj.social, PERICIA_AVISO_PADRAO.social),
    medica: usar(obj.medica, PERICIA_AVISO_PADRAO.medica),
  };
}

export interface AvisoPericiaDados {
  nome: string;
  tipo: string;
  data: string;
  local: string;
  protocolo: string;
  beneficio: string;
  /** O que só ESTA perícia pede. Vazio some com a linha inteira. */
  instrucoes: string;
}

/** Os campos que o modelo aceita, para a ajuda ao lado do editor. */
export const PERICIA_AVISO_CAMPOS = [
  '{nome}', '{tipo}', '{data}', '{local}', '{instrucoes}', '{protocolo}', '{beneficio}',
] as const;

/**
 * Preenche o modelo do aviso.
 *
 * A linha entra INTEIRA ou não entra. Requerimento sem protocolo ou perícia
 * sem endereço cadastrado não podem virar um "📍 —" no WhatsApp do cliente:
 * some a linha e o resto do recado continua correto.
 */
export function montarAvisoPericia(template: string, dados: AvisoPericiaDados): string {
  const vazios = (['local', 'protocolo', 'beneficio', 'data', 'instrucoes'] as const)
    .filter((campo) => !String(dados[campo] ?? '').trim());
  const linhas = template
    .split('\n')
    .filter((linha) => !vazios.some((campo) => linha.includes(`{${campo}}`)));
  return linhas
    .join('\n')
    .replace(/{nome}/g, dados.nome)
    .replace(/{tipo}/g, dados.tipo)
    .replace(/{data}/g, dados.data)
    .replace(/{local}/g, dados.local)
    .replace(/{protocolo}/g, dados.protocolo)
    .replace(/{beneficio}/g, dados.beneficio)
    .replace(/{instrucoes}/g, dados.instrucoes)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Quando o aviso sai: `dias` antes da perícia, na hora escolhida.
 *
 * Data local montada por partes (e não por string ISO) porque o agendamento é
 * do fuso de quem lê — o cliente recebe "amanhã de manhã", não um UTC.
 */
export function instanteDoAviso(dateOnly: string, dias: number, hora: string): Date | null {
  const [ano, mes, dia] = (dateOnly || '').split('-').map(Number);
  if (!ano || !mes || !dia) return null;
  const [hh, mm] = (hora || '09:00').split(':').map(Number);
  const dt = new Date(ano, mes - 1, dia, Number.isFinite(hh) ? hh : 9, Number.isFinite(mm) ? mm : 0, 0, 0);
  dt.setDate(dt.getDate() - (Number.isFinite(dias) ? dias : 0));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** "quinta-feira, 25/09/2026 às 09:30" — o formato que vai no aviso. */
export function dataPorExtenso(dateOnly: string, timeOnly: string): string {
  const [ano, mes, dia] = (dateOnly || '').split('-').map(Number);
  if (!ano || !mes || !dia) return '';
  const dt = new Date(ano, mes - 1, dia);
  if (Number.isNaN(dt.getTime())) return '';
  const semana = dt.toLocaleDateString('pt-BR', { weekday: 'long' });
  const curta = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return timeOnly ? `${semana}, ${curta} às ${timeOnly}` : `${semana}, ${curta}`;
}
