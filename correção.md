# Correção de Segurança — Fechamento do Storage público

> Status geral: **análise concluída, execução pendente**. Marcações `[x]` = já existe/feito; `[ ]` = a fazer.
> Última atualização: 2026-06-21

---

## Fase 0 — Diagnóstico (análise)

- [x] Mapear policies de `storage.objects` por papel (anon/public/authenticated)
- [x] Confirmar buckets sensíveis com `public=false` (URLs não adivinháveis)
- [x] Confirmar leitura/listagem anon aberta em `signatures`, `client-documents`, `generated-documents`, `assinados`, `document-templates`
- [x] Confirmar `INSERT` anon aberto em `signatures`, `client-documents`, `document-templates`, `assinados`
- [x] Confirmar que a edge token-scoped `public-signing-file` já existe e valida `token → request → path`
- [x] Confirmar que `getPublicFileUrl()` já usa a edge (caminho seguro existente)
- [x] Confirmar que o portal usa papel próprio `portal_client` (fechar anon de `client-documents` NÃO quebra o portal)
- [x] Confirmar fallback `VITE_OPENAI_API_KEY` (dormente: chave não está no `.env` do frontend)

### Lacunas identificadas (incorporar ao plano antes de executar)
- [ ] **Revogar de `public`, não só de `anon`** — policies "Anyone can view signatures", "Public can view generated documents", "Allow public read for signatures folder" estão no papel `public` e precisam de DROP explícito
- [ ] **Edge hash-scoped para a tela de Verificação** — `PublicVerificationPage` usa `verification_hash` (não `public_token`); `public-signing-file` não serve esse caso. "Visualizar documento" (iframe) usa `getSignedPdfUrl()` direto em `assinados` e quebra na migration 3
- [ ] Varrer chamadores públicos de `getDocumentPreviewUrl()` e `getSignedPdfUrl()` (usam `list()`/`createSignedUrl` anon)
- [ ] Incluir **bloqueio de INSERT anon** no critério de "seguro"

---

## Fase 1 — Fechar leitura/escrita anon de evidências (signatures, client-documents) ✅ CONCLUÍDA (2026-06-21)

> Migration aplicada: `sec_fase1_lock_signatures_client_documents_anon`

- [x] **migration 1** — bucket `signatures`: DROP de "Allow public insert signatures" (anon), "Allow public select signatures" (anon) e "Anyone can view signatures" (**public**); criada "Authenticated reads signatures" para preservar o app interno; mantida "Authenticated users can upload"
- [x] **migration 2** — bucket `client-documents`: DROP de "portal_read_documents" (anon) e "portal_upload_documents" (anon); mantidos `portal_client` e `authenticated` (crm_full_documents)
- [x] **teste 1** — simulando `SET ROLE anon` (RLS aplicado):
  - [x] `signatures` → anon enxerga **0** objetos
  - [x] `client-documents` → anon enxerga **0** objetos
  - [x] `authenticated`/`portal_client` continuam com acesso (regressão interna evitada)
- [x] Upload de selfie/assinatura confirmado server-side (edge `public-sign-document` grava via service role em `document-templates`) → INSERT anon de `signatures` revogado com segurança

> ⚠️ **Achado importante:** a evidência facial/selfie de verdade (528 arquivos) **NÃO** está no bucket `signatures` (só 32 legados) — está em **`document-templates/signatures/`**, exposta pelas policies de `document-templates` ("Allow read document templates" anon + "Allow public read for signatures folder" public). **Isso só fecha na Fase 2/3.** Portanto, a Fase 1 fecha `client-documents` e o bucket `signatures`, mas a evidência facial principal continua exposta até a Fase 2/3.
>
> ⚠️ **Caveat de legado:** ao regenerar o PDF de documentos **antigos** cuja imagem de assinatura esteja só no bucket `signatures` (não em `document-templates`), o fluxo público (anon) não conseguirá embutir a imagem (cosmético). Fluxo novo não é afetado (usa `document-templates`). PDFs já gerados em `assinados` não são afetados.

---

## Fase 2 — Migrar leitura pública restante para edge token/hash-scoped 🚧 EM ANDAMENTO

