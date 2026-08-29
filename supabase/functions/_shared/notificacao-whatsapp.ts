/**
 * NOTIFICAÇÃO POR WHATSAPP — a régua compartilhada.
 *
 * O CRM já avisava por dois canais: o sino (push) e o e-mail. Os dois nascem
 * dentro do sistema e esperam que a pessoa ENTRE nele para ver. O WhatsApp é o
 * primeiro canal que vai atrás de quem precisa saber — e por isso é o primeiro
 * que pode incomodar. Tudo aqui existe para que ele incomode pouco e na hora
 * certa.
 *
 * ── ONDE ISTO É LIDO ────────────────────────────────────────────────────────
 *
 *  · Configurações → Notificações → Regras, para desenhar a tela: quais eventos
 *    aceitam WhatsApp, que campos o modelo entende, qual o texto de fábrica.
 *  · `notification-scheduler` (Edge Function, de hora em hora), para montar a
 *    mensagem que sai de verdade.
 *
 * Os dois lados precisam da MESMA resposta — um modelo que a tela mostra e o
 * scheduler não entende vira aviso vazio no telefone de alguém. Por isso este
 * arquivo tem espelho byte a byte em `supabase/functions/_shared/`, e um teste
 * que quebra quando os dois divergem.
 *
 * Sem imports de propósito: módulo puro, para o `node --test` carregá-lo sem
 * arrastar a cadeia do cliente do Supabase (ver as notas sobre ts-node).
 */

/** Chave única em `system_settings`. */
export const NOTIF_WA_SETTING_KEY = 'notification_whatsapp_config';

/**
 * Para quem o aviso vai — e é uma diferença de natureza, não de rótulo.
 *
 *  · `equipe`  → telefone do PERFIL de quem trabalha aqui. Sem telefone
 *    cadastrado não há aviso, e a conversa nasce marcada como interna.
 *  · `cliente` → telefone do cliente, na conversa normal de atendimento.
 */
export type NotificacaoWhatsAppDestino = 'equipe' | 'cliente';

export interface NotificacaoWhatsAppEvento {
  /** Mesma chave do gatilho em `NOTIFICATION_TRIGGERS`. */
  key: string;
  label: string;
  grupo: string;
  destino: NotificacaoWhatsAppDestino;
  /** Os campos que o modelo aceita, para a ajuda ao lado do editor. */
  campos: readonly string[];
  /** `null` = o texto tem editor próprio noutro lugar (ver `textoEm`). */
  padrao: string | null;
  textoEm?: string;
}

/**
 * OS EVENTOS QUE JÁ SAEM POR WHATSAPP.
 *
 * A lista é curta de propósito. O catálogo de gatilhos tem mais de quarenta
 * entradas, e ligar WhatsApp em todas seria transformar o telefone do escritório
 * num alarme. Cada evento entra aqui quando existe alguém que precisa saber
 * FORA do CRM — e essa é a pergunta que decide, não a importância do evento.
 *
 * Um gatilho que não está nesta lista aparece na tela com o WhatsApp apagado:
 * não é esquecimento, é "ainda não".
 */
