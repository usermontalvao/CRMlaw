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
  /**
   * De qual canal sai a COMUNICAÇÃO AO CLIENTE da Agenda.
   *
   * Campo próprio, e não o `default_channel_id`: aquele é o canal por onde o
   * escritório fala consigo mesmo (avisos de prazo à equipe), e este é o número
   * que o CLIENTE vê chegar. Podem coincidir — hoje coincidem — mas são
   * decisões diferentes, e amarrá-las faria trocar o canal dos avisos internos
   * mudar de qual número o cliente recebe a audiência.
   *
   * Só vale quando o cliente NÃO tem conversa aberta: tendo, a mensagem sai
   * pela conversa dele, para não abrir uma segunda thread com o escritório.
   */
  client_channel_id: string | null;
  eventos: Record<string, NotificacaoWhatsAppEventoConfig>;
}

export const NOTIF_WA_CONFIG_PADRAO: NotificacaoWhatsAppConfig = {
  enabled: false,
  default_channel_id: null,
  client_channel_id: null,
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
    client_channel_id: texto(obj.client_channel_id),
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

// ── A CADÊNCIA DOS AVISOS DE PRAZO ──────────────────────────────────────────
//
// Escrito em 01/09/2026, depois de medir o que a advogada recebia: UM prazo
// ("CONTRAMINUTA AO A.I", venc. 27/08) gerou DOZE avisos em seis dias, e o
// volume dela saltou de 2 por dia para 12 num só dia.
//
// A conta que produzia isso:
//
//   • o lembrete disparava TODO DIA desde "avisar N dias antes" até o
//     vencimento — a comparação era `faltam > avisar_antes`, e não `===`;
//   • o vencido recomeçava TODO DIA, sem fim, até alguém marcar o prazo como
//     concluído — foram 8 dos 12;
//   • e cada disparo saía três vezes, uma por canal.
//
// Nada disso era defeito de código: era a regra funcionando como foi escrita.
// O que mudou foi a leitura do escritório sobre ela — repetir a mesma frase
// todo dia treina a pessoa a ignorar, e um aviso ignorado não protege prazo
// nenhum.
//
// As duas funções abaixo são a regra nova, isoladas do `notification-scheduler`
// para poderem ser testadas sem subir a função. Elas decidem SE o aviso sai
// hoje; quem decide por quais canais continua sendo `notification_rules`.

/**
 * O lembrete de "prazo vencendo" sai UMA VEZ SÓ, no dia exato que o prazo pede
 * — e SEMPRE no dia do vencimento.
 *
 * Antes, `faltam > avisar_antes` deixava passar todos os dias abaixo do teto:
 * com "avisar 2 dias antes" o aviso saía em D−2, D−1 e D−0. Agora é igualdade —
 * um prazo, um lembrete.
 *
 * O dia do vencimento (`faltam === 0`) é a exceção, e não depende de
 * configuração nenhuma. Esse aviso já existia e sempre saiu: quem o mandava era
 * a cobrança de VENCIDO, que chamava de "vencido" um prazo com o dia inteiro
 * pela frente. Ele continua saindo no mesmo dia — só deixou de mentir no
 * título, e mudou de porta.
 *
 * Fora o dia do vencimento, devolve `false` para configuração ausente ou
 * negativa: sem "quantos dias antes" não há dia certo para avisar.
 */
export function deveLembrarDoPrazo(
  diasQueFaltam: number,
  avisarDiasAntes: number | null | undefined,
): boolean {
  if (!Number.isFinite(diasQueFaltam) || diasQueFaltam < 0) return false;
  if (diasQueFaltam === 0) return true;
  if (avisarDiasAntes === null || avisarDiasAntes === undefined) return false;
  if (!Number.isFinite(avisarDiasAntes) || avisarDiasAntes < 0) return false;
  return diasQueFaltam === avisarDiasAntes;
}

/**
 * Os dias de ATRASO em que o aviso de prazo vencido ainda sai: o primeiro dia
 * depois do vencimento e mais uma insistência no terceiro. Depois disso,
 * silêncio.
 *
 * Não é desistir do prazo — é parar de gritar. Quem não agiu no dia seguinte
 * nem três dias depois não vai agir no décimo aviso idêntico, e o prazo
 * continua na lista de pendentes, no painel e no relatório. O que acaba é a
 * repetição diária no telefone de alguém.
 *
 * A lista começava em 0 — o PRÓPRIO dia do vencimento. Era isso que mandava
 * "Prazo vencido" para um prazo que vence hoje, com o corpo do e-mail dizendo
 * "Vence hoje!" duas linhas abaixo, e que subia a escada para a administração
 * antes de o responsável ter perdido coisa nenhuma. Vencer é o fim do dia, não
 * o começo: o dia do vencimento virou lembrete (`deveLembrarDoPrazo`) e a
 * cobrança abre no dia seguinte.
 */
export const DIAS_DE_COBRANCA_DO_VENCIDO = [1, 3] as const;

/**
 * O aviso de vencido sai hoje?
 *
 * `diasVencido` é quantos dias de CALENDÁRIO se passaram desde o vencimento —
 * 0 no próprio dia do vencimento, 1 no dia seguinte (ver `diasDeAtraso`). O 0 e
 * os negativos nunca cobram: o prazo ainda não venceu.
 */
export function deveCobrarPrazoVencido(diasVencido: number): boolean {
  if (!Number.isFinite(diasVencido)) return false;
  return (DIAS_DE_COBRANCA_DO_VENCIDO as readonly number[]).includes(diasVencido);
}

// ── QUE DIA VENCE, E QUE DIA É HOJE ─────────────────────────────────────────
//
// `deadlines.due_date` é `timestamptz`, mas o que está gravado ali é DIA DE
// CALENDÁRIO: a meia-noite UTC do dia do vencimento — `2026-09-02 00:00+00` é
// "2 de setembro", e não um instante que alguém escolheu. Medir a diferença em
// milissegundos entre esse instante e o relógio responde a pergunta errada, e
// errava duas vezes:
//   • o prazo virava "vencido" à 00:00 UTC, que é 20:00 do dia ANTERIOR no
//     escritório (America/Cuiaba, UTC−4);
//   • e a conta dava 0 dia de atraso durante todo o dia do vencimento, o que
//     deixava a cobrança de vencido disparar num prazo que ainda vence.
//
// A conta certa compara DIAS: o dia do vencimento (lido em UTC, porque é assim
// que ele foi gravado) contra o dia de hoje no fuso do escritório. É a mesma
// disciplina de `_shared/intimation-deadline.ts` — data de prazo é dia de
// calendário, não instante.

/**
 * Fuso que define QUE DIA é hoje para o escritório.
 *
 * A mesma constante aparece em `deadline-automations/rules.ts`
 * (`OFFICE_TIME_ZONE`) e em `wa-channel-hours.ts` (`FUSO_PADRAO_ESCRITORIO`).
 * A cópia não é descuido: este arquivo é espelhado byte a byte em `src/utils/`
 * e por isso não pode importar nada. Mudar de cidade exige mudar os três.
 */
export const FUSO_DO_ESCRITORIO = 'America/Cuiaba';

/** O dia de calendário ('YYYY-MM-DD') gravado em `due_date`. */
export function diaDoVencimento(vencimento: string | Date | null | undefined): string | null {
  if (!vencimento) return null;
  if (vencimento instanceof Date) {
    return Number.isNaN(vencimento.getTime()) ? null : vencimento.toISOString().slice(0, 10);
  }
  const texto = String(vencimento).trim();
  const direto = texto.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direto) return direto[1];
  const ms = Date.parse(texto);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 10);
}

