import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  FileText,
  Loader2,
  Trash2,
  FileDown,
  BarChart3,
  Users,
  BookOpen,
  X,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Search,
} from 'lucide-react';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { saveAs } from 'file-saver';
import { Document as DocxDocument, Packer, Paragraph, TextRun } from 'docx';
import { documentTemplateService } from '../services/documentTemplate.service';
import { clientService } from '../services/client.service';
import type { DocumentTemplate, CreateDocumentTemplateDTO } from '../types/document.types';
import type { Client } from '../types/client.types';


const defaultTemplateContent = `[[NOME COMPLETO]], [[nacionalidade]], [[estado civil]], [[profissão]], inscrito(a) no CPF sob o nº [[CPF]], residente e domiciliado(a) na [[endereço]], nº [[número]], [[complemento]], Bairro [[bairro]], [[cidade]] – [[estado]], CEP [[CEP]], telefone/WhatsApp [[celular]]
AÇÃO EM FACE - [[reu]].

[[cidade]] – [[estado]], [[data]].
[[NOME COMPLETO]]`;

const removeDiacritics = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .normalize('NFC');

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const formatDate = (value?: string | null) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('pt-BR');
};

const formatMaritalStatus = (status?: string | null) => {
  if (!status) return '';
  const map: Record<string, string> = {
    solteiro: 'Solteiro(a)',
    casado: 'Casado(a)',
    divorciado: 'Divorciado(a)',
    viuvo: 'Viúvo(a)',
    viúva: 'Viúva',
    uniao_estavel: 'União Estável',
  };
  return map[status] ?? status;
};

const decodeXmlEntities = (value: string) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#10;/g, '\n')
    .replace(/&#13;/g, '\r');

const sanitizeText = (value: string) => value.replace(/[\u2028\u2029\u202c\u202d\u202e]/g, '');

const extractTextFromDocxZip = (zip: PizZip) => {
  try {
    const xmlFile = zip.file('word/document.xml');
    if (!xmlFile) return '';

    const xmlContent = xmlFile.asText();
    return decodeXmlEntities(
      xmlContent
        .replace(/<w:p[^>]*>/g, '\n')
        .replace(/<w:br[^>]*\/>/g, '\n')
        .replace(/<w:tab[^>]*\/>/g, '\t')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+\n/g, '\n')
        .replace(/\n{2,}/g, '\n\n')
        .trim(),
    );
  } catch (error) {
    console.error('Erro ao extrair texto do DOCX:', error);
    return '';
  }
};