export const NOTIF_WA_EVENTOS: readonly NotificacaoWhatsAppEvento[] = [
  {
    key: 'deadline_assigned',
    label: 'Prazo atribuído',
    grupo: 'Prazos',
    destino: 'equipe',
    campos: ['{primeiro_nome}', '{responsavel}', '{titulo}', '{vencimento}', '{cliente}', '{processo}', '{prioridade}'],
    padrao: `Olá, *{primeiro_nome}*! Um prazo ficou sob a sua responsabilidade.

📌 *{titulo}*
📅 Vence em {vencimento}
👤 Cliente: {cliente}
⚖️ Processo: {processo}
🔺 Prioridade: {prioridade}

Ele já está na sua lista de prazos no CRM.`,
  },
  {
    key: 'deadline_due',
    label: 'Prazo vencendo em breve',
    grupo: 'Prazos',
    destino: 'equipe',
    campos: ['{primeiro_nome}', '{responsavel}', '{titulo}', '{vencimento}', '{quando}', '{cliente}', '{processo}', '{prioridade}'],
    padrao: `Olá, *{primeiro_nome}*! Lembrete de prazo.

⏳ *{titulo}*
📅 Vence {quando} — {vencimento}
👤 Cliente: {cliente}
⚖️ Processo: {processo}
🔺 Prioridade: {prioridade}

Confira no CRM para não perder a data.`,
  },
  {
    key: 'deadline_overdue',
    label: 'Prazo vencido sem cumprimento',
    grupo: 'Prazos',
    destino: 'equipe',
    campos: ['{primeiro_nome}', '{responsavel}', '{titulo}', '{vencimento}', '{quando}', '{cliente}', '{processo}'],
    padrao: `Atenção, *{primeiro_nome}*: prazo VENCIDO sem cumprimento.

🚨 *{titulo}*
📅 Venceu {quando} — {vencimento}
👤 Cliente: {cliente}
⚖️ Processo: {processo}

Cumpra ou baixe o prazo no CRM.`,
  },
  {
    key: 'deadline_overdue_admin',
    label: 'Prazo vencido — aviso à administração',
    grupo: 'Prazos',
    destino: 'equipe',
    campos: ['{primeiro_nome}', '{responsavel}', '{telefone_responsavel}', '{link_cobranca}', '{titulo}', '{vencimento}', '{quando}', '{cliente}', '{processo}'],
    padrao: `*{primeiro_nome}*, um prazo do escritório venceu sem cumprimento.

🚨 *{titulo}*
📅 Venceu {quando} — {vencimento}
👤 Cliente: {cliente}
⚖️ Processo: {processo}

🧑‍⚖️ Responsável: *{responsavel}*
📞 {telefone_responsavel}
➡️ Falar agora: {link_cobranca}`,
  },
  {
    key: 'pericia_reminder',
    label: 'Lembrete de perícia ao cliente',
    grupo: 'Requerimentos',
    destino: 'cliente',
    campos: ['{nome}', '{tipo}', '{data}', '{local}', '{instrucoes}', '{protocolo}', '{beneficio}'],
    // São DOIS textos (social e médica), com editor próprio — um campo só aqui
    // esconderia essa diferença, e mandar o texto da médica na social é
    // exatamente o erro que aquele editor existe para evitar.
    padrao: null,
    textoEm: 'Configurações → Módulos → Requerimentos',
  },
];

/** O evento, se ele aceita WhatsApp. `null` para qualquer outro gatilho. */
export function eventoWhatsApp(key: string): NotificacaoWhatsAppEvento | null {
  return NOTIF_WA_EVENTOS.find((ev) => ev.key === key) ?? null;
}

export interface NotificacaoWhatsAppEventoConfig {
  /** `null` = usa o canal padrão do escritório. */
  channel_id: string | null;
  /** `null` = usa o texto de fábrica. */
  template: string | null;
}

export interface NotificacaoWhatsAppConfig {
  /** Chave geral: desligada, nenhum aviso sai por WhatsApp, regra ligada ou não. */
  enabled: boolean;
  /** De qual canal saem os avisos, quando o evento não escolhe outro. */
  default_channel_id: string | null;
  eventos: Record<string, NotificacaoWhatsAppEventoConfig>;
}

export const NOTIF_WA_CONFIG_PADRAO: NotificacaoWhatsAppConfig = {
  enabled: false,
  default_channel_id: null,
  eventos: {},
};

/**
 * Devolve uma configuração utilizável a partir do que estava salvo.
 *
 * Nasce DESLIGADA: um `enabled` ausente lido como verdadeiro faria o primeiro
 * deploy mandar mensagem para o telefone pessoal de todo mundo sem ninguém ter
 * pedido. Só um `true` explícito liga.
 */
