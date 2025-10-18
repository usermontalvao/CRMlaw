/**
 * Script para testar a API do DJEN diretamente
 * Execute: node scripts/test-djen-api.js
 */

// Configuração
const NOME_ADVOGADO = 'PEDRO MONTALVAO'; // Altere para o nome correto
const NUMERO_PROCESSO = '0000480-19.2025.5.23.0007'; // Altere se necessário

// Função para formatar data (YYYY-MM-DD)
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Datas
const hoje = new Date();
const dataHoje = formatDate(hoje);
const data30DiasAtras = formatDate(new Date(hoje.getTime() - 30 * 24 * 60 * 60 * 1000));
const data7DiasAtras = formatDate(new Date(hoje.getTime() - 7 * 24 * 60 * 60 * 1000));

console.log('🔍 TESTE DA API DJEN');
console.log('='.repeat(60));
console.log(`📅 Data hoje: ${dataHoje}`);
console.log(`📅 Data 7 dias atrás: ${data7DiasAtras}`);
console.log(`📅 Data 30 dias atrás: ${data30DiasAtras}`);
console.log('='.repeat(60));
console.log('');

// Teste 1: Buscar por nome do advogado (hoje)
async function teste1() {
  console.log('📋 TESTE 1: Buscar por nome do advogado (HOJE)');
  console.log('-'.repeat(60));
  
  const params = new URLSearchParams({
    nomeAdvogado: NOME_ADVOGADO,
    dataDisponibilizacaoInicio: dataHoje,
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
    
    if (data.items && data.items.length > 0) {
      console.log('');
      console.log('📋 Primeiras 3 intimações:');
      data.items.slice(0, 3).forEach((item, idx) => {
        console.log(`  ${idx + 1}. Processo: ${item.numeroprocessocommascara || item.numero_processo}`);
        console.log(`     Tribunal: ${item.siglaTribunal}`);
        console.log(`     Data: ${item.data_disponibilizacao}`);
        console.log(`     Tipo: ${item.tipoComunicacao || 'N/A'}`);
        console.log('');
      });
    }
  } catch (error) {
    console.log(`❌ Erro na requisição: ${error.message}`);
  }

  console.log('');
}

// Teste 2: Buscar por nome do advogado (últimos 7 dias)
async function teste2() {
  console.log('📋 TESTE 2: Buscar por nome do advogado (ÚLTIMOS 7 DIAS)');
  console.log('-'.repeat(60));
  
  const params = new URLSearchParams({
    nomeAdvogado: NOME_ADVOGADO,
    dataDisponibilizacaoInicio: data7DiasAtras,
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
    
    if (data.items && data.items.length > 0) {
      console.log('');
      console.log('📊 Distribuição por tribunal:');
      const tribunais = {};
      data.items.forEach(item => {
        tribunais[item.siglaTribunal] = (tribunais[item.siglaTribunal] || 0) + 1;
      });
      Object.entries(tribunais).forEach(([tribunal, count]) => {
        console.log(`  ${tribunal}: ${count} intimação(ões)`);
      });
    }
  } catch (error) {
    console.log(`❌ Erro na requisição: ${error.message}`);
  }

  console.log('');
}

// Teste 3: Buscar por número de processo (últimos 30 dias)
async function teste3() {
  console.log('📋 TESTE 3: Buscar por número de processo (ÚLTIMOS 30 DIAS)');
  console.log('-'.repeat(60));
  
  const params = new URLSearchParams({
    numeroProcesso: NUMERO_PROCESSO,
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
    
    if (data.items && data.items.length > 0) {
      console.log('');
      console.log('📋 Todas as intimações deste processo:');
      data.items.forEach((item, idx) => {
        console.log(`  ${idx + 1}. Data: ${item.data_disponibilizacao}`);
        console.log(`     Tipo: ${item.tipoComunicacao || 'N/A'}`);
        console.log(`     Documento: ${item.tipoDocumento || 'N/A'}`);
        console.log(`     Texto: ${item.texto.substring(0, 100)}...`);
        console.log('');
      });
    }
  } catch (error) {
    console.log(`❌ Erro na requisição: ${error.message}`);
  }

  console.log('');
}

// Teste 4: Listar tribunais disponíveis
async function teste4() {
  console.log('📋 TESTE 4: Listar tribunais disponíveis');
  console.log('-'.repeat(60));
  
  const url = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao/tribunal';
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
    console.log(`📦 Total de tribunais: ${data.length || 0}`);
    
    if (data && data.length > 0) {
      console.log('');
      console.log('🏛️ Tribunais disponíveis:');
      data.slice(0, 10).forEach((tribunal) => {
        console.log(`  • ${tribunal.sigla} - ${tribunal.nome}`);
      });
      if (data.length > 10) {
        console.log(`  ... e mais ${data.length - 10} tribunais`);
      }
    }
  } catch (error) {
    console.log(`❌ Erro na requisição: ${error.message}`);
  }

  console.log('');
}

// Executar todos os testes
async function executarTestes() {
  console.log('');
  console.log('🚀 Iniciando testes da API DJEN...');
  console.log('');
  
  await teste1();
  await new Promise(resolve => setTimeout(resolve, 1000)); // Aguarda 1s
  
  await teste2();
  await new Promise(resolve => setTimeout(resolve, 1000)); // Aguarda 1s
  
  await teste3();
  await new Promise(resolve => setTimeout(resolve, 1000)); // Aguarda 1s
  
  await teste4();
  
  console.log('='.repeat(60));
  console.log('✅ Testes concluídos!');
  console.log('');
  console.log('💡 DICAS:');
  console.log('  1. Se não encontrou intimações hoje, tente aumentar o período');
  console.log('  2. Verifique se o nome do advogado está correto no perfil');
  console.log('  3. Certifique-se que os processos estão cadastrados corretamente');
  console.log('');
}

// Executar
executarTestes().catch(console.error);
