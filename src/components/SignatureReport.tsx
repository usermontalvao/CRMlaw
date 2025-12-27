import React, { useEffect, useState } from 'react';
import { CheckCircle, Download, FileText, MapPin, Monitor, Scale, Shield, User } from 'lucide-react';
import QRCode from 'qrcode';
import type { Signer, SignatureRequest } from '../types/signature.types';
import { supabase } from '../config/supabase';

interface SignatureReportProps {
  signer: Signer;
  request: SignatureRequest;
  creator?: { name: string; email: string } | null;
  onClose?: () => void;
}

// Formatar data no padrão brasileiro com timezone
const formatDateTime = (dateStr: string): string => {
  const date = new Date(dateStr);
  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Manaus',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const formatDateTimeShort = (dateStr: string): string => {
  const date = new Date(dateStr);
  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Manaus',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

// Parsear User Agent
const parseUserAgent = (ua: string): { device: string; browser: string; os: string } => {
  let device = 'Desktop';
  let browser = 'Navegador';
  let os = 'Sistema';

  if (ua.includes('Mobile') || ua.includes('Android')) device = 'Mobile';
  if (ua.includes('Tablet') || ua.includes('iPad')) device = 'Tablet';

  if (ua.includes('Chrome')) browser = 'Chrome';
  else if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Safari')) browser = 'Safari';
  else if (ua.includes('Edge')) browser = 'Edge';
  else if (ua.includes('SamsungBrowser')) browser = 'Samsung Browser';

  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iOS') || ua.includes('iPhone')) os = 'iOS';

  return { device, browser, os };
};

// Formatar token para exibição (ocultar parte do meio se tiver hífen)
const formatToken = (token: string | null | undefined): string | null => {
  if (!token) return null;
  // Se não tiver hífen, não exibir
  if (!token.includes('-')) return null;
  // Exibir apenas início e fim
  return `${token.slice(0, 8)}****${token.slice(-4)}`;
};

const isInternalPlaceholderEmail = (email: string | null | undefined): boolean => {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return false;
  return e.startsWith('public+') && e.endsWith('@crm.local');
};

const SignatureReport: React.FC<SignatureReportProps> = ({ signer, request, creator, onClose }) => {
  const [signatureImageUrl, setSignatureImageUrl] = useState<string | null>(null);
  const [facialImageUrl, setFacialImageUrl] = useState<string | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const verificationUrl = signer.verification_hash 
    ? `${window.location.origin}/#/verificar/${signer.verification_hash}`
    : null;

  useEffect(() => {
    const loadData = async () => {
      try {
        // Função para tentar múltiplos buckets
        const tryGetSignedUrl = async (path: string): Promise<string | null> => {
          const buckets = ['document-templates', 'generated-documents', 'signatures'];
          for (const bucket of buckets) {
            try {
              const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
              if (!error && data?.signedUrl) return data.signedUrl;
            } catch { /* continuar */ }
          }
          return null;
        };
        
        // Carregar imagem da assinatura
        if (signer.signature_image_path) {
          const url = await tryGetSignedUrl(signer.signature_image_path);
          if (url) setSignatureImageUrl(url);
        }
        // Carregar foto facial
        if (signer.facial_image_path) {
          const url = await tryGetSignedUrl(signer.facial_image_path);
          if (url) setFacialImageUrl(url);
        }
        // Gerar QR Code
        if (verificationUrl) {
          const qrDataUrl = await QRCode.toDataURL(verificationUrl, {
            width: 150,
            margin: 1,
            color: { dark: '#000000', light: '#ffffff' }
          });
          setQrCodeDataUrl(qrDataUrl);
        }
      } catch (e) {
        console.error('Erro ao carregar dados:', e);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [signer, verificationUrl]);

  const uaInfo = signer.signer_user_agent ? parseUserAgent(signer.signer_user_agent) : null;
  
  const geoCoords = signer.signer_geolocation?.split(',').map(s => s.trim());
  const latitude = geoCoords?.[0] || null;
  const longitude = geoCoords?.[1] || null;

  const formattedToken = formatToken(signer.public_token);

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPDF = () => {
    // Abre janela de impressão que permite salvar como PDF
    window.print();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-orange-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      {/* Header com ações (não imprime) */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 print:hidden sticky top-0 z-10">
        <div className="flex items-center gap-3 min-w-0">
          <Scale className="w-6 h-6 text-orange-600" />
          <span className="font-bold text-lg text-gray-800 truncate">Relatório de Assinatura</span>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 w-full sm:w-auto">
          <button
            onClick={handleDownloadPDF}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition"
          >
            <Download className="w-4 h-4" />
            Baixar PDF
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="w-full sm:w-auto px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition"
            >
              Fechar
            </button>
          )}
        </div>
      </div>

      {/* Conteúdo do relatório */}
      <div className="max-w-4xl mx-auto p-4 sm:p-8 print:p-0 print:max-w-none">
        <div className="bg-white shadow-lg print:shadow-none rounded-lg print:rounded-none overflow-hidden">
          
          {/* Cabeçalho do relatório */}
          <div className="bg-gradient-to-r from-orange-600 to-amber-600 text-white p-4 sm:p-6 print:bg-orange-600">
            <div className="flex flex-col sm:flex-row items-start sm:items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-3 mb-2">
                  <Scale className="w-8 h-8" />
                  <span className="text-2xl font-bold">Jurius CRM</span>
                </div>
                <h1 className="text-xl font-semibold">Relatório de Assinaturas</h1>
                <p className="text-orange-100 text-sm mt-1">
                  Datas e horários em UTC-0400 (America/Manaus)
                </p>
              </div>
              <div className="text-left sm:text-right text-sm">
                <p className="text-orange-100">Última atualização em</p>
                <p className="font-semibold">{formatDateTime(new Date().toISOString())}</p>
              </div>
            </div>
          </div>

          {/* Informações do documento */}
          <div className="p-4 sm:p-6 border-b border-gray-200">
            <div className="flex flex-col sm:flex-row items-start gap-4">
              <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <FileText className="w-6 h-6 text-orange-700" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-bold text-gray-800 break-words">{request.document_name}</h2>
                <p className="text-sm text-gray-500 mt-1 font-mono">
                  Documento número {request.id}
                </p>
                {creator && (
                  <p className="text-sm text-gray-500 mt-1">
                    Criado por: <span className="font-medium">{creator.name}</span> ({creator.email})
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Seção de Assinaturas */}
          <div className="p-4 sm:p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center gap-2">
              <Shield className="w-5 h-5 text-orange-600" />
              Assinaturas
            </h3>

            {/* Card do signatário */}
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              {/* Header do signatário */}
              <div className="bg-gray-50 px-4 sm:px-6 py-4 border-b border-gray-200">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                      <User className="w-5 h-5 text-orange-700" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-gray-800 break-words">{signer.name}</h4>
                      {signer.role && <p className="text-sm text-gray-500">{signer.role}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-orange-100 text-orange-800 rounded-full text-sm font-medium self-start sm:self-auto">
                    <CheckCircle className="w-4 h-4" />
                    Assinou
                  </div>
                </div>
              </div>

              {/* Detalhes da assinatura */}
              <div className="p-4 sm:p-6 space-y-6">
                {/* Métodos de Autenticação */}
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <h5 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-orange-600" />
                    Métodos de Autenticação Utilizados
                  </h5>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Assinatura Manual */}
                    {signer.signature_image_path && (
                      <div className="flex items-start gap-3 p-3 bg-white rounded-lg border border-orange-200">
                        <CheckCircle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium text-gray-800 text-sm">Assinatura Manual</p>
                          <p className="text-xs text-gray-500">Assinatura digital desenhada na tela</p>
                        </div>
                      </div>
                    )}

                    {/* Selfie / Verificação Facial */}
                    {signer.facial_image_path && (
                      <div className="flex items-start gap-3 p-3 bg-white rounded-lg border border-orange-200">
                        <CheckCircle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium text-gray-800 text-sm">Selfie</p>
                          <p className="text-xs text-gray-500">Foto do rosto capturada para verificação</p>
                        </div>
                      </div>
                    )}

                    {/* Email autenticado (quando existir) */}
                    {signer.auth_email && (
                      <div className="flex items-start gap-3 p-3 bg-white rounded-lg border border-orange-200">
                        <CheckCircle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium text-gray-800 text-sm">E-mail</p>
                          <p className="text-xs text-gray-500">Autenticado: <span className="font-mono">{signer.auth_email}</span></p>
                        </div>
                      </div>
                    )}

                    {/* Telefone */}
                    {signer.auth_provider === 'phone' && signer.phone && (
                      <div className="flex items-start gap-3 p-3 bg-white rounded-lg border border-orange-200">
                        <CheckCircle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium text-gray-800 text-sm">Telefone</p>
                          <p className="text-xs text-gray-500">Autenticado: <span className="font-mono">{signer.phone}</span></p>
                        </div>
                      </div>
                    )}

                    {/* Geolocalização */}
                    {signer.signer_geolocation && (
                      <div className="flex items-start gap-3 p-3 bg-white rounded-lg border border-amber-200">
                        <CheckCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium text-gray-800 text-sm">Geolocalização</p>
                          <p className="text-xs text-gray-500">Coordenadas capturadas automaticamente</p>
                        </div>
                      </div>
                    )}

                    {/* IP */}
                    {signer.signer_ip && (
                      <div className="flex items-start gap-3 p-3 bg-white rounded-lg border border-slate-200">
                        <CheckCircle className="w-5 h-5 text-slate-500 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium text-gray-800 text-sm">Endereço IP</p>
                          <p className="text-xs text-gray-500">Registrado: <span className="font-mono">{signer.signer_ip}</span></p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Grid de informações */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* IP e Geolocalização */}
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-gray-700 mb-2">
                      <MapPin className="w-4 h-4" />
                      <span className="font-medium text-sm">Localização</span>
                    </div>
                    <div className="space-y-1 text-sm">
                      {signer.signer_ip && (
                        <p><span className="text-gray-500">IP:</span> <span className="font-mono">{signer.signer_ip}</span></p>
                      )}
                      {latitude && longitude && (
                        <p><span className="text-gray-500">Coordenadas:</span> <span className="font-mono">{latitude}, {longitude}</span></p>
                      )}
                    </div>
                  </div>

                  {/* Dispositivo */}
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-gray-700 mb-2">
                      <Monitor className="w-4 h-4" />
                      <span className="font-medium text-sm">Dispositivo</span>
                    </div>
                    {uaInfo && (
                      <div className="space-y-1 text-sm">
                        <p><span className="text-gray-500">Tipo:</span> {uaInfo.device}</p>
                        <p><span className="text-gray-500">Navegador:</span> {uaInfo.browser}</p>
                        <p><span className="text-gray-500">Sistema:</span> {uaInfo.os}</p>
                      </div>
                    )}
                    {signer.signer_user_agent && (
                      <p className="text-xs text-gray-400 mt-2 break-all">{signer.signer_user_agent}</p>
                    )}
                  </div>
                </div>

                {/* Data e hora */}
                <div className="bg-orange-50 rounded-lg p-4">
                  <p className="text-sm">
                    <span className="text-gray-600">Data e hora:</span>{' '}
                    <span className="font-semibold text-gray-800">
                      {signer.signed_at ? formatDateTime(signer.signed_at) : 'N/A'}
                    </span>
                  </p>
                </div>

                {/* Contatos */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">Contato do signatário:</span>{' '}
                    <span className="text-gray-800">
                      {(() => {
                        const authEmail = String(signer.auth_email || '').trim();
                        const phone = String(signer.phone || '').trim();
                        const rawEmail = String(signer.email || '').trim();
                        const displayContact =
                          authEmail ||
                          (signer.auth_provider === 'phone' ? phone : '') ||
                          (!isInternalPlaceholderEmail(rawEmail) ? rawEmail : '');
                        return displayContact || '—';
                      })()}
                    </span>
                  </div>
                  {signer.auth_email && signer.auth_email !== signer.email && (
                    <div>
                      <span className="text-gray-500">E-mail autenticado:</span>{' '}
                      <span className="text-gray-800">{signer.auth_email}</span>
                    </div>
                  )}
                  {signer.auth_provider === 'phone' && signer.phone && (
                    <div>
                      <span className="text-gray-500">Telefone:</span>{' '}
                      <span className="text-gray-800">{signer.phone}</span>
                    </div>
                  )}
                  {signer.cpf && (
                    <div>
                      <span className="text-gray-500">CPF:</span>{' '}
                      <span className="text-gray-800">{signer.cpf}</span>
                    </div>
                  )}
                  {formattedToken && (
                    <div>
                      <span className="text-gray-500">Token:</span>{' '}
                      <span className="font-mono text-gray-800 break-all">{formattedToken}</span>
                    </div>
                  )}
                </div>

                {/* Imagem da assinatura */}
                {signatureImageUrl && (
                  <div className="border border-gray-200 rounded-lg p-4">
                    <p className="text-sm font-medium text-gray-700 mb-3">Assinatura de {signer.name}</p>
                    <div className="bg-white border border-gray-100 rounded-lg p-4 inline-block max-w-full">
                      <img 
                        src={signatureImageUrl} 
                        alt="Assinatura" 
                        className="max-h-24 max-w-full object-contain"
                      />
                    </div>
                  </div>
                )}

                {/* Foto facial com marca d'água */}
                {facialImageUrl && (
                  <div className="border border-gray-200 rounded-lg p-4">
                    <p className="text-sm font-medium text-gray-700 mb-3">Foto do rosto (selfie) de {signer.name}:</p>
                    <div className="relative inline-block">
                      <img 
                        src={facialImageUrl} 
                        alt="Foto facial" 
                        className="w-40 h-40 sm:w-48 sm:h-48 object-cover rounded-lg"
                        style={{ transform: 'scaleX(-1)' }}
                      />
                      {/* Marca d'água CONFIDENTIAL */}
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30 rounded-lg">
                        <div className="text-white text-center font-mono text-xs leading-relaxed">
                          <p>— — — — — — — — — — — —</p>
                          <p className="font-bold text-sm tracking-widest my-1">C O N F I D E N T I A L</p>
                          <p>{signer.signed_at ? formatDateTimeShort(signer.signed_at) : ''}</p>
                          <p>— — — — — — — — — — — —</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* Rodapé com verificação */}
          <div className="bg-gray-50 p-4 sm:p-6 border-t border-gray-200">
            <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
              {/* QR Code */}
              {qrCodeDataUrl && (
                <div className="flex-shrink-0">
                  <img 
                    src={qrCodeDataUrl} 
                    alt="QR Code de verificação"
                    className="w-28 h-28 sm:w-32 sm:h-32 bg-white p-2 rounded-lg border border-gray-200"
                  />
                </div>
              )}

              {/* Informações de verificação */}
              <div className="flex-1 space-y-3 text-sm">
                <p className="text-gray-600">
                  <span className="font-semibold text-gray-800">Jurius CRM</span> {request.id}.{' '}
                  Documento assinado eletronicamente, conforme MP 2.200-2/2001 e Lei 14.063/2020.
                </p>

                {verificationUrl && (
                  <div>
                    <p className="text-gray-500 text-xs mb-1">Código de Verificação:</p>
                    <p className="font-mono text-xs sm:text-sm font-bold text-gray-800 break-all">{signer.verification_hash}</p>
                    <a 
                      href={verificationUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-orange-700 hover:underline text-xs break-all mt-1 block"
                    >
                      {verificationUrl}
                    </a>
                  </div>
                )}

                <p className="text-xs text-gray-400 pt-2 border-t border-gray-200">
                  Este Log é exclusivo e parte integrante do documento de identificação {request.id},
                  conforme os Termos de Uso do Jurius CRM.
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Estilos de impressão */}
      <style>{`
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print\\:hidden { display: none !important; }
          .print\\:bg-white { background-color: white !important; }
          .print\\:shadow-none { box-shadow: none !important; }
          .print\\:rounded-none { border-radius: 0 !important; }
          .print\\:p-0 { padding: 0 !important; }
          .print\\:max-w-none { max-width: none !important; }
          .print\\:bg-orange-600 { background-color: #ea580c !important; }
        }
      `}</style>
    </div>
  );
};

export default SignatureReport;
