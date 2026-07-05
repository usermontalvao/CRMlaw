// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { ArrowLeft, CheckCircle, ChevronDown, ChevronRight, Download, Eye, FileText, Loader2, Lock, Shield, XCircle } from 'lucide-react';
import { BrandLogo } from './ui';
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

const maskName = (name: string): string => {
  return (name || '').trim().split(/\s+/).map((word) =>
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
      a.download = `${(result?.request?.document_name || 'documento-assinado').replace(/[\\/:*?"<>|]+/g, '_')}.pdf`;
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
      a.download = `${(name || 'documento-assinado').replace(/[\\/:*?"<>|]+/g, '_')}.pdf`;
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
  // Protocolo (envelope) traz o kit inteiro em documents[]; código individual não.
  const isProtocolResult = isValid && Array.isArray(result?.documents) && (result?.documents?.length ?? 0) > 0;
  const labelCls = 'block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 mb-1';

  return (
    <div className="min-h-screen flex flex-col bg-white text-slate-900">
      <main className={`flex-1 px-3 sm:px-6 ${hasResultState ? 'py-4 sm:py-6' : 'py-3 sm:py-4'}`}>
        <div className="mx-auto w-full max-w-[1080px]">
          <section className="overflow-hidden bg-white">
            <div className="flex items-start justify-between gap-3 px-4 py-3 sm:items-center sm:px-6 sm:py-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 ring-1 ring-orange-100">
                  <BrandLogo iconOnly size="sm" />
                </div>
                <div className="min-w-0">
                  <p className="text-xl font-black tracking-tight text-slate-900 sm:text-lg">JURIUS</p>
                  <p className="text-[11px] font-medium text-slate-500">Validador público de autenticidade documental</p>
                </div>
              </div>
              <Shield className="h-4 w-4 text-orange-500" strokeWidth={2} />
            </div>
            <div className="h-[3px] w-full" style={{ background: 'linear-gradient(90deg, #ea580c 0%, #f97316 55%, #fb923c 100%)' }} />
          </section>

          <div className={`${hasResultState ? 'mt-6' : 'mt-4'}`}>
            <div className={`min-w-0 ${isValid ? 'max-w-[1080px]' : 'max-w-[720px]'}`}>
              <a href={`${window.location.origin}/#/`} className={`inline-flex items-center gap-2 text-base font-semibold text-orange-600 transition hover:text-orange-700 sm:text-sm ${hasResultState ? 'mb-5 sm:mb-6' : 'mb-4'}`}>
                <ArrowLeft className="h-4 w-4" />
                Voltar ao Início
              </a>

              <section>
                <h1 className="text-[1.45rem] font-black tracking-[-0.04em] text-slate-950 sm:text-[2.1rem]">Validar documento</h1>
                <p className="mt-3 max-w-[560px] text-[14px] leading-8 text-slate-600 sm:mt-2 sm:text-[15px] sm:leading-6">
                  {activeMode === 'file'
                    ? 'Envie o PDF assinado: calculamos o SHA-256 do arquivo e comparamos com os registros persistidos.'
                    : 'Cole o código do documento ou o protocolo do envelope exibido no rodapé do documento assinado — validamos o arquivo específico ou o kit inteiro.'}
                </p>

                <div className="mt-5 inline-flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-slate-100/70 p-1 sm:mt-4">
                  {([
                    { key: 'code', label: 'Código ou Protocolo' },
                    { key: 'file', label: 'Arquivo PDF' },
                  ] as const).map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveMode(tab.key)}
                      className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition sm:py-2 ${activeMode === tab.key ? 'bg-white text-orange-600 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className={hasResultState ? 'mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] lg:items-start' : 'mt-4'}>
                <div className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-5">
                  {activeMode !== 'file' ? (
                    <div>
                      <label className="mb-3 block text-[15px] font-bold text-slate-800 sm:mb-2 sm:text-sm">
                        Código ou Protocolo
                      </label>
                      <input
                        type="text"
                        value={hash}
                        onChange={(e) => setHash(e.target.value.trim())}
                        onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
                        placeholder="Cole o código do documento ou o protocolo do envelope"
                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3.5 text-[16px] text-slate-900 shadow-[inset_0_1px_2px_rgba(15,23,42,0.04)] outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:ring-4 focus:ring-orange-100 sm:py-3 sm:text-base"
                      />
                      <p className="mt-2 text-sm text-slate-500">
                        Aceita tanto o código de um documento específico quanto o protocolo do envelope (valida o kit inteiro). Ambos aparecem no rodapé do documento assinado e no final da URL.
                      </p>
                      <button
                        onClick={() => handleVerify()}
                        disabled={loading || !hash.trim()}
                        className="mt-5 inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-5 py-3 text-base font-bold text-white transition hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 sm:mt-4 sm:min-h-0 sm:w-auto sm:min-w-[168px] sm:py-2.5 sm:text-sm"
                      >
                        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                        Validar
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <label className="block text-sm font-bold text-slate-800">Arquivo assinado em PDF</label>
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
                        <input
                          type="file"
                          accept="application/pdf"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleVerifyFile(f);
                          }}
                          className="block w-full text-sm file:mr-4 file:rounded-xl file:border-0 file:bg-orange-500 file:px-4 file:py-2.5 file:font-semibold file:text-white hover:file:bg-orange-600"
                        />
                        <p className="mt-3 text-sm text-slate-500">O sistema calcula o SHA-256 do PDF e compara com os registros persistidos.</p>
                      </div>
                      {fileLoading && (
                        <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Calculando SHA-256 e verificando...
                        </div>
                      )}
                      {fileHash && (
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">SHA-256</p>
                          <p className="mt-2 break-all font-mono text-[12px] leading-6 text-slate-700">{fileHash}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {isValid && result?.signer && result?.request && (
                <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                  <div className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50/70 px-5 py-2.5">
                    <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-600">Status do documento</span>
                    <span className="ml-auto rounded-full bg-emerald-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-white">{statusBadgeLabel}</span>
                  </div>
                  <div className="p-5 sm:p-6">
                    <div className="flex items-center gap-3.5">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/30">
                        <CheckCircle className="h-6 w-6" />
                      </div>
                      <p className="min-w-0 flex-1 text-xl font-black leading-tight tracking-[-0.02em] text-emerald-700 sm:text-[1.7rem]">Válido e Autêntico</p>
                    </div>
                    <p className="mt-3.5 text-sm leading-6 text-slate-600">
                      {verifiedByUploadedFile
                        ? 'O arquivo enviado corresponde ao PDF assinado registrado na base. A integridade foi confirmada por comparação de SHA-256.'
                        : isProtocolResult
                          ? `Protocolo válido: ${result.documents!.length} documento(s) assinado(s) neste envelope. Assinatura registrada em ${result.signer.signed_at ? formatDate(result.signer.signed_at) : 'data indisponível'}.`
                          : `Este código corresponde a um registro de assinatura válido. Assinatura registrada em ${result.signer.signed_at ? formatDate(result.signer.signed_at) : 'data indisponível'}.`}
                    </p>
                  </div>
                </div>
                )}
                {searched && result && !result.valid && (
                <section className={`overflow-hidden rounded-2xl border shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${isBlocked ? 'border-amber-200' : 'border-red-200'} bg-white`}>
                  <div className={`flex items-center gap-2 border-b px-5 py-2.5 ${isBlocked ? 'border-amber-100 bg-amber-50/70' : 'border-red-100 bg-red-50/70'}`}>
                    <span className={`text-[11px] font-bold uppercase tracking-[0.18em] ${isBlocked ? 'text-amber-600' : 'text-red-500'}`}>Status do documento</span>
                    <span className={`ml-auto rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-white ${isBlocked ? 'bg-amber-500' : 'bg-red-500'}`}>
                      {isBlocked ? 'Auditoria' : 'Inválido'}
                    </span>
                  </div>
                  <div className="p-5 sm:p-6">
                    <div className="flex items-center gap-3.5">
                      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-lg ${isBlocked ? 'bg-amber-500 shadow-amber-500/30' : 'bg-red-500 shadow-red-500/30'}`}>
                        {isBlocked ? <Lock className="h-6 w-6" /> : <XCircle className="h-6 w-6" />}
                      </div>
                      <p className={`min-w-0 flex-1 text-xl font-black leading-tight tracking-[-0.02em] sm:text-[1.7rem] ${isBlocked ? 'text-amber-700' : 'text-red-600'}`}>
                        {isBlocked ? 'Validação desativada' : 'Documento não encontrado'}
                      </p>
                    </div>
                    <p className="mt-3.5 text-sm leading-6 text-slate-600">
                      {isBlocked
                        ? (result.message || 'A assinatura existe, mas a validação pública foi desativada pelo emissor.')
                        : 'Não localizamos nenhuma assinatura com esse código. Verifique se o código/protocolo foi digitado corretamente.'}
                    </p>
                  </div>
                  {isBlocked && (result.signer || result.request) && (
                    <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-5 sm:px-6">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Registro de auditoria</p>
                      <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-2">
                        {result.request && (
                          <div>
                            <span className={labelCls}>Documento</span>
                            <p className="text-base font-semibold text-slate-800">{result.request.document_name}</p>
                          </div>
                        )}
                        {result.signer && (
                          <div>
                            <span className={labelCls}>Signatário</span>
                            <p className="text-base font-semibold text-slate-800">{maskName(result.signer.name)}</p>
                          </div>
                        )}
                        {result.signer?.signed_at && (
                          <div>
                            <span className={labelCls}>Data da assinatura</span>
                            <p className="text-base text-slate-700">{formatDate(result.signer.signed_at)}</p>
                          </div>
                        )}
                        {(result.signer?.verification_hash || hash) && (
                          <div>
                            <span className={labelCls}>Código</span>
                            <p className="break-all font-mono text-[13px] text-slate-700">{result.signer?.verification_hash || hash}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </section>
                )}
                </div>
              </section>

              {isValid && result?.signer && result?.request && (
                <section className="mt-8 space-y-4">
                  <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                    <div className="border-b border-slate-200 bg-slate-100/90 px-6 py-4 sm:px-8">
                      <h3 className="text-[1.35rem] font-black tracking-[-0.03em] text-slate-800">Informações do Documento</h3>
                    </div>
                    <div className="grid grid-cols-1 gap-x-8 gap-y-6 px-6 py-6 sm:px-8 md:grid-cols-2">
                      <div>
                        <span className={labelCls}>Nome do Documento</span>
                        <p className="break-words text-base font-semibold leading-7 text-slate-800">{result.request.document_name}</p>
                      </div>
                      <div>
                        <span className={labelCls}>Data da Assinatura</span>
                        <p className="text-base font-semibold leading-7 text-slate-700">{result.signer.signed_at ? formatDate(result.signer.signed_at) : '—'}</p>
                      </div>
                      {(result.signer.integrity_sha256 || fileHash) && <div>
                        <span className={labelCls}>Hash do Documento original (SHA256)</span>
                        <p className="break-all font-mono text-[13px] leading-7 text-slate-700">{result.signer.integrity_sha256 || fileHash}</p>
                      </div>}
                      <div>
                        <span className={labelCls}>Código de Verificação</span>
                        <p className="break-all font-mono text-[13px] leading-7 text-slate-800">{result.signer.verification_hash || hash}</p>
                      </div>
                      <div>
                        <span className={labelCls}>Signatário</span>
                        <p className="text-base font-semibold text-slate-800">{maskName(result.signer.name)}</p>
                        {result.signer.email && !isInternalPlaceholderEmail(result.signer.email) && (
                          <p className="mt-1 text-sm text-slate-500">{result.signer.email}</p>
                        )}
                      </div>
                      <div>
                        <span className={labelCls}>Timestamp do servidor</span>
                        <p className="font-mono text-[13px] leading-7 text-slate-700">{result.signer.signed_at ? `${new Date(result.signer.signed_at).getTime()}-UTC` : '—'}</p>
                      </div>
                    </div>
                    {(result.documents && result.documents.length > 0) ? (
                      // Modelo per_document: cada arquivo é um documento final independente,
                      // acessado pelo seu próprio código de verificação.
                      <div className="border-t border-slate-100 px-6 py-5 sm:px-8">
                        <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                          Documentos assinados ({result.documents.length})
                        </p>
                        <div className="space-y-2">
                          {result.documents.map((doc) => (
                            <div key={doc.verification_code} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5">
                              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600 ring-1 ring-orange-100">
                                <FileText className="h-4 w-4" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-slate-800">{doc.display_name || doc.verification_code}</p>
                                <p className="font-mono text-[11px] text-slate-400">{doc.document_type === 'main' ? 'Principal' : 'Anexo'} · {doc.verification_code}</p>
                              </div>
                              <div className="flex flex-shrink-0 items-center gap-1.5">
                                <button
                                  onClick={() => openDocumentViewer(doc.verification_code)}
                                  disabled={viewerLoading}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
                                >
                                  <Eye className="h-3.5 w-3.5" />Ver
                                </button>
                                <button
                                  onClick={() => downloadSignedByCode(doc.verification_code, doc.display_name || doc.verification_code)}
                                  disabled={viewerLoading}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-[13px] font-semibold text-white transition hover:bg-orange-600 disabled:opacity-60"
                                >
                                  <Download className="h-3.5 w-3.5" />Baixar
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : result.signer.signed_document_path && (
                      <div className="border-t border-slate-100 px-6 py-5 sm:px-8">
                        <div className="flex flex-wrap gap-2.5">
                          <button
                            onClick={() => openDocumentViewer(result.signer!.verification_hash || hash, result.signer!.signed_document_path)}
                            disabled={viewerLoading}
                            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                          >
                            {viewerLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                            Ver assinado
                          </button>
                          <button
                            onClick={handleDownloadSigned}
                            disabled={viewerLoading}
                            className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:opacity-60"
                          >
                            <Download className="h-4 w-4" />
                            Baixar assinado
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                    <div className="flex items-center justify-between border-b border-slate-200 bg-slate-100/90 px-6 py-4 sm:px-8">
                      <h3 className="text-[1.3rem] font-black tracking-[-0.03em] text-slate-800">Assinaturas</h3>
                      <span className="text-sm font-semibold text-slate-600">1 de 1 assinaturas</span>
                    </div>
                    <div className="space-y-4 px-6 py-5 sm:px-8">
                      <div className="rounded-2xl border border-slate-200 bg-white p-5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-lg bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-700">Assinado</span>
                          <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">Autenticação reconhecida pelo Jurius</span>
                        </div>
                        <p className="mt-3 text-base font-semibold text-slate-800">{result.signer.name}</p>
                        {result.signer.email && !isInternalPlaceholderEmail(result.signer.email) && (
                          <p className="text-sm text-slate-600">{result.signer.email}</p>
                        )}
                        <p className="mt-1 text-sm text-slate-600">Data e hora {result.signer.signed_at ? formatDate(result.signer.signed_at) : '—'}</p>
                      </div>

                      <button
                        type="button"
                        onClick={() => setMeaningOpen((prev) => !prev)}
                        className="flex w-full items-center justify-between rounded-2xl bg-slate-100 px-5 py-3.5 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
                      >
                        <span>O que isso significa?</span>
                        <ChevronDown className={`h-5 w-5 transition ${meaningOpen ? 'rotate-180' : ''}`} />
                      </button>

                      {meaningOpen && (
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm leading-7 text-slate-600">
                          Compare o documento baixado com a versão que você tem em mãos para garantir a autenticidade. O código de verificação e o hash vinculam o arquivo ao registro de assinatura persistido no sistema.
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              )}

              {isValid && qrDataUrl && (
                <div className="mt-4 inline-flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                  <img src={qrDataUrl} alt="QR de validação" className="h-14 w-14 rounded-lg border border-slate-200 p-1" />
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Validação instantânea</p>
                    <p className="text-xs text-slate-500">Use a câmera do celular para abrir este registro.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {viewerUrl && (
        <div className="fixed inset-0 z-[100] flex flex-col bg-slate-900/70 backdrop-blur-sm" onClick={closeViewer}>
          <div className="flex items-center justify-between gap-3 bg-slate-900 px-4 py-3 text-white sm:px-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex min-w-0 items-center gap-2">
              <FileText className="h-4 w-4 shrink-0 text-cyan-300" />
              <span className="truncate text-sm font-medium">Documento assinado</span>
            </div>
            <button
              onClick={closeViewer}
              className="inline-flex items-center gap-2 rounded-md bg-white/10 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-white/20"
            >
              <XCircle className="h-4 w-4" />
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

      <footer className="mt-auto border-t border-slate-200 bg-white px-6 py-4 sm:px-8">
        <div className="mx-auto flex max-w-[1180px] flex-col items-center justify-between gap-3 text-center sm:flex-row sm:text-left">
          <span className="text-sm font-medium text-slate-500">© {new Date().getFullYear()} Jurius · {DISPLAY_APP_VERSION_LABEL}</span>
          <a href={termsUrl} className="text-sm font-semibold text-slate-500 transition hover:text-orange-600">Termos de Uso</a>
        </div>
      </footer>
    </div>
  );
};

export default PublicVerificationPage;
