/**
 * QUEM PODE DISCAR — a regra, sem banco nenhum.
 *
 * O discador nasceu sem porteiro: ele foi montado na raiz do app (ver
 * `WaCallsHost`) para atravessar o CRM inteiro, e atravessar o CRM inteiro
 * acabou significando "aparecer para qualquer um que consiga fazer login" —
 * inclusive para quem não enxerga a inbox no menu. Uma ligação que sai daqui
 * sai pelo WhatsApp DO ESCRITÓRIO: é o número do escritório que aparece no
 * celular do cliente e é na conversa do escritório que ela deixa rastro. Não é
 * uma ação que se libera por descuido.
 *
 * A ESCADA COMPLETA, decidida com o escritório em 19/08/2026, tem dois degraus:
 *
 *   1. CARGO — a pessoa trabalha com atendimento? (é o que este módulo decide)
 *   2. CANAL — de qual LINHA ela pode ligar? (`whatsapp_channel_members`, ainda
 *      por fazer; hoje o serviço de voz tem uma conta pareada só e não há de
 *      qual escolher)
 *
 * Aqui está o primeiro degrau, e ele reaproveita a permissão que já existe em
 * vez de inventar um módulo novo: quem pode VER o WhatsApp pode LIGAR pelo
 * WhatsApp. Um módulo "Ligações" separado na tela de Permissões criaria a
 * combinação sem sentido de quem disca para um cliente e não pode abrir a
 * conversa dele depois.
 *
 * PURO DE PROPÓSITO: nenhum import, como em `callRouting` e `dialerInput`. É o
 * que permite testar a regra com `node --test` sem cliente Supabase nenhum —
 * quem BUSCA os dados é `dialPermissionData.ts`.
 */

/** O que a regra precisa saber sobre uma pessoa para responder sim ou não. */
export interface DialPermissionInput {
  /** `profiles.role`, como está escrito no perfil (texto livre, com maiúsculas). */
  role: string | null;
  /** `role_permissions.can_view` do módulo `whatsapp` para o cargo dela. */
  moduleCanView: boolean;
  /** Concessão individual do módulo `whatsapp` (`user_module_overrides`) ainda válida. */
  overrideCanView: boolean;
}

/**
 * O cargo sem acento e sem caixa. O campo é texto livre digitado na tela de
 * usuários ("Administrador", "administrador", "Estagiário"), e a tabela de
 * permissões guarda a forma normalizada — a mesma conta de `usePermissions`.
 */
export function normalizeRole(role: string | null): string {
  return (role || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** Administrador passa por cima de tudo, como no resto do CRM. */
export function isAdminRole(role: string | null): boolean {
  return normalizeRole(role) === 'administrador';
}

/**
 * A concessão individual ainda vale?
 *
 * `expires_at` nulo é permanente. A comparação é feita aqui, e não no banco,
 * porque o override vence com a aba aberta: quem recebeu acesso por duas horas
 * precisa perder o discador quando as duas horas acabarem, sem recarregar nada.
 */
export function overrideIsActive(expiresAt: string | null | undefined, now: number): boolean {
  if (!expiresAt) return true;
  const fim = Date.parse(expiresAt);
  return Number.isNaN(fim) ? true : fim > now;
}

/**
 * Pode discar?
 *
 * Repare que só `can_view` conta. O cargo "auxiliar" hoje está cadastrado com
 * `can_view = false` e `can_create = true` — uma combinação que a tela de
 * Permissões deixa montar e que, lida ao pé da letra, diria "pode mandar
 * mensagem mas não pode ver a conversa". Para o telefone isso não serve: quem
 * não pode abrir a conversa não tem onde acompanhar a ligação que fez.
 */
export function canDial(input: DialPermissionInput): boolean {
  if (isAdminRole(input.role)) return true;
  if (input.overrideCanView) return true;
  return input.moduleCanView;
}

/** O recado de quem não pode. Diz o que fazer, não só que não deu. */
export const DIAL_DENIED_MESSAGE = 'Você não tem permissão para ligar pelo CRM.';
export const DIAL_DENIED_DETAIL =
  'As ligações saem pelo WhatsApp do escritório. Peça a um administrador o acesso ao módulo WhatsApp.';

/**
 * O recado de quando a pergunta não pôde ser feita (consulta falhou, sessão
 * ainda carregando). Diferente do "não pode" de propósito: mandar alguém pedir
 * permissão que ela já tem é pior do que pedir para tentar de novo.
 */
export const DIAL_UNKNOWN_MESSAGE = 'Não foi possível confirmar sua permissão para ligar.';
export const DIAL_UNKNOWN_DETAIL = 'Tente de novo em alguns segundos.';
