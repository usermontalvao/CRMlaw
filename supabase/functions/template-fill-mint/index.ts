import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * Edge Function: template-fill-mint
 * 
 * Recebe um slug de permalink e cria um novo template_fill_links (token único).
 * Retorna o token para o frontend redirecionar para /preencher/:token.
 * 
 * Isso permite ter um link fixo (permalink) que nunca expira,
 * enquanto cada preenchimento usa um token único.
 */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceKey) {
      throw new Error('Supabase env não configurado');
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const slug = (body?.slug || '').trim();

    if (!slug) {
      throw new Error('Slug é obrigatório');
    }

    // Buscar permalink
    const { data: permalink, error: permalinkError } = await admin
      .from('template_fill_permalinks')
      .select('*')
      .eq('slug', slug)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (permalinkError) throw new Error(permalinkError.message);
    if (!permalink) throw new Error('Link não encontrado ou inativo');

    // Verificar se template existe
    const { data: template, error: templateError } = await admin
      .from('document_templates')
      .select('id, name')
      .eq('id', permalink.template_id)
      .single();

    if (templateError || !template) {
      throw new Error('Template não encontrado');
    }

    // Criar novo template_fill_links (token único para este acesso)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h

    const { data: newLink, error: linkError } = await admin
      .from('template_fill_links')
      .insert({
        template_id: permalink.template_id,
        template_file_id: permalink.template_file_id || null,
        created_by: permalink.created_by,
        prefill: permalink.prefill || null,
        expires_at: expiresAt,
        status: 'pending',
      })
      .select('public_token')
      .single();

    if (linkError || !newLink?.public_token) {
      throw new Error(linkError?.message ?? 'Falha ao criar token de preenchimento');
    }

    return new Response(
      JSON.stringify({
        success: true,
        token: newLink.public_token,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('template-fill-mint error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as any)?.message ?? 'Erro desconhecido',
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});
