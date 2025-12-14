import React, { useState } from 'react';
import { Shield, CheckCircle, XCircle, Loader2, FileText, User, Calendar, Hash, AlertCircle, Download, Eye } from 'lucide-react';
import { signatureService } from '../services/signature.service';
import { pdfSignatureService } from '../services/pdfSignature.service';
import type { Signer, SignatureRequest } from '../types/signature.types';

interface VerificationResult {
  valid: boolean;
  signer?: Signer;
  request?: SignatureRequest;
  message: string;
}

const PublicVerificationPage: React.FC = () => {
  const [hash, setHash] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [searched, setSearched] = useState(false);

  const handleVerify = async () => {
    if (!hash.trim()) return;
    try {
      setLoading(true);
      setSearched(true);
      const data = await signatureService.verifySignatureByHash(hash.trim());
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

  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200">
      <header className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-600 rounded-lg flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-semibold text-slate-800">Verificação de Assinatura</h1>
            <p className="text-xs text-slate-500">Valide a autenticidade de documentos assinados</p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 py-12">
        <div className="bg-white rounded-2xl shadow-lg p-8 mb-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Hash className="w-8 h-8 text-emerald-600" />
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-2">Verificar Assinatura Digital</h2>
            <p className="text-slate-600 max-w-md mx-auto">
              Insira o código de verificação (hash) presente no documento assinado para validar sua autenticidade.
            </p>
          </div>

          <div className="max-w-xl mx-auto">
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <Hash className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  value={hash}
                  onChange={(e) => setHash(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleVerify()}
                  placeholder="Digite o código de verificação..."
                  className="w-full pl-12 pr-4 py-4 border border-slate-200 rounded-xl text-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-mono"
                />
              </div>
              <button
                onClick={handleVerify}
                disabled={loading || !hash.trim()}
                className="px-8 py-4 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Shield className="w-5 h-5" />}
                Verificar
              </button>
            </div>
          </div>
        </div>

        {searched && result && (
          <div className={`bg-white rounded-2xl shadow-lg p-8 border-2 ${result.valid ? 'border-emerald-500' : 'border-red-500'}`}>
            <div className="flex items-start gap-4">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0 ${result.valid ? 'bg-emerald-100' : 'bg-red-100'}`}>
                {result.valid ? <CheckCircle className="w-7 h-7 text-emerald-600" /> : <XCircle className="w-7 h-7 text-red-600" />}
              </div>
              <div className="flex-1">
                <h3 className={`text-xl font-bold mb-1 ${result.valid ? 'text-emerald-700' : 'text-red-700'}`}>
                  {result.valid ? 'Assinatura Válida' : 'Assinatura Não Encontrada'}
                </h3>
                <p className="text-slate-600 mb-4">{result.message}</p>

                {result.valid && result.signer && result.request && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                    <div className="p-4 bg-slate-50 rounded-xl">
                      <div className="flex items-center gap-2 text-slate-500 text-sm mb-2">
                        <FileText className="w-4 h-4" />
                        <span>Documento</span>
                      </div>
                      <p className="font-semibold text-slate-800">{result.request.document_name}</p>
                    </div>

                    <div className="p-4 bg-slate-50 rounded-xl">
                      <div className="flex items-center gap-2 text-slate-500 text-sm mb-2">
                        <User className="w-4 h-4" />
                        <span>Signatário</span>
                      </div>
                      <p className="font-semibold text-slate-800">{result.signer.name}</p>
                      <p className="text-sm text-slate-500">{result.signer.email}</p>
                    </div>

                    <div className="p-4 bg-slate-50 rounded-xl">
                      <div className="flex items-center gap-2 text-slate-500 text-sm mb-2">
                        <Calendar className="w-4 h-4" />
                        <span>Data da Assinatura</span>
                      </div>
                      <p className="font-semibold text-slate-800">
                        {result.signer.signed_at ? formatDate(result.signer.signed_at) : 'Pendente'}
                      </p>
                    </div>

                    <div className="p-4 bg-slate-50 rounded-xl">
                      <div className="flex items-center gap-2 text-slate-500 text-sm mb-2">
                        <Hash className="w-4 h-4" />
                        <span>Código de Verificação</span>
                      </div>
                      <p className="font-mono text-sm text-slate-800 break-all">{hash}</p>
                    </div>
                  </div>
                )}

                {result.valid && (
                  <div className="mt-6 p-4 bg-emerald-50 rounded-xl border border-emerald-200">
                    <div className="flex items-start gap-3">
                      <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-emerald-800">Documento Autêntico</p>
                        <p className="text-sm text-emerald-700">
                          Este documento foi assinado digitalmente e sua integridade foi verificada. 
                          A assinatura é válida e não foi alterada desde a data de assinatura.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Botão para visualizar documento assinado */}
                {result.valid && result.signer?.signed_document_path && (
                  <div className="mt-6 flex flex-wrap gap-3">
                    <button
                      onClick={async () => {
                        try {
                          const url = await pdfSignatureService.getSignedPdfUrl(result.signer!.signed_document_path!);
                          if (url) window.open(url, '_blank');
                        } catch (e) {
                          console.error('Erro ao abrir documento:', e);
                        }
                      }}
                      className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition"
                    >
                      <Eye className="w-5 h-5" />
                      Visualizar Documento Assinado
                    </button>
                  </div>
                )}

                {!result.valid && (
                  <div className="mt-6 p-4 bg-amber-50 rounded-xl border border-amber-200">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-amber-800">Verifique o código</p>
                        <p className="text-sm text-amber-700">
                          Certifique-se de que o código de verificação foi digitado corretamente. 
                          O código está localizado no rodapé do documento assinado.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="mt-8 text-center text-sm text-slate-500">
          <p>A verificação de assinatura digital garante a autenticidade e integridade do documento.</p>
          <p className="mt-1">Em caso de dúvidas, entre em contato com o remetente do documento.</p>
        </div>
      </main>
    </div>
  );
};

export default PublicVerificationPage;
