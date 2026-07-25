create index if not exists document_edit_history_client_id_idx
  on public.document_edit_history (client_id)
  where client_id is not null;
