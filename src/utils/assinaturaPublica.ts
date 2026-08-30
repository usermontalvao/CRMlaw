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
 * IDENTIFICADORES ACEITOS PELA CONSULTA, inclusive aliases legados.
 *
 * O contrato público dos documentos novos tem apenas duas identidades:
 *
 *  · o PROTOCOLO DO ENVELOPE (o `id` da solicitação, carimbado no PDF) — vale o
 *    kit inteiro;
 *  · o CÓDIGO DO DOCUMENTO (um por arquivo, no modelo `per_document`);
 *
 * `envelope_verification_code` e `verification_hash` do signatário continuam
 * reconhecidos para não quebrar links antigos, mas não formam uma terceira ou
 * quarta identidade exibida nos documentos novos.
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

/** Rótulos públicos canônicos: protocolo do envelope ou código do documento. */
export function rotuloDoCodigo(tipo: TipoDeCodigo): string {
  if (tipo === 'envelope') return 'Protocolo do envelope';
  if (tipo === 'documento') return 'Código de verificação do documento';
  // Códigos antigos de signatário continuam consultáveis por compatibilidade,
  // mas não são apresentados como uma terceira identidade em documentos novos.
  return 'Código de verificação';
}

export type DocumentoVerificavel = {
  verification_code?: string | null;
  signed_pdf_sha256?: string | null;
  /** SHA-256 do documento de ORIGEM — o que vai impresso no PDF. */
  document_hash?: string | null;
};

/**
 * Devolve a impressão digital do PDF ASSINADO correspondente ao código que a
 * pessoa consultou. O fallback cobre envelopes legados e validação por upload.
 */
