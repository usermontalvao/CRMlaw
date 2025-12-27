// Script para verificar destinatários das intimações
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
  console.error('❌ Variáveis de ambiente necessárias');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('🔍 Verificando intimações e destinatários...\n');

  // Buscar intimações com destinatários
  const { data: intimations, error } = await supabase
    .from('djen_comunicacoes')
    .select(`
      id,
      numero_processo,
      texto,
      djen_destinatarios (id, nome, polo, comunicacao_id)
    `)
    .limit(10);

  if (error) {
    console.error('❌ Erro:', error.message);
    process.exit(1);
  }

  console.log(`📋 Intimações encontradas: ${intimations.length}\n`);

  for (const int of intimations) {
    console.log(`\n📄 Processo: ${int.numero_processo}`);
    console.log(`   ID: ${int.id}`);
    console.log(`   Destinatários: ${int.djen_destinatarios?.length || 0}`);
    if (int.djen_destinatarios && int.djen_destinatarios.length > 0) {
      for (const dest of int.djen_destinatarios) {
        console.log(`   - ${dest.nome} (${dest.polo || 'N/A'})`);
      }
    }
  }

  // Verificar tabela djen_destinatarios diretamente
  console.log('\n\n📊 Verificando tabela djen_destinatarios diretamente...');
  const { data: destinatarios, error: destError } = await supabase
    .from('djen_destinatarios')
    .select('*')
    .limit(10);

  if (destError) {
    console.error('❌ Erro ao buscar destinatários:', destError.message);
  } else {
    console.log(`Total de destinatários na tabela: ${destinatarios?.length || 0}`);
    if (destinatarios && destinatarios.length > 0) {
      console.log('\nExemplos:');
      for (const dest of destinatarios) {
        console.log(`- ${dest.nome} (${dest.polo}) - comunicacao_id: ${dest.comunicacao_id}`);
      }
    }
  }

  // Verificar estrutura da tabela
  console.log('\n\n📊 Verificando se existe coluna comunicacao_id...');
  const { data: sample, error: sampleError } = await supabase
    .from('djen_destinatarios')
    .select('*')
    .limit(1);
  
  if (sample && sample.length > 0) {
    console.log('Colunas da tabela djen_destinatarios:', Object.keys(sample[0]));
  }
}

main().catch(console.error);