export function normalizarConfigWhatsApp(bruto: unknown): NotificacaoWhatsAppConfig {
  const obj = (bruto ?? {}) as Partial<NotificacaoWhatsAppConfig>;
  const texto = (valor: unknown): string | null =>
    typeof valor === 'string' && valor.trim() ? valor : null;

  const eventos: Record<string, NotificacaoWhatsAppEventoConfig> = {};
  const salvos = (obj.eventos ?? {}) as Record<string, unknown>;
  for (const ev of NOTIF_WA_EVENTOS) {
    const linha = (salvos[ev.key] ?? {}) as Partial<NotificacaoWhatsAppEventoConfig>;
    eventos[ev.key] = {
      channel_id: texto(linha.channel_id),
      template: ev.padrao === null ? null : texto(linha.template),
    };
  }

  return {
    enabled: obj.enabled === true,
    default_channel_id: texto(obj.default_channel_id),
    eventos,
  };
}

/**
 * De qual canal sai o aviso deste evento.
 *
 * A exceção do evento ganha do padrão do escritório; sem nenhum dos dois,
 * devolve `null` — e quem chama NÃO deve escolher um canal por conta própria.
 * Mandar mensagem de um número que ninguém definiu é pior que não mandar: o
 * cliente recebe de um desconhecido e o escritório não sabe de onde saiu.
 */
export function canalDaNotificacao(config: NotificacaoWhatsAppConfig, key: string): string | null {
  return config.eventos[key]?.channel_id ?? config.default_channel_id ?? null;
}

/** O texto em vigor: o do escritório, ou o de fábrica. Vazio quando o editor é outro. */
export function templateDaNotificacao(config: NotificacaoWhatsAppConfig, key: string): string {
  const ev = eventoWhatsApp(key);
  if (!ev) return '';
  return config.eventos[key]?.template ?? ev.padrao ?? '';
}

/**
 * Preenche o modelo.
 *
 * A LINHA ENTRA INTEIRA OU NÃO ENTRA — mesma regra do aviso de perícia, e pelo
 * mesmo motivo. Prazo sem processo vinculado não pode virar "⚖️ Processo: —" no
 * WhatsApp de ninguém: some a linha e o recado continua correto.
 *
 * A primeira versão disto era mais esperta: só apagava a linha quando o campo
 * era a razão de ela existir, para que "Olá, {primeiro_nome}!" sobrevivesse a um
 * nome em branco. O teste mostrou o preço — "👤 Cliente: {cliente}" deixa
 * "👤 Cliente:" atrás de si, porque a palavra "Cliente" também é texto. Distinguir
 * rótulo de recado exigiria o modelo declarar qual é qual, e quem escreve o
 * modelo é o escritório, na tela. Some a linha: é a regra que já vale na
 * perícia, e a que dá para explicar em uma frase.
 */
export function montarMensagemNotificacao(template: string, dados: Record<string, string>): string {
  const chaves = Object.keys(dados);
  const vazias = chaves.filter((chave) => !String(dados[chave] ?? '').trim());
  const linhas = template
    .split('\n')
    .filter((linha) => !vazias.some((chave) => linha.includes(`{${chave}}`)));
  let texto = linhas.join('\n');
  for (const chave of chaves) {
    texto = texto.split(`{${chave}}`).join(String(dados[chave] ?? '').trim());
  }
  return texto
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((linha) => linha.replace(/[ \t]+$/, ''))
    .join('\n')
    .trim();
}

/**
 * O telefone em formato internacional, só dígitos — o que o `wa.me` exige.
 *
 * Os telefones dos perfis são guardados como o brasileiro escreve: DDD + número,
 * onze dígitos, sem país. O `wa.me` sem o 55 abre uma conversa com um número
 * errado em OUTRO país, e o pior é que ele abre — não dá erro, dá a pessoa
 * errada. Então:
 *
 *  · 10 ou 11 dígitos → é brasileiro sem país, entra o 55;
 *  · 12 ou 13 começando em 55 → já veio completo;
 *  · qualquer outra coisa → devolve vazio, e a linha do link some.
 *
 * Devolver vazio é a resposta certa para o que não se reconhece: um link que
 * leva ao lugar errado é pior que link nenhum.
 */
