/**
 * Teste com o nome correto do advogado
 */

const NOME_CORRETO = 'PEDRO RODRIGUES MONTALVAO NETO';

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const hoje = new Date();
const dataHoje = formatDate(hoje);
const data30DiasAtras = formatDate(new Date(hoje.getTime() - 30 * 24 * 60 * 60 * 1000));

console.log('🔍 TESTE COM NOME CORRETO: ' + NOME_CORRETO);
console.log('='.repeat(70));
console.log('');

async function testar() {
  const params = new URLSearchParams({
    nomeAdvogado: NOME_CORRETO,
    dataDisponibilizacaoInicio: data30DiasAtras,
    dataDisponibilizacaoFim: dataHoje,
    meio: 'D',
    itensPorPagina: '100',
    pagina: '1'
  });

  const url = `https://comunicaapi.pje.jus.br/api/v1/comunicacao?${params.toString()}`;
  console.log(`🌐 URL: ${url}`);
  console.log('');

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    console.log(`📊 Status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`❌ Erro: ${errorText}`);
      return;
    }

    const data = await response.json();
    console.log(`✅ Sucesso!`);
    console.log(`📦 Total de intimações: ${data.count || 0}`);
    console.log(`📄 Intimações retornadas: ${data.items?.length || 0}`);
    console.log('');
    
    if (data.items && data.items.length > 0) {
      console.log('🎉 INTIMAÇÕES ENCONTRADAS!');
      console.log('');
      console.log('📋 Primeiras 5 intimações:');
      data.items.slice(0, 5).forEach((item, idx) => {
        console.log(`  ${idx + 1}. Processo: ${item.numeroprocessocommascara || item.numero_processo}`);
        console.log(`     Tribunal: ${item.siglaTribunal}`);
        console.log(`     Data: ${item.data_disponibilizacao}`);
        console.log(`     Tipo: ${item.tipoComunicacao || 'N/A'}`);
        console.log(`     Texto: ${item.texto.substring(0, 80)}...`);
        console.log('');
      });
      
      console.log('✅ CONCLUSÃO: O nome está correto e há intimações!');
      console.log('');
      console.log('🔧 PRÓXIMO PASSO:');
      console.log('   Configure este nome no perfil do sistema:');
      console.log(`   "${NOME_CORRETO}"`);
    } else {
      console.log('⚠️ Nenhuma intimação encontrada nos últimos 30 dias');
      console.log('');
      console.log('💡 Possíveis causas:');
      console.log('   1. Realmente não há intimações neste período');
      console.log('   2. O nome pode estar ligeiramente diferente no DJEN');
      console.log('   3. Tente variações: sem acentos, com/sem segundo nome, etc.');
    }
  } catch (error) {
    console.log(`❌ Erro na requisição: ${error.message}`);
  }

  console.log('');
  console.log('='.repeat(70));
}

testar();
