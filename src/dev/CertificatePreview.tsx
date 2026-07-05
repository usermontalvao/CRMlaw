import React from 'react';
import { PDFDocument, rgb } from 'pdf-lib';
import { Document, Page, pdfjs } from 'react-pdf';
import { pdfSignatureService } from '../services/pdfSignature.service';
import type { AuditLogRow } from '../services/pdfSignature.service';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

/**
 * Harness DEV-ONLY para inspecionar o certificado (3 páginas: capa, biometria,
 * auditoria) com dados 100% sintéticos — sem tocar no Supabase. Acesse via
 * `?certpreview=1`. Não é rota de produção; pode ser removido a qualquer momento.
 */

/** Gera um PNG simples num canvas e embute no doc (assinatura/selfie placeholder). */
async function embedCanvasPng(
  pdfDoc: PDFDocument,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  w: number,
  h: number,
) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, w, h);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  const bytes = new Uint8Array(await blob!.arrayBuffer());
  return pdfDoc.embedPng(bytes);
}

function makeSigner(over: Record<string, unknown>): any {
  return {
    id: 'sgn-0000',
    name: 'Signatário',
    role: 'Assinar',
    status: 'signed',
    order: 0,
    signed_at: '2026-07-03T15:42:11-04:00',
    viewed_at: '2026-07-03T15:39:05-04:00',
    terms_accepted_at: '2026-07-03T15:40:22-04:00',
    terms_version: 'v2',
    cpf: '123.456.789-00',
    email: 'signatario@exemplo.com.br',
    phone: '',
    signer_ip: '187.45.201.13',
    signer_geolocation: JSON.stringify({ coordinates: '-15.5989, -56.0949', address: 'Cuiabá - MT, Brasil' }),
    signer_user_agent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    auth_provider: 'google',
    auth_email: 'signatario@gmail.com',
    auth_google_sub: '108422930175559920184',
    verification_hash: 'a1b2c3d4e5f6a7b8',
    signature_image_path: null,
    facial_image_path: 'mock/selfie.jpg',
    ...over,
  };
}

