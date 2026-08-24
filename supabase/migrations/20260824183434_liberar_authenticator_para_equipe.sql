-- O Authenticator deixa de ser uma ferramenta exclusiva do administrador,
-- sem liberar o módulo para cargos que hoje não podem vê-lo.
--
-- A matriz governa quais botões o CRM oferece; a ACL por credencial continua
-- sendo a autoridade final na Edge Function. Assim, can_delete não permite
-- apagar chave alheia, e can_edit não transforma cargo em proprietário.
-- Quem já tem acesso ao módulo passa a poder manter as próprias chaves. Quem
-- não tem can_view continua sem qualquer acesso e pode ser habilitado depois
-- na tela de Permissões.

update public.role_permissions
set can_create = true,
    can_edit = true,
    can_delete = true
where module = 'authenticator'
  and can_view = true;
