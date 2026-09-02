// (o @ts-nocheck saiu: esta tela passou a ser conferida pelo compilador)
import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { ArrowLeft, Download, Eye, FileText, Lock, Shield } from 'lucide-react';
import {
  AcaoPrimaria,
  AcaoSecundaria,
  Explicacao,
  LINHA,
  LinhaDoRecibo,
  MolduraPublica,
  Recibo,
  Roda,
  RodapeDeConfianca,
  Rotulo,
  Tarja,
  TopoDaMarca,
  TINTA,
  TINTA_2,
  TINTA_3,
  TINTA_4,
  sobe,
  type Tom,
} from './publicSigning/ui';
import {
  Abas,
  CartaoDeSignatario,
  CartaoDoEmissor,
  ChipDeCodigo,
  FaixaDaContagem,
  ListaDoHistorico,
  Opcao,
  Painel,
  SeloDeIntegridade,
  TituloDoPainel,
} from './publicSigning/dossie';
import {
  canalDoRegistro,
  classificarCodigo,
  codigoDoArquivoParaPrevia,
  contagemDeAssinaturas,
  emailPublicoDoSignatario,
  nomeDoDocumentoDoKit,
  documentoSemOSignatario,
  mascararCpf,
  nomeDoCanal,
  normalizarCodigo,
  fatoresDeAutenticacao,
  hashDoPdfAssinadoConsultado,
  hashDoOriginalConsultado,
  afirmacaoDaConsulta,
  listarDocumentosDoEnvelope,
  rotuloDoCodigo,
} from '../utils/assinaturaPublica';
import { signatureService } from '../services/signature.service';
import type { VerifiedDocument, VerifyDossier } from '../services/signature.service';
import { pdfSignatureService } from '@/services/pdfSignature.service';
import type { SignatarioDoDossie } from '../utils/assinaturaPublica';
import type { Signer, SignatureRequest } from '../types/signature.types';
import { DISPLAY_APP_VERSION_LABEL } from '../utils/appVersion';
import { buildPublicSignatureTermsUrl } from '../utils/publicAppUrl';
// A impressão digital do certificado vive num lugar só — ver constants/selo.ts.
import { SELO_IMPRESSAO_DIGITAL, SELO_URL_DO_CERTIFICADO } from '../constants/selo';

interface VerificationResult extends VerifyDossier {
  valid: boolean;
  signer?: Signer;
  request?: SignatureRequest;
  documents?: VerifiedDocument[];
  message: string;
}

const stripDocumentExtension = (name: string | null | undefined): string => {
  return String(name || '').trim().replace(/\.(pdf|docx?|rtf|odt)$/i, '');
};