export default function CertificatePreview() {
  const [url, setUrl] = React.useState<string | null>(null);
  const [numPages, setNumPages] = React.useState(0);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const signerA = makeSigner({
          id: 'sgn-aaaa',
          name: 'Maria Fernanda de Albuquerque Souza',
          role: 'Contratante',
          auth_provider: 'google',
        });
        const signerB = makeSigner({
          id: 'sgn-bbbb',
          name: 'João Carlos Pereira',
          role: 'Testemunha',
          cpf: '987.654.321-00',
          signer_ip: '201.17.88.42',
          auth_provider: 'email_link',
          auth_email: 'joao.pereira@escritorio.adv.br',
          auth_google_sub: undefined,
          verification_hash: 'ff00aa11bb22cc33',
          signed_at: '2026-07-03T16:05:47-04:00',
          viewed_at: '2026-07-03T16:01:12-04:00',
          terms_accepted_at: '2026-07-03T16:03:30-04:00',
          signer_geolocation: JSON.stringify({ coordinates: '-23.5505, -46.6333', address: 'São Paulo - SP, Brasil' }),
        });

        const request: any = {
          id: 'REQ-2026-000487',
          document_name: 'Contrato de Prestação de Serviços Advocatícios — Jurius',
          created_at: '2026-07-03T15:30:00-04:00',
          document_path: null,
        };

        const audit: AuditLogRow[] = [
          { id: 'a1', signer_id: null, action: 'created', description: 'Documento criado', ip_address: '189.10.5.7', user_agent: '', created_at: '2026-07-03T15:30:00-04:00' },
          { id: 'a2', signer_id: 'sgn-aaaa', action: 'viewed', description: 'Documento visualizado', ip_address: '187.45.201.13', user_agent: '', created_at: '2026-07-03T15:39:05-04:00' },
          { id: 'a3', signer_id: 'sgn-bbbb', action: 'viewed', description: 'Documento visualizado', ip_address: '201.17.88.42', user_agent: '', created_at: '2026-07-03T16:01:12-04:00' },
        ];

        // Provider token-scoped substitui todas as leituras diretas ao Supabase.
        pdfSignatureService.setPublicReportDataProvider({
          signers: async () => [signerA, signerB] as any,
          auditLog: async () => audit,
        });

        const pdfDoc = await PDFDocument.create();
        // Página "documento" fictícia (o certificado é anexado após ela).
        const p = pdfDoc.addPage([595.28, 841.89]);
        p.drawText('DOCUMENTO ORIGINAL (mock)', { x: 60, y: 760, size: 14, color: rgb(0.3, 0.3, 0.3) });

        // Assinatura manuscrita placeholder (traço).
        const sigImg = await embedCanvasPng(
          pdfDoc,
          (ctx, w, h) => {
            ctx.clearRect(0, 0, w, h);
            ctx.strokeStyle = '#1f2937';
            ctx.lineWidth = 4;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(20, h * 0.7);
            ctx.bezierCurveTo(w * 0.25, h * 0.1, w * 0.4, h * 0.95, w * 0.55, h * 0.45);
            ctx.bezierCurveTo(w * 0.7, h * 0.05, w * 0.85, h * 0.8, w - 20, h * 0.4);
            ctx.stroke();
          },
          360,
          140,
        );

        // Selfie placeholder (gradiente + rosto estilizado).
        const faceImg = await embedCanvasPng(
          pdfDoc,
          (ctx, w, h) => {
            const g = ctx.createLinearGradient(0, 0, 0, h);
            g.addColorStop(0, '#cbd5e1');
            g.addColorStop(1, '#94a3b8');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#64748b';
            ctx.beginPath();
            ctx.arc(w / 2, h * 0.42, w * 0.18, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.ellipse(w / 2, h * 0.95, w * 0.32, h * 0.35, 0, Math.PI, 0);
            ctx.fill();
          },
          300,
          360,
        );

        await (pdfSignatureService as any).addReportPages({
          pdfDoc,
          request,
          signer: signerA,
          creator: { name: 'Dr. Pedro Montalvão' },
          signatureImage: sigImg,
          facialImage: faceImg,
          qrImage: null,
          verificationUrl: `${window.location.origin}/#/verificar/${signerA.verification_hash}`,
          integritySha256: 'A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0C1D2E3F4A5B6C7D8E9F0A1B2',
        });

        const bytes = await pdfDoc.save();
        const blob = new Blob([bytes as any], { type: 'application/pdf' });
        objectUrl = URL.createObjectURL(blob);
        if (!revoked) setUrl(objectUrl);
      } catch (e: any) {
        console.error('[certpreview]', e);
        setErr(String(e?.message || e));
      } finally {
        pdfSignatureService.setPublicReportDataProvider(null);
      }
    })();
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#334155', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 14px', color: '#fff', fontFamily: 'system-ui', fontSize: 13, display: 'flex', gap: 16, alignItems: 'center' }}>
        <strong>Certificate preview (dev)</strong>
        {url && <a href={url} download="certificado-preview.pdf" style={{ color: '#93c5fd' }}>baixar PDF</a>}
        {err && <span style={{ color: '#fca5a5' }}>Erro: {err}</span>}
        {!url && !err && <span>gerando…</span>}
      </div>
      {url && (
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: 16 }}>
          <Document file={url} onLoadSuccess={({ numPages: n }) => setNumPages(n)}>
            {Array.from({ length: numPages }, (_, i) => (
              <div key={i} style={{ boxShadow: '0 4px 20px rgba(0,0,0,.4)', marginBottom: 16 }}>
                <Page pageNumber={i + 1} width={760} renderTextLayer={false} renderAnnotationLayer={false} />
              </div>
            ))}
          </Document>
        </div>
      )}
    </div>
  );
}
