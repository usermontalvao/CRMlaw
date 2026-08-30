// (o @ts-nocheck saiu: esta tela passou a ser conferida pelo compilador)
import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { ArrowLeft, CheckCircle, ChevronDown, ChevronRight, Download, Eye, FileText, Loader2, Lock, Shield, XCircle } from 'lucide-react';
import {
  AcaoPrimaria,
  AcaoSecundaria,
  DivisorPicotado,
  Explicacao,
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
  VERDE,
  sobe,
  type Tom,
} from './publicSigning/ui';
import {
  canalDoRegistro,
  classificarCodigo,
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
import type { VerifiedDocument } from '../services/signature.service';
import { pdfSignatureService } from '@/services/pdfSignature.service';
import type { Signer, SignatureRequest } from '../types/signature.types';
import { DISPLAY_APP_VERSION_LABEL } from '../utils/appVersion';
import { buildPublicSignatureTermsUrl } from '../utils/publicAppUrl';

interface VerificationResult {
  valid: boolean;
  signer?: Signer;
  request?: SignatureRequest;
  documents?: VerifiedDocument[];
  message: string;
}

const isInternalPlaceholderEmail = (email: string | null | undefined): boolean => {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return false;
  return e.startsWith('public+') && e.endsWith('@crm.local');
};

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
  const [meaningOpen, setMeaningOpen] = useState(false);

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
        setResult({ valid: true, signer: data.signer, request: data.request, documents: data.documents, message: 'Assinatura válida e autêntica.' });
      } else if (data && data.status === 'blocked') {
        setResult({
          valid: false,
          signer: data.signer,
          request: data.request,
          documents: data.documents,
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
        setResult({ valid: true, signer: data.signer, request: data.request, message: 'Documento válido e íntegro (hash confirmado).' });
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
  const statusBadgeLabel = result?.request?.status === 'signed' ? 'Concluído' : 'Registrado';
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
  const emailDoSignatario = isInternalPlaceholderEmail(result?.signer?.email) ? '' : (result?.signer?.email || '');
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
      largura={720}
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

      {/* ══════════ RESULTADO ══════════ */}
      {isValid && result?.signer && result?.request && (
        <div style={{ marginTop: 4 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', ...sobe(0, 0.5) }}>
            <span style={{
              flex: '0 0 auto', marginTop: 2, width: 40, height: 40, borderRadius: 999,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
              background: 'linear-gradient(135deg,#34d399,#059669)',
              boxShadow: '0 12px 26px -12px rgba(5,150,105,.8)',
              animation: 'ap-selo .6s cubic-bezier(.2,1.4,.4,1) .25s both',
            }}>
              <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="#fff" strokeWidth="3.2"
                   strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 12l5 5L20 6" /></svg>
            </span>
            <div>
              {/* A tela afirma só o que conferiu. Ver `afirmacaoDaConsulta`:
                  consulta por código ENCONTRA um registro; ela não compara
                  arquivo nenhum. Dizer "nada foi alterado" ali era uma
                  afirmação de integridade não verificada — a primeira coisa
                  que um perito da parte contrária derrubaria. */}
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: '-.95px', lineHeight: 1.08, color: TINTA }}>
                {afirmacao.titulo} <span style={{ color: VERDE }}>{afirmacao.destaque}</span>.
              </h1>
              <Explicacao style={{ marginTop: 8, maxWidth: 460 }}>
                {afirmacao.explicacao}
              </Explicacao>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22, alignItems: 'flex-start', marginTop: 24 }}>
            {/* O RECIBO — literalmente a mesma peça do comprovante do signatário. */}
            <Recibo
              codigo={protocoloExibido}
              rotulo={rotuloDoRecibo}
              estado="valido"
              aoCopiar={() => { void copiarProtocolo(); }}
              acaoDeCopia={tipoDoCodigo === 'envelope' || !codigoConsultado ? 'Copiar protocolo' : 'Copiar código'}
              style={{ flex: '0 0 auto', width: 300, ...sobe(2, 0.5) }}
            >
              {linhasDoRecibo}
            </Recibo>

            <div style={{ flex: 1, minWidth: 250 }}>
              {/* A impressão digital sai da caixa cinza e vira dado de primeira
                  classe. No modo arquivo, as DUAS aparecem lado a lado: é a
                  comparação que sustenta o resultado, e o leitor precisa vê-la
                  em vez de acreditar que aconteceu. */}
              {/* No envelope com vários arquivos, o hash de cada um vive na lista
                  abaixo; repetir um deles aqui em cima só confundiria qual é
                  qual. Este bloco fica para o documento único e para a
                  comparação da validação por arquivo. */}
              {(fileHash || hashDoPdfAssinado || hashDoOriginal) && !(isProtocolResult && !verifiedByUploadedFile) && (
                <div style={{
                  border: '1px solid #e7e5e4', borderRadius: 11, background: '#fff',
                  padding: '11px 13px', ...sobe(3),
                }}>
                  {verifiedByUploadedFile ? (
                    <>
                      <span style={rotuloDoHash}>Do seu arquivo</span>
                      <code style={codigoDoHash}>{fileHash}</code>
                      <DivisorPicotado style={{ margin: '9px 0' }} />
                      <span style={rotuloDoHash}>Do registro do PDF assinado</span>
                      <code style={codigoDoHash}>{hashDoPdfAssinado || fileHash}</code>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 9,
                        fontSize: 9.5, fontWeight: 700, color: VERDE,
                      }}>
                        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor"
                             strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M4 12l5 5L20 6" />
                        </svg>
                        Idênticos — uma vírgula alterada mudaria isto
                      </span>
                    </>
                  ) : (
                    <>
                      {/* OS DOIS HASHES, porque respondem a perguntas diferentes.
                          O do ORIGINAL é o que está impresso no PDF; o do
                          ASSINADO é o do arquivo que se baixa e não pode ser
                          impresso dentro dele mesmo (mudaria os bytes). Mostrar
                          só um fazia a pessoa comparar o número impresso com o
                          arquivo em mãos e achar que nada batia. */}
                      {hashDoOriginal ? (
                        <>
                          <span style={rotuloDoHash}>SHA-256 do documento original</span>
                          <code style={codigoDoHash}>{hashDoOriginal}</code>
                          <span style={{ display: 'block', marginTop: 5, fontSize: 9, color: '#78716c', lineHeight: 1.45 }}>
                            É este que aparece impresso no rodapé do documento assinado.
                          </span>
                          <DivisorPicotado style={{ margin: '9px 0' }} />
                        </>
                      ) : null}
                      <span style={rotuloDoHash}>SHA-256 do PDF assinado</span>
                      <code style={codigoDoHash}>{fileHash || hashDoPdfAssinado}</code>
                      <span style={{ display: 'block', marginTop: 5, fontSize: 9, color: '#78716c', lineHeight: 1.45 }}>
                        É este que corresponde ao arquivo que você baixa aqui.
                      </span>
                    </>
                  )}
                </div>
              )}

              {/* Modelo per_document: cada arquivo do kit tem o seu código. */}
              {isProtocolResult && (
                <div style={{
                  marginTop: 12, border: '1px solid #e7e5e4', borderRadius: 11,
                  background: '#fff', overflow: 'hidden', ...sobe(4),
                }}>
                  <span style={{
                    display: 'block', padding: '9px 12px 5px', fontSize: 8.5, fontWeight: 700,
                    letterSpacing: '.14em', textTransform: 'uppercase', color: TINTA_4,
                  }}>
                    Documentos deste envelope ({result.documents!.length})
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 12px 12px' }}>
                    {result.documents!.map((doc, index) => {
                      const codigo = (doc.verification_code || '').trim();
                      return (
                        <div key={codigo || index} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ minWidth: 0, flex: 1 }}>
                            <span style={{
                              display: 'block', fontSize: 11.5, fontWeight: 600, color: TINTA,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {stripDocumentExtension(doc.display_name) || codigo || `Documento ${index + 1}`}
                            </span>
                            <span style={{
                              display: 'block', marginTop: 1, fontSize: 9.5, color: TINTA_3,
                              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                            }}>
                              {codigo}
                            </span>
                            {/* A impressão digital DESTE arquivo. É o que permite
                                conferir o PDF que a pessoa tem na mão — um hash
                                só, do envelope, não responde isso quando o kit
                                tem principal e dois anexos. */}
                            {/* Sem reticências: hash cortado não serve para conferir
                                nem para copiar, que é a única coisa que se faz
                                com ele. */}
                            {/* OS DOIS HASHES, cada um dizendo de quê.
                                Antes saía só "SHA-256 …" com o valor do
                                ASSINADO — e um rótulo que não diz qual é qual
                                faz a pessoa comparar o número impresso no
                                rodapé do PDF (que é o do ORIGINAL) com este, e
                                concluir que não bate. */}
                            {doc.document_hash && (
                              <span style={{
                                display: 'block', marginTop: 3, fontSize: 8.5, color: TINTA_4,
                                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                                lineHeight: 1.5, overflowWrap: 'anywhere',
                              }}>
                                <b style={{ fontFamily: 'inherit', fontWeight: 700 }}>ORIGINAL</b>{' '}
                                {doc.document_hash}
                              </span>
                            )}
                            {doc.signed_pdf_sha256 && (
                              <span style={{
                                display: 'block', marginTop: 2, fontSize: 8.5, color: TINTA_4,
                                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                                lineHeight: 1.5, overflowWrap: 'anywhere',
                              }}>
                                <b style={{ fontFamily: 'inherit', fontWeight: 700 }}>ASSINADO</b>{' '}
                                {doc.signed_pdf_sha256}
                              </span>
                            )}
                          </span>
                          {codigo && (
                            <button
                              type="button"
                              onClick={() => { void openDocumentViewer(codigo); }}
                              style={{
                                flex: '0 0 auto', padding: '5px 10px', border: '1px solid #e2e8f0',
                                borderRadius: 8, background: '#fff', color: TINTA_2,
                                fontSize: 10.5, fontWeight: 600, cursor: 'pointer',
                              }}
                            >
                              Abrir
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p style={{
                    margin: 0, padding: '0 12px 11px', fontSize: 9.5, lineHeight: 1.5, color: TINTA_4,
                  }}>
                    São dois SHA-256 por arquivo. O <b>ORIGINAL</b> é o do documento antes de
                    assinar — é ele que aparece impresso no rodapé do PDF. O <b>ASSINADO</b> é o do
                    arquivo que você baixa aqui; baixe e compare com este para provar que é
                    exatamente ele.
                  </p>
                </div>
              )}

              <div style={{ marginTop: 12, ...sobe(5) }}>
                <AcaoPrimaria
                  onClick={() => { void openDocumentViewer(protocoloExibido, result.signer?.signed_document_path); }}
                  disabled={viewerLoading}
                  icone={viewerLoading ? <Roda tamanho={17} cor="#fff" /> : undefined}
                >
                  {viewerLoading ? 'Abrindo…' : 'Abrir documento assinado'}
                </AcaoPrimaria>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <AcaoSecundaria onClick={() => { void handleDownloadSigned(); }}>Baixar PDF</AcaoSecundaria>
                  <AcaoSecundaria
                    onClick={() => {
                      setResult(null); setSearched(false); setHash(''); setFileHash('');
                      autoVerifiedRef.current = true;
                    }}
                  >
                    Nova consulta
                  </AcaoSecundaria>
                </div>
              </div>

              {qrDataUrl && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 11, marginTop: 12,
                  border: '1px solid #e7e5e4', borderRadius: 11, background: '#fff',
                  padding: '10px 12px', ...sobe(6),
                }}>
                  <img src={qrDataUrl} alt="QR desta validação" style={{ width: 48, height: 48, flex: '0 0 auto' }} />
                  <span style={{ fontSize: 11, lineHeight: 1.5, color: TINTA_2 }}>
                    Aponte a câmera para reabrir esta conferência, ou compartilhe o QR com quem
                    precisar conferir também.
                  </span>
                </div>
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

const rotuloDoHash: React.CSSProperties = {
  display: 'block', fontSize: 8, fontWeight: 700, letterSpacing: '.16em',
  textTransform: 'uppercase', color: '#cbd5e1',
};

const codigoDoHash: React.CSSProperties = {
  display: 'block', marginTop: 5, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 10, lineHeight: 1.6, color: '#64748b', wordBreak: 'break-all',
};

export default PublicVerificationPage;
