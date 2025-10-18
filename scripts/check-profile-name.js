/**
 * Script para verificar o nome do advogado configurado no perfil
 * Execute: node scripts/check-profile-name.js
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

async function checkProfile() {
  console.log('🔍 VERIFICANDO PERFIL DO ADVOGADO');
  console.log('='.repeat(60));
  console.log('');

  try {
    // Buscar todos os perfis
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Erro ao buscar perfis:', error.message);
      return;
    }

    if (!profiles || profiles.length === 0) {
      console.log('⚠️ Nenhum perfil encontrado no banco de dados');
      return;
    }

    console.log(`📊 Total de perfis encontrados: ${profiles.length}`);
    console.log('');

    profiles.forEach((profile, idx) => {
      console.log(`👤 Perfil ${idx + 1}:`);
      console.log(`   ID: ${profile.id}`);
      console.log(`   Nome: ${profile.name || 'Não definido'}`);
      console.log(`   Nome para DJEN: ${profile.lawyer_full_name || 'NÃO CONFIGURADO ⚠️'}`);
      console.log(`   Email: ${profile.email || 'Não definido'}`);
      console.log(`   OAB: ${profile.oab_number || 'Não definido'} - ${profile.oab_state || 'N/A'}`);
      console.log(`   Criado em: ${new Date(profile.created_at).toLocaleString('pt-BR')}`);
      console.log('');
    });

    // Verificar se há perfil sem lawyer_full_name
    const semNomeDJEN = profiles.filter(p => !p.lawyer_full_name);
    if (semNomeDJEN.length > 0) {
      console.log('⚠️ ATENÇÃO:');
      console.log(`   ${semNomeDJEN.length} perfil(is) sem "Nome Completo para DJEN" configurado`);
      console.log('');
      console.log('💡 SOLUÇÃO:');
      console.log('   1. Acesse o módulo de Perfil no sistema');
      console.log('   2. Clique em "Editar Perfil"');
      console.log('   3. Preencha o campo "Nome Completo para DJEN"');
      console.log('   4. Use o nome EXATAMENTE como aparece nas intimações do DJEN');
      console.log('   5. Exemplo: "PEDRO HENRIQUE MONTALVAO" ou "PEDRO MONTALVAO SILVA"');
      console.log('');
    }

    // Mostrar nome que será usado na busca
    const perfilAtivo = profiles[0];
    const nomeParaBusca = perfilAtivo.lawyer_full_name || perfilAtivo.name || '';
    
    console.log('🔍 NOME QUE SERÁ USADO NA BUSCA DJEN:');
    console.log(`   "${nomeParaBusca}"`);
    console.log('');

    if (!nomeParaBusca) {
      console.log('❌ ERRO: Nenhum nome configurado para busca!');
      console.log('   Configure o nome no perfil antes de sincronizar.');
    } else {
      console.log('✅ Nome configurado!');
      console.log('');
      console.log('📋 Teste este nome na API DJEN:');
      const nomeEncoded = encodeURIComponent(nomeParaBusca);
      const hoje = new Date().toISOString().split('T')[0];
      const url = `https://comunicaapi.pje.jus.br/api/v1/comunicacao?nomeAdvogado=${nomeEncoded}&dataDisponibilizacaoInicio=${hoje}&dataDisponibilizacaoFim=${hoje}&meio=D&itensPorPagina=100&pagina=1`;
      console.log('');
      console.log(`curl "${url}"`);
    }

  } catch (error) {
    console.error('❌ Erro:', error.message);
  }

  console.log('');
  console.log('='.repeat(60));
}

checkProfile();
