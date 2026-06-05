# Inventario Completo

Inventario levantado localmente em 04/06/2026.

## 1. Contagem por area

| Area | Quantidade |
|---|---:|
| `src/components` | 70 |
| `src/services` | 38 |
| `src/types` | 21 |
| `src/portal/pages` | 15 |
| `src/portal/components` | 7 |
| `src/portal/services` | 3 |
| `supabase/functions` | 31 |
| `supabase/migrations` | 94 |
| `scripts` | 12 |
| `public` | 10 |

## 2. Modulos internos do escritorio

Detectados principalmente em `src/App.tsx` e `src/contexts/NavigationContext.tsx`:

- `dashboard`
- `feed`
- `leads`
- `clientes`
- `documentos`
- `cloud`
- `processos`
- `requerimentos`
- `prazos`
- `intimacoes`
- `financeiro`
- `agenda`
- `assinaturas`
- `tarefas`
- `notificacoes`
- `chat`
- `usuarios`
- `monitor`
- `login`
- `cron`
- `configuracoes`
- `peticoes`
- `perfil`

## 3. Modulos do Portal do Cliente

Detectados em `src/portal/types/portal.types.ts` e `src/portal/PortalApp.tsx`:

- `dashboard`
- `casos`
- `processos` (alias legado)
- `scanner`
- `documentos`
- `assinar`
- `financeiro`
- `agenda`
- `mensagens`
- `notificacoes`
- `perfil`

## 4. Rotas publicas observadas

Detectadas em `src/main.tsx`:

- `#/documento/:token`
- `#/cron/djen`
- `#/assinar/...`
- `#/p/...`
- `#/preencher/...`
- `#/cloud/share/...`
- `#/verificar`
- `#/terms`
- `#/privacidade`
- `#/privacy`
- `#/docs`

## 5. Inventario de componentes internos

```text
AccessRequestsAdmin.tsx
CalendarModule.tsx
ChatFloatingWidget.tsx
ChatModule.tsx
ClientDetails.tsx
ClientForm.tsx
ClientList.tsx
ClientModal.tsx
ClientSearchSelect.tsx
ClientsModule.tsx
CloudModule.tsx
CronEndpoint.tsx
CustomFieldsManager.tsx
Dashboard.tsx
DeadlinesModule.tsx
DocsChangesPage.tsx
DocsPage.tsx
DocumentRequestsAdmin.tsx
DocumentRequestsTracker.tsx
DocumentsModule.tsx
editor-issues-scanner.ts
FacialCapture.tsx
Feed.tsx
FinancialModal.tsx
FinancialModule.tsx
GlobalSearchModal.tsx
IntimationsModule.tsx
LandingPage.tsx
LeadModal.tsx
LeadsModule.tsx
Login.tsx
LOGO (2).png
NotificationBell.tsx
NotificationsModuleNew.tsx
OfflinePage.tsx
PetitionEditorModule.tsx
PetitionEditorWidget.tsx
PostModal.tsx
ProcessesModule.tsx
ProcessTimeline.tsx
ProcessTimelineInline.tsx
ProfileModal.tsx
PublicCloudSharePage.tsx
PublicDocumentPage.tsx
PublicPermalinkRedirect.tsx
PublicSigningPage.tsx
PublicTemplateFillPage.tsx
PublicVerificationPage.tsx
RepresentativesPanel.tsx
RequirementsModule.tsx
SessionWarning.tsx
SettingsModule.tsx
SignatureCanvas.tsx
SignatureModule.tsx
SignaturePositionDesigner.tsx
SignatureReport.tsx
spell-check-cache.ts
StandardPetitionsModule.tsx
SyncfusionEditor.tsx
TasksModule.tsx
TemplateFilesManager.tsx
TermsPrivacyPage.tsx
Toast.tsx
UserManagementModule.tsx
UserProfilePage.tsx
```

## 6. Inventario do Portal

### 6.1 Paginas

```text
PortalCalendar.tsx
PortalCasos.tsx
PortalDashboard.tsx
PortalDocumentRequests.tsx
PortalDocuments.tsx
PortalFinancial.tsx
PortalLogin.tsx
PortalMessages.tsx
PortalNotifications.tsx
PortalProcessDetails.tsx
PortalProcesses.tsx
PortalProfile.tsx
PortalRequirementDetails.tsx
PortalScanner.tsx
PortalSignatures.tsx
```

