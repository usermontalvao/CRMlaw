/**
 * O CONFRONTO DO SELO — ler o certificado, em vez de acreditar nele.
 *
 * A página de conferência dizia "Certificado que selou: Jurius — Selo de
 * Integridade" e logo abaixo uma impressão digital. As duas coisas estavam
 * escritas à mão no nosso código: o nome era um texto do componente e a
 * impressão, uma constante. Quem lê a página não tem como saber se aquele
 * nome é o nome que está DENTRO do certificado, nem se o certificado que
 * assinou o PDF é o mesmo que publicamos — o cartório estava sendo convidado
 * a acreditar em duas frases nossas.
 *
 * Este módulo tira as duas frases da nossa boca:
 *
 *   1. TRANSCREVE. O nome, o emissor, a validade e a série saem do próprio
 *      certificado, campo por campo. O CN real, por exemplo, é "Jurius - Selo
 *      de Integridade (autoassinado)" — com o "(autoassinado)" que a página
 *      omitia, e que é justamente o que um conferente precisa ver.
 *
 *   2. CONFRONTA. De um lado o certificado que o servidor publica em
 *      `/selo-de-integridade.crt`; do outro, o certificado que viaja dentro
 *      do PKCS#7 do PDF assinado. As duas impressões digitais são calculadas
 *      aqui, no navegador de quem confere, e mostradas lado a lado. Se
 *      divergirem, a página diz que divergiram.
 *
 * O que este módulo NÃO faz, e não deve fingir que faz: ele não verifica a
 * matemática da assinatura (a cadeia de digest do /ByteRange contra a chave
 * pública). Isso é trabalho do leitor de PDF, e é lá que deve continuar. Aqui
 * a pergunta é mais estreita e ainda assim útil: *este PDF foi selado com o
 * certificado que o Jurius publica?*
 *
 * Sem imports de propósito — `npm test` roda por ts-node e uma cadeia de
 * import relativo sem extensão quebra o runner. Ver a nota de
 * `testes-ts-node-imports`.
 */

// ── ASN.1 / DER ─────────────────────────────────────────────────────────────

/** Um nó DER: onde ele começa, onde acaba e o que ele é. */
export interface NoDer {
  /** O byte de identificador inteiro, como veio. */
  tag: number;
  /** 0 universal, 1 aplicação, 2 contexto, 3 privado. */
  classe: number;
  /** O número da tag dentro da classe (0x1f do identificador). */
  numero: number;
  construido: boolean;
  /** Offset do primeiro byte do NÓ (o identificador). */
  comeco: number;
  /** Offset do primeiro byte do CONTEÚDO. */
  inicio: number;
  /** Offset logo após o conteúdo. */
  fim: number;
  /** Offset logo após o nó inteiro (identificador + comprimento + conteúdo). */
  proximo: number;
}

const UNIVERSAL = 0;
const CONTEXTO = 2;

/** Números de tag universais que este módulo precisa nomear. */
const TAG_INTEGER = 0x02;
const TAG_BIT_STRING = 0x03;
const TAG_OID = 0x06;
const TAG_UTF8 = 0x0c;
const TAG_SEQUENCE = 0x10;
const TAG_SET = 0x11;
const TAG_PRINTABLE = 0x13;
const TAG_IA5 = 0x16;
const TAG_UTC_TIME = 0x17;
const TAG_GENERALIZED_TIME = 0x18;
const TAG_BMP = 0x1e;

/** Lê UM nó DER a partir de `off`. Lança se o comprimento não fecha. */
export const lerNoDer = (bytes: Uint8Array, off: number): NoDer => {
  if (off + 2 > bytes.length) throw new Error('DER truncado');
  const tag = bytes[off];
  if ((tag & 0x1f) === 0x1f) throw new Error('tag de múltiplos bytes não suportada');
  let p = off + 1;
  let comprimento = bytes[p];
  p += 1;
  if (comprimento & 0x80) {
    const octetos = comprimento & 0x7f;
    // Comprimento indefinido (0x80) só existe em BER, e o PKCS#7 de um PDF
    // assinado é DER por exigência da própria especificação PAdES.
    if (octetos === 0 || octetos > 4) throw new Error('comprimento DER inválido');
    comprimento = 0;
    for (let i = 0; i < octetos; i += 1) {
      comprimento = comprimento * 256 + bytes[p];
      p += 1;
    }
  }
  const fim = p + comprimento;
  if (fim > bytes.length) throw new Error('DER truncado');
  return {
    tag,
    classe: (tag & 0xc0) >> 6,
    numero: tag & 0x1f,
    construido: (tag & 0x20) !== 0,
    comeco: off,
    inicio: p,
    fim,
    proximo: fim,
  };
};

