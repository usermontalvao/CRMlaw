import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrandLogo } from './ui';
import { BRAND_SERIF, BRAND_WORDMARK, BRAND_DOT, BRAND_DOT_ON_DARK } from '../constants/brand';
import { createPortal } from 'react-dom';
import { AlertCircle, Camera, Check, CheckCircle, ChevronLeft, ChevronRight, Clock, Copy, Download, ExternalLink, FileText, Loader2, MapPin, PenTool, RotateCcw, User, X, Shield, AlertTriangle, Mail } from 'lucide-react';
import { signatureService } from '../services/signature.service';
import { pdfSignatureService } from '@/services/pdfSignature.service';
import { buildPublicSignatureTermsUrl } from '../utils/publicAppUrl';
import { buildWhatsappUrl } from '../utils/whatsapp';
import { SIGNATURE_TERMS_VERSION, SIGNATURE_TERMS_TITLE, SIGNATURE_TERMS_TEXT, parseSignatureTermsText } from '../constants/signatureTerms';
import { googleAuthService, type GoogleUser } from '../services/googleAuth.service';
import { useToastContext } from '../contexts/ToastContext';
import { useDeteccaoDeRosto } from '../hooks/useDeteccaoDeRosto';
import { cpfValido } from '../utils/cpf';
import { deveRegistrarVisualizacao } from '../utils/registroDeVisualizacao';
import type { SignDocumentDTO, SignatureAuditLog, SignatureField, SignatureRequestDocument, Signer, SignatureRequest } from '../types/signature.types';
import SignatureReport from './SignatureReport';
import { renderAsync } from 'docx-preview';
import { Document, Page, pdfjs } from 'react-pdf';
import { supabase } from '../config/supabase';
import { montarNoServidor, retratoDoInterruptor } from '../config/montagemNoServidor';
import { cronometroDaAssinatura } from '../utils/cronometroDeFases';
import TelaDeAbertura from './publicSigning/TelaDeAbertura';
import TelaDeConferencia from './publicSigning/TelaDeConferencia';
import TelaDeComprovante from './publicSigning/TelaDeComprovante';
import EtapaDeIdentidade from './publicSigning/EtapaDeIdentidade';
import { Guia, type PassoDoGuia } from './publicSigning/Guia';
import {
  AcaoPrimaria,
  AcaoSecundaria,
  DemoDoDedo,
  EtiquetaDoDocumento,
  Explicacao,
  Fio,
  Roda,
  MolduraPublica,
  RodapeDeConfianca,
  Rotulo,
  Tarja,
  TINTA,
  TINTA_2,
  TINTA_3,
  sobe,
} from './publicSigning/ui';
import { canalDoRegistro, primeiroNome, type CanalDeIdentidade } from '../utils/assinaturaPublica';
import { canOpenPublicSigningModal, isPublicSigningReaderReady } from '../utils/publicSigningReadiness';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PublicSigningPageProps {
  token: string;
}

type SigningStep = 'loading' | 'success' | 'error' | 'already_signed';
type ModalStep = 'google_auth' | 'phone_otp' | 'email_otp' | 'data' | 'signature' | 'location' | 'facial' | 'confirm';

type PublicAuthConfig = { google: boolean; email: boolean; phone: boolean; whatsapp: boolean };

interface SignerData {
  name: string;
  cpf: string;
  phone: string;
}

interface FacialAIValidationResult {
  valid: boolean;
  score: number;
  issues: string[];
  message: string;
}

const formatCpf = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  const part1 = digits.slice(0, 3);
  const part2 = digits.slice(3, 6);
  const part3 = digits.slice(6, 9);
  const part4 = digits.slice(9, 11);

  let formatted = part1;
  if (part2) formatted += `.${part2}`;
  if (part3) formatted += `.${part3}`;
  if (part4) formatted += `-${part4}`;
  return formatted;
};

// ── Rascunho do fluxo público de assinatura ──────────────────────────────────
// Persiste o progresso no localStorage por até 24h (sobrevive a refresh/fechar a
// aba) e é apagado assim que o documento é assinado. Por segurança/LGPD NÃO
// guarda a identidade verificada (OTP/Google) — refeita a cada sessão — nem a
// selfie (biometria). O OTP obrigatório é o cadeado que protege os demais dados.
const SIGNING_DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

interface SigningDraft {
  signerData: SignerData;
  signatureData: string | null;
  locationData: { lat: number; lng: number } | null;
}

const readSigningDraft = (key: string): SigningDraft | null => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.expiresAt !== 'number' || parsed.expiresAt < Date.now()) {
      window.localStorage.removeItem(key); // expirado → descarta
      return null;
    }
    const sd = parsed.signerData ?? {};
    const loc = parsed.locationData;
    return {
      signerData: {
        name: typeof sd.name === 'string' ? sd.name : '',
        cpf: typeof sd.cpf === 'string' ? sd.cpf : '',
        phone: typeof sd.phone === 'string' ? sd.phone : '',
      },
      signatureData: typeof parsed.signatureData === 'string' ? parsed.signatureData : null,
      locationData:
        loc && typeof loc.lat === 'number' && typeof loc.lng === 'number'
          ? { lat: loc.lat, lng: loc.lng }
          : null,
    };
  } catch {
    return null;
  }
};

const writeSigningDraft = (key: string, draft: SigningDraft): void => {
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({ ...draft, expiresAt: Date.now() + SIGNING_DRAFT_TTL_MS }),
    );
  } catch { /* storage indisponível — ignora */ }
};

const clearSigningDraft = (key: string): void => {
  try { window.localStorage.removeItem(key); } catch { /* ignora */ }
};

// Número lógico da etapa (1–6) para o indicador do cabeçalho do modal.
const signStepNumber = (s: ModalStep): number =>
  (s === 'google_auth' || s === 'phone_otp' || s === 'email_otp') ? 1
  : s === 'data' ? 2
  : s === 'signature' ? 3
  : s === 'location' ? 4
  : s === 'facial' ? 5
  : 6;

// Rótulos das seis etapas do fluxo, na ordem em que aparecem.
const SIGN_STEPS: { label: string }[] = [
  { label: 'Identidade' },
  { label: 'Dados' },
  { label: 'Assinatura' },
  { label: 'Localização' },
  { label: 'Foto' },
  { label: 'Confirmar' },
];

/* ═══════════════════════════════════════════════════════════════════════
   Vocabulário visual da tela pública.

   Tudo aqui é extraído do bloco de comprovante (procure por "PAINEL DE MARCA"
   mais abaixo): canto reto, régua laranja de 32×2, rótulo em caixa-alta com
   tracking largo e título em Spectral com a palavra-chave em itálico. O
   comprovante era a única tela nessa língua; estes componentes levam a mesma
   língua para as outras oito, no lugar dos cards arredondados de SaaS.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Máscaras de destino ──────────────────────────────────────────────────
   Na etapa de identidade cada opção mostra PARA ONDE o código vai. Sem isso a
   pessoa escolhe às cegas e só descobre o número errado depois de gastar um
   envio. Mostramos o suficiente para reconhecer, nunca o dado inteiro. */

/** "65984046375" → "··· 9 8404-6375". Devolve null se não der para reconhecer. */
const mascararTelefone = (bruto?: string | null): string | null => {
  const d = (bruto ?? '').replace(/\D/g, '');
  if (d.length < 8) return null;
  const ultimos = d.slice(-8);
  return `··· ${ultimos.slice(0, 1)} ${ultimos.slice(1, 5)}-${ultimos.slice(5)}`;
};

/** "maria.silva@gmail.com" → "m···a@gmail.com". */
const mascararEmail = (bruto?: string | null): string | null => {
  const e = (bruto ?? '').trim();
  const at = e.indexOf('@');
  if (at < 1 || at === e.length - 1) return null;
  const local = e.slice(0, at);
  const dominio = e.slice(at);
  if (local.length <= 2) return `${local[0]}···${dominio}`;
  return `${local[0]}···${local[local.length - 1]}${dominio}`;
};

/** Proporção da selfie: retrato 3:4, o formato de foto de celular. Vale para o
 *  visor, para o recorte da captura e para a prévia — os três precisam contar a
 *  mesma história, senão a pessoa enquadra uma coisa e o certificado guarda outra. */
const FOTO_PROPORCAO = 3 / 4;

/**
 * Carimba a evidência dentro dos PIXELS da foto.
 *
 * Três linhas, sempre, sem opção de desligar: data e hora da captura (relógio
 * do escritório, America/Cuiaba), a FINALIDADE do uso e o PROTOCOLO do
 * envelope. Uma foto de rosto sem contexto não prova nada — não diz quando foi
 * tirada nem para quê, e permite alegar que veio de outro lugar. Com o
 * protocolo gravado, a imagem aponta para o documento que ela prova, e
 * continua apontando mesmo que circule sozinha.
 *
 * Vai desenhado, e não em EXIF, porque metadado não sobrevive a recorte,
 * reexportação nem impressão — exatamente as coisas que acontecem com uma
 * evidência no caminho até os autos.
 */
function desenharCarimboDaEvidencia(
  ctx: CanvasRenderingContext2D,
  largura: number,
  altura: number,
  dados: { quando: Date; finalidade: string; protocolo: string },
): void {
  const linhas = [
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Cuiaba',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(dados.quando) + ' (America/Cuiaba)',
    dados.finalidade,
    dados.protocolo ? `Protocolo ${dados.protocolo}` : '',
  ].filter(Boolean);

  // Escala com a foto: o mesmo carimbo precisa ser legível numa selfie de
  // 480px de webcam e numa de 1440px de celular.
  const corpo = Math.max(11, Math.round(largura * 0.028));
  const espaco = Math.round(corpo * 1.34);
  const margem = Math.round(corpo * 0.9);
  const alturaFaixa = espaco * linhas.length + margem * 1.1;

  ctx.save();
  // Faixa escura translúcida: mantém o rosto visível e o texto legível sobre
  // qualquer fundo (parede clara, contraluz, camisa branca).
  ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
  ctx.fillRect(0, altura - alturaFaixa, largura, alturaFaixa);

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  let y = altura - alturaFaixa + margem * 0.75 + espaco / 2;
  linhas.forEach((linha, i) => {
    ctx.font = `${i === 0 ? '700 ' : ''}${corpo}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    ctx.fillStyle = i === 0 ? '#ffffff' : 'rgba(255,255,255,0.92)';
    // Contorno preto fino: garante contraste mesmo se a faixa for removida
    // por reprocessamento agressivo da imagem.
    ctx.lineWidth = Math.max(2, corpo * 0.16);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeText(linha, margem, y);
    ctx.fillText(linha, margem, y);
    y += espaco;
  });
  ctx.restore();
}

/** De onde sai o IP público do visitante. Sem ele o evento fica sem origem. */
const URL_IP_PUBLICO = 'https://api.ipify.org?format=json';

/**
 * Registra uma visualização do documento.
 *
 * Existia em DOIS lugares, e o primeiro deles chamava sem IP. Como ambos
 * gravavam a mesma chave de sessão, quem chegasse antes vencia — e era o sem
 * IP, e por isso as visualizações do histórico apareciam sem origem. Agora é
 * um caminho só, e ele sempre tenta o IP.
 */
const registrarVisualizacao = async (token: string, signerId: string): Promise<void> => {
  const chave = `public_signing_viewed_${signerId}`;

  try {
    const ultima = Number(window.sessionStorage.getItem(chave) || 0);
    if (!deveRegistrarVisualizacao(ultima, Date.now())) return;
    window.sessionStorage.setItem(chave, String(Date.now()));
  } catch {
    // Navegador sem sessionStorage (janela privada restrita): sem a trava
    // local o servidor ainda agrupa pela janela dele. Segue em frente.
  }

  // O IP é bom ter, não é motivo para perder o evento: se o serviço demorar
  // ou estiver bloqueado, a visualização é registrada mesmo assim.
  let ip: string | undefined;
  try {
    const controlador = new AbortController();
    const prazo = window.setTimeout(() => controlador.abort(), 2500);
    const resposta = await fetch(URL_IP_PUBLICO, { signal: controlador.signal });
    window.clearTimeout(prazo);
    const dados = await resposta.json();
    ip = typeof dados?.ip === 'string' ? dados.ip : undefined;
  } catch {
    // segue sem IP
  }

  await signatureService.markSignerAsViewed(token, ip, navigator.userAgent);
};

/** Palavra-chave em itálico laranja dentro de um título em Spectral. */
/** A palavra que carrega o peso do título — laranja, sem trocar de família. */
const Accent: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{ color: '#ea580c' }}>{children}</span>
);

/**
 * Abertura de etapa.
 *
 * Era rótulo + régua laranja + título em SERIFA ITÁLICA + subtítulo: quatro
 * elementos e duas famílias tipográficas antes de a etapa dizer o que fazer.
 * Somando a régua de seis segmentos e o cabeçalho escuro logo acima, a tela
 * gastava um terço da altura do celular antes do primeiro botão.
 *
 * Agora é o mesmo gesto da abertura e do comprovante: uma frase grande em
 * sans, apertada, e uma linha de apoio. O rótulo da etapa saiu daqui porque a
 * régua acima já diz "Etapa 3 de 6 · Assinatura" — dizer duas vezes era metade
 * da poluição.
 */
const StepHeading: React.FC<{
  title: React.ReactNode;
  note?: React.ReactNode;
}> = ({ title, note }) => (
  <div className="min-w-0" style={sobe(0, 0.45)}>
    <h2 style={{
      margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: '-0.85px',
      lineHeight: 1.08, color: TINTA,
    }}>
      {title}
    </h2>
    {note && (
      <p style={{ margin: '9px 0 0', fontSize: 13, lineHeight: 1.55, color: TINTA_2, maxWidth: 320 }}>
        {note}
      </p>
    )}
  </div>
);

/** O único botão cheio da tela. Gradiente do comprovante, canto reto. */
const PrimaryButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({
  children, disabled, className = '', ...rest
}) => (
  <button
    {...rest}
    disabled={disabled}
    className={`w-full flex items-center justify-center gap-2.5 px-5 py-3.5 text-[14px] font-bold text-white transition-transform ${disabled ? 'cursor-not-allowed' : 'active:scale-[0.99]'} ${className}`}
    style={{ background: disabled ? '#D8D2C9' : 'linear-gradient(135deg, #FB8C3E 0%, #EA5310 100%)' }}
  >
    {children}
  </button>
);

/** Ação secundária: só contorno, nunca concorre com o botão cheio. */
const GhostButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({
  children, className = '', ...rest
}) => (
  <button
    {...rest}
    className={`w-full flex items-center justify-center gap-2 border border-[#DDD6CC] bg-transparent px-5 py-3 text-[12.5px] font-semibold text-[#6C7787] transition-colors hover:bg-white disabled:opacity-50 ${className}`}
  >
    {children}
  </button>
);

/** Rótulo de campo, na mesma família dos rótulos do comprovante. */
const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label className="mb-1.5 block text-[9px] font-bold uppercase tracking-[0.16em] text-[#A0968C]">
    {children}
  </label>
);

/** Campo de texto: canto reto, foco no laranja da marca. */
const INPUT_CLS =
  'w-full h-[46px] bg-white border px-3.5 text-[15px] font-medium text-[#141B26] transition-colors focus:outline-none';
const INPUT_OK = 'border-[#E0DAD1] focus:border-[#EA5310] focus:ring-[3px] focus:ring-[#EA5310]/15';
const INPUT_BAD = 'border-[#D98A8A] focus:border-[#C0392B] focus:ring-[3px] focus:ring-[#C0392B]/15';

/** Picote de recibo — o mesmo divisor que separa os painéis do comprovante. */
const Perforation: React.FC<{ label?: string; className?: string }> = ({ label, className = '' }) => (
  <div className={`flex items-center gap-3 ${className}`}>
    <div
      className="h-px flex-1"
      style={{ background: 'repeating-linear-gradient(to right, rgba(15,23,42,0.2) 0 5px, transparent 5px 10px)' }}
    />
    {label && (
      <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-[#A0968C]">{label}</span>
    )}
    {label && (
      <div
        className="h-px flex-1"
        style={{ background: 'repeating-linear-gradient(to right, rgba(15,23,42,0.2) 0 5px, transparent 5px 10px)' }}
      />
    )}
  </div>
);

/** Régua de progresso segmentada. Substitui os seis círculos com ícone, que
 *  comiam 70px de altura logo na primeira dobra do celular. */
/**
 * A régua das seis etapas.
 *
 * Eram seis segmentos separados por vãos de 3 px, em três cores, com o rótulo
 * por cima — seis peças para dizer uma coisa só. Virou o MESMO fio de 2,5 px da
 * abertura, da conferência e do comprovante: uma barra que avança, e o avanço é
 * a informação. Sem brilho, porque aqui não há nada acontecendo — a régua está
 * parada esperando a pessoa.
 */
const SignStepper: React.FC<{ current: number }> = ({ current }) => (
  <div className="flex-shrink-0">
    <Fio tom="trabalhando" progresso={(current / SIGN_STEPS.length) * 100} brilho={false} />
    <div className="bg-[#f8fafc] px-4 pb-1 pt-2.5 min-[390px]:px-5">
      <span style={{
        fontSize: 9, fontWeight: 800, letterSpacing: '.2em', textTransform: 'uppercase',
        color: TINTA_3,
      }}>
        Etapa <span style={{ color: '#ea580c' }}>{current}</span> de {SIGN_STEPS.length}
        {SIGN_STEPS[current - 1] ? ` · ${SIGN_STEPS[current - 1].label}` : ''}
      </span>
    </div>
  </div>
);

// Caixa de seleção laranja (etapa de confirmação). O visual é controlado pelo
// estado React — não depende do pseudo `:checked`, garantindo o fundo laranja +
// check branco ao marcar (e branco/cinza quando desmarcado).
const OrangeCheckbox: React.FC<{ checked: boolean }> = ({ checked }) => (
  <span
    aria-hidden="true"
    className="flex items-center justify-center flex-shrink-0 rounded-md border-2 transition-colors"
    style={{
      width: 20,
      height: 20,
      backgroundColor: checked ? '#f97316' : '#ffffff',
      borderColor: checked ? '#f97316' : '#d1d5db',
    }}
  >
    {checked && <Check className="w-3 h-3 text-white" strokeWidth={3.5} />}
  </span>
);

// Componente que renderiza todas as páginas de um PDF como canvas (sem iframe, sem scroll duplo)
interface PdfRendererProps {
  url: string;
  onLoad?: () => void;
}
const PdfRenderer: React.FC<PdfRendererProps> = ({ url, onLoad }) => {
  const [numPages, setNumPages] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      setContainerWidth(Math.floor(entries[0].contentRect.width));
    });
    ro.observe(containerRef.current);
    setContainerWidth(Math.floor(containerRef.current.offsetWidth));
    return () => ro.disconnect();
  }, []);

  /*
    A LARGURA DA PÁGINA.

    Era `width={containerWidth}`: no celular isso é o certo (a folha ocupa a
    tela inteira), mas num monitor de 1.440 px a página do PDF era esticada de
    ponta a ponta, sem margem nenhuma — uma linha de texto atravessando meio
    metro. A partir do tablet a folha vira uma COLUNA de leitura centrada, com
    o cinza da página em volta, igual à folha do Word.
  */
  const larguraDaPagina = containerWidth >= 900
    ? Math.min(containerWidth - 48, 1040)
    : containerWidth;

  return (
    <div ref={containerRef} className="w-full bg-[#f8f7f5] lg:py-7">
      <Document
        file={url}
        onLoadSuccess={({ numPages: n }) => { setNumPages(n); onLoad?.(); }}
        loading={null}
        error={null}
      >
        {containerWidth > 0 && Array.from({ length: numPages }, (_, i) => (
          <div
            key={i}
            className="mx-auto w-fit lg:mb-6 lg:overflow-hidden lg:rounded-[3px] lg:shadow-[0_1px_2px_rgb(15_23_42_/_0.06),0_12px_28px_-10px_rgb(15_23_42_/_0.18)]"
          >
            <Page
              pageNumber={i + 1}
              width={larguraDaPagina}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              className="block"
            />
          </div>
        ))}
      </Document>
    </div>
  );
};

// Componente auxiliar para renderizar a lista de documentos anexos
interface AttachmentsListProps {
  attachments: { name: string; url: string; rendered?: boolean; prefetched?: boolean; isDocx?: boolean }[];
  attachmentRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
}

