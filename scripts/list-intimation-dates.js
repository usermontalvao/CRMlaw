/**
 * Lista contagem de intimações por data_disponibilizacao
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

async function run() {
  const { data, error } = await supabase
    .from('djen_comunicacoes')
    .select('data_disponibilizacao', { count: 'exact' })
    .eq('ativo', true);

  if (error) {
    console.error('❌', error.message);
    process.exit(1);
  }

  const counts = new Map();
  data?.forEach((item) => {
    const date = item.data_disponibilizacao;
    counts.set(date, (counts.get(date) || 0) + 1);
  });

  const sorted = Array.from(counts.entries()).sort((a, b) => (a[0] > b[0] ? -1 : 1));
  console.log('📅 Contagem por data_disponibilizacao');
  sorted.slice(0, 20).forEach(([date, count]) => {
    console.log(`  ${date}: ${count}`);
  });
}

run();