/** Os nós filhos de um nó construído, na ordem. */
export const filhosDer = (bytes: Uint8Array, no: NoDer): NoDer[] => {
  const lista: NoDer[] = [];
  let p = no.inicio;
  while (p < no.fim) {
    const filho = lerNoDer(bytes, p);
    lista.push(filho);
    if (filho.proximo <= p) break;
    p = filho.proximo;
  }
  return lista;
};

/** O nó inteiro, do identificador ao último byte do conteúdo. */
const recorteDoNo = (bytes: Uint8Array, no: NoDer): Uint8Array => bytes.slice(no.comeco, no.fim);

/** O OID em notação pontilhada. */
export const lerOid = (bytes: Uint8Array, no: NoDer): string => {
  const partes: number[] = [];
  let valor = 0;
  for (let p = no.inicio; p < no.fim; p += 1) {
    const b = bytes[p];
    valor = valor * 128 + (b & 0x7f);
    if ((b & 0x80) === 0) {
      if (partes.length === 0) {
        partes.push(Math.floor(valor / 40) > 2 ? 2 : Math.floor(valor / 40));
        partes.push(valor - partes[0] * 40);
      } else {
        partes.push(valor);
      }
      valor = 0;
    }
  }
  return partes.join('.');
};

/** Texto de um dos tipos de string do X.509. */
const lerTexto = (bytes: Uint8Array, no: NoDer): string => {
  const cru = bytes.slice(no.inicio, no.fim);
  if (no.numero === TAG_BMP) {
    // BMPString: UTF-16 big-endian.
    let saida = '';
    for (let i = 0; i + 1 < cru.length; i += 2) saida += String.fromCharCode((cru[i] << 8) | cru[i + 1]);
    return saida;
  }
  if (no.numero === TAG_UTF8) {
    try {
      return new TextDecoder('utf-8').decode(cru);
    } catch {
      /* cai no latin-1 abaixo */
    }
  }
  let saida = '';
  for (let i = 0; i < cru.length; i += 1) saida += String.fromCharCode(cru[i]);
  return saida;
};

// ── X.509 ───────────────────────────────────────────────────────────────────

/** Os rótulos curtos dos atributos de nome que aparecem num DN. */
const ROTULOS_DE_ATRIBUTO: Record<string, string> = {
  '2.5.4.3': 'CN',
  '2.5.4.4': 'SN',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.9': 'STREET',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '2.5.4.12': 'T',
  '1.2.840.113549.1.9.1': 'E',
};

/** Um par `CN=Fulano` de dentro do nome distinto. */
export interface AtributoDeNome {
  /** O rótulo curto (`CN`, `O`, `OU`…) ou o OID quando não há rótulo. */
  rotulo: string;
  valor: string;
}

/** Um nome distinto (DN) já legível. */
export interface NomeDistinto {
  atributos: AtributoDeNome[];
  /** O DN inteiro, na ordem em que o certificado o escreveu. */
  texto: string;
}

const lerNome = (bytes: Uint8Array, no: NoDer): NomeDistinto => {
  const atributos: AtributoDeNome[] = [];
  for (const rdn of filhosDer(bytes, no)) {
    if (rdn.numero !== TAG_SET) continue;
    for (const par of filhosDer(bytes, rdn)) {
      const campos = filhosDer(bytes, par);
      if (campos.length < 2 || campos[0].numero !== TAG_OID) continue;
      const oid = lerOid(bytes, campos[0]);
      atributos.push({ rotulo: ROTULOS_DE_ATRIBUTO[oid] || oid, valor: lerTexto(bytes, campos[1]) });
    }
  }
  return {
    atributos,
    texto: atributos.map((a) => `${a.rotulo}=${a.valor}`).join(', '),
  };
};

/** Procura o valor de um atributo no DN. */
export const atributoDoNome = (nome: NomeDistinto | null | undefined, rotulo: string): string => {
  if (!nome) return '';
  const achado = nome.atributos.find((a) => a.rotulo === rotulo);
  return achado ? achado.valor : '';
};