const AttachmentsList: React.FC<AttachmentsListProps> = ({ attachments, attachmentRefs }) => {
  if (attachments.length === 0) return null;
  return (
    <div>
      {attachments.map((attach, idx) => {
        const nameLower = attach.name.toLowerCase().split('?')[0];
        const isPdf = nameLower.endsWith('.pdf');
        const isImg = nameLower.endsWith('.jpg') || nameLower.endsWith('.jpeg') || nameLower.endsWith('.png') || nameLower.endsWith('.gif') || nameLower.endsWith('.webp') || nameLower.endsWith('.bmp');
        return (
          <div key={`attach-${idx}`}>
            {attach.isDocx ? (
              // DOCX: div preenchida pelo renderAsync
              // `overflow: auto` aqui criava um SEGUNDO scroller dentro do
              // scroller do documento — o dedo agarrava a caixa do anexo em vez
              // da página, e a leitura "travava". A rolagem lateral (folha larga
              // no desktop) vive agora no CSS, só no eixo X.
              <div
                ref={el => { attachmentRefs.current[idx] = el; }}
                className="bg-[#f8f7f5] docx-responsive docx-anexo"
                style={{ width: '100%' }}
              />
            ) : isPdf ? (
              // PDF: canvas via react-pdf, sem iframe, sem scroll interno
              <PdfRenderer url={attach.url} />
            ) : isImg ? (
              // Imagem: tag <img> sem decoração
              <img
                src={attach.url}
                alt={attach.name}
                className="w-full h-auto block"
                style={{ maxWidth: '100%' }}
              />
            ) : (
              // Outro tipo: link para download
              <div className="p-4 text-center">
                <a
                  href={attach.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800"
                >
                  <Download className="w-4 h-4" />
                  Baixar {attach.name}
                </a>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

const PublicSigningPage: React.FC<PublicSigningPageProps> = ({ token }) => {
  const toast = useToastContext();

  // Roteia as leituras de storage da geração do PDF assinado pela edge
  // token-scoped (`public-signing-file`), em vez do acesso anon direto aos
  // buckets. É isso que permite fechar o acesso anon a `document-templates` /
  // `assinados` (migration 3) sem quebrar a assinatura pública.
  useEffect(() => {
    pdfSignatureService.setPublicFileResolver((path) => signatureService.getPublicFileUrl(token, path));
    // Dados do relatório (co-signatários + trilha de auditoria) via RPC
    // token-scoped, evitando os 401 das leituras anon diretas nas tabelas.
    pdfSignatureService.setPublicReportDataProvider({
      signers: () => signatureService.getPublicReportSigners(token),
      auditLog: () => signatureService.getPublicReportAuditLog(token) as any,
    });
    // Gravação do PDF assinado/relatório via edge token-scoped (sem INSERT anon).
    pdfSignatureService.setPublicUploadResolver(({ path, bytes, contentType }) =>
      signatureService.uploadSignedFilePublic(token, path, bytes, contentType));
    return () => {
      pdfSignatureService.setPublicFileResolver(null);
      pdfSignatureService.setPublicReportDataProvider(null);
      pdfSignatureService.setPublicUploadResolver(null);
    };
  }, [token]);

  const isSignerDataComplete = (data: SignerData) => data.name.trim().length >= 3 && data.cpf.replace(/\D/g, '').length === 11;

  const isTemplateFillSigner = (email?: string | null) => {
    const e = (email || '').trim().toLowerCase();
    return e.startsWith('public+') && e.endsWith('@crm.local');
  };

  const [allowSkipSignerDataStep, setAllowSkipSignerDataStep] = useState(false);

  useEffect(() => {
    const styleId = 'public-signing-docx-responsive-styles';
    document.getElementById(styleId)?.remove();
    // Remove a regra antiga que redimensionava o article para o viewport e,
    // em seguida, aplicava outra escala sobre a folha.
    document.getElementById('docx-page-break-styles-public')?.remove();
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .docx-responsive .docx-wrapper-wrapper {
        background: transparent !important;
        width: 100% !important;
        padding: 20px !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        box-sizing: border-box !important;
      }

      /* Com className="docx-wrapper", o docx-preview cria a folha como
         <section class="docx-wrapper">. No desktop, preservamos as dimensões
         e margens que a biblioteca extraiu do Word. */
      .docx-responsive section.docx-wrapper {
        flex: none !important;
        box-sizing: border-box !important;
        background: white !important;
        box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1) !important;
        margin: 0 0 20px !important;
        transform-origin: top center !important;
      }

      /*
        A FOLHA NO MONITOR.

        O docx-preview entrega a folha no tamanho que o Word gravou: A4 tem
        794 px. Num monitor de 1.440 px isso é metade da tela de papel e a
        outra metade de cinza — a letra fica do tamanho de uma miniatura e
        obriga a aproximar o rosto. Aqui a folha cresce junto com a janela,
        com zoom (e nao transform) porque a altura precisa crescer tambem: com
        scale, uma pagina passaria por cima da seguinte.
      */
      @media (min-width: 1024px) {
        /* Rede de seguranca: uma folha DEITADA (A4 paisagem) ja nasce com 1123
           px e, ampliada, passa da janela. Sem isto ela seria simplesmente
           cortada, porque o leitor inteiro roda dentro de um overflow-hidden.
           O eixo Y vai travado junto de proposito: sozinho, o overflow-x tambem
           promoveria o Y a auto e criaria um segundo scroller. */
        .docx-responsive {
          overflow-x: auto;
          overflow-y: hidden;
        }
        .docx-responsive .docx-wrapper-wrapper {
          padding: 28px 24px 36px !important;
        }
        .docx-responsive section.docx-wrapper {
          zoom: 1.16;
          margin-bottom: 26px !important;
          box-shadow: 0 1px 2px rgb(15 23 42 / 0.06), 0 12px 28px -10px rgb(15 23 42 / 0.18) !important;
        }
      }

      @media (min-width: 1400px) {
        .docx-responsive section.docx-wrapper {
          zoom: 1.3;
        }
      }

      /* Scrollbar */
      .docx-responsive::-webkit-scrollbar {
        height: 8px;
      }
      .docx-responsive::-webkit-scrollbar-track {
        background: #f1f5f9;
      }
      .docx-responsive::-webkit-scrollbar-thumb {
        background: #cbd5e1;
        border-radius: 4px;
      }

      /* Rolagem lateral da folha larga: SO no eixo X, e com o Y explicitamente
         travado. Um "overflow-x: auto" sozinho promoveria o eixo Y de "visible"
         para "auto" (regra do CSS), e o container viraria um scroller aninhado.
         Com altura automatica, "overflow-y: hidden" nao corta nada: o box
         cresce com o conteudo. */
      .docx-responsive.docx-anexo {
        overflow-x: auto;
        overflow-y: hidden;
      }

      @media (max-width: 820px) {
        /* No celular NAO existe rolagem lateral: a folha reflui. E aqui esta a
           armadilha que fazia o documento travar: "overflow-x: hidden" sozinho
           TAMBEM promove o eixo Y a "auto", criando o segundo scroller mesmo
           sem ninguem pedir. Travar os DOIS eixos e o que devolve o toque ao
           scroller de verdade, o main. */
        .docx-responsive,
        .docx-responsive.docx-anexo {
          overflow: hidden !important;
          padding: 0 !important;
        }

        .docx-responsive .docx-wrapper-wrapper {
          padding: 12px !important;
          align-items: flex-start !important;
        }

        /* Modo de leitura: a folha deixa de ser uma miniatura A4 e passa a
           refluir na largura disponível. A tipografia continua no tamanho
           original do Word, portanto permanece legível no celular. */
        .docx-responsive section.docx-wrapper {
          width: 100% !important;
          min-width: 0 !important;
          max-width: 100% !important;
          height: auto !important;
          min-height: 0 !important;
          padding: clamp(20px, 5vw, 32px) !important;
          overflow: visible !important;
          zoom: 1 !important;
          transform: none !important;
          transform-origin: initial !important;
        }

        .docx-responsive section.docx-wrapper > article {
          width: 100% !important;
          min-width: 0 !important;
          max-width: 100% !important;
          height: auto !important;
        }

        .docx-responsive section.docx-wrapper table {
          width: 100% !important;
          max-width: 100% !important;
          table-layout: fixed !important;
        }

        .docx-responsive section.docx-wrapper p,
        .docx-responsive section.docx-wrapper td,
        .docx-responsive section.docx-wrapper th {
          overflow-wrap: break-word !important;
        }

        .docx-responsive section.docx-wrapper img,
        .docx-responsive section.docx-wrapper svg,
        .docx-responsive section.docx-wrapper canvas {
          max-width: 100% !important;
          height: auto !important;
        }
      }
    `;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  const [step, setStep] = useState<SigningStep>('loading');
  const [signer, setSigner] = useState<Signer | null>(null);
  const [request, setRequest] = useState<SignatureRequest | null>(null);
  /**
   * DESLOCAMENTO ENTRE O RELÓGIO DO NAVEGADOR E O DO SERVIDOR.
   *
   * A hora carimbada dentro da selfie precisa bater EXATAMENTE com a hora que
   * a trilha de auditoria registra. Se o carimbo sair do relógio do aparelho,
   * um celular adiantado produz uma foto dizendo uma hora e um registro dizendo
   * outra — e essa divergência, num questionamento, vira argumento de montagem.
   *
   * Pior ainda: `public-sign-document` CLAMPA os instantes reportados pelo
   * cliente à janela [viewed_at, now()] do servidor. Um relógio torto não só
   * diverge — ele é silenciosamente corrigido no banco, e só a foto fica com a
   * hora errada, sem ninguém perceber.
   *
   * Medido uma vez, com compensação de ida e volta.
   */
  const deslocamentoDoRelogioRef = useRef(0);
  const agoraDoServidor = useCallback(
    () => new Date(Date.now() + deslocamentoDoRelogioRef.current),
    [],
  );
  // Ordem sequencial: nome do signatário anterior ainda pendente (null = é a vez deste).
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const [signatureFields, setSignatureFields] = useState<SignatureField[]>([]);
  const [signerData, setSignerData] = useState<SignerData>({ name: '', cpf: '', phone: '' });
  // Chave do rascunho por token. Ver helpers readSigningDraft/writeSigningDraft.
  const signingDraftKey = `signing-draft:${token}`;
  const draftLoadedRef = useRef(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  /** Espelho do desenho para ler de dentro do ResizeObserver sem closure velha. */
  const signatureDataRef = useRef<string | null>(null);
  signatureDataRef.current = signatureData;
  const [facialData, setFacialData] = useState<string | null>(null);
  const [facialValidating, setFacialValidating] = useState(false);
  const [facialValidation, setFacialValidation] = useState<FacialAIValidationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const signingStatusMessages = useMemo(
    () => ['Enviando assinatura…', 'Estamos preparando tudo…', 'Mais um instante…', 'Estamos confirmando a autenticidade…', 'Finalizando…'],
    []
  );
  const [signingStatusIndex, setSigningStatusIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Telefone/WhatsApp do escritório (fonte central office_identity via RPC anon).
  // null = não configurado → botões de WhatsApp ficam ocultos.
  const [officeWhatsapp, setOfficeWhatsapp] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isDocx, setIsDocx] = useState(false);
  const [docxLoading, setDocxLoading] = useState(false);
  const [pdfFrameLoaded, setPdfFrameLoaded] = useState(false);
  const [docxRendered, setDocxRendered] = useState(false);

  /**
   * Protege o trecho crítico entre o toque em “Assinar documento” e a resposta
   * final do servidor.
   *
   * O overlay já elimina saídas dentro da interface; `beforeunload` cobre o que
   * fica fora dela (fechar a aba, recarregar e navegar para outro endereço).
   * Navegadores modernos mostram a mensagem nativa deles — o texto customizado
   * é deliberadamente ignorado por segurança. A trava sai no mesmo instante em
   * que o envio termina ou falha, para nunca prender a pessoa no comprovante.
   */
  useEffect(() => {
    if (!loading) return;

    const tituloAnterior = document.title;
    const protegerSaida = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    document.title = 'Enviando assinatura — mantenha esta página aberta';
    window.addEventListener('beforeunload', protegerSaida);

    return () => {
      window.removeEventListener('beforeunload', protegerSaida);
      document.title = tituloAnterior;
    };
  }, [loading]);

  const [authConfig, setAuthConfig] = useState<PublicAuthConfig>({ google: true, email: true, phone: true, whatsapp: false });

  // Carrega o telefone do escritório (fonte central) para os botões de ajuda no WhatsApp.
  useEffect(() => {
    let mounted = true;
    signatureService.getOfficeWhatsapp()
      .then((phone) => { if (mounted) setOfficeWhatsapp(phone); })
      .catch(() => { if (mounted) setOfficeWhatsapp(null); });
    return () => { mounted = false; };
  }, []);

  const docxContainerRef = useRef<HTMLDivElement>(null);
  const [queuedOpenSignModal, setQueuedOpenSignModal] = useState(false);
  
  // Documentos anexos
  const [attachments, setAttachments] = useState<{ name: string; url: string; rendered?: boolean; prefetched?: boolean; isDocx?: boolean }[]>([]);
  const [attachmentManifestReady, setAttachmentManifestReady] = useState(false);
  const attachmentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const attachmentBlobRef = useRef<(Blob | null)[]>([]);
  const attachmentObjectUrlRef = useRef<(string | null)[]>([]);
  const attachmentRenderTokenRef = useRef(0);
  const attachmentRenderInProgressRef = useRef<Set<number>>(new Set());
  const attachmentRenderedRef = useRef<Set<number>>(new Set());
  const presenceStartedRef = useRef(false);

  const [activeTab, setActiveTab] = useState<'signers' | 'history'>('signers');
  const [auditLog, setAuditLog] = useState<SignatureAuditLog[]>([]);
  const [auditLogLoading, setAuditLogLoading] = useState(false);
  const [auditLogError, setAuditLogError] = useState<string | null>(null);
  const [isSignModalOpen, setIsSignModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState<ModalStep>('google_auth');
  const [isRefuseModalOpen, setIsRefuseModalOpen] = useState(false);
  const [refuseReason, setRefuseReason] = useState('');
  const [refusing, setRefusing] = useState(false);
  const [refuseError, setRefuseError] = useState<string | null>(null);
  const [creator, setCreator] = useState<{ name: string } | null>(null);
  // Aceite dos Termos de Uso (LGPD) — obrigatório para enviar a assinatura
  const [termsAccepted, setTermsAccepted] = useState(false);
  /**
   * INSTANTE REAL DO ACEITE DOS TERMOS.
   *
   * Antes o servidor gravava `new Date()` no momento do ENVIO, o que fazia
   * `terms_accepted_at` sair com o mesmo milissegundo de `signed_at` em 100%
   * das assinaturas. No papel isso lê como se o aceite não tivesse sido um ato
   * separado — e é a primeira coisa que a parte contrária aponta: se os dois
   * instantes são idênticos, o consentimento não precedeu a assinatura, foi
   * carimbado junto com ela.
   *
   * Agora vale o momento em que a pessoa marca a caixa, no relógio do servidor
   * (mesma fonte do carimbo da selfie e da trilha).
   */
  const termsAcceptedAtRef = useRef<string | null>(null);
  const marcarAceiteDosTermos = useCallback((aceito: boolean) => {
    setTermsAccepted(aceito);
    // Desmarcar e marcar de novo vale o ÚLTIMO aceite: é ele que está em vigor
    // quando a assinatura é enviada.
    termsAcceptedAtRef.current = aceito ? agoraDoServidor().toISOString() : null;
    // O degrau é carimbado no banco AGORA, e não só no envio da assinatura:
    // é o que permite ao escritório ver onde a pessoa parou quando ela não
    // conclui. O carimbo do banco só vale a primeira vez e nunca sobrescreve
    // o instante probatório que vai no payload.
    if (aceito) void signatureService.marcarEtapaDaAssinatura(token, 'termos');
  }, [agoraDoServidor, token]);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages] = useState(1); // TODO: detectar páginas do PDF
  const [zoom, setZoom] = useState(100);
  const [showReport, setShowReport] = useState(false);

  // Prazo-limite de carregamento: se o render de um anexo DOCX não confirmar
  // (docx-preview pode falhar/pendurar sem disparar onRendered), não travamos a
  // página indefinidamente — após o prazo, seguimos com o documento principal.
  const [loadDeadlineReached, setLoadDeadlineReached] = useState(false);

  // A leitura e a assinatura têm marcos diferentes. No iPhone, esperar baixar
  // todos os anexos antes de mostrar o documento principal prendia a pessoa na
  // frase "Conferindo seu acesso" mesmo depois de o acesso já estar confirmado.
  const allAttachmentsRendered = attachments.length === 0 || attachments.every(a => !a.isDocx || a.rendered);
  const mainDocLoaded = isDocx ? (!docxLoading && docxRendered) : (!!pdfUrl && pdfFrameLoaded);
  const readerReady = isPublicSigningReaderReady({
    step,
    hasSigner: !!signer,
    hasRequest: !!request,
    mainDocumentLoaded: mainDocLoaded,
  });
  const canOpenSignModal = canOpenPublicSigningModal({
    readerReady,
    attachmentManifestReady,
    allAttachmentsRendered,
    loadDeadlineReached,
  });

  // ── Overlay de carregamento: visível desde o início, tempo mínimo de 10 s ──
  /** O compartilhamento faz rede antes de abrir a folha; sem isto o botão fica mudo. */
  const [sharing, setSharing] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(true);   // começa visível
  const [overlayFading, setOverlayFading] = useState(false);
  const pageLoadTimeRef  = useRef<number>(Date.now());           // marca o momento do mount

  // Dispensa o overlay imediatamente quando ocorre erro ou já assinado
  useEffect(() => {
    if (step === 'error' || step === 'already_signed') {
      const fadeTimer = window.setTimeout(() => setOverlayFading(true), 0);
      const hideTimer = window.setTimeout(() => {
        setOverlayVisible(false);
        setOverlayFading(false);
      }, 420);
      return () => {
        window.clearTimeout(fadeTimer);
        window.clearTimeout(hideTimer);
      };
    }
  }, [step]);

  /**
   * Dispensa a cortina de abertura.
   *
   * O piso era de DEZ SEGUNDOS. Num link que abre rápido, o documento já estava
   * pronto atrás da cortina desde o segundo 2 — e a pessoa ficava olhando
   * "Pronto para assinar." por oito segundos, sem nada acontecendo. O piso não
   * media nada: `readerReady` já é um sinal honesto de que o documento
   * principal está legível. Os anexos continuam preparando o botão por baixo.
   *
   * Sobraram dois tempos, e cada um existe por um motivo:
   *
   *  · PISO — a cena não pode ser um flash de 200 ms quando tudo vem do cache;
   *  · RESPIRO — depois do "pronto", o tempo de LER que ficou pronto. Sem ele, a
   *    linha verde apareceria e sumiria no mesmo quadro.
   *
   * Quem chega depois do piso paga só o respiro.
   */
  useEffect(() => {
    if (!readerReady || !overlayVisible) return;

    const PISO_MS = 1400;
    const RESPIRO_MS = 650;
    const decorrido = Date.now() - pageLoadTimeRef.current;
    const espera = Math.max(PISO_MS - decorrido, RESPIRO_MS);
    const fadeTimer = window.setTimeout(() => setOverlayFading(true), espera);
    const hideTimer = window.setTimeout(() => {
      setOverlayVisible(false);
      setOverlayFading(false);
    }, espera + 420);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(hideTimer);
    };
  }, [readerReady, overlayVisible]);

  /**
   * A ESPERA QUE NÃO TERMINA.
   *
   * A cortina de abertura só saía por `readerReady`. Se o documento principal
   * nunca confirmasse o render — docx-preview que pendura, download que morre
   * no meio, aparelho que não dá conta do arquivo — ela girava a roda PARA
   * SEMPRE, e a única saída de quem estava do outro lado era fechar a aba e
   * desistir de assinar.
   *
   * Trinta e dois segundos é tarde de propósito: `faseDaAbertura` ainda está
   * dizendo que o download demora, e oferecer "recarregar" antes disso ensina a
   * recarregar por impaciência — o que transforma uma espera longa em espera
   * eterna, porque cada recarga recomeça o download do zero.
   */
  const [esperaTravada, setEsperaTravada] = useState(false);
  useEffect(() => {
    if (readerReady) { setEsperaTravada(false); return; }
    const t = window.setTimeout(() => setEsperaTravada(true), 32_000);
    return () => window.clearTimeout(t);
  }, [readerReady]);

  // Prazo-limite: libera o requisito de "todos os anexos renderizados" após 18 s.
  // Cobre o caso comum de um anexo DOCX que não confirma o render (overlay preso
  // no ~96%). O documento principal continua sendo exigido para habilitar assinar.
  useEffect(() => {
    const t = window.setTimeout(() => setLoadDeadlineReached(true), 18_000);
    return () => window.clearTimeout(t);
  }, []);

  // Failsafe absoluto: o overlay NUNCA deve prender a página. Se nem o documento
  // principal confirmar o carregamento, liberamos a tela mesmo assim após 26 s —
  // o conteúdo restante segue carregando por baixo (melhor que travar no 96%).
  useEffect(() => {
    const t = window.setTimeout(() => {
      setOverlayFading(true);
      window.setTimeout(() => {
        setOverlayVisible(false);
        setOverlayFading(false);
      }, 600);
    }, 26_000);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!loading) return;
    setSigningStatusIndex(0);
    const id = window.setInterval(() => {
      setSigningStatusIndex((i) => (i + 1) % signingStatusMessages.length);
    }, 1700);
    return () => window.clearInterval(id);
  }, [loading, signingStatusMessages.length]);

  // Canvas refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);

  // Webcam refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);

  // Portão de rosto no visor: só roda com a câmera ligada e nenhuma foto ainda
  // tirada. Ver src/hooks/useDeteccaoDeRosto.ts para os escapes da trava.
  const deteccaoRosto = useDeteccaoDeRosto(
    videoRef,
    isSignModalOpen && modalStep === 'facial' && cameraActive && !facialData,
  );

  /*
    QUEM DISPARA A FOTO É O DEDO.

    Havia aqui um disparo automático: com o rosto parado no oval, corria uma
    contagem de 5…1 e a foto saía sozinha (com teto de 3 disparos por etapa,
    para uma reprovação em série não virar uma fila de chamadas de visão pagas).
    Saiu por decisão do escritório: a pessoa deixa de escolher a hora da própria
    foto, e uma contagem correndo apressa justamente quem está com dificuldade
    de se enquadrar.

    O que sobrou é o que já existia como plano B: o botão, liberado só quando o
    detector vê um rosto. `deteccaoRosto.liberado` continua tendo escapes de
    propósito (12 s sem detecção, ou modelo que não carrega, destravam o botão)
    — impedir alguém de assinar custa um contrato com prazo, e detector de rosto
    erra mais com pele escura e luz fraca. Ver `useDeteccaoDeRosto`.
  */
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  // Location
  const [locationData, setLocationData] = useState<{ lat: number; lng: number } | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Signed document viewer
  const [signedDocumentUrl, setSignedDocumentUrl] = useState<string | null>(null);
  // Modelo per_document: resultado individual por arquivo do kit (principal + anexos),
  // cada um com seu código de verificação e PDF assinado próprios.
  const [signedDocuments, setSignedDocuments] = useState<
    { documentKey: string; displayName: string; verificationCode: string; url: string | null }[]
  >([]);
  const [downloadingAlreadySigned, setDownloadingAlreadySigned] = useState(false);
  // Visualizador interno (iframe) do PDF assinado — não expõe a URL do Supabase.
  const [signedViewerUrl, setSignedViewerUrl] = useState<string | null>(null);

  // Google Auth
  const [googleUser, setGoogleUser] = useState<GoogleUser | null>(null);
  const [googleAuthLoading, setGoogleAuthLoading] = useState(false);
  const [googleAuthError, setGoogleAuthError] = useState<string | null>(null);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const googleInitAttemptsRef = useRef(0);
  const googleAuthInitTokenRef = useRef(0);
  const googleAuthInitInFlightRef = useRef(false);
  const googleAuthPreloadedRef = useRef(false);

  // Phone OTP
  const [phoneOtp, setPhoneOtp] = useState('');
  // WhatsApp e SMS são a MESMA etapa: mesmo código, mesma tabela, mesma
  // validação — muda só por onde ele chega. Duplicar a tela em duas etapas
  // separadas seria duplicar também o reenvio, o contador e o erro.
  const [phoneOtpChannel, setPhoneOtpChannel] = useState<'sms' | 'whatsapp'>('sms');
  // Segundos que faltam para o próximo código poder ser pedido. A espera CRESCE
  // a cada pedido (a escada vive no servidor, em `_shared/otp-cooldown`), então
  // o número vem de lá — a tela só conta para trás e desliga o botão. Deixar a
  // pessoa clicar para descobrir no erro seria pior do que mostrar o relógio.
  const [phoneOtpResendIn, setPhoneOtpResendIn] = useState(0);
  /** Segundos que o código ainda vale. O relógio fica logo abaixo do campo. */
  const [phoneOtpRemaining, setPhoneOtpRemaining] = useState(0);
  const phoneOtpInputRef = useRef<HTMLInputElement>(null);
  const emailOtpInputRef = useRef<HTMLInputElement>(null);
  // Códigos errados seguidos. Serve para uma coisa só: a partir do primeiro
  // tropeço a tela oferece OUTRO caminho. Insistir com quem não está recebendo
  // o código é o jeito mais rápido de a assinatura não acontecer.
  const [phoneOtpFails, setPhoneOtpFails] = useState(0);
  const [phoneOtpSent, setPhoneOtpSent] = useState(false);
  const [phoneOtpExpiresAt, setPhoneOtpExpiresAt] = useState<string | null>(null);
  const [phoneOtpVerified, setPhoneOtpVerified] = useState(false);
  const [phoneOtpLoading, setPhoneOtpLoading] = useState(false);
  const [phoneOtpError, setPhoneOtpError] = useState<string | null>(null);

  // Instantes REAIS de cada etapa probatória (autenticação, selfie, localização),
  // registrados no ato e enviados no payload da assinatura. Sem isto o dossiê
  // reutilizava viewed_at e todos os eventos apareciam com o MESMO segundo.
  const authAtRef = useRef<string | null>(null);
  const facialCapturedAtRef = useRef<string | null>(null);
  const geolocationCapturedAtRef = useRef<string | null>(null);

  // Email OTP
  const [emailToVerify, setEmailToVerify] = useState('');
  const [emailOtp, setEmailOtp] = useState('');
  const [emailOtpSent, setEmailOtpSent] = useState(false);
  const [emailOtpExpiresAt, setEmailOtpExpiresAt] = useState<string | null>(null);
  const [emailOtpVerified, setEmailOtpVerified] = useState(false);
  const [emailOtpLoading, setEmailOtpLoading] = useState(false);
  const [emailOtpError, setEmailOtpError] = useState<string | null>(null);
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const [showEmailAnimation, setShowEmailAnimation] = useState(false);
  const [emailOtpRemaining, setEmailOtpRemaining] = useState<number>(0);
  const [emailOtpResendIn, setEmailOtpResendIn] = useState(0);
  const [emailOtpFails, setEmailOtpFails] = useState(0);

  // Erro de código é do MOMENTO, não da etapa.
  //
  // Quem erra o código e usa a saída lá de baixo ("confirme de outro jeito")
  // vai para a tela de escolha; ao voltar para o WhatsApp encontrava o
  // "Código incorreto" da tentativa anterior ainda na tela, agora sem nenhuma
  // relação com o que está acontecendo — e com os dígitos errados ainda no
  // campo, prontos para queimar mais uma tentativa num clique.
  //
  // Trocar de etapa limpa as duas coisas. Fica no efeito, e não em cada botão,
  // porque são muitos caminhos de ida e volta (as saídas alternativas, os dois
  // "Voltar", o salto automático quando um método é desligado) e esquecer um
  // deles é justamente como o problema nasceu.
  useEffect(() => {
    setPhoneOtpError(null);
    setEmailOtpError(null);
    setPhoneOtp('');
    setEmailOtp('');
  }, [modalStep]);

  // Validade do código por telefone: conta para trás a partir de `expires_at`.
  // "Válido até 21:47" obriga quem lê a olhar o relógio e fazer a conta; o que
  // a pessoa quer saber é quanto tempo AINDA tem.
  useEffect(() => {
    if (!phoneOtpSent || !phoneOtpExpiresAt) {
      setPhoneOtpRemaining(0);
      return;
    }
    const tick = () => {
      const diff = Math.max(0, Math.floor((new Date(phoneOtpExpiresAt).getTime() - Date.now()) / 1000));
      setPhoneOtpRemaining(diff);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [phoneOtpSent, phoneOtpExpiresAt]);

  // Um relógio só para os dois contadores de reenvio.
  useEffect(() => {
    if (phoneOtpResendIn <= 0 && emailOtpResendIn <= 0) return;
    const id = window.setInterval(() => {
      setPhoneOtpResendIn((v) => (v > 0 ? v - 1 : 0));
      setEmailOtpResendIn((v) => (v > 0 ? v - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [phoneOtpResendIn > 0, emailOtpResendIn > 0]);

  // Contador regressivo da validade do código de e-mail.
  useEffect(() => {
    if (!emailOtpSent || !emailOtpExpiresAt) {
      setEmailOtpRemaining(0);
      return;
    }
    const tick = () => {
      const diff = Math.max(0, Math.floor((new Date(emailOtpExpiresAt).getTime() - Date.now()) / 1000));
      setEmailOtpRemaining(diff);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [emailOtpSent, emailOtpExpiresAt]);

  // Persiste o rascunho (formulário + assinatura desenhada + localização) a cada
  // mudança. Só grava após o carregamento inicial, pra não sobrescrever um
  // rascunho existente com o estado vazio. Renova a validade de 24h a cada escrita.
  useEffect(() => {
    if (!draftLoadedRef.current || step === 'success') return;
    writeSigningDraft(signingDraftKey, { signerData, signatureData, locationData });
  }, [signerData, signatureData, locationData, step, signingDraftKey]);

  // Documento assinado → limpa o rascunho.
  useEffect(() => {
    if (step === 'success') clearSigningDraft(signingDraftKey);
  }, [step, signingDraftKey]);

  useEffect(() => {
    loadSignerData();
  }, [token]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const t0 = Date.now();
        const { data, error } = await supabase.rpc('server_now');
        const t1 = Date.now();
        if (!vivo || error || !data) return;
        const servidorMs = new Date(data as string).getTime();
        if (Number.isNaN(servidorMs)) return;
        // Metade do round-trip aproxima o instante em que o servidor respondeu.
        deslocamentoDoRelogioRef.current = servidorMs - (t0 + (t1 - t0) / 2);
      } catch {
        // Sem resposta, segue com o relógio local: melhor um carimbo com a
        // hora do aparelho do que nenhum carimbo.
      }
    })();
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (!request?.id) return;
    let cancelled = false;
    const run = async () => {
      try {
        setAuditLogLoading(true);
        setAuditLogError(null);
        // Fluxo PÚBLICO: via RPC token-scoped (sem leitura anon direta → sem 401).
        const data = (await signatureService.getPublicReportAuditLog(token)) ?? [];
        if (cancelled) return;
        // Deduplicar itens idênticos no mesmo minuto (evita poluição por logs duplicados)
        const seen = new Set<string>();
        const deduped: SignatureAuditLog[] = [];
        for (const item of data) {
          const minuteKey = (item.created_at || '').slice(0, 16);
          const key = `${item.action}|${item.description}|${item.ip_address || ''}|${item.user_agent || ''}|${minuteKey}`;
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(item);
        }
        setAuditLog(deduped);
      } catch (e: any) {
        if (cancelled) return;
        setAuditLogError(e?.message || 'Não foi possível carregar o histórico.');
      } finally {
        if (!cancelled) setAuditLogLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [request?.id]);

  useEffect(() => {
    return () => {
      // Cleanup de object URLs gerados no prefetch
      for (const url of attachmentObjectUrlRef.current) {
        if (url) {
          try { URL.revokeObjectURL(url); } catch { /* noop */ }
        }
      }
    };
  }, []);

  // Renderizar DOCX quando a URL estiver disponível
  useEffect(() => {
    if (!pdfUrl || !isDocx) {
      return;
    }
    
    if (step !== 'success') {
      return;
    }
    
    const renderDocx = async () => {
      try {
        setDocxLoading(true);
        setDocxRendered(false);
        
        const response = await fetch(pdfUrl);
        
        if (!response.ok) {
          console.error('❌ Erro ao baixar DOCX:', response.status, response.statusText);
          return;
        }
        
        const blob = await response.blob();
        
        // Aguardar o container estar disponível
        await new Promise(resolve => setTimeout(resolve, 100));
        
        if (docxContainerRef.current) {
          docxContainerRef.current.innerHTML = '';
          await renderAsync(blob, docxContainerRef.current, undefined, {
            className: 'docx-wrapper',
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            breakPages: true, // Habilitar quebra de páginas (igual ao SignatureModule)
            renderHeaders: true,
            renderFooters: true,
            renderFootnotes: true,
          });
          setDocxRendered(true);
        } else {
          console.error('❌ Container ref não disponível');
        }
      } catch (err) {
        console.error('❌ Erro ao renderizar DOCX:', err);
      } finally {
        setDocxLoading(false);
      }
    };
    
    renderDocx();
  }, [pdfUrl, isDocx, step]);

  useEffect(() => {
    setPdfFrameLoaded(false);
    if (!isDocx) {
      setDocxRendered(false);
    }
  }, [pdfUrl, isDocx]);

  // Renderizar anexos DOCX quando carregados
  // Usamos attachments.length como dependência para evitar loops infinitos
  const attachmentsLengthRef = useRef(0);
  useEffect(() => {
    if (attachments.length === 0) return;
    // Só re-executar se o número de anexos mudou (evita loop ao marcar rendered)
    if (attachments.length === attachmentsLengthRef.current) return;
    attachmentsLengthRef.current = attachments.length;

    attachmentRenderTokenRef.current += 1;
    const token = attachmentRenderTokenRef.current;
    let cancelled = false;
    let retryTimer: number | null = null;

    const renderAttachments = async () => {
      if (cancelled) return;
      if (token !== attachmentRenderTokenRef.current) return;

      let needsRetry = false;
      const renderedIdx = new Set<number>();

      for (let i = 0; i < attachments.length; i++) {
        if (cancelled) return;
        if (token !== attachmentRenderTokenRef.current) return;

        const attach = attachments[i];
        // Usar ref para checar se já renderizou (evita depender do state)
        if (attachmentRenderedRef.current.has(i)) continue;
        if (attach.rendered) {
          attachmentRenderedRef.current.add(i);
          continue;
        }

        // Verificar se é DOCX
        const isDocxFile = !!attach.isDocx;
        if (!isDocxFile) {
          attachmentRenderedRef.current.add(i);
          continue;
        }

        const container = attachmentRefs.current[i];
        if (!container) {
          needsRetry = true;
          continue;
        }

        if (attachmentRenderInProgressRef.current.has(i)) {
          needsRetry = true;
          continue;
        }
        attachmentRenderInProgressRef.current.add(i);

        try {
          console.log(`📎 Renderizando anexo ${i + 1}:`, attach.name);
          let blob = attachmentBlobRef.current[i];
          if (!blob) {
            const response = await fetch(attach.url);
            if (!response.ok) {
              console.error(`❌ Erro ao baixar anexo ${i + 1}:`, response.status);
              attachmentRenderInProgressRef.current.delete(i);
              continue;
            }
            blob = await response.blob();
            attachmentBlobRef.current[i] = blob;
          }

          container.innerHTML = '';
          await renderAsync(blob, container, undefined, {
            className: 'docx-wrapper',
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            breakPages: true,
            renderHeaders: true,
            renderFooters: true,
            renderFootnotes: true,
          });

          attachmentRenderedRef.current.add(i);
          renderedIdx.add(i);
          console.log(`✅ Anexo ${i + 1} renderizado com sucesso!`);
        } catch (err) {
          console.error(`❌ Erro ao renderizar anexo ${i + 1}:`, err);
        } finally {
          attachmentRenderInProgressRef.current.delete(i);
        }
      }

      if (renderedIdx.size > 0) {
        setAttachments((prev) => {
          if (token !== attachmentRenderTokenRef.current) return prev;
          return prev.map((a, idx) => (renderedIdx.has(idx) ? { ...a, rendered: true } : a));
        });
      }

      if (needsRetry) {
        retryTimer = window.setTimeout(renderAttachments, 120);
      }
    };

    void renderAttachments();

    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [attachments.length]);

  useEffect(() => {
    if (!queuedOpenSignModal) return;
    if (!canOpenSignModal) return;
    if (isSignModalOpen) return;
    if (loading) return;
    setQueuedOpenSignModal(false);
    openSignModal();
  }, [queuedOpenSignModal, canOpenSignModal, isSignModalOpen]);

  useEffect(() => {
    if (!canOpenSignModal) return;
    if (googleAuthPreloadedRef.current) return;
    googleAuthPreloadedRef.current = true;

    const preload = () => {
      googleAuthService.initialize().catch(() => {
        // ignore
      });
    };

    const w = window as any;
    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(preload, { timeout: 1500 });
      return () => {
        try {
          w.cancelIdleCallback?.(id);
        } catch {
          // ignore
        }
      };
    }

    const id = window.setTimeout(preload, 800);
    return () => window.clearTimeout(id);
  }, [canOpenSignModal]);

  /**
   * Dimensiona o canvas quando a etapa de assinatura entra em cena — e de novo
   * sempre que a caixa mudar de tamanho.
   *
   * O ResizeObserver dispara já na primeira observação, então ele é também a
   * inicialização, e com a vantagem de medir depois do layout assentar: o
   * efeito anterior media uma vez só, no commit, e ficava preso àquele tamanho.
   * O guarda por largura/altura arredondadas evita reinicializar (e apagar o
   * traço) a cada fração de pixel.
   */
  useEffect(() => {
    if (!isSignModalOpen || modalStep !== 'signature') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let largura = 0;
    let altura = 0;

    const dimensionar = () => {
      const rect = canvas.getBoundingClientRect();
      const l = Math.round(rect.width);
      const a = Math.round(rect.height);
      if (l === 0 || a === 0) return;
      if (l === largura && a === altura) return;
      largura = l;
      altura = a;

      const salvo = signatureDataRef.current;
      initCanvas();
      // Redesenha o traço que veio do rascunho (ou o que já estava na tela).
      if (salvo) redesenharAssinatura(salvo);
    };

    const observador = new ResizeObserver(dimensionar);
    observador.observe(canvas);
    return () => observador.disconnect();
  }, [isSignModalOpen, modalStep]);

  useEffect(() => {
    if (!isSignModalOpen) {
      stopCamera();
      return;
    }

    if (modalStep !== 'facial') {
      stopCamera();
    }
    return () => stopCamera();
  }, [isSignModalOpen, modalStep]);

  useEffect(() => {
    if (!cameraActive) return;
    if (modalStep !== 'facial') return;
    if (!videoRef.current) return;
    if (!cameraStreamRef.current) return;

    if (videoRef.current.srcObject !== cameraStreamRef.current) {
      videoRef.current.srcObject = cameraStreamRef.current;
    }
  }, [cameraActive, modalStep]);

  /**
   * Foto reprovada pela IA → devolve a câmera sozinho, com o motivo na tela.
   *
   * É aqui que a obstrução (mão no rosto, óculos escuros cobrindo) é de fato
   * barrada: o detector local só sabe dizer que há um rosto enquadrado, quem
   * julga se dá para reconhecer é `analyze-facial-photo`.
   */
  useEffect(() => {
    if (modalStep !== 'facial') return;
    if (facialValidating) return;
    if (facialValidation?.valid !== false) return;
    const t = window.setTimeout(() => {
      setFacialData(null);
      setFacialValidation(null);
      void startCamera();
    }, 2600);
    return () => window.clearTimeout(t);
  }, [modalStep, facialValidating, facialValidation]);

  // Foto aprovada → avança automaticamente para a etapa de autorização/confirmação.
  // Mostra "Foto aprovada!" por um instante antes de avançar.
  useEffect(() => {
    if (modalStep !== 'facial') return;
    if (!facialData) return;
    if (facialValidating) return;
    if (facialValidation?.valid === false) return;
    const t = window.setTimeout(() => setModalStep('confirm'), 1000);
    return () => window.clearTimeout(t);
  }, [modalStep, facialData, facialValidating, facialValidation]);

  
  // Inicializar Google Auth quando modal abre na etapa de autenticação
  useEffect(() => {
    if (isSignModalOpen && modalStep === 'google_auth' && authConfig.google && !googleUser) {
      googleAuthInitTokenRef.current += 1;
      const token = googleAuthInitTokenRef.current;

      let cancelled = false;
      let tries = 0;

      const tick = () => {
        if (cancelled) return;
        if (!isSignModalOpen || modalStep !== 'google_auth' || !authConfig.google || googleUser) return;

        const el = googleButtonRef.current;
        if (el) {
          window.requestAnimationFrame(() => {
            void initGoogleAuth(token, el);
          });
          return;
        }

        tries += 1;
        if (tries <= 30) {
          window.setTimeout(tick, 60);
        }
      };

      const timer = window.setTimeout(tick, 240);
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }
  }, [isSignModalOpen, modalStep, authConfig.google, googleUser]);

  
  const initGoogleAuth = async (initToken: number, buttonEl: HTMLDivElement) => {
    if (!buttonEl?.isConnected) return;

    if (googleAuthInitInFlightRef.current) return;
    googleAuthInitInFlightRef.current = true;

    try {
      setGoogleAuthLoading(true);
      setGoogleAuthError(null);
      await googleAuthService.initialize();

      if (initToken !== googleAuthInitTokenRef.current) return;
      if (!buttonEl?.isConnected) return;

      buttonEl.innerHTML = '';
      
      // @ts-ignore - Google Identity Services global
      if (typeof google !== 'undefined' && google.accounts?.id) {
        googleInitAttemptsRef.current = 0;
        // @ts-ignore
        google.accounts.id.initialize({
          client_id: '249483607462-bgh9hg63orddsjdai5tuicl5gd9p1jj0.apps.googleusercontent.com',
          callback: handleGoogleCallback,
          auto_select: false,
        });
        
        /* A largura sai do PRÓPRIO nó, não do pai: o botão agora mora dentro
           de uma moldura com padding, e medir o pai devolvia uma largura maior
           que o vão — o widget vazava por baixo da borda. 400 px é o teto que
           a biblioteca do Google aceita. */
        const containerW = Math.floor(
          buttonEl.getBoundingClientRect().width ||
            buttonEl.parentElement?.getBoundingClientRect().width ||
            320
        );
        const width = Math.max(240, Math.min(400, containerW));

        // @ts-ignore
        google.accounts.id.renderButton(buttonEl, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          logo_alignment: 'left',
          width,
        });
      } else {
        setGoogleAuthError('Não foi possível carregar o botão do Google. Use o login alternativo.');
      }
    } catch (err: any) {
      console.error('Erro ao inicializar Google Auth:', err);
      if (initToken !== googleAuthInitTokenRef.current) return;
      setGoogleAuthError('Erro ao carregar autenticação Google');
    } finally {
      googleAuthInitInFlightRef.current = false;
      if (initToken !== googleAuthInitTokenRef.current) return;
      setGoogleAuthLoading(false);
    }
  };

  /**
   * Envia o código por e-mail.
   *
   * Aceita um endereço EXPLÍCITO porque o atalho da tela de identidade dispara
   * o envio no mesmo clique em que escolhe o método: nesse instante o `setState`
   * do endereço ainda não foi aplicado, e ler do estado mandaria string vazia.
   */
  const handleSendEmailOtp = async (emailExplicito?: string) => {
    try {
      setEmailOtpLoading(true);
      setEmailOtpError(null);
      setShowEmailAnimation(true);

      const email = (emailExplicito ?? emailToVerify ?? '').trim();
      if (emailExplicito) setEmailToVerify(email);
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error('Informe um e-mail válido');
      }

      const res = await signatureService.sendEmailOtp({ token, email });
      setEmailOtpSent(true);
      setEmailOtpExpiresAt(res.expires_at ?? null);
      setEmailOtpResendIn(res.resend_in_seconds ?? 0);
      toast.success('Código enviado por e-mail');
      
      // Manter animação por 1.5s antes de esconder
      setTimeout(() => setShowEmailAnimation(false), 1500);
    } catch (e: any) {
      if (e?.retryAfterSeconds) setEmailOtpResendIn(e.retryAfterSeconds);
      setEmailOtpError(e?.message || 'Não foi possível enviar o código');
      setShowEmailAnimation(false);
    } finally {
      setEmailOtpLoading(false);
    }
  };

  const handleVerifyEmailOtp = async () => {
    try {
      setEmailOtpLoading(true);
      setEmailOtpError(null);

      const code = emailOtp.replace(/\D/g, '');
      if (code.length < 4) {
        throw new Error('Informe o código recebido');
      }

      const res = await signatureService.verifyEmailOtp({ token, code });
      setEmailOtpVerified(true);
      authAtRef.current = agoraDoServidor().toISOString(); // instante real, no relógio do servidor
      void signatureService.marcarEtapaDaAssinatura(token, 'autenticacao');
      if (res.email) {
        setVerifiedEmail(res.email);
      }
      toast.success('E-mail verificado com sucesso!');
      setModalStep(allowSkipSignerDataStep && isSignerDataComplete(signerData) ? 'signature' : 'data');
    } catch (e: any) {
      setEmailOtpFails((n) => n + 1);
      setEmailOtpError(e?.message || 'Código inválido');
      setEmailOtp('');
      window.setTimeout(() => emailOtpInputRef.current?.focus(), 0);
    } finally {
      setEmailOtpLoading(false);
    }
  };

  const finalizeGoogleUser = (user: GoogleUser) => {
    setGoogleUser(user);
    authAtRef.current = agoraDoServidor().toISOString(); // instante real, no relógio do servidor

    const next: SignerData = {
      ...signerData,
      name: (signerData.name || user.name || '').toString(),
    };
    setSignerData(next);

    setModalStep(allowSkipSignerDataStep && isSignerDataComplete(next) ? 'signature' : 'data');
    toast.success('Autenticação realizada com sucesso!');
  };

  const handleGoogleCallback = (response: any) => {
    try {
      if (!response?.credential) {
        throw new Error('Resposta inválida do Google');
      }

      const base64Url = response.credential.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      const payload = JSON.parse(jsonPayload);

      const user: GoogleUser = {
        // O JWT inteiro segue junto: a decodificação acima serve só para
        // mostrar nome e foto aqui. Quem confere se ele é verdadeiro é o
        // servidor, na hora de assinar.
        idToken: response.credential,
        email: payload.email,
        name: payload.name,
        picture: payload.picture,
        sub: payload.sub,
      };

      finalizeGoogleUser(user);
    } catch (err) {
      console.error('Erro ao processar resposta do Google:', err);
      setGoogleAuthError('Erro ao processar autenticação');
    }
  };

  const handleGooglePopupLogin = async () => {
    try {
      setGoogleAuthLoading(true);
      setGoogleAuthError(null);
      const user = await googleAuthService.signInWithPopup();
      finalizeGoogleUser(user);
    } catch (err: any) {
      console.error('Erro no login popup:', err);
      setGoogleAuthError(err?.message || 'Não foi possível autenticar com Google');
    } finally {
      setGoogleAuthLoading(false);
    }
  };

  const handleSkipGoogleAuth = () => {
    // Permitir pular autenticação Google (opcional)
    setModalStep(allowSkipSignerDataStep && isSignerDataComplete(signerData) ? 'signature' : 'data');
  };

  const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

  const ensureOffscreenDocxStyle = (styleId: string) => {
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .docx-wrapper {
        background: #ffffff !important;
        padding: 0 !important;
      }
      .docx-wrapper > section,
      .docx-wrapper article,
      .docx-wrapper .docx {
        width: 794px !important;
        min-width: 794px !important;
        max-width: 794px !important;
        background: #ffffff !important;
      }
      .docx-wrapper,
      .docx-wrapper *,
      .docx-wrapper p,
      .docx-wrapper span {
        overflow-wrap: normal !important;
        word-wrap: normal !important;
        word-break: normal !important;
        hyphens: none !important;
        -webkit-hyphens: none !important;
      }
    `;
    document.head.appendChild(style);
  };

  const renderDocxOffscreen = async (docxUrl: string, styleId: string) => {
    ensureOffscreenDocxStyle(styleId);
    const res = await fetch(docxUrl);
    if (!res.ok) throw new Error(`Falha ao baixar DOCX: HTTP ${res.status}`);
    const blob = await res.blob();

    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.left = '-100000px';
    host.style.top = '0';
    host.style.width = '794px';
    host.style.background = '#ffffff';
    host.style.zIndex = '-1';
    host.style.pointerEvents = 'none';
    document.body.appendChild(host);

    await renderAsync(blob, host, undefined, {
      className: 'docx-wrapper',
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      breakPages: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
    });

    await sleep(500);
    return host;
  };

  /**
   * Modelo per_document: gera 1 PDF assinado POR ARQUIVO do kit (principal + cada
   * anexo), cada um com código de verificação, hash e arquivo próprios, e persiste
   * cada documento via RPC one-shot. Retorna a URL do PDF do documento principal
   * (para manter a continuidade da UI). O caminho consolidado (legado) fica intacto
   * em generateSignedDocumentForSigner.
   */
  const generatePerDocumentSignedForSigner = async (
    currentRequest: SignatureRequest,
    currentSigner: Signer,
  ): Promise<string | null> => {
    cronometroDaAssinatura.comecar();
    console.log('[PER-DOC] Fluxo per_document iniciado para o envelope:', currentRequest.id);

    // Lista de documentos do kit: principal (document_key='main') + anexos ('attachment-<i>').
    type DocUnit = {
      documentKey: string;
      documentType: 'main' | 'attachment';
      displayName: string;
      isDocx: boolean;
      sourceUrl: string | null;   // URL para render/geração
      sourcePath: string | null;  // path original (hash de integridade)
      sortOrder: number;
    };

    const units: DocUnit[] = [];
    const mainPath = currentRequest.document_path || null;
    const mainIsDocx = /\.(docx?|doc)$/i.test(mainPath || '');
    let mainUrl = pdfUrl;
    if (!mainUrl && mainPath) mainUrl = await signatureService.getPublicFileUrl(token, mainPath);
    units.push({
      documentKey: 'main',
      documentType: 'main',
      displayName: currentRequest.document_name || 'Documento principal',
      isDocx: mainIsDocx,
      sourceUrl: mainUrl,
      sourcePath: mainPath,
      sortOrder: 0,
    });
    attachments.forEach((att, i) => {
      const lower = (att.name || '').toLowerCase();
      units.push({
        documentKey: `attachment-${i}`,
        documentType: 'attachment',
        displayName: att.name || `Anexo ${i + 1}`,
        isDocx: lower.endsWith('.docx') || lower.endsWith('.doc'),
        sourceUrl: att.url || null,
        sourcePath: currentRequest.attachment_paths?.[i] ?? att.url ?? null,
        sortOrder: i + 1,
      });
    });
    console.log('[PER-DOC] Documentos do kit:', units.map((u) => u.documentKey));

    const results: { documentKey: string; displayName: string; verificationCode: string; url: string | null }[] = [];
    const persistFailures: string[] = [];
    let mainSignedUrl: string | null = null;

    for (const unit of units) {
      if (!unit.sourceUrl) {
        console.warn('[PER-DOC] Sem URL de origem para', unit.documentKey, '- pulando');
        continue;
      }
      // Código de verificação PRÓPRIO deste documento (estampado no rodapé/QR do PDF).
      const unitFields = signatureFields.filter((field: any) => (field.document_id || 'main') === unit.documentKey);
      const verificationCode = signatureService.generateVerificationHash();
      const verificationUrl = `${window.location.origin}/#/verificar/${verificationCode}`;
      const perDocument = {
        documentKey: unit.documentKey,
        verificationCode,
        verificationUrl,
        integritySources: [unit.sourcePath || unit.sourceUrl].filter(Boolean) as string[],
        // Nome próprio deste arquivo — evita que o anexo herde o nome do envelope no relatório.
        documentName: unit.displayName,
      };
      console.log('[PER-DOC] Gerando', unit.documentKey, 'código:', verificationCode, 'docx:', unit.isDocx);

      // ── A MONTAGEM NO SERVIDOR, quando ligada ──────────────────────────
      //
      // Ver `docs/assinatura-montagem-no-servidor.md` e
      // `src/config/montagemNoServidor.ts`. Uma chamada substitui as TRÊS
      // etapas abaixo — desenhar, subir e registrar — porque a Edge Function
      // faz as três, com o hash apurado sobre os bytes que ela mesma produziu.
      //
      // O código de verificação passa a ser o QUE O SERVIDOR DEVOLVEU, não o
      // gerado acima: é ele que está impresso no rodapé e no QR do arquivo que
      // realmente existe. Usar o local aqui faria a tela de confirmação exibir
      // um código que não abre documento nenhum.
      //
      // A recusa (`sem_original_congelado`) não é erro: é o estado normal
      // enquanto o congelamento não alcança todos os caminhos. Cai para o
      // navegador sem barulho — e é justamente por isso que o fluxo antigo
      // continua inteiro logo abaixo.
      // O interruptor ANUNCIA a decisão sempre, inclusive quando está desligado.
      // Sem isto ele é mudo no caminho antigo, e "liguei e não mudou nada" fica
      // indistinguível de "esqueci de ligar" — foi exatamente o que aconteceu no
      // primeiro teste. O valor lido vai junto para desarmar a dúvida do hash
      // router (o `?montagem=` cai DENTRO do fragmento, não em `location.search`).
      const interruptor = montarNoServidor();
      console.log('[PER-DOC] montagem no servidor:',
        interruptor.noServidor ? 'LIGADA' : 'desligada',
        '— decidido por:', interruptor.origem, '|', retratoDoInterruptor());
      if (interruptor.noServidor) {
        const noServidor = await signatureService.montarDocumentoAssinadoNoServidor(
          token, unit.documentKey,
        );
        if (noServidor.estado === 'montou') {
          console.log('[PER-DOC] montado NO SERVIDOR', unit.documentKey,
            'origem do interruptor:', interruptor.origem,
            'código:', noServidor.verification_code,
            noServidor.ja_montado ? '(já existia)' : '');
          const urlDoServidor = await signatureService.getPublicFileUrl(
            token, noServidor.signed_file_path,
          );
          results.push({
            documentKey: unit.documentKey,
            displayName: unit.displayName,
            verificationCode: noServidor.verification_code || verificationCode,
            url: urlDoServidor,
          });
          if (unit.documentKey === 'main') mainSignedUrl = urlDoServidor;
          continue;
        }
        if (noServidor.estado === 'recusou') {
          console.log('[PER-DOC] servidor não monta', unit.documentKey, '—',
            noServidor.codigo, '— seguindo no navegador');
        } else {
          console.warn('[PER-DOC] montagem no servidor FALHOU para', unit.documentKey,
            '—', noServidor.motivo, '— seguindo no navegador');
        }
      }

      let filePath: string;
      let sha256: string;
      let integritySha256: string | null = null;
      let pageCount = 0;
      const cleanupHosts: HTMLElement[] = [];
      try {
        if (unit.isDocx) {
          const host = await cronometroDaAssinatura.medir('renderizar o DOCX (docx-preview)',
            () => renderDocxOffscreen(unit.sourceUrl!, 'docx-offscreen-style-per-document'));
          cleanupHosts.push(host);
          const out = await pdfSignatureService.saveSignedDocxAsPdf({
            request: currentRequest,
            signer: currentSigner,
            creator,
            docxContainer: host,
            fieldsOverride: unitFields,
            perDocument,
          });
          filePath = out.filePath; sha256 = out.sha256; integritySha256 = out.integritySha256; pageCount = out.pageCount;
        } else {
          const out = await pdfSignatureService.saveSignedPdfToStorage({
            request: currentRequest,
            signer: currentSigner,
            originalPdfUrl: unit.sourceUrl,
            creator,
            fieldsOverride: unitFields,
            perDocument,
          });
          filePath = out.filePath; sha256 = out.sha256; integritySha256 = out.integritySha256; pageCount = out.pageCount;
        }
      } finally {
        for (const el of cleanupHosts) { try { el.remove(); } catch { /* noop */ } }
      }

      // Persistência por documento (código/hash/arquivo próprios). A RPC aplica
      // last-signer-wins: cada signatário grava sua versão (que inclui todas as
      // assinaturas já existentes) e o último a assinar prevalece. Falha REAL de
      // persistência NÃO pode ser silenciosa (requisito jurídico) — coletamos
      // para lançar um erro explícito ao final.
      try {
        await cronometroDaAssinatura.medir('registrar no banco (RPC)', () =>
          signatureService.attachSignedDocumentPublic(token, {
          document_key: unit.documentKey,
          document_type: unit.documentType,
          display_name: unit.displayName,
          source_file_path: unit.sourcePath,
          signed_file_path: filePath,
          verification_code: verificationCode,
          signed_pdf_sha256: sha256,
          document_hash: integritySha256,
          page_count: pageCount,
          sort_order: unit.sortOrder,
        }));
      } catch (persistErr) {
        console.error('[PER-DOC] Persistência falhou para', unit.documentKey, persistErr);
        persistFailures.push(unit.displayName);
        continue; // tenta os demais, mas o fluxo NÃO será tratado como sucesso
      }

      const signedUrl = await signatureService.getPublicFileUrl(token, filePath);
      results.push({ documentKey: unit.documentKey, displayName: unit.displayName, verificationCode, url: signedUrl });
      if (unit.documentKey === 'main') mainSignedUrl = signedUrl;
    }

    // Falha de persistência de QUALQUER documento é erro explícito (não mascarar).
    if (persistFailures.length > 0) {
      const err = new Error(
        `Falha ao salvar o(s) documento(s) assinado(s): ${persistFailures.join(', ')}.`,
      ) as Error & { __perDocPersistFailure?: boolean };
      err.__perDocPersistFailure = true;
      throw err;
    }

    // O envelope agrupa vários documentos finais independentes. Só apresentamos os
    // artefatos finais (com seus códigos de verificação) quando TODOS os
    // signatários assinaram — antes disso os códigos/versões ainda podem mudar
    // (last-signer-wins), então mostrá-los seria enganoso.
    let envelopeComplete = false;
    try {
      const bundle = await signatureService.getPublicSigningBundle(token);
      envelopeComplete = bundle?.request?.status === 'signed';
    } catch (e) {
      console.warn('[PER-DOC] Não foi possível confirmar conclusão do envelope:', e);
    }

    if (envelopeComplete) {
      setSignedDocuments(results);
      const focusUrl = mainSignedUrl ?? results[0]?.url ?? null;
      if (focusUrl) setSignedDocumentUrl(focusUrl);
      console.log('[PER-DOC] Envelope concluído. Documentos assinados finais:', results.length);
      // O relatório de onde o tempo foi. A linha "não medido" é a que impede a
      // conclusão errada: se ela for grande, falta instrumentar, e não se deve
      // otimizar a fase que por acaso foi cronometrada.
      console.log(cronometroDaAssinatura.relatorio(
        `assinatura de ${results.length} documento(s)`));
      return focusUrl;
    }

    // Ainda faltam signatários: assinatura registrada, mas o pacote final não está
    // pronto. Não expõe códigos/versões intermediárias.
    setSignedDocuments([]);
    console.log('[PER-DOC] Assinatura registrada; aguardando demais signatários antes de finalizar o pacote.');
    return null;
  };

  const generateSignedDocumentForSigner = async (
    currentRequest: SignatureRequest,
    currentSigner: Signer,
  ): Promise<string | null> => {
    // Modelo VERSIONADO: 'per_document' gera 1 PDF por arquivo; caso contrário
    // ('consolidated'/legado/ausente) segue o fluxo consolidado abaixo, INTACTO.
    if (currentRequest.signature_model === 'per_document') {
      console.log('[PER-DOC] signature_model=per_document → geração individual por arquivo');
      return await generatePerDocumentSignedForSigner(currentRequest, currentSigner);
    }
    console.log('[ASSINATURA] signature_model=consolidated (legado) → PDF único consolidado');

    let signedPdfPath: string;
    let signedPdfSha256: string | null = null;
    let signedIntegritySha256: string | null = null;

    const attachmentPdfItems = attachments
      .map((a, i) => ({ a, i }))
      .filter((x) => x.a.url && x.a.name.toLowerCase().endsWith('.pdf'))
      .map((x) => ({ documentId: `attachment-${x.i}`, url: x.a.url }));

    let originalPdfUrlToUse = pdfUrl;
    if (!originalPdfUrlToUse && currentRequest.document_path) {
      originalPdfUrlToUse = await signatureService.getPublicFileUrl(token,currentRequest.document_path);
    }

    const docPath = currentRequest.document_path?.toLowerCase() || '';
    const isDocxFile = docPath.endsWith('.docx') || docPath.endsWith('.doc');

    if (originalPdfUrlToUse && !isDocxFile) {
      const { filePath, sha256, integritySha256 } = await pdfSignatureService.saveSignedPdfToStorage({
        request: currentRequest,
        signer: currentSigner,
        originalPdfUrl: originalPdfUrlToUse,
        creator,
        attachmentPdfItems,
        fieldsOverride: signatureFields,
      });
      signedPdfPath = filePath;
      signedPdfSha256 = sha256;
      signedIntegritySha256 = integritySha256;
    } else if (isDocxFile) {
      const cleanupHosts: HTMLElement[] = [];
      try {
        const mainDocUrl = originalPdfUrlToUse || await signatureService.getPublicFileUrl(token,currentRequest.document_path!);
        if (!mainDocUrl) throw new Error('Erro ao obter URL do documento principal');

        const mainHost = await renderDocxOffscreen(mainDocUrl, 'docx-offscreen-style-public-regenerate');
        cleanupHosts.push(mainHost);

        const attachmentDocxItems: { documentId: string; container: HTMLElement }[] = [];
        const pdfAttachmentItems: { documentId: string; url: string }[] = [];

        for (let i = 0; i < attachments.length; i++) {
          const attach = attachments[i];
          if (!attach.url) continue;
          const lower = attach.name.toLowerCase();

          if (lower.endsWith('.pdf')) {
            pdfAttachmentItems.push({ documentId: `attachment-${i}`, url: attach.url });
            continue;
          }

          if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
            const host = await renderDocxOffscreen(attach.url, 'docx-offscreen-style-public-regenerate');
            cleanupHosts.push(host);
            attachmentDocxItems.push({ documentId: `attachment-${i}`, container: host });
          }
        }

        const { filePath, sha256, integritySha256 } = await pdfSignatureService.saveSignedDocxAsPdf({
          request: currentRequest,
          signer: currentSigner,
          creator,
          docxContainer: mainHost,
          attachmentDocxItems,
          attachmentPdfItems: pdfAttachmentItems,
          fieldsOverride: signatureFields,
        });
        signedPdfPath = filePath;
        signedPdfSha256 = sha256;
        signedIntegritySha256 = integritySha256;
      } finally {
        for (const el of cleanupHosts) {
          try { el.remove(); } catch { /* noop */ }
        }
      }
    } else {
      const { filePath, sha256, integritySha256 } = await pdfSignatureService.saveSignatureReportToStorage({
        request: currentRequest,
        signer: currentSigner,
        creator,
      });
      signedPdfPath = filePath;
      signedPdfSha256 = sha256;
      signedIntegritySha256 = integritySha256;
    }

    await signatureService.attachSignedPdfPublic(token, signedPdfPath, signedPdfSha256, signedIntegritySha256);

    const signedUrl = await signatureService.getPublicFileUrl(token,signedPdfPath);
    if (signedUrl) {
      setSignedDocumentUrl(signedUrl);
      setSigner((prev) => (prev && prev.id === currentSigner.id
        ? { ...prev, signed_document_path: signedPdfPath, signed_pdf_sha256: signedPdfSha256 ?? null, integrity_sha256: signedIntegritySha256 ?? null }
        : prev));
    }
    return signedUrl;
  };

  const waitForSignedDocumentUrl = async (options?: { attempts?: number; delayMs?: number }) => {
    const attempts = options?.attempts ?? 8;
    const delayMs = options?.delayMs ?? 1500;
    let latestBundle: Awaited<ReturnType<typeof signatureService.getPublicSigningBundle>> | null = null;

    // Tenta primeiro o que já está em memória.
    if (signer?.signed_document_path) {
      const directUrl = signedDocumentUrl || (await signatureService.getPublicFileUrl(token,signer.signed_document_path));
      if (directUrl) {
        if (!signedDocumentUrl) setSignedDocumentUrl(directUrl);
        return directUrl;
      }
    }

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const data = await signatureService.getPublicSigningBundle(token);
        latestBundle = data;
        if (data?.signer) {
          setSigner(data.signer);
          setRequest(data.request);
          setWaitingFor(data.waiting_for ?? null);

          if (data.signer.signed_document_path) {
            const readyUrl = await signatureService.getPublicFileUrl(token,data.signer.signed_document_path);
            if (readyUrl) {
              setSignedDocumentUrl(readyUrl);
              return readyUrl;
            }
          }
        }
      } catch (err) {
        console.warn('[PUBLIC SIGNING] Erro ao aguardar documento assinado:', err);
      }

      if (attempt < attempts - 1) {
        await sleep(delayMs);
      }
    }

    const fallbackSigner = latestBundle?.signer ?? signer;
    const fallbackRequest = latestBundle?.request ?? request;
    if (fallbackSigner?.status === 'signed' && fallbackRequest) {
      try {
        return await generateSignedDocumentForSigner(fallbackRequest, fallbackSigner);
      } catch (err) {
        console.error('[PUBLIC SIGNING] Falha ao regenerar documento assinado:', err);
      }
    }

    return null;
  };

  // Abre o PDF assinado num visualizador interno (iframe), sem expor a URL do
  // Supabase: busca o arquivo e exibe via blob: — o link assinado nunca vai
  // para o DOM/barra de endereços. Fallback: usa a própria URL se o fetch falhar.
  const openSignedDocumentViewer = async (setLoading: (b: boolean) => void) => {
    if (!request || !signer) return;
    try {
      setLoading(true);
      const url = await waitForSignedDocumentUrl();
      if (!url) {
        toast.error('O documento foi assinado, mas ainda está sendo finalizado. Tente novamente em alguns segundos.');
        return;
      }
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        setSignedViewerUrl(URL.createObjectURL(blob));
      } catch {
        setSignedViewerUrl(url);
      }
    } catch (e) {
      console.error('Erro ao abrir documento assinado:', e);
      toast.error('Erro ao abrir documento assinado');
    } finally {
      setLoading(false);
    }
  };

  // Abre uma URL de documento assinado no visualizador interno (iframe) via blob:,
  // sem expor a URL do Supabase. Usado pelos documentos individuais do envelope.
  const openUrlInSignedViewer = async (url: string | null | undefined) => {
    if (!url) {
      toast.error('Documento indisponível no momento. Tente novamente em alguns segundos.');
      return;
    }
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      setSignedViewerUrl(URL.createObjectURL(blob));
    } catch {
      setSignedViewerUrl(url);
    }
  };

  const loadEnvelopeSignedDocuments = async (currentRequest: SignatureRequest): Promise<
    { documentKey: string; displayName: string; verificationCode: string; url: string | null }[]
  > => {
    if (currentRequest.signature_model !== 'per_document') return [];

    const docs = await signatureService.getPublicRequestDocuments(token);
    const resolved = await Promise.all(
      docs.map(async (doc: SignatureRequestDocument) => ({
        documentKey: doc.document_key,
        displayName: doc.display_name?.trim() || 'Documento assinado',
        verificationCode: doc.verification_code?.trim() || '',
        url: doc.signed_file_path
          ? await signatureService.getPublicFileUrl(token, doc.signed_file_path)
          : null,
        sortOrder: doc.sort_order ?? 0,
      })),
    );

    return resolved
      .filter((doc) => doc.verificationCode)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(({ sortOrder: _sortOrder, ...doc }) => doc);
  };

  const getEnvelopeDisplayCode = (currentRequest: SignatureRequest | null, currentSigner: Signer | null) => {
    if (currentRequest?.signature_model === 'per_document') {
      // Protocolo do envelope = o mesmo valor carimbado no rodapé do PDF assinado
      // (pdfSignature.service usa `protocol: request.id`) e aceito pela verificação
      // pública (public_verify_by_hash, ramo do UUID). O `id` está sempre presente
      // no bundle carregado na abertura da página; o `envelope_verification_code`
      // curto só é gerado na finalização, então serve apenas como alias/fallback.
      return (currentRequest.id || currentRequest.envelope_verification_code || '').trim();
    }
    return (currentSigner?.verification_hash || '').trim();
  };

  const getShareableSignedDocuments = async (currentRequest: SignatureRequest, currentSigner: Signer) => {
    if (currentRequest.signature_model === 'per_document') {
      const docs = signedDocuments.length > 0 ? signedDocuments : await loadEnvelopeSignedDocuments(currentRequest);
      if (signedDocuments.length === 0 && docs.length > 0) {
        setSignedDocuments(docs);
      }
      return docs.filter((doc) => !!doc.url);
    }

    const url = await waitForSignedDocumentUrl();
    if (!url) return [];

    const baseName = (currentRequest.document_name || 'documento_assinado')
      .replace(/\.[^/.]+$/, '')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
      .trim()
      .slice(0, 80);

    return [{
      documentKey: 'main',
      displayName: `${baseName || 'documento_assinado'}.pdf`,
      verificationCode: currentSigner.verification_hash?.trim() || '',
      url,
    }];
  };

  const handleShareSignedDocuments = async (currentRequest: SignatureRequest, currentSigner: Signer) => {
    try {
      setSharing(true);
      const docs = await getShareableSignedDocuments(currentRequest, currentSigner);
      if (docs.length === 0) {
        toast.error('Os documentos assinados ainda estão sendo finalizados.');
        return;
      }

      const shareTitle = currentRequest.signature_model === 'per_document'
        ? 'Documentos assinados'
        : 'Documento assinado';
      const shareText = currentRequest.signature_model === 'per_document'
        ? `Envelope assinado: "${currentRequest.document_name}"`
        : `Documento assinado: "${currentRequest.document_name}"`;

      if (typeof navigator.share === 'function') {
        try {
          const files = await Promise.all(
            docs.map(async (doc, index) => {
              const response = await fetch(doc.url!);
              if (!response.ok) {
                throw new Error(`Falha ao baixar PDF: ${response.status}`);
              }
              const blob = await response.blob();
              const safeBaseName = (doc.displayName || `documento_${index + 1}`)
                .replace(/\.[^/.]+$/, '')
                .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
                .trim()
                .slice(0, 80);
              const fileName = `${safeBaseName || `documento_${index + 1}`}.pdf`;
              return new File([blob], fileName, { type: blob.type || 'application/pdf' });
            }),
          );

          const canShareFiles =
            files.length > 0 &&
            typeof (navigator as any).canShare === 'function' &&
            (navigator as any).canShare({ files });

          if (canShareFiles) {
            await navigator.share({
              title: shareTitle,
              text: shareText,
              files,
            } as any);
            return;
          }
        } catch (e) {
          console.log('Falha ao compartilhar arquivos, usando links como fallback:', e);
        }

        await navigator.share({
          title: shareTitle,
          text: `${shareText}\n\n${docs.map((doc) => `${doc.displayName}: ${doc.url}`).join('\n')}`,
        });
        return;
      }

      await copiarLinksDosDocumentos(docs);
    } catch (e: any) {
      // Cancelar a folha de compartilhamento é uma decisão, não um erro.
      if (e?.name === 'AbortError') return;
      console.warn('Compartilhamento falhou; caindo para os links:', e);
      // NUNCA terminar em silêncio. Era o que acontecia: `navigator.share`
      // existe no desktop, mas quando o clique já perdeu o gesto do usuário
      // (este caminho faz três `await` antes de chamá-lo) ele recusa com
      // NotAllowedError — e o `catch` engolia tudo num `console.log`. Para
      // quem apertava, o botão simplesmente não fazia nada.
      try {
        const docs = await getShareableSignedDocuments(currentRequest, currentSigner);
        if (docs.length > 0) { await copiarLinksDosDocumentos(docs); return; }
      } catch { /* segue para o aviso */ }
      toast.error('Não foi possível compartilhar', 'Use "Abrir documento assinado" e compartilhe pelo seu aparelho.');
    } finally {
      setSharing(false);
    }
  };

  /** Plano B universal do compartilhamento: os links na área de transferência. */
  const copiarLinksDosDocumentos = async (
    docs: { displayName: string; url?: string | null }[],
  ) => {
    const texto = docs.map((doc) => `${doc.displayName}: ${doc.url}`).join('\n');
    await navigator.clipboard.writeText(texto);
    toast.success(docs.length > 1 ? 'Links dos documentos copiados.' : 'Link do documento assinado copiado.');
  };

  const closeSignedViewer = () => {
    setSignedViewerUrl((prev) => {
      if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
      return null;
    });
  };

  useEffect(() => () => {
    if (signedViewerUrl && signedViewerUrl.startsWith('blob:')) URL.revokeObjectURL(signedViewerUrl);
  }, [signedViewerUrl]);

  // Modal do visualizador — compartilhado entre as telas "já assinado" e "sucesso".
  const signedDocViewer = signedViewerUrl ? (
    <div
      className="fixed inset-0 z-[100] flex h-[100dvh] min-w-0 flex-col bg-slate-900/70 backdrop-blur-sm"
      onClick={closeSignedViewer}
    >
      <div
        className="flex min-w-0 shrink-0 items-center justify-between gap-3 bg-slate-900 px-3 pb-3 text-white sm:px-6 sm:py-3"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-orange-400 shrink-0" />
          <span className="text-sm font-medium truncate">{request?.document_name || 'Documento assinado'}</span>
        </div>
        <button
          onClick={closeSignedViewer}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-white/20"
        >
          <X className="w-4 h-4" />
          Fechar
        </button>
      </div>
      <iframe
        title="Documento assinado"
        src={signedViewerUrl}
        className="min-h-0 w-full flex-1 bg-white"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  ) : null;

  const loadSignerData = async () => {
    try {
      setStep('loading');
      setAttachmentManifestReady(false);
      const data = await signatureService.getPublicSigningBundle(token);
      
      if (!data) {
        setError('Link de assinatura inválido ou expirado.');
        setStep('error');
        return;
      }

      setSigner(data.signer);
      setRequest(data.request);
      setWaitingFor(data.waiting_for ?? null);
      setSignatureFields(data.fields ?? []);
      if (data.auth_config) {
        setAuthConfig({
          google: !!data.auth_config.google,
          email: !!data.auth_config.email,
          phone: !!data.auth_config.phone,
          whatsapp: !!data.auth_config.whatsapp,
        });
      } else {
        setAuthConfig({ google: true, email: true, phone: true, whatsapp: false });
      }
      setAllowSkipSignerDataStep(isTemplateFillSigner((data.signer as any)?.email ?? null));
      // Restaura rascunho salvo (refresh no meio do fluxo, validade de 24h) —
      // dados do formulário têm prioridade sobre os valores pré-preenchidos.
      // Identidade (OTP) e selfie NÃO são restauradas: refeitas a cada sessão.
      const draft = data.signer.status !== 'signed' ? readSigningDraft(signingDraftKey) : null;
      setSignerData(draft?.signerData ?? {
        name: data.signer.name || '',
        cpf: formatCpf(data.signer.cpf || ''),
        phone: data.signer.phone || '',
      });
      if (draft?.signatureData) {
        setSignatureData(draft.signatureData);
        setHasSignature(true);
      }
      if (draft?.locationData) setLocationData(draft.locationData);
      draftLoadedRef.current = true;
      if (data.creator) setCreator(data.creator);

      // O acesso já foi confirmado. Liberar o render principal agora impede
      // que downloads auxiliares mantenham o iPhone preso na tela de abertura.
      if (data.signer.status !== 'signed') {
        setStep('success');
        void registrarVisualizacao(token, data.signer.id);
      }

      // Tentar carregar preview do documento principal
      if (data.request.document_path) {
        try {
          // Verificar se é DOCX
          const docPath = data.request.document_path.toLowerCase();
          const isDocxFile = docPath.endsWith('.docx') || docPath.endsWith('.doc');
          setIsDocx(isDocxFile);

          const url = await signatureService.getPublicFileUrl(token,data.request.document_path);

          if (url) {
            setPdfUrl(url);
            // O documento chegou ao navegador do signatário: este é o degrau
            // "documento apresentado", que em 236 assinaturas nunca havia sido
            // gravado uma única vez.
            void signatureService.marcarEtapaDaAssinatura(token, 'documento');
          }
        } catch (e) {
          console.warn('Não foi possível carregar preview do documento:', e);
        }
      }
      
      // Carregar documentos anexos
      if (data.request.attachment_paths && data.request.attachment_paths.length > 0) {
        const attachPaths = data.request.attachment_paths;

        const results = await Promise.all(
          attachPaths.map(async (attachPath) => {
            try {
              const attachUrl = await signatureService.getPublicFileUrl(token,attachPath);
              if (!attachUrl) return null;
              const fileName = attachPath.split('/').pop() || 'Anexo';
              const lower = fileName.toLowerCase();
              const isDocxFile = lower.endsWith('.docx') || lower.endsWith('.doc');
              return {
                name: fileName,
                url: attachUrl,
                rendered: false,
                prefetched: false,
                isDocx: isDocxFile,
              };
            } catch (e) {
              console.warn('Erro ao carregar anexo:', attachPath, e);
              return null;
            }
          })
        );

        const loadedAttachments = results.filter(Boolean) as { name: string; url: string; rendered?: boolean; prefetched?: boolean; isDocx?: boolean }[];
        setAttachments(loadedAttachments);
      } else {
        setAttachments([]);
      }
      setAttachmentManifestReady(true);

      if (data.request.signature_model === 'per_document' && data.signer.status === 'signed') {
        try {
          const docs = await loadEnvelopeSignedDocuments(data.request);
          setSignedDocuments(docs);
          const primaryDoc = docs.find((doc) => doc.documentKey === 'main') ?? docs[0] ?? null;
          if (primaryDoc?.url) {
            setSignedDocumentUrl(primaryDoc.url);
          }
        } catch (e) {
          console.warn('[PER-DOC] NÃ£o foi possÃ­vel carregar documentos finais do envelope:', e);
          setSignedDocuments([]);
        }
      } else {
        setSignedDocuments([]);
      }

      if (data.signer.status === 'signed') {
        setStep('already_signed');
      }
    } catch (e: any) {
      console.error('Erro ao carregar dados do signatário:', e);
      setError(e?.message || 'Erro ao carregar dados do signatário.');
      setStep('error');
    }
  };

  /** Quantos caminhos de autenticação o escritório deixou ligados. */
  const contarMetodos = (cfg: PublicAuthConfig): number =>
    [cfg.google, cfg.email, cfg.whatsapp, cfg.phone].filter(Boolean).length;

  /**
   * A etapa `google_auth` é também A ESCOLHA: é ela que desenha os botões de
   * todos os métodos. Por isso ela continua valendo com o Google DESLIGADO,
   * desde que exista mais de um caminho — sem isso, quem entra por WhatsApp
   * nunca consegue voltar e tentar por e-mail. Com um método só, a escolha não
   * tem o que escolher e o fluxo vai direto para ele.
   */
  /**
   * A SAÍDA — mostrada assim que um código é recusado.
   *
   * O caminho de verificação escolhido pode simplesmente não funcionar para
   * aquela pessoa naquele momento: o SMS não chega, o WhatsApp está em outro
   * aparelho, o e-mail caiu no spam. Sem uma saída visível, a tela vira um muro
   * e a assinatura não acontece — que é o pior desfecho possível aqui, pior do
   * que qualquer atrito. Ela aparece só depois do primeiro erro para não poluir
   * quem está indo bem, e nunca oferece o método que a pessoa já está tentando.
   */
  const SaidaPorOutroCaminho = ({ atual }: { atual: 'phone' | 'email' }) => {
    const opcoes: { rotulo: string; ir: () => void }[] = [];
    if (authConfig.google) opcoes.push({ rotulo: 'Google', ir: () => setModalStep('google_auth') });
    if (authConfig.email && atual !== 'email') opcoes.push({ rotulo: 'E-mail', ir: () => setModalStep('email_otp') });
    if (authConfig.whatsapp && !(atual === 'phone' && phoneOtpChannel === 'whatsapp')) {
      opcoes.push({
        rotulo: 'WhatsApp',
        ir: () => { setPhoneOtpSent(false); setPhoneOtpChannel('whatsapp'); setModalStep('phone_otp'); },
      });
    }
    if (authConfig.phone && !(atual === 'phone' && phoneOtpChannel === 'sms')) {
      opcoes.push({
        rotulo: 'SMS',
        ir: () => { setPhoneOtpSent(false); setPhoneOtpChannel('sms'); setModalStep('phone_otp'); },
      });
    }
    if (opcoes.length === 0) return null;

    return (
      <div className="rounded-xl border border-[#e7e5df] bg-white/70 p-3 text-center">
        <p className="text-xs text-slate-500">Não está recebendo o código? Confirme de outro jeito:</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {opcoes.map((o) => (
            <button
              key={o.rotulo}
              type="button"
              onClick={o.ir}
              className="rounded-lg border border-[#e7e5df] bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              {o.rotulo}
            </button>
          ))}
        </div>
      </div>
    );
  };

  /**
   * Máscara de telefone brasileiro, aplicada ENQUANTO se digita.
   *
   * O campo guardava e mostrava os dígitos colados ("65984046375"). Onze
   * dígitos sem separação é justamente o formato que ninguém confere de
   * relance — e este é o número que vai receber o código e, depois, constar do
   * relatório como o telefone confirmado. O `handleSendPhoneOtp` continua
   * mandando só os dígitos: a máscara é da tela, não do dado.
   */
  const formatarTelefoneBR = (valor: string): string => {
    const d = valor.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '').slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  };

  /** "2:05" — a contagem que fica no lugar do rótulo do botão de reenvio. */
  const contagemRegressiva = (segundos: number): string =>
    `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`;

  /**
   * O e-mail que JÁ ESTÁ na ficha do signatário.
   *
   * Era o buraco do fluxo: a tela de identidade anunciava "Código para
   * c···b@dvqlb.com", a pessoa clicava, e o campo da etapa seguinte abria
   * VAZIO — porque `emailToVerify` nascia como string vazia e nunca era
   * semeado, ao contrário do telefone (que vinha de `signerData.phone`). Quem
   * não lembrava o próprio endereço de cadastro ficava travado numa tela que
   * acabara de mostrar o endereço.
   *
   * O endereço sintético do kit de preenchimento (`public+…@crm.local`) não
   * conta: ninguém lê aquela caixa, e oferecê-lo mandaria o código para o vazio.
   */
  const emailDoCadastro = ((): string => {
    const e = (signer?.email || '').trim();
    return !e || isTemplateFillSigner(e) ? '' : e;
  })();

  /** O telefone que já está na ficha (ou o que a pessoa digitou nesta sessão). */
  const telefoneDoCadastro = ((): string => {
    const bruto = (signerData.phone || signer?.phone || '').replace(/\D/g, '');
    return bruto.length >= 10 ? bruto : '';
  })();

  /**
   * Atalho da tela de identidade: com o contato já conhecido, o clique no
   * método MANDA O CÓDIGO e cai direto na tela de digitar.
   *
   * Conferir um telefone que o próprio sistema acabou de exibir é uma etapa que
   * não decide nada. A tela de coleta continua existindo — ela é o caminho de
   * quem não tem contato na ficha, e também o destino quando o envio falha
   * (o erro aparece ali, com o campo para corrigir).
   */
  const jaPodeEnviarCodigo = (canal: 'sms' | 'whatsapp' | 'email'): boolean => {
    if (canal === 'email') return !!emailDoCadastro && !emailOtpSent && emailOtpResendIn <= 0;
    return !!telefoneDoCadastro && !phoneOtpSent && phoneOtpResendIn <= 0;
  };

  const getFirstAuthStep = (cfg: PublicAuthConfig): ModalStep => {
    if (cfg.google) return 'google_auth';
    if (contarMetodos(cfg) > 1) return 'google_auth';
    if (cfg.email) return 'email_otp';
    if (cfg.whatsapp || cfg.phone) return 'phone_otp';
    return 'data';
  };

  useEffect(() => {
    if (!isSignModalOpen) return;

    const authStepDisabled =
      (modalStep === 'google_auth' && !authConfig.google && contarMetodos(authConfig) < 2) ||
      (modalStep === 'email_otp' && !authConfig.email) ||
      (modalStep === 'phone_otp' && !authConfig.phone && !authConfig.whatsapp);

    if (!authStepDisabled) return;
    setModalStep(getFirstAuthStep(authConfig));
  }, [isSignModalOpen, modalStep, authConfig]);

  // Canal padrão do código por telefone: quando só o WhatsApp está ligado, a
  // etapa precisa nascer nele — senão a tela pede SMS por um caminho que o
  // servidor vai recusar.
  useEffect(() => {
    if (authConfig.whatsapp && !authConfig.phone) setPhoneOtpChannel('whatsapp');
    else if (!authConfig.whatsapp && authConfig.phone) setPhoneOtpChannel('sms');
  }, [authConfig.whatsapp, authConfig.phone]);

  useEffect(() => {
    if (!signer?.id || signer.status !== 'pending') return;

    let cancelled = false;
    let intervalId: number | null = null;

    const touch = async () => {
      if (cancelled) return;
      await signatureService.heartbeatSignerPresence(token);
    };

    const start = () => {
      if (intervalId !== null) return;
      void touch();
      intervalId = window.setInterval(() => {
        if (document.visibilityState === 'visible') void touch();
      }, 10000);
    };

    const stop = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') start();
      else stop();
    };

    if (!presenceStartedRef.current) {
      presenceStartedRef.current = true;
      if (document.visibilityState === 'visible') start();
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      presenceStartedRef.current = false;
    };
  }, [signer?.id, signer?.status]);

  /**
   * Dimensiona o canvas pelo tamanho REAL que ele ocupa na tela.
   *
   * O traço saía longe do dedo porque o desenho era feito em pixels de CSS sob
   * um `ctx.scale(2, 2)` fixo: isso só fecha a conta enquanto o canvas tiver
   * exatamente o tamanho que tinha no instante da medição. Qualquer mudança
   * depois — barra de rolagem que aparece, rotação, teclado do celular subindo —
   * separava o ponto tocado do ponto desenhado. E `ctx.scale` é MULTIPLICATIVO:
   * uma segunda chamada sem reset dobraria a escala de novo.
   *
   * Agora o contexto desenha em pixels do buffer (transform identidade, posto de
   * forma absoluta) e as coordenadas são convertidas ao vivo em getCoordinates.
   * Não existe mais acoplamento entre o momento da medição e o do traço.
   */
  const initCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2.5 * dpr;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  /** Redesenha no canvas recém-dimensionado o traço que já existia. */
  const redesenharAssinatura = (dataUrl: string) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.src = dataUrl;
  };

  /**
   * Converte o ponto tocado para o sistema de coordenadas em que o contexto
   * desenha. A razão buffer÷CSS é medida NESTE instante — é ela que garante
   * que o traço nasça exatamente sob o dedo, mesmo que a caixa tenha mudado de
   * tamanho desde que o canvas foi dimensionado.
   */
  const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };

    const ponto = 'touches' in e ? (e.touches[0] ?? e.changedTouches[0]) : e;
    if (!ponto) return { x: 0, y: 0 };

    return {
      x: (ponto.clientX - rect.left) * (canvas.width / rect.width),
      y: (ponto.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    setIsDrawing(true);
    const { x, y } = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCoordinates(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasSignature(true);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    saveSignature();
  };

  const saveSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasSignature) return;
    setSignatureData(canvas.toDataURL('image/png'));
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
    setSignatureData(null);
  };

  // ========== CAMERA ==========
  const startCamera = async () => {
    try {
      setCameraError(null);
      stopCamera();
      // Retrato, como a foto de um celular. `ideal` (e não `exact`) porque
      // webcam de notebook só entrega paisagem: nesses casos o navegador
      // devolve o que tem e o recorte em capturePhoto endireita a imagem.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1080 },
          height: { ideal: 1440 },
          aspectRatio: { ideal: FOTO_PROPORCAO },
        },
      });
      cameraStreamRef.current = stream;
      setCameraActive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err: any) {
      console.error('Erro ao acessar câmera:', err);
      setCameraError('Não foi possível acessar a câmera. Verifique as permissões.');
      cameraStreamRef.current = null;
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  const validateFacialPhotoWithAI = async (imageBase64: string): Promise<FacialAIValidationResult | null> => {
    try {
      setFacialValidating(true);
      const { data, error } = await supabase.functions.invoke('analyze-facial-photo', {
        body: { token, imageBase64 },
      });

      if (error) {
        console.error('Erro ao validar selfie:', error);
        return null;
      }

      return data as FacialAIValidationResult;
    } catch (err) {
      console.error('Erro ao validar selfie:', err);
      return null;
    } finally {
      setFacialValidating(false);
    }
  };

  const capturePhoto = async () => {
    const video = videoRef.current;
    if (!video) return;

    const larguraVideo = video.videoWidth;
    const alturaVideo = video.videoHeight;
    if (!larguraVideo || !alturaVideo) return;

    // A foto gravada no certificado é sempre RETRATO. Antes ela saía com o
    // formato cru da câmera — 4:3 deitado na webcam do notebook —, e o que a
    // pessoa via no visor não era o que ficava guardado. Recortamos o centro
    // na proporção de celular, o mesmo recorte que o `object-cover` do visor
    // já mostra, então a prévia e o arquivo passam a coincidir.
    let larguraCorte = larguraVideo;
    let alturaCorte = alturaVideo;
    if (larguraVideo / alturaVideo > FOTO_PROPORCAO) {
      larguraCorte = Math.round(alturaVideo * FOTO_PROPORCAO); // sobra nas laterais
    } else {
      alturaCorte = Math.round(larguraVideo / FOTO_PROPORCAO); // sobra em cima e embaixo
    }
    const origemX = Math.round((larguraVideo - larguraCorte) / 2);
    const origemY = Math.round((alturaVideo - alturaCorte) / 2);

    const canvas = document.createElement('canvas');
    canvas.width = larguraCorte;
    canvas.height = alturaCorte;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(
      video,
      origemX, origemY, larguraCorte, alturaCorte,
      0, 0, larguraCorte, alturaCorte,
    );
    // ── CARIMBO OBRIGATÓRIO: data, hora, finalidade e protocolo ──────────────
    //
    // Vai DENTRO dos pixels, não em metadado: metadado se perde ao recortar,
    // reexportar ou imprimir, e uma foto de rosto solta, sem contexto, é a
    // pior evidência possível — não diz quando foi tirada nem para quê, e
    // qualquer um pode alegar que veio de outro lugar.
    //
    // Com o protocolo gravado na imagem, a foto deixa de ser uma selfie avulsa
    // e passa a apontar para o envelope que ela prova, fechando a cadeia de
    // custódia mesmo que o arquivo circule sozinho.
    // A CÓPIA QUE A IA VÊ SAI DAQUI — antes do carimbo.
    //
    // O carimbo é uma faixa escura que cobre ~10% da altura da foto. Ele existe
    // para o arquivo guardado (cadeia de custódia) e não tem função nenhuma na
    // análise; do lado do modelo ele é só uma tarja preta ocupando parte de uma
    // imagem que já chega reduzida. Guardar a foto carimbada e ANALISAR a
    // limpa custa uma linha e devolve ao modelo os pixels que interessam.
    const paraAnalise = canvas.toDataURL('image/jpeg', 0.9);

    const capturadaEm = agoraDoServidor();
    desenharCarimboDaEvidencia(ctx, canvas.width, canvas.height, {
      quando: capturadaEm,
      finalidade: 'Verificacao de identidade para assinatura eletronica',
      protocolo: request?.id || '',
    });

    const imageData = canvas.toDataURL('image/jpeg', 0.85);
    setFacialValidation(null);
    setFacialData(imageData);
    facialCapturedAtRef.current = capturadaEm.toISOString(); // instante real da selfie
    void signatureService.marcarEtapaDaAssinatura(token, 'selfie');
    stopCamera();

    const result = await validateFacialPhotoWithAI(paraAnalise);
    if (result) {
      setFacialValidation(result);
    }
  };

  const retakePhoto = () => {
    setFacialData(null);
    setFacialValidation(null);
  };

  // ========== LOCATION ==========
  const requestLocation = () => {
    setLocationLoading(true);
    setLocationError(null);

    if (!navigator.geolocation) {
      setLocationError('Geolocalização não suportada pelo navegador.');
      setLocationLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocationData({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        geolocationCapturedAtRef.current = agoraDoServidor().toISOString(); // instante real, no relógio do servidor
        void signatureService.marcarEtapaDaAssinatura(token, 'localizacao');
        setLocationLoading(false);
        setModalStep('facial');
      },
      (error) => {
        console.error('Erro ao obter localização:', error);
        setLocationError('Não foi possível obter sua localização. Verifique as permissões.');
        setLocationLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const skipLocation = () => {
    setModalStep('facial');
  };

  // ========== SUBMIT ==========
  const handleSign = async () => {
    if (!signer || !signatureData) return;
    if (!termsAccepted) {
      toast.error('É necessário aceitar os Termos de Uso para assinar.');
      return;
    }

    const expectedPerDocumentCount = 1 + attachments.length;

    try {
      setLoading(true);
      
      // Capturar IP e User Agent
      const userAgent = navigator.userAgent;
      let ipAddress: string | undefined;
      try {
        const ipResponse = await fetch('https://api.ipify.org?format=json');
        const ipData = await ipResponse.json();
        ipAddress = ipData.ip;
      } catch (e) {
        console.warn('Não foi possível capturar IP:', e);
      }

      const payload: SignDocumentDTO = {
        signature_image: signatureData,
        facial_image: facialData || undefined,
        geolocation: locationData ? `${locationData.lat}, ${locationData.lng}` : undefined,
        signer_name: signerData.name || undefined,
        signer_cpf: signerData.cpf || undefined,
        signer_phone: signerData.phone || undefined,
        // Dados de autenticação
        auth_provider: googleUser ? 'google' : (emailOtpVerified ? 'email_link' : 'phone'),
        auth_email: googleUser?.email || (emailOtpVerified ? (verifiedEmail || emailToVerify || undefined) : undefined),
        auth_google_sub: googleUser?.sub || undefined,
        auth_google_picture: googleUser?.picture || undefined,
        // O token CRU vai junto: o servidor pergunta ao Google se ele é válido
        // e se foi emitido para este aplicativo antes de escrever "autenticado
        // por conta Google" no dossiê. Sem isso, quem afirma é o navegador.
        auth_google_credential: googleUser?.idToken || undefined,
        auth_google_access_token: googleUser?.accessToken || undefined,
        // Aceite dos Termos de Uso (LGPD)
        terms_accepted: true,
        terms_version: SIGNATURE_TERMS_VERSION,
        // Instante REAL do aceite (relógio do servidor), não o do envio.
        terms_accepted_at: termsAcceptedAtRef.current || undefined,
        // Instantes REAIS das etapas probatórias (servidor clampa a [viewed_at, now()])
        auth_at: authAtRef.current || undefined,
        facial_captured_at: facialData ? (facialCapturedAtRef.current || undefined) : undefined,
        geolocation_captured_at: locationData ? (geolocationCapturedAtRef.current || undefined) : undefined,
      };

      // Usar signDocumentPublic (Edge Function) para evitar erros de RLS em página pública
      const result = await signatureService.signDocumentPublic(
        token, 
        payload,
        ipAddress,
        userAgent
      );
      
      // Gerar e salvar o PDF COMPILADO no storage
      // Inclui: documento principal + anexos PDF + relatório com selfie no final
      if (request) {
        try {
          if (request.signature_model === 'per_document') {
            const interruptor = montarNoServidor();
            if (interruptor.noServidor) {
              // A assinatura já criou um job DURÁVEL no banco. A página espera
              // apenas uma janela curta para conseguir mostrar os PDFs prontos;
              // fechar a aba daqui em diante não interrompe nem perde o trabalho.
              console.log('[PER-DOC] montagem do envelope entregue ao servidor');
              const assembly = await signatureService.waitForAssemblyPublic(token, {
                timeoutMs: 20_000,
              });

              if (assembly.finished) {
                const latest = await signatureService.getPublicSigningBundle(token).catch(() => null);
                if (latest?.request) setRequest(latest.request);
                if (latest?.request?.status === 'signed') {
                  const docs = await loadEnvelopeSignedDocuments(latest.request);
                  setSignedDocuments(docs);
                  const main = docs.find((doc) => doc.documentKey === 'main') ?? docs[0];
                  if (main?.url) setSignedDocumentUrl(main.url);
                }
              } else if (assembly.failed || assembly.status === 'none') {
                // Compatibilidade com envelope antigo que ainda contém DOCX com
                // coordenada manual da paginação do navegador. É o único caso em
                // que o servidor recusa de forma permanente; o fluxo anterior
                // continua como salvaguarda enquanto esses envelopes existirem.
                console.warn('[PER-DOC] servidor não pode concluir este envelope; usando compatibilidade local:',
                  assembly.error ?? assembly.status);
                await generatePerDocumentSignedForSigner(request, result);
                await signatureService.finalizePerDocumentSigningPublic(token, {
                  expectedDocumentCount: expectedPerDocumentCount,
                  origin: window.location.origin,
                  ipAddress,
                  userAgent,
                });
              } else {
                toast.success('Assinatura registrada. Os documentos continuarão sendo finalizados no servidor; você já pode fechar esta página.');
              }
            } else {
              // Rollback explícito pelo feature flag: mantém o caminho anterior.
              console.log('[PER-DOC] montagem server-side desligada; usando fluxo local');
              await generatePerDocumentSignedForSigner(request, result);
              const finalizeRes = await signatureService.finalizePerDocumentSigningPublic(token, {
                expectedDocumentCount: expectedPerDocumentCount,
                origin: window.location.origin,
                ipAddress,
                userAgent,
              });
              if (finalizeRes && finalizeRes.finalized !== true && !finalizeRes.reason) {
                const waited = await signatureService.waitForFinalizationPublic(token, { timeoutMs: 30000 });
                if (waited.failed) {
                  throw new Error(waited.error || 'Falha na finalização do envelope no servidor.');
                }
              }
            }
          } else {
          let signedPdfPath: string;
          let signedPdfSha256: string | null = null;
          let signedIntegritySha256: string | null = null;

          // Coletar URLs dos anexos PDF para compilar
          const attachmentPdfItems = attachments
            .map((a, i) => ({ a, i }))
            .filter((x) => x.a.url && x.a.name.toLowerCase().endsWith('.pdf'))
            .map((x) => ({ documentId: `attachment-${x.i}`, url: x.a.url }));
          
          // Tentar obter URL do documento original se não tiver
          let originalPdfUrlToUse = pdfUrl;
          if (!originalPdfUrlToUse && request.document_path) {
            try {
              originalPdfUrlToUse = await signatureService.getPublicFileUrl(token,request.document_path);
              console.log('[ASSINATURA] URL do documento obtida:', originalPdfUrlToUse ? 'OK' : 'FALHOU');
            } catch (e) {
              console.warn('[ASSINATURA] Erro ao obter URL do documento:', e);
            }
          }
          
          // Verificar se é DOCX pelo path
          const docPath = request.document_path?.toLowerCase() || '';
          const isDocxFile = docPath.endsWith('.docx') || docPath.endsWith('.doc');
          
          if (originalPdfUrlToUse && !isDocxFile) {
            // Documento original é PDF - gerar PDF completo (documento + anexos + relatório)
            const { filePath, sha256, integritySha256 } = await pdfSignatureService.saveSignedPdfToStorage({
              request,
              signer: result,
              originalPdfUrl: originalPdfUrlToUse,
              creator,
              attachmentPdfItems,
              fieldsOverride: signatureFields,
            });
            signedPdfPath = filePath;
            signedPdfSha256 = sha256;
            signedIntegritySha256 = integritySha256;
          } else if (isDocxFile) {
            // Documento original é DOCX - renderizar offscreen e converter para PDF
            console.log('[ASSINATURA] Convertendo DOCX para PDF (offscreen)...');

            const ensureOffscreenDocxStyle = () => {
              const styleId = 'docx-offscreen-style-public';
              if (document.getElementById(styleId)) return;
              const style = document.createElement('style');
              style.id = styleId;
              style.textContent = `
                .docx-wrapper {
                  background: #ffffff !important;
                  padding: 0 !important;
                }
                .docx-wrapper > section,
                .docx-wrapper article,
                .docx-wrapper .docx {
                  width: 794px !important;
                  min-width: 794px !important;
                  max-width: 794px !important;
                  background: #ffffff !important;
                }
                /* Impede o docx-preview de quebrar palavras no meio (overflow-wrap:
                   break-word / hyphens: auto). Sem isso, html2canvas parte palavras
                   como "Trabalhista" → "Trabal" + "hista" no PDF gerado. */
                .docx-wrapper,
                .docx-wrapper *,
                .docx-wrapper p,
                .docx-wrapper span {
                  overflow-wrap: normal !important;
                  word-wrap: normal !important;
                  word-break: normal !important;
                  hyphens: none !important;
                  -webkit-hyphens: none !important;
                }
              `;
              document.head.appendChild(style);
            };

            const renderDocxOffscreen = async (docxUrl: string) => {
              ensureOffscreenDocxStyle();
              const res = await fetch(docxUrl);
              if (!res.ok) throw new Error(`Falha ao baixar DOCX: HTTP ${res.status}`);
              const blob = await res.blob();

              const host = document.createElement('div');
              host.style.position = 'fixed';
              host.style.left = '-100000px';
              host.style.top = '0';
              host.style.width = '794px';
              host.style.background = '#ffffff';
              host.style.zIndex = '-1';
              host.style.pointerEvents = 'none';
              document.body.appendChild(host);

              await renderAsync(blob, host, undefined, {
                className: 'docx-wrapper',
                inWrapper: true,
                ignoreWidth: false,
                ignoreHeight: false,
                breakPages: true,
                renderHeaders: true,
                renderFooters: true,
                renderFootnotes: true,
              });

              // Aguardar renderização completa
              await new Promise(r => setTimeout(r, 500));
              console.log('[ASSINATURA] DOCX renderizado, innerHTML length:', host.innerHTML.length);

              return host;
            };

            const cleanupHosts: HTMLElement[] = [];
            try {
              const mainDocUrl = originalPdfUrlToUse || await signatureService.getPublicFileUrl(token,request.document_path!);
              if (!mainDocUrl) throw new Error('Erro ao obter URL do documento principal');
              console.log('[ASSINATURA] URL do documento principal:', mainDocUrl);

              const mainHost = await renderDocxOffscreen(mainDocUrl);
              cleanupHosts.push(mainHost);
              console.log('[ASSINATURA] Documento principal renderizado offscreen');

              const attachmentDocxItems: { documentId: string; container: HTMLElement }[] = [];
              const pdfAttachmentItems: { documentId: string; url: string }[] = [];

              console.log('[ASSINATURA] Total de anexos:', attachments.length);
              for (let i = 0; i < attachments.length; i++) {
                const attach = attachments[i];
                console.log('[ASSINATURA] Anexo', i, ':', attach.name, 'URL:', attach.url ? 'OK' : 'MISSING');
                if (!attach.url) continue;
                const lower = attach.name.toLowerCase();

                if (lower.endsWith('.pdf')) {
                  pdfAttachmentItems.push({ documentId: `attachment-${i}`, url: attach.url });
                  console.log('[ASSINATURA] Anexo PDF adicionado:', `attachment-${i}`);
                  continue;
                }

                if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
                  console.log('[ASSINATURA] Renderizando anexo DOCX offscreen:', attach.name);
                  const host = await renderDocxOffscreen(attach.url);
                  cleanupHosts.push(host);
                  attachmentDocxItems.push({ documentId: `attachment-${i}`, container: host });
                  console.log('[ASSINATURA] Anexo DOCX adicionado:', `attachment-${i}`);
                }
              }

              console.log('[ASSINATURA] Anexos DOCX:', attachmentDocxItems.length, 'Anexos PDF:', pdfAttachmentItems.length);
              console.log('[ASSINATURA] Campos de assinatura:', signatureFields.length);
              console.log('[ASSINATURA] Campos detalhes:', signatureFields.map(f => ({ doc: f.document_id, page: f.page_number, type: f.field_type })));

              const { filePath, sha256, integritySha256 } = await pdfSignatureService.saveSignedDocxAsPdf({
                request,
                signer: result,
                creator,
                docxContainer: mainHost,
                attachmentDocxItems,
                attachmentPdfItems: pdfAttachmentItems,
                fieldsOverride: signatureFields,
              });
              signedPdfPath = filePath;
              signedPdfSha256 = sha256;
              signedIntegritySha256 = integritySha256;
            } finally {
              for (const el of cleanupHosts) {
                try { el.remove(); } catch { /* noop */ }
              }
            }
          } else {
            // Fallback - gerar apenas relatório de assinatura
            const { filePath, sha256, integritySha256 } = await pdfSignatureService.saveSignatureReportToStorage({
              request,
              signer: result,
              creator,
            });
            signedPdfPath = filePath;
            signedPdfSha256 = sha256;
            signedIntegritySha256 = integritySha256;
          }

          // Atualizar o signer com o path do PDF assinado
          await signatureService.attachSignedPdfPublic(token, signedPdfPath, signedPdfSha256, signedIntegritySha256);
          result.signed_document_path = signedPdfPath;
          (result as any).signed_pdf_sha256 = signedPdfSha256;
          (result as any).integrity_sha256 = signedIntegritySha256;
          console.log('[ASSINATURA] PDF compilado salvo com sucesso:', signedPdfPath);

          try {
            const signedUrl = await signatureService.getPublicFileUrl(token,signedPdfPath);
            if (signedUrl) {
              setSignedDocumentUrl(signedUrl);
            }
          } catch {
            // Não bloquear
          }
          } // fim do else (fluxo consolidado/legado)
        } catch (pdfErr: any) {
          console.error('Erro ao salvar PDF assinado:', pdfErr);
          if (request?.signature_model === 'per_document') {
            await signatureService.reportPerDocumentFailurePublic(token, {
              stage: 'generate_or_finalize',
              error: pdfErr?.message || 'Falha ao concluir os documentos assinados',
              expectedDocumentCount: expectedPerDocumentCount,
              persistedCount: 0,
              ipAddress,
              userAgent,
            });
          }
          // Modelo per_document: falha REAL de persistência do documento individual
          // é requisito jurídico — NÃO pode virar sucesso visual. Propaga para o
          // catch externo (step='error') com mensagem explícita.
          if (pdfErr?.__perDocPersistFailure) {
            throw new Error(
              (pdfErr?.message ? `${pdfErr.message} ` : '') +
                'Sua assinatura foi registrada, mas o documento assinado não pôde ser salvo. Recarregue a página e tente novamente; se persistir, contate o suporte.',
            );
          }
          // Fluxo consolidado (legado): PDF compilado pode ser regenerado depois
          // no backoffice — não bloquear o fluxo se falhar.
        }
      }
      
      setIsSignModalOpen(false);
      // Atualizar signer com os dados retornados do servidor
      setSigner(result);
      setStep('success');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Erro ao assinar documento.');
      setStep('error');
    } finally {
      setLoading(false);
    }
  };

  // ========== RECUSA ==========
  const handleRefuse = async () => {
    if (!signer) return;
    const reason = refuseReason.trim();
    if (reason.length < 3) {
      setRefuseError('Por favor, descreva o motivo da recusa.');
      return;
    }
    try {
      setRefusing(true);
      setRefuseError(null);
      const userAgent = navigator.userAgent;
      let ipAddress: string | undefined;
      try {
        const ipResponse = await fetch('https://api.ipify.org?format=json');
        const ipData = await ipResponse.json();
        ipAddress = ipData.ip;
      } catch { /* não bloquear por IP */ }

      const updated = await signatureService.refuseDocumentPublic(token, reason, ipAddress, userAgent);
      setSigner(updated);
      setIsRefuseModalOpen(false);
      setStep('success');
    } catch (err: any) {
      console.error(err);
      setRefuseError(err.message || 'Erro ao recusar o documento.');
    } finally {
      setRefusing(false);
    }
  };

  // ========== HELPERS ==========
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('pt-BR', {
      timeZone: 'America/Cuiaba',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const requireCpfMatch = !!(request as any)?.require_cpf;
  const expectedCpfDigits = (signer?.cpf || '').replace(/\D/g, '');
  const enteredCpfDigits = signerData.cpf.replace(/\D/g, '');
  const cpfMismatch = requireCpfMatch && expectedCpfDigits.length === 11 && enteredCpfDigits.length === 11 && enteredCpfDigits !== expectedCpfDigits;
  /** CPF com 11 dígitos mas dígitos verificadores errados — antes passava. */
  const cpfInvalido = enteredCpfDigits.length === 11 && !cpfValido(enteredCpfDigits);
  const canProceedFromData =
    signerData.name.trim().length >= 3 &&
    enteredCpfDigits.length === 11 &&
    !cpfInvalido &&
    !cpfMismatch;

  const closeSignModal = () => {
    setIsSignModalOpen(false);
    setModalStep(getFirstAuthStep(authConfig));
    setGoogleUser(null);
    setGoogleAuthError(null);
    setGoogleAuthLoading(false);

    setPhoneOtp('');
    setPhoneOtpChannel(authConfig.whatsapp && !authConfig.phone ? 'whatsapp' : 'sms');
    setPhoneOtpResendIn(0);
    setPhoneOtpFails(0);
    setPhoneOtpSent(false);
    setPhoneOtpExpiresAt(null);
    setPhoneOtpVerified(false);
    setPhoneOtpLoading(false);
    setPhoneOtpError(null);

    // Semeado, não zerado: ver `emailDoCadastro`.
    setEmailToVerify(emailDoCadastro);
    setEmailOtp('');
    setEmailOtpResendIn(0);
    setEmailOtpFails(0);
    setEmailOtpSent(false);
    setEmailOtpExpiresAt(null);
    setEmailOtpVerified(false);
    setEmailOtpLoading(false);
    setEmailOtpError(null);
    setVerifiedEmail(null);
    setShowEmailAnimation(false);
  };

  /**
   * Envia o código por SMS ou WhatsApp.
   *
   * Como no e-mail, aceita telefone e canal EXPLÍCITOS: o atalho da tela de
   * identidade escolhe o canal e dispara o envio no mesmo clique, e o estado
   * ainda não teria mudado a tempo.
   */
  const handleSendPhoneOtp = async (
    telefoneExplicito?: string,
    canalExplicito?: 'sms' | 'whatsapp',
  ) => {
    const canal = canalExplicito ?? phoneOtpChannel;
    try {
      setPhoneOtpLoading(true);
      setPhoneOtpError(null);

      const phoneRaw = telefoneExplicito ?? signerData.phone ?? '';
      const digits = phoneRaw.replace(/\D/g, '');
      if (digits.length < 10) {
        throw new Error('Informe um telefone válido');
      }

      const res = await signatureService.sendPhoneOtp({ token, phone: digits, channel: canal });
      setPhoneOtpSent(true);
      setPhoneOtpExpiresAt(res.expires_at ?? null);
      setPhoneOtpResendIn(res.resend_in_seconds ?? 0);
      toast.success(canal === 'whatsapp' ? 'Código enviado pelo WhatsApp' : 'Código enviado por SMS');
    } catch (e: any) {
      if (e?.retryAfterSeconds) setPhoneOtpResendIn(e.retryAfterSeconds);
      setPhoneOtpError(e?.message || 'Não foi possível enviar o código');
    } finally {
      setPhoneOtpLoading(false);
    }
  };

  const handleVerifyPhoneOtp = async () => {
    try {
      setPhoneOtpLoading(true);
      setPhoneOtpError(null);

      const code = phoneOtp.replace(/\D/g, '');
      if (code.length < 4) {
        throw new Error('Informe o código recebido');
      }

      const res = await signatureService.verifyPhoneOtp({ token, code });
      setPhoneOtpVerified(true);
      authAtRef.current = agoraDoServidor().toISOString(); // instante real, no relógio do servidor
      void signatureService.marcarEtapaDaAssinatura(token, 'autenticacao');
      if (res.phone) {
        setSignerData((prev) => ({ ...prev, phone: res.phone || prev.phone }));
      }
      toast.success('Telefone verificado com sucesso!');
      setModalStep(
        allowSkipSignerDataStep && isSignerDataComplete({ ...signerData, phone: res.phone || signerData.phone })
          ? 'signature'
          : 'data'
      );
    } catch (e: any) {
      setPhoneOtpFails((n) => n + 1);
      setPhoneOtpError(e?.message || 'Código inválido');
      // Código recusado esvazia o campo: seis dígitos errados na tela obrigam
      // a apagar um por um antes de tentar de novo, e o cursor volta para cá
      // para a próxima tentativa começar no gesto certo.
      setPhoneOtp('');
      window.setTimeout(() => phoneOtpInputRef.current?.focus(), 0);
    } finally {
      setPhoneOtpLoading(false);
    }
  };

  const openSignModal = () => {
    if (loading || isSignModalOpen) {
      return;
    }
    if (!canOpenSignModal) {
      setQueuedOpenSignModal(true);
      toast.info('Carregando documento… Abriremos a assinatura assim que estiver pronto.');
      return;
    }
    setModalStep(getFirstAuthStep(authConfig));
    setSignatureData(null);
    setFacialData(null);
    setHasSignature(false);
    setGoogleUser(null);
    setGoogleAuthError(null);

    setPhoneOtp('');
    setPhoneOtpChannel(authConfig.whatsapp && !authConfig.phone ? 'whatsapp' : 'sms');
    setPhoneOtpResendIn(0);
    setPhoneOtpFails(0);
    setPhoneOtpSent(false);
    setPhoneOtpExpiresAt(null);
    setPhoneOtpVerified(false);
    setPhoneOtpLoading(false);
    setPhoneOtpError(null);

    // Semeado, não zerado: ver `emailDoCadastro`.
    setEmailToVerify(emailDoCadastro);
    setEmailOtp('');
    setEmailOtpResendIn(0);
    setEmailOtpFails(0);
    setEmailOtpSent(false);
    setEmailOtpExpiresAt(null);
    setEmailOtpVerified(false);
    setEmailOtpLoading(false);
    setEmailOtpError(null);
    setVerifiedEmail(null);

    setIsSignModalOpen(true);
  };

  /**
   * Por onde a pessoa provou quem é.
   *
   * Mesma ordem de precedência do `auth_provider` que vai no payload da
   * assinatura — de propósito: a tela não pode dizer "identidade por e-mail"
   * enquanto o dossiê grava "google".
   *
   * O código do telefone vai por SMS OU por WhatsApp (`phoneOtpChannel`), e a
   * tela usa o canal que de fato foi usado. Escrever "WhatsApp" num comprovante
   * de código que saiu por SMS é o tipo de detalhe que derruba a prova.
   *
   * Sem nada em estado (a pessoa recarregou a página depois de assinar), cai
   * para o que está gravado no registro do signatário.
   */
  const canalDeIdentidade: CanalDeIdentidade =
    googleUser ? 'google'
    : emailOtpVerified ? 'email'
    : phoneOtpVerified ? phoneOtpChannel
    : canalDoRegistro(signer);

  // ── Portal de carregamento (posição fixa na árvore → nunca desmonta a abertura) ──
  const loadingPortal = overlayVisible
    ? createPortal(
        <div
          className="fixed inset-0 z-[9999]"
          style={{
            opacity: overlayFading ? 0 : 1,
            transition: 'opacity 420ms cubic-bezier(0.4,0,0.2,1)',
            pointerEvents: overlayFading ? 'none' : 'auto',
          }}
        >
          <TelaDeAbertura
            docName={request?.document_name}
            signerName={signer?.name}
            pronto={readerReady}
            travado={esperaTravada}
            onRecarregar={() => window.location.reload()}
            allDocNames={request ? [
              request.document_name,
              ...((request as any).attachment_paths as string[] | null | undefined ?? [])
                .map((p: string) => p.split('/').pop()?.replace(/_\d+_/, ' ').replace(/_/g, ' ') ?? p)
            ] : undefined}
          />
        </div>,
        document.body
      )
    : null;

  if (step === 'loading') {


    return (
      <>
        {loadingPortal}
        <div className="min-h-[100dvh] bg-[#f8f7f5]" />
      </>
    );
  }

  // Error
  if (step === 'error') {
    const waUrl = buildWhatsappUrl(officeWhatsapp, `Olá! Preciso de um novo link para assinatura. Token: ${token}`);

    return (
      <>
        {loadingPortal}
        <MolduraPublica tom="problema" rodape={<RodapeDeConfianca itens={['Conexão segura', 'Jurius']} />}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={sobe(0, 0.5)}>
              <Rotulo cor="#e11d48">Link com problema</Rotulo>
              <h1 style={{
                margin: '10px 0 0', fontSize: 29, fontWeight: 700, letterSpacing: '-.9px',
                lineHeight: 1.08, color: TINTA,
              }}>
                Este link não abre.
              </h1>
              <Explicacao style={{ marginTop: 11 }}>
                {error || 'Não foi possível carregar este link de assinatura.'}
              </Explicacao>
              <Explicacao style={{ marginTop: 8, color: TINTA_3 }}>
                Links de assinatura expiram. Se você recebeu este há algum tempo, peça um novo ao
                escritório — leva um minuto.
              </Explicacao>
            </div>

            {/*
              O token continua à vista e copiável: é ele que o escritório precisa
              para achar o documento certo e reemitir o link.
            */}
            <div style={{
              border: `1px dashed #cbd5e1`, borderRadius: 8, background: '#fff', overflow: 'hidden', ...sobe(2),
            }}>
              <div style={{ padding: '6px 11px', borderBottom: '1px dashed #cbd5e1', background: '#f8fafc' }}>
                <span style={{
                  fontSize: 8.5, fontWeight: 700, letterSpacing: '.14em',
                  textTransform: 'uppercase', color: TINTA_3,
                }}>
                  Token deste link
                </span>
              </div>
              <div style={{
                padding: '9px 11px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 11.5, color: TINTA_2, wordBreak: 'break-all', lineHeight: 1.4,
              }}>
                {token}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, ...sobe(3) }}>
              <AcaoPrimaria
                onClick={loadSignerData}
                icone={<RotateCcw className="w-4 h-4" />}
              >
                Tentar novamente
              </AcaoPrimaria>

              <div style={{ display: 'flex', gap: 8 }}>
                <AcaoSecundaria
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(token);
                      toast.success('Token copiado.');
                    } catch {
                      toast.error('Não foi possível copiar o token.');
                    }
                  }}
                  icone={<Copy className="w-3.5 h-3.5" />}
                >
                  Copiar token
                </AcaoSecundaria>
                {waUrl && (
                  <AcaoSecundaria
                    onClick={() => window.open(waUrl, '_blank', 'noopener,noreferrer')}
                    icone={<ExternalLink className="w-3.5 h-3.5" />}
                  >
                    Pedir ajuda
                  </AcaoSecundaria>
                )}
              </div>
            </div>
          </div>
        </MolduraPublica>
      </>
    );
  }

  // Já assinado — quem volta ao link depois (recarregou, guardou no histórico).
  //
  // A diferença para o comprovante logo após assinar é que aqui NÃO temos mais a
  // selfie nem o traço em mãos: eles vivem em estado do navegador e a página foi
  // recarregada. O comprovante degrada sozinho — some a miniatura da prova e
  // sobra o protocolo, que é o que valida de verdade.
  if (step === 'already_signed') {
    if (!request || !signer) {
      return (
        <>
          {loadingPortal}
          <div className="min-h-[100dvh] bg-[#f8f7f5]" />
        </>
      );
    }

    if (showReport) {
      return (
        <SignatureReport
          signer={signer}
          request={request}
          creator={creator}
          onClose={() => setShowReport(false)}
        />
      );
    }

    const isPerDocumentModel = request?.signature_model === 'per_document';
    const primarySignedDocument =
      signedDocuments.find((doc) => doc.documentKey === 'main') ??
      signedDocuments[0] ??
      null;

    const envelopeDisplayCode = getEnvelopeDisplayCode(request, signer);
    const protocolo = (
      envelopeDisplayCode
      || (isPerDocumentModel ? primarySignedDocument?.verificationCode : signer?.verification_hash)
      || ''
    ).trim();

    const urlDeVerificacao = protocolo ? `${window.location.origin}/#/verificar/${protocolo}` : null;

    const copiarProtocolo = async () => {
      if (!protocolo) return;
      try {
        await navigator.clipboard.writeText(protocolo);
        toast.success('Protocolo copiado.');
      } catch {
        toast.error('Não foi possível copiar o protocolo.');
      }
    };

    return (
      <>
        {loadingPortal}
        <TelaDeComprovante
          nome={signer?.name || 'Signatário'}
          cpf={signer?.cpf}
          canal={canalDoRegistro(signer)}
          documento={request?.document_name}
          assinadoEm={signer?.signed_at ? formatDate(signer.signed_at) : null}
          protocolo={protocolo}
          documentosAssinados={signedDocuments}
          temArquivoAssinado={!!signer?.signed_document_path}
          abrindo={downloadingAlreadySigned}
          compartilhando={sharing}
          urlDeVerificacao={urlDeVerificacao}
          aoAbrir={() => openSignedDocumentViewer(setDownloadingAlreadySigned)}
          aoCompartilhar={() => { void handleShareSignedDocuments(request!, signer!); }}
          aoCopiarProtocolo={() => { void copiarProtocolo(); }}
          aoAbrirDocumento={(url) => openUrlInSignedViewer(url)}
          urlDosTermos={buildPublicSignatureTermsUrl()}
        />
        {signedDocViewer}
      </>
    );
  }

  // Ordem sequencial: ainda não é a vez deste signatário (há um anterior pendente).
  // Bloqueia a UI de assinatura e explica o motivo. O servidor (edge function)
  // também recusa qualquer tentativa fora de ordem como backstop.
  if (step === 'success' && signer?.status === 'pending' && waitingFor) {
    return (
      <>
        {loadingPortal}
        <MolduraPublica tom="espera" rodape={<RodapeDeConfianca itens={['Conexão segura', 'Jurius']} />}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={sobe(0, 0.5)}>
              <Rotulo cor="#b45309">Assinatura em ordem</Rotulo>
              <h1 style={{
                margin: '10px 0 0', fontSize: 29, fontWeight: 700, letterSpacing: '-.9px',
                lineHeight: 1.08, color: TINTA,
              }}>
                Ainda não é<br />a sua vez.
              </h1>
              <Explicacao style={{ marginTop: 11 }}>
                Este documento precisa ser assinado numa ordem, e falta a assinatura de{' '}
                <strong style={{ color: TINTA, fontWeight: 600 }}>{waitingFor}</strong> antes da sua.
              </Explicacao>
            </div>

            {request?.document_name && (
              <div style={sobe(2)}>
                <EtiquetaDoDocumento nome={request.document_name} />
              </div>
            )}

            <Tarja tom="neutro" style={sobe(3)}>
              Você receberá um novo aviso assim que chegar a sua vez. Pode fechar esta página.
            </Tarja>

            <div style={sobe(4)}>
              <AcaoSecundaria onClick={loadSignerData} icone={<RotateCcw className="w-3.5 h-3.5" />}>
                Verificar novamente
              </AcaoSecundaria>
            </div>
          </div>
        </MolduraPublica>
      </>
    );
  }

  // Recusa registrada.
  if (step === 'success' && signer?.status === 'refused') {
    return (
      <>
        {loadingPortal}
        <MolduraPublica tom="problema" rodape={<RodapeDeConfianca itens={['Conexão segura', 'Jurius']} />}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={sobe(0, 0.5)}>
              <Rotulo cor="#e11d48">Recusa registrada</Rotulo>
              <h1 style={{
                margin: '10px 0 0', fontSize: 29, fontWeight: 700, letterSpacing: '-.9px',
                lineHeight: 1.08, color: TINTA,
              }}>
                Você recusou<br />esta assinatura.
              </h1>
              <Explicacao style={{ marginTop: 11 }}>
                O escritório já foi avisado e vai retomar o contato. Nenhuma assinatura sua foi
                registrada no documento.
              </Explicacao>
            </div>

            {request?.document_name && (
              <div style={sobe(2)}>
                <EtiquetaDoDocumento nome={request.document_name} principal={false} />
              </div>
            )}

            {signer?.refusal_reason && (
              <div style={{
                border: '1px solid #fecdd3', background: '#fff1f2', borderRadius: 12,
                padding: '12px 14px', textAlign: 'left', ...sobe(3),
              }}>
                <p style={{
                  margin: 0, fontSize: 8.5, fontWeight: 700, letterSpacing: '.14em',
                  textTransform: 'uppercase', color: '#be123c',
                }}>
                  Motivo informado
                </p>
                <p style={{
                  margin: '6px 0 0', fontSize: 12.5, color: TINTA_2, lineHeight: 1.5, whiteSpace: 'pre-wrap',
                }}>
                  {signer.refusal_reason}
                </p>
              </div>
            )}
          </div>
        </MolduraPublica>
      </>
    );
  }

  if (step === 'success' && signer?.status === 'signed') {
    // Relatório completo — continua sendo uma tela à parte.
    if (showReport && request) {
      return (
        <SignatureReport
          signer={signer}
          request={request}
          creator={creator}
          onClose={() => setShowReport(false)}
        />
      );
    }

    const isPerDocumentModel = request?.signature_model === 'per_document';
    const primarySignedDocument =
      signedDocuments.find((doc) => doc.documentKey === 'main') ??
      signedDocuments[0] ??
      null;

    const envelopeDisplayCode = getEnvelopeDisplayCode(request, signer);
    // O protocolo do envelope é o herói; o código do documento principal é o
    // plano B, para o comprovante nunca sair com o campo vazio.
    const protocolo = (
      envelopeDisplayCode
      || (isPerDocumentModel ? primarySignedDocument?.verificationCode : signer?.verification_hash)
      || ''
    ).trim();

    const urlDeVerificacao = protocolo ? `${window.location.origin}/#/verificar/${protocolo}` : null;

    // Abre o documento assinado no visualizador interno (iframe), sem expor a URL do Supabase.
    const handleDownload = () => openSignedDocumentViewer(setDownloading);
    const handleShare = async () => handleShareSignedDocuments(request!, signer!);

    const copiarProtocolo = async () => {
      if (!protocolo) return;
      try {
        await navigator.clipboard.writeText(protocolo);
        toast.success('Protocolo copiado.');
      } catch {
        toast.error('Não foi possível copiar o protocolo.');
      }
    };

    return (
      <>
        {loadingPortal}
        <TelaDeComprovante
          nome={signerData.name || signer?.name || 'Signatário'}
          cpf={signerData.cpf || signer?.cpf}
          canal={canalDeIdentidade}
          selfie={facialData}
          assinatura={signatureData}
          local={locationData}
          documento={request?.document_name}
          assinadoEm={signer?.signed_at ? formatDate(signer.signed_at) : null}
          protocolo={protocolo}
          documentosAssinados={signedDocuments}
          temArquivoAssinado={!!signer?.signed_document_path}
          abrindo={downloading}
          compartilhando={sharing}
          urlDeVerificacao={urlDeVerificacao}
          aoAbrir={handleDownload}
          aoCompartilhar={() => { void handleShare(); }}
          aoCopiarProtocolo={() => { void copiarProtocolo(); }}
          aoAbrirDocumento={(url) => openUrlInSignedViewer(url)}
          urlDosTermos={buildPublicSignatureTermsUrl()}
        />
        {signedDocViewer}
      </>
    );
  }

  /*
    ══════════════════════════════════════════════════════════════════════════
    O ROTEIRO DO GUIA — a próxima coisa a tocar, etapa por etapa.
    ══════════════════════════════════════════════════════════════════════════

    Quem assina aqui está no celular (99% das assinaturas) e quase sempre nunca
    assinou um contrato pelo telefone. Cada tela declara a FILA do que fazer, na
    ordem; o guia aponta o primeiro item ainda não cumprido e anda sozinho
    conforme `pronto` vai virando verdade — é isso que faz ele acompanhar campo
    a campo, em vez de despejar tudo de uma vez.

    Ele só aparece depois de hesitação e some no primeiro toque: quem já sabe o
    caminho nunca vê professor nenhum. As regras inteiras estão em `Guia.tsx`.

    Uma condição de `pronto` ERRADA trava o guia, porque ele nunca passa para o
    próximo item — por isso cada uma espelha exatamente o que a tela mostra.
  */
  /* Função pura e não hook: este trecho vive DEPOIS dos returns antecipados
     (comprovante, recusa, carregando), e um hook aqui mudaria a ordem dos
     hooks entre renders — foi exatamente o erro "Rendered more hooks than
     during the previous render" que apareceu no primeiro teste. O `Guia`
     guarda a lista numa gaveta, então recalcular a cada render não custa. */
  const passosDoGuia: PassoDoGuia[] = (() => {
    // O modal dos termos abre POR CIMA da etapa de confirmação: enquanto ele
    // está aberto, a única coisa a fazer é aceitar (ou fechar).
    if (showTermsModal) {
      return [{ alvo: '[data-guia="aceite-modal"]', texto: 'Toque em “Li e aceito”' }];
    }

    if (!isSignModalOpen) {
      if (signer?.status === 'signed') return [];
      return [{ alvo: '[data-guia="assinar"]', texto: 'Toque para assinar', redondo: true }];
    }

    switch (modalStep) {
      // ── Etapa 1 · identidade ──────────────────────────────────────────────
      case 'google_auth': {
        // O guia aponta o caminho RECOMENDADO que estiver disponível: entrar
        // pela conta é um toque, e receber código é esperar.
        if (googleUser) return [];
        if (authConfig.google) {
          // Abaixo, e não acima: o que fica acima deste botão é exatamente a
          // linha "Recomendado · sem esperar código", que o cartão taparia.
          return [{ alvo: '[data-guia="google"]', texto: 'Entre com sua conta Google', lado: 'abaixo' }];
        }
        const primeiro =
          authConfig.whatsapp ? { marca: 'metodo-whatsapp', onde: 'no WhatsApp' }
          : authConfig.email ? { marca: 'metodo-email', onde: 'no e-mail' }
          : authConfig.phone ? { marca: 'metodo-sms', onde: 'por SMS' }
          : null;
        return primeiro
          ? [{ alvo: `[data-guia="${primeiro.marca}"]`, texto: `Toque para receber o código ${primeiro.onde}` }]
          : [];
      }

      case 'phone_otp':
        return phoneOtpSent
          ? [{ alvo: '[data-guia="codigo-telefone"]', texto: 'Digite os 6 dígitos que chegaram' }]
          : [{ alvo: '[data-guia="telefone"]', texto: 'Confirme seu número com DDD' }];

      case 'email_otp':
        return emailOtpSent
          ? [{ alvo: '[data-guia="codigo-email"]', texto: 'Digite os 6 dígitos que chegaram' }]
          : [{ alvo: '[data-guia="email"]', texto: 'Confirme seu e-mail' }];

      // ── Etapa 2 · dados ───────────────────────────────────────────────────
      case 'data':
        return [
          {
            alvo: '[data-guia="nome"]',
            texto: 'Escreva seu nome completo',
            pronto: signerData.name.trim().length >= 3,
          },
          {
            alvo: '[data-guia="cpf"]',
            texto: 'Agora o seu CPF',
            pronto: enteredCpfDigits.length === 11 && !cpfInvalido && !cpfMismatch,
          },
          { alvo: '[data-guia="continuar-dados"]', texto: 'Pronto — pode continuar' },
        ];

      // ── Etapa 3 · assinatura ──────────────────────────────────────────────
      case 'signature':
        return [
          { alvo: '[data-guia="quadro"]', texto: 'Arraste o dedo aqui dentro', pronto: hasSignature },
          { alvo: '[data-guia="continuar-assinatura"]', texto: 'Ficou boa? Continue' },
        ];

      // ── Etapa 4 · localização ─────────────────────────────────────────────
      case 'location':
        return locationData
          ? [{ alvo: '[data-guia="continuar-local"]', texto: 'Toque para continuar' }]
          : [{ alvo: '[data-guia="permitir-local"]', texto: 'Toque e autorize no aviso do navegador' }];

      // ── Etapa 5 · foto ────────────────────────────────────────────────────
      case 'facial':
        // Enquanto a foto está sendo conferida não há o que tocar: o guia sai
        // da frente.
        if (facialData || facialValidating) return [];
        return cameraActive
          ? [{ alvo: '[data-guia="tirar-foto"]', texto: 'Enquadre o rosto e toque' }]
          : [{ alvo: '[data-guia="abrir-camera"]', texto: 'Toque para ligar a câmera' }];

      // ── Etapa 6 · confirmar ───────────────────────────────────────────────
      case 'confirm':
        return [
          { alvo: '[data-guia="aceite"]', texto: 'Marque o aceite dos termos', pronto: termsAccepted },
          { alvo: '[data-guia="assinar-agora"]', texto: 'Agora sim: assine o documento' },
        ];

      default:
        return [];
    }
  })();

  /* A chave reinicia a espera a cada tela nova — inclusive quando a MESMA
     etapa troca de cara (o código já enviado, a câmera que ligou). */
  const chaveDoGuia = [
    isSignModalOpen ? modalStep : 'leitor',
    showTermsModal ? 'termos' : '',
    phoneOtpSent ? 'otp' : '', emailOtpSent ? 'otp' : '', cameraActive ? 'camera' : '',
  ].join('|');

  /* Desligado quando há outra coisa por cima ou quando o envio está em curso:
     nesses momentos não existe "próxima coisa a tocar". */
  const guiaLigado =
    activeTab !== 'history' &&
    !isRefuseModalOpen &&
    !loading;

  /*
    O NOME DO DOCUMENTO — uma linha só, no celular e no monitor.

    Ele já foi a SEGUNDA faixa do cabeçalho no celular: marca numa linha,
    documento na outra, 88 px de branco antes de o contrato começar, numa tela
    de 640. Agora divide a linha da marca em toda largura — no celular quem
    cede espaço é a marca (fica só o símbolo) e o botão de histórico (fica só
    o relógio), porque o que precisa ser lido aqui é O QUE se está assinando.
  */
  const nomeDoDocumentoNoTopo = request?.document_name ? (
    <>
      <span
        className="hidden flex-none text-[9px] font-bold uppercase tracking-[0.18em] sm:block lg:text-[10px]"
        style={{ color: '#ea580c' }}
      >
        Assinar
      </span>
      <span
        className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-[-0.01em] lg:text-[15px]"
        style={{ color: TINTA }}
        title={request.document_name}
      >
        {request.document_name}
      </span>
    </>
  ) : null;

  return (
    <>
      {loadingPortal}

      {/* O guia. Vive fora das telas, num portal, porque ele aponta tanto o
          botão do leitor quanto os controles dentro do modal. */}
      <Guia passos={passosDoGuia} chave={chaveDoGuia} ligado={guiaLigado} />

      <div className="flex h-[100dvh] min-h-[100dvh] min-w-0 flex-col overflow-hidden overscroll-none" style={{ background: '#f8fafc' }}>
      {/*
        O cabeçalho da leitura.
        
        Ele era um painel ESCURO (#0C1320), e a justificativa escrita aqui era
        "mesmo painel escuro e mesma wordmark do comprovante". Agora o
        comprovante é claro — e a mesma justificativa passa a mandar no sentido
        contrário. O fio laranja no topo é o único lugar onde a cor fala, como
        nas demais telas públicas.

        Marca e documento também deixaram de ser dois blocos: num celular isso
        custava duas faixas antes do PDF começar.

        E a faixa encolheu de novo. Ela vinha com 88 px no celular — marca em
        cima, documento embaixo — o que numa tela de 640 é um sétimo do papel
        gasto em cabeçalho. Numa página cujo único trabalho é mostrar um
        contrato e um botão, tudo aqui é imposto: agora é UMA linha de ~48 px,
        e quem cede é a marca (só o símbolo) e o histórico (só o relógio).
      */}
      <div className="h-[2.5px] w-full flex-none" style={{ background: 'linear-gradient(90deg,#c2410c,#ea580c 60%,#f97316)' }} />
      <header
        className="flex-none border-b bg-white px-3 pb-2 sm:px-5 sm:pb-3 lg:px-8 lg:pb-4"
        style={{ borderColor: '#e7e5e4', paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
      >
        {/* A mesma coluna de leitura da folha: no monitor largo, marca e
            histórico param de morar em cantos opostos de 1.400 px. */}
        <div className="mx-auto w-full max-w-[1120px]">
          <div className="flex min-w-0 items-center gap-2.5 lg:gap-6">
            <div className="flex min-w-0 flex-none items-center gap-2 lg:gap-2.5">
              <BrandLogo iconOnly size="xs" />
              {/* No celular o símbolo basta: a palavra custaria metade do
                  espaço que sobra para o nome do documento. */}
              <span className="hidden text-[13px] sm:inline lg:text-[15px]" style={{ fontFamily: BRAND_SERIF, fontWeight: 700, letterSpacing: '-0.012em', color: '#1A1613' }}>
                {BRAND_WORDMARK.lead}
                <span style={{ color: BRAND_DOT }}>{BRAND_WORDMARK.dot}</span>
                <span style={{ fontWeight: 400, color: '#a8a29e' }}>{BRAND_WORDMARK.tld}</span>
              </span>
            </div>

            {/* O contexto entra aqui, entre a marca e o histórico — em toda
                largura, inclusive no celular. */}
            {nomeDoDocumentoNoTopo && (
              <div className="flex min-w-0 flex-1 items-baseline gap-2 border-l pl-2.5 lg:gap-2.5 lg:pl-6" style={{ borderColor: '#ede9e6' }}>
                {nomeDoDocumentoNoTopo}
              </div>
            )}

            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className="flex min-h-9 flex-shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition-colors hover:bg-slate-50 lg:min-h-10 lg:gap-2 lg:rounded-xl lg:px-3.5 lg:text-[12.5px]"
              style={{ borderColor: '#e2e8f0', color: TINTA_2 }}
              title="Histórico"
              aria-label="Histórico da assinatura"
            >
              <Clock className="h-4 w-4 lg:h-4 lg:w-4" />
              <span className="hidden sm:inline">Histórico</span>
            </button>
          </div>
        </div>
      </header>

      {/*
        O PALCO DA LEITURA.

        Este `relative` é o conserto do iPhone. A barra de ação flutua sobre o
        documento — é para flutuar mesmo, com vidro e desfoque —, mas ela era
        `position: fixed`, e no Safari do iOS um elemento fixo se ancora no
        viewport de LAYOUT, que mantém a altura da tela SEM as barras do
        navegador. Com a barra inferior do Safari de pé (o estado em que a
        página abre), os últimos ~50 px desse viewport ficam ATRÁS dela — e era
        exatamente ali que o único botão da página estava desenhado. Ninguém o
        via.

        Trocando `fixed` por `absolute` dentro deste palco, a âncora passa a
        ser a coluna de `100dvh` — a medida do que está REALMENTE visível. O
        botão flutua igual, e agora flutua onde dá para tocar, com a barra do
        Safari em pé ou retraída.
      */}
      <div className="relative min-h-0 flex-1">
      {/* Document Viewer - Ocupa toda a tela */}
      {/* O ÚNICO scroller do leitor. `overscroll-contain` impede que o toque
          escape para a página nas bordas — no iOS é isso que dá a sensação de
          "dois scrolls brigando" ao chegar no fim do documento. */}
      <main className="absolute inset-0 overflow-y-auto overscroll-contain bg-[#f8fafc]">
        {pdfUrl ? (
          isDocx ? (
            // Renderizar DOCX com docx-preview
            <div className="w-full min-w-0 bg-[#f8f7f5] pb-28 sm:pb-24">
              {docxLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#f8f7f5]/80 z-10">
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-slate-700" />
                    <p className="text-sm text-slate-600">Carregando documento...</p>
                  </div>
                </div>
              )}
              {/* Documento Principal DOCX */}
              <div
                ref={docxContainerRef}
                className="docx-responsive flex min-w-0 flex-col items-center bg-slate-100"
                style={{ width: '100%', minHeight: '400px', padding: '20px' }}
              />

              {/* Documentos Anexos */}
              {attachments.length > 0 && (
                <AttachmentsList
                  attachments={attachments}
                  attachmentRefs={attachmentRefs}
                />
              )}
            </div>
          ) : (
            // PDF: canvas via react-pdf, sem iframe, scroll único no <main>
            <div className="w-full min-w-0 bg-[#f8f7f5] pb-28 sm:pb-24">
              <PdfRenderer
                url={pdfUrl!}
                onLoad={() => setPdfFrameLoaded(true)}
              />
              {attachments.length > 0 && (
                <AttachmentsList
                  attachments={attachments}
                  attachmentRefs={attachmentRefs}
                />
              )}
            </div>
          )
        ) : (
          <div className="w-full h-full bg-[#f8f7f5]" />
        )}
      </main>

      {/*
        A BARRA DE AÇÃO — vidro sobre o documento.

        Ela flutua, e é para flutuar: o contrato continua visível por baixo,
        desfocado, em vez de ser cortado por uma faixa branca opaca. O que
        mudou foi a ÂNCORA, e é aí que estava o bug do iPhone.

        Era `position: fixed`. No Safari do iOS um elemento fixo se ancora no
        viewport de LAYOUT, que mantém a altura da tela SEM as barras do
        navegador. Com a barra inferior do Safari de pé — o estado em que a
        página abre —, os últimos ~50 px desse viewport ficam ATRÁS dela, e era
        exatamente ali que o botão estava desenhado. O único botão da página
        não aparecia.

        Agora é `absolute` dentro do palco de leitura, que é filho da coluna de
        `100dvh` — e `dvh` mede o que está REALMENTE visível. O botão flutua
        igual e flutua onde dá para tocar.

        O véu é feito em DUAS camadas de propósito: o desfoque sozinho teria uma
        emenda horizontal reta atravessando o contrato. A máscara faz o vidro
        nascer do nada no topo e ganhar corpo até o rodapé.

        E o "Recusar" saiu de CIMA do "Assinar" e veio para o lado: eram duas
        peças empilhadas, 8 rem de tela comidos por controles.
      */}
      {signer?.status !== 'signed' && (
        (() => {
          const isWaiting = !canOpenSignModal || queuedOpenSignModal;
          const isButtonDisabled = loading || isSignModalOpen;
          const podeRecusar =
            signer?.status === 'pending' && !!(request as any)?.allow_refusal && !isSignModalOpen;

          /*
            O BOTÃO.

            Era um disco de laranja CHAPADO com duas sombras largas e difusas
            por baixo — de longe parecia um borrão alaranjado apoiado no
            documento, e o `ring-white/12` que deveria dar acabamento não
            aparecia em tela nenhuma.

            Agora a peça tem volume de verdade: um degradê curto de cima para
            baixo (a luz vem de cima, como no resto da interface), um fio de
            branco POR DENTRO da borda superior, uma sombra curta e escura que
            assenta a peça e uma sombra longa e difusa que a levanta do papel.
            É a mesma receita dos botões físicos do sistema: contato + altura,
            e não uma mancha só.

            Ele ocupa a linha inteira da barra: é o único destino da página.
          */
          const acabamentoNormal = [
            'bg-[linear-gradient(180deg,#fb7c3f_0%,#ea580c_54%,#d94d06_100%)]',
            'shadow-[inset_0_1px_0_rgba(255,255,255,0.30),0_2px_5px_rgba(124,45,18,0.30),0_12px_26px_-10px_rgba(234,88,12,0.62)]',
            'hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_4px_10px_rgba(124,45,18,0.32),0_18px_34px_-12px_rgba(234,88,12,0.70)]',
            'hover:-translate-y-[2px] active:translate-y-0 active:scale-[0.985]',
          ].join(' ');

          const buttonClass = [
            'flex min-h-[52px] min-w-0 flex-1 items-center justify-center gap-2.5',
            'rounded-full px-5 text-[15px] font-bold text-white',
            'whitespace-nowrap outline-none transition-[transform,box-shadow,opacity] duration-200 ease-out',
            'focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f8fafc]',
            'sm:min-h-[54px] sm:px-7 sm:text-[15.5px]',
            isButtonDisabled
              ? 'cursor-not-allowed bg-slate-300 text-slate-500 shadow-none'
              : isWaiting
                ? 'cursor-wait bg-[linear-gradient(180deg,#f5a077_0%,#e8794a_54%,#dc6a3a_100%)] shadow-[0_10px_22px_-12px_rgba(234,88,12,0.45)]'
                : acabamentoNormal,
          ].join(' ');

          return (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30">
              {/* O vidro. `aria-hidden` porque é acabamento, não conteúdo. */}
              <div
                aria-hidden
                className="absolute inset-0"
                style={{
                  background: 'linear-gradient(to top, rgba(248,250,252,.94) 26%, rgba(248,250,252,.60) 64%, rgba(248,250,252,0) 100%)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  maskImage: 'linear-gradient(to top, #000 58%, transparent 100%)',
                  WebkitMaskImage: 'linear-gradient(to top, #000 58%, transparent 100%)',
                }}
              />
              <div
                className="relative px-4 sm:px-5 lg:px-8"
                style={{
                  paddingTop: '2.75rem',
                  /* "Um pouquinho mais alto": o botão descola do rodapé em vez
                     de raspar nele, e no iPhone soma o indicador de home. */
                  paddingBottom: 'calc(max(1.25rem, env(safe-area-inset-bottom)) + 0.5rem)',
                }}
              >
                {/* Mesma coluna de leitura do cabeçalho e da folha. */}
                <div className="pointer-events-auto mx-auto flex w-full max-w-[26rem] items-center gap-2">
                  {podeRecusar && (
                    <button
                      onClick={() => { setRefuseReason(''); setRefuseError(null); setIsRefuseModalOpen(true); }}
                      disabled={loading}
                      title="Recusar assinatura"
                      aria-label="Recusar assinatura"
                      className="flex min-h-[52px] flex-none items-center justify-center gap-1.5 rounded-full border border-rose-200 bg-white/85 px-3.5 text-xs font-semibold text-rose-700 shadow-sm backdrop-blur transition-colors duration-200 hover:bg-rose-50 active:scale-95 disabled:opacity-50 sm:min-h-[54px] sm:px-4"
                      style={{ WebkitTapHighlightColor: 'transparent' }}
                    >
                      <X className="h-4 w-4" />
                      <span className="hidden sm:inline">Recusar</span>
                    </button>
                  )}
                  <button
                    onClick={openSignModal}
                    disabled={isButtonDisabled}
                    data-guia="assinar"
                    className={buttonClass}
                    style={{ WebkitTapHighlightColor: 'transparent' }}
                  >
                    {isWaiting ? (
                        <>
                          <Loader2 className="h-[17px] w-[17px] animate-spin" />
                          <span>Carregando…</span>
                        </>
                    ) : (
                        <>
                          <PenTool className="h-[17px] w-[17px]" />
                          <span>Assinar documento</span>
                        </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          );
        })()
      )}
      </div>

      {loading && createPortal(
        <div className="fixed inset-0 z-[9998]">
          {/*
            Tudo que a conferência mostra já está em mãos aqui: a selfie e o
            traço acabaram de ser capturados, a localização foi lida antes de
            abrir o modal, e o aparelho sai do próprio navegador. O IP é a única
            coisa que falta — ele só é buscado DENTRO do envio, e por isso não
            entra no cartão.
          */}
          <TelaDeConferencia
            nome={signerData.name || signer?.name || 'Signatário'}
            cpf={signerData.cpf || signer?.cpf}
            canal={canalDeIdentidade}
            selfie={facialData}
            assinatura={signatureData}
            local={locationData}
          />
        </div>,
        document.body
      )}

      {/* Modal dos Termos de Uso (LGPD) */}
      {showTermsModal && (
        <div className="fixed inset-0 z-[70] flex h-[100dvh] items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="flex h-[100dvh] w-full max-w-lg flex-col overflow-hidden bg-white shadow-2xl sm:h-auto sm:max-h-[85dvh] sm:rounded-2xl">
            <div
              className="flex flex-shrink-0 items-center justify-between border-b border-slate-100 px-4 pb-3 sm:px-5 sm:py-4"
              style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-orange-100 flex items-center justify-center flex-shrink-0"><Shield className="w-5 h-5 text-orange-600" /></div>
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 truncate">{SIGNATURE_TERMS_TITLE}</div>
                  <div className="text-xs text-slate-400">Versão {SIGNATURE_TERMS_VERSION}</div>
                </div>
              </div>
              <button onClick={() => setShowTermsModal(false)} className="p-2 text-slate-400 hover:text-slate-600 flex-shrink-0"><X className="w-5 h-5" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
              {SIGNATURE_TERMS_TEXT.trim() ? (
                <div>
                  {parseSignatureTermsText(SIGNATURE_TERMS_TEXT, SIGNATURE_TERMS_TITLE).map((b, i) => {
                    if (b.type === 'h2') {
                      return (
                        <h2 key={i} className="text-[15px] font-bold text-slate-900 tracking-tight mt-7 first:mt-0 mb-2.5">
                          {b.text}
                        </h2>
                      );
                    }
                    if (b.type === 'li') {
                      return (
                        <div key={i} className="flex gap-2.5 mb-1.5 pl-1">
                          <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0" />
                          <span className="text-[13.5px] text-slate-600 leading-relaxed">{b.text}</span>
                        </div>
                      );
                    }
                    return (
                      <p key={i} className="text-[13.5px] text-slate-600 leading-relaxed mb-3">
                        {b.text}
                      </p>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  O texto dos Termos de Uso ainda será publicado.
                </div>
              )}
            </div>
            <div
              className="flex flex-shrink-0 gap-2 border-t border-slate-100 px-4 pt-3 sm:px-5 sm:py-4"
              style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
            >
              <button onClick={() => setShowTermsModal(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100">Fechar</button>
              <button
                onClick={() => { marcarAceiteDosTermos(true); setShowTermsModal(false); }}
                data-guia="aceite-modal"
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 flex items-center justify-center gap-2"
              >
                <CheckCircle className="w-4 h-4" />
                Li e aceito
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de recusa */}
      {isRefuseModalOpen && (
        <div className="fixed inset-0 z-[60] flex h-[100dvh] items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="flex max-h-[100dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
            <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3 sm:px-5 sm:py-4">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-lg bg-rose-100 flex items-center justify-center"><X className="w-5 h-5 text-rose-600" /></div>
                <div className="font-semibold text-slate-900">Recusar assinatura</div>
              </div>
              <button onClick={() => !refusing && setIsRefuseModalOpen(false)} className="p-2 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="min-h-0 space-y-3 overflow-y-auto p-4 sm:p-5">
              <p className="text-sm text-slate-600">Descreva o motivo da recusa. O responsável pelo documento será notificado e esta ação ficará registrada.</p>
              <textarea
                value={refuseReason}
                onChange={(e) => setRefuseReason(e.target.value)}
                rows={4}
                placeholder="Ex.: Os dados do documento estão incorretos."
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-400 resize-none"
              />
              {refuseError && <p className="text-xs text-rose-600">{refuseError}</p>}
            </div>
            <div
              className="flex flex-shrink-0 gap-2 border-t border-slate-100 px-4 pt-3 sm:px-5 sm:py-4"
              style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
            >
              <button onClick={() => !refusing && setIsRefuseModalOpen(false)} disabled={refusing} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50">Cancelar</button>
              <button onClick={handleRefuse} disabled={refusing || refuseReason.trim().length < 3} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {refusing ? <><Loader2 className="w-4 h-4 animate-spin" />Recusando…</> : 'Confirmar recusa'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal - Full screen no mobile */}
      {isSignModalOpen && (
        <div className="tema-proprio fixed inset-0 z-50 flex h-[100dvh] min-w-0 flex-col bg-slate-900/50 md:items-center md:justify-center md:backdrop-blur-sm">
          <div className="flex h-[100dvh] min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[#f8fafc] md:h-auto md:max-h-[92dvh] md:max-w-lg md:rounded-2xl md:shadow-2xl">
            {/*
              Cabeçalho.

              Era o mesmo painel ESCURO do antigo comprovante — e o comprovante
              deixou de ser escuro. Sobrando sozinho, ele virava a única faixa
              preta de todo o fluxo, logo acima de uma tela clara. Agora é a
              mesma barra do leitor: marca discreta à esquerda, fechar à direita,
              e o fio de cor logo abaixo, na régua.
            */}
            <div
              className="flex flex-shrink-0 items-center justify-between gap-4 border-b bg-white px-4 pb-2.5 sm:px-5"
              style={{ borderColor: '#e7e5e4', paddingTop: 'max(0.7rem, env(safe-area-inset-top))' }}
            >
              <div className="flex min-w-0 items-center gap-2">
                <BrandLogo iconOnly size="xs" />
                <span style={{ fontFamily: BRAND_SERIF, fontWeight: 700, fontSize: 13, letterSpacing: '-0.012em', color: '#1A1613' }}>
                  {BRAND_WORDMARK.lead}
                  <span style={{ color: BRAND_DOT }}>{BRAND_WORDMARK.dot}</span>
                  <span style={{ fontWeight: 400, color: '#a8a29e' }}>{BRAND_WORDMARK.tld}</span>
                </span>
              </div>
              <button
                onClick={closeSignModal}
                aria-label="Fechar"
                className="-mr-1 flex-shrink-0 rounded-lg p-2 transition-colors hover:bg-slate-100"
                style={{ color: TINTA_3 }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Régua de progresso */}
            <SignStepper current={signStepNumber(modalStep)} />

            <div
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#f8fafc] px-4 pt-4 sm:px-5 sm:pt-5"
              style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
            >
              {/* Etapa 1: Autenticação / Identificação */}
              {/* Etapa 1 — mora em `publicSigning/EtapaDeIdentidade` para caber
                  na bancada de dev; a explicação do redesenho está lá. */}
              {modalStep === 'google_auth' && (
                <EtapaDeIdentidade
                  metodos={{
                    google: authConfig.google,
                    whatsapp: authConfig.whatsapp,
                    email: authConfig.email,
                    phone: authConfig.phone,
                  }}
                  telefoneMascarado={mascararTelefone(telefoneDoCadastro)}
                  emailMascarado={mascararEmail(emailDoCadastro)}
                  enviando={
                    emailOtpLoading ? 'email'
                    : phoneOtpLoading ? phoneOtpChannel
                    : null
                  }
                  refBotaoGoogle={googleButtonRef}
                  googleCarregando={googleAuthLoading}
                  googleErro={googleAuthError}
                  googleNome={googleUser?.name}
                  googleEmail={googleUser?.email}
                  onContinuarComGoogle={() => setModalStep(isSignerDataComplete(signerData) ? 'signature' : 'data')}
                  urlDeAjuda={buildWhatsappUrl(
                    officeWhatsapp,
                    `Olá! Preciso de ajuda para assinar o documento: ${(request?.document_name || 'documento').trim()}. Token: ${token}`,
                  )}
                  cabecalho={
                    <StepHeading
                      /* O nome do documento saiu daqui: "KIT CONSUMIDOR - PEDRO
                         RODRIGUES MONTALVAO NETO" no meio da frase empurrava a
                         nota para três linhas e roubava a atenção de quem já
                         está lendo o documento atrás do modal. */
                      title={
                        primeiroNome(signer?.name)
                          ? <>Confirme que é você, <Accent>{primeiroNome(signer?.name)}</Accent>.</>
                          : <>Confirme que é <Accent>você</Accent>.</>
                      }
                      note="Escolha por onde receber o código de 6 dígitos." 
                    />
                  }
                  onEscolher={(metodo) => {
                    if (metodo === 'email') {
                      setModalStep('email_otp');
                      if (jaPodeEnviarCodigo('email')) void handleSendEmailOtp(emailDoCadastro);
                      return;
                    }
                    if (phoneOtpChannel !== metodo) setPhoneOtpSent(false);
                    setPhoneOtpChannel(metodo);
                    setModalStep('phone_otp');
                    if (jaPodeEnviarCodigo(metodo)) void handleSendPhoneOtp(telefoneDoCadastro, metodo);
                  }}
                />
              )}

              {/* Etapa: Verificação por telefone — DUAS TELAS.
                  Pedir o número e digitar o código são momentos diferentes, e
                  empilhar os dois deixava o campo do código aparecendo embaixo
                  do telefone com o botão "Reenviar" no meio: três coisas
                  competindo, e nenhuma dizendo qual é o próximo gesto. Agora a
                  primeira tela só coleta o número; a segunda só recebe o
                  código, e mostra para onde ele foi. */}
              {modalStep === 'phone_otp' && (
                <div>
                  <StepHeading
                    title={
                      phoneOtpSent
                        ? <>Digite o <Accent>código</Accent>.</>
                        : <>Onde o código<br />vai <Accent>chegar</Accent>.</>
                    }
                    note={
                      phoneOtpSent
                        ? <>Enviamos 6 dígitos {phoneOtpChannel === 'whatsapp' ? 'pelo WhatsApp' : 'por SMS'} para{' '}
                            <strong className="font-semibold tabular-nums text-[#141B26]">+55 {formatarTelefoneBR(signerData.phone)}</strong>.</>
                        : phoneOtpChannel === 'whatsapp'
                          ? 'O número precisa ser o mesmo que você usa no aplicativo.'
                          : 'O código chega por mensagem de texto.'
                    }
                  />

                  {phoneOtpError && (
                    <div className="mt-4 border border-[#E0B4B4] bg-[#FDF4F4] p-3 text-[12.5px] leading-[1.5] text-[#8C3A3A]">
                      {phoneOtpError}
                    </div>
                  )}

                  {!phoneOtpSent ? (
                    /* ── Tela 1: o número ────────────────────────────────── */
                    <div className="mt-5">
                      {/* O NÚMERO é o dado principal desta tela. Quem digita o
                          próprio telefone precisa CONFERIR o que digitou antes
                          de mandar, e conferir onze dígitos colados é
                          exatamente o que ninguém faz. */}
                      <FieldLabel>{phoneOtpChannel === 'whatsapp' ? 'Seu número de WhatsApp' : 'Seu telefone com DDD'}</FieldLabel>
                      <div className="flex items-stretch border border-[#E0DAD1] bg-white transition-colors focus-within:border-[#EA5310] focus-within:ring-[3px] focus-within:ring-[#EA5310]/15">
                        {/* Bandeira + código. A bandeira sozinha seria bonita e
                            ambígua: no Windows o emoji vira as letras "BR", e
                            vários países dividem o formato de número. */}
                        <span className="flex select-none items-center gap-1.5 border-r border-[#EFEAE3] bg-[#FAF9F7] px-3.5">
                          <span className="text-lg leading-none" role="img" aria-label="Brasil">🇧🇷</span>
                          <span className="text-sm font-medium text-[#A0968C]">+55</span>
                        </span>
                        <input
                          data-guia="telefone"
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel-national"
                          value={formatarTelefoneBR(signerData.phone)}
                          onChange={(e) => setSignerData((d) => ({ ...d, phone: formatarTelefoneBR(e.target.value) }))}
                          placeholder="(65) 98404-6375"
                          className="w-full bg-transparent px-4 py-3.5 text-xl font-semibold tabular-nums text-[#141B26] outline-none placeholder:text-lg placeholder:font-normal placeholder:text-[#CFC7BC]"
                        />
                      </div>
                      <p className="mt-2 text-[11px] leading-[1.5] text-[#8A8078]">
                        Confira antes de enviar: o código chega neste número
                        {phoneOtpChannel === 'whatsapp' ? ', no aplicativo.' : ', por SMS.'}
                      </p>

                      <div className="mt-5 flex flex-col gap-2">
                        <PrimaryButton
                          type="button"
                          onClick={() => { void handleSendPhoneOtp(); }}
                          disabled={phoneOtpLoading || phoneOtpResendIn > 0 || signerData.phone.replace(/\D/g, '').length < 10}
                        >
                          {phoneOtpLoading
                            ? 'Enviando…'
                            : phoneOtpResendIn > 0
                              ? `Aguarde ${contagemRegressiva(phoneOtpResendIn)}`
                              : 'Enviar código'}
                        </PrimaryButton>
                        <GhostButton type="button" onClick={() => setModalStep('google_auth')}>Voltar</GhostButton>
                      </div>
                    </div>
                  ) : (
                    /* ── Tela 2: o código ────────────────────────────────── */
                    <div className="mt-5">
                      <input
                        data-guia="codigo-telefone"
                        ref={phoneOtpInputRef}
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        autoFocus
                        maxLength={6}
                        value={phoneOtp}
                        onChange={(e) => setPhoneOtp(e.target.value.replace(/\D/g, ''))}
                        placeholder="000000"
                        className="w-full border border-[#E0DAD1] bg-white py-4 pl-[0.5em] text-center text-3xl font-bold tabular-nums tracking-[0.5em] text-[#141B26] outline-none transition-colors focus:border-[#EA5310] focus:ring-[3px] focus:ring-[#EA5310]/15 placeholder:font-normal placeholder:text-[#CFC7BC]"
                      />

                      {/* O relógio da validade, como linha de recibo. Vale mais
                          que "válido até 21:47": ninguém quer fazer a conta com
                          o relógio da parede, quer saber quanto ainda tem. */}
                      <div className="mt-3 flex items-center justify-between border-t border-dashed border-[#DDD6CC] pt-2.5">
                        {phoneOtpRemaining > 0 ? (
                          <span className="flex items-center gap-1.5 text-[11px] text-[#8A8078]">
                            <Clock className="h-3.5 w-3.5 text-[#A0968C]" />
                            Expira em <span className="font-bold tabular-nums tracking-[0.06em] text-[#141B26]">{contagemRegressiva(phoneOtpRemaining)}</span>
                          </span>
                        ) : (
                          <span className="text-[11px] font-semibold text-[#C0392B]">Código expirado</span>
                        )}
                        <button
                          type="button"
                          onClick={() => { void handleSendPhoneOtp(); }}
                          disabled={phoneOtpLoading || phoneOtpResendIn > 0}
                          className="text-[11px] font-semibold text-[#C2500F] transition-colors hover:text-[#A34209] disabled:text-[#B4ACA3]"
                        >
                          {phoneOtpResendIn > 0 ? `Reenviar em ${contagemRegressiva(phoneOtpResendIn)}` : 'Reenviar'}
                        </button>
                      </div>

                      <div className="mt-4">
                        <PrimaryButton
                          type="button"
                          onClick={handleVerifyPhoneOtp}
                          disabled={phoneOtpLoading || phoneOtp.length < 6 || phoneOtpRemaining <= 0}
                        >
                          {phoneOtpLoading ? 'Validando…' : 'Validar e continuar'}
                        </PrimaryButton>
                      </div>

                      {phoneOtpFails > 0 && <div className="mt-4"><SaidaPorOutroCaminho atual="phone" /></div>}

                      <div className="mt-2">
                        <GhostButton
                          type="button"
                          onClick={() => { setPhoneOtpSent(false); setPhoneOtp(''); setPhoneOtpError(null); }}
                        >
                          Usar outro número
                        </GhostButton>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {modalStep === 'email_otp' && (
                <div>
                  <StepHeading
                    title={emailOtpSent ? <>Digite o <Accent>código</Accent>.</> : <>Para onde<br />vai o <Accent>código</Accent>.</>}
                    note={
                      emailOtpSent
                        ? <>Enviamos 6 dígitos para <strong className="font-semibold text-[#141B26] break-all">{emailToVerify}</strong>.</>
                        : 'Confirme o endereço que recebe o código.'
                    }
                  />

                  {emailOtpError && (
                    <div className="mt-4 border border-[#E0B4B4] bg-[#FDF4F4] p-3 text-[12.5px] leading-[1.5] text-[#8C3A3A]">
                      {emailOtpError}
                    </div>
                  )}

                  {/* Etapa 1: enviar e-mail */}
                  {!emailOtpSent && (
                    <div className="mt-5">
                      <FieldLabel>Seu e-mail</FieldLabel>
                      <input
                        data-guia="email"
                        type="email"
                        inputMode="email"
                        value={emailToVerify}
                        onChange={(e) => setEmailToVerify(e.target.value)}
                        placeholder="seuemail@exemplo.com"
                        className={`${INPUT_CLS} ${INPUT_OK} placeholder:font-normal placeholder:text-[#CFC7BC]`}
                      />

                      {showEmailAnimation && (
                        <div className="mt-3 flex items-center justify-center gap-2 border border-[#E4DED5] bg-white py-3 text-[12px] font-semibold text-[#C2500F]">
                          <Mail className="h-4 w-4 animate-pulse" />
                          Enviando…
                        </div>
                      )}

                      <div className="mt-5 flex flex-col gap-2">
                        <PrimaryButton
                          type="button"
                          onClick={() => { void handleSendEmailOtp(); }}
                          disabled={emailOtpLoading || emailOtpResendIn > 0}
                        >
                          {emailOtpLoading ? (
                            <><Loader2 className="h-4 w-4 animate-spin" />Enviando…</>
                          ) : emailOtpResendIn > 0 ? (
                            `Aguarde ${contagemRegressiva(emailOtpResendIn)}`
                          ) : (
                            'Enviar código'
                          )}
                        </PrimaryButton>
                        <GhostButton type="button" onClick={() => setModalStep('google_auth')}>Voltar</GhostButton>
                      </div>
                    </div>
                  )}

                  {/* Etapa 2: inserir código */}
                  {emailOtpSent && (
                    <div className="mt-5">
                      <input
                        data-guia="codigo-email"
                        ref={emailOtpInputRef}
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={emailOtp}
                        onChange={(e) => setEmailOtp(e.target.value)}
                        placeholder="000000"
                        autoFocus
                        className="w-full border border-[#E0DAD1] bg-white py-4 pl-[0.5em] text-center text-3xl font-bold tabular-nums tracking-[0.5em] text-[#141B26] outline-none transition-colors focus:border-[#EA5310] focus:ring-[3px] focus:ring-[#EA5310]/15 placeholder:font-normal placeholder:text-[#CFC7BC]"
                      />

                      {/* Relógio da validade como linha de recibo. */}
                      <div className="mt-3 flex items-center justify-between border-t border-dashed border-[#DDD6CC] pt-2.5">
                        {emailOtpExpiresAt && emailOtpRemaining <= 0 ? (
                          <span className="text-[11px] font-semibold text-[#C0392B]">Código expirado</span>
                        ) : emailOtpExpiresAt ? (
                          <span className="flex items-center gap-1.5 text-[11px] text-[#8A8078]">
                            <Clock className="h-3.5 w-3.5 text-[#A0968C]" />
                            Expira em{' '}
                            <span className="font-bold tabular-nums tracking-[0.06em] text-[#141B26]">
                              {String(Math.floor(emailOtpRemaining / 60)).padStart(2, '0')}:
                              {String(emailOtpRemaining % 60).padStart(2, '0')}
                            </span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-[#8A8078]">Não recebeu?</span>
                        )}
                        <button
                          type="button"
                          onClick={() => { void handleSendEmailOtp(); }}
                          disabled={emailOtpLoading || emailOtpResendIn > 0}
                          className="text-[11px] font-semibold text-[#C2500F] transition-colors hover:text-[#A34209] disabled:text-[#B4ACA3]"
                        >
                          {emailOtpLoading
                            ? 'Reenviando…'
                            : emailOtpResendIn > 0
                              ? `Reenviar em ${contagemRegressiva(emailOtpResendIn)}`
                              : 'Reenviar'}
                        </button>
                      </div>

                      <div className="mt-4">
                        <PrimaryButton
                          type="button"
                          onClick={handleVerifyEmailOtp}
                          disabled={emailOtpLoading || emailOtp.replace(/\D/g, '').length < 4}
                        >
                          {emailOtpLoading ? (
                            <><Loader2 className="h-4 w-4 animate-spin" />Validando…</>
                          ) : (
                            'Validar e continuar'
                          )}
                        </PrimaryButton>
                      </div>

                      {emailOtpFails > 0 && <div className="mt-4"><SaidaPorOutroCaminho atual="email" /></div>}

                      <div className="mt-2">
                        <GhostButton type="button" onClick={() => setEmailOtpSent(false)}>Usar outro e-mail</GhostButton>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {modalStep === 'data' && (
                <div>
                  {googleUser && (
                    <div className="mb-4 flex items-center gap-2.5 border border-[#CBE5D8] bg-[#F1F9F5] px-3 py-2.5">
                      <CheckCircle className="h-4 w-4 flex-shrink-0 text-[#1F7A55]" />
                      <div className="min-w-0">
                        <p className="text-[11.5px] font-bold text-[#1F7A55]">Identidade confirmada</p>
                        <p className="truncate text-[10.5px] text-[#4E8F73]">{googleUser.email}</p>
                      </div>
                    </div>
                  )}

                  <StepHeading
                    title={<>Seus <Accent>dados</Accent>.</>}
                    note="É assim que seu nome e CPF vão aparecer no documento assinado."
                  />

                  <div className="mt-5">
                    <FieldLabel>Nome completo</FieldLabel>
                    <input
                      type="text"
                      data-guia="nome"
                      value={signerData.name}
                      onChange={(e) => setSignerData((d) => ({ ...d, name: e.target.value }))}
                      placeholder="Digite seu nome completo"
                      className={`${INPUT_CLS} ${INPUT_OK} placeholder:font-normal placeholder:text-[#CFC7BC]`}
                    />
                  </div>

                  <div className="mt-4">
                    <FieldLabel>CPF</FieldLabel>
                    <input
                      type="text"
                      inputMode="numeric"
                      data-guia="cpf"
                      maxLength={14}
                      value={signerData.cpf}
                      onChange={(e) => setSignerData((d) => ({ ...d, cpf: formatCpf(e.target.value) }))}
                      placeholder="000.000.000-00"
                      className={`${INPUT_CLS} ${cpfMismatch || cpfInvalido ? INPUT_BAD : INPUT_OK} tabular-nums placeholder:font-normal placeholder:text-[#CFC7BC]`}
                    />
                    {cpfInvalido && (
                      <p className="mt-1.5 text-[11.5px] leading-[1.5] text-[#C0392B]">
                        Este CPF não existe — confira os números digitados.
                      </p>
                    )}
                    {!cpfInvalido && cpfMismatch && (
                      <p className="mt-1.5 text-[11.5px] leading-[1.5] text-[#C0392B]">
                        O CPF informado não confere com o CPF do cliente cadastrado para esta assinatura.
                      </p>
                    )}
                  </div>

                  <div className="mt-4 border-t border-dashed border-[#DDD6CC] pt-2.5 text-[10.5px] leading-[1.5] text-[#8A8078]">
                    O CPF é conferido contra o cadastro do escritório. Se não bater, avisamos aqui antes de você continuar.
                  </div>

                  <div className="mt-5">
                    <PrimaryButton data-guia="continuar-dados" onClick={() => setModalStep('signature')} disabled={!canProceedFromData}>
                      Continuar
                      <ChevronRight className="h-4 w-4" strokeWidth={2.4} />
                    </PrimaryButton>
                  </div>
                </div>
              )}

              {/* Etapa 3: Assinatura */}
              {modalStep === 'signature' && (
                <div>
                  <StepHeading
                    title={<>Assine com o <Accent>dedo</Accent>.</>}
                    note="Desenhe no quadro abaixo. Dá para refazer quantas vezes quiser."
                  />

                  {/* Folha branca com linha-base e o nome impresso embaixo, como
                      um recibo — no lugar da caixa tracejada com sombra interna
                      e do botão preto "Limpar" de largura total. */}
                  <div data-guia="quadro" className="relative mt-4 h-[clamp(180px,31dvh,238px)] min-h-[180px] border border-[#E0DAD1] bg-white">
                    <canvas
                      ref={canvasRef}
                      className="absolute inset-0 h-full w-full touch-none cursor-crosshair"
                      onMouseDown={startDrawing}
                      onMouseMove={draw}
                      onMouseUp={stopDrawing}
                      onMouseLeave={stopDrawing}
                      onTouchStart={startDrawing}
                      onTouchMove={draw}
                      onTouchEnd={stopDrawing}
                    />

                    {/* O canvas é preenchido de branco opaco no initCanvas, então
                        a linha-base e o rótulo TÊM de vir depois dele no DOM para
                        aparecerem. São só guias: pointer-events-none mantém o toque
                        no canvas, e nada disso entra na imagem salva. */}
                    <div aria-hidden="true" className="pointer-events-none absolute inset-x-[22px] bottom-[44px] h-px bg-[#E8E2DA]" />
                    <div aria-hidden="true" className="pointer-events-none absolute bottom-[24px] left-[22px] text-[9px] font-bold uppercase tracking-[0.18em] text-[#B4ACA3]">
                      {signerData.name?.trim() || 'Assinatura do signatário'}
                    </div>

                    {/* Enquanto o quadro está vazio, o dedo mostra o gesto —
                        ver `DemoDoDedo`. O ícone de caneta com "Assine aqui"
                        nomeava a tarefa; isto ensina como fazê-la. Some no
                        primeiro toque. */}
                    {!hasSignature && (
                      <div className="pointer-events-none absolute inset-x-[18px] bottom-[52px] top-[14px]">
                        <DemoDoDedo />
                      </div>
                    )}

                    {hasSignature && (
                      <button
                        type="button"
                        onClick={clearSignature}
                        className="absolute right-3 top-3 flex items-center gap-1.5 border border-[#E8E2DA] bg-white px-2.5 py-1.5 text-[10px] font-semibold text-[#8A8078] transition-colors hover:border-[#D2C8BC] hover:text-[#141B26]"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Refazer
                      </button>
                    )}
                  </div>

                  <div className="mt-5">
                    <PrimaryButton
                      data-guia="continuar-assinatura"
                      onClick={() => { saveSignature(); setModalStep('location'); }}
                      disabled={!hasSignature}
                    >
                      Continuar
                      <ChevronRight className="h-4 w-4" strokeWidth={2.4} />
                    </PrimaryButton>
                  </div>
                </div>
              )}

              {/* Etapa 4: Localização */}
              {modalStep === 'location' && (
                <div>
                  <StepHeading
                    title={<>Onde você está <Accent>agora</Accent>.</>}
                    note="A localização entra no comprovante e é o que sustenta a assinatura se ela for contestada."
                  />

                  {/* Quadrado escuro — o mesmo tratamento do selo de validação
                      do comprovante — no lugar do círculo laranja com anel. */}
                  <div className="mt-5 border border-[#E4DED5] bg-white p-4">
                    <div className="mb-3 flex h-11 w-11 items-center justify-center" style={{ backgroundColor: '#0C1320' }}>
                      <MapPin className="h-5 w-5" style={{ color: BRAND_DOT_ON_DARK }} strokeWidth={1.8} />
                    </div>
                    <p className="text-[13px] font-bold text-[#141B26]">O navegador vai pedir permissão</p>
                    <p className="mt-1.5 text-[11.5px] leading-[1.55] text-[#7C8797]">
                      Toque em “Permitir” quando a caixa do seu navegador aparecer. Nada é gravado além da coordenada deste momento.
                    </p>
                    <div className="mt-3 border-t border-dashed border-[#DDD6CC] pt-2.5 text-[10.5px] leading-[1.5] text-[#8A8078]">
                      Coleta única, no ato da assinatura. Não há rastreamento contínuo.
                    </div>
                  </div>

                  {locationError && (
                    <div className="mt-4 border border-[#E0B4B4] bg-[#FDF4F4] p-3 text-[12.5px] leading-[1.5] text-[#8C3A3A]">
                      {locationError}
                    </div>
                  )}

                  {locationData && (
                    <div className="mt-4 flex items-center gap-2.5 border border-[#CBE5D8] bg-[#F1F9F5] px-3 py-2.5">
                      <CheckCircle className="h-4 w-4 flex-shrink-0 text-[#1F7A55]" />
                      <p className="text-[12px] font-semibold text-[#1F7A55]">Localização capturada.</p>
                    </div>
                  )}

                  <div className="mt-5 flex flex-col gap-2">
                    {locationData ? (
                      <PrimaryButton data-guia="continuar-local" onClick={() => setModalStep('facial')}>
                        Continuar
                        <ChevronRight className="h-4 w-4" strokeWidth={2.4} />
                      </PrimaryButton>
                    ) : (
                      <PrimaryButton data-guia="permitir-local" onClick={requestLocation} disabled={locationLoading}>
                        {locationLoading ? (
                          <><Loader2 className="h-4 w-4 animate-spin" />Obtendo localização…</>
                        ) : (
                          <><MapPin className="h-4 w-4" />Permitir localização</>
                        )}
                      </PrimaryButton>
                    )}
                  </div>
                </div>
              )}

              {/* Etapa 5: Verificação facial */}
              {modalStep === 'facial' && (
                <div>
                  <StepHeading
                    title={<>Enquadre seu <Accent>rosto</Accent>.</>}
                    note="Enquadre o rosto no oval e toque no botão para tirar a foto."
                  />

                  {/* A conferência é o momento em que a obstrução é julgada, e
                      ela demora alguns segundos. Dizer isso em voz alta é melhor
                      do que uma tela parada: quem espera sabendo, espera. */}
                  {facialValidating && (
                    <div className="mt-4 flex items-start gap-2.5 border border-[#E8CDB4] bg-[#FDF6EE] px-3.5 py-3">
                      <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-[#C2500F]" />
                      <div className="min-w-0">
                        <div className="text-[12.5px] font-bold text-[#8A4A15]">Conferindo sua foto…</div>
                        <div className="mt-0.5 text-[11px] leading-[1.5] text-[#A66B33]">Checando se o rosto aparece inteiro e sem nada cobrindo. Leva alguns segundos.</div>
                      </div>
                    </div>
                  )}

                  {facialValidation && facialValidation.valid === false && (
                    <div className="mt-4 flex items-start gap-2.5 border border-[#E0B4B4] bg-[#FDF4F4] px-3.5 py-3">
                      <AlertTriangle className="h-4 w-4 flex-shrink-0 text-[#C0392B]" />
                      <div className="min-w-0">
                        <div className="text-[12.5px] font-bold text-[#8C3A3A]">Foto não aprovada</div>
                        <div className="mt-0.5 text-[11px] leading-[1.5] text-[#A55]">{facialValidation.message}</div>
                        <div className="mt-1 text-[10.5px] font-semibold text-[#8C3A3A]">
                          A câmera volta em instantes — depois toque no botão para tentar de novo.
                        </div>
                      </div>
                    </div>
                  )}

                  {facialData ? (
                    <div className="mt-4">
                      <div
                        className={`border p-4 ${
                          facialValidation?.valid === false
                            ? 'border-[#E0B4B4] bg-[#FDF4F4]'
                            : 'border-[#CBE5D8] bg-[#F1F9F5]'
                        }`}
                      >
                        <div className="flex flex-col items-center">
                          <img
                            src={facialData}
                            alt="Foto"
                            className="w-[108px] border border-white object-cover shadow-sm"
                            /* Sem espelho: é o arquivo guardado, não o visor.
                               O carimbo gravado na imagem é a prova — espelhado
                               ele fica de trás para frente. O <video> ali
                               embaixo continua espelhado, que é o certo. */
                            style={{ aspectRatio: `${FOTO_PROPORCAO}` }}
                          />
                          <p
                            className={`mt-3 text-[13px] font-bold ${
                              facialValidation?.valid === false ? 'text-[#8C3A3A]' : 'text-[#1F7A55]'
                            }`}
                          >
                            {facialValidating
                              ? 'Analisando foto…'
                              : facialValidation?.valid === false
                                ? 'Tire outra foto'
                                : 'Foto aprovada'}
                          </p>
                          <p className={`mt-1 text-center text-[11px] leading-[1.5] ${facialValidation?.valid === false ? 'text-[#A55]' : 'text-[#4E8F73]'}`}>
                            {facialValidating
                              ? 'Precisamos ver seu rosto com nitidez.'
                              : facialValidation?.valid === false
                                ? 'Deixe o rosto totalmente visível (sem cobrir) e tire a foto sem tremer.'
                                : 'Verificação concluída'}
                          </p>
                        </div>
                      </div>

                      {/* Refazer aparece SÓ quando a foto é reprovada. Durante a
                          análise e ao aprovar (avança sozinho) ele some. */}
                      {facialValidation?.valid === false && (
                        <div className="mt-4">
                          <GhostButton
                            onClick={() => { setFacialData(null); setFacialValidation(null); startCamera(); }}
                          >
                            <RotateCcw className="h-4 w-4" />
                            Tirar novamente
                          </GhostButton>
                        </div>
                      )}

                      {!facialValidating && facialValidation?.valid !== false && (
                        <div className="mt-4 flex items-center justify-center gap-2 text-[12px] text-[#8A8078]">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Avançando…
                        </div>
                      )}
                    </div>
                  ) : !cameraActive ? (
                    <div className="mt-4">
                      <div className="border border-[#E4DED5] bg-white p-4">
                        <div className="mb-3 flex h-11 w-11 items-center justify-center" style={{ backgroundColor: '#0C1320' }}>
                          <Camera className="h-5 w-5" style={{ color: BRAND_DOT_ON_DARK }} strokeWidth={1.8} />
                        </div>
                        <p className="text-[13px] font-bold text-[#141B26]">Permitir acesso à câmera</p>
                        <p className="mt-1.5 text-[11.5px] leading-[1.55] text-[#7C8797]">
                          Ao tocar em “Ativar câmera”, o navegador vai pedir sua autorização. A imagem não sai deste dispositivo antes de você confirmar.
                        </p>
                        {cameraError && (
                          <div className="mt-3 border border-[#E0B4B4] bg-[#FDF4F4] px-3 py-2.5 text-[12px] leading-[1.5] text-[#8C3A3A]">
                            {cameraError}
                          </div>
                        )}
                      </div>

                      <div className="mt-5 flex flex-col gap-2">
                        <PrimaryButton data-guia="abrir-camera" type="button" onClick={startCamera}>
                          <Camera className="h-4 w-4" />
                          Ativar câmera
                        </PrimaryButton>
                        <GhostButton type="button" onClick={() => setModalStep('signature')}>
                          <ChevronLeft className="h-4 w-4" />
                          Voltar
                        </GhostButton>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4">
                      {/* Visor no mesmo #0C1320 do painel de marca, com cantos de
                          enquadramento no lugar do círculo branco pulsante. */}
                      {/* Retrato 3:4, o formato de foto de celular. A altura
                          continua presa ao viewport (o visor não pode empurrar o
                          botão para fora da tela) e a LARGURA é que sai dela, para
                          o enquadramento ser o mesmo que capturePhoto recorta. */}
                      <div
                        className="relative mx-auto overflow-hidden"
                        style={{
                          backgroundColor: '#0C1320',
                          height: 'clamp(260px, 44dvh, 380px)',
                          aspectRatio: `${FOTO_PROPORCAO}`,
                        }}
                      >
                        <video
                          ref={videoRef}
                          autoPlay
                          playsInline
                          muted
                          className="h-full w-full object-cover"
                          style={{ transform: 'scaleX(-1)' }}
                        />

                        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                          <span className="absolute left-3 top-3 h-[18px] w-[18px] border-l-2 border-t-2 border-white/35" />
                          <span className="absolute right-3 top-3 h-[18px] w-[18px] border-r-2 border-t-2 border-white/35" />
                          <span className="absolute bottom-3 left-3 h-[18px] w-[18px] border-b-2 border-l-2 border-white/35" />
                          <span className="absolute bottom-3 right-3 h-[18px] w-[18px] border-b-2 border-r-2 border-white/35" />
                          {/* O oval fecha em linha cheia e verde no instante em
                              que o rosto entra: é o sinal que ensina sozinho o
                              que o botão está esperando. */}
                          <span
                            className={`absolute left-1/2 top-[46%] h-[64%] w-[64%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-2 transition-colors duration-200 ${
                              deteccaoRosto.estado === 'pronto' ? 'border-solid' : 'border-dashed'
                            }`}
                            style={{
                              borderColor:
                                deteccaoRosto.estado === 'pronto'
                                  ? 'rgba(52,211,153,0.95)'
                                  : 'rgba(242,132,62,0.75)',
                            }}
                          />
                          <span
                            className={`absolute inset-x-0 bottom-3.5 px-3 text-center text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors ${
                              deteccaoRosto.estado === 'pronto' ? 'text-emerald-300' : 'text-white/60'
                            }`}
                          >
                            {deteccaoRosto.dica}
                          </span>

                        </div>
                      </div>

                      <div className="mt-5">
                        {/* O único jeito de a foto sair: o dedo. O botão fica
                            travado até o detector ver um rosto — e o oval fecha
                            em verde no mesmo instante, que é o sinal de que ele
                            destravou. */}
                        <PrimaryButton
                          data-guia="tirar-foto"
                          onClick={() => { void capturePhoto(); }}
                          disabled={!deteccaoRosto.liberado}
                        >
                          <Camera className="h-4 w-4" />
                          Tirar foto agora
                        </PrimaryButton>
                        <p className="mt-2 text-center text-[11px] leading-[1.5] text-[#8A8078]">
                          {deteccaoRosto.estado === 'carregando'
                            ? 'Preparando o enquadramento…'
                            : deteccaoRosto.liberado
                              ? 'Quando estiver bom para você, toque no botão.'
                              : 'O botão libera assim que seu rosto aparecer.'}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Etapa final: Autorização e confirmação */}
              {modalStep === 'confirm' && (
                <div>
                  <StepHeading
                    title={<>Tudo pronto para <Accent>assinar</Accent>.</>}
                    note="Confira o que vai ficar registrado e assine."
                  />

                  {/* O resumo do que foi coletado, em formato de recibo, ANTES
                      de pedir o aceite. Sem ele a etapa pedia autorização para
                      algo que a pessoa não conseguia mais rever. */}
                  <div className="mt-4 border border-[#E4DED5] bg-white">
                    <div className="flex items-center justify-between border-b border-dashed border-[#E8E2DA] px-3 py-2.5">
                      <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#A0968C]">Conferido</span>
                      <CheckCircle className="h-3.5 w-3.5 text-[#1F7A55]" />
                    </div>
                    <div className="px-3 pb-2.5 pt-1">
                      {signerData.name?.trim() && (
                        <div className="flex items-center justify-between gap-3 border-b border-[#F1EDE7] py-2">
                          <span className="flex-none text-[11.5px] text-[#7C8797]">Nome</span>
                          <span className="truncate text-[11.5px] font-semibold text-[#141B26]">{signerData.name}</span>
                        </div>
                      )}
                      {signerData.cpf?.trim() && (
                        <div className="flex items-center justify-between gap-3 border-b border-[#F1EDE7] py-2">
                          <span className="flex-none text-[11.5px] text-[#7C8797]">CPF</span>
                          <span className="truncate text-[11.5px] font-semibold tabular-nums text-[#141B26]">{signerData.cpf}</span>
                        </div>
                      )}
                      {googleUser?.email && (
                        <div className="flex items-center justify-between gap-3 border-b border-[#F1EDE7] py-2">
                          <span className="flex-none text-[11.5px] text-[#7C8797]">Identidade</span>
                          <span className="truncate text-[11.5px] font-semibold text-[#141B26]">{googleUser.email}</span>
                        </div>
                      )}
                      {locationData && (
                        <div className="flex items-center justify-between gap-3 border-b border-[#F1EDE7] py-2">
                          <span className="flex-none text-[11.5px] text-[#7C8797]">Localização</span>
                          <span className="truncate text-[11.5px] font-semibold tabular-nums text-[#141B26]">
                            {locationData.lat.toFixed(4)}, {locationData.lng.toFixed(4)}
                          </span>
                        </div>
                      )}
                      {facialData && (
                        <div className="flex items-center justify-between gap-3 py-2">
                          <span className="flex-none text-[11.5px] text-[#7C8797]">Foto</span>
                          <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[#1F7A55]">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1F7A55" strokeWidth="2.6">
                              <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            Aprovada
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-col gap-2">
                    {/* Aceite dos Termos de Uso (LGPD) — obrigatório para assinar */}
                    <label data-guia="aceite" className="flex cursor-pointer items-center gap-3 border border-[#E0DAD1] bg-white p-3 transition-colors hover:border-[#D2C8BC]">
                      <span className="flex-none">
                        <input
                          type="checkbox"
                          checked={termsAccepted}
                          onChange={(e) => marcarAceiteDosTermos(e.target.checked)}
                          className="sr-only"
                        />
                        <OrangeCheckbox checked={termsAccepted} />
                      </span>
                      <span className="min-w-0 flex-1 text-[11.5px] leading-[1.5] text-[#4F5A69]">
                        Li e aceito os{' '}
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); setShowTermsModal(true); }}
                          className="font-semibold text-[#C2500F] underline decoration-[#C2500F]/40 underline-offset-2"
                        >
                          {SIGNATURE_TERMS_TITLE}
                        </button>{' '}
                        <span className="text-[#A0968C]">({SIGNATURE_TERMS_VERSION})</span>.
                      </span>
                    </label>
                  </div>

                  <div className="mt-5">
                    <PrimaryButton data-guia="assinar-agora" onClick={handleSign} disabled={loading || !termsAccepted}>
                      {loading ? (
                        <><Loader2 className="h-4 w-4 animate-spin" />Enviando…</>
                      ) : (
                        <><CheckCircle className="h-4 w-4" />Assinar documento</>
                      )}
                    </PrimaryButton>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Histórico (overlay) */}
      {activeTab === 'history' && (
        <div className="fixed inset-0 z-[60] flex h-[100dvh] items-end bg-black/50 p-0 md:items-center md:justify-center md:p-6">
          <div className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-[#f8f7f5] shadow-2xl md:max-w-2xl md:rounded-2xl">
            <div className="px-5 py-4 border-b border-[#e7e5df] flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">Histórico da assinatura</div>
                <div className="text-xs text-slate-500 truncate max-w-[70vw] md:max-w-[520px]">{request?.document_name}</div>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('signers')}
                className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition"
                title="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div
              className="min-h-0 flex-1 overflow-auto overscroll-contain p-4 sm:p-5"
              style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
            >
              {auditLogLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Carregando histórico...
                </div>
              ) : auditLogError ? (
                <div className="text-sm text-slate-700">
                  <div className="font-medium">Não foi possível carregar</div>
                  <div className="text-xs text-slate-500 mt-1">{auditLogError}</div>
                </div>
              ) : auditLog.length === 0 ? (
                <div className="text-sm text-slate-600">Nenhum evento registrado.</div>
              ) : (
                <div className="space-y-4">
                  {auditLog.map((item, idx) => {
                    const actionLabel =
                      item.action === 'created' ? 'Solicitação criada' :
                      item.action === 'sent' ? 'Convite enviado' :
                      item.action === 'viewed' ? 'Documento visualizado' :
                      item.action === 'signed' ? 'Documento assinado' :
                      item.action === 'cancelled' ? 'Cancelado' :
                      item.action === 'expired' ? 'Expirado' :
                      item.action === 'reminder_sent' ? 'Lembrete enviado' :
                      'Evento';

                    const dotColor =
                      item.action === 'signed' ? 'bg-emerald-600' :
                      item.action === 'viewed' ? 'bg-orange-600' :
                      item.action === 'cancelled' || item.action === 'expired' ? 'bg-red-600' :
                      'bg-slate-400';

                    return (
                      <div key={item.id} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className={`w-2.5 h-2.5 rounded-full ${dotColor}`} />
                          {idx < auditLog.length - 1 && <div className="w-px flex-1 bg-slate-200 mt-2" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-medium text-slate-900">{actionLabel}</div>
                            <div className="text-xs text-slate-500 whitespace-nowrap">{formatDate(item.created_at)}</div>
                          </div>
                          <div className="text-xs text-slate-600 mt-0.5">{item.description}</div>
                          {(item.ip_address || item.user_agent) && (
                            <div className="mt-2 text-[11px] text-slate-500">
                              {item.ip_address && <div>IP: {item.ip_address}</div>}
                              {item.user_agent && <div className="break-words">Dispositivo: {item.user_agent}</div>}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </>
  );
};

export default PublicSigningPage;
