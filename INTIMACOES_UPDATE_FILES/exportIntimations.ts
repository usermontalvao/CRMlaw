/**
 * Utilitários para exportar intimações em diferentes formatos
 */

import type { DjenComunicacaoLocal } from '../types/djen.types';
import type { IntimationAnalysis } from '../types/ai.types';

/**
 * Exporta intimações para CSV
 */
export function exportToCSV(
  intimations: DjenComunicacaoLocal[],
  analyses: Map<string, IntimationAnalysis>
): void {
  // Cabeçalho
  const headers = [
    'Data',
    'Tribunal',
    'Processo',
    'Tipo',
    'Órgão',
    'Status',
    'Urgência',
    'Prazo (dias)',
    'Resumo',
  ];

  // Linhas
  const rows = intimations.map((int) => {
    const analysis = analyses.get(int.id);
    return [
      new Date(int.data_disponibilizacao).toLocaleDateString('pt-BR'),
      int.sigla_tribunal,
      int.numero_processo_mascara || int.numero_processo,
      int.tipo_comunicacao || 'N/A',
      int.nome_orgao || 'N/A',
      int.lida ? 'Lida' : 'Não Lida',
      analysis?.urgency || 'Sem análise',
      analysis?.deadline?.days?.toString() || 'N/A',
      analysis?.summary?.substring(0, 100) || 'N/A',
    ];
  });

  // Gerar CSV
  const csvContent = [
    headers.join(','),
    ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
  ].join('\n');

  // Download
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `intimacoes_${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Exporta intimações para Excel (formato HTML que Excel pode abrir)
 */
export function exportToExcel(
  intimations: DjenComunicacaoLocal[],
  analyses: Map<string, IntimationAnalysis>
): void {
  const htmlContent = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
    <head>
      <meta charset="UTF-8">
      <style>
        table { border-collapse: collapse; width: 100%; }
        th { background-color: #f97316; color: white; padding: 12px; text-align: left; font-weight: bold; }
        td { border: 1px solid #e2e8f0; padding: 10px; }
        tr:nth-child(even) { background-color: #fff7ed; }
        .urgencia-alta { background-color: #fef2f2; color: #dc2626; font-weight: bold; }
        .urgencia-media { background-color: #fffbeb; color: #d97706; font-weight: bold; }
        .urgencia-baixa { background-color: #ecfdf5; color: #059669; font-weight: bold; }
        h1 { color: #0f172a; font-size: 20px; }
        p { color: #64748b; font-size: 13px; }
      </style>
    </head>
    <body>
      <h1>Relatório de Intimações DJEN</h1>
      <p>Gerado em: ${new Date().toLocaleString('pt-BR')}</p>
      <p>Total de intimações: ${intimations.length}</p>
      <br>
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Tribunal</th>
            <th>Processo</th>
            <th>Tipo</th>
            <th>Órgão</th>
            <th>Status</th>
            <th>Urgência</th>
            <th>Prazo (dias)</th>
            <th>Resumo</th>
          </tr>
        </thead>
        <tbody>
          ${intimations
            .map((int) => {
              const analysis = analyses.get(int.id);
              const urgencyClass = analysis?.urgency
                ? `urgencia-${analysis.urgency}`
                : '';
              return `
              <tr>
                <td>${new Date(int.data_disponibilizacao).toLocaleDateString('pt-BR')}</td>
                <td>${int.sigla_tribunal}</td>
                <td>${int.numero_processo_mascara || int.numero_processo}</td>
                <td>${int.tipo_comunicacao || 'N/A'}</td>
                <td>${int.nome_orgao || 'N/A'}</td>
                <td>${int.lida ? 'Lida' : '<strong>Não Lida</strong>'}</td>
                <td class="${urgencyClass}">${analysis?.urgency || 'Sem análise'}</td>
                <td>${analysis?.deadline?.days || 'N/A'}</td>
                <td>${analysis?.summary?.substring(0, 100) || 'N/A'}</td>
              </tr>
            `;
            })
            .join('')}
        </tbody>
      </table>
    </body>
    </html>
  `;

  const blob = new Blob([htmlContent], { type: 'application/vnd.ms-excel' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `intimacoes_${new Date().toISOString().split('T')[0]}.xls`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Gera relatório em PDF (usando impressão do navegador)
 */
export function exportToPDF(
  intimations: DjenComunicacaoLocal[],
  analyses: Map<string, IntimationAnalysis>
): void {
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Relatório de Intimações DJEN</title>
      <style>
        @media print {
          body { margin: 0; padding: 20px; }
          .no-print { display: none; }
          .header-bar { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #f8fafc; }
        .header-bar { height: 8px; background: linear-gradient(90deg, #f97316, #fb923c); }
        .container { max-width: 1200px; margin: 0 auto; padding: 24px; background: white; min-height: 100vh; }
        .header { margin-bottom: 32px; padding-bottom: 20px; border-bottom: 1px solid #e2e8f0; }
        .header-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.2em; color: #94a3b8; margin-bottom: 4px; }
        h1 { color: #0f172a; margin: 0 0 12px 0; font-size: 24px; font-weight: 600; }
        .header-info { font-size: 14px; color: #64748b; }
        .stats { display: flex; gap: 16px; margin-bottom: 32px; }
        .stat-card { padding: 20px; border-radius: 12px; flex: 1; }
        .stat-card.alta { background: linear-gradient(135deg, #dc2626, #ef4444); color: white; }
        .stat-card.media { background: linear-gradient(135deg, #f59e0b, #fbbf24); color: white; }
        .stat-card.baixa { background: linear-gradient(135deg, #10b981, #34d399); color: white; }
        .stat-card.total { background: linear-gradient(135deg, #3b82f6, #60a5fa); color: white; }
        .stat-number { font-size: 36px; font-weight: 700; }
        .stat-label { font-size: 13px; opacity: 0.9; margin-top: 4px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        th { background-color: #f97316; color: white; padding: 14px 12px; text-align: left; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
        td { border-bottom: 1px solid #e2e8f0; padding: 12px; font-size: 13px; color: #334155; }
        tr:nth-child(even) { background-color: #f8fafc; }
        tr:hover { background-color: #fff7ed; }
        .urgencia { padding: 4px 10px; border-radius: 6px; font-weight: 600; font-size: 11px; text-transform: uppercase; }
        .urgencia.alta { background-color: #fef2f2; color: #dc2626; }
        .urgencia.media { background-color: #fffbeb; color: #d97706; }
        .urgencia.baixa { background-color: #ecfdf5; color: #059669; }
        .footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid #e2e8f0; text-align: center; }
        .btn { padding: 12px 24px; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
        .btn-primary { background: #f97316; color: white; }
        .btn-primary:hover { background: #ea580c; }
        .btn-secondary { background: #f1f5f9; color: #475569; margin-left: 12px; }
        .btn-secondary:hover { background: #e2e8f0; }
      </style>
    </head>
    <body>
      <div class="header-bar"></div>
      <div class="container">
        <div class="header">
          <div class="header-label">Relatório</div>
          <h1>Relatório de Intimações DJEN</h1>
          <div class="header-info">
            <strong>Gerado em:</strong> ${new Date().toLocaleString('pt-BR')} &nbsp;|&nbsp;
            <strong>Total:</strong> ${intimations.length} intimações
          </div>
        </div>

        <div class="stats">
          <div class="stat-card total">
            <div class="stat-number">${intimations.length}</div>
            <div class="stat-label">Total de Intimações</div>
          </div>
          <div class="stat-card alta">
            <div class="stat-number">${Array.from(analyses.values()).filter((a) => a.urgency === 'alta').length}</div>
            <div class="stat-label">Urgência Alta</div>
          </div>
          <div class="stat-card media">
            <div class="stat-number">${Array.from(analyses.values()).filter((a) => a.urgency === 'media').length}</div>
            <div class="stat-label">Urgência Média</div>
          </div>
          <div class="stat-card baixa">
            <div class="stat-number">${Array.from(analyses.values()).filter((a) => a.urgency === 'baixa').length}</div>
            <div class="stat-label">Urgência Baixa</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Tribunal</th>
              <th>Processo</th>
              <th>Tipo</th>
              <th>Status</th>
              <th>Urgência</th>
              <th>Prazo</th>
            </tr>
          </thead>
          <tbody>
            ${intimations
              .map((int) => {
                const analysis = analyses.get(int.id);
                return `
                <tr>
                  <td>${new Date(int.data_disponibilizacao).toLocaleDateString('pt-BR')}</td>
                  <td>${int.sigla_tribunal}</td>
                  <td>${int.numero_processo_mascara || int.numero_processo}</td>
                  <td>${int.tipo_comunicacao || 'N/A'}</td>
                  <td>${int.lida ? 'Lida' : '<strong style="color:#f97316">Não Lida</strong>'}</td>
                  <td>${analysis?.urgency ? `<span class="urgencia ${analysis.urgency}">${analysis.urgency.toUpperCase()}</span>` : 'N/A'}</td>
                  <td>${analysis?.deadline?.days ? `${analysis.deadline.days} dias` : 'N/A'}</td>
                </tr>
              `;
              })
              .join('')}
          </tbody>
        </table>

        <div class="footer no-print">
          <button onclick="window.print()" class="btn btn-primary">
            🖨️ Imprimir / Salvar como PDF
          </button>
          <button onclick="window.close()" class="btn btn-secondary">
            Fechar
          </button>
        </div>
      </div>
    </body>
    </html>
  `;

  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  }
}