### 6.2 Componentes

```text
ClientAvatar.tsx
PortalChatWidget.tsx
PortalHeader.tsx
PortalNotificationBell.tsx
PortalSidebar.tsx
PortalUI.tsx
SecurityBanner.tsx
```

## 7. Servicos internos e metodos publicos observados

```text
accessRequest.service.ts: createRequest, listPending, listAll, listByRequester, approve, deny, getUserOverrides, revokeOverride, notifyAdmins, getPendingCount
ai.service.ts: isEnabled, generateText, editLegalTextWithContext, analyzeIntimation, extractDeadline, generateSummary, analyzeUrgency, suggestActions, formatQualification
calendar.service.ts: listEvents, getEventById, getEventByAutoKey, createEvent, updateEvent, deleteEvent
case.service.ts: listCases, getCaseById, createCase, updateCase, deleteCase, listDeadlines, createDeadline, updateDeadline, deleteDeadline, listAdminRequests, createAdminRequest, updateAdminRequest, deleteAdminRequest
chat.service.ts: createRoom, findDirectMessage, createDirectMessage, broadcastToAll, markAsRead, getRoomReadStates, sendNudge, subscribeToNudges, getUnreadCount, getOrCreatePublicRoomByName, listRooms, getRoomMembers, getLastMessage, listMessages, sendMessage, sendSystemMessage, editMessage, deleteMessage, listReactions, toggleReaction, subscribeToRoomReactions, subscribeToRoomMessageUpdates, subscribeToRoomMessages, subscribeToNewTicketRooms, subscribeToTicketRoomUpdates, subscribeToAllMessages
client.service.ts: invalidateCache, listClients, getClientById, getClientByCpfCnpj, getClientByEmail, mergeClients, createClient, updateClient, deleteClient, countClients, setClientPhoto, excludeClientPhoto, searchClients
cloud.service.ts: hashPassword, listFolders, listAllFolders, listClientRootFolders, getFolder, createFolder, archiveFolder, trashFolder, restoreFolder, updateFolder, deleteFolder, listFiles, listAllFiles, listArchivedFiles, listTrashedFolders, listTrashedFiles, uploadFile, uploadFiles, moveFile, trashFile, replaceFileContents, deleteFile, archiveFile, restoreFile, renameFile, duplicateFile, duplicateFileToFolder, duplicateFolderToFolder, getFileSignedUrl, createShare, getActiveShareByFolder, updateShare, listFolderShares, listActivityLogs, disableShare, resolvePublicShare, getPublicShareInfo, listPublicFolders, listPublicFiles, buildPublicShareUrl
dashboardPreferences.service.ts: getPreferences, savePreferences, saveGridLayout, getGridLayout, updateLeftWidgets, updateRightWidgets
datajud.service.ts
deadline.service.ts: invalidateCache, listDeadlines, getDeadlineById, createDeadline, updateDeadline, updateStatus, deleteDeadline, getUpcomingDeadlines, getOverdueDeadlines
djen.service.ts: consultarComunicacoes, consultarTodasComunicacoes, listarTribunais, getCertidaoUrl, formatarDataParaApi, getDataHoje, getDataDiasAtras, consultarPorProcessos
djenLocal.service.ts: listComunicacoes, getComunicacaoByHash, saveComunicacao, saveComunicacoes, propagarVinculosDoMesmoProcesso, updateComunicacao, marcarComoLida, clearAll, deleteByIds, deleteRead, vincularCliente, vincularProcesso, getOrgaoByProcessIds, getOrgaoByProcessCodes, getUnreadProcessIds, agruparPorCliente, contarNaoLidas, deleteIntimationsByDate, repairNullNumeroProcesso, cleanOldIntimations, getArchivedIntimations
djenSyncStatus.service.ts: listRecent, logSync, updateSync
documentTemplate.service.ts: uploadGeneratedDocument, listTemplates, getTemplate, getTemplateSignedUrl, createTemplate, createTemplateWithFile, updateTemplate, updateTemplateWithFile, deleteTemplate, downloadTemplateFile, listGeneratedDocuments, createGeneratedDocument, deleteGeneratedDocument, downloadGeneratedDocument, getGeneratedDocumentSignedUrl, updateSignatureFieldConfig, listTemplateFiles, addTemplateFile, removeTemplateFile, updateTemplateFileOrder, updateTemplateFileSignatureConfig, downloadTemplateFileById, getTemplateWithFiles, listTemplateCustomFields, replaceTemplateCustomFields, listCustomFields, getCustomField, createCustomField, updateCustomField, deleteCustomField, reorderCustomFields
feedPolls.service.ts: createPoll, getLatestPoll, getPollByPostId, vote, closePoll, getVoters, removeVote
feedPosts.service.ts: uploadAttachment, getPosts, getPostById, createPost, deletePost, banPost, unbanPost, updatePost, likePost, unlikePost, getComments, createComment, deleteComment, getPreviewDataForTag, getRecordsForTag, searchEntitiesForTag
financial.service.ts: createAgreement, updateAgreement, deleteAgreement, getAgreement, listAgreements, payInstallment, addManualEntry, deleteAvulsoEntry, editInstallmentPayment, cancelInstallment, listInstallments, listAllInstallments, getFinancialStats, logPaymentAudit, getPaymentAuditLog, getInstallmentAuditLog, getAllPaymentAuditLogs
googleAuth.service.ts: initialize, signIn, signInWithPopup, getUser, signOut, isAuthenticated
intimationAnalysis.service.ts: saveAnalysis, getAnalysis, getAnalysesByIntimationIds, listAnalyses, deleteAnalysis, convertToIntimationAnalysis
lead.service.ts: listLeads, getLeadById, createLead, updateLead, deleteLead, convertLeadToClient
pdfSignature.service.ts: generateSignedPdf, downloadSignedPdf, saveSignedPdfToStorage, saveSignedDocxAsPdf, saveSignatureReportToStorage, getSignedPdfUrl, mergePdfUrls
petitionEditor.service.ts: listBlockCategories, upsertBlockCategories, saveDefaultTemplate, getDefaultTemplate, listBlocks, listActiveBlocks, listDefaultBlocks, listBlocksByCategory, getBlock, createBlock, updateBlock, deleteBlock, getBlockStandardTypeId, setBlockStandardType, reorderBlocks, toggleBlockDefault, toggleBlockActive, listPetitions, getPetition, createPetition, updatePetition, deletePetition, deleteAllPetitions, deleteOrphanPetitions, generateDocxContent, listLegalAreas, getLegalArea, createLegalArea, updateLegalArea, deleteLegalArea, reorderLegalAreas, listBlocksByLegalArea, listStandardTypes, getStandardType, createStandardType, updateStandardType, deleteStandardType, listStandardTypeBlocks, listBlocksByStandardType, addBlockToStandardType, removeBlockFromStandardType, setStandardTypeBlocks
process.service.ts: invalidateCache, listProcesses, getProcessById, createProcess, updateProcess, updateStatus, deleteProcess
processDjenSync.service.ts: syncProcessWithDjen, syncPendingProcesses, extractDistributedDate
processTimeline.service.ts: getCachedTimeline, checkForUpdates, fetchProcessTimeline, fetchTimelineFromDatabase, analyzeTimelineEvent, fetchAndAnalyzeTimeline, detectSuggestedStatus, autoUpdateProcessStatus, extractComarcaFromText, enrichProcessesAfterSync
profile.service.ts: getProfile, upsertProfile, listMembers, searchMembers, getMyProfile, updateThemePreference, setPresenceStatus, setOnline, setAway, setOffline, getPresenceLabel, getPresenceColor, getPresenceTextColor
representative.service.ts: listRepresentatives, getRepresentativeById, createRepresentative, updateRepresentative, deleteRepresentative, listAppointments, getAppointmentById, getAppointmentsByEventId, createAppointment, updateAppointment, deleteAppointment, markAsPaid, updateServiceStatus, archiveAppointment, reactivateAppointment, getStats
requirement.service.ts: invalidateCache, listRequirements, getRequirementById, createRequirement, updateRequirement, updateStatus, archiveRequirement, deleteRequirement, listStatusHistory, updateHistoryEntryDate
requirementDocument.service.ts: listByRequirementId, create, delete, deleteWithFile, download, getSignedUrl
settings.service.ts: getAllSettings, getOfficeIdentity, updateOfficeIdentity, getDjenConfig, updateDjenConfig, getDatajudKeyConfig, setDatajudKey, markDatajudKeyInvalid, clearDatajudKeyInvalid, getNotificationConfig, updateNotificationConfig, getPreferences, updatePreferences, getSecurityConfig, updateSecurityConfig, getModulesConfig, updateModulesConfig, getPortalModulesConfig, savePortalModulesConfig, getAllPermissions, getPermissionsByRole, updatePermission, updateRolePermissions, checkPermission, logAudit, getAuditLog, listUsers, updateUserRole, updateUserProfile, deleteUserProfile, uploadUserAvatar, ensureProfileBucketExists, uploadToProfileBucket, getProfileBucketPublicUrl
signature.service.ts: verifySignedPdfBySha256, listRequests, listRequestsWithDerivedStatus, listRequestsWithSigners, getRequest, getRequestWithSigners, getSignerById, getRequestByToken, createRequest, updateRequest, cancelRequest, archiveRequest, deleteRequest, restoreRequest, listArchivedRequests, blockRequest, unblockRequest, cleanupProvisionalDocs, permanentlyDeleteRequest, getSigner, getSignerByToken, getSignerWithRequestByToken, getPublicSigningBundle, sendPhoneOtp, sendEmailOtp, verifyPhoneOtp, verifyEmailOtp, markSignerAsViewed, addSigner, updateSigner, updateSignerSignedDocumentPath, updateSignerSignedDocumentMeta, deleteSigner, signDocumentPublic, signDocument, addAuditLog, getAuditLog, getStats, getSignedImageUrl, uploadSignatureDocumentPdf, getDocumentPreviewUrl, generatePublicSigningUrl, generateVerificationUrl, verifySignatureByHash, generateVerificationHash, generatePublicToken, uploadDocument, sendSignatureLinkEmail
signatureExplorer.service.ts: listFolders, createFolder, updateFolder, deleteFolder, listItems, upsertItem, moveItem, deleteItem
signatureFields.service.ts: listByRequest, upsertFields
standardPetition.service.ts: listPetitions, listActivePetitions, getPetition, getPetitionWithFields, createPetition, createPetitionWithFile, updatePetition, updatePetitionFile, deletePetition, downloadPetitionFile, listFields, getField, createField, updateField, deleteField, reorderFields, listGeneratedDocuments, createGeneratedDocument
task.service.ts: listTasks, getTask, createTask, updateTask, toggleTaskStatus, deleteTask, updateTaskPositions
templateFill.service.ts: getBundle, submit
templateFillPermalink.service.ts: mintToken, createPermalink, listPermalinks, deactivatePermalink, activatePermalink, deletePermalink
userNotification.service.ts: listNotifications, createNotification, createNotificationDeduped, markAsRead, markAllAsRead, markAsReadByIntimationId, countUnread, deleteNotification, notifyDeadlineAssigned, notifyAppointmentAssigned, notifyDeadlineReminder
```

