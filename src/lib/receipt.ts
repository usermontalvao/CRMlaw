/**
 * receipt.ts — Gerador único do Recibo de Honorários.
 *
 * Fonte ÚNICA do documento de recibo. Tanto o módulo Financeiro (advogado)
 * quanto o Portal do Cliente importam daqui, garantindo que o recibo seja
 * exatamente o mesmo nos dois lugares.
 */

const LAWYER_DEFAULT = {
  name: 'PEDRO RODRIGUES MONTALVAO NETO',
  oab: '30.021',
  state: 'MT',
  email: 'pedro@advcuiaba.com',
};

function fmtBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

export function paymentMethodLabel(method?: string | null): string {
  if (!method) return 'Não informado';
  return method === 'pix' ? 'PIX'
    : method === 'transferencia' ? 'Transferência Bancária'
    : method === 'dinheiro' ? 'Dinheiro'
    : method === 'cartao_credito' ? 'Cartão de Crédito'
    : method === 'cartao_debito' ? 'Cartão de Débito'
    : method === 'cheque' ? 'Cheque'
    : 'Não especificado';
}

export function numberToWords(value: number): string {
  const units = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
  const teens = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const tens = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const hundreds = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

  const convertGroup = (n: number): string => {
    if (n === 0) return '';
    if (n === 100) return 'cem';
    const h = Math.floor(n / 100);
    const t = Math.floor((n % 100) / 10);
    const u = n % 10;
    const words: string[] = [];
    if (h > 0) words.push(hundreds[h]);
    if (t === 1) { words.push(teens[u]); }
    else { if (t > 0) words.push(tens[t]); if (u > 0) words.push(units[u]); }
    return words.join(' e ');
  };

  if (value === 0) return 'zero reais';
  const billions = Math.floor(value / 1000000000);
  const millions = Math.floor((value % 1000000000) / 1000000);
  const thousands = Math.floor((value % 1000000) / 1000);
  const remainder = Math.floor(value % 1000);
  const cents = Math.round((value % 1) * 100);

  const words: string[] = [];
  if (billions > 0) words.push(`${convertGroup(billions)} ${billions === 1 ? 'bilhão' : 'bilhões'}`);
  if (millions > 0) words.push(`${convertGroup(millions)} ${millions === 1 ? 'milhão' : 'milhões'}`);
  if (thousands > 0) words.push(`${convertGroup(thousands)} mil`);
  if (remainder > 0) words.push(convertGroup(remainder));

  const reais = words.join(' e ') + ' ' + (value === 1 ? 'real' : 'reais');
  if (cents > 0) return `${reais} e ${convertGroup(cents)} ${cents === 1 ? 'centavo' : 'centavos'}`;
  return reais;
}

export interface ReceiptBreakdownRow {
  label: string;   // ex: "1/5"
  due: string;     // vencimento formatado
  paid: string;    // recebido em formatado
  method: string;  // forma de pagamento (já rotulada)
  value: number;   // valor (honorários) da parcela
}

export interface ReceiptInput {
  clientName: string;
  clientCpf?: string;
  amount: number;                  // honorários recebidos
  description: string;
  serviceDescription?: string;
  paymentMethod?: string;          // já rotulado
  paymentDateDisplay: string;
  agreementTitle: string;
  breakdown?: ReceiptBreakdownRow[];
  lawyer?: Partial<typeof LAWYER_DEFAULT>;
}