const PublicVerificationPage: React.FC = () => {
  const [hash, setHash] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [searched, setSearched] = useState(false);
  const autoVerifiedRef = useRef(false);

  const [activeMode, setActiveMode] = useState<'code' | 'file'>('code');
  const [fileLoading, setFileLoading] = useState(false);
  const [fileHash, setFileHash] = useState<string>('');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);

  // ── O dossiê ──────────────────────────────────────────────────────────────
  const [abaDoDossie, setAbaDoDossie] = useState<'signatarios' | 'historico'>('signatarios');
  /** A prévia embutida: o PDF assinado renderizado na própria página. */
  const [previaUrl, setPreviaUrl] = useState<string | null>(null);
  const [previaCarregando, setPreviaCarregando] = useState(false);
  const [previaFalhou, setPreviaFalhou] = useState(false);
  /** Qual chip acabou de ser copiado — o certinho verde dura 1,6 s. */
  const [copiado, setCopiado] = useState('');

  const extractCodeFromUrl = () => {
    const hashRoute = typeof window !== 'undefined' ? window.location.hash || '' : '';
    const pathname = typeof window !== 'undefined' ? window.location.pathname || '' : '';

    const fromHash = hashRoute.includes('/verificar/')
      ? hashRoute.split('/verificar/')[1]?.split('?')[0]?.split('#')[0]
      : null;

    const fromPath = pathname.includes('/verificar/')
      ? pathname.split('/verificar/')[1]?.split('?')[0]?.split('#')[0]
      : null;

    const raw = (fromHash || fromPath || '').trim();
    if (!raw) return '';

    try {
      return decodeURIComponent(raw).trim().toUpperCase();
    } catch {
      return raw.trim().toUpperCase();
    }
  };

  const handleVerify = async (code?: string) => {
    const codeToUse = (code ?? hash).trim();
    if (!codeToUse) return;
    try {
      setLoading(true);
      setSearched(true);
      const data = await signatureService.verifySignatureByHash(codeToUse);
      if (data && data.status === 'valid') {
        setResult({
          valid: true,
          signer: data.signer,
          request: data.request,
          documents: data.documents,
          signers: data.signers,
          selo: data.selo,
          creator: data.creator,
          history: data.history,
          envelope: data.envelope,
          message: 'Assinatura válida e autêntica.',
        });
      } else if (data && data.status === 'blocked') {
        setResult({
          valid: false,
          signer: data.signer,
          request: data.request,
          documents: data.documents,
          signers: data.signers,
          selo: data.selo,
          creator: data.creator,
          history: data.history,
          envelope: data.envelope,
          message: data.reason
            ? `Validação pública desativada pelo emissor. Motivo: ${data.reason}`
            : 'A validação pública deste documento foi desativada pelo emissor. Os dados de auditoria abaixo comprovam que a assinatura ocorreu.',
        });
      } else {
        setResult({ valid: false, message: 'Nenhuma assinatura encontrada com este código.' });
      }
    } catch (err: any) {
      setResult({ valid: false, message: err.message || 'Erro ao verificar.' });
    } finally {
      setLoading(false);
    }
  };

  const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const hashBuffer = await crypto.subtle.digest('SHA-256', ab);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  };

  const handleVerifyFile = async (file: File) => {
    try {
      setFileLoading(true);
      setSearched(true);
      setResult(null);

      const bytes = new Uint8Array(await file.arrayBuffer());
      const computed = await sha256Hex(bytes);
      setFileHash(computed);

      const data = await signatureService.verifySignedPdfBySha256(computed);
      if (data) {
        setResult({
          valid: true,
          signer: data.signer,
          request: data.request,
          signers: data.signers,
          selo: data.selo,
          creator: data.creator,
          history: data.history,
          envelope: data.envelope,
          message: 'Documento válido e íntegro (hash confirmado).',
        });
      } else {
        setResult({ valid: false, message: 'Não foi possível validar: hash do arquivo não encontrado na base.' });
      }
    } catch (err: any) {
      setResult({ valid: false, message: err.message || 'Erro ao verificar arquivo.' });
    } finally {
      setFileLoading(false);
    }
  };

  useEffect(() => {
    const code = extractCodeFromUrl();
    if (!code) return;

    setHash(code);

    if (!autoVerifiedRef.current) {
      autoVerifiedRef.current = true;
      handleVerify(code);
    }
  }, []);

  useEffect(() => {
    const code = result?.valid ? (result.signer?.verification_hash || hash) : '';
    if (!code) {
      setQrDataUrl('');
      return;
    }
    const url = `${window.location.origin}/#/verificar/${code}`;
    QRCode.toDataURL(url, { width: 200, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [result, hash]);

  const resolveSignedDocumentUrl = async (code: string, fallbackPath?: string | null) => {
    let url = await signatureService.getVerifiedFileUrl(code);
    if (!url && fallbackPath) url = await pdfSignatureService.getSignedPdfUrl(fallbackPath);
    return url;
  };

  const openDocumentViewer = async (code: string, fallbackPath?: string | null) => {
    try {
      setViewerLoading(true);
      const url = await resolveSignedDocumentUrl(code, fallbackPath);
      if (!url) return;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        setViewerUrl(URL.createObjectURL(blob));
      } catch {
        setViewerUrl(url);
      }
    } catch (e) {
      console.error('Erro ao abrir documento:', e);
    } finally {
      setViewerLoading(false);
    }
  };

  const closeViewer = () => {
    setViewerUrl((prev) => {
      if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
      return null;
    });
  };

  useEffect(() => () => {
    if (viewerUrl && viewerUrl.startsWith('blob:')) URL.revokeObjectURL(viewerUrl);
  }, [viewerUrl]);

  const handleDownloadSigned = async () => {
    const code = result?.signer?.verification_hash || hash;
    if (!code) return;
    try {
      setViewerLoading(true);
      const url = await resolveSignedDocumentUrl(code, result?.signer?.signed_document_path);
      if (!url) return;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `${stripDocumentExtension(result?.request?.document_name || 'documento-assinado').replace(/[\\/:*?"<>|]+/g, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000);
    } catch (e) {
      console.error('Erro ao baixar documento:', e);
    } finally {
      setViewerLoading(false);
    }
  };

  // Acesso a um documento final individual do envelope (modelo per_document), pelo
  // seu próprio código de verificação (resolvido via public-verify-file).
  const downloadSignedByCode = async (code: string, name: string) => {
    if (!code) return;
    try {
      setViewerLoading(true);
      const url = await resolveSignedDocumentUrl(code);
      if (!url) return;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `${stripDocumentExtension(name || 'documento-assinado').replace(/[\\/:*?"<>|]+/g, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000);
    } catch (e) {
      console.error('Erro ao baixar documento:', e);
    } finally {
      setViewerLoading(false);
    }
  };

  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const termsUrl = buildPublicSignatureTermsUrl();
  const isValid = !!(searched && result && result.valid && result.signer && result.request);
  const hasResultState = searched && !!result;
  const verifiedByUploadedFile = isValid && activeMode === 'file' && !!fileHash;
  // Falha de verificação: distinguir "bloqueado pelo emissor" (há trilha de
  // auditoria) de "não encontrado" (nenhum registro corresponde ao código).
  const isBlocked = hasResultState && !result?.valid && !!(result?.signer || result?.request);
  const isNotFound = hasResultState && !result?.valid && !isBlocked;
  /**
   * O tom da página mora num lugar só: o fio de 2,5 px no alto, o mesmo das
   * telas de assinatura e com os mesmos significados. Quem já assinou um
   * documento pelo Jurius chega aqui reconhecendo a cor antes de ler.
   *
   * Âmbar para "desativado pelo emissor" e vermelho para "não encontrado" NÃO
   * é detalhe: o documento bloqueado existe e está válido — pintá-lo de
   * vermelho insinuaria fraude onde há só uma preferência do escritório.
   */
  const tom: Tom =
    loading || fileLoading ? 'trabalhando'
    : isValid ? 'pronto'
    : isBlocked ? 'espera'
    : isNotFound ? 'problema'
    : 'neutro';

  /*
    O QUE FOI CONSULTADO — e o recibo devolve isso, com o nome certo.

    Antes o recibo mostrava `signer.verification_hash` sob o rótulo fixo
    "Protocolo do envelope". Duas coisas erradas de uma vez: quem digitava o
    código de um DOCUMENTO recebia de volta um número diferente do que tinha na
    mão, e o rótulo chamava de "envelope" o que não era. Casar o papel com a
    tela é a única coisa que esta página existe para permitir.
  */
  const codigoConsultado = (hash || '').trim();
  const protocoloDoEnvelope = (result?.request?.id || result?.request?.envelope_verification_code || '').trim();
  // A RPC marca `is_envelope` quando o código consultado é o do envelope — e
  // esse sinal é mais confiável que comparar strings, porque o payload público
  // do envelope nem sempre devolve o `envelope_verification_code` de volta.
  const respostaDeEnvelope = !!(result?.request as { is_envelope?: boolean } | undefined)?.is_envelope;
  const tipoDoCodigo: ReturnType<typeof classificarCodigo> = respostaDeEnvelope
    ? 'envelope'
    : classificarCodigo(codigoConsultado, {
        envelope: [result?.request?.id, result?.request?.envelope_verification_code],
        documentos: (result?.documents || []).map((doc) => doc.verification_code),
        signatario: result?.signer?.verification_hash,
      });
  /**
   * A lista do envelope só sai quando foi o ENVELOPE que se perguntou.
   *
   * Isto era `documents.length > 0`, e valeu enquanto só a consulta por
   * protocolo devolvia `documents`. Desde que a RPC passou a mandar a lista
   * TAMBÉM na consulta por código individual, aquela condição continuou
   * verdadeira e a tela listava o kit inteiro para quem havia digitado o código
   * de um único documento — mostrando os hashes dos irmãos ao lado do arquivo
   * que a pessoa tinha em mãos.
   */
  const isProtocolResult = isValid && listarDocumentosDoEnvelope({
    tipo: tipoDoCodigo,
    codigoConsultado,
    quantidadeDeDocumentos: result?.documents?.length ?? 0,
  });

  // Validando pelo ARQUIVO não há código digitado; aí o recibo mostra o
  // protocolo do envelope, que é o identificador mais abrangente.
  const codigoDoRecibo = codigoConsultado || protocoloDoEnvelope || (result?.signer?.verification_hash || '').trim();
  const rotuloDoRecibo = codigoConsultado ? rotuloDoCodigo(tipoDoCodigo) : 'Protocolo do envelope';
  const hashDoPdfAssinado = hashDoPdfAssinadoConsultado(
    codigoConsultado,
    result?.documents,
    result?.signer?.signed_pdf_sha256,
  );
  const afirmacao = afirmacaoDaConsulta(verifiedByUploadedFile);
  const hashDoOriginal = hashDoOriginalConsultado(
    codigoConsultado,
    result?.documents,
    result?.signer?.integrity_sha256,
  );
  /** O protocolo vira linha do recibo só quando NÃO é ele que está no topo. */
  const mostrarProtocoloAparte =
    tipoDoCodigo !== 'envelope'
    && !!protocoloDoEnvelope
    && normalizarCodigo(protocoloDoEnvelope) !== normalizarCodigo(codigoDoRecibo);
  const protocoloExibido = codigoDoRecibo;
  const emailDoSignatario = emailPublicoDoSignatario(result?.signer);
  const cpfDoSignatario = mascararCpf(result?.signer?.cpf);
  const canal = canalDoRegistro(result?.signer);
  const autenticacaoUsada = fatoresDeAutenticacao({
    assinatura: result?.signer?.has_signature_image,
    selfie: result?.signer?.has_facial_image,
    documento: result?.signer?.has_document_image,
    canal,
  });
  const identidadeDoRecibo = cpfDoSignatario
    ? `${nomeDoCanal(canal)} · CPF ${cpfDoSignatario}`
    : nomeDoCanal(canal);

  /* ══════════ O DOSSIÊ ══════════
     Tudo que a consulta pública passou a devolver além do último signatário:
     quem emitiu, todos os signatários (inclusive quem ainda não assinou) e a
     trilha de auditoria. Registros antigos podem não ter nada disso — daí os
     fallbacks, que reconstroem uma lista de um só a partir do `signer`. */
  const emissor = result?.creator || null;
  const historico = result?.history || [];
  const listaDeSignatarios = (result?.signers && result.signers.length > 0)
    ? result.signers
    : (result?.signer ? [result.signer as unknown as SignatarioDoDossie] : []);
  const contagem = contagemDeAssinaturas(listaDeSignatarios);
  const criadoEm = result?.envelope?.created_at || null;
  const tituloDoDocumento = documentoSemOSignatario(
    stripDocumentExtension(result?.request?.document_name) || 'Documento assinado',
    result?.signer?.name,
  );
  /**
   * PELO PROTOCOLO NÃO HÁ "O" DOCUMENTO.
   *
   * O kit tem principal e anexos, e a prévia só cabe um. Escolher o principal
   * por conta própria é responder outra pergunta: quem digitou o protocolo
   * perguntou pelo ENVELOPE, e receber de volta um único arquivo — sem dizer
   * qual, nem que havia outros — esconde o resto do kit atrás de uma folha.
   * Aí a lista ocupa o lugar da prévia, e cada arquivo abre no seu clique.
   */
  const consultaDeEnvelope = isProtocolResult;

  /** O código que o `public-verify-file` consegue transformar em arquivo. */
  const codigoDaPrevia = codigoDoArquivoParaPrevia({
    tipo: tipoDoCodigo,
    codigoConsultado,
    documentos: result?.documents,
    codigoDoSignatario: result?.signer?.verification_hash,
  });

  /*
    OS HASHES DOS CHIPS SEGUEM O DOCUMENTO QUE ESTÁ NA PRÉVIA.

    Consultando pelo PROTOCOLO do envelope, `codigoConsultado` não é de arquivo
    nenhum — é do kit —, então `hashDoPdfAssinadoConsultado` não achava nada e a
    coluna do meio ficava com um chip só. A mesma página, aberta pelo código do
    documento, mostrava três. Era o mesmo envelope parecendo duas telas
    diferentes.

    Os chips passam a descrever o arquivo EXIBIDO ao lado. Quando ele foi
    escolhido por nós (o principal do kit), a legenda diz isso — e a lista
    completa, com os dois hashes de cada arquivo, continua logo abaixo.
  */
  const hashDoArquivoExibido = hashDoPdfAssinadoConsultado(
    codigoDaPrevia,
    result?.documents,
    hashDoPdfAssinado || result?.signer?.signed_pdf_sha256,
  );
  const hashOriginalDoArquivoExibido = hashDoOriginalConsultado(
    codigoDaPrevia,
    result?.documents,
    hashDoOriginal,
  );
  const previaEhOutroDocumento =
    !!codigoConsultado && normalizarCodigo(codigoDaPrevia) !== normalizarCodigo(codigoConsultado);

  /*
    BAIXAR O ARQUIVO DE ORIGEM.

    A página imprime o "SHA-256 do original" desde sempre, e até aqui não havia
    como obter esse original: um número que ninguém pode recalcular não é prova,
    é enfeite. O arquivo já estava guardado (`source_file_path`) — só não era
    servido.

    O que volta é o arquivo COMO FOI ENVIADO, normalmente um .docx, e não um
    PDF: é dele que o hash foi tirado, e converter para PDF antes de entregar
    mudaria os bytes e o número deixaria de bater.
  */
  const [origemCarregando, setOrigemCarregando] = useState(false);
  const [origemDoConjunto, setOrigemDoConjunto] = useState(false);

  const baixarArquivo = async (url: string, nome: string) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = nome.replace(/[\\/:*?"<>|]+/g, '_');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000);
  };

  const baixarOriginal = async (codigo: string) => {
    if (!codigo) return;
    try {
      setOrigemCarregando(true);
      const { files, hashScope } = await signatureService.getOriginalFiles(codigo);
      if (files.length === 0) return;
      setOrigemDoConjunto(hashScope === 'set');
      // Vários arquivos saem em sequência: o navegador engasga se todos os
      // cliques sintéticos acontecerem no mesmo quadro.
      for (let i = 0; i < files.length; i += 1) {
        const arquivo = files[i];
        await baixarArquivo(arquivo.url, arquivo.name);
        if (i < files.length - 1) await new Promise((r) => window.setTimeout(r, 350));
      }
    } catch (e) {
      console.error('Erro ao baixar o arquivo de origem:', e);
    } finally {
      setOrigemCarregando(false);
    }
  };

  /** Copiar com aviso: sem o certinho ninguém sabe se o clique pegou. */
  const copiar = async (texto: string, chave: string) => {
    if (!texto) return;
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(chave);
      window.setTimeout(() => setCopiado((atual) => (atual === chave ? '' : atual)), 1600);
    } catch { /* sem área de transferência */ }
  };

  /*
    A PRÉVIA EMBUTIDA.

    O documento aparece renderizado assim que a conferência dá certo, sem
    depender de um clique. Quem chega aqui veio conferir um papel que tem na
    mão: obrigá-lo a abrir um visualizador antes de comparar era um degrau no
    meio da única coisa que a página existe para fazer.

    A URL é assinada e temporária (`public-verify-file`), e vira blob local para
    que ela não fique escrita na barra de endereço nem no histórico.
  */
  useEffect(() => {
    if (!isValid || consultaDeEnvelope || !codigoDaPrevia) {
      setPreviaUrl((anterior) => {
        if (anterior && anterior.startsWith('blob:')) URL.revokeObjectURL(anterior);
        return null;
      });
      return;
    }
    let cancelado = false;
    let criada: string | null = null;
    setPreviaCarregando(true);
    setPreviaFalhou(false);
    (async () => {
      try {
        const url = await resolveSignedDocumentUrl(codigoDaPrevia, result?.signer?.signed_document_path);
        if (!url) throw new Error('sem url');
        let destino = url;
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          criada = URL.createObjectURL(blob);
          destino = criada;
        } catch { /* servidor sem CORS para o GET: usa a própria URL assinada */ }
        if (cancelado) {
          if (criada) URL.revokeObjectURL(criada);
          return;
        }
        setPreviaUrl(destino);
      } catch {
        if (!cancelado) setPreviaFalhou(true);
      } finally {
        if (!cancelado) setPreviaCarregando(false);
      }
    })();
    return () => {
      cancelado = true;
      if (criada) URL.revokeObjectURL(criada);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isValid, consultaDeEnvelope, codigoDaPrevia]);

  /** As linhas do recibo — as mesmas que o signatário guardou no comprovante. */
  const linhasDoRecibo = (
    <>
      {result?.request?.document_name && (
        <LinhaDoRecibo chave="Documento" quebrar>
          {documentoSemOSignatario(
            stripDocumentExtension(result.request.document_name),
            result?.signer?.name,
          )}
        </LinhaDoRecibo>
      )}
      {result?.signer?.name && <LinhaDoRecibo chave="Assinado por" quebrar>{result.signer.name}</LinhaDoRecibo>}
      {result?.signer?.signed_at && <LinhaDoRecibo chave="Assinado em">{formatDate(result.signer.signed_at)}</LinhaDoRecibo>}
      {/* Só entra quando há canal ou CPF. "Identidade: Confirmada" é uma linha
          que ocupa espaço sem informar nada — e a resposta a "este documento é
          autêntico?" já está no selo, não nela. */}
      {(canal || cpfDoSignatario) && (
        <LinhaDoRecibo chave="Identidade">{identidadeDoRecibo}</LinhaDoRecibo>
      )}
      {/* O que foi de fato coletado — pode ser mais de uma coisa. Ver
          `fatoresDeAutenticacao`: mostrar o `auth_method` escondia provas. */}
      {autenticacaoUsada && (
        <LinhaDoRecibo chave="Autenticação" quebrar>{autenticacaoUsada}</LinhaDoRecibo>
      )}
      {emailDoSignatario && <LinhaDoRecibo chave="E-mail" quebrar>{emailDoSignatario}</LinhaDoRecibo>}
      {mostrarProtocoloAparte && (
        <LinhaDoRecibo chave="Protocolo do envelope" quebrar>{protocoloDoEnvelope}</LinhaDoRecibo>
      )}
    </>
  );

  const copiarProtocolo = async () => {
    if (!protocoloExibido) return;
    try { await navigator.clipboard.writeText(protocoloExibido); } catch { /* sem área de transferência */ }
  };

  const rodapeDaPagina = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
      <RodapeDeConfianca itens={['Conexão segura', 'AES-256', 'MP 2.200-2/2001']} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 10, color: TINTA_4 }}>
        <span>© {new Date().getFullYear()} Jurius · {DISPLAY_APP_VERSION_LABEL}</span>
        <a href={termsUrl} style={{ color: TINTA_3, fontWeight: 600, textDecoration: 'none' }}>Termos de Uso</a>
      </div>
    </div>
  );

  return (
    <MolduraPublica
      tom={tom}
      alinhamento="inicio"
      largura={isValid ? 1360 : 720}
      topo={<TopoDaMarca etiqueta="Validador público" />}
      rodape={rodapeDaPagina}
    >
      {/* ══════════ PERGUNTA ══════════
          O título era "Validar documento" — um comando para quem já sabe o que
          quer. Quem chega aqui não é o cliente: é um cartório, um banco, o
          advogado do outro lado, com o comprovante na mão. A pergunta que ele
          veio fazer é o título. */}
      {!hasResultState && (
        <div>
          <Rotulo style={sobe(0)}>Conferência de autenticidade</Rotulo>
          <h1 style={{
            margin: '10px 0 0', fontSize: 30, fontWeight: 700, letterSpacing: '-1px',
            lineHeight: 1.08, color: TINTA, ...sobe(1, 0.5),
          }}>
            Este documento é <span style={{ color: '#ea580c' }}>autêntico</span>?
          </h1>
          <Explicacao style={{ marginTop: 11, maxWidth: 430, ...sobe(2) }}>
            Cole o protocolo do comprovante ou envie o PDF assinado. Conferimos contra o
            registro original, sem login e sem cadastro.
          </Explicacao>
        </div>
      )}

      {/* ══════════ O DOSSIÊ ══════════
          Três colunas: quem participou, o documento, o que se leva embora. No
          celular a grade desmonta com o DOCUMENTO em primeiro lugar — ver
          `.ap-dossie` em publicSigning/dossie.tsx. */}
      {isValid && result?.signer && result?.request && (
        <div>
          {/* O TÍTULO É O DOCUMENTO. A página não fala de si mesma: quem abriu
              este link já sabe que veio conferir; o que ele não sabe ainda é
              QUAL documento respondeu. */}
          <div style={{ ...sobe(0, 0.5) }}>
            <span style={{
              display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '.18em',
              textTransform: 'uppercase', color: '#c2410c',
            }}>
              Documento conferido
            </span>
            <h1 style={{
              margin: '7px 0 0', fontSize: 30, fontWeight: 700, letterSpacing: '-1px',
              lineHeight: 1.12, color: TINTA, overflowWrap: 'anywhere',
            }}>
              {tituloDoDocumento}
            </h1>
            <span style={{ display: 'block', marginTop: 6, fontSize: 13, color: TINTA_3 }}>
              {criadoEm ? `Criado em ${formatDate(criadoEm)}` : 'Registro de assinatura eletrônica'}
              {result.request.client_name ? ` · ${result.request.client_name}` : ''}
            </span>
          </div>

          <div className="ap-dossie" style={{ marginTop: 20 }}>
            {/* ── ESQUERDA: quem participou e o que aconteceu ─────────────── */}
            <div className="ap-dossie-lado" style={sobe(1)}>
              <Painel>
                <Abas
                  ativa={abaDoDossie}
                  aoTrocar={(chave) => setAbaDoDossie(chave as 'signatarios' | 'historico')}
                  itens={[
                    { chave: 'signatarios', rotulo: 'Signatários', contagem: listaDeSignatarios.length },
                    { chave: 'historico', rotulo: 'Histórico', contagem: historico.length },
                  ]}
                />
                {abaDoDossie === 'signatarios' ? (
                  <>
                    {emissor?.name && (
                      <CartaoDoEmissor nome={emissor.name} email={emissor.email} criadoEm={criadoEm} />
                    )}
                    {listaDeSignatarios.map((assinante, indice) => (
                      <CartaoDeSignatario
                        key={assinante.id || `${assinante.name}-${indice}`}
                        signatario={assinante}
                        ultimo={indice === listaDeSignatarios.length - 1}
                      />
                    ))}
                    {listaDeSignatarios.length === 0 && (
                      <p style={{ margin: 0, padding: '14px 13px', fontSize: 11, lineHeight: 1.55, color: TINTA_3 }}>
                        Nenhum signatário detalhado neste registro.
                      </p>
                    )}
                  </>
                ) : (
                  <ListaDoHistorico eventos={historico} />
                )}
              </Painel>
            </div>

            {/* ── MEIO: o documento ──────────────────────────────────────── */}
            <div className="ap-dossie-meio" style={sobe(2)}>
              <FaixaDaContagem texto={contagem.texto} completo={contagem.completo} />

              {/* A comparação que sustenta a validação por arquivo. Só existe
                  quando houve arquivo — na consulta por código nada foi
                  comparado, e a página não pode insinuar que foi. */}
              {verifiedByUploadedFile && (
                <Tarja tom="pronto" style={{ marginTop: 9 }}>
                  A impressão digital do arquivo que você enviou é idêntica à do registro. Byte a
                  byte, é o mesmo PDF que foi assinado.
                </Tarja>
              )}

              {/* Os identificadores, lado a lado e inteiros. */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 11, marginTop: 14 }}>
                {protocoloExibido && (
                  <ChipDeCodigo
                    rotulo={rotuloDoRecibo}
                    valor={protocoloExibido}
                    copiado={copiado === 'protocolo'}
                    aoCopiar={() => { void copiar(protocoloExibido, 'protocolo'); }}
                    icone={<Lock size={12} strokeWidth={2.4} />}
                  />
                )}
                {!consultaDeEnvelope && (hashDoArquivoExibido || fileHash) && (
                  <ChipDeCodigo
                    rotulo="SHA-256 do PDF assinado"
                    valor={hashDoArquivoExibido || fileHash}
                    copiado={copiado === 'sha-assinado'}
                    aoCopiar={() => { void copiar(hashDoArquivoExibido || fileHash, 'sha-assinado'); }}
                    icone={<Shield size={12} strokeWidth={2.4} />}
                  />
                )}
                {!consultaDeEnvelope && hashOriginalDoArquivoExibido && (
                  <ChipDeCodigo
                    rotulo="SHA-256 do original"
                    valor={hashOriginalDoArquivoExibido}
                    copiado={copiado === 'sha-original'}
                    aoCopiar={() => { void copiar(hashOriginalDoArquivoExibido, 'sha-original'); }}
                    icone={<FileText size={12} strokeWidth={2.4} />}
                  />
                )}
              </div>

              {/* O que a página PODE afirmar. Ver `afirmacaoDaConsulta`: consulta
                  por código encontra um registro; ela não compara arquivo
                  nenhum, e prometer integridade aí derrubaria o laudo inteiro. */}
              <p style={{ margin: '12px 0 0', fontSize: 12, lineHeight: 1.65, color: TINTA_3 }}>
                {/* No envelope a frase do meio ficaria apontando para um chip
                    que não existe ("compare o SHA-256 acima"): pelo protocolo
                    não há um hash só, há um par por arquivo. */}
                {consultaDeEnvelope ? (
                  <>
                    Este protocolo corresponde a um envelope no registro e vale o kit inteiro.
                    Cada arquivo abaixo tem o seu código e os seus dois SHA-256 — compare com o
                    PDF que você tem em mãos, ou envie o arquivo para conferência.
                  </>
                ) : (
                  <>
                    {afirmacao.explicacao}
                    {hashOriginalDoArquivoExibido
                      ? ' O SHA-256 do original é o que vai impresso no rodapé do PDF — baixe o arquivo de origem ao lado e recalcule para conferir. O do PDF assinado é o do arquivo que se baixa aqui.'
                      : ''}
                  </>
                )}
              </p>

              {/* O SELO. Só aparece quando existe: envelope anterior a 02/09/2026
                  não tem, e anunciar ausência de selo em documento antigo seria
                  alarmar sem motivo — a assinatura eletrônica dele continua
                  inteira. */}
              {(result.selo?.selados ?? 0) > 0 && (
                <SeloDeIntegridade
                  seladoEm={result.selo?.selado_em}
                  total={result.selo?.total ?? 0}
                  selados={result.selo?.selados ?? 0}
                  impressao={SELO_IMPRESSAO_DIGITAL}
                  urlDoCertificado={SELO_URL_DO_CERTIFICADO}
                />
              )}

              {/* Envelope consolidado ANTIGO com anexos: o hash de integridade
                  cobre a concatenação dos arquivos, na ordem. Sem este aviso, a
                  pessoa baixa o principal, recalcula, vê outro número e conclui
                  que o documento foi adulterado — quando o que ela comparou foi
                  uma parte com o todo. */}
              {origemDoConjunto && (
                <Tarja tom="atencao" style={{ marginTop: 10 }}>
                  Neste envelope o <strong>SHA-256 do original</strong> cobre os arquivos
                  <strong> em conjunto</strong>, na ordem em que foram enviados — é assim que ele
                  foi calculado na época. Recalcular o hash de um arquivo sozinho dá outro número,
                  e isso não indica adulteração. Os documentos assinados mais recentes têm um hash
                  por arquivo, que confere um a um.
                </Tarja>
              )}

              {/* ── A PRÉVIA, ou A LISTA ──────────────────────────────────────
                  Documento único: o PDF renderizado, que é o que a pessoa veio
                  ver. Protocolo de envelope: a lista dos arquivos no MESMO
                  lugar — mostrar um deles ali seria escolher por quem
                  perguntou pelo kit inteiro. */}
              {!consultaDeEnvelope && (
                <Painel style={{ marginTop: 16 }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                    padding: '12px 16px', borderBottom: `1px solid ${LINHA}`, background: '#fafafa',
                  }}>
                    <span style={{
                      minWidth: 0, fontSize: 12.5, fontWeight: 700, color: TINTA_2,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {tituloDoDocumento}
                    </span>
                    <button
                      type="button"
                      onClick={() => { void openDocumentViewer(codigoDaPrevia, result.signer?.signed_document_path); }}
                      style={{
                        flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '6px 12px', border: `1px solid ${LINHA}`, borderRadius: 9,
                        background: '#fff', color: TINTA_2, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      }}
                    >
                      <Eye size={13} strokeWidth={2.2} /> Tela cheia
                    </button>
                  </div>
                  {previaUrl ? (
                    /* `navpanes=0` tira a tira de miniaturas do leitor do Chrome,
                       que come quase metade da largura da coluna; `view=FitH`
                       abre o documento já na largura da página, que é como ele
                       seria lido no papel. */
                    <iframe
                      title="Documento assinado"
                      src={`${previaUrl}#navpanes=0&view=FitH`}
                      className="ap-dossie-visor"
                      style={{ display: 'block', width: '100%', border: 'none', background: '#fff' }}
                    />
                  ) : (
                    <div
                      className="ap-dossie-visor"
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        justifyContent: 'center', gap: 9, padding: 22, textAlign: 'center',
                      }}
                    >
                      {previaCarregando ? (
                        <>
                          <Roda tamanho={24} />
                          <span style={{ fontSize: 13, fontWeight: 600, color: TINTA_2 }}>Carregando o documento…</span>
                        </>
                      ) : (
                        <>
                          <FileText size={28} strokeWidth={1.6} color={TINTA_4} />
                          <span style={{ fontSize: 13, lineHeight: 1.65, color: TINTA_3, maxWidth: 400 }}>
                            {previaFalhou
                              ? 'O arquivo assinado não pôde ser exibido aqui. A assinatura continua registrada e os dados ao lado seguem válidos.'
                              : 'Este registro não tem um arquivo assinado para exibir.'}
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </Painel>
              )}

              {consultaDeEnvelope && (
                <Painel style={{ marginTop: 16 }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                    padding: '13px 16px', borderBottom: `1px solid ${LINHA}`, background: '#fafafa',
                  }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: TINTA_2 }}>
                      Documentos deste envelope
                    </span>
                    <span style={{ fontSize: 12, color: TINTA_3 }}>
                      {result.documents!.length} {result.documents!.length === 1 ? 'arquivo' : 'arquivos'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {result.documents!.map((doc, index) => {
                      const codigo = (doc.verification_code || '').trim();
                      const principal = doc.document_type === 'main';
                      return (
                        <div
                          key={codigo || index}
                          className="ap-dossie-arquivo"
                          style={{
                            padding: 18,
                            borderBottom: index === result.documents!.length - 1 ? 'none' : `1px solid ${LINHA}`,
                          }}
                        >
                          <div style={{ display: 'flex', gap: 13, alignItems: 'flex-start' }}>
                            <span style={{
                              flex: '0 0 auto', width: 38, height: 44, borderRadius: 8, marginTop: 1,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              background: principal ? '#fff7ed' : '#f8fafc',
                              border: `1px solid ${principal ? '#fed7aa' : '#e2e8f0'}`,
                              color: principal ? '#c2410c' : TINTA_3,
                            }}>
                              <FileText size={18} strokeWidth={1.9} />
                            </span>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 15, fontWeight: 700, color: TINTA, letterSpacing: '-.2px', overflowWrap: 'anywhere' }}>
                                  {/* Anexo guardado com uuid por nome vira "Anexo N". */}
                                  {nomeDoDocumentoDoKit(doc.display_name, doc.document_type, index)}
                                </span>
                                <span style={{
                                  padding: '3px 8px', borderRadius: 999, fontSize: 9.5, fontWeight: 700,
                                  letterSpacing: '.06em', textTransform: 'uppercase',
                                  background: principal ? '#ffedd5' : '#f1f5f9',
                                  color: principal ? '#9a3412' : TINTA_2,
                                }}>
                                  {principal ? 'Principal' : 'Anexo'}
                                </span>
                              </div>
                              {codigo && (
                                <span style={{
                                  display: 'block', marginTop: 5, fontSize: 12, color: TINTA_2,
                                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                                  letterSpacing: '-.2px',
                                }}>
                                  {codigo}
                                </span>
                              )}
                              {/* Sem reticências: hash cortado não serve para conferir
                                  nem para copiar, que é a única coisa que se faz com ele. */}
                              {doc.document_hash && (
                                <span style={{
                                  display: 'block', marginTop: 7, fontSize: 10, color: TINTA_3,
                                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                                  lineHeight: 1.6, letterSpacing: '-.2px', overflowWrap: 'anywhere',
                                }}>
                                  <b style={{ fontFamily: 'inherit', fontWeight: 700 }}>ORIGINAL</b>{' '}
                                  {doc.document_hash}
                                </span>
                              )}
                              {doc.signed_pdf_sha256 && (
                                <span style={{
                                  display: 'block', marginTop: 3, fontSize: 10, color: TINTA_3,
                                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                                  lineHeight: 1.6, letterSpacing: '-.2px', overflowWrap: 'anywhere',
                                }}>
                                  <b style={{ fontFamily: 'inherit', fontWeight: 700 }}>ASSINADO</b>{' '}
                                  {doc.signed_pdf_sha256}
                                </span>
                              )}
                              {codigo ? (
                                <span style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                  <button
                                    type="button"
                                    onClick={() => { void openDocumentViewer(codigo); }}
                                    style={{
                                      display: 'inline-flex', alignItems: 'center', gap: 6,
                                      padding: '8px 15px', border: 'none', borderRadius: 10,
                                      background: '#ea580c', color: '#fff', fontSize: 12.5,
                                      fontWeight: 700, cursor: 'pointer',
                                      boxShadow: '0 8px 18px -12px rgba(234,88,12,.9)',
                                    }}
                                  >
                                    <Eye size={13} strokeWidth={2.3} /> Abrir
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { void downloadSignedByCode(codigo, doc.display_name || ''); }}
                                    style={{
                                      display: 'inline-flex', alignItems: 'center', gap: 6,
                                      padding: '8px 15px', border: `1px solid ${LINHA}`, borderRadius: 10,
                                      background: '#fff', color: TINTA_2, fontSize: 12.5,
                                      fontWeight: 700, cursor: 'pointer',
                                    }}
                                  >
                                    <Download size={13} strokeWidth={2.2} /> Assinado
                                  </button>
                                  {/* A origem DESTE arquivo — é dela que sai o
                                      SHA-256 marcado ORIGINAL logo acima. */}
                                  <button
                                    type="button"
                                    onClick={() => { void baixarOriginal(codigo); }}
                                    disabled={origemCarregando}
                                    style={{
                                      display: 'inline-flex', alignItems: 'center', gap: 6,
                                      padding: '8px 15px', border: `1px solid ${LINHA}`, borderRadius: 10,
                                      background: '#fff', color: TINTA_2, fontSize: 12.5,
                                      fontWeight: 700, cursor: origemCarregando ? 'default' : 'pointer',
                                      opacity: origemCarregando ? 0.5 : 1,
                                    }}
                                  >
                                    <FileText size={13} strokeWidth={2.2} /> Original
                                  </button>
                                </span>
                              ) : (
                                <span style={{ display: 'block', marginTop: 8, fontSize: 11.5, lineHeight: 1.55, color: TINTA_3 }}>
                                  Este arquivo faz parte do kit, mas não tem código próprio de
                                  verificação — ele foi assinado num envelope anterior ao modelo
                                  por documento.
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Painel>
              )}
            </div>

            {/* ── DIREITA: o que se leva embora ──────────────────────────── */}
            <div className="ap-dossie-opcoes" style={sobe(3)}>
              <Painel>
                <TituloDoPainel>Opções</TituloDoPainel>
                {/* No envelope não há "o" arquivo para baixar: um botão aqui
                    entregaria o principal calado, e cada arquivo do kit já tem
                    o seu par de botões na lista ao lado. */}
                {!consultaDeEnvelope && (
                  <>
                    <Opcao
                      icone={<Download size={15} strokeWidth={2.1} />}
                      titulo="Baixar PDF assinado"
                      descricao="O arquivo com as assinaturas e a página de auditoria no fim."
                      desabilitado={viewerLoading || !codigoDaPrevia}
                      onClick={() => { void handleDownloadSigned(); }}
                    />
                    <Opcao
                      icone={<Eye size={15} strokeWidth={2.1} />}
                      titulo="Abrir em tela cheia"
                      descricao="Lê o documento sem as colunas ao lado."
                      desabilitado={viewerLoading || !codigoDaPrevia}
                      onClick={() => { void openDocumentViewer(codigoDaPrevia, result.signer?.signed_document_path); }}
                    />
                  </>
                )}
                <Opcao
                  icone={<FileText size={15} strokeWidth={2.1} />}
                  titulo={origemCarregando ? 'Baixando…' : 'Baixar arquivo original'}
                  descricao="Como foi enviado para assinatura, sem carimbo nenhum. É dele que sai o SHA-256 do original."
                  desabilitado={origemCarregando || !protocoloExibido}
                  onClick={() => { void baixarOriginal(protocoloExibido); }}
                />
                <Opcao
                  icone={<Shield size={15} strokeWidth={2.1} />}
                  titulo={copiado === 'link' ? 'Link copiado' : 'Copiar link desta conferência'}
                  descricao="Manda a mesma página para quem também precisa conferir."
                  onClick={() => { void copiar(`${window.location.origin}/#/verificar/${protocoloExibido}`, 'link'); }}
                />
                <Opcao
                  icone={<ArrowLeft size={15} strokeWidth={2.1} />}
                  titulo="Conferir outro documento"
                  descricao="Volta ao campo de protocolo e ao envio de PDF."
                  onClick={() => {
                    setResult(null); setSearched(false); setHash(''); setFileHash('');
                    autoVerifiedRef.current = true;
                  }}
                />
              </Painel>

              {qrDataUrl && (
                <Painel style={{ marginTop: 16 }}>
                  <div style={{ display: 'flex', gap: 13, padding: '15px 16px', alignItems: 'center' }}>
                    <img src={qrDataUrl} alt="QR desta conferência" style={{ width: 62, height: 62, flex: '0 0 auto' }} />
                    <span style={{ fontSize: 11.5, lineHeight: 1.55, color: TINTA_3 }}>
                      Aponte a câmera para reabrir esta conferência em outro aparelho.
                    </span>
                  </div>
                </Painel>
              )}
            </div>
          </div>
        </div>
      )}


      {/* ══════════ DESATIVADO PELO EMISSOR ══════════
          Âmbar, não vermelho: o documento existe e a assinatura vale. O que foi
          desligado é a consulta pública. */}
      {isBlocked && (
        <div style={{ marginTop: 4 }}>
          <div style={{ ...sobe(0, 0.5) }}>
            <span style={{
              display: 'inline-flex', width: 40, height: 40, borderRadius: 999, marginBottom: 14,
              alignItems: 'center', justifyContent: 'center', color: '#fff',
              background: 'linear-gradient(135deg,#fbbf24,#d97706)',
              boxShadow: '0 12px 26px -12px rgba(217,119,6,.7)',
              animation: 'ap-selo .6s cubic-bezier(.2,1.4,.4,1) .25s both',
            }}>
              <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="#fff" strokeWidth="2.6"
                   strokeLinecap="round" aria-hidden>
                <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
            </span>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: '-.9px', lineHeight: 1.08, color: TINTA }}>
              A consulta deste código está fechada.
            </h1>
            <Explicacao style={{ marginTop: 9, maxWidth: 430 }}>
              O registro existe e a assinatura continua válida — o escritório que emitiu o
              documento desligou a consulta pública deste código.
            </Explicacao>
            {result?.message && (
              <Explicacao style={{ marginTop: 8, maxWidth: 430, color: TINTA_3 }}>{result.message}</Explicacao>
            )}
          </div>

          <Recibo
            codigo={protocoloExibido}
            rotulo={rotuloDoRecibo}
            estado="desativado"
            esmaecido
            style={{ marginTop: 20, ...sobe(2, 0.5) }}
          >
            {linhasDoRecibo}
          </Recibo>

          <div style={{ maxWidth: 320, marginTop: 12, ...sobe(3) }}>
            <AcaoSecundaria
              onClick={() => {
                setResult(null); setSearched(false); setHash(''); setFileHash('');
                autoVerifiedRef.current = true;
              }}
            >
              Consultar outro código
            </AcaoSecundaria>
          </div>
        </div>
      )}

      {/* ══════════ NÃO ENCONTRADO ══════════
          Devolve o código tentado e avisa das confusões de quem copia do papel.
          Um código que não existe não é prova de documento falso, e a tela não
          pode insinuar que é. */}
      {isNotFound && (
        <div style={{ marginTop: 20, maxWidth: 430 }}>
          <div style={sobe(0, 0.5)}>
            <span style={{
              display: 'inline-flex', width: 38, height: 38, borderRadius: 999, marginBottom: 13,
              alignItems: 'center', justifyContent: 'center', color: '#fff',
              background: 'linear-gradient(135deg,#fb7185,#e11d48)',
              boxShadow: '0 12px 26px -12px rgba(225,29,72,.7)',
              animation: 'ap-selo .6s cubic-bezier(.2,1.4,.4,1) .25s both',
            }}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" strokeWidth="3"
                   strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
            </span>
            <h1 style={{ margin: 0, fontSize: 25, fontWeight: 700, letterSpacing: '-.9px', lineHeight: 1.08, color: TINTA }}>
              Nenhum registro com este código.
            </h1>
            <Explicacao style={{ marginTop: 9 }}>
              {hash
                ? <>Nada encontrado para <strong style={{ color: TINTA, fontWeight: 600 }}>{hash}</strong>. Um código que não existe não quer dizer documento falso.</>
                : 'Não localizamos nenhuma assinatura com esse código.'}
            </Explicacao>
          </div>

          <Tarja tom="atencao" style={{ marginTop: 16, ...sobe(2) }}>
            Copiando do papel? Atenção ao <strong>0 e O</strong>, <strong>1 e I</strong>.
          </Tarja>

          {/* Sem botão "corrigir": o campo continua logo abaixo, com o código
              digitado dentro dele. Um botão que só rola a tela até um campo
              visível é degrau a mais. */}
          <p style={{ margin: '14px 0 0', fontSize: 11.5, color: TINTA_3 }}>
            Corrija o código abaixo e tente de novo — ou envie o PDF, que dispensa digitação.
          </p>
        </div>
      )}

      {/* ══════════ ENTRADA ══════════ */}
      {!isValid && !isBlocked && (
        <div style={{ marginTop: hasResultState ? 20 : 22, maxWidth: 420 }}>
          <div style={{
            display: 'flex', gap: 4, padding: 3, borderRadius: 10,
            background: '#eef2f6', width: 'fit-content', ...sobe(3),
          }}>
            {([
              { key: 'code', label: 'Protocolo ou código' },
              { key: 'file', label: 'Arquivo PDF' },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveMode(tab.key)}
                style={{
                  padding: '6px 12px', borderRadius: 7, border: 'none', cursor: 'pointer',
                  fontSize: 11.5, fontWeight: 600,
                  background: activeMode === tab.key ? '#fff' : 'transparent',
                  color: activeMode === tab.key ? TINTA : TINTA_2,
                  boxShadow: activeMode === tab.key ? '0 1px 2px rgba(15,23,42,.08)' : 'none',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeMode === 'code' ? (
            <div style={sobe(4)}>
              {/* O campo veste o mesmo picotado do comprovante de onde a pessoa
                  está copiando: ela olha para o papel e para a tela e vê a
                  mesma coisa antes de ler qualquer rótulo. */}
              <div style={{
                marginTop: 14, border: '1px dashed #cbd5e1', borderRadius: 6,
                background: '#fff', overflow: 'hidden',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                  padding: '6px 11px', borderBottom: '1px dashed #cbd5e1', background: '#f8fafc',
                }}>
                  <span style={{
                    fontSize: 8, fontWeight: 700, letterSpacing: '.14em',
                    textTransform: 'uppercase', color: TINTA_3,
                  }}>
                    Protocolo do envelope ou código do documento
                  </span>
                </div>
                <input
                  type="text"
                  value={hash}
                  onChange={(e) => setHash(e.target.value.trim())}
                  onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
                  placeholder="A7K2-9QF4-3XLM"
                  aria-label="Protocolo ou código de verificação"
                  style={{
                    width: '100%', border: 'none', outline: 'none', background: 'transparent',
                    padding: '13px 11px', textAlign: 'center',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: 18, fontWeight: 500, letterSpacing: '.08em', color: TINTA,
                  }}
                />
              </div>

              <div style={{ marginTop: 12 }}>
                <AcaoPrimaria
                  onClick={() => handleVerify()}
                  disabled={loading || !hash.trim()}
                  icone={loading ? <Roda tamanho={17} cor="#fff" /> : undefined}
                >
                  {loading ? 'Conferindo…' : 'Verificar autenticidade'}
                </AcaoPrimaria>
              </div>

              <p style={{ margin: '14px 0 0', fontSize: 11, lineHeight: 1.55, color: TINTA_3 }}>
                <strong style={{ color: TINTA_2, fontWeight: 600 }}>Onde encontrar:</strong> no comprovante
                que o signatário recebeu, no rodapé de cada página do PDF assinado e na margem
                esquerda da folha.
              </p>
            </div>
          ) : (
            <div style={sobe(4)}>
              <label
                style={{
                  display: 'block', marginTop: 14, padding: '18px 16px', textAlign: 'center',
                  border: '1px dashed #cbd5e1', borderRadius: 12, background: '#fff', cursor: 'pointer',
                }}
              >
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleVerifyFile(f); }}
                  style={{ display: 'none' }}
                />
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: TINTA }}>
                  Escolher o PDF assinado
                </span>
                <span style={{ display: 'block', marginTop: 4, fontSize: 11, color: TINTA_3 }}>
                  ou arraste o arquivo até aqui
                </span>
              </label>

              {/*
                A frase mais importante desta tela, e ela não existia. Quem vai
                conferir um contrato sigiloso hesita antes de entregar o PDF a um
                site — e o cálculo é MESMO local (`crypto.subtle` no navegador),
                então dizê-lo é só contar a verdade.
              */}
              <Tarja tom="neutro" style={{ marginTop: 12 }}>
                O arquivo não sai do seu aparelho. A impressão digital é calculada aqui, e só
                ela é comparada com o registro.
              </Tarja>

              {fileLoading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 14 }}>
                  <Roda tamanho={17} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: TINTA }}>
                    Calculando a impressão digital…
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Visualizador do documento assinado — sem expor a URL do storage. */}
      {viewerUrl && (
        <div
          className="fixed inset-0 z-[100] flex h-[100dvh] flex-col bg-slate-900/70 backdrop-blur-sm"
          onClick={closeViewer}
        >
          <div
            className="flex shrink-0 items-center justify-between gap-3 bg-white px-4 py-3 sm:px-6"
            style={{ borderBottom: '1px solid #e7e5e4' }}
            onClick={(e) => e.stopPropagation()}
          >
            <span style={{ minWidth: 0, fontSize: 13, fontWeight: 600, color: TINTA, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {stripDocumentExtension(result?.request?.document_name) || 'Documento assinado'}
            </span>
            <button
              type="button"
              onClick={closeViewer}
              style={{
                flex: '0 0 auto', padding: '6px 12px', borderRadius: 9, border: '1px solid #e2e8f0',
                background: '#fff', color: TINTA_2, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Fechar
            </button>
          </div>
          <iframe
            title="Documento assinado"
            src={viewerUrl}
            className="w-full flex-1 bg-white"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </MolduraPublica>
  );
};

export default PublicVerificationPage;