## 8. Servicos do Portal e metodos observados

```text
clientAuth.service.ts: loginByCPF, resolvePhotoUrl, refreshSessionPhoto, sendEmailOTP, verifyEmailOTP, getStoredSession, persistSession, logout
clientPortal.service.ts: listProcesses, getOfficeContact, explainMovement, explainProcess, getAiCache, saveAiCache, savePushSubscription, removePushSubscription, getChatMessages, sendChatMessage, getProcess, listDocuments, listSignaturesPending, listFinancial, listCalendarEvents, listNotifications, markNotificationRead, markAllNotificationsRead, markNotificationsSeen, listDeadlines, listDocumentRequests, uploadDocumentFiles, getModulesConfig, getProfile, requestProfileUpdate, listProfileRequests, getDashboardSummary, explainRequirement, listRequirements, getRequirement
portalScanner.service.ts: applyGray, stretchContrast
```

## 9. Entidades e tipos mapeados

### Core interno

- `Client`, `CreateClientDTO`, `UpdateClientDTO`, `ClientFilters`
- `Process`, `CreateProcessDTO`, `UpdateProcessDTO`, `ProcessFilters`
- `Requirement`, `CreateRequirementDTO`, `UpdateRequirementDTO`, `RequirementStatusHistoryEntry`
- `Deadline`, `CreateDeadlineDTO`, `UpdateDeadlineDTO`, `DeadlineFilters`
- `CalendarEvent`, `CreateCalendarEventDTO`, `UpdateCalendarEventDTO`
- `Lead`, `CreateLeadDTO`, `UpdateLeadDTO`
- `Agreement`, `Installment`, `FinancialStats`, `PaymentAuditLog`
- `ChatRoom`, `ChatMessage`, `ChatReaction`, `PortalChatMessage`
- `Task`, `CreateTaskDTO`, `UpdateTaskDTO`
- `DocumentTemplate`, `GeneratedDocument`, `CustomField`, `TemplateFile`, `TemplateCustomField`
- `SignatureRequest`, `Signer`, `SignatureField`, `SignatureAuditLog`, `SignatureStats`
- `CloudFolder`, `CloudFile`, `CloudActivityLog`, `CloudFolderShare`, `CloudPublicShareInfo`
- `DjenComunicacao`, `DjenConsultaParams`, `DjenTribunal`
- `IntimationAnalysis`, `DeadlineExtraction`, `ProcessAnalysis`, `TimelineEvent`, `DocumentSummary`
- `Representative`, `RepresentativeAppointment`
- `SavedPetition`, `PetitionBlock`, `PetitionStandardType`, `LegalArea`
- `StandardPetition`, `StandardPetitionField`, `GeneratedPetitionDocument`
- `UserNotification`