export function buildReceiptHtml(input: ReceiptInput): string {
  const lawyer = { ...LAWYER_DEFAULT, ...(input.lawyer || {}) };
  const lawyerTitle = `Dr. ${lawyer.name}`;
  const issueDate = new Date();
  const issueDateFormatted = issueDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  const receiptNumber = `REC-${issueDate.getFullYear()}-${String(issueDate.getMonth() + 1).padStart(2, '0')}-${String(issueDate.getDate()).padStart(2, '0')}-${String(issueDate.getHours()).padStart(2, '0')}${String(issueDate.getMinutes()).padStart(2, '0')}${String(issueDate.getSeconds()).padStart(2, '0')}`;

  const { clientName, clientCpf, amount, description } = input;
  const serviceDescription = input.serviceDescription || 'Serviços advocatícios prestados conforme contrato de honorários.';
  const paymentMethod = input.paymentMethod || 'Não informado';
  const amountInWords = numberToWords(amount || 0);
  const hasBreakdown = !!input.breakdown && input.breakdown.length > 1;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Recibo de Honorários Nº ${receiptNumber}</title>
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet"/>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{font-family:'Inter',system-ui,sans-serif;background:#e8e8e8;color:#1a1a1a;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-size:13px;line-height:1.5}
.wrapper{max-width:720px;margin:0 auto;padding:2rem 1rem}
.page{background:#fff;border:1px solid #c8c8c8;position:relative}
.stripe-top{height:6px;background:#1a2744}
.stripe-green{height:3px;background:#2d6a4f}
.header{padding:2rem 2.5rem 1.5rem;display:flex;justify-content:space-between;align-items:flex-start;gap:2rem;border-bottom:1.5px solid #e0e0e0}
.office-name{font-family:'EB Garamond',Georgia,serif;font-size:1.5rem;font-weight:700;color:#1a2744;letter-spacing:-.01em;line-height:1.1}
.office-meta{margin-top:.4rem;font-size:.75rem;color:#555;line-height:1.6}
.receipt-badge{text-align:right}
.receipt-title{font-family:'EB Garamond',Georgia,serif;font-size:1.1rem;font-weight:600;color:#1a2744;text-transform:uppercase;letter-spacing:.05em}
.receipt-num{font-size:.7rem;color:#777;margin-top:.2rem;font-variant-numeric:tabular-nums;letter-spacing:.02em}
.receipt-date{font-size:.75rem;color:#555;margin-top:.1rem}
.body-text{padding:1.75rem 2.5rem;border-bottom:1px dashed #ccc}
.decl-text{font-size:1rem;line-height:1.9;color:#1a1a1a;text-align:justify}
.decl-text strong{font-weight:600}
.amount-inline{font-family:'EB Garamond',Georgia,serif;font-size:1.15rem;font-weight:700;color:#1a2744}
.details{padding:1.25rem 2.5rem;border-bottom:1px solid #e0e0e0}
.details-title{font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#888;margin-bottom:.75rem}
.details-grid{display:grid;grid-template-columns:1fr 1fr;gap:.5rem 2rem}
.detail-row{display:flex;flex-direction:column;gap:.1rem;padding:.4rem 0;border-bottom:1px dotted #e8e8e8}
.detail-key{font-size:.65rem;text-transform:uppercase;letter-spacing:.08em;color:#999;font-weight:600}
.detail-val{font-size:.82rem;color:#1a1a1a;font-weight:500}
.signature-section{padding:2rem 2.5rem 1.5rem;display:flex;align-items:flex-end;justify-content:space-between;gap:3rem}
.sig-block{display:flex;flex-direction:column;align-items:center;gap:.3rem}
.sig-line{width:200px;border-top:1px solid #333;margin-bottom:.3rem}
.sig-name{font-size:.78rem;font-weight:600;color:#1a1a1a;text-align:center;text-transform:uppercase;letter-spacing:.03em}
.sig-oab{font-size:.7rem;color:#666;text-align:center}
.date-block{font-size:.78rem;color:#555;text-align:right;line-height:1.6}
.footer{background:#f5f5f3;border-top:1.5px solid #e0e0e0;padding:.75rem 2.5rem;display:flex;justify-content:space-between;align-items:center;gap:1rem}
.footer-note{font-size:.65rem;color:#999;line-height:1.5}
.btn-print{display:inline-flex;align-items:center;gap:.4rem;background:#1a2744;color:#fff;border:none;padding:.4rem 1rem;font-size:.72rem;font-weight:600;cursor:pointer;font-family:inherit;letter-spacing:.03em}
.btn-print:hover{background:#243660}
.inst-section{padding:0 2.5rem 1.25rem}
.inst-title{font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#888;margin-bottom:.6rem}
.inst-table{width:100%;border-collapse:collapse;font-size:.78rem}
.inst-table th{font-size:.6rem;text-transform:uppercase;letter-spacing:.08em;color:#999;font-weight:700;text-align:left;padding:.35rem .5rem;border-bottom:1.5px solid #e0e0e0}
.inst-table th:last-child,.inst-table td:last-child{text-align:right}
.inst-table td{padding:.38rem .5rem;border-bottom:1px dotted #ebebeb;color:#1a1a1a;font-variant-numeric:tabular-nums}
.inst-table tr:last-child td{border-bottom:none}
.inst-table .inst-num{font-weight:600;color:#1a2744}
.inst-table .inst-total{font-weight:700;color:#1a2744;border-top:1.5px solid #e0e0e0}
.watermark{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-35deg);font-family:'EB Garamond',Georgia,serif;font-size:5rem;font-weight:700;color:rgba(26,39,68,.04);pointer-events:none;white-space:nowrap;z-index:0;letter-spacing:.1em}
.content{position:relative;z-index:1}
@media print{
  html,body{background:#fff}
  .wrapper{padding:0;max-width:100%}
  .page{border:none}
  .btn-print{display:none!important}
  .stripe-top,.stripe-green{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
</style>
</head>
<body>
<div class="wrapper">
<div class="page">
  <div class="watermark">RECIBO</div>
  <div class="content">
  <div class="stripe-top"></div>
  <div class="stripe-green"></div>

  <div class="header">
    <div>
      <div class="office-name">${lawyerTitle}</div>
      <div class="office-meta">
        Advogado &nbsp;|&nbsp; OAB/${lawyer.state} n° ${lawyer.oab}<br>
        ${lawyer.email}
      </div>
    </div>
    <div class="receipt-badge">
      <div class="receipt-title">Recibo de Honorários</div>
      <div class="receipt-num">Nº ${receiptNumber}</div>
      <div class="receipt-date">${issueDateFormatted}</div>
    </div>
  </div>

  <div class="body-text">
    <p class="decl-text">
      Recebi de <strong>${clientName}</strong>${clientCpf ? `, CPF/MF nº ${clientCpf},` : ','} a quantia de
      <span class="amount-inline">${fmtBRL(amount)}</span>
      <em>(${amountInWords})</em>, referente a honorários advocatícios pela prestação dos seguintes serviços:
      <strong>${description}</strong>${serviceDescription && serviceDescription !== 'Serviços advocatícios prestados conforme contrato de honorários.' ? ` — ${serviceDescription}` : '.'}
      Dou plena, geral e irrevogável quitação pelo valor acima descrito.
    </p>
  </div>

  ${hasBreakdown ? `
  <div class="inst-section">
    <div class="inst-title">Detalhamento das Parcelas Recebidas</div>
    <table class="inst-table">
      <thead>
        <tr><th>Parcela</th><th>Vencimento</th><th>Recebido em</th><th>Forma</th><th>Valor</th></tr>
      </thead>
      <tbody>
        ${input.breakdown!.map((r) => `
        <tr>
          <td class="inst-num">${r.label}</td>
          <td>${r.due}</td>
          <td>${r.paid}</td>
          <td>${r.method}</td>
          <td>${fmtBRL(r.value)}</td>
        </tr>`).join('')}
        <tr>
          <td colspan="4" class="inst-total" style="font-size:.7rem;text-transform:uppercase;letter-spacing:.06em">Total Recebido</td>
          <td class="inst-total">${fmtBRL(amount)}</td>
        </tr>
      </tbody>
    </table>
  </div>` : ''}

  <div class="details">
    <div class="details-title">Dados do Pagamento</div>
    <div class="details-grid">
      <div class="detail-row">
        <span class="detail-key">Cliente / Pagador</span>
        <span class="detail-val">${clientName}</span>
      </div>
      ${clientCpf ? `<div class="detail-row"><span class="detail-key">CPF</span><span class="detail-val">${clientCpf}</span></div>` : `<div class="detail-row"><span class="detail-key">Referente</span><span class="detail-val">${input.agreementTitle}</span></div>`}
      <div class="detail-row">
        <span class="detail-key">Data do Recebimento</span>
        <span class="detail-val">${input.paymentDateDisplay}</span>
      </div>
      <div class="detail-row">
        <span class="detail-key">Forma de Pagamento</span>
        <span class="detail-val">${paymentMethod}</span>
      </div>
      <div class="detail-row">
        <span class="detail-key">Valor Recebido</span>
        <span class="detail-val" style="font-weight:700;color:#1a2744;font-size:.9rem">${fmtBRL(amount)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-key">Advogado Responsável</span>
        <span class="detail-val">${lawyer.name} — OAB/${lawyer.state} ${lawyer.oab}</span>
      </div>
    </div>
  </div>

  <div class="signature-section">
    <div class="date-block">
      Cuiabá/MT,<br>
      ${issueDateFormatted}
    </div>
    <div class="sig-block">
      <div class="sig-line"></div>
      <div class="sig-name">${lawyer.name}</div>
      <div class="sig-oab">OAB/${lawyer.state} n° ${lawyer.oab}</div>
    </div>
  </div>

  <div class="footer">
    <span class="footer-note">
      Documento válido como comprovante de pagamento de honorários advocatícios conforme Lei nº 8.906/94.<br>
      Ref.: ${receiptNumber} &nbsp;|&nbsp; Emitido em ${issueDateFormatted}
    </span>
    <button class="btn-print" onclick="window.print()">
      <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
      Imprimir / PDF
    </button>
  </div>
  </div>
</div>
</div>
</body></html>`;
}

/** Abre o recibo numa nova aba (mesmo comportamento do módulo financeiro). */
export function openReceipt(input: ReceiptInput): void {
  const html = buildReceiptHtml(input);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
}
