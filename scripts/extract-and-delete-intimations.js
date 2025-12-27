// Script para extrair nomes das partes e deletar intimações do período 18/12 até hoje
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis de ambiente VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY são necessárias');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('🔍 Buscando intimações do período 18/12/2025 até hoje...\n');

  // Buscar intimações do período
  const { data: intimations, error } = await supabase
    .from('djen_comunicacoes')
    .select(`
      id,
      numero_processo,
      texto,
      data_disponibilizacao,
      sigla_tribunal,
      djen_destinatarios (id, nome, polo)
    `)
    .gte('data_disponibilizacao', '2025-12-18')
    .order('data_disponibilizacao', { ascending: false });

  if (error) {
    console.error('❌ Erro ao buscar intimações:', error.message);
    process.exit(1);
  }

  console.log(`📋 Encontradas ${intimations.length} intimações no período\n`);

  // Extrair nomes das partes
  console.log('👥 NOMES DAS PARTES EXTRAÍDOS:');
  console.log('='.repeat(80));

  const partesSet = new Set();

  for (const intimation of intimations) {
    // Extrair dos destinatários
    if (intimation.djen_destinatarios && intimation.djen_destinatarios.length > 0) {
      for (const dest of intimation.djen_destinatarios) {
        if (dest.nome) {
          partesSet.add(`${dest.nome} (${dest.polo || 'N/A'})`);
        }
      }
    }

    // Extrair do texto usando regex para padrões comuns
    const texto = intimation.texto || '';
    
    // Padrão: "Requerente: NOME" ou "Requerido: NOME"
    const requerenteMatch = texto.match(/Requerente:\s*([^\.]+)/i);
    const requeridoMatch = texto.match(/Requerido:\s*([^\.]+)/i);
    const autorMatch = texto.match(/Autor:\s*([^\.]+)/i);
    const reuMatch = texto.match(/Réu:\s*([^\.]+)/i);
    
    if (requerenteMatch) partesSet.add(`${requerenteMatch[1].trim()} (Requerente)`);
    if (requeridoMatch) partesSet.add(`${requeridoMatch[1].trim()} (Requerido)`);
    if (autorMatch) partesSet.add(`${autorMatch[1].trim()} (Autor)`);
    if (reuMatch) partesSet.add(`${reuMatch[1].trim()} (Réu)`);
  }

  const partes = Array.from(partesSet).sort();
  partes.forEach((parte, i) => {
    console.log(`${i + 1}. ${parte}`);
  });

  console.log('\n' + '='.repeat(80));
  console.log(`\n📊 Total de partes únicas: ${partes.length}`);

  // Listar intimações que serão deletadas
  console.log('\n📋 INTIMAÇÕES QUE SERÃO DELETADAS:');
  console.log('='.repeat(80));
  
  for (const intimation of intimations) {
    console.log(`- ${intimation.data_disponibilizacao} | ${intimation.sigla_tribunal} | ${intimation.numero_processo}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log(`\n⚠️  Total: ${intimations.length} intimações serão deletadas`);

  // Deletar intimações
  console.log('\n🗑️  Deletando intimações...');

  // Primeiro deletar destinatários relacionados
  const intimationIds = intimations.map(i => i.id);
  
  const { error: destError } = await supabase
    .from('djen_destinatarios')
    .delete()
    .in('comunicacao_id', intimationIds);

  if (destError) {
    console.error('❌ Erro ao deletar destinatários:', destError.message);
  } else {
    console.log('✅ Destinatários deletados');
  }

  // Deletar advogados relacionados
  const { error: advError } = await supabase
    .from('djen_advogados')
    .delete()
    .in('comunicacao_id', intimationIds);

  if (advError) {
    console.error('❌ Erro ao deletar advogados:', advError.message);
  } else {
    console.log('✅ Advogados deletados');
  }

  // Deletar análises de IA relacionadas
  const { error: aiError } = await supabase
    .from('intimation_ai_analysis')
    .delete()
    .in('intimation_id', intimationIds);

  if (aiError) {
    console.error('❌ Erro ao deletar análises de IA:', aiError.message);
  } else {
    console.log('✅ Análises de IA deletadas');
  }

  // Deletar intimações
  const { error: deleteError } = await supabase
    .from('djen_comunicacoes')
    .delete()
    .gte('data_disponibilizacao', '2025-12-18');

  if (deleteError) {
    console.error('❌ Erro ao deletar intimações:', deleteError.message);
    process.exit(1);
  }

  console.log(`\n✅ ${intimations.length} intimações deletadas com sucesso!`);
}

main().catch(console.error);