export function telefoneInternacional(bruto: string | null | undefined): string {
  const digitos = String(bruto ?? '').replace(/\D/g, '');
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) return digitos;
  return '';
}

/** "5565999998888" → "(65) 99999-8888". Fora do padrão, devolve o que recebeu. */
export function telefoneLegivel(bruto: string | null | undefined): string {
  const digitos = String(bruto ?? '').replace(/\D/g, '');
  const local = digitos.startsWith('55') && digitos.length > 11 ? digitos.slice(2) : digitos;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return String(bruto ?? '').trim();
}

/**
 * O LINK QUE JÁ VAI COM A CONVERSA COMEÇADA.
 *
 * Avisar o admin de que um prazo venceu e deixar que ele procure o telefone do
 * responsável na agenda é entregar metade do trabalho. O `wa.me` com `?text=`
 * abre a conversa com a cobrança já escrita — resta apertar enviar.
 *
 * Telefone irreconhecível devolve vazio para que a linha inteira do link suma,
 * pela mesma regra de todo campo vazio.
 */
export function linkCobrancaWhatsApp(telefone: string | null | undefined, texto: string): string {
  const numero = telefoneInternacional(telefone);
  if (!numero) return '';
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

/** "Pedro Rodrigues" → "Pedro". Vazio devolve vazio, sem inventar tratamento. */
export function primeiroNome(nome: string | null | undefined): string {
  const limpo = String(nome ?? '').trim();
  if (!limpo) return '';
  return limpo.split(/\s+/)[0];
}

/**
 * DÁ PARA MANDAR AGORA?
 *
 * O `notification-scheduler` roda de hora em hora, nas 24 horas do dia. Push e
 * e-mail podem sair às 3h da manhã sem custo: ficam esperando alguém abrir. Uma
 * mensagem de WhatsApp às 3h ACORDA a pessoa — e um lembrete de prazo que
 * chega de madrugada não é mais útil que o mesmo lembrete às 8h.
 *
 * Por isso o aviso à EQUIPE tem trava própria, independente do interruptor
 * "respeitar horário comercial" da regra: aquele é uma preferência, este é o
 * piso. Todos os dias, 08:00–18:00 de Brasília.
 *
 * SÁBADO E DOMINGO ENTRARAM (29/08/2026, decisão do escritório). Até aqui esta
 * trava também barrava o fim de semana, e isso criava uma incoerência que
 * ninguém tinha escolhido: o `notification-scheduler` usa DUAS janelas — a sua
 * própria (`isBusinessHoursNow`, só a hora) para push e e-mail, e esta para o
 * WhatsApp. Resultado: num sábado o aviso de PRAZO VENCIDO saía por push e
 * e-mail e era engolido no WhatsApp — justamente o canal que a pessoa olha no
 * fim de semana. Prazo não espera segunda-feira.
 *
 * O piso de horário fica: a razão dele é não acordar ninguém às 3h, e isso vale
 * igual no domingo.
 *
 * Aviso ao CLIENTE não passa por aqui: ele sai pela fila do WhatsApp, que já
 * tem o expediente do canal — a agenda real do escritório, com sábado, feriado
 * e horário partido, coisa que um intervalo fixo não sabe.
 */
export function dentroDoHorarioDeAviso(agora: Date = new Date()): boolean {
  // Brasília é UTC-3 o ano inteiro desde 2019 (não há mais horário de verão).
  const brasilia = new Date(agora.getTime() - 3 * 60 * 60_000);
  const minutos = brasilia.getUTCHours() * 60 + brasilia.getUTCMinutes();
  return minutos >= 8 * 60 && minutos < 18 * 60;
}
