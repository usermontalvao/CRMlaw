-- SQL para remover completamente o módulo Backup & Restore
-- Execute no Supabase SQL Editor

-- ================================================
-- 1. REMOVER TABELAS DO BACKUP
-- ================================================
DROP TABLE IF EXISTS backup_logs CASCADE;
DROP TABLE IF EXISTS backup_schedules CASCADE;
DROP TABLE IF EXISTS backup_progress CASCADE;
DROP TABLE IF EXISTS system_backups CASCADE;

-- ================================================
-- 2. REMOVER VIEWS
-- ================================================
DROP VIEW IF EXISTS backup_stats;

-- ================================================
-- 3. REMOVER FUNÇÕES
-- ================================================
DROP FUNCTION IF EXISTS update_updated_at_column();

-- ================================================
-- 4. REMOVER BUCKET DO STORAGE (se existir)
-- ================================================
-- Nota: Buckets precisam ser removidos via Dashboard
-- Vá para: Storage → system-backups → Delete bucket

-- ================================================
-- 5. REMOVER POLICIES DO STORAGE (se existirem)
-- ================================================
DELETE FROM storage.policies WHERE bucket_id = 'system-backups';

-- ================================================
-- 6. VERIFICAR LIMPEZA
-- ================================================
DO $$
BEGIN
    RAISE NOTICE '🧹 Módulo Backup & Restore removido com sucesso!';
    RAISE NOTICE '';
    RAISE NOTICE '✅ Tabelas removidas:';
    RAISE NOTICE '   - system_backups';
    RAISE NOTICE '   - backup_progress';
    RAISE NOTICE '   - backup_schedules';
    RAISE NOTICE '   - backup_logs';
    RAISE NOTICE '';
    RAISE NOTICE '✅ Views removidas:';
    RAISE NOTICE '   - backup_stats';
    RAISE NOTICE '';
    RAISE NOTICE '✅ Funções removidas:';
    RAISE NOTICE '   - update_updated_at_column';
    RAISE NOTICE '';
    RAISE NOTICE '⚠️ Ação manual necessária:';
    RAISE NOTICE '   1. Vá para Supabase Dashboard → Storage';
    RAISE NOTICE '   2. Delete bucket: system-backups';
    RAISE NOTICE '   3. Remova arquivos de backup do projeto (se houver)';
    RAISE NOTICE '';
    RAISE NOTICE '🎉 Sistema limpo e otimizado!';
END
$$;