### Portal

- `ClientPortalUser`
- `PortalSession`
- `PortalRoute`
- `PortalNavItem`

## 10. Funcoes Supabase (Edge Functions)

```text
analyze-facial-photo
analyze-intimations
convert-prescription-deadlines
create-collaborator
datajud-proxy
datajud-sync
delete-user
djen-proxy
email-send-otp
email-verify-otp
notification-scheduler
notify-comment-mention
notify-deadline-assigned
openai-proxy
portal-login
portal-push
process-document-upload
public-sign-document
run-djen-sync
send-email
send-signature-link
smsdev-send-otp
smsdev-verify-otp
sync-emails
syncfusion-import
syncfusion-license
syncfusion-proxy
template-fill
template-fill-mint
update-process-status
weekly-digest
```

## 11. Scripts de apoio

```text
check-destinatarios.js
check-profile-name.js
check-specific-intimation.js
count-intimations-by-date.js
extract-and-delete-intimations.js
fetch-djen-day.js
list-intimation-dates.js
mark-intimations-unread.js
setup-githooks.cjs
test-djen-api.js
test-with-correct-name.js
verify-version-changelog.cjs
```

## 12. Assets/publico

```text
clear-sw.js
favicon.svg
icon-192.png
icon-512.png
jurius-logo.png
manifest.webmanifest
og-image.svg
sw.js
_headers
_redirects
```

