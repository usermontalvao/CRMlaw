/**
 * Conta intimações por data
 * Uso: node scripts/count-intimations-by-date.js 2025-10-17
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY ausentes no .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const targetDate = process.argv[2];
if (!targetDate) {
  console.error('❌ Informe a data no formato YYYY-MM-DD. Ex: node scripts/count-intimations-by-date.js 2025-10-17');
  process.exit(1);
}

async function run() {
  console.log(`🔎 Contando intimações com data_disponibilizacao = ${targetDate}`);
  console.log('='.repeat(60));

  const { data, error } = await supabase
    .from('djen_comunicacoes')
    .select('id, numero_processo, sigla_tribunal, data_disponibilizacao', { count: 'exact' })
    .eq('ativo', true)
    .eq('data_disponibilizacao', targetDate)
    .order('data_disponibilizacao', { ascending: false });

  if (error) {
    console.error('❌ Erro ao consultar intimações:', error.message);
    process.exit(1);
  }

  console.log(`📦 Total encontrado: ${data?.length || 0}`);
  console.log('');

  if (data && data.length > 0) {
    console.log('📋 Amostra das primeiras 10 intimações:');
    data.slice(0, 10).forEach((item, idx) => {
      console.log(`  ${idx + 1}. Processo: ${item.numero_processo} | Tribunal: ${item.sigla_tribunal}`);
    });
  }

  console.log('');
  console.log('✅ Finalizado');
}

run().catch((err) => {
  console.error('❌ Erro inesperado:', err.message);
  process.exit(1);
});
