/**
 * Obtém intimações do DJEN para um intervalo de datas (mesmo dia)
 * Uso: node scripts/fetch-djen-day.js 2025-10-17
 */

const NOME_ADVOGADO = 'PEDRO RODRIGUES MONTALVAO NETO';

async function run() {
  const targetDate = process.argv[2];
  if (!targetDate) {
    console.error('❌ Informe a data. Ex: node scripts/fetch-djen-day.js 2025-10-17');
    process.exit(1);
  }

  const params = new URLSearchParams({
    nomeAdvogado: NOME_ADVOGADO,
    dataDisponibilizacaoInicio: targetDate,
    dataDisponibilizacaoFim: targetDate,
    meio: 'D',
    itensPorPagina: '100',
    pagina: '1'
  });

  const url = `https://comunicaapi.pje.jus.br/api/v1/comunicacao?${params.toString()}`;

  console.log('🌐', url);
  console.log('='.repeat(60));

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    console.log(`📊 Status: ${response.status} ${response.statusText}`);
    const text = await response.text();

    try {
      const data = JSON.parse(text);
      console.log(`📦 Total itens: ${data.items?.length || 0}`);
      if (data.items?.length) {
        console.log('📋 Primeiros 3 processos:');
        data.items.slice(0, 3).forEach((item, idx) => {
          console.log(`  ${idx + 1}. ${item.numero_processo} - ${item.siglaTribunal} - ${item.data_disponibilizacao}`);
        });
      }
    } catch (parseErr) {
      console.log('⚠️ Não foi possível parsear JSON. Conteúdo bruto:');
      console.log(text.slice(0, 500));
    }
  } catch (error) {
    console.error('❌ Erro ao chamar API:', error.message);
  }
}

run();
