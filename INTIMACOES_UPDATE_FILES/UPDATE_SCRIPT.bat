@echo off
echo ========================================
echo   ATUALIZACAO MODULO INTIMACOES DJEN
echo ========================================
echo.
echo Versao: 1.9.420
echo Data: 26/01/2026
echo.

REM Criar backup dos arquivos atuais
echo [1/6] Criando backup dos arquivos atuais...
if exist "src\components\IntimationsModule.tsx" (
    copy "src\components\IntimationsModule.tsx" "src\components\IntimationsModule.tsx.backup" >nul
    echo     - IntimationsModule.tsx [OK]
)

if exist "src\types\user-notification.types.ts" (
    copy "src\types\user-notification.types.ts" "src\types\user-notification.types.ts.backup" >nul
    echo     - user-notification.types.ts [OK]
)

if exist "src\services\djenSyncStatus.service.ts" (
    copy "src\services\djenSyncStatus.service.ts" "src\services\djenSyncStatus.service.ts.backup" >nul
    echo     - djenSyncStatus.service.ts [OK]
)

echo.
echo [2/6] Atualizando arquivos do modulo...

REM Atualizar IntimationsModule.tsx
copy "IntimationsModule.tsx" "src\components\IntimationsModule.tsx" >nul
echo     - IntimationsModule.tsx [ATUALIZADO]

REM Atualizar tipos de notificacao
copy "user-notification.types.ts" "src\types\user-notification.types.ts" >nul
echo     - user-notification.types.ts [ATUALIZADO]

REM Atualizar servico de sincronizacao
copy "djenSyncStatus.service.ts" "src\services\djenSyncStatus.service.ts" >nul
echo     - djenSyncStatus.service.ts [ATUALIZADO]

REM Atualizar utilitarios (se existirem)
if exist "exportIntimations.ts" (
    copy "exportIntimations.ts" "src\utils\exportIntimations.ts" >nul
    echo     - exportIntimations.ts [ATUALIZADO]
)

if exist "syncHistory.ts" (
    copy "syncHistory.ts" "src\utils\syncHistory.ts" >nul
    echo     - syncHistory.ts [ATUALIZADO]
)

echo.
echo [3/6] Limpando arquivos temporarios...

REM Limpar cache do navegador (opcional)
if exist "node_modules\.cache" (
    rmdir /s /q "node_modules\.cache" >nul 2>&1
    echo     - Cache node_modules [LIMPO]
)

echo.
echo [4/6] Verificando instalacao...

REM Verificar se os arquivos foram atualizados
if exist "src\components\IntimationsModule.tsx" (
    echo     - IntimationsModule.tsx [ENCONTRADO]
) else (
    echo     - ERRO: IntimationsModule.tsx nao encontrado!
)

if exist "src\types\user-notification.types.ts" (
    echo     - user-notification.types.ts [ENCONTRADO]
) else (
    echo     - ERRO: user-notification.types.ts nao encontrado!
)

echo.
echo [5/6] Resumo das atualizacoes:
echo.
echo ✅ Busca estendida para 7 dias
echo ✅ Notificacoes push para intimacoes urgentes  
echo ✅ Filtro por tribunal
echo ✅ Interface reorganizada com abas
echo ✅ Estatisticas corrigidas (apenas nao lidas)
echo ✅ Modal de prazo com aviso destacado
echo ✅ Otimizacoes mobile
echo ✅ Menu de ferramentas dropdown
echo ✅ Exportacao de relatorios
echo ✅ Historico de sincronizacoes
echo.

echo [6/6] Proximos passos:
echo.
echo 1. Reinicie o servidor de desenvolvimento
echo    npm run dev
echo.
echo 2. Teste as novas funcionalidades:
echo    - Busca estendida (7 dias)
echo    - Filtro por tribunal
echo    - Notificacoes urgentes
echo    - Nova interface com abas
echo    - Exportacao de relatorios
echo.
echo 3. Verifique o console para logs de debug:
echo    - 🔔 Notificação criada para intimação urgente
echo    - 📦 Cache, 🔄 API, 💾 Salvando
echo.

echo ========================================
echo   ATUALIZACAO CONCLUIDA COM SUCESSO!
echo ========================================
echo.
pause