const DocumentsModule: React.FC = () => {
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [defendantInput, setDefendantInput] = useState('');
  const [generatingDocx, setGeneratingDocx] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationSuccess, setGenerationSuccess] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');
  const [fileInput, setFileInput] = useState<File | null>(null);

  const currentDate = useMemo(() => new Date(), []);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const data = await documentTemplateService.listTemplates();
        setTemplates(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    let isActive = true;
    const handler = setTimeout(() => {
      (async () => {
        try {
          setClientsLoading(true);
          const trimmed = clientSearchTerm.trim();
          const data = await clientService.listClients(trimmed ? { search: trimmed } : undefined);
          if (!isActive) return;
          setClients(data);
          setSelectedClientId((prev) => {
            if (!prev) return prev;
            return data.some((client) => client.id === prev) ? prev : '';
          });
        } catch (err) {
          if (isActive) {
            console.error(err);
          }
        } finally {
          if (isActive) {
            setClientsLoading(false);
          }
        }
      })();
    }, 400);

    return () => {
      isActive = false;
      clearTimeout(handler);
    };
  }, [clientSearchTerm]);

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId) ?? null,
    [clients, selectedClientId],
  );

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId],
  );

  const handleOpenModal = () => {
    setIsModalOpen(true);
    setUploadError(null);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setNameInput('');
    setDescriptionInput('');
    setFileInput(null);
    setUploadError(null);
  };

  const handleUploadTemplate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!fileInput) {
      setUploadError('Selecione um arquivo .doc ou .docx.');
      return;
    }

    try {
      setUploading(true);
      setUploadError(null);

      const payload: CreateDocumentTemplateDTO = {
        name: nameInput || fileInput.name.replace(/\.[^.]+$/, ''),
        description: descriptionInput,
        content: defaultTemplateContent,
      };

      await documentTemplateService.createTemplateWithFile(payload, fileInput);
      const data = await documentTemplateService.listTemplates();
      setTemplates(data);
      handleCloseModal();
    } catch (err: any) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const buildPlaceholderMap = (client: Client) => {
    const placeholders: Record<string, string> = {};

    const registerPlaceholder = (key: string, value?: string | null) => {
      const safeValue = value ?? '';
      placeholders[key] = safeValue;
      placeholders[key.toUpperCase()] = safeValue;
      const normalizedKey = removeDiacritics(key);
      placeholders[normalizedKey] = safeValue;
      placeholders[normalizedKey.toUpperCase()] = safeValue;
    };

    registerPlaceholder('NOME COMPLETO', client.full_name);
    registerPlaceholder('nacionalidade', client.nationality);
    registerPlaceholder('estado civil', formatMaritalStatus(client.marital_status));
    registerPlaceholder('profissão', client.profession);
    registerPlaceholder('CPF', client.cpf_cnpj);
    registerPlaceholder('endereço', client.address_street);
    registerPlaceholder('número', client.address_number);
    registerPlaceholder('complemento', client.address_complement);
    registerPlaceholder('bairro', client.address_neighborhood);
    registerPlaceholder('cidade', client.address_city);
    registerPlaceholder('estado', client.address_state);
    registerPlaceholder('CEP', client.address_zip_code);
    const primaryPhone = client.phone || client.mobile || '';
    registerPlaceholder('telefone', primaryPhone);
    registerPlaceholder('celular', primaryPhone);
    registerPlaceholder('réu', defendantInput);
    registerPlaceholder('data', formatDate(currentDate.toISOString()));

    return placeholders;
  };

  const replacePlaceholdersInString = (templateString: string, placeholders: Record<string, string>) => {
    let result = templateString;
    Object.entries(placeholders).forEach(([key, value]) => {
      const pattern = new RegExp(`\[\[${escapeRegExp(key)}\]\]`, 'g');
      result = result.replace(pattern, value ?? '');
    });
    return result;
  };

  const handleGenerateDocument = async () => {
    if (!selectedClient || !selectedTemplate) {
      setGenerationError('Selecione o cliente e o modelo antes de gerar.');
      return null;
    }

    try {
      setGenerationError(null);

      const placeholders = buildPlaceholderMap(selectedClient);

      if (selectedTemplate.file_path) {
        const file = await documentTemplateService.downloadTemplateFile(selectedTemplate);
        const arrayBuffer = await file.arrayBuffer();
        const zip = new PizZip(arrayBuffer);
        const doc = new Docxtemplater(zip, {
          paragraphLoop: true,
          linebreaks: true,
          delimiters: { start: '[[', end: ']]' },
        });

        doc.render(placeholders);

        const renderedZip = doc.getZip();
        const blob = renderedZip.generate({
          type: 'blob',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        const text = sanitizeText(extractTextFromDocxZip(renderedZip) || Object.values(placeholders).join('\n'));
        return { blob, text };
      }

      const content = sanitizeText(replacePlaceholdersInString(selectedTemplate.content, placeholders));
      const paragraphs = content.split(/\n/g).map((line) =>
        new Paragraph({
          children: [new TextRun({ text: line, break: 0 })],
        }),
      );

      const doc = new DocxDocument({
        sections: [
          {
            properties: {},
            children: paragraphs,
          },
        ],
      });

      const blob = await Packer.toBlob(doc);
      return { blob, text: content };
    } catch (err: any) {
      console.error(err);
      setGenerationError(err.message || 'Não foi possível gerar o documento.');
      return null;
    }
  };

  const handleGenerateDocx = async () => {
    if (!selectedClient || !selectedTemplate) {
      setGenerationError('Selecione o cliente e o modelo antes de gerar.');
      return;
    }

    try {
      setGeneratingDocx(true);
      setGenerationError(null);
      setGenerationSuccess(null);
      const result = await handleGenerateDocument();
      if (!result) return;

      const fileName = `${selectedTemplate.name.replace(/\s+/g, '-')}-${removeDiacritics(selectedClient.full_name).replace(/\s+/g, '-')}.docx`;

      saveAs(result.blob, fileName);

      setGenerationSuccess('Documento Word gerado com sucesso.');
    } catch (err: any) {
      console.error(err);
      setGenerationError(err.message || 'Erro ao gerar documento.');
    } finally {
      setGeneratingDocx(false);
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    if (!confirm('Tem certeza que deseja remover este template?')) return;
    try {
      await documentTemplateService.deleteTemplate(id);
      const data = await documentTemplateService.listTemplates();
      setTemplates(data);
      if (selectedTemplateId === id) setSelectedTemplateId('');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const totalTemplates = templates.length;
  const templatesWithFile = templates.filter((template) => template.file_path).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h3 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
              <div className="bg-blue-100 p-2 rounded-lg">
                <FileText className="w-6 h-6 text-blue-600" />
              </div>
              Modelos de Documentos
            </h3>
            <p className="text-slate-600 mt-2">Gerencie templates personalizados e gere documentos rapidamente com dados automáticos.</p>
          </div>
          <button
            onClick={handleOpenModal}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-lg flex items-center gap-2 transition-colors shadow-sm"
          >
            <Plus className="w-5 h-5" />
            Novo Template
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-5 flex items-center gap-4 shadow-sm">
          <div className="w-12 h-12 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
            <BookOpen className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-600">Total de modelos</p>
            <p className="text-2xl font-bold text-slate-900">{totalTemplates}</p>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-5 flex items-center gap-4 shadow-sm">
          <div className="w-12 h-12 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center">
            <BarChart3 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-600">Modelos com arquivo</p>
            <p className="text-2xl font-bold text-slate-900">{templatesWithFile}</p>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-5 flex items-center gap-4 shadow-sm">
          <div className="w-12 h-12 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-600">Clientes cadastrados</p>
            <p className="text-2xl font-bold text-slate-900">{clients.length}</p>
          </div>
        </div>
      </div>

      {/* Seção de Geração - Destaque Principal */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Header com ícone e título */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 p-2.5 rounded-lg">
              <Sparkles className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900">Gerador de Documentos</h3>
              <p className="text-slate-600 text-sm mt-0.5">Crie documentos personalizados em segundos com dados automáticos</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Instruções passo a passo */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
            <h4 className="text-lg font-semibold text-blue-900 mb-4 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              Como funciona?
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-start gap-3">
                <div className="bg-blue-600 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0">1</div>
                <div>
                  <p className="font-semibold text-blue-900 text-sm">Selecione o Cliente</p>
                  <p className="text-xs text-blue-700 mt-1">Escolha o cliente para preencher automaticamente os dados</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="bg-blue-600 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0">2</div>
                <div>
                  <p className="font-semibold text-blue-900 text-sm">Escolha o Modelo</p>
                  <p className="text-xs text-blue-700 mt-1">Selecione o template de documento desejado</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="bg-blue-600 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0">3</div>
                <div>
                  <p className="font-semibold text-blue-900 text-sm">Gere o Documento</p>
                  <p className="text-xs text-blue-700 mt-1">Clique para gerar e baixar o arquivo Word</p>
                </div>
              </div>
            </div>
          </div>

          {/* Data atual em destaque */}
          <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
            <span className="text-sm font-medium text-slate-600">Data de geração:</span>
            <span className="text-base font-bold text-slate-900">{currentDate.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
          </div>

          {/* Formulário de geração */}
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Cliente */}
              <div className="space-y-3">
                <label className="block text-sm font-bold text-slate-900 mb-2 flex items-center gap-2">
                  <div className="bg-amber-100 text-amber-700 w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs">1</div>
                  Cliente *
                </label>
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={clientSearchTerm}
                    onChange={(e) => {
                      const value = e.target.value;
                      setClientSearchTerm(value);
                      if (!value.trim()) {
                        setSelectedClientId('');
                      }
                    }}
                    onFocus={() => setShowClientSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowClientSuggestions(false), 150)}
                    placeholder="Digite para buscar clientes pelo nome, CPF ou email"
                    className={`input-field pl-9 text-sm ${
                      selectedClientId ? 'border-emerald-500 bg-emerald-50' : 'border-gray-300'
                    }`}
                  />
                  {clientsLoading && (
                    <Loader2 className="w-4 h-4 text-amber-500 absolute right-3 top-1/2 -translate-y-1/2 animate-spin" />
                  )}

                  {showClientSuggestions && (
                    <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                      {clientsLoading ? (
                        <div className="flex items-center gap-2 px-4 py-3 text-sm text-slate-500">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Buscando clientes...
                        </div>
                      ) : clients.length === 0 ? (
                        <div className="px-4 py-3 text-xs text-slate-500">Nenhum cliente encontrado.</div>
                      ) : (
                        clients.map((client) => (
                          <button
                            type="button"
                            key={client.id}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              setSelectedClientId(client.id);
                              setClientSearchTerm(client.full_name);
                              setShowClientSuggestions(false);
                            }}
                            className={`w-full text-left px-4 py-3 text-sm hover:bg-amber-50 transition-colors ${
                              client.id === selectedClientId ? 'bg-emerald-50 text-emerald-700 font-medium' : 'text-slate-700'
                            }`}
                          >
                            <div className="font-semibold">{client.full_name}</div>
                            <div className="text-xs text-slate-500">
                              {client.cpf_cnpj || 'CPF/CNPJ não informado'} • {client.email || 'Sem e-mail'}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {selectedClient && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mt-2">
                    <p className="text-xs font-semibold text-emerald-800 mb-1">✓ Cliente selecionado</p>
                    <p className="text-xs text-emerald-700">CPF: {selectedClient.cpf_cnpj || 'Não informado'}</p>
                    <p className="text-xs text-emerald-700">Cidade: {selectedClient.address_city || 'Não informado'}</p>
                  </div>
                )}
              </div>

              {/* Modelo */}
              <div className="space-y-2">
                <label className="block text-sm font-bold text-slate-900 mb-2 flex items-center gap-2">
                  <div className="bg-amber-100 text-amber-700 w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs">2</div>
                  Modelo de Documento *
                </label>
                <select
                  className={`input-field text-base font-medium ${
                    selectedTemplateId ? 'border-emerald-500 bg-emerald-50' : 'border-gray-300'
                  }`}
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  disabled={loading}
                >
                  <option value="">Selecione um modelo</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
                {selectedTemplate && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mt-2">
                    <p className="text-xs font-semibold text-emerald-800 mb-1">✓ Modelo selecionado</p>
                    <p className="text-xs text-emerald-700">{selectedTemplate.description || 'Template pronto para uso'}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Réu / Parte contrária */}
            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-900 mb-2">Réu / Parte Contrária (Opcional)</label>
              <input
                type="text"
                className="input-field text-base"
                placeholder="Ex: João da Silva, Empresa XYZ Ltda."
                value={defendantInput}
                onChange={(e) => setDefendantInput(e.target.value)}
              />
              <p className="text-xs text-slate-500">Informe o nome da parte contrária se aplicável ao documento</p>
            </div>
          </div>

          {/* Mensagens de feedback */}
          {generationError && (
            <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg">
              <p className="text-sm font-medium text-red-800">{generationError}</p>
            </div>
          )}
          {generationSuccess && (
            <div className="bg-emerald-50 border-l-4 border-emerald-500 p-4 rounded-r-lg">
              <p className="text-sm font-medium text-emerald-800">{generationSuccess}</p>
            </div>
          )}

          {/* Botão de geração em destaque */}
          <div className="flex flex-col items-center gap-4 pt-4 border-t-2 border-dashed border-amber-200">
            <button
              onClick={handleGenerateDocx}
              disabled={generatingDocx || !selectedClientId || !selectedTemplateId}
              className="group relative bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-700 hover:to-amber-600 disabled:from-gray-400 disabled:to-gray-300 text-white font-bold px-12 py-4 rounded-xl shadow-xl hover:shadow-2xl transition-all duration-300 disabled:cursor-not-allowed transform hover:scale-105 disabled:hover:scale-100"
            >
              <div className="flex items-center gap-3">
                {generatingDocx ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <span className="text-lg">Gerando Documento...</span>
                  </>
                ) : (
                  <>
                    <FileDown className="w-6 h-6" />
                    <span className="text-lg">Gerar Documento Word</span>
                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </div>
              {!selectedClientId || !selectedTemplateId ? (
                <span className="absolute -bottom-8 left-1/2 transform -translate-x-1/2 text-xs text-slate-500 whitespace-nowrap">
                  Selecione cliente e modelo para continuar
                </span>
              ) : null}
            </button>
            
            {selectedClientId && selectedTemplateId && !generatingDocx && (
              <div className="flex items-center gap-2 text-sm text-emerald-600 font-medium">
                <CheckCircle2 className="w-4 h-4" />
                Tudo pronto! Clique para gerar seu documento
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 text-amber-600 animate-spin" />
            </div>
          ) : error ? (
            <div className="p-6">
              <p className="text-red-600">{error}</p>
            </div>
          ) : templates.length === 0 ? (
            <div className="p-6 text-center">
              <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <h4 className="text-lg font-semibold text-slate-900 mb-2">Nenhum template cadastrado</h4>
              <p className="text-slate-600">Crie seu primeiro template para começar a gerar documentos automaticamente.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {templates.map((template) => (
                <div key={template.id} className="p-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-2">
                    <h4 className="text-lg font-semibold text-slate-900">{template.name}</h4>
                    {template.description && (
                      <p className="text-sm text-slate-600">{template.description}</p>
                    )}
                    {!template.file_path && (
                      <pre className="bg-slate-50 border border-slate-100 rounded-lg p-4 text-sm text-slate-700 whitespace-pre-wrap">
                        {template.content}
                      </pre>
                    )}
                    {template.file_path && (
                      <p className="text-xs text-slate-500">
                        Arquivo Word enviado: {template.file_name} ({Math.round((template.file_size ?? 0) / 1024)} KB)
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handleDeleteTemplate(template.id)}
                    className="inline-flex items-center gap-2 bg-red-50 hover:bg-red-100 text-red-600 px-3 py-2 rounded-lg text-sm font-medium"
                  >
                    <Trash2 className="w-4 h-4" />
                    Remover
                  </button>
                </div>
              ))}
            </div>
          )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Novo Template</h3>
              <button
                onClick={handleCloseModal}
                className="text-slate-400 hover:text-slate-600 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUploadTemplate} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome do template</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Ex: Contrato de Honorários"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
                <textarea
                  className="input-field"
                  rows={3}
                  placeholder="Descreva o uso deste template"
                  value={descriptionInput}
                  onChange={(e) => setDescriptionInput(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Arquivo Word (.doc ou .docx)</label>
                <input
                  type="file"
                  accept=".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-amber-50 file:text-amber-700 hover:file:bg-amber-100"
                  onChange={(e) => setFileInput(e.target.files?.[0] ?? null)}
                />
                {fileInput && (
                  <p className="text-xs text-slate-500 mt-1">Arquivo selecionado: {fileInput.name}</p>
                )}
              </div>

              {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium px-4 py-2.5 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-medium px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                >
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                  {uploading ? 'Enviando...' : 'Criar Template'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default DocumentsModule;
