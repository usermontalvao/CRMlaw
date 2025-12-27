import React, { useEffect, useRef, useState } from 'react';
import { Shield, CheckCircle, XCircle, Loader2, FileText, User, Calendar, Hash, AlertCircle, Download, Eye } from 'lucide-react';
import { signatureService } from '../services/signature.service';
import { pdfSignatureService } from '@/services/pdfSignature.service';
import BrandLogo from '@/components/ui/BrandLogo';
import type { Signer, SignatureRequest } from '../types/signature.types';

interface VerificationResult {
  valid: boolean;
  signer?: Signer;
  request?: SignatureRequest;
  message: string;
}

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
      if (data) {
        setResult({ valid: true, signer: data.signer, request: data.request, message: 'Assinatura válida e autêntica.' });
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

  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header minimalista */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <BrandLogo size="sm" showWordmark={false} showTagline={false} />
            <div className="leading-tight">
              <p className="text-sm font-semibold text-slate-900">Jurius</p>
              <p className="text-[11px] text-slate-500">Sistema de Gestão Jurídica</p>
            </div>
          </div>
          <span className="text-xs text-slate-400 hidden sm:block">Assinatura Digital</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        {/* Card de busca */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 sm:p-8">
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-slate-900 mb-1">Verificar autenticidade</h1>
            <p className="text-sm text-slate-500">
              Informe o código de autenticidade para validar o documento assinado.
            </p>
          </div>

          {/* Tabs */}
          <div className="mb-5 flex gap-2">
            <button
              type="button"
              onClick={() => setActiveMode('code')}
              className={`px-4 py-2 rounded-md text-sm font-medium border transition ${activeMode === 'code' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
            >
              Código
            </button>
            <button
              type="button"
              onClick={() => setActiveMode('file')}
              className={`px-4 py-2 rounded-md text-sm font-medium border transition ${activeMode === 'file' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
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
                className="flex-1 px-4 py-3 border border-slate-300 rounded-md text-sm font-mono tracking-wide focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent placeholder:text-slate-400"
              />
              <button
                onClick={handleVerifyClick}
                disabled={loading || !hash.trim()}
                className="px-6 py-3 bg-slate-900 text-white text-sm font-medium rounded-md hover:bg-slate-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 min-w-[120px]"
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
                  className="mt-2 block w-full text-sm file:mr-4 file:py-2.5 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
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
                  <div className="mt-1 font-mono break-all bg-slate-50 border border-slate-200 rounded-md p-3">{fileHash}</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Resultado */}
        {searched && result && (
          <div className="mt-6">
            {result.valid ? (
              <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                {/* Status bar */}
                <div className="bg-emerald-600 px-6 py-4 flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-white" />
                  <div>
                    <p className="text-white font-medium">Documento Autêntico</p>
                    <p className="text-emerald-100 text-xs">Assinatura verificada com sucesso</p>
                  </div>
                </div>

                {/* Detalhes */}
                {result.signer && result.request && (
                  <div className="p-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div>
                        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">Documento</p>
                        <p className="text-sm text-slate-900 font-medium">{result.request.document_name}</p>
                      </div>

                      <div>
                        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">Signatário</p>
                        <p className="text-sm text-slate-900 font-medium">{result.signer.name}</p>
                        {(() => {
                          const authEmail = String(result.signer!.auth_email || '').trim();
                          const phone = String(result.signer!.phone || '').trim();
                          const rawEmail = String(result.signer!.email || '').trim();
                          const displayContact =
                            authEmail ||
                            (result.signer!.auth_provider === 'phone' ? phone : '') ||
                            (!isInternalPlaceholderEmail(rawEmail) ? rawEmail : '');
                          if (!displayContact) return null;
                          return <p className="text-xs text-slate-500">{displayContact}</p>;
                        })()}
                      </div>

                      <div>
                        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">Data da assinatura</p>
                        <p className="text-sm text-slate-900">
                          {result.signer.signed_at ? formatDate(result.signer.signed_at) : '—'}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">Código</p>
                        <p className="text-sm text-slate-900 font-mono">{result.signer.verification_hash || hash}</p>
                      </div>
                    </div>

                    {/* Ações */}
                    {result.signer.signed_document_path && (
                      <div className="mt-6 pt-6 border-t border-slate-100">
                        <button
                          onClick={async () => {
                            try {
                              const url = await pdfSignatureService.getSignedPdfUrl(result.signer!.signed_document_path!);
                              if (url) window.open(url, '_blank');
                            } catch (e) {
                              console.error('Erro ao abrir documento:', e);
                            }
                          }}
                          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 transition-colors"
                        >
                          <Eye className="w-4 h-4" />
                          Visualizar documento
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                <div className="bg-red-600 px-6 py-4 flex items-center gap-3">
                  <XCircle className="w-5 h-5 text-white" />
                  <div>
                    <p className="text-white font-medium">Documento não encontrado</p>
                    <p className="text-red-100 text-xs">Verifique o código informado</p>
                  </div>
                </div>
                <div className="p-6">
                  <p className="text-sm text-slate-600">
                    Não foi possível localizar um documento com o código <span className="font-mono font-medium">{hash}</span>.
                    Certifique-se de que o código foi digitado corretamente. Ele está localizado no rodapé do documento assinado.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer discreto */}
        <div className="mt-8 text-center text-xs text-slate-400 space-y-1">
          <p>
            A verificação garante a autenticidade e integridade do documento assinado digitalmente.
          </p>
          <p>
            Jurius · v{__APP_VERSION__}
          </p>
        </div>
      </main>
    </div>
  );
};

export default PublicVerificationPage;
