import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Shield, CheckCircle, XCircle, Loader2, FileText, User, Calendar, Hash, AlertCircle, Download, Eye, Lock } from 'lucide-react';
import { signatureService } from '../services/signature.service';
import { pdfSignatureService } from '@/services/pdfSignature.service';
import type { Signer, SignatureRequest } from '../types/signature.types';
import { DISPLAY_APP_VERSION_LABEL } from '../utils/appVersion';
import { buildPublicSignatureTermsUrl } from '../utils/publicAppUrl';

interface VerificationResult {
  valid: boolean;
  signer?: Signer;
  request?: SignatureRequest;
  message: string;
}

/** Mascara nome: "Pedro Rodrigues Montalvao" → "P***** R********* M*********" */
const maskName = (name: string): string => {
  return (name || '').trim().split(/\s+/).map(word =>
    word.length <= 1 ? word : word[0] + '*'.repeat(word.length - 1)
  ).join(' ');
};

const isInternalPlaceholderEmail = (email: string | null | undefined): boolean => {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return false;
  return e.startsWith('public+') && e.endsWith('@crm.local');
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

  const handleVerifyClick = () => {
    handleVerify();
  };

  const handleVerify = async (code?: string) => {
    const codeToUse = (code ?? hash).trim();
    if (!codeToUse) return;
    try {
      setLoading(true);
      setSearched(true);
      const data = await signatureService.verifySignatureByHash(codeToUse);
      if (data && data.status === 'valid') {
        setResult({ valid: true, signer: data.signer, request: data.request, message: 'Assinatura válida e autêntica.' });
      } else if (data && data.status === 'blocked') {
        setResult({
          valid: false,
          signer: data.signer,
          request: data.request,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // QR de validação instantânea — aponta para a própria URL de verificação do documento
  useEffect(() => {
    const code = result?.valid ? (result.signer?.verification_hash || hash) : '';
    if (!code) { setQrDataUrl(''); return; }
    const url = `${window.location.origin}/#/verificar/${code}`;
    QRCode.toDataURL(url, { width: 200, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [result, hash]);

  // Abre o documento assinado num visualizador interno (iframe), sem expor a URL do Supabase.
  // Busca o PDF e exibe via blob: — o link assinado nunca vai para o DOM. Fallback: iframe direto.
  const openDocumentViewer = async (path: string) => {
    try {
      setViewerLoading(true);
      const url = await pdfSignatureService.getSignedPdfUrl(path);
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

  useEffect(() => () => { if (viewerUrl && viewerUrl.startsWith('blob:')) URL.revokeObjectURL(viewerUrl); }, [viewerUrl]);

  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const termsUrl = buildPublicSignatureTermsUrl();
  const isValid = !!(searched && result && result.valid && result.signer && result.request);
  const labelCls = 'block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1';

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#f4f7f9' }}>
      {/* Faixa de marca */}
      <div className="h-[4px] w-full" style={{ background: 'linear-gradient(90deg, #ea580c 0%, #f97316 45%, #fb923c 100%)' }} />

      {/* Header */}
      <header className="bg-white border-b border-gray-100 py-4 px-6 sm:px-8 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-extrabold text-lg flex-shrink-0"
              style={{ background: 'linear-gradient(150deg,#FF7A33,#EA5310)', boxShadow: '0 8px 20px -8px rgba(242,99,26,0.5)' }}
            >
              J
            </div>
            <span className="text-xl font-black tracking-tight text-slate-900">JURIUS</span>
            <div className="h-4 w-px bg-gray-300 mx-1 hidden sm:block" />
            <span className="text-[11px] uppercase tracking-widest text-gray-400 font-semibold hidden sm:block">Validação de Documento</span>
          </div>
          <a href={termsUrl} className="text-xs text-gray-400 hover:text-orange-600 transition-colors hidden sm:block">Termos de Uso</a>
        </div>
      </header>

      {/* Conteúdo */}
      <main className="flex-grow py-10 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">

          {/* ── COLUNA ESQUERDA (2/3) ── */}
          <div className="lg:col-span-2 space-y-8">

            {/* Card de busca */}
            <section className="bg-white rounded-xl p-6 sm:p-8 shadow-[0_4px_20px_rgba(0,0,0,0.05)]">
              <h2 className="text-2xl font-bold text-slate-900 mb-2">Verificar autenticidade</h2>
              <p className="text-sm text-slate-500 mb-6">Informe o código de autenticidade para validar o documento assinado.</p>

              {/* Tabs */}
              <div className="mb-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => setActiveMode('code')}
                  className={`px-4 py-2 rounded-md text-sm font-medium border transition ${activeMode === 'code' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-gray-200 hover:bg-gray-50'}`}
                >
                  Código
                </button>
                <button
                  type="button"
                  onClick={() => setActiveMode('file')}
                  className={`px-4 py-2 rounded-md text-sm font-medium border transition ${activeMode === 'file' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-gray-200 hover:bg-gray-50'}`}
                >
                  Arquivo (PDF)
                </button>
              </div>

              {activeMode === 'code' ? (
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="text"
                    value={hash}
                    onChange={(e) => setHash(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
                    placeholder="Ex: 4F98692357B789F2"
                    className="flex-1 px-4 py-3 border border-gray-200 rounded-lg text-sm font-mono tracking-wide focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent placeholder:text-slate-400"
                  />
                  <button
                    onClick={handleVerifyClick}
                    disabled={loading || !hash.trim()}
                    className="px-8 py-3 bg-slate-900 text-white text-sm font-bold rounded-lg hover:bg-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 min-w-[120px]"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verificar'}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <label className="block">
                    <span className="text-sm font-medium text-slate-700">Envie o PDF assinado</span>
                    <input
                      type="file"
                      accept="application/pdf"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleVerifyFile(f);
                      }}
                      className="mt-2 block w-full text-sm file:mr-4 file:py-2.5 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-gray-100 file:text-slate-700 hover:file:bg-gray-200"
                    />
                  </label>
                  {fileLoading && (
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Calculando SHA-256 e verificando...
                    </div>
                  )}
                  {fileHash && (
                    <div className="text-xs text-slate-500">
                      <div className="font-medium text-slate-700">SHA-256</div>
                      <div className="mt-1 font-mono break-all bg-gray-50 border border-gray-100 rounded-md p-3">{fileHash}</div>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Card de resultado — válido */}
            {isValid && result?.signer && result?.request && (
              <section className="bg-white rounded-xl overflow-hidden shadow-[0_4px_20px_rgba(0,0,0,0.05)] flex flex-col">
                <div className="h-1 bg-gradient-to-r from-orange-600 to-amber-500" />
                <div className="p-6 sm:p-8 space-y-6">
                  {/* Cabeçalho + selo */}
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
                    <div>
                      <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 leading-tight">Certificado de Autenticidade Digital</h1>
                      <p className="text-slate-500 mt-2 text-sm max-w-md">Documento emitido para fins de validação jurídica e prova técnica eletrônica.</p>
                    </div>
                    <span className="inline-flex items-center gap-2 bg-gray-100 px-3 py-1.5 rounded border border-gray-200 shrink-0 whitespace-nowrap">
                      <Lock className="w-3.5 h-3.5 text-orange-600" />
                      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Protegido por Criptografia AES-256</span>
                    </span>
                  </div>

                  {/* Quadro de dados */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-y-6 gap-x-6 border border-gray-100 rounded-xl p-6 bg-gray-50/60">
                    <div className="md:col-span-2 border-b border-gray-200 pb-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Dados do documento</span>
                    </div>

                    <div>
                      <span className={labelCls}>Documento</span>
                      <span className="block text-sm font-medium text-slate-900 break-words">{result.request.document_name}</span>
                    </div>
                    <div>
                      <span className={labelCls}>Signatário</span>
                      <span className="block text-sm font-medium text-slate-900 font-mono tracking-wide">{maskName(result.signer.name)}</span>
                      {result.signer.role && <span className="block text-xs text-slate-500 mt-0.5">{result.signer.role}</span>}
                    </div>
                    <div>
                      <span className={labelCls}>Data de emissão</span>
                      <span className="block text-sm font-medium text-orange-700">{result.signer.signed_at ? formatDate(result.signer.signed_at) : '—'}</span>
                    </div>
                    <div>
                      <span className={labelCls}>Código de verificação</span>
                      <span className="block text-sm font-mono text-slate-900">{result.signer.verification_hash || hash}</span>
                    </div>
                    <div>
                      <span className={labelCls}>Timestamp servidor</span>
                      <span className="block text-sm font-mono text-slate-700">{result.signer.signed_at ? `${new Date(result.signer.signed_at).getTime()}-UTC` : '—'}</span>
                    </div>

                    {/* Hash só aparece quando é casável: integrity (= rodapé, docs novos) ou fileHash (modo Arquivo). */}
                    {(result.signer.integrity_sha256 || fileHash) && (
                      <div className="md:col-span-2">
                        <span className={labelCls}>{result.signer.integrity_sha256 ? 'SHA-256 do documento' : 'SHA-256 do arquivo'}</span>
                        <span className="block text-[11px] font-mono text-slate-700 break-all leading-relaxed">{result.signer.integrity_sha256 || fileHash}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Ação */}
                {result.signer.signed_document_path && (
                  <div className="px-6 sm:px-8 pb-8">
                    <button
                      onClick={() => openDocumentViewer(result.signer!.signed_document_path!)}
                      disabled={viewerLoading}
                      className="w-full sm:w-auto bg-orange-600 text-white px-6 py-3 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-orange-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {viewerLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Eye className="w-5 h-5" />}
                      Visualizar documento
                    </button>
                  </div>
                )}
              </section>
            )}

            {/* Card de resultado — inválido (bloqueado / não encontrado) */}
            {searched && result && !result.valid && (
              <section className="bg-white rounded-xl overflow-hidden shadow-[0_4px_20px_rgba(0,0,0,0.05)]">
                {result.signer || result.request ? (
                  <div className="bg-amber-500 px-6 py-4 flex items-center gap-3">
                    <Lock className="w-5 h-5 text-white" />
                    <div>
                      <p className="text-white font-medium">Validação pública desativada</p>
                      <p className="text-amber-100 text-xs">A assinatura ocorreu — dados de auditoria disponíveis abaixo</p>
                    </div>
                  </div>
                ) : (
                  <div className="bg-red-600 px-6 py-4 flex items-center gap-3">
                    <XCircle className="w-5 h-5 text-white" />
                    <div>
                      <p className="text-white font-medium">Documento não encontrado</p>
                      <p className="text-red-100 text-xs">Verifique o código informado</p>
                    </div>
                  </div>
                )}

                <div className="p-6">
                  <p className="text-sm text-slate-600 mb-4">{result.message}</p>

                  {(result.signer || result.request) && (
                    <div className="border border-gray-100 rounded-lg overflow-hidden mt-2">
                      <div className="bg-gray-50 px-4 py-2 border-b border-gray-100">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Registro de auditoria</p>
                      </div>
                      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {result.request && (
                          <div>
                            <p className={labelCls}>Documento</p>
                            <p className="text-sm text-slate-900 font-medium">{result.request.document_name}</p>
                          </div>
                        )}
                        {result.signer && (
                          <div>
                            <p className={labelCls}>Signatário</p>
                            <p className="text-sm text-slate-900 font-medium font-mono tracking-wide">{maskName(result.signer.name)}</p>
                          </div>
                        )}
                        {result.signer?.signed_at && (
                          <div>
                            <p className={labelCls}>Data da assinatura</p>
                            <p className="text-sm text-slate-900">{formatDate(result.signer.signed_at)}</p>
                          </div>
                        )}
                        {(result.signer?.verification_hash || hash) && (
                          <div>
                            <p className={labelCls}>Código</p>
                            <p className="text-sm text-slate-900 font-mono">{result.signer?.verification_hash || hash}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {!result.signer && !result.request && (
                    <p className="text-sm text-slate-600">
                      Não foi possível localizar um documento com o código <span className="font-mono font-medium">{hash}</span>.
                      Certifique-se de que o código foi digitado corretamente. Ele está localizado no rodapé do documento assinado.
                    </p>
                  )}
                </div>
              </section>
            )}
          </div>

          {/* ── COLUNA DIREITA (1/3) ── */}
          <div className="lg:col-span-1 flex flex-col gap-8 lg:sticky lg:top-24">

            {/* Painel de status — só quando válido */}
            {isValid && (
              <div
                className="rounded-xl p-8 text-white shadow-[0_4px_20px_rgba(0,0,0,0.05)] relative overflow-hidden"
                style={{ background: 'linear-gradient(135deg, #15803d 0%, #16a34a 100%)' }}
              >
                <Shield className="w-48 h-48 absolute -right-8 -top-8 opacity-10" fill="currentColor" stroke="none" />
                <div className="relative z-10">
                  <span className="block text-[10px] font-bold uppercase tracking-widest opacity-80 mb-6">Status do Documento</span>
                  <div className="flex items-center gap-3 mb-6">
                    <div className="bg-white/20 p-2 rounded-full border border-white/30 shrink-0">
                      <CheckCircle className="w-7 h-7" />
                    </div>
                    <span className="text-3xl sm:text-4xl font-bold tracking-tight">VALIDADO</span>
                  </div>
                  <p className="text-sm leading-relaxed opacity-90 font-medium">
                    Este documento foi assinado digitalmente e possui validade jurídica.
                  </p>
                </div>
              </div>
            )}

            {/* Card do QR — só quando válido e QR gerado */}
            {isValid && qrDataUrl && (
              <div className="bg-white rounded-xl p-8 shadow-[0_4px_20px_rgba(0,0,0,0.05)] flex flex-col items-center justify-center">
                <div className="bg-white p-3 rounded-xl mb-4 border border-gray-100">
                  <img src={qrDataUrl} alt="QR de validação" className="w-32 h-32" />
                </div>
                <p className="text-center text-[10px] font-bold uppercase tracking-wider text-slate-900">Validação Instantânea</p>
                <p className="text-center text-[10px] text-slate-500 mt-0.5">Aponte a câmera para validar</p>
              </div>
            )}

            {/* Aviso */}
            <div className="text-center text-[11px] text-gray-400 leading-relaxed px-2">
              A verificação garante a autenticidade e integridade do documento assinado digitalmente.{' '}
              Ao utilizar este sistema, você concorda com os{' '}
              <a href={termsUrl} className="text-slate-500 hover:text-orange-600 underline underline-offset-2">Termos de Uso</a>.
            </div>
          </div>
        </div>
      </main>

      {/* Visualizador interno do documento (iframe) — não expõe a URL do Supabase */}
      {viewerUrl && (
        <div className="fixed inset-0 z-[100] flex flex-col bg-slate-900/70 backdrop-blur-sm" onClick={closeViewer}>
          <div className="flex items-center justify-between px-4 sm:px-6 py-3 bg-slate-900 text-white shrink-0" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="w-4 h-4 text-orange-400 shrink-0" />
              <span className="text-sm font-medium truncate">Documento assinado</span>
            </div>
            <button
              onClick={closeViewer}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium bg-white/10 hover:bg-white/20 transition-colors"
            >
              <XCircle className="w-4 h-4" />
              Fechar
            </button>
          </div>
          <iframe
            title="Documento assinado"
            src={viewerUrl}
            className="flex-1 w-full bg-white"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Footer */}
      <footer className="bg-white border-t border-gray-100 py-6 px-6 sm:px-8 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row gap-4 items-center justify-between">
          <span className="text-xs font-semibold text-gray-500">© {new Date().getFullYear()} Jurius · {DISPLAY_APP_VERSION_LABEL}</span>
          <div className="flex gap-6 text-[11px] font-bold text-gray-500 uppercase tracking-tight">
            <a href={termsUrl} className="hover:text-orange-600 transition-colors">Termos de Uso</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default PublicVerificationPage;
