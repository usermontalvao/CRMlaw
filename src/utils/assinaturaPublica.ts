/**
 * Regras puras das telas públicas de assinatura.
 *
 * Vive sem nenhum import de propósito: é o que `node --test` consegue carregar
 * pelo ts-node sem esbarrar na cadeia de imports do app (ver a armadilha dos
 * imports relativos sem extensão). Tudo aqui é decisão de texto — quem desenha
 * é `components/publicSigning/ui.tsx`.
 */

export type Saudacao = 'Bom dia' | 'Boa tarde' | 'Boa noite';

/**
 * A saudação segue o relógio de QUEM LÊ, não o do escritório.
 *
 * É o oposto da regra da agenda (onde o compromisso pertence ao fuso do foro):
 * aqui a frase é dirigida à pessoa na frente da tela, e "boa tarde" à meia-noite
 * dela é que estaria errado.
 */
export function saudacao(agora: Date = new Date()): Saudacao {
  const hora = agora.getHours();
  if (hora < 12) return 'Bom dia';
  if (hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

/**
 * O primeiro nome, para a abertura tratar a pessoa pelo nome.
 *
 * Preposições ("de", "da", "dos") não são o primeiro nome de ninguém: quando a
 * primeira palavra tem duas letras ou menos, leva a seguinte junto.
 */
export function primeiroNome(nomeCompleto: string | null | undefined): string {
  const limpo = (nomeCompleto || '').trim().replace(/\s+/g, ' ');
  if (!limpo) return '';
  const partes = limpo.split(' ');
  if (partes[0].length <= 2 && partes.length > 1) return `${partes[0]} ${partes[1]}`;
  return partes[0];
}

/**
 * CPF mascarado.
 *
 * A tela pública pode ser fotografada — e a instrução do comprovante é
 * justamente "tire um print". Mostrar CPF inteiro ali seria entregar o número
 * para qualquer um que veja a foto. Sobram os dois grupos do meio, suficientes
 * para a própria pessoa reconhecer que é o CPF dela.
 */
export function mascararCpf(valor: string | null | undefined): string {
  const digitos = (valor || '').replace(/\D/g, '');
  if (digitos.length !== 11) return '';
  return `•••.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-••`;
}

/**
 * O aparelho, lido do próprio navegador — o mesmo dado que vai para o dossiê.
 *
 * Não é detecção séria de user agent e não precisa ser: serve para a pessoa
 * reconhecer "sim, é daqui que estou assinando".
 */
export function descreverAparelho(userAgent: string | null | undefined): string {
  const ua = userAgent || '';
  if (!ua) return '';

  const aparelho =
    /iPad/i.test(ua) ? 'iPad'
    : /iPhone|iPod/i.test(ua) ? 'iPhone'
    : /Android/i.test(ua) ? 'Android'
    : /Macintosh|Mac OS X/i.test(ua) ? 'Mac'
    : /Windows/i.test(ua) ? 'Windows'
    : /Linux|X11/i.test(ua) ? 'Linux'
    : 'Navegador';

  // A ordem importa: no iPhone, o Chrome se anuncia como CriOS E como Safari.
  const navegador =
    /Edg[A-Z]?\//i.test(ua) ? 'Edge'
    : /OPR\/|Opera/i.test(ua) ? 'Opera'
    : /CriOS\//i.test(ua) ? 'Chrome'
    : /FxiOS\//i.test(ua) ? 'Firefox'
    : /Chrome\//i.test(ua) ? 'Chrome'
    : /Firefox\//i.test(ua) ? 'Firefox'
    : /Safari\//i.test(ua) ? 'Safari'
    : '';

  return navegador ? `${aparelho} · ${navegador}` : aparelho;
}

/**
 * Coordenadas como foram coletadas — CRUAS, de propósito.
 *
 * Não existe consulta reversa de endereço neste fluxo: transformar isto em
 * "Cuiabá, MT" exigiria um serviço externo que hoje não é chamado em lugar
 * nenhum. Escrever um nome de cidade sem esse serviço seria inventar.
 *
 * O sinal de menos é o U+2212 (−), não o hífen: alinha melhor com dígitos
 * tabulares e não quebra a linha no meio da coordenada.
 */
export function formatarCoordenadas(
  local: { lat: number; lng: number } | null | undefined,
): string {
  if (!local || !Number.isFinite(local.lat) || !Number.isFinite(local.lng)) return '';
  const parte = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(n).toFixed(4)}`;
  return `${parte(local.lat)}, ${parte(local.lng)}`;
}

export type CanalDeIdentidade = 'whatsapp' | 'sms' | 'email' | 'google' | null;

/** O canal sozinho, para quando o rótulo "Identidade" já está na chave da linha. */
export function nomeDoCanal(canal: CanalDeIdentidade): string {
  if (canal === 'google') return 'Google';
  if (canal === 'email') return 'E-mail';
  if (canal === 'sms') return 'SMS';
  if (canal === 'whatsapp') return 'WhatsApp';
  return 'Confirmada';
}

/** Como a pessoa provou quem é — o rótulo que aparece no cartão de prova. */
export function rotularCanal(canal: CanalDeIdentidade): string {
  return canal ? `Identidade · ${nomeDoCanal(canal)}` : 'Identidade confirmada';
}

/**
 * O canal lido do REGISTRO do signatário.
 *
 * Necessário para quem volta ao link depois de assinar: a página foi
 * recarregada, o estado do navegador se foi, e a única fonte que sobrou é a
 * linha no banco. `auth_verified_channel` é o dado direto; `auth_provider` é o
 * plano B, para registros antigos gravados antes daquela coluna existir.
 *
 * SMS não vira "WhatsApp". São canais diferentes, e escrever o nome errado num
 * comprovante de assinatura é justamente o tipo de detalhe que derruba a prova.
 */
export function canalDoRegistro(
  registro: { auth_verified_channel?: string | null; auth_provider?: string | null } | null | undefined,
): CanalDeIdentidade {
  const verificado = registro?.auth_verified_channel;
  if (verificado === 'google') return 'google';
  if (verificado === 'email') return 'email';
  if (verificado === 'sms') return 'sms';
  if (verificado === 'whatsapp') return 'whatsapp';

  const provedor = registro?.auth_provider;
  if (provedor === 'google') return 'google';
  if (provedor === 'email_link') return 'email';
  // `phone` não distingue WhatsApp de SMS. Sem saber, não se chuta um nome.
  if (provedor === 'phone') return null;
  return null;
}

/**
 * A frase da conferência, escolhida pelo tempo decorrido.
 *
 * Cada etapa é uma coisa que o servidor está mesmo fazendo. A última não diz
 * "pronto": quem decide que terminou é a resposta do servidor, não o relógio —
 * a tela some sozinha quando ela chega. Prometer conclusão aqui seria mentir
 * para quem está com a conexão ruim.
 */
export function faseDaConferencia(segundos: number): string {
  if (segundos < 2.2) return 'Recebendo sua assinatura';
  if (segundos < 4.5) return 'Conferindo sua identidade';
  if (segundos < 7) return 'Gravando no documento';
  if (segundos < 14) return 'Emitindo o comprovante';
  return 'A conexão está lenta. Continuamos tentando.';
}

/**
 * A frase da abertura. Mesma disciplina: nada de "pronto" antes da hora — a
 * cortina de carregamento só sai quando o documento está de fato na tela.
 */
export function faseDaAbertura(segundos: number): string {
  if (segundos < 2.4) return 'Conferindo seu acesso…';
  if (segundos < 5.5) return 'Abrindo o documento…';
  if (segundos < 12) return 'Quase lá…';
  return 'A conexão está lenta. Continuamos tentando.';
}

/**
 * Curva de progresso assintótica.
 *
 * Sobe rápido e desacelera perto de 99% sem nunca congelar num valor fixo — a
 * versão antiga ficava presa em 96% e parecia travada. Nunca chega a 100%
 * porque quem fecha a conta é o servidor.
 */
export function progresso(segundos: number, constante = 2.5): number {
  if (!(segundos > 0)) return 0;
  return Math.min(99, 100 * (1 - Math.exp(-segundos / constante)));
}