const lerHorario = (bytes: Uint8Array, no: NoDer): string => {
  const texto = lerTexto(bytes, no).trim();
  const dv = no.numero === TAG_GENERALIZED_TIME;
  const casado = dv
    ? /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?/.exec(texto)
    : /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?/.exec(texto);
  if (!casado) return '';
  let ano = Number(casado[1]);
  // UTCTime tem dois dígitos: a regra do X.509 é 50–99 → 19xx, 00–49 → 20xx.
  if (!dv) ano = ano >= 50 ? 1900 + ano : 2000 + ano;
  const iso = `${String(ano).padStart(4, '0')}-${casado[2]}-${casado[3]}T${casado[4]}:${casado[5]}:${casado[6] || '00'}Z`;
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? '' : data.toISOString();
};

/** Bytes em hexa maiúsculo separado por dois-pontos — o formato do openssl. */
export const hexComDoisPontos = (bytes: Uint8Array): string => {
  const partes: string[] = [];
  for (let i = 0; i < bytes.length; i += 1) partes.push(bytes[i].toString(16).padStart(2, '0').toUpperCase());
  return partes.join(':');
};

/** O que este módulo consegue dizer sobre um certificado. */
export interface CertificadoLido {
  /** O DER original, byte a byte — é dele que sai a impressão digital. */
  der: Uint8Array;
  titular: NomeDistinto;
  emissor: NomeDistinto;
  /** O nome comum do titular: o NOME DO SELO, transcrito da fonte. */
  nome: string;
  /** `true` quando titular e emissor são o mesmo DN. */
  autoassinado: boolean;
  /** Número de série em hexa, como o openssl imprime. */
  serie: string;
  /** Início e fim da validade, em ISO — vazio se o campo não pôde ser lido. */
  validoDe: string;
  validoAte: string;
}

/** Lê um certificado X.509 em DER. Lança se não for um certificado. */
export const lerCertificado = (der: Uint8Array): CertificadoLido => {
  const raiz = lerNoDer(der, 0);
  if (raiz.numero !== TAG_SEQUENCE) throw new Error('não é um certificado');
  const partes = filhosDer(der, raiz);
  if (partes.length < 1) throw new Error('certificado vazio');
  const tbs = partes[0];
  const campos = filhosDer(der, tbs);
  let i = 0;
  // [0] EXPLICIT version — opcional, e ausente em certificado v1.
  if (campos[i] && campos[i].classe === CONTEXTO && campos[i].numero === 0) i += 1;
  const serie = campos[i] && campos[i].numero === TAG_INTEGER
    ? hexComDoisPontos(der.slice(campos[i].inicio, campos[i].fim))
    : '';
  i += 1;
  i += 1; // algoritmo da assinatura
  const emissor = campos[i] ? lerNome(der, campos[i]) : { atributos: [], texto: '' };
  i += 1;
  let validoDe = '';
  let validoAte = '';
  if (campos[i] && campos[i].numero === TAG_SEQUENCE) {
    const janela = filhosDer(der, campos[i]);
    if (janela[0]) validoDe = lerHorario(der, janela[0]);
    if (janela[1]) validoAte = lerHorario(der, janela[1]);
  }
  i += 1;
  const titular = campos[i] ? lerNome(der, campos[i]) : { atributos: [], texto: '' };
  return {
    der,
    titular,
    emissor,
    nome: atributoDoNome(titular, 'CN') || titular.texto,
    autoassinado: !!titular.texto && titular.texto === emissor.texto,
    serie,
    validoDe,
    validoAte,
  };
};

/** PEM (`-----BEGIN CERTIFICATE-----`) para os bytes DER. */
export const derDoPem = (pem: string): Uint8Array => {
  const corpo = String(pem || '')
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/[^A-Za-z0-9+/=]/g, '');
  if (!corpo) throw new Error('PEM vazio');
  const bin = typeof atob === 'function'
    ? atob(corpo)
    : Buffer.from(corpo, 'base64').toString('binary');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

// ── PKCS#7 (o que viaja dentro do PDF) ──────────────────────────────────────

const OID_SIGNED_DATA = '1.2.840.113549.1.7.2';

/**
 * Os certificados embutidos num CMS SignedData, na ordem em que ele os traz.
 *
 * ContentInfo ::= SEQUENCE { contentType OID, content [0] EXPLICIT SignedData }
 * SignedData  ::= SEQUENCE { version, digestAlgorithms SET, encapContentInfo,
 *                            certificates [0] IMPLICIT OPTIONAL, crls [1],
 *                            signerInfos SET }
 */