export function hashDoPdfAssinadoConsultado(
  codigoConsultado: string | null | undefined,
  documentos: readonly DocumentoVerificavel[] | null | undefined,
  fallback: string | null | undefined,
): string {
  const alvo = normalizarCodigo(codigoConsultado);
  if (alvo) {
    const documento = (documentos || []).find(
      (item) => normalizarCodigo(item.verification_code) === alvo,
    );
    const hashDoDocumento = String(documento?.signed_pdf_sha256 || '').trim();
    if (hashDoDocumento) return hashDoDocumento;
  }
  return String(fallback || '').trim();
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
 * A frase da espera, escolhida pelo tempo decorrido.
 *
 * ONDE O TRABALHO ACONTECE — e por que isso muda o texto.
 *
 * O PDF assinado é montado NO APARELHO de quem assina: cada página é
 * renderizada, a assinatura e a selfie são embutidas, o certificado e a trilha
 * são desenhados, e só então o arquivo é lacrado e enviado. Num kit com
 * documento principal e dois anexos são três PDFs completos. Em celular
 * antigo isso passa fácil de meio minuto — sem que nada esteja errado.
 *
 * A frase antiga dizia, depois de 14s:
 *
 *     "A conexão está lenta. Continuamos tentando."
 *
 * Duas afirmações falsas na mesma linha. Não é a conexão: é processamento
 * local, e a pessoa ia conferir o wi-fi atrás de um problema que não existe.
 * E nada está sendo "tentado de novo" — há uma única execução em curso;
 * "tentando" sugere que algo falhou e assusta justamente quem está no meio de
 * um ato que não pode ser interrompido.
 *
 * Nenhuma etapa promete conclusão: quem fecha a conta é a resposta do
 * servidor, não o relógio — a tela some sozinha quando ela chega.
 */
export function faseDaConferencia(segundos: number): string {
  if (segundos < 2.5) return 'Registrando sua assinatura';
  if (segundos < 6) return 'Aplicando ao documento';
  if (segundos < 11) return 'Montando o documento assinado';
  if (segundos < 20) return 'Gerando o certificado';
  return 'Finalizando no seu aparelho';
}

/**
 * A segunda linha da espera: explica, não alarma.
 *
 * Vazia no começo — quem espera 5 segundos não precisa de explicação, e um
 * parágrafo já na largada sugere que algo vai dar errado. Ela entra quando a
 * espera passa do que a pessoa considera normal, e aí responde à pergunta que
 * ela está fazendo: "travou?".
 *
 * O título fica curto de propósito (a caixa tem 240px); é aqui que mora o
 * texto que tranquiliza.
 */
export function explicacaoDaEspera(segundos: number): string {
  if (segundos < 18) return '';
  if (segundos < 40) return 'O documento é montado aqui no seu aparelho — por isso demora um pouco.';
  return 'Kits com anexos levam mais tempo em alguns aparelhos. Continua em andamento.';
}

/**
 * A frase da abertura. Mesma disciplina: nada de "pronto" antes da hora — a
 * cortina de carregamento só sai quando o documento está de fato na tela.
 */
export function faseDaAbertura(segundos: number): string {
  if (segundos < 2.4) return 'Conferindo seu acesso…';
  if (segundos < 5.5) return 'Abrindo o documento…';
  if (segundos < 12) return 'Preparando a visualização…';
  // Aqui a rede É a suspeita certa: a abertura baixa o documento. Mas continua
  // sem dizer "tentando", que sugere falha onde há só espera.
  return 'O download está demorando. Aguarde mais um instante.';
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

/**
 * A LISTA DE DOCUMENTOS DO ENVELOPE aparece — ou não — conforme o que foi
 * consultado. É a diferença entre responder a pergunta e entregar o arquivo
 * inteiro de outra pessoa.
 *
 *  · CÓDIGO DE UM DOCUMENTO → mostra SÓ aquele documento. Quem tem em mãos o
 *    anexo 2 perguntou pelo anexo 2; devolver os irmãos deixa a pessoa
 *    comparando o hash errado com o arquivo certo, e ainda revela quantos e
 *    quais outros arquivos existem no envelope a quem só conhece um código.
 *  · PROTOCOLO DO ENVELOPE → mostra o kit inteiro. É o identificador que vale
 *    pelo conjunto, e é aí que a lista responde à pergunta feita.
 *  · VALIDAÇÃO POR ARQUIVO (sem código digitado) → mantém o kit, porque não
 *    houve pergunta por um código específico.
 *
 * A regra vivia implícita num `documents.length > 0`, e valeu enquanto só a
 * consulta por protocolo devolvia a lista. Quando a RPC passou a mandar
 * `documents` TAMBÉM na consulta por código individual, o `length > 0` calou:
 * continuou verdadeiro e a tela passou a listar o envelope inteiro para quem
 * havia digitado um único código.
 */
export function listarDocumentosDoEnvelope(params: {
  tipo: TipoDeCodigo;
  codigoConsultado: string | null | undefined;
  quantidadeDeDocumentos: number;
}): boolean {
  if (params.quantidadeDeDocumentos <= 0) return false;
  // Sem código digitado (validação por arquivo): nada foi perguntado por código.
  if (!normalizarCodigo(params.codigoConsultado)) return true;
  return params.tipo === 'envelope';
}

/**
 * O SHA-256 do DOCUMENTO ORIGINAL correspondente ao código consultado.
 *
 * São dois hashes, e a tela mostra os dois porque respondem a perguntas
 * diferentes:
 *
 *  · o do ORIGINAL é o que está IMPRESSO no PDF assinado. Existe antes da
 *    assinatura, então pode ser carimbado no documento sem circularidade. É
 *    por ele que se confere que o papel na mão corresponde a este registro.
 *  · o do PDF ASSINADO é o do arquivo que se baixa. Não pode ser impresso
 *    dentro do próprio PDF — escrevê-lo mudaria os bytes e geraria outro hash.
 *
 * Mostrar só um deles foi o que gerou a dúvida: quem comparava o número
 * impresso com o hash do arquivo baixado achava dois valores distintos e
 * concluía que algo não fechava. Fechava — eram objetos diferentes, e a tela
 * não dizia isso.
 */
export function hashDoOriginalConsultado(
  codigoConsultado: string | null | undefined,
  documentos: readonly DocumentoVerificavel[] | null | undefined,
  fallback: string | null | undefined,
): string {
  const alvo = normalizarCodigo(codigoConsultado);
  if (alvo) {
    const documento = (documentos || []).find(
      (item) => normalizarCodigo(item.verification_code) === alvo,
    );
    const hashDoDocumento = String(documento?.document_hash || '').trim();
    if (hashDoDocumento) return hashDoDocumento;
  }
  return String(fallback || '').trim();
}

/**
 * O QUE A TELA PODE AFIRMAR — e o que ela apenas encontrou.
 *
 * Esta é a distinção que decide se o validador sobrevive a um questionamento.
 *
 *  · CONSULTA POR CÓDIGO: o sistema achou um registro. Isso prova que a
 *    assinatura existe, quem assinou, quando e como se autenticou. NÃO prova
 *    que o arquivo na mão de quem consulta é aquele — nada foi comparado.
 *  · VALIDAÇÃO POR ARQUIVO: o SHA-256 do arquivo enviado foi calculado e
 *    bateu com o registrado. Aí sim houve conferência, e "nada foi alterado"
 *    é uma afirmação sustentada.
 *
 * A tela dizia "Nada foi alterado depois da assinatura" nos DOIS casos. Na
 * consulta por código isso é uma afirmação categórica de integridade que não
 * foi verificada — exatamente a frase que um perito da parte contrária usaria
 * para desqualificar o laudo inteiro: basta perguntar "com o que vocês
 * compararam?". Prometer menos e provar o que promete é o que torna o
 * documento defensável.
 */
export function afirmacaoDaConsulta(conferidoPorArquivo: boolean): {
  titulo: string;
  destaque: string;
  explicacao: string;
} {
  if (conferidoPorArquivo) {
    return {
      titulo: 'O arquivo',
      destaque: 'confere',
      explicacao: 'Byte a byte, é o mesmo PDF que foi assinado. Uma vírgula alterada mudaria a impressão digital.',
    };
  }
  return {
    titulo: 'Assinatura',
    destaque: 'registrada',
    explicacao: 'Este código corresponde a uma assinatura no registro, com o signatário e a data abaixo. '
      + 'Para provar que o arquivo em suas mãos é exatamente este, compare o SHA-256 do PDF assinado ou envie o arquivo para conferência.',
  };
}
