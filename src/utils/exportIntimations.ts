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
        th { background-color: #4F46E5; color: white; padding: 12px; text-align: left; font-weight: bold; }
        td { border: 1px solid #ddd; padding: 8px; }
        tr:nth-child(even) { background-color: #f2f2f2; }
        .urgencia-alta { background-color: #FEE2E2; color: #991B1B; font-weight: bold; }
        .urgencia-media { background-color: #FEF3C7; color: #92400E; font-weight: bold; }
        .urgencia-baixa { background-color: #D1FAE5; color: #065F46; font-weight: bold; }
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
        }
        body { font-family: Arial, sans-serif; }
        h1 { color: #1F2937; margin-bottom: 10px; }
        .header { margin-bottom: 30px; }
        .stats { display: flex; gap: 20px; margin-bottom: 30px; }
        .stat-card { padding: 15px; border-radius: 8px; flex: 1; }
        .stat-card.alta { background-color: #FEE2E2; border-left: 4px solid #DC2626; }
        .stat-card.media { background-color: #FEF3C7; border-left: 4px solid #F59E0B; }
        .stat-card.baixa { background-color: #D1FAE5; border-left: 4px solid #10B981; }
        .stat-number { font-size: 32px; font-weight: bold; }
        .stat-label { font-size: 14px; color: #6B7280; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th { background-color: #4F46E5; color: white; padding: 12px; text-align: left; }
        td { border: 1px solid #E5E7EB; padding: 10px; font-size: 12px; }
        tr:nth-child(even) { background-color: #F9FAFB; }
        .urgencia { padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px; }
        .urgencia.alta { background-color: #FEE2E2; color: #991B1B; }
        .urgencia.media { background-color: #FEF3C7; color: #92400E; }
        .urgencia.baixa { background-color: #D1FAE5; color: #065F46; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>📋 Relatório de Intimações DJEN</h1>
        <p><strong>Gerado em:</strong> ${new Date().toLocaleString('pt-BR')}</p>
        <p><strong>Total de intimações:</strong> ${intimations.length}</p>
      </div>

      <div class="stats">
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
                <td>${int.lida ? 'Lida' : '<strong>Não Lida</strong>'}</td>
                <td>${analysis?.urgency ? `<span class="urgencia ${analysis.urgency}">${analysis.urgency.toUpperCase()}</span>` : 'N/A'}</td>
                <td>${analysis?.deadline?.days ? `${analysis.deadline.days} dias` : 'N/A'}</td>
              </tr>
            `;
            })
            .join('')}
        </tbody>
      </table>

      <div class="no-print" style="margin-top: 30px; text-align: center;">
        <button onclick="window.print()" style="padding: 12px 24px; background-color: #4F46E5; color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer;">
          🖨️ Imprimir / Salvar como PDF
        </button>
        <button onclick="window.close()" style="padding: 12px 24px; background-color: #6B7280; color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; margin-left: 10px;">
          Fechar
        </button>
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