export const certificadosDoPkcs7 = (der: Uint8Array): Uint8Array[] => {
  const raiz = lerNoDer(der, 0);
  if (raiz.numero !== TAG_SEQUENCE) return [];
  const contentInfo = filhosDer(der, raiz);
  if (!contentInfo.length || contentInfo[0].numero !== TAG_OID) return [];
  if (lerOid(der, contentInfo[0]) !== OID_SIGNED_DATA) return [];
  const conteudo = contentInfo[1];
  if (!conteudo || conteudo.classe !== CONTEXTO) return [];
  const signedData = filhosDer(der, conteudo)[0];
  if (!signedData || signedData.numero !== TAG_SEQUENCE) return [];
  const campos = filhosDer(der, signedData);
  const caixaDeCertificados = campos.find((c) => c.classe === CONTEXTO && c.numero === 0);
  if (!caixaDeCertificados) return [];
  return filhosDer(der, caixaDeCertificados)
    .filter((c) => c.classe === UNIVERSAL && c.numero === TAG_SEQUENCE)
    .map((c) => recorteDoNo(der, c));
};

/**
 * O número de série que o SignerInfo aponta — é ele que diz QUAL dos
 * certificados embutidos assinou, quando há mais de um.
 */
const serieDoAssinante = (der: Uint8Array): string => {
  try {
    const raiz = lerNoDer(der, 0);
    const contentInfo = filhosDer(der, raiz);
    const signedData = filhosDer(der, contentInfo[1])[0];
    const campos = filhosDer(der, signedData);
    const signerInfos = [...campos].reverse().find((c) => c.classe === UNIVERSAL && c.numero === TAG_SET);
    if (!signerInfos) return '';
    const primeiro = filhosDer(der, signerInfos)[0];
    if (!primeiro) return '';
    const partes = filhosDer(der, primeiro);
    // sid: ou IssuerAndSerialNumber (SEQUENCE), ou [0] SubjectKeyIdentifier.
    const sid = partes[1];
    if (!sid || sid.numero !== TAG_SEQUENCE || sid.classe !== UNIVERSAL) return '';
    const dentro = filhosDer(der, sid);
    const serie = dentro[dentro.length - 1];
    if (!serie || serie.numero !== TAG_INTEGER) return '';
    return hexComDoisPontos(der.slice(serie.inicio, serie.fim));
  } catch {
    return '';
  }
};

/** O certificado que de fato assinou: o que casa com o SignerInfo. */
export const certificadoAssinanteDoPkcs7 = (der: Uint8Array): Uint8Array | null => {
  const certificados = certificadosDoPkcs7(der);
  if (!certificados.length) return null;
  const serie = serieDoAssinante(der);
  if (serie) {
    for (const cert of certificados) {
      try {
        if (lerCertificado(cert).serie === serie) return cert;
      } catch {
        /* certificado ilegível: tenta o próximo */
      }
    }
  }
  return certificados[0];
};

// ── O PDF ───────────────────────────────────────────────────────────────────

const BYTES_DE_CONTENTS = [0x2f, 0x43, 0x6f, 0x6e, 0x74, 0x65, 0x6e, 0x74, 0x73]; // "/Contents"

const ehEspaco = (b: number): boolean => b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09 || b === 0x00 || b === 0x0c;

const valorHexa = (b: number): number => {
  if (b >= 0x30 && b <= 0x39) return b - 0x30;
  if (b >= 0x41 && b <= 0x46) return b - 0x41 + 10;
  if (b >= 0x61 && b <= 0x66) return b - 0x61 + 10;
  return -1;
};

/**
 * Os blocos `/Contents <hexa>` do PDF — onde mora o PKCS#7 de cada assinatura.
 *
 * A varredura é por bytes e não por string: um PDF é binário, e transformar
 * 5 MB de arquivo em texto para rodar um regex custa mais do que este laço.
 * O zero de enchimento no fim do bloco (o placeholder reserva espaço fixo) é
 * descartado — ele não faz parte do DER.
 */
export const blocosDeAssinaturaDoPdf = (bytes: Uint8Array): Uint8Array[] => {
  const blocos: Uint8Array[] = [];
  const limite = bytes.length - BYTES_DE_CONTENTS.length;
  for (let i = 0; i < limite; i += 1) {
    if (bytes[i] !== 0x2f) continue;
    let casou = true;
    for (let k = 1; k < BYTES_DE_CONTENTS.length; k += 1) {
      if (bytes[i + k] !== BYTES_DE_CONTENTS[k]) { casou = false; break; }
    }
    if (!casou) continue;
    let p = i + BYTES_DE_CONTENTS.length;
    while (p < bytes.length && ehEspaco(bytes[p])) p += 1;
    if (bytes[p] !== 0x3c) continue; // '<'
    p += 1;
    const digitos: number[] = [];
    while (p < bytes.length && bytes[p] !== 0x3e) { // '>'
      const v = valorHexa(bytes[p]);
      if (v >= 0) digitos.push(v);
      else if (!ehEspaco(bytes[p])) { digitos.length = 0; break; }
      p += 1;
    }
    if (digitos.length < 4) continue;
    const bruto = new Uint8Array(Math.floor(digitos.length / 2));
    for (let k = 0; k < bruto.length; k += 1) bruto[k] = digitos[k * 2] * 16 + digitos[k * 2 + 1];
    blocos.push(bruto);
    i = p;
  }
  return blocos;
};

