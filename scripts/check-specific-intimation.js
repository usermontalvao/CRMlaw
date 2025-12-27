// Script para verificar intimação específica
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('🔍 Buscando intimação do processo 10170540520258110001...\n');

  const { data: intimations, error } = await supabase
    .from('djen_comunicacoes')
    .select(`
      id,
      numero_processo,
      texto,
      djen_destinatarios (id, nome, polo)
    `)
    .eq('numero_processo', '10170540520258110001');

  if (error) {
    console.error('❌ Erro:', error.message);
    process.exit(1);
  }

  console.log(`📋 Intimações encontradas: ${intimations.length}\n`);

  for (const int of intimations) {
    console.log(`📄 ID: ${int.id}`);
    console.log(`   Processo: ${int.numero_processo}`);
    console.log(`   Destinatários: ${int.djen_destinatarios?.length || 0}`);
    if (int.djen_destinatarios && int.djen_destinatarios.length > 0) {
      for (const dest of int.djen_destinatarios) {
        console.log(`   - ${dest.nome} (${dest.polo || 'N/A'})`);
      }
    } else {
      console.log('   ⚠️ Nenhum destinatário cadastrado');
    }
    console.log(`   Texto (primeiros 200 chars): ${int.texto?.substring(0, 200)}...`);
    console.log('');
  }
}

main().catch(console.error);
