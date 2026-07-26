/**
 * Expurgo DEFINITIVO de solicitações de assinatura (arquivos + registros).
 *
 * Diferente da lixeira do app (que só marca `deleted_at`), este script APAGA
 * PARA SEMPRE: os PDFs assinados, os arquivos de origem, selfie/assinatura dos
 * signatários e todas as linhas no banco (incluindo a trilha de auditoria).
 * NÃO HÁ COMO DESFAZER.
 *
 * Precisa da SERVICE ROLE KEY (não está no .env por padrão) porque só a API de
 * Storage remove o binário de verdade — apagar a linha em storage.objects por
 * SQL deixaria o arquivo órfão no S3, ainda ocupando espaço.
 *
 * Uso:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/purge-signature-requests.mjs           # dry-run
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/purge-signature-requests.mjs --confirm
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Faltam variáveis: VITE_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const args = new Set(process.argv.slice(2));
const shouldDelete = args.has('--confirm');

// Solicitações a expurgar (já marcadas como excluídas em 26/07/2026).
const requestIds = [
  '652e0016-2180-49b0-9c4c-d831bc90d014', // KIT CONSUMIDOR — Facial
  '47d44b88-4567-4247-8587-c1e7782553b7', // KIT CONSUMIDOR — Somente assinatura
  'bd654335-42a9-45dc-97b9-7d1945463e24', // KIT CONSUMIDOR — Somente assinatura
  '63c80b7b-f62c-49ad-ab21-55ab0ed4fff5', // KIT CONSUMIDOR — Facial
  '62446c52-aaaf-4ac4-af46-718aff0e06e0', // PROCURAÇÃO JUDICIAL — Facial
  '400050fc-d9a2-4c6d-8000-a291f51302ab', // PROCURAÇÃO JUDICIAL — Facial
  'd646de5c-ed1a-472b-a95b-d2f5848117bc', // PROCURAÇÃO JUDICIAL — Facial
];

/** Descobre em qual bucket cada caminho vive (os registros guardam só o path). */
const BUCKETS = ['assinados', 'document-templates'];

async function collectPaths() {
  const paths = new Set();
  const add = (value) => {
    if (typeof value === 'string' && value.trim()) paths.add(value);
  };

  const { data: requests, error: reqError } = await supabase
    .from('signature_requests')
    .select('id, document_path, attachment_paths, signature_image_path, facial_image_path, document_image_path')
    .in('id', requestIds);
  if (reqError) throw reqError;

  for (const r of requests ?? []) {
    add(r.document_path);
    add(r.signature_image_path);
    add(r.facial_image_path);
    add(r.document_image_path);
    for (const p of r.attachment_paths ?? []) add(p);
  }

  const { data: signers, error: signerError } = await supabase
    .from('signature_signers')
    .select('signature_image_path, facial_image_path, document_image_path, signed_document_path')
    .in('signature_request_id', requestIds);
  if (signerError) throw signerError;

  for (const s of signers ?? []) {
    add(s.signature_image_path);
    add(s.facial_image_path);
    add(s.document_image_path);
    add(s.signed_document_path);
  }

  const { data: docs, error: docError } = await supabase
    .from('signature_request_documents')
    .select('source_file_path, signed_file_path')
    .in('signature_request_id', requestIds);
  if (docError) throw docError;

  for (const d of docs ?? []) {
    add(d.source_file_path);
    add(d.signed_file_path);
  }

  return [...paths];
}

async function main() {
  const paths = await collectPaths();
  console.log(`Solicitações: ${requestIds.length}`);
  console.log(`Arquivos referenciados: ${paths.length}`);
  for (const p of paths) console.log(`- ${p}`);

  if (!shouldDelete) {
    console.log('\nDry-run. Rode com --confirm para apagar DEFINITIVAMENTE (sem volta).');
    return;
  }

  // 1) Arquivos. Tentamos em cada bucket; caminho inexistente no bucket é ignorado.
  for (const bucket of BUCKETS) {
    const { data, error } = await supabase.storage.from(bucket).remove(paths);
    if (error) {
      console.error(`Erro ao apagar em ${bucket}:`, error.message);
      process.exit(1);
    }
    console.log(`${bucket}: ${data?.length ?? 0} arquivo(s) removido(s).`);
  }

  // 2) Registros — filhos antes dos pais (a auditoria some junto, por isso é definitivo).
  for (const table of ['signature_audit_log', 'signature_fields', 'signature_request_documents', 'signature_signers']) {
    const { error } = await supabase.from(table).delete().in('signature_request_id', requestIds);
    if (error) {
      console.error(`Erro ao apagar ${table}:`, error.message);
      process.exit(1);
    }
    console.log(`${table}: linhas removidas.`);
  }

  const { error: finalError } = await supabase.from('signature_requests').delete().in('id', requestIds);
  if (finalError) {
    console.error('Erro ao apagar signature_requests:', finalError.message);
    process.exit(1);
  }

  console.log('\nExpurgo concluído.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