## 13. Migracoes Supabase

As migracoes mostram a historia real dos dominios implementados. Abaixo esta a lista completa observada:

```text
20250109_dashboard_preferences.sql
20250110_add_feed_notification_types.sql
20250110_add_mention_notification_type.sql
20250110_feed_posts.sql
20250110_feed_posts_visibility_schedule.sql
20250110_fix_user_notifications_rls.sql
20250110_rpc_create_user_notification.sql
20250111_add_post_ban_feature.sql
20250203_theme_preference.sql
20250610_payment_audit_log.sql
20250612_digital_signatures.sql
20250612_signature_verification.sql
20250613_add_viewed_at_to_signers.sql
20250614_custom_fields.sql
20251215_public_signing_bundle.sql
20251216_archive_signature_requests.sql
20251216_custom_fields_signature.sql
20251217000000_create_signature_phone_otps.sql
20251217020000_template_fill_links.sql
20251217021000_signature_fields_document_id.sql
20251217022000_template_custom_fields_description.sql
20251218_template_fill_permalinks.sql
20251218115000_template_custom_fields_enabled.sql
20251218121000_template_custom_fields_select_options_and_order.sql
20251218140000_template_custom_fields_field_type_check.sql
20251218180000_document_templates_enable_defendant.sql
20251222150000_requirements_pericia_fields.sql
20251222160000_processes_requirements_link.sql
20251222174500_document_template_ms.sql
20251222193000_requirement_documents.sql
20251222194500_system_settings_requirements_ms_template_id.sql
20251222195500_generated_documents_storage_policies.sql
20251226150000_process_status_subestages.sql
20251227_djen_sync_history.sql
20251227_fix_user_notifications_rls.sql
20251227_standard_petitions.sql
20251228_petition_editor.sql
20251229_add_document_type_to_petition_blocks.sql
20251229_fix_petition_blocks_columns.sql
20251229_fix_petition_blocks_rls.sql
20251229_petition_block_categories_by_document_type.sql
20251229_rename_clauses_to_blocks.sql
20251230_add_requirement_fields_to_signature.sql
20251231_fix_petition_blocks_order.sql
20251231000000_petition_default_templates.sql
20260105_public_signature_auth_methods.sql
20260107_backfill_petition_blocks_trabalhista.sql
20260107_legal_areas.sql
20260107_z_backfill_petition_blocks_trabalhista.sql
20260108000100_fix_chat_rls.sql
20260108000200_anexos_chat_storage_policies.sql
20260110_feed_posts_audience.sql
20260110_fix_feed_posts_rls.sql
20260227_signature_explorer_folders.sql
20260308_cloud_folder_archive.sql
20260308_cloud_module.sql
20260308_cloud_realtime.sql
20260309_cloud_trash_history.sql
20260310_fix_cloud_activity_trigger_is_active.sql
20260313_cloud_folder_alerts.sql
20260317_representatives_module.sql
20260318_representative_appointments_archive_flag.sql
20260323140500_add_oab_number_to_representatives.sql
20260517_dashboard_grid_layout.sql
20260520_process_notifications.sql
20260525_chat_messages_is_system.sql
20260525_datajud_movimentos.sql
20260525_installments_entry_type.sql
20260601000000_client_portal.sql
20260601000001_client_portal_rpc.sql
20260601000002_client_portal_rpc_v2.sql
20260601000003_client_portal_photo.sql
20260601000004_client_portal_final.sql
20260601000005_portal_profile_update_requests.sql
20260601000006_portal_client_notifications.sql
20260601000007_portal_system_notifications_triggers.sql
20260601000008_document_requests_module.sql
20260601000009_document_request_notification_trigger.sql
20260601000010_portal_client_role.sql
20260601000011_calendar_event_mode.sql
20260601000012_portal_process_appointments.sql
20260601000013_portal_calendar_unified.sql
20260601000014_portal_requirements.sql
20260601000015_portal_requirement_linked_processes.sql
20260602000000_portal_dashboard_cases_count.sql
20260602000001_portal_ai_cache_push_subscriptions.sql
20260602000002_portal_push_trigger.sql
20260602000003_portal_chat_rpcs.sql
20260603000001_fix_portal_tables_rls_and_grants.sql
20260604000001_invalidate_portal_ai_cache_on_process_status_change.sql
20260604000002_portal_get_process_djen_publications.sql
20260604000002_portal_notifications_seen_and_dedupe.sql
20260604000003_portal_chat_ticket_assignment.sql
weekly_digest_cron.sql
```

## 14. Leitura executiva do inventario

### Capacidades ja prontas para serem "ferramentas"

- CRUD de clientes, leads, processos, requerimentos, tarefas e agenda
- documentos, templates e geracao
- links publicos e assinatura digital
- cloud com shares e urls assinadas
- financeiro e auditoria
- chat interno e ticket de portal
- explicacoes IA de processos e requerimentos
- ingestao e analise de intimações
- notificacoes e workflows automatizados

### Capacidades ja prontas para virarem "resources"

- resumo do cliente
- resumo do processo
- timeline processual
- timeline de requerimento
- status de assinatura
- financeiro consolidado
- dashboard do portal
- feed/notificacoes

### Capacidades ja prontas para virarem "prompts"

- cadastrar cliente e abrir processo
- gerar contrato e enviar para assinatura
- solicitar documentos ao cliente
- montar peticao a partir de template e blocos
- analisar intimação e sugerir proxima acao
- explicar andamento processual para o cliente