/** Hoje ('YYYY-MM-DD') no fuso do escritório. */
export function diaDeHoje(agora: Date = new Date(), fuso: string = FUSO_DO_ESCRITORIO): string {
  // 'en-CA' já formata em ISO ('2026-09-02'); montar a string na mão a partir
  // de `formatToParts` é o mesmo resultado com mais chance de erro.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora);
}

/**
 * O instante que ABRE um dia de calendário, no formato em que `due_date` está
 * gravado. É o que permite cortar "vence hoje" de "venceu antes de hoje" na
 * própria consulta, em vez de trazer todos os pendentes para a memória.
 */
export function inicioDoDia(dia: string): string {
  return `${dia}T00:00:00.000Z`;
}

const DIA_EM_MS = 86400000;

const diaEmMs = (dia: string): number => {
  const [ano, mes, d] = dia.split('-').map(Number);
  return Date.UTC(ano, mes - 1, d);
};

/**
 * Dias de atraso: 0 no dia do vencimento, 1 no dia seguinte, negativo enquanto
 * o prazo ainda está por vencer. `null` quando a data não dá para ler.
 */
export function diasDeAtraso(
  vencimento: string | Date | null | undefined,
  agora: Date = new Date(),
  fuso: string = FUSO_DO_ESCRITORIO,
): number | null {
  const dia = diaDoVencimento(vencimento);
  if (!dia) return null;
  return Math.round((diaEmMs(diaDeHoje(agora, fuso)) - diaEmMs(dia)) / DIA_EM_MS);
}

/** Dias que faltam: 0 quando vence hoje, negativo quando já venceu. */
export function diasParaVencer(
  vencimento: string | Date | null | undefined,
  agora: Date = new Date(),
  fuso: string = FUSO_DO_ESCRITORIO,
): number | null {
  const atraso = diasDeAtraso(vencimento, agora, fuso);
  if (atraso === null) return null;
  // `-0` é o mesmo número para a aritmética e um valor DIFERENTE para
  // `===`/`Object.is` e para o `assert.strictEqual` — trocar o sinal do zero
  // faria "vence hoje" falhar uma comparação que o resto do arquivo passa.
  return atraso === 0 ? 0 : -atraso;
}