/**
 * O certificado que selou ESTE PDF.
 *
 * Quando há mais de uma assinatura (o kit consolidado recebe uma por vez),
 * vale a última: é ela que sela o arquivo como ele está agora.
 */
export const certificadoDoPdf = (bytes: Uint8Array): Uint8Array | null => {
  const blocos = blocosDeAssinaturaDoPdf(bytes);
  for (let i = blocos.length - 1; i >= 0; i -= 1) {
    try {
      const cert = certificadoAssinanteDoPkcs7(blocos[i]);
      if (cert) return cert;
    } catch {
      /* bloco ilegível: tenta o anterior */
    }
  }
  return null;
};

// ── A impressão digital, e o confronto ──────────────────────────────────────

/** SHA-256 do DER, no formato `82:96:16:…` do `openssl x509 -fingerprint`. */
export const impressaoDigitalDe = async (der: Uint8Array): Promise<string> => {
  const ab = der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength) as ArrayBuffer;
  const resumo = await crypto.subtle.digest('SHA-256', ab);
  return hexComDoisPontos(new Uint8Array(resumo));
};

/** Comparação de impressões digitais: sem dois-pontos, sem caixa. */
export const impressoesIguais = (a: string, b: string): boolean => {
  const limpar = (v: string) => String(v || '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  const x = limpar(a);
  const y = limpar(b);
  return x.length === 64 && x === y;
};

/** Um dos lados do confronto, já pronto para a tela. */
export interface LadoDoConfronto {
  impressao: string;
  nome: string;
  organizacao: string;
  unidade: string;
  emissor: string;
  autoassinado: boolean;
  serie: string;
  validoDe: string;
  validoAte: string;
}

export type VeredictoDoConfronto = 'confere' | 'diverge' | 'so-servidor' | 'indisponivel';

/** O confronto inteiro — os dois lados e o que se pode afirmar deles. */
export interface ConfrontoDoSelo {
  servidor: LadoDoConfronto | null;
  documento: LadoDoConfronto | null;
  veredicto: VeredictoDoConfronto;
}

const ladoDoCertificado = async (der: Uint8Array): Promise<LadoDoConfronto> => {
  const cert = lerCertificado(der);
  return {
    impressao: await impressaoDigitalDe(der),
    nome: cert.nome,
    organizacao: atributoDoNome(cert.titular, 'O'),
    unidade: atributoDoNome(cert.titular, 'OU'),
    emissor: atributoDoNome(cert.emissor, 'CN') || cert.emissor.texto,
    autoassinado: cert.autoassinado,
    serie: cert.serie,
    validoDe: cert.validoDe,
    validoAte: cert.validoAte,
  };
};

/**
 * Monta o confronto a partir do PEM publicado e (quando houver) dos bytes do
 * PDF assinado. Nunca lança: um lado ilegível vira `null`, e o veredicto diz
 * o que a página pode afirmar.
 */
export const montarConfronto = async (
  pemDoServidor: string | null | undefined,
  bytesDoPdf: Uint8Array | null | undefined,
): Promise<ConfrontoDoSelo> => {
  let servidor: LadoDoConfronto | null = null;
  let documento: LadoDoConfronto | null = null;
  try {
    if (pemDoServidor) servidor = await ladoDoCertificado(derDoPem(pemDoServidor));
  } catch {
    servidor = null;
  }
  try {
    if (bytesDoPdf && bytesDoPdf.length) {
      const der = certificadoDoPdf(bytesDoPdf);
      if (der) documento = await ladoDoCertificado(der);
    }
  } catch {
    documento = null;
  }
  let veredicto: VeredictoDoConfronto = 'indisponivel';
  if (servidor && documento) {
    veredicto = impressoesIguais(servidor.impressao, documento.impressao) ? 'confere' : 'diverge';
  } else if (servidor) {
    veredicto = 'so-servidor';
  }
  return { servidor, documento, veredicto };
};
