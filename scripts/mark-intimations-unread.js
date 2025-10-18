/**
 * Script para marcar todas as intimações como NÃO LIDAS
 * Execute: node scripts/mark-intimations-unread.js
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Carregar variáveis de ambiente
dotenv.config({ path: join(__dirname, '..', '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Erro: Variáveis VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY não encontradas no .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function markAsUnread() {
  console.log('🔄 MARCANDO INTIMAÇÕES COMO NÃO LIDAS');
  console.log('='.repeat(60));
  console.log('');

  try {
    // Buscar todas as intimações
    const { data: intimations, error: fetchError } = await supabase
      .from('djen_comunicacoes')
      .select('id, numero_processo, data_disponibilizacao, lida')
      .eq('ativo', true)
      .order('data_disponibilizacao', { ascending: false });

    if (fetchError) {
      console.error('❌ Erro ao buscar intimações:', fetchError.message);
      return;
    }

    if (!intimations || intimations.length === 0) {
      console.log('⚠️ Nenhuma intimação encontrada');
      return;
    }

    console.log(`📊 Total de intimações: ${intimations.length}`);
    
    const lidas = intimations.filter(i => i.lida === true).length;
    const naoLidas = intimations.filter(i => i.lida === false).length;
    const semStatus = intimations.filter(i => i.lida === null || i.lida === undefined).length;
    
    console.log(`   ✅ Lidas: ${lidas}`);
    console.log(`   ❌ Não lidas: ${naoLidas}`);
    console.log(`   ⚪ Sem status: ${semStatus}`);
    console.log('');

    // Perguntar confirmação
    console.log('⚠️ ATENÇÃO: Isso marcará TODAS as intimações como NÃO LIDAS');
    console.log('');
    console.log('Deseja continuar? (y/n)');
    
    // Aguardar input do usuário
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('> ', async (answer) => {
      if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
        console.log('❌ Operação cancelada');
        rl.close();
        return;
      }

      console.log('');
      console.log('🔄 Atualizando...');

      // Atualizar todas para não lidas
      const { data, error: updateError } = await supabase
        .from('djen_comunicacoes')
        .update({ 
          lida: false,
          lida_em: null 
        })
        .eq('ativo', true)
        .select();

      if (updateError) {
        console.error('❌ Erro ao atualizar:', updateError.message);
        rl.close();
        return;
      }

      console.log(`✅ ${data.length} intimação(ões) marcada(s) como NÃO LIDA`);
      console.log('');
      console.log('🎉 Concluído! Recarregue a página no navegador.');
      
      rl.close();
    });

  } catch (error) {
    console.error('❌ Erro:', error.message);
  }
}

markAsUnread();
