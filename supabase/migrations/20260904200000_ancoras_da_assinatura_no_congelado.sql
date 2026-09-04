-- ============================================================================
-- A ÂNCORA MORA JUNTO DO ARQUIVO CONGELADO — e só o servidor a lê.
-- ----------------------------------------------------------------------------
-- O `[[ASSINATURA]]` do `.docx` vira, no congelamento, uma coordenada medida na
-- paginação do PDF convertido (Syncfusion). Essa coordenada é CERTA para quem
-- monta a partir daquele PDF, e ERRADA para quem monta a partir do `.docx`
-- renderizado no navegador, que pagina de outro jeito.
--
-- Medido em 04/09/2026, nas duas direções:
--
--   · gravar a âncora em `signature_fields` fez o navegador ler "página 5",
--     não achar (ele tinha 1 seção), grampear em y=100% e mandar a rubrica para
--     o rodapé — substituindo uma detecção que funcionava;
--   · NÃO gravar em lugar nenhum fez a montagem no servidor não achar campo e
--     cair na posição de reserva, no canto da última folha.
--
-- As duas coordenadas não podem dividir a mesma tabela. `signature_fields` é o
-- que o navegador consome; a âncora passa a viver ao lado do arquivo que ela
-- descreve, em `signature_source_files`, onde só quem monta no servidor olha.
--
-- Guardar junto do congelado não é só arrumação: a âncora só faz sentido em
-- relação àquele PDF específico. Se o arquivo for recongelado, a linha inteira
-- é substituída e a coordenada velha vai junto — não sobra uma posição órfã
-- apontando para uma paginação que não existe mais.
--
-- Ver `docs/assinatura-montagem-no-servidor.md`.
-- ============================================================================

alter table public.signature_source_files
  add column if not exists signature_anchors jsonb;

comment on column public.signature_source_files.signature_anchors is
  'Âncoras [[ASSINATURA]] localizadas no PDF congelado: [{"indiceDoAssinante":1,'
  '"page_number":5,"x_percent":52.3,"y_percent":35.1,"w_percent":26.9,"h_percent":4.8}]. '
  'Coordenadas na paginação DESTE arquivo. Só a montagem no servidor as usa — o '
  'navegador pagina de outro jeito e tem a própria detecção do marcador.';