- [x] **edge nova (hash-scoped)** `public-verify-file` — valida `verification_hash → signed_document_path`, recusa `blocked_at`, assina via service role. **Deployada (v1, verify_jwt off) e testada** (retorna URL para código real). Arquivo: `supabase/functions/public-verify-file/index.ts`
- [x] **frontend — `PublicVerificationPage.tsx`** — "Visualizar documento" agora resolve via `signatureService.getVerifiedFileUrl(hash)` (edge), com **fallback** para `getSignedPdfUrl(path)` enquanto o anon ainda está aberto. (`getVerifiedFileUrl` adicionado em `signature.service.ts`)
- [x] **edge function 1** — `public-signing-file`: agora autoriza também os paths de imagem (signature/facial/document image) do signatário **e** da solicitação no conjunto `allowed`. Drift auditado antes (deployada v6 == source local, sem drift). **Redeployada v7 (verify_jwt off)**. Colunas confirmadas em `signature_requests`/`signature_signers`.
- [x] **frontend — `pdfSignature.service.ts`** — `setPublicFileResolver()` injetável; `loadStorageImage`, `fetchBytesFromPathOrUrl` e `getSignedPdfUrl` consultam o resolver token-scoped antes do acesso direto (fallback direto mantido enquanto anon aberto)
- [x] **frontend — `PublicSigningPage.tsx`** — seta o resolver (`getPublicFileUrl(token, path)`) no mount via useEffect e limpa no unmount → geração de PDF lê tudo via edge
- [x] **frontend — `PublicDocumentPage.tsx`** — seta o resolver no mount (roteia `getSignedPdfUrl`); `getDocumentPreviewUrl` (doc principal + anexos) trocado por `resolveDocUrl` (edge token-scoped com fallback anon)
- [x] **fix 401 do relatório (tabelas, não storage)** — RPCs token-scoped `public_signing_request_signers(p_token uuid)` e `public_signing_audit_log(p_token uuid)` (SECURITY DEFINER, grant anon/authenticated/service_role). Migration `public_signing_report_rpcs` (aplicada + versionada no repo). `pdfSignature.service` ganhou `setPublicReportDataProvider` (usado em `addReportPages` ×2 + `saveSignedDocxAsPdf`); PublicSigningPage seta o provider. Antes: co-signatários e trilha de auditoria caíam em fallback vazio (anon 401). Validado como anon: token válido→1 signer/2 audit, token inválido→0. Também: (a) a **timeline de auditoria da página pública** (`getAuditLog` direto, polled) trocada por `getPublicReportAuditLog(token)` — era o último 401 do fluxo; (b) 401 de `system_settings security_config` era ruído do SecurityPinProvider em rota pública → fetch agora gated por sessão.
- [x] **migration 3** — ✅ **APLICADA 21/06** (`storage_close_anon_signature_buckets`, versionada no repo). DROP: `Allow anon reads from assinados`, `Allow public read for signatures folder`, `Public can view generated documents`, `Public can read signature request PDFs`; `Allow read document templates` recriada authenticated-only. Verificado `SET ROLE anon` → **0 linhas** em document-templates/generated-documents/assinados; authenticated mantém 286/1184/101. **Evidência facial em `document-templates/signatures` agora fechada.**
- [x] **teste 2** — ✅ **TESTADO no app 21/06**: assinatura pública real gerou PDF com selfie embutida; log confirmou `loadStorageImage → Imagem resolvida via edge pública` p/ signature_ e facial_. Falta confirmar doc público (`/#/assinado/...`) e o `list()` anon bloqueado (pós-migration 3).
  - [x] Link público de assinatura abre e funciona (geração de PDF lê imagens/doc via edge `public-signing-file` v7 — selfie/assinatura embutidas confirmadas)
  - [ ] Documento público (`/#/assinado/...`) abre (preview + anexos via edge)
  - [ ] `list()` anon nesses buckets → bloqueado (após migration 3)

---

## Fase 3 — Migrar upload público para edge segura 🚧 CÓDIGO PRONTO, migration 4 GATED

- [x] **edge function 2** — `public-signing-upload` **deployada v1 (verify_jwt off)**: recebe `{token, path, contentBase64, contentType}`, valida token→signatário→request, exige `path` dentro de `${requestId}/` **e** que contenha o `id` do próprio signatário (impede sobrescrever artefato de co-signatário), limite 25MB, grava em `assinados` via service role.
- [x] **frontend** — `pdfSignature.service` ganhou `setPublicUploadResolver` + helper `persistSignedPdf`; os 3 saves (`saveSignedPdfToStorage`/`saveSignedDocxAsPdf`/`saveSignatureReportToStorage`) agora usam o helper (edge no público, direto no interno/fallback). `signature.service.uploadSignedFilePublic` (base64 em blocos) invoca a edge. PublicSigningPage seta o resolver. tsc --noEmit passou. **Fallback direto mantido enquanto anon INSERT aberto.**
- [x] **migration 4** — ✅ **APLICADA 21/06** (mesma migration). DROP: `Allow anon uploads to assinados`; `Allow upload document templates` recriada authenticated-only. Sem policy anon/public restante nos 3 buckets (confirmado via pg_policies). Uploads públicos só via edge `public-signing-upload` (service role).
- [x] **teste 3** — ✅ **TESTADO no app 21/06**: assinatura pública completa gerou PDF e log mostrou `[PDF] PDF do DOCX gravado via edge pública: 0b718bc7.../signed_...pdf` (não o caminho direto). Imagens via edge confirmadas. Fluxo público sem 401 após o fix da timeline de auditoria.
  - [x] gerar PDF → `gravado via edge pública` ✓
  - [ ] repetir com anon key: upload/list/listagem direta falham (só após migrations 3+4)

---

## Fase 4 — Limpeza final / endurecimento (severidade baixa)

- [ ] Remover fallback `VITE_OPENAI_API_KEY` (usar só `OPENAI_API_KEY` server-side)
  - [ ] `supabase/functions/openai-proxy/index.ts:76`
  - [ ] `supabase/functions/analyze-intimations/index.ts:7`
  - [ ] `supabase/functions/evolution-webhook/index.ts:533` e `:791`
- [ ] Padronizar provider/secret de e-mail e eliminar fallback legado
  - [ ] `supabase/functions/email-send-test/index.ts:25`
  - [ ] `supabase/functions/send-signature-link/index.ts`

---

## Ordem de deploy

1. [ ] Deploy das edge functions novas/ajustadas
2. [ ] Deploy do frontend que passa a usar as edges
3. [ ] Aplicar migrations de fechamento do Storage
4. [ ] Teste real com anon
5. [ ] Teste funcional completo do fluxo público

---

## Critério de "seguro" (todas verdadeiras ao mesmo tempo)

- [ ] anon não consegue listar `signatures`
- [ ] anon não consegue listar `client-documents`
- [ ] anon não consegue listar `document-templates`, `generated-documents`, `assinados`
- [ ] anon não consegue `INSERT` em nenhum bucket sensível
- [ ] fluxo público continua funcionando só via edge validada por token/hash/sessão
