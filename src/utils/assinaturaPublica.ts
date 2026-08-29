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
 * OS QUATRO IDENTIFICADORES, e por que confundi-los quebra a conferência.
 *
 * Um envelope assinado carrega códigos diferentes, para coisas diferentes:
 *
 *  · o PROTOCOLO DO ENVELOPE (o `id` da solicitação, carimbado no rodapé do
 *    PDF, com o `envelope_verification_code` como apelido curto) — vale o kit
 *    inteiro;
 *  · o CÓDIGO DO DOCUMENTO (um por arquivo, no modelo `per_document`);
 *  · o CÓDIGO DO SIGNATÁRIO (o `verification_hash` de quem assinou).
 *
 * A tela de validação chamava todos de "Protocolo do envelope" e ainda exibia
 * um valor DIFERENTE do que a pessoa tinha consultado: quem digitava o código
 * de um documento recebia de volta outro número, sob um rótulo que dizia
 * "envelope". Não dava para casar o que estava na mão com o que estava na tela
 * — que é a única coisa que essa página existe para permitir.
 */
export type TipoDeCodigo = 'envelope' | 'documento' | 'signatario' | 'desconhecido';

/** Compara ignorando caixa e separadores: o rodapé imprime com hífen, a URL não. */
export function normalizarCodigo(valor: string | null | undefined): string {
  return (valor || '').replace(/[^0-9a-z]/gi, '').toUpperCase();
}

export function classificarCodigo(
  consultado: string | null | undefined,
  referencias: {
    envelope?: (string | null | undefined)[];
    documentos?: (string | null | undefined)[];
    signatario?: string | null;
  },
): TipoDeCodigo {
  const alvo = normalizarCodigo(consultado);
  if (!alvo) return 'desconhecido';

  const bate = (valor: string | null | undefined) => !!valor && normalizarCodigo(valor) === alvo;

  if ((referencias.envelope || []).some(bate)) return 'envelope';
  if ((referencias.documentos || []).some(bate)) return 'documento';
  if (bate(referencias.signatario)) return 'signatario';
  return 'desconhecido';
}

/**
 * O rótulo que vai em cima do código, no recibo.
 *
 * SÃO DOIS NOMES, não quatro — e são os que o próprio PDF assinado imprime no
 * rodapé, para a pessoa reconhecer o que tem na mão.
 *
 * Separar "código do documento" de "código do signatário" seria mentir com
 * confiança: a RPC pública devolve, para um código de documento, um signatário
 * sintético cujo `verification_hash` é o próprio código consultado — ou seja, o
 * que volta do servidor não distingue os dois. O que ela distingue com certeza
 * é o envelope (vem do `id` da solicitação), e é só isso que o rótulo afirma.
 */
export function rotuloDoCodigo(tipo: TipoDeCodigo): string {
  return tipo === 'envelope' ? 'Protocolo do envelope' : 'Código de autenticação';
}

/**
 * O QUE FOI USADO para autenticar — não o que estava configurado.
 *
 * A tela mostrava o `auth_method`, que guarda o método EXIGIDO quando a
 * solicitação foi criada. Ele mente por omissão: numa assinatura real deste
 * acervo o campo diz `signature_only`, e a pessoa tinha feito selfie E
 * confirmado a identidade por e-mail. O comprovante dizia "assinatura
 * eletrônica" e escondia duas provas que existem.
 *
 * Aqui a lista sai do que foi COLETADO, e por isso pode ter mais de um item.
 * Quando não há nada registrado, devolve vazio — e a linha some da tela, em vez
 * de afirmar um método que ninguém pode conferir.
 */
export function fatoresDeAutenticacao(dados: {
  assinatura?: boolean | null;
  selfie?: boolean | null;
  documento?: boolean | null;
  canal?: CanalDeIdentidade;
}): string {
  const partes: string[] = [];
  if (dados.assinatura) partes.push('assinatura');
  if (dados.selfie) partes.push('selfie');
  if (dados.documento) partes.push('documento de identidade');
  if (dados.canal === 'google') partes.push('conta Google');
  else if (dados.canal) partes.push(`código por ${nomeDoCanal(dados.canal)}`);

  if (partes.length === 0) return '';
  const frase = partes.length === 1
    ? partes[0]
    : `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
  return frase.charAt(0).toUpperCase() + frase.slice(1);
}

const semAcento = (valor: string): string =>
  valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * O nome do documento SEM repetir o nome de quem assinou.
 *
 * Os documentos do escritório nascem com o nome da pessoa no título ("KIT
 * CONSUMIDOR - JENIFFER APARECIDA ALVES RODRIGUES"), e o recibo mostra logo
 * abaixo "Assinado por: JENIFFER APARECIDA ALVES RODRIGUES". Duas linhas
 * coladas dizendo a mesma coisa, e a informação que distingue uma da outra —
 * QUE documento é — fica espremida na frente do nome.
 *
 * Aqui o sufixo repetido sai do título e sobra "KIT CONSUMIDOR". Nada se perde:
 * o nome continua inteiro na linha de baixo, que é a que tem valor jurídico.
 *
 * Conservador de propósito: só corta quando o nome está mesmo no FIM do título,
 * e só se o que sobrar ainda for um nome de documento (3+ caracteres). Título
 * que não segue esse padrão passa intacto.
 */
export function documentoSemOSignatario(
  nomeDoDocumento: string | null | undefined,
  nomeDoSignatario: string | null | undefined,
): string {
  const documento = (nomeDoDocumento || '').trim();
  const signatario = (nomeDoSignatario || '').trim();
  if (!documento || !signatario) return documento;

  const doc = semAcento(documento);
  const sig = semAcento(signatario);
  if (sig.length < 4 || !doc.endsWith(sig) || doc === sig) return documento;

  // Corta pelo COMPRIMENTO do sufixo normalizado. Acento e caixa não mudam a
  // contagem de caracteres nesta normalização, então o índice vale no original.
  const restante = documento.slice(0, documento.length - signatario.length)
    .replace(/[\s\-–—,;:|]+$/u, '')
    .trim();

  return restante.length >= 3 ? restante : documento;
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
