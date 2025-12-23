import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus,
  Loader2,
  Edit2,
  Trash2,
  Search,
  Eye,
  X,
  MessageSquare,
  Reply,
  FileSpreadsheet,
  Calendar,
  AlertTriangle,
  FileDown,
  FileText,
  Clock,
  Settings,
  Upload,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { requirementService } from '../services/requirement.service';
import { clientService } from '../services/client.service';
import { requirementDocumentService } from '../services/requirementDocument.service';
import { documentTemplateService } from '../services/documentTemplate.service';
import { settingsService } from '../services/settings.service';
import { useAuth } from '../contexts/AuthContext';
import { useToastContext } from '../contexts/ToastContext';
import { useDeleteConfirm } from '../contexts/DeleteConfirmContext';
import { useNavigation } from '../contexts/NavigationContext';
import { profileService } from '../services/profile.service';
import { deadlineService } from '../services/deadline.service';
import { calendarService } from '../services/calendar.service';
import { processService } from '../services/process.service';
import type { Requirement, RequirementStatus, BenefitType, RequirementStatusHistoryEntry } from '../types/requirement.types';
import type { Profile } from '../services/profile.service';
import ClientForm from './ClientForm';
import type { Client, CreateClientDTO } from '../types/client.types';
import type { DeadlinePriority } from '../types/deadline.types';
import type { CreateCalendarEventDTO } from '../types/calendar.types';
import type { Process, CreateProcessDTO, RequirementRole } from '../types/process.types';
import type { RequirementDocument } from '../types/requirementDocument.types';
import type { DocumentTemplate, CreateDocumentTemplateDTO } from '../types/document.types';

const STATUS_OPTIONS: {
  key: RequirementStatus;
  label: string;
  badge: string;
  color: string;
  animation?: string;
  animationStyle?: React.CSSProperties;
  icon?: 'spinner';
}[] = [
  {
    key: 'em_exigencia',
    label: 'Em Exigência',
    badge: 'bg-yellow-500 text-white',
    color: 'yellow',
    animation: 'animate-pulse ring-2 ring-yellow-300/50 shadow shadow-yellow-200/60',
    animationStyle: { animationDuration: '2s' },
  },
  {
    key: 'aguardando_pericia',
    label: 'Aguardando Perícia',
    badge: 'bg-cyan-500 text-white',
    color: 'cyan',
    animation: 'animate-pulse ring-2 ring-cyan-300/60 shadow shadow-cyan-200/60',
    animationStyle: { animationDuration: '2.4s' },
  },
  {
    key: 'em_analise',
    label: 'Em Análise',
    badge: 'bg-slate-400 text-white',
    color: 'slate',
    animation: 'animate-pulse ring-2 ring-blue-300/60 shadow-md shadow-blue-200/40',
    animationStyle: { animationDuration: '1.6s' },
    icon: 'spinner',
  },
  {
    key: 'aguardando_confeccao',
    label: 'Aguardando Confecção',
    badge: 'bg-blue-500 text-white',
    color: 'blue',
    animation: 'animate-pulse ring-2 ring-blue-300/60 shadow shadow-blue-200/60',
    animationStyle: { animationDuration: '2.2s' },
  },
  {
    key: 'deferido',
    label: 'Deferidos',
    badge: 'bg-green-600 text-white',
    color: 'green',
    animation: 'animate-pulse ring-2 ring-green-300/60 shadow shadow-green-200/50',
    animationStyle: { animationDuration: '2.8s' },
  },
  {
    key: 'indeferido',
    label: 'Indeferidos',
    badge: 'bg-red-600 text-white',
    color: 'red',
    animation: 'animate-pulse ring-2 ring-red-300/60 shadow shadow-red-200/60',
    animationStyle: { animationDuration: '2.2s' },
  },
  {
    key: 'ajuizado',
    label: 'Ajuizados',
    badge: 'bg-blue-900 text-white',
    color: 'blue',
    animation: 'animate-pulse ring-2 ring-blue-800/50 shadow shadow-blue-800/40',
    animationStyle: { animationDuration: '2.6s' },
  },
];

const STATUS_PRIORITY: Record<RequirementStatus, number> = {
  em_exigencia: 0,
  aguardando_pericia: 1,
  em_analise: 2,
  aguardando_confeccao: 3,
  indeferido: 4,
  deferido: 5,
  ajuizado: 6,
};

const DEADLINE_PRIORITY_OPTIONS: { value: DeadlinePriority; label: string }[] = [
  { value: 'urgente', label: 'Urgente' },
  { value: 'alta', label: 'Alta' },
  { value: 'media', label: 'Média' },
  { value: 'baixa', label: 'Baixa' },
];

const BENEFIT_TYPES: { key: BenefitType; label: string }[] = [
  { key: 'bpc_loas', label: 'BPC/LOAS' },
  { key: 'aposentadoria_tempo', label: 'Aposentadoria por Tempo de Contribuição' },
  { key: 'aposentadoria_idade', label: 'Aposentadoria por Idade' },
  { key: 'aposentadoria_invalidez', label: 'Aposentadoria por Invalidez' },
  { key: 'auxilio_acidente', label: 'Auxílio Acidente' },
  { key: 'auxilio_doenca', label: 'Auxílio Doença' },
  { key: 'pensao_morte', label: 'Pensão por Morte' },
  { key: 'salario_maternidade', label: 'Salário Maternidade' },
  { key: 'outro', label: 'Outro' },
];

type RequirementNote = {
  id: string;
  text: string;
  created_at: string;
  author?: string;
  author_id?: string | null;
  author_name?: string | null;
  author_avatar?: string | null;
  parent_id?: string | null;
  replies?: RequirementNote[];
};

type RequirementFormData = {
  protocol: string;
  beneficiary: string;
  cpf: string;
  benefit_type: BenefitType | '';
  status: RequirementStatus;
  entry_date: string;
  phone: string;
  inss_password: string;
  observations: string;
  notes: string;
  exigency_due_date: string;
  client_id: string;
};

type ExigencyModalState = {
  requirementId: string;
  defaultTitle: string;
  beneficiaryName: string;
  benefitTypeLabel: string;
};

type PericiaModalState = {
  requirementId: string;
  beneficiaryName: string;
  benefitTypeLabel: string;
};

type PericiaScheduleFormState = {
  includeMedica: boolean;
  medicaDate: string;
  medicaTime: string;
  includeSocial: boolean;
  socialDate: string;
  socialTime: string;
  notifyDaysBefore: string;
};

const emptyForm: RequirementFormData = {
  protocol: '',
  beneficiary: '',
  cpf: '',
  benefit_type: '',
  status: 'aguardando_confeccao' as RequirementStatus,
  entry_date: '',
  exigency_due_date: '',
  phone: '',
  inss_password: '',
  observations: '',
  notes: '',
  client_id: '',
};

const formatDate = (value?: string | null) => {
  if (!value) return 'Não informado';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('pt-BR');
};

const formatDateTime = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const generateId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
};

const parseNotes = (value?: string | null): RequirementNote[] => {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item) => typeof item === 'object' && item !== null && typeof item.text === 'string')
        .map((item) => ({
          id: typeof item.id === 'string' ? item.id : generateId(),
          text: String(item.text),
          created_at: typeof item.created_at === 'string' ? item.created_at : new Date().toISOString(),
          author: typeof item.author === 'string' ? item.author : undefined,
          author_id: typeof item.author_id === 'string' ? item.author_id : undefined,
          author_name:
            typeof item.author_name === 'string'
              ? item.author_name
              : typeof item.author === 'string'
              ? item.author
              : undefined,
          author_avatar: typeof item.author_avatar === 'string' ? item.author_avatar : undefined,
          parent_id: typeof item.parent_id === 'string' ? item.parent_id : null,
        }));
    }
  } catch (error) {
    // Mantém compatibilidade com notas antigas
  }

  return [
    {
      id: generateId(),
      text: value,
      created_at: new Date().toISOString(),
      author_name: 'Equipe do escritório',
    },
  ];
};

const serializeNotes = (notes: RequirementNote[]): string =>
  JSON.stringify(
    notes.map(({ id, text, created_at, author, author_id, author_name, author_avatar, parent_id }) => ({
      id,
      text,
      created_at,
      author,
      author_id,
      author_name,
      author_avatar,
      parent_id,
    })),
  );

const buildNoteThreads = (notes: RequirementNote[]): RequirementNote[] => {
  const items = notes
    .slice()
    .map((note) => ({ ...note, replies: [] }))
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const map = new Map<string, RequirementNote>();
  items.forEach((note) => {
    map.set(note.id, note);
  });

  const roots: RequirementNote[] = [];
  map.forEach((note) => {
    if (note.parent_id && map.has(note.parent_id)) {
      map.get(note.parent_id)!.replies!.push(note);
    } else {
      roots.push(note);
    }
  });

  const sortRecursive = (threads: RequirementNote[]) => {
    threads.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    threads.forEach((thread) => {
      if (thread.replies) {
        sortRecursive(thread.replies);
      }
    });
  };

  sortRecursive(roots);
  return roots;
};

const toDateInputValue = (value?: string | null) => {
  if (!value) return '';
  if (value.includes('T')) return value.split('T')[0];
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }
  return value;
};

const formatCPF = (value: string) => {
  const cleaned = value.replace(/\D/g, '');
  if (cleaned.length <= 3) return cleaned;
  if (cleaned.length <= 6) return `${cleaned.slice(0, 3)}.${cleaned.slice(3)}`;
  if (cleaned.length <= 9) return `${cleaned.slice(0, 3)}.${cleaned.slice(3, 6)}.${cleaned.slice(6)}`;
  return `${cleaned.slice(0, 3)}.${cleaned.slice(3, 6)}.${cleaned.slice(6, 9)}-${cleaned.slice(9, 11)}`;
};

const formatPhone = (value: string) => {
  const cleaned = value.replace(/\D/g, '');
  if (cleaned.length <= 2) return cleaned;
  if (cleaned.length <= 7) return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2)}`;
  if (cleaned.length <= 11) return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2, 7)}-${cleaned.slice(7)}`;
  return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2, 7)}-${cleaned.slice(7, 11)}`;
};

const removeDiacritics = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .normalize('NFC');

const formatDateLong = (date: Date) => {
  try {
    const dtf = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    return dtf.format(date);
  } catch {
    return date.toLocaleDateString('pt-BR');
  }
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const replacePlaceholdersInString = (templateString: string, placeholders: Record<string, string>) => {
  let result = templateString;
  Object.entries(placeholders).forEach(([key, value]) => {
    const pattern = new RegExp(`\[\[${escapeRegExp(key)}\]\]`, 'g');
    result = result.replace(pattern, value ?? '');
  });
  return result;
};

const buildFullAddress = (client: Client) => {
  const parts: string[] = [];
  const street = (client.address_street || '').trim();
  const number = (client.address_number || '').trim();
  const complement = (client.address_complement || '').trim();
  const neighborhood = (client.address_neighborhood || '').trim();
  const city = (client.address_city || '').trim();
  const state = (client.address_state || '').trim();
  const cep = (client.address_zip_code || '').trim();

  const line1 = [street, number ? `nº ${number}` : '', complement].filter(Boolean).join(', ');
  const line2 = [neighborhood ? `Bairro ${neighborhood}` : '', city, state].filter(Boolean).join(' - ');

  if (line1) parts.push(line1);
  if (line2) parts.push(line2);
  if (cep) parts.push(`CEP ${cep}`);

  return parts.join(', ');
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

const MS_PETITION_TEMPLATE = `EXCELENTÍSSIMO SENHOR DOUTOR JUIZ FEDERAL DA_ª VARA FEDEERAL DA SEÇÃO JUDICIÁRIA DE [[cidade]] / [[estado]]



[[NOME COMPLETO]], [[nacionalidade]], [[estado civil]], [[profissão]], inscrito(a) no CPF sob o nº [[CPF]], residente e domiciliado(a) na [[endereço]], nº [[número]], [[complemento]], Bairro [[bairro]], [[cidade]] – [[estado]], CEP [[CEP]], telefone/WhatsApp [[celular]], por intermédio de seu advogado que esta subscreve, com endereço profissional descrito no timbre do rodapé e endereço eletrônico pedro@advcuiaba.com, onde recebe as intimações de estilo, vem à presença de Vossa Excelência, impetrar

MANDADO DE SEGURANÇA COM PEDIDO LIMINAR DE ANTECIPAÇÃO DA TUTELA SATISFATIVA

Contra ato ilegal e abusivo do GERENTE EXECUTIVO DO INSS, endereço pessoal desconhecido, estando a autoridade coatora vinculada à pessoa jurídica do INSTITUTO NACIONAL DO SEGURO SOCIAL – INSS, pessoa jurídica de direito público interno, com endereço no Setor de Autarquias Sul Q. 4 BL M - Asa Sul, Brasília - DF, 70070-924, pelos fatos e fundamentos que seguem.

1 – DA JUSTIÇA GRATUITA

Requer o (a) Impetrante, com supedâneo no permissivo do art. 98 do CPC/15, os benefícios da gratuidade judiciária, uma vez que não dispõe de recursos suficientes para arcar com os encargos decorrentes do processo, sem prejuízo do seu próprio sustento e de sua família.

2 – DOS FATOS

O (a) Impetrante, em [[DATA_REQUERIMENTO]], requereu administrativamente junto ao INSS a concessão do benefício identificado no protocolo abaixo.

Protocolo administrativo: [[PROTOCOLO]]
Tipo/benefício: [[BENEFICIO]]
Tempo em análise (dias): [[TEMPO_EM_ANALISE_DIAS]]

Mesmo com o processo devidamente instruído, não houve qualquer decisão por parte da Autarquia Previdenciária, conforme, extrapolando o prazo previsto na Lei nº 9.784/99 (Lei do Processo Administrativo).

Por esse motivo o (a) Impetrante impetra o presente Mandado de Segurança, buscando o amparo do seu direito líquido e certo à análise e manifestação acerca do seu pedido administrativo.

3 – DO DIREITO
3.1 – DO CABIMENTO DO MANDADO DE SEGURANÇA

Conforme o Artigo 5º LXIX, da Constituição da República Federativa do Brasil, conceder-se-á mandado de segurança para proteger direito líquido e certo, não amparado por “habeas-corpus” ou “habeas-data”, quando o responsável pela ilegalidade ou abuso de poder for autoridade pública ou agente de pessoa jurídica no exercício de atribuições do Poder Público.
            Nesse mesmo sentido é a redação do artigo 1º da Lei 12.016 de 2009 ao assegurar que conceder-se-á mandado de segurança para proteger direito líquido e certo, não amparado por habeas corpus ou habeas data, sempre que, ilegalmente ou com abuso de poder, qualquer pessoa física ou jurídica sofrer violação ou houver justo receio de sofrê-la por parte de autoridade, seja de que categoria for e sejam quais forem as funções que exerça.
            No caso em tela, o direito líquido e certo está sendo violado por ato ilegal do INSS – na figura do Gerente da Agência da Previdência Social, eis que até o presente momento o seu pedido de concessão do benefício ([[BENEFICIO]])   sequer fora analisado, estando o direito do segurado à razoável duração do processo e à celeridade de sua tramitação sendo ferido de morte.
Sobre o tema, a jurisprudência entende que:
MANDADO DE SEGURANÇA. DEMORA NA ANÁLISE DO BENEFÍCIO. NECESSIDADE DE OBSERVÂNCIA DA RAZOÁVEL DURAÇÃO DO PROCESSO E DO PRINCÍPIO DA EFICIÊNCIA. PREVISÃO INFRACONSTITUCIONAL DE DURAÇÃO DA ETAPA DE CONCESSÃO DOS BENEFÍCIOS EM 90 DIAS . ACORDO REALIZADO NO RE 1171152/SC. SUPERAÇÃO DO PRAZO PREVISTO NO RE 631241/MG. APELAÇÃO NÃO PROVIDA. 1 . Os requerimentos dirigidos ao INSS devem ser apreciados em prazos razoáveis e uniformes, em obediência ao princípio da eficiência, razoável duração do processo e necessidade de cumprimento de prazos pelos agentes públicos, conforme previsão da Lei 13.460/2017. 2. O próprio INSS editou Carta de Serviços que coloca como tempo de duração da etapa de concessão das aposentadorias, em regra, 90 dias . Ademais, foi firmado acordo nos autos do RE 1171152/SC com previsão de prazos para análise dos processos administrativos relacionados a todos os benefícios administrados pelo INSS, gerando parâmetro a ser utilizado pelo julgador para averiguar a demora desarrazoada da decisão. 3. A burocracia interna do órgão previdenciário, no que tange a existência de setor apropriado para tomada de decisões que visam à implantação dos benefícios postulados, não serve de escusa à consecução, em prazos irrazoáveis, de suas finalidades institucionais. 4 . No caso concreto, a demora na análise do benefício ultrapassou até mesmo o prazo de 90 dias definido no RE 631.241/MG, não podendo se acolher o pedido de utilização desde parâmetro para afastar a condenação. 5. Apelação a que se nega provimento . (TRF-1 - APELAÇÃO CIVEL: 10009466620194013704, Relator.: DESEMBARGADOR FEDERAL URBANO LEAL BERQUÓ NETO, Data de Julgamento: 13/03/2024, NONA TURMA, Data de Publicação: PJe 13/03/2024 PAG PJe 13/03/2024 PAG)

3.2 – INTERESSE DE AGIR
 No presente caso o interesse processual do (a) Impetrante assenta-se na omissão do Gerente da Agência da Previdência Social que até o momento não se manifestou acerca do pedido administrativo formulado pelo (a) Impetrante, tendo sido ultrapassado o prazo previsto na Lei nº. 9.784/99 sem que tenha sido proferida decisão.
Nessa esteira, considerando a decisão do Gerente do INSS, evidente a presença do trinômio necessidade-utilidade-adequação que caracteriza o interesse de agir, na medida em que o ato ilegal emanado pelo Administrador somente poderá ser reparado pela atuação do Poder Judiciário, por meio do processo, instrumento útil e adequado para persecução deste fim.

Pelo exposto, denota-se que a omissão e a inércia administrativa, implica em grave prejuízo ao seu direito, e assim configura o interesse de agir.

4 – DOS PEDIDOS

ISSO POSTO, requer:

a)   o recebimento e o deferimento da presente peça inaugural;
b)   o deferimento do benefício da Gratuidade da Justiça, por ser o Impetrante pobre na acepção legal do termo;

c)   a concessão liminar de tutela de urgência para determinar a imediata análise do pedido administrativo de concessão de [[BENEFICIO]] formulado pelo (a) Impetrante;

d) a notificação da autoridade coatora, Gerente-executivo do INSS, para que preste as informações de estilo, nos termos do art. 7º, I, da Lei 12.016/09;

e)   a CONCESSÃO DA SEGURANÇA a fim de confirmar a tutela de urgência, sendo analisado o pedido administrativo de concessão do benefício [[BENEFICIO]] formulado pelo Impetrante.

Dá‐se à causa o valor de R$ 1.000,00 (um mil reais) para fins meramente procedimentais.

São os termos em que,
                                                          Pede deferimento.

[[cidade]] – [[estado]], [[data]].

Pedro Rodrigues Montalvão Neto, advogado
OAB MT 30.021
`;

interface RequirementsModuleProps {
  forceCreate?: boolean;
  entityId?: string;
  prefillData?: {
    client_id?: string;
    beneficiary?: string;
    cpf?: string;
  };
  onParamConsumed?: () => void;
}

const RequirementsModule: React.FC<RequirementsModuleProps> = ({ forceCreate, entityId, prefillData, onParamConsumed }) => {
  const { user } = useAuth();
  const toast = useToastContext();
  const { confirmDelete } = useDeleteConfirm();
  const { navigateTo } = useNavigation();
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<RequirementFormData>(emptyForm);
  const [selectedRequirement, setSelectedRequirement] = useState<Requirement | null>(null);
  const [filterProtocol, setFilterProtocol] = useState('');
  const [filterBeneficiary, setFilterBeneficiary] = useState('');
  const [filterCPF, setFilterCPF] = useState('');
  const [filterBenefitType, setFilterBenefitType] = useState<BenefitType | ''>('');
  const [filterOnlyMsRisk, setFilterOnlyMsRisk] = useState(false);
  const [activeStatusTab, setActiveStatusTab] = useState<RequirementStatus | 'todos'>('todos');
  const [viewMode, setViewMode] = useState<'list' | 'details'>('list');
  const [selectedRequirementForView, setSelectedRequirementForView] = useState<Requirement | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [addingReply, setAddingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [linkedProcesses, setLinkedProcesses] = useState<{ principal?: Process | null; ms?: Process | null }>({
    principal: null,
    ms: null,
  });
  const [loadingLinkedProcesses, setLoadingLinkedProcesses] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
  const [members, setMembers] = useState<Profile[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [beneficiarySearchTerm, setBeneficiarySearchTerm] = useState('');
  const [showBeneficiarySuggestions, setShowBeneficiarySuggestions] = useState(false);
  const [isClientFormModalOpen, setIsClientFormModalOpen] = useState(false);
  const [clientFormPrefill, setClientFormPrefill] = useState<Partial<CreateClientDTO> | null>(null);
  const [selectedClientForRequirement, setSelectedClientForRequirement] = useState<Client | null>(null);
  const [requirementDocuments, setRequirementDocuments] = useState<RequirementDocument[]>([]);
  const [requirementDocumentsLoading, setRequirementDocumentsLoading] = useState(false);
  const [generatingMsPdf, setGeneratingMsPdf] = useState(false);
  const [msTemplateModalOpen, setMsTemplateModalOpen] = useState(false);
  const [msTemplateLoading, setMsTemplateLoading] = useState(false);
  const [msTemplateSaving, setMsTemplateSaving] = useState(false);
  const [msTemplateId, setMsTemplateId] = useState<string>('');
  const [msTemplate, setMsTemplate] = useState<DocumentTemplate | null>(null);
  const [msTemplates, setMsTemplates] = useState<DocumentTemplate[]>([]);
  const [msTemplateUploadFile, setMsTemplateUploadFile] = useState<File | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [schedulePromptId, setSchedulePromptId] = useState<string | null>(null);
  const [exigencyModal, setExigencyModal] = useState<ExigencyModalState | null>(null);
  const [periciaModal, setPericiaModal] = useState<PericiaModalState | null>(null);
  const [periciaForm, setPericiaForm] = useState<PericiaScheduleFormState>({
    includeMedica: true,
    medicaDate: '',
    medicaTime: '',
    includeSocial: false,
    socialDate: '',
    socialTime: '',
    notifyDaysBefore: '1',
  });
  const [periciaSaving, setPericiaSaving] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [statusHistory, setStatusHistory] = useState<RequirementStatusHistoryEntry[]>([]);
  const [statusHistoryLoading, setStatusHistoryLoading] = useState(false);
  const [exigencyForm, setExigencyForm] = useState({
    title: '',
    due_date: '',
    priority: 'alta' as DeadlinePriority,
    notify_days_before: '3',
  });
  const exigencySubmittingRef = useRef(false);

  const memberMap = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const memberByUserId = useMemo(
    () => new Map(members.map((member) => [member.user_id, member])),
    [members],
  );

  const handleOpenProcessDetails = (processId: string) => {
    navigateTo('processos', { mode: 'details', entityId: processId } as any);
  };

  const handleCreateProcessFromRequirement = async (role: RequirementRole) => {
    if (!selectedRequirementForView) return;

    if (role === 'principal' && linkedProcesses.principal?.id) {
      handleOpenProcessDetails(linkedProcesses.principal.id);
      return;
    }

    if (role === 'ms' && linkedProcesses.ms?.id) {
      handleOpenProcessDetails(linkedProcesses.ms.id);
      return;
    }

    if (!selectedRequirementForView.client_id) {
      toast.error('Vincule um cliente ao requerimento antes de converter em processo.');
      return;
    }

    try {
      setLoadingLinkedProcesses(true);

      const baseNotes = [
        `Origem: Requerimento ${selectedRequirementForView.protocol ?? 'sem protocolo'}`,
        `Beneficiário: ${selectedRequirementForView.beneficiary}`,
        `CPF: ${selectedRequirementForView.cpf}`,
      ].join('\n');

      const payload: CreateProcessDTO = {
        client_id: selectedRequirementForView.client_id,
        process_code: '',
        status: 'aguardando_confeccao',
        practice_area: 'previdenciario',
        court: role === 'ms' ? 'Mandado de Segurança' : 'INSS',
        responsible_lawyer_id: user?.id || undefined,
        requirement_id: selectedRequirementForView.id,
        requirement_role: role,
        notes: baseNotes,
      };

      const created = await processService.createProcess(payload as any);

      const processes = await processService.listProcesses({ requirement_id: selectedRequirementForView.id });
      const principal = processes.find((p) => p.requirement_role === 'principal') || null;
      const ms = processes.find((p) => p.requirement_role === 'ms') || null;
      setLinkedProcesses({ principal, ms });

      toast.success(role === 'ms' ? 'Processo de MS criado com sucesso.' : 'Processo criado com sucesso.');
      handleOpenProcessDetails(created.id);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Não foi possível criar o processo.');
    } finally {
      setLoadingLinkedProcesses(false);
    }
  };

  const toLocalDateTimeInput = (iso?: string | null) => {
    if (!iso) return { date: '', time: '' };
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return { date: '', time: '' };

    const pad = (n: number) => String(n).padStart(2, '0');
    const date = `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
    const time = `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
    return { date, time };
  };

  const toUtcIsoFromLocalDateTime = (dateOnly: string, timeOnly: string) => {
    const date = new Date(`${dateOnly}T${timeOnly}:00`);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  };

  const getPericiaEndAt = (requirement: Requirement) => {
    const times: number[] = [];
    if (requirement.pericia_medica_at) {
      const t = new Date(requirement.pericia_medica_at).getTime();
      if (!Number.isNaN(t)) times.push(t);
    }
    if (requirement.pericia_social_at) {
      const t = new Date(requirement.pericia_social_at).getTime();
      if (!Number.isNaN(t)) times.push(t);
    }
    if (!times.length) return null;
    return new Date(Math.max(...times)).toISOString();
  };

  const getPericiaNextAt = (requirement: Requirement) => {
    const times: number[] = [];
    if (requirement.pericia_medica_at) {
      const t = new Date(requirement.pericia_medica_at).getTime();
      if (!Number.isNaN(t)) times.push(t);
    }
    if (requirement.pericia_social_at) {
      const t = new Date(requirement.pericia_social_at).getTime();
      if (!Number.isNaN(t)) times.push(t);
    }
    if (!times.length) return null;
    return new Date(Math.min(...times)).toISOString();
  };

  const getAnalysisDays = (requirement: Requirement) => {
    const base = requirement.analysis_started_at || requirement.entry_date || requirement.created_at;
    const t = new Date(base).getTime();
    if (Number.isNaN(t)) return null;
    return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
  };

  const getAnalysisAlertLevel = (days: number | null) => {
    if (typeof days !== 'number') return null;
    if (days >= 90) return 'critical';
    if (days >= 60) return 'high';
    if (days >= 30) return 'medium';
    return 'none';
  };

  const isMandadoRisk = (requirement: Requirement) => {
    if (requirement.status !== 'em_analise') return false;
    const days = getAnalysisDays(requirement);
    return typeof days === 'number' && days >= 90;
  };

  const periciaAutoUpdateRef = useRef(false);
  const autoUpdatePericiaStatuses = async (list: Requirement[]) => {
    if (periciaAutoUpdateRef.current) return;
    const now = Date.now();

    const candidates = list
      .filter((req) => req.status === 'aguardando_pericia')
      .map((req) => ({ req, endAt: getPericiaEndAt(req) }))
      .filter((item) => {
        if (!item.endAt) return false;
        const endTime = new Date(item.endAt).getTime();
        return !Number.isNaN(endTime) && endTime < now;
      });

    if (!candidates.length) return;

    periciaAutoUpdateRef.current = true;
    try {
      await Promise.all(candidates.map((item) => requirementService.updateStatus(item.req.id, 'em_analise')));
      await handleReload();
    } catch (err) {
      console.error('Erro ao atualizar status automático (perícia):', err);
    } finally {
      periciaAutoUpdateRef.current = false;
    }
  };

  const openExigencyModal = (requirement?: Requirement | null) => {
    if (!requirement) return;
    const beneficiaryName = requirement.beneficiary ?? 'Beneficiário';

    setExigencyForm({
      title: `Atender exigência - ${beneficiaryName}`,
      due_date: '',
      priority: 'alta',
      notify_days_before: '3',
    });

    setExigencyModal({
      requirementId: requirement.id,
      defaultTitle: `Atender exigência - ${beneficiaryName}`,
      beneficiaryName,
      benefitTypeLabel: getBenefitTypeLabel(requirement.benefit_type),
    });
  };

  const openPericiaModal = (requirement?: Requirement | null) => {
    if (!requirement) return;
    const medica = toLocalDateTimeInput(requirement.pericia_medica_at ?? null);
    const social = toLocalDateTimeInput(requirement.pericia_social_at ?? null);

    setPericiaForm({
      includeMedica: Boolean(requirement.pericia_medica_at) || !requirement.pericia_social_at,
      medicaDate: medica.date,
      medicaTime: medica.time,
      includeSocial: Boolean(requirement.pericia_social_at),
      socialDate: social.date,
      socialTime: social.time,
      notifyDaysBefore: '1',
    });

    setPericiaModal({
      requirementId: requirement.id,
      beneficiaryName: requirement.beneficiary ?? 'Beneficiário',
      benefitTypeLabel: getBenefitTypeLabel(requirement.benefit_type),
    });
  };

  const detailNotes = useMemo(() => {
    if (!selectedRequirementForView) return [] as RequirementNote[];
    return parseNotes(selectedRequirementForView.notes);
  }, [selectedRequirementForView]);

  const noteThreads = useMemo<RequirementNote[]>(() => {
    return buildNoteThreads(detailNotes);
  }, [detailNotes]);

  useEffect(() => {
    if (!selectedRequirementForView?.id) {
      setLinkedProcesses({ principal: null, ms: null });
      return;
    }

    let active = true;
    (async () => {
      try {
        setLoadingLinkedProcesses(true);
        const processes = await processService.listProcesses({ requirement_id: selectedRequirementForView.id });
        if (!active) return;

        const principal = processes.find((p) => p.requirement_role === 'principal') || null;
        const ms = processes.find((p) => p.requirement_role === 'ms') || null;
        setLinkedProcesses({ principal, ms });
      } catch (err) {
        if (!active) return;
        console.error('Erro ao buscar processos vinculados:', err);
        setLinkedProcesses({ principal: null, ms: null });
      } finally {
        if (active) setLoadingLinkedProcesses(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [selectedRequirementForView?.id]);

  useEffect(() => {
    if (!selectedRequirementForView?.id) {
      setRequirementDocuments([]);
      setSelectedClientForRequirement(null);
      return;
    }

    let active = true;
    (async () => {
      try {
        setRequirementDocumentsLoading(true);
        const docs = await requirementDocumentService.listByRequirementId(selectedRequirementForView.id);
        if (!active) return;
        setRequirementDocuments(docs);

        if (selectedRequirementForView.client_id) {
          const client = await clientService.getClientById(selectedRequirementForView.client_id);
          if (!active) return;
          setSelectedClientForRequirement(client);
        } else {
          setSelectedClientForRequirement(null);
        }
      } catch (e: any) {
        console.error(e);
      } finally {
        if (active) setRequirementDocumentsLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [selectedRequirementForView?.id, selectedRequirementForView?.client_id]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const raw = await settingsService.getSetting<string>('requirements_ms_template_id');
        if (!active) return;
        const value = (raw || '').toString();
        setMsTemplateId(value);

        if (value) {
          const tpl = await documentTemplateService.getTemplate(value);
          if (!active) return;
          setMsTemplate(tpl);
        } else {
          setMsTemplate(null);
        }
      } catch (e) {
        console.error(e);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const loadMsTemplates = async () => {
    setMsTemplateLoading(true);
    try {
      const list = await documentTemplateService.listTemplates();
      setMsTemplates(list);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Erro ao carregar templates.');
    } finally {
      setMsTemplateLoading(false);
    }
  };

  const handleOpenMsTemplateModal = async () => {
    setMsTemplateUploadFile(null);
    setMsTemplateModalOpen(true);
    await loadMsTemplates();
  };

  const handleCloseMsTemplateModal = () => {
    setMsTemplateModalOpen(false);
    setMsTemplateUploadFile(null);
  };

  const handleUploadMsTemplateDocx = async () => {
    if (!msTemplateUploadFile) {
      toast.error('Selecione um arquivo .docx');
      return;
    }
    if (!msTemplateUploadFile.name.toLowerCase().endsWith('.docx')) {
      toast.error('Selecione um arquivo .docx');
      return;
    }

    try {
      setMsTemplateSaving(true);

      const payload: CreateDocumentTemplateDTO = {
        name: `Modelo MS (Requerimentos) - ${new Date().toLocaleDateString('pt-BR')}`,
        description: '[REQUERIMENTOS_MS] Template DOCX usado pelo módulo de Requerimentos para gerar MS em Word (DOCX).',
        content: MS_PETITION_TEMPLATE,
        enable_defendant: false,
      };

      const created = await documentTemplateService.createTemplateWithFile(payload, msTemplateUploadFile);
      setMsTemplateId(created.id);
      setMsTemplate(created);
      await settingsService.updateSetting('requirements_ms_template_id', created.id);
      await loadMsTemplates();
      toast.success('Template enviado', 'Modelo Word do MS salvo e selecionado.');
      setMsTemplateUploadFile(null);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Erro ao enviar template.');
    } finally {
      setMsTemplateSaving(false);
    }
  };

  const handleSaveSelectedMsTemplate = async () => {
    try {
      setMsTemplateSaving(true);
      const nextId = (msTemplateId || '').trim();
      await settingsService.updateSetting('requirements_ms_template_id', nextId || '');

      if (nextId) {
        const tpl = await documentTemplateService.getTemplate(nextId);
        setMsTemplate(tpl);
      } else {
        setMsTemplate(null);
      }

      toast.success('Template atualizado');
      setMsTemplateModalOpen(false);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Erro ao salvar template.');
    } finally {
      setMsTemplateSaving(false);
    }
  };

  const buildMsPlaceholders = (requirement: Requirement, client: Client) => {
    const placeholders: Record<string, string> = {};
    const registerPlaceholder = (key: string, value?: string | null) => {
      const safeValue = (value ?? '').toString();
      const titleKey = key ? `${key.charAt(0).toUpperCase()}${key.slice(1)}` : key;
      placeholders[key] = safeValue;
      placeholders[key.toUpperCase()] = safeValue;
      placeholders[key.toLowerCase()] = safeValue;
      placeholders[titleKey] = safeValue;
      const normalizedKey = removeDiacritics(key);
      placeholders[normalizedKey] = safeValue;
      placeholders[normalizedKey.toUpperCase()] = safeValue;
      placeholders[normalizedKey.toLowerCase()] = safeValue;
      if (normalizedKey) {
        const normalizedTitle = `${normalizedKey.charAt(0).toUpperCase()}${normalizedKey.slice(1)}`;
        placeholders[normalizedTitle] = safeValue;
      }
    };

    const now = new Date();
    const benefitLabel = getBenefitTypeLabel(requirement.benefit_type);
    const primaryPhone = client.mobile || client.phone || requirement.phone || '';

    const entryDate = requirement.entry_date ? new Date(requirement.entry_date) : null;
    const entryDateLabel = entryDate ? formatDateLong(entryDate) : '';

    const analysisDays = typeof getAnalysisDays(requirement) === 'number' ? String(getAnalysisDays(requirement)) : '';

    const cityUpper = (client.address_city || '').toUpperCase();

    registerPlaceholder('NOME COMPLETO', client.full_name);
    registerPlaceholder('nacionalidade', client.nationality);
    registerPlaceholder('estado civil', formatMaritalStatus(client.marital_status));
    registerPlaceholder('profissão', client.profession);
    registerPlaceholder('CPF', client.cpf_cnpj);
    registerPlaceholder('endereço', client.address_street);
    registerPlaceholder('número', client.address_number);
    registerPlaceholder('complemento', client.address_complement);
    registerPlaceholder('bairro', client.address_neighborhood);
    registerPlaceholder('cidade', cityUpper);
    registerPlaceholder('estado', client.address_state);
    registerPlaceholder('CEP', client.address_zip_code);
    registerPlaceholder('telefone', primaryPhone);
    registerPlaceholder('celular', primaryPhone);
    registerPlaceholder('ENDERECO_COMPLETO', buildFullAddress(client));

    registerPlaceholder('PROTOCOLO', requirement.protocol);
    registerPlaceholder('BENEFICIO', benefitLabel);
    registerPlaceholder('DATA_REQUERIMENTO', entryDateLabel);
    registerPlaceholder('TEMPO_EM_ANALISE_DIAS', analysisDays);
    registerPlaceholder('DATA_ATUAL_EXTENSO', formatDateLong(now));
    registerPlaceholder('data', now.toLocaleDateString('pt-BR'));

    return placeholders;
  };

  const generateMsDocxFromTemplate = async (template: DocumentTemplate, placeholders: Record<string, string>) => {
    if (!template.file_path) {
      throw new Error('Selecione um template MS em Word (DOCX) para manter o layout.');
    }

    const file = await documentTemplateService.downloadTemplateFile(template);
    const arrayBuffer = await file.arrayBuffer();
    const zip = new PizZip(arrayBuffer);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: '[[', end: ']]' },
      nullGetter: (part: any) => {
        const key = typeof part?.value === 'string' ? part.value.trim() : '';
        if (/^ASSINATURA(_\d+)?$/i.test(key)) return `[[${key}]]`;
        return '';
      },
    });

    doc.render(placeholders);

    const renderedZip = doc.getZip();
    const xmlFiles = renderedZip.file(/^word\/(document|header\d+|footer\d+)\.xml$/) as any;

    const filesToCheck = Array.isArray(xmlFiles) ? xmlFiles : [];
    for (const f of filesToCheck) {
      const name = (f as any)?.name as string | undefined;
      if (!name) continue;
      const existing = renderedZip.file(name);
      const xml = existing?.asText?.();
      if (!xml) continue;

      const cleaned = xml
        .replace(/,\s*,\s*Bairro/g, ', Bairro')
        .replace(/,\s*,/g, ',')
        .replace(/\s{2,}/g, ' ');

      if (cleaned !== xml) {
        renderedZip.file(name, cleaned);
      }
    }

    return renderedZip.generate({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  };

  const handleGenerateMsPdf = async () => {
    if (!selectedRequirementForView) return;
    if (!selectedRequirementForView.client_id) {
      toast.error('Vincule um cliente ao requerimento antes de gerar o MS.');
      return;
    }

    if (!msTemplate) {
      await loadMsTemplates();
      setMsTemplateModalOpen(true);
      toast.info('Selecione um template', 'Escolha ou envie um modelo Word (DOCX) para gerar o MS.');
      return;
    }

    try {
      setGeneratingMsPdf(true);
      const client = selectedClientForRequirement ?? (await clientService.getClientById(selectedRequirementForView.client_id));
      if (!client) {
        toast.error('Cliente não encontrado para este requerimento.');
        return;
      }

      const placeholders = buildMsPlaceholders(selectedRequirementForView, client);
      const docxBlob = await generateMsDocxFromTemplate(msTemplate, placeholders);

      const safeProtocol = (selectedRequirementForView.protocol || 'sem-protocolo').replace(/[^a-zA-Z0-9._-]/g, '_');
      const safeName = removeDiacritics(client.full_name || 'cliente').replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '');
      const fileName = `MS-${safeProtocol}-${safeName}.docx`;

      const uploaded = await documentTemplateService.uploadGeneratedDocument(docxBlob, fileName);
      await requirementDocumentService.create({
        requirement_id: selectedRequirementForView.id,
        document_type: 'mandado_seguranca',
        file_name: fileName,
        file_path: uploaded.filePath,
        mime_type: uploaded.mimeType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      const docs = await requirementDocumentService.listByRequirementId(selectedRequirementForView.id);
      setRequirementDocuments(docs);
      toast.success('MS gerado', 'Word (DOCX) do Mandado de Segurança gerado e anexado ao requerimento.');
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Erro ao gerar MS em Word.');
    } finally {
      setGeneratingMsPdf(false);
    }
  };

  const handleDownloadRequirementDocument = async (doc: RequirementDocument) => {
    try {
      const blob = await requirementDocumentService.download(doc);
      const fallbackName = (doc.mime_type || '').includes('pdf') ? 'documento.pdf' : 'documento.docx';
      saveAs(blob, doc.file_name || fallbackName);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Erro ao baixar o documento.');
    }
  };

  const handleDeleteRequirementDocument = async (doc: RequirementDocument) => {
    const confirmed = await confirmDelete({
      title: 'Excluir documento',
      message: 'Tem certeza que deseja excluir este documento do requerimento? Esta ação não pode ser desfeita.',
    });
    if (!confirmed) return;

    try {
      await requirementDocumentService.deleteWithFile(doc);
      setRequirementDocuments((prev) => prev.filter((d) => d.id !== doc.id));
      toast.success('Documento excluído');
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Erro ao excluir documento.');
    }
  };

  const handleGenerateMsPdfFromHeader = () => {
    if (viewMode !== 'details' || !selectedRequirementForView) {
      toast.error('Abra um requerimento em “Detalhes” para gerar o MS em Word.');
      return;
    }
    void handleGenerateMsPdf();
  };

  const filteredRequirements = useMemo(() => {
    let filtered = requirements;

    if (activeStatusTab !== 'todos') {
      filtered = filtered.filter((req) => req.status === activeStatusTab);
    }

    if (filterProtocol.trim()) {
      const term = filterProtocol.trim().toLowerCase();
      filtered = filtered.filter((req) => (req.protocol ?? '').toLowerCase().includes(term));
    }

    if (filterBeneficiary.trim()) {
      const term = filterBeneficiary.trim().toLowerCase();
      filtered = filtered.filter((req) => req.beneficiary.toLowerCase().includes(term));
    }

    if (filterCPF.trim()) {
      const term = filterCPF.replace(/\D/g, '');
      filtered = filtered.filter((req) => req.cpf.replace(/\D/g, '').includes(term));
    }

    if (filterBenefitType) {
      filtered = filtered.filter((req) => req.benefit_type === filterBenefitType);
    }

    if (filterOnlyMsRisk) {
      filtered = filtered.filter((req) => isMandadoRisk(req));
    }

    const getSecondarySort = (req: Requirement) => {
      if (req.status === 'em_exigencia') {
        const t = req.exigency_due_date ? new Date(req.exigency_due_date).getTime() : Number.POSITIVE_INFINITY;
        return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
      }

      if (req.status === 'aguardando_pericia') {
        const nextAt = getPericiaNextAt(req);
        const t = nextAt ? new Date(nextAt).getTime() : Number.POSITIVE_INFINITY;
        return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
      }

      if (req.status === 'em_analise') {
        const days = getAnalysisDays(req);
        if (typeof days === 'number') return -days;
      }

      const created = new Date(req.created_at).getTime();
      return Number.isNaN(created) ? 0 : -created;
    };

    return filtered
      .slice()
      .sort((a, b) => {
        const priorityA = STATUS_PRIORITY[a.status] ?? 99;
        const priorityB = STATUS_PRIORITY[b.status] ?? 99;
        if (priorityA !== priorityB) return priorityA - priorityB;

        const secondaryA = getSecondarySort(a);
        const secondaryB = getSecondarySort(b);
        if (secondaryA !== secondaryB) return secondaryA - secondaryB;

        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [requirements, activeStatusTab, filterProtocol, filterBeneficiary, filterCPF, filterBenefitType, filterOnlyMsRisk]);

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(filteredRequirements.length / pageSize));

  const paginatedRequirements = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRequirements.slice(start, start + pageSize);
  }, [filteredRequirements, currentPage]);

  const statusCounts = useMemo(() => {
    const counts: Record<RequirementStatus | 'todos', number> = {
      todos: requirements.length,
      aguardando_confeccao: 0,
      em_analise: 0,
      em_exigencia: 0,
      aguardando_pericia: 0,
      deferido: 0,
      indeferido: 0,
      ajuizado: 0,
    };

    requirements.forEach((req) => {
      counts[req.status]++;
    });

    return counts;
  }, [requirements]);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await requirementService.listRequirements();
        setRequirements(data);
        await autoUpdatePericiaStatuses(data);
      } catch (err: any) {
        setError(err.message || 'Não foi possível carregar os requerimentos.');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  useEffect(() => {
    const check = () => {
      try {
        autoUpdatePericiaStatuses(requirements);
      } catch {
        // ignore
      }
    };

    const intervalId = window.setInterval(check, 60_000);
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
    };
  }, [requirements]);

  useEffect(() => {
    if (forceCreate && !isModalOpen) {
      setSelectedRequirement(null);
      
      // Aplicar prefill se fornecido
      if (prefillData) {
        console.log('=== REQUIREMENTS MODULE ===');
        console.log('Aplicando prefill:', prefillData);
        
        const formattedCpf = prefillData.cpf ? formatCPF(prefillData.cpf) : '';
        
        const newFormData = {
          ...emptyForm,
          client_id: prefillData.client_id || emptyForm.client_id,
          beneficiary: prefillData.beneficiary || emptyForm.beneficiary,
          cpf: formattedCpf || emptyForm.cpf,
        };
        
        console.log('FormData que será aplicado:', newFormData);
        
        setFormData(newFormData);
        
        if (prefillData.beneficiary) {
          setBeneficiarySearchTerm(prefillData.beneficiary);
        }
      } else {
        console.log('=== REQUIREMENTS MODULE ===');
        console.log('Nenhum prefillData fornecido');
        setFormData(emptyForm);
        setBeneficiarySearchTerm('');
      }
      
      setIsModalOpen(true);
      
      if (onParamConsumed) {
        onParamConsumed();
      }
    }
  }, [forceCreate, isModalOpen, onParamConsumed, prefillData]);

  useEffect(() => {
    if (entityId && requirements.length > 0) {
      const requirement = requirements.find(r => r.id === entityId);
      if (requirement) {
        setSelectedRequirementForView(requirement);
        setViewMode('details');
        if (onParamConsumed) {
          onParamConsumed();
        }
      }
    }
  }, [entityId, requirements, onParamConsumed]);

  useEffect(() => {
    let active = true;
    setClientsLoading(true);

    const handler = setTimeout(async () => {
      try {
        const term = beneficiarySearchTerm.trim();
        const data = await clientService.listClients(term ? { search: term } : undefined);
        if (!active) return;
        setClients(data);
      } catch (err) {
        if (active) {
          console.error(err);
        }
      } finally {
        if (active) {
          setClientsLoading(false);
        }
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(handler);
    };
  }, [beneficiarySearchTerm]);

  useEffect(() => {
    const sanitized = formData.cpf.replace(/\D/g, '');
    if (sanitized.length !== 11) return;

    let active = true;

    (async () => {
      try {
        const data = await clientService.listClients({ search: sanitized });
        if (!active) return;
        const match = data.find((client) => (client.cpf_cnpj || '').replace(/\D/g, '') === sanitized);
        if (!match) return;

        // Vincular o cliente encontrado
        if (match.id && formData.client_id !== match.id) {
          handleFormChange('client_id', match.id);
        }
        
        const formattedCpf = match.cpf_cnpj ? formatCPF(match.cpf_cnpj) : formData.cpf;
        if (match.full_name && formData.beneficiary !== match.full_name) {
          handleFormChange('beneficiary', match.full_name);
          setBeneficiarySearchTerm(match.full_name);
        }
        if (match.cpf_cnpj && formData.cpf !== formattedCpf) {
          handleFormChange('cpf', formattedCpf);
        }
        const phoneValue = match.mobile || match.phone || '';
        if (phoneValue) {
          handleFormChange('phone', phoneValue);
        }
      } catch (err) {
        console.error(err);
      }
    })();

    return () => {
      active = false;
    };
  }, [formData.cpf]);

  useEffect(() => {
    let active = true;
    const loadMembers = async () => {
      try {
        const data = await profileService.listMembers();
        if (!active) return;
        setMembers(data);
      } catch (err) {
        console.error(err);
      }
    };

    loadMembers();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setCurrentProfile(null);
      return;
    }

    const member = members.find((item) => item.user_id === user.id);
    if (member) {
      setCurrentProfile(member);
      return;
    }

    let isMounted = true;
    (async () => {
      try {
        const profile = await profileService.getProfile(user.id);
        if (isMounted) {
          setCurrentProfile(profile);
        }
      } catch (err) {
        console.error(err);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [user, members]);

  const handleReload = async () => {
    try {
      setLoading(true);
      const data = await requirementService.listRequirements();
      setRequirements(data);
      if (selectedRequirementForView) {
        const updated = data.find((item) => item.id === selectedRequirementForView.id);
        if (updated) {
          setSelectedRequirementForView(updated);
        }
      }
      await autoUpdatePericiaStatuses(data);
    } catch (err: any) {
      setError(err.message || 'Não foi possível atualizar a lista de requerimentos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [activeStatusTab, filterProtocol, filterBeneficiary, filterCPF, filterBenefitType, filterOnlyMsRisk]);

  useEffect(() => {
    if (!selectedRequirementForView?.id) {
      setStatusHistory([]);
      return;
    }
    let active = true;
    (async () => {
      try {
        setStatusHistoryLoading(true);
        const history = await requirementService.listStatusHistory(selectedRequirementForView.id);
        if (!active) return;
        setStatusHistory(history);
      } catch (err) {
        if (!active) return;
        setStatusHistory([]);
      } finally {
        if (!active) return;
        setStatusHistoryLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [selectedRequirementForView?.id]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const handleOpenModal = (requirement?: Requirement) => {
    if (requirement) {
      setSelectedRequirement(requirement);
      setFormData({
        protocol: requirement.protocol ?? '',
        beneficiary: requirement.beneficiary,
        cpf: requirement.cpf,
        benefit_type: requirement.benefit_type,
        status: requirement.status,
        entry_date: toDateInputValue(requirement.entry_date),
        exigency_due_date: toDateInputValue(requirement.exigency_due_date),
        phone: requirement.phone || '',
        inss_password: requirement.inss_password || '',
        observations: requirement.observations || '',
        notes: '',
        client_id: requirement.client_id || '',
      });
      setBeneficiarySearchTerm(requirement.beneficiary);
    } else {
      setSelectedRequirement(null);
      setFormData(emptyForm);
      setBeneficiarySearchTerm('');
    }

    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    if (saving) return;
    setIsModalOpen(false);
    setSelectedRequirement(null);
    setFormData(emptyForm);
    setBeneficiarySearchTerm('');
    setShowBeneficiarySuggestions(false);
  };

  useEffect(() => {
    if (formData.status !== 'em_exigencia') {
      setFormData((prev) => {
        if (!prev.exigency_due_date) return prev;
        return { ...prev, exigency_due_date: '' };
      });
    }
  }, [formData.status]);

  const handleFormChange = (field: keyof typeof formData, value: string) => {
    if (field === 'cpf') {
      setFormData((prev) => ({ ...prev, [field]: formatCPF(value) }));
    } else if (field === 'phone') {
      setFormData((prev) => ({ ...prev, [field]: formatPhone(value) }));
    } else if (field === 'status') {
      const statusValue = value as RequirementStatus;
      setFormData((prev) => ({ ...prev, status: statusValue }));

      if (selectedRequirement) {
        if (statusValue === 'em_exigencia') {
          const requirement = requirements.find((req) => req.id === selectedRequirement.id) || selectedRequirement;
          openExigencyModal(requirement);
        }
        if (statusValue === 'aguardando_pericia') {
          const requirement = requirements.find((req) => req.id === selectedRequirement.id) || selectedRequirement;
          openPericiaModal(requirement);
        }
      }
    } else {
      setFormData((prev) => ({ ...prev, [field]: value }));
    }
  };

  const resolveAuthorInfo = async () => {
    const metadataName =
      (user?.user_metadata?.name as string | undefined) ||
      (user?.user_metadata?.full_name as string | undefined);
    const fallbackName = metadataName || user?.email || (user ? 'Usuário' : 'Equipe do escritório');

    if (currentProfile) {
      return {
        name: currentProfile.name || fallbackName,
        id: currentProfile.id || currentProfile.user_id || user?.id || null,
        avatar: currentProfile.avatar_url || undefined,
      };
    }

    if (user) {
      try {
        const profile = await profileService.getProfile(user.id);
        if (profile) {
          setCurrentProfile(profile);
          return {
            name: profile.name || fallbackName,
            id: profile.id || profile.user_id || user.id || null,
            avatar: profile.avatar_url || undefined,
          };
        }
      } catch (err) {
        console.error(err);
      }
    }

    return {
      name: fallbackName,
      id: user?.id || null,
      avatar: undefined,
    };
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const trimmedProtocol = formData.protocol.trim();
    const requiresProtocol = formData.status !== 'aguardando_confeccao';

    if (requiresProtocol && !trimmedProtocol) {
      setError('Informe o protocolo do INSS.');
      toast.error('Informe o protocolo do INSS.');
      return;
    }

    if (!formData.beneficiary.trim()) {
      setError('Informe o nome do beneficiário.');
      toast.error('Informe o nome do beneficiário.');
      return;
    }

    if (!formData.cpf.trim()) {
      setError('Informe o CPF do beneficiário.');
      toast.error('Informe o CPF do beneficiário.');
      return;
    }

    if (!formData.benefit_type) {
      setError('Selecione o tipo de benefício.');
      toast.error('Selecione o tipo de benefício.');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const payloadBase = {
        protocol: trimmedProtocol || null,
        beneficiary: formData.beneficiary.trim(),
        cpf: formData.cpf.trim(),
        benefit_type: formData.benefit_type as BenefitType,
        status: formData.status,
        entry_date: formData.entry_date ? new Date(formData.entry_date).toISOString() : null,
        exigency_due_date:
          formData.status === 'em_exigencia' && formData.exigency_due_date
            ? new Date(formData.exigency_due_date).toISOString()
            : null,
        phone: formData.phone?.trim() || null,
        inss_password: formData.inss_password?.trim() || null,
        observations: formData.observations?.trim() || null,
        client_id: formData.client_id?.trim() || null,
      };

      const trimmedNote = formData.notes.trim();

      const editingRequirement = selectedRequirement;
      let updatedRequirement: Requirement | null = null;

      if (editingRequirement) {
        const updatePayload: Record<string, any> = { ...payloadBase };

        if (trimmedNote) {
          const authorInfo = await resolveAuthorInfo();
          const existingNotes = parseNotes(editingRequirement.notes);
          const newNote: RequirementNote = {
            id: generateId(),
            text: trimmedNote,
            created_at: new Date().toISOString(),
            author: authorInfo.name,
            author_name: authorInfo.name,
            author_id: authorInfo.id,
            author_avatar: authorInfo.avatar,
          };
          updatePayload.notes = serializeNotes([...existingNotes, newNote]);
        }

        await requirementService.updateRequirement(editingRequirement.id, updatePayload);
        updatedRequirement = await requirementService.getRequirementById(editingRequirement.id);
        if (updatedRequirement) {
          setRequirements((prev) => prev.map((item) => (item.id === updatedRequirement!.id ? updatedRequirement! : item)));
          setSelectedRequirement(updatedRequirement);
          if (selectedRequirementForView?.id === updatedRequirement.id) {
            setSelectedRequirementForView(updatedRequirement);
          }
        } else {
          await handleReload();
        }
      } else {
        const createPayload: Record<string, any> = { ...payloadBase };

        if (trimmedNote) {
          const authorInfo = await resolveAuthorInfo();
          const newNote: RequirementNote = {
            id: generateId(),
            text: trimmedNote,
            created_at: new Date().toISOString(),
            author: authorInfo.name,
            author_name: authorInfo.name,
            author_id: authorInfo.id,
            author_avatar: authorInfo.avatar,
          };
          createPayload.notes = serializeNotes([newNote]);
        }

        await requirementService.createRequirement(createPayload as any);
        await handleReload();
      }
      setIsModalOpen(false);
      if (!updatedRequirement) {
        setSelectedRequirement(null);
      }
      setFormData(emptyForm);
    } catch (err: any) {
      setError(err.message || 'Não foi possível salvar o requerimento.');
      toast.error(err.message || 'Não foi possível salvar o requerimento.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRequirement = async (id: string) => {
    const req = requirements.find((r) => r.id === id);
    const confirmed = await confirmDelete({
      title: 'Excluir requerimento',
      entityName: req?.protocol || req?.beneficiary || undefined,
      message: 'Deseja realmente remover este requerimento? Essa ação é irreversível.',
      confirmLabel: 'Excluir',
    });
    if (!confirmed) return;

    try {
      await requirementService.deleteRequirement(id);
      await handleReload();
      setRequirements((prev) => prev.filter((item) => item.id !== id));
    } catch (err: any) {
      setError(err.message || 'Não foi possível remover o requerimento.');
      toast.error(err.message || 'Não foi possível remover o requerimento.');
    }
  };

  const handleViewRequirement = (requirement: Requirement) => {
    setSelectedRequirementForView(requirement);
    setViewMode('details');
    setNoteDraft('');
    setNoteError(null);
  };

  const handleQuickBackToAnalysis = async () => {
    if (!selectedRequirementForView?.id) return;
    try {
      await requirementService.updateStatus(selectedRequirementForView.id, 'em_analise');
      await handleReload();
      toast.success('Status atualizado para Em análise.');
    } catch (err: any) {
      toast.error(err?.message || 'Não foi possível atualizar o status.');
    }
  };

  const handleBackToList = () => {
    setSelectedRequirementForView(null);
    setViewMode('list');
    setNoteDraft('');
    setNoteError(null);
  };

  const getStatusConfig = (status: RequirementStatus) => STATUS_OPTIONS.find((s) => s.key === status);

  const getStatusBadge = (status: RequirementStatus) => {
    const statusConfig = getStatusConfig(status);
    return statusConfig
      ? `${statusConfig.badge} ${statusConfig.animation ?? ''}`
      : 'bg-slate-100 text-slate-600';
  };

  const getStatusLabel = (status: RequirementStatus) => {
    const statusConfig = getStatusConfig(status);
    return statusConfig ? statusConfig.label : status;
  };

  const getBenefitTypeLabel = (type: BenefitType) => {
    const typeConfig = BENEFIT_TYPES.find((item) => item.key === type);
    return typeConfig ? typeConfig.label : type;
  };

  const getNoteAuthorDisplay = (note: RequirementNote) => {
    if (note.author_name) return note.author_name;
    if (note.author) return note.author;
    if (note.author_id && memberMap.has(note.author_id)) {
      return memberMap.get(note.author_id)!.name || 'Equipe do escritório';
    }
    if (note.author_id && note.author_id === user?.id && currentProfile?.name) {
      return currentProfile.name;
    }
    if (note.author_id && note.author_id === user?.id) {
      return 'Usuário';
    }
    return 'Equipe do escritório';
  };

  const handleAddNote = async () => {
    if (!selectedRequirementForView) return;
    const trimmed = noteDraft.trim();
    if (!trimmed) {
      setNoteError('Escreva uma nota antes de salvar.');
      return;
    }

    try {
      setAddingNote(true);
      setNoteError(null);

      const authorInfo = await resolveAuthorInfo();
      const existingNotes = parseNotes(selectedRequirementForView.notes);
      const newNote: RequirementNote = {
        id: generateId(),
        text: trimmed,
        created_at: new Date().toISOString(),
        author: authorInfo.name,
        author_name: authorInfo.name,
        author_id: authorInfo.id,
        author_avatar: authorInfo.avatar,
      };

      const updatedNotes = [...existingNotes, newNote];
      const serialized = serializeNotes(updatedNotes);
      await requirementService.updateRequirement(selectedRequirementForView.id, { notes: serialized });

      const refreshed = await requirementService.getRequirementById(selectedRequirementForView.id);
      if (refreshed) {
        setSelectedRequirementForView(refreshed);
        setRequirements((prev) => prev.map((item) => (item.id === refreshed.id ? refreshed : item)));
      }

      setNoteDraft('');
    } catch (err: any) {
      setNoteError(err.message || 'Não foi possível adicionar a nota.');
    } finally {
      setAddingNote(false);
    }
  };

  const handleAddReply = async () => {
    if (!selectedRequirementForView || !replyingTo) return;
    const trimmed = replyDraft.trim();
    if (!trimmed) {
      setReplyError('Escreva uma resposta antes de enviar.');
      return;
    }

    try {
      setAddingReply(true);
      setReplyError(null);

      const authorInfo = await resolveAuthorInfo();
      const existingNotes = parseNotes(selectedRequirementForView.notes);
      const newReply: RequirementNote = {
        id: generateId(),
        text: trimmed,
        created_at: new Date().toISOString(),
        author: authorInfo.name,
        author_name: authorInfo.name,
        author_id: authorInfo.id,
        author_avatar: authorInfo.avatar,
        parent_id: replyingTo,
      };

      const updatedNotes = [...existingNotes, newReply];
      const serialized = serializeNotes(updatedNotes);
      await requirementService.updateRequirement(selectedRequirementForView.id, { notes: serialized });

      const refreshed = await requirementService.getRequirementById(selectedRequirementForView.id);
      if (refreshed) {
        setSelectedRequirementForView(refreshed);
        setRequirements((prev) => prev.map((item) => (item.id === refreshed.id ? refreshed : item)));
      }

      setReplyDraft('');
      setReplyingTo(null);
    } catch (err: any) {
      setReplyError(err.message || 'Não foi possível adicionar a resposta.');
    } finally {
      setAddingReply(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!selectedRequirementForView) return;
    const confirmed = await confirmDelete({
      title: 'Excluir nota',
      message: 'Tem certeza que deseja excluir esta nota? Esta ação não pode ser desfeita.',
      confirmLabel: 'Excluir',
    });
    if (!confirmed) return;

    try {
      const existingNotes = parseNotes(selectedRequirementForView.notes);
      const updatedNotes = existingNotes.filter((note) => note.id !== noteId);
      const serialized = serializeNotes(updatedNotes);
      await requirementService.updateRequirement(selectedRequirementForView.id, { notes: serialized });

      const refreshed = await requirementService.getRequirementById(selectedRequirementForView.id);
      if (refreshed) {
        setSelectedRequirementForView(refreshed);
        setRequirements((prev) => prev.map((item) => (item.id === refreshed.id ? refreshed : item)));
      }
    } catch (err: any) {
      console.error('Erro ao excluir nota:', err);
      toast.error('Não foi possível excluir a nota.');
    }
  };

  const handleStatusChange = async (requirementId: string, newStatus: RequirementStatus) => {
    try {
      setStatusUpdatingId(requirementId);
      const requirement = requirements.find((req) => req.id === requirementId) || null;
      await requirementService.updateStatus(requirementId, newStatus);
      setRequirements((prev) =>
        prev.map((req) => (req.id === requirementId ? { ...req, status: newStatus } : req)),
      );
      await handleReload();

      if (newStatus === 'em_exigencia') {
        openExigencyModal(requirement);
      }

      if (newStatus === 'aguardando_pericia') {
        openPericiaModal(requirement);
        setSchedulePromptId(requirementId);
      }
    } catch (err: any) {
      setError(err.message || 'Não foi possível atualizar o status.');
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const clearSchedulePrompt = () => setSchedulePromptId(null);

  const handleCloseExigencyModal = () => {
    if (exigencySubmittingRef.current) return;
    setExigencyModal(null);
    setExigencyForm({
      title: '',
      due_date: '',
      priority: 'alta',
      notify_days_before: '3',
    });
  };

  const handleClosePericiaModal = () => {
    if (periciaSaving) return;
    setPericiaModal(null);
  };

  const handlePericiaFormChange = (field: keyof PericiaScheduleFormState, value: string | boolean) => {
    setPericiaForm((prev) => ({ ...prev, [field]: value } as PericiaScheduleFormState));
  };

  const handleSavePericiaSchedule = async () => {
    if (!periciaModal) return;
    const requirement = requirements.find((req) => req.id === periciaModal.requirementId) || null;
    if (!requirement) {
      toast.error('Requerimento não encontrado.');
      return;
    }

    if (!periciaForm.includeMedica && !periciaForm.includeSocial) {
      toast.error('Selecione pelo menos uma perícia (médica ou social).');
      return;
    }

    const medicaAt = periciaForm.includeMedica
      ? toUtcIsoFromLocalDateTime(periciaForm.medicaDate, periciaForm.medicaTime)
      : null;
    const socialAt = periciaForm.includeSocial
      ? toUtcIsoFromLocalDateTime(periciaForm.socialDate, periciaForm.socialTime)
      : null;

    if (periciaForm.includeMedica && (!periciaForm.medicaDate || !periciaForm.medicaTime || !medicaAt)) {
      toast.error('Informe data e hora da perícia médica.');
      return;
    }

    if (periciaForm.includeSocial && (!periciaForm.socialDate || !periciaForm.socialTime || !socialAt)) {
      toast.error('Informe data e hora da perícia social.');
      return;
    }

    try {
      setPericiaSaving(true);

      await requirementService.updateRequirement(requirement.id, {
        pericia_medica_at: medicaAt,
        pericia_social_at: socialAt,
      } as any);

      const periciaEvents: Array<ReturnType<typeof calendarService.createEvent> | Promise<any>> = [];

      const toEndAt = (startAtLocal: string) => {
        const dt = new Date(startAtLocal);
        if (Number.isNaN(dt.getTime())) return null;
        dt.setMinutes(dt.getMinutes() + 60);
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}:00`;
      };

      const toStartAtLocal = (dateOnly: string, timeOnly: string) => `${dateOnly}T${timeOnly}:00`;

      if (medicaAt) {
        const startAtLocal = toStartAtLocal(periciaForm.medicaDate, periciaForm.medicaTime);
        const payloadEvent: CreateCalendarEventDTO = {
          title: `Perícia médica - ${requirement.beneficiary}`,
          description: `Perícia médica do requerimento ${requirement.protocol ?? 'sem protocolo'}.`,
          event_type: 'pericia',
          status: 'pendente',
          start_at: startAtLocal,
          end_at: toEndAt(startAtLocal),
          requirement_id: requirement.id,
          client_id: requirement.client_id ?? null,
          process_id: null,
        };

        periciaEvents.push(calendarService.createEvent(payloadEvent));
      }

      if (socialAt) {
        const startAtLocal = toStartAtLocal(periciaForm.socialDate, periciaForm.socialTime);
        const payloadEvent: CreateCalendarEventDTO = {
          title: `Perícia social - ${requirement.beneficiary}`,
          description: `Perícia social do requerimento ${requirement.protocol ?? 'sem protocolo'}.`,
          event_type: 'pericia',
          status: 'pendente',
          start_at: startAtLocal,
          end_at: toEndAt(startAtLocal),
          requirement_id: requirement.id,
          client_id: requirement.client_id ?? null,
          process_id: null,
        };

        periciaEvents.push(calendarService.createEvent(payloadEvent));
      }

      await Promise.all(periciaEvents);

      await handleReload();
      setSchedulePromptId(null);
      toast.success('Perícia agendada na Agenda.');
      setPericiaModal(null);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Não foi possível salvar o agendamento da perícia.');
    } finally {
      setPericiaSaving(false);
    }
  };

  const handleExigencyFormChange = (field: keyof typeof exigencyForm, value: string) => {
    setExigencyForm((prev) => ({ ...prev, [field]: value }));
  };

  const toUtcMidnightIso = (dateOnly: string) => {
    const date = new Date(`${dateOnly}T00:00:00`);
    const utcTime = date.getTime() - date.getTimezoneOffset() * 60000;
    return new Date(utcTime).toISOString();
  };

  const handleCreateExigencyDeadline = async () => {
    if (!exigencyModal) return;
    const title = exigencyForm.title.trim();
    if (!title) {
      alert('Informe o título do prazo.');
      return;
    }
    if (!exigencyForm.due_date) {
      alert('Informe a data de vencimento.');
      return;
    }

    try {
      exigencySubmittingRef.current = true;
      const requirement = requirements.find((req) => req.id === exigencyModal.requirementId) || null;
      if (!requirement) {
        alert('Requerimento não encontrado.');
        return;
      }

      const dueDateIso = toUtcMidnightIso(exigencyForm.due_date);

      const payload = {
        title,
        description: `Atender exigência do requerimento ${requirement.protocol ?? 'sem protocolo'}.`,
        due_date: dueDateIso,
        status: 'pendente' as const,
        priority: exigencyForm.priority as DeadlinePriority,
        type: 'requerimento' as const,
        requirement_id: requirement.id,
        client_id: requirement.client_id ?? null,
        process_id: null,
        responsible_id: null,
        notify_days_before: parseInt(exigencyForm.notify_days_before || '3', 10) || 3,
      };

      await deadlineService.createDeadline(payload);

      await requirementService.updateRequirement(requirement.id, {
        exigency_due_date: dueDateIso,
      });

      setRequirements((prev) =>
        prev.map((req) =>
          req.id === requirement.id
            ? {
                ...req,
                exigency_due_date: dueDateIso,
              }
            : req,
        ),
      );

      setSelectedRequirement((prev) =>
        prev && prev.id === requirement.id ? { ...prev, exigency_due_date: dueDateIso } : prev,
      );

      setSelectedRequirementForView((prev) =>
        prev && prev.id === requirement.id ? { ...prev, exigency_due_date: dueDateIso } : prev,
      );

      await handleReload();
      alert('Prazo criado e enviado para o módulo de prazos.');
      handleCloseExigencyModal();
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Não foi possível criar o prazo de exigência.');
    } finally {
      exigencySubmittingRef.current = false;
    }
  };

  const handleWhatsApp = (phone?: string | null) => {
    if (!phone) {
      alert('Telefone não informado para este requerimento.');
      return;
    }
    const cleaned = phone.replace(/\D/g, '');
    window.open(`https://wa.me/55${cleaned}`, '_blank');
  };

  const handleExportExcel = async () => {
    if (!requirements.length) {
      alert('Não há requerimentos disponíveis para exportar.');
      return;
    }

    try {
      setExportingExcel(true);

      const excelData = requirements.map((req) => ({
        'Protocolo': req.protocol,
        'Beneficiário': req.beneficiary,
        'CPF': req.cpf,
        'Tipo de Benefício': getBenefitTypeLabel(req.benefit_type),
        'Status': getStatusLabel(req.status),
        'Data de Entrada': formatDate(req.entry_date),
        'Telefone': req.phone || '',
        'Senha INSS': req.inss_password || '',
        'Observações': req.observations || '',
        'Criado em': req.created_at ? new Date(req.created_at).toLocaleDateString('pt-BR') : '',
        'Atualizado em': req.updated_at ? new Date(req.updated_at).toLocaleDateString('pt-BR') : '',
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(excelData);

      const colWidths = [
        { wch: 20 }, // Protocolo
        { wch: 30 }, // Beneficiário
        { wch: 15 }, // CPF
        { wch: 35 }, // Tipo de Benefício
        { wch: 20 }, // Status
        { wch: 15 }, // Data de Entrada
        { wch: 18 }, // Telefone
        { wch: 15 }, // Senha INSS
        { wch: 40 }, // Observações
        { wch: 12 }, // Criado em
        { wch: 12 }, // Atualizado em
      ];
      ws['!cols'] = colWidths;

      XLSX.utils.book_append_sheet(wb, ws, 'Requerimentos');

      const now = new Date();
      const dateSlug = now.toISOString().split('T')[0];
      const filename = `requerimentos_${dateSlug}.xlsx`;

      XLSX.writeFile(wb, filename);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Não foi possível exportar os dados para Excel.');
    } finally {
      setExportingExcel(false);
    }
  };

  const renderNote = (note: RequirementNote, depth: number = 0) => {
    const isReplying = replyingTo === note.id;
    const canDelete = note.author_id === user?.id || user?.user_metadata?.role === 'admin';

    return (
      <div key={note.id} className={`${depth > 0 ? 'ml-8 border-l-2 border-slate-200 pl-4' : ''}`}>
        <div className="bg-slate-50 border border-slate-100 rounded-lg p-4 text-sm text-slate-700">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span>{getNoteAuthorDisplay(note)}</span>
            <div className="flex items-center gap-2">
              <span>{formatDateTime(note.created_at)}</span>
              {canDelete && (
                <button
                  onClick={() => handleDeleteNote(note.id)}
                  className="text-red-500 hover:text-red-700 transition-colors"
                  title="Excluir nota"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
          <p className="whitespace-pre-wrap">{note.text}</p>
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => setReplyingTo(isReplying ? null : note.id)}
              className="text-blue-600 hover:text-blue-700 text-xs flex items-center gap-1 transition-colors"
            >
              <Reply className="w-3 h-3" />
              Responder
            </button>
          </div>
        </div>

        {isReplying && (
          <div className="mt-3 ml-8">
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              {replyError && <p className="text-sm text-red-600 mb-2">{replyError}</p>}
              <textarea
                value={replyDraft}
                onChange={(e) => setReplyDraft(e.target.value)}
                rows={3}
                className="input-field w-full text-sm"
                placeholder="Digite sua resposta..."
              />
              <div className="flex justify-end gap-2 mt-2">
                <button
                  onClick={() => setReplyingTo(null)}
                  className="px-3 py-1 text-xs text-slate-600 hover:text-slate-800 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleAddReply}
                  disabled={addingReply}
                  className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors flex items-center gap-1 disabled:opacity-60"
                >
                  {addingReply && <Loader2 className="w-3 h-3 animate-spin" />}
                  {addingReply ? 'Enviando...' : 'Responder'}
                </button>
              </div>
            </div>
          </div>
        )}

        {note.replies && note.replies.map((reply) => renderNote(reply, depth + 1))}
      </div>
    );
  };

  const openClientModal = (prefill?: Partial<CreateClientDTO> | null) => {
    setClientFormPrefill(prefill ?? null);
    setIsClientFormModalOpen(true);
    setShowBeneficiarySuggestions(false);
  };

  const createClientModal = isClientFormModalOpen && createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-50/80 backdrop-blur-md"
        onClick={() => {
          setIsClientFormModalOpen(false);
          setClientFormPrefill(null);
        }}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-4xl">
        <div className="bg-white rounded-2xl shadow-[0_24px_60px_rgba(15,23,42,0.12)] border border-slate-200 overflow-hidden">
          <div className="h-3 w-full shrink-0 bg-gradient-to-r from-orange-500 to-orange-600" />
          <div className="px-6 py-5 border-b border-slate-200 bg-white flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Formulário</div>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">Novo Cliente</h2>
            </div>
            <button
              type="button"
              onClick={() => {
                setIsClientFormModalOpen(false);
                setClientFormPrefill(null);
              }}
              className="p-2 text-slate-400 hover:text-slate-600 rounded-lg"
              aria-label="Fechar modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="bg-white">
            <ClientForm
              client={null}
              prefill={clientFormPrefill}
              variant="modal"
              onBack={() => {
                setIsClientFormModalOpen(false);
                setClientFormPrefill(null);
              }}
              onSave={(savedClient) => {
                handleFormChange('client_id', savedClient.id);
                handleFormChange('beneficiary', savedClient.full_name);
                setBeneficiarySearchTerm(savedClient.full_name);
                if (savedClient.cpf_cnpj) {
                  handleFormChange('cpf', formatCPF(savedClient.cpf_cnpj));
                }
                const phoneValue = savedClient.mobile || savedClient.phone || '';
                if (phoneValue) {
                  handleFormChange('phone', phoneValue);
                }
                setIsClientFormModalOpen(false);
                setClientFormPrefill(null);
              }}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );

  const inputClass = "form-input flex w-full min-w-0 flex-1 resize-none overflow-hidden rounded-lg text-gray-900 focus:outline-0 focus:ring-2 focus:ring-[#2b8cee]/50 border border-gray-300 bg-white h-12 placeholder:text-gray-500 px-4 py-3 text-sm font-normal leading-normal";
  const selectClass = "form-select flex w-full min-w-0 flex-1 resize-none overflow-hidden rounded-lg text-gray-900 focus:outline-0 focus:ring-2 focus:ring-[#2b8cee]/50 border border-gray-300 bg-white h-12 px-4 py-3 text-sm font-normal leading-normal";
  const textareaClass = "form-input flex w-full min-w-0 flex-1 resize-none overflow-hidden rounded-lg text-gray-900 focus:outline-0 focus:ring-2 focus:ring-[#2b8cee]/50 border border-gray-300 bg-white min-h-20 placeholder:text-gray-500 px-4 py-3 text-sm font-normal leading-normal";
  const labelClass = "text-gray-900 text-sm font-medium leading-normal pb-1";

  const requirementModal = isModalOpen && createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
      <div
        className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
        onClick={handleCloseModal}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-4xl max-h-[92vh] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
        <div className="h-2 w-full bg-orange-500" />
        <div className="px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
              Formulário
            </p>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
              {selectedRequirement ? 'Editar Requerimento' : 'Novo Requerimento'}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleCloseModal}
            className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
            aria-label="Fechar modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 bg-white dark:bg-zinc-900">
          <form onSubmit={handleSubmit} className="flex flex-col h-full">
            <div className="p-4 sm:p-6 md:p-8 space-y-4 sm:space-y-5 flex-1 overflow-y-auto">
              {error && (
                <div className="mb-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                  {error}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {/* Protocolo */}
                <label className="flex flex-col w-full">
                  <p className={labelClass}>Protocolo do INSS *</p>
                  <input
                    value={formData.protocol}
                    onChange={(event) => handleFormChange('protocol', event.target.value)}
                    className={inputClass}
                    placeholder="Digite o protocolo do INSS"
                    required
                  />
                </label>

                {/* Beneficiário */}
                <label className="flex flex-col w-full">
                  <p className={labelClass}>Beneficiário *</p>
                  <div className="relative">
                    <input
                      value={beneficiarySearchTerm}
                      onChange={(event) => {
                        const value = event.target.value;
                        setBeneficiarySearchTerm(value);
                        handleFormChange('beneficiary', value);
                        if (!value) {
                          handleFormChange('cpf', '');
                          handleFormChange('phone', '');
                        }
                      }}
                      onFocus={() => setShowBeneficiarySuggestions(true)}
                      onBlur={() => setTimeout(() => setShowBeneficiarySuggestions(false), 150)}
                      className={inputClass}
                      placeholder="Digite o nome do beneficiário"
                      required
                    />
                    {clientsLoading && (
                      <Loader2 className="w-4 h-4 text-blue-600 absolute right-4 top-1/2 -translate-y-1/2 animate-spin" />
                    )}
                    {showBeneficiarySuggestions && (
                      <div className="absolute mt-2 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto z-10">
                        {clientsLoading ? (
                          <div className="px-4 py-3 text-sm text-gray-500">Buscando clientes...</div>
                        ) : clients.length === 0 ? (
                          <div className="px-4 py-3">
                            <div className="text-sm text-gray-500">Nenhum cliente encontrado.</div>
                            <button
                              type="button"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => openClientModal({ full_name: beneficiarySearchTerm })}
                              className="mt-3 w-full text-left px-3 py-2.5 hover:bg-orange-50 transition border border-orange-200 rounded-lg flex items-center gap-2 text-orange-700 font-medium"
                            >
                              <Plus className="w-4 h-4" />
                              <div>
                                <div className="text-sm font-semibold">Adicionar Novo Cliente</div>
                                <div className="text-xs text-gray-500">Criar cadastro para "{beneficiarySearchTerm}"</div>
                              </div>
                            </button>
                          </div>
                        ) : (
                          clients.map((client) => (
                            <button
                              type="button"
                              key={client.id}
                              className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 transition"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => {
                                handleFormChange('beneficiary', client.full_name);
                                handleFormChange('client_id', client.id);
                                setBeneficiarySearchTerm(client.full_name);
                                if (client.cpf_cnpj) {
                                  handleFormChange('cpf', formatCPF(client.cpf_cnpj));
                                }
                                const phoneValue = client.phone || client.mobile || '';
                                if (phoneValue) {
                                  handleFormChange('phone', phoneValue);
                                }
                                setShowBeneficiarySuggestions(false);
                              }}
                            >
                              <div className="font-semibold text-gray-800">{client.full_name}</div>
                              <div className="text-xs text-gray-500">
                                {client.cpf_cnpj ? formatCPF(client.cpf_cnpj) : 'CPF não informado'} • {client.email || 'Sem e-mail'}
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </label>

                {/* CPF */}
                <label className="flex flex-col w-full">
                  <p className={labelClass}>CPF *</p>
                  <input
                    value={formData.cpf}
                    onChange={(event) => handleFormChange('cpf', event.target.value)}
                    className={inputClass}
                    placeholder="000.000.000-00"
                    maxLength={14}
                    required
                  />
                </label>

                {/* Tipo de Benefício */}
                <label className="flex flex-col w-full">
                  <p className={labelClass}>Tipo de Benefício</p>
                  <select
                    value={formData.benefit_type}
                    onChange={(event) => handleFormChange('benefit_type', event.target.value as BenefitType | '')}
                    className={selectClass}
                  >
                    <option value="" disabled>Selecione o tipo de benefício</option>
                    {BENEFIT_TYPES.map((type) => (
                      <option key={type.key} value={type.key}>{type.label}</option>
                    ))}
                  </select>
                </label>

                {/* Status */}
                <label className="flex flex-col w-full">
                  <p className={labelClass}>Status</p>
                  <select
                    value={formData.status}
                    onChange={(event) => handleFormChange('status', event.target.value as RequirementStatus)}
                    className={selectClass}
                  >
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status.key} value={status.key}>{status.label}</option>
                    ))}
                  </select>
                </label>

                {/* Data de Entrada */}
                <label className="flex flex-col w-full">
                  <p className={labelClass}>Data de Entrada</p>
                  <input
                    type="date"
                    value={formData.entry_date}
                    onChange={(event) => handleFormChange('entry_date', event.target.value)}
                    className={inputClass}
                  />
                </label>

                {/* Prazo da Exigência (condicional) */}
                {formData.status === 'em_exigencia' && (
                  <label className="flex flex-col w-full">
                    <p className={labelClass}>Prazo da Exigência</p>
                    <input
                      type="date"
                      value={formData.exigency_due_date}
                      onChange={(event) => handleFormChange('exigency_due_date', event.target.value)}
                      className={inputClass}
                    />
                  </label>
                )}

                {/* Telefone */}
                <label className="flex flex-col w-full">
                  <p className={labelClass}>Telefone</p>
                  <input
                    value={formData.phone}
                    onChange={(event) => handleFormChange('phone', event.target.value)}
                    className={inputClass}
                    placeholder="(00) 00000-0000"
                    maxLength={15}
                  />
                </label>

                {/* Senha do INSS */}
                <label className="flex flex-col w-full">
                  <p className={labelClass}>Senha do INSS</p>
                  <input
                    type="text"
                    value={formData.inss_password}
                    onChange={(event) => handleFormChange('inss_password', event.target.value)}
                    className={inputClass}
                    placeholder="Digite a senha do INSS"
                  />
                </label>

                {/* Observações */}
                <label className="flex flex-col w-full col-span-1 sm:col-span-2">
                  <p className={labelClass}>Observações</p>
                  <textarea
                    value={formData.observations}
                    onChange={(event) => handleFormChange('observations', event.target.value)}
                    className={textareaClass}
                    placeholder="Digite as observações"
                  />
                </label>

                {/* Notas Internas */}
                <label className="flex flex-col w-full col-span-1 sm:col-span-2">
                  <p className={labelClass}>Notas Internas</p>
                  <textarea
                    value={formData.notes}
                    onChange={(event) => handleFormChange('notes', event.target.value)}
                    className={textareaClass}
                    placeholder="Digite as notas internas"
                  />
                </label>
              </div>
            </div>
          </form>
        </div>

        <div className="border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-5 sm:px-8 py-4">
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={handleCloseModal}
              disabled={saving}
              className="px-4 py-2 text-sm text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              onClick={handleSubmit}
              disabled={saving}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  , document.body);

  const exigencyDeadlineModal = exigencyModal && (
    <div className="pericia-light-modal fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="pericia-light-modal__panel bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="h-2 w-full bg-orange-500" />
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-white">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Registrar prazo para exigência</h3>
            {exigencyModal.beneficiaryName && (
              <p className="text-sm text-slate-600 mt-1">
                Beneficiário: <span className="font-medium">{exigencyModal.beneficiaryName}</span>
              </p>
            )}
            {exigencyModal.benefitTypeLabel && (
              <p className="text-xs text-slate-500">Benefício: {exigencyModal.benefitTypeLabel}</p>
            )}
          </div>
          <button
            onClick={handleCloseExigencyModal}
            className="text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg p-1 transition"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700">Título *</label>
            <input
              value={exigencyForm.title}
              onChange={(event) => handleExigencyFormChange('title', event.target.value)}
              className="input-field"
              placeholder="Ex: Entregar documentos solicitados pelo INSS"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-700">Data de vencimento *</label>
              <input
                type="date"
                value={exigencyForm.due_date}
                onChange={(event) => handleExigencyFormChange('due_date', event.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Prioridade</label>
              <select
                value={exigencyForm.priority}
                onChange={(event) => handleExigencyFormChange('priority', event.target.value)}
                className="input-field"
              >
                {DEADLINE_PRIORITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700">Notificar quantos dias antes?</label>
            <input
              type="number"
              min={0}
              value={exigencyForm.notify_days_before}
              onChange={(event) => handleExigencyFormChange('notify_days_before', event.target.value)}
              className="input-field"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-3">
          <button
            onClick={handleCloseExigencyModal}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleCreateExigencyDeadline}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition disabled:opacity-60"
            disabled={exigencySubmittingRef.current}
          >
            {exigencySubmittingRef.current && <Loader2 className="w-4 h-4 animate-spin" />}
            Registrar prazo
          </button>
        </div>
      </div>
    </div>
  );

  const periciaSchedulingModal = periciaModal && (
    <div className="pericia-light-modal fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[55] p-4">
      <div className="pericia-light-modal__panel bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Agendar perícia</h3>
            {periciaModal.beneficiaryName && (
              <p className="text-sm text-slate-700 mt-1">
                Beneficiário: <span className="font-medium text-slate-900">{periciaModal.beneficiaryName}</span>
              </p>
            )}
            {periciaModal.benefitTypeLabel && (
              <p className="text-xs text-slate-600">Benefício: {periciaModal.benefitTypeLabel}</p>
            )}
          </div>
          <button onClick={handleClosePericiaModal} className="text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg p-1 transition" title="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-800">
              <input
                type="checkbox"
                checked={periciaForm.includeMedica}
                onChange={(e) => handlePericiaFormChange('includeMedica', e.target.checked)}
              />
              Perícia médica
            </label>

            <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-800">
              <input
                type="checkbox"
                checked={periciaForm.includeSocial}
                onChange={(e) => handlePericiaFormChange('includeSocial', e.target.checked)}
              />
              Perícia social
            </label>
          </div>

          {periciaForm.includeMedica && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-slate-700">Data (médica) *</label>
                <input
                  type="date"
                  value={periciaForm.medicaDate}
                  onChange={(e) => handlePericiaFormChange('medicaDate', e.target.value)}
                  className="input-field"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700">Hora (médica) *</label>
                <input
                  type="time"
                  value={periciaForm.medicaTime}
                  onChange={(e) => handlePericiaFormChange('medicaTime', e.target.value)}
                  className="input-field"
                />
              </div>
            </div>
          )}

          {periciaForm.includeSocial && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-slate-700">Data (social) *</label>
                <input
                  type="date"
                  value={periciaForm.socialDate}
                  onChange={(e) => handlePericiaFormChange('socialDate', e.target.value)}
                  className="input-field"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700">Hora (social) *</label>
                <input
                  type="time"
                  value={periciaForm.socialTime}
                  onChange={(e) => handlePericiaFormChange('socialTime', e.target.value)}
                  className="input-field"
                />
              </div>
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-slate-700">Notificar quantos dias antes?</label>
            <input
              type="number"
              min={0}
              value={periciaForm.notifyDaysBefore}
              onChange={(e) => handlePericiaFormChange('notifyDaysBefore', e.target.value)}
              className="input-field"
            />
          </div>

          <p className="text-xs text-slate-600">
            Após passar a data da última perícia (médica/social), o requerimento será movido automaticamente para “Em análise”.
          </p>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-3">
          <button
            onClick={handleClosePericiaModal}
            disabled={periciaSaving}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            onClick={handleSavePericiaSchedule}
            disabled={periciaSaving}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition disabled:opacity-60"
          >
            {periciaSaving && <Loader2 className="w-4 h-4 animate-spin" />}
            Salvar agendamento
          </button>
        </div>
      </div>
    </div>
  );

  const detailsModal = viewMode === 'details' && selectedRequirementForView ? (() => {
    const noteCount = detailNotes.length;
    const detailStatusConfig = getStatusConfig(selectedRequirementForView.status);
    const analysisDays = getAnalysisDays(selectedRequirementForView);
    const showMandadoRisk = isMandadoRisk(selectedRequirementForView);
    const periciaMedicaAt = selectedRequirementForView.pericia_medica_at ?? null;
    const periciaSocialAt = selectedRequirementForView.pericia_social_at ?? null;
    const getHistoryActor = (changedBy: string | null) => {
      if (!changedBy) return 'Sistema';
      if (memberByUserId.has(changedBy)) return memberByUserId.get(changedBy)!.name || 'Usuário';
      if (changedBy === user?.id && currentProfile?.name) return currentProfile.name;
      if (changedBy === user?.id) return 'Usuário';
      return 'Usuário';
    };
    const getHistoryStatus = (status: string | null) => {
      if (!status) return '—';
      return getStatusLabel(status as any);
    };
    return createPortal(
      <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
        <div
          className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
          onClick={handleBackToList}
          aria-hidden="true"
        />
        <div className="relative w-full max-w-4xl max-h-[92vh] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
          <div className="h-2 w-full bg-orange-500" />
          <div className="px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Detalhes</p>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Detalhes do Requerimento</h2>
            </div>
            <button
              type="button"
              onClick={handleBackToList}
              className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
              aria-label="Fechar modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto bg-white dark:bg-zinc-900 p-6">
            {error && (
              <div className="mb-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                {error}
              </div>
            )}

            {showMandadoRisk && (
              <div className="mb-4 rounded-xl border-l-4 border-red-500 bg-gradient-to-r from-red-50 to-orange-50 px-4 py-3 text-sm text-red-800 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-8 h-8 bg-red-100 rounded-full flex items-center justify-center">
                    <AlertTriangle className="w-4 h-4 text-red-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-red-900">Possível mandado de segurança</p>
                    <p className="text-xs mt-1 text-red-700">
                      Requerimento em análise há <span className="font-bold text-red-800">{analysisDays}</span> dias. Avalie medidas cabíveis.
                    </p>
                  </div>
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase">Protocolo</label>
                <p className="text-base text-slate-900 mt-1 font-mono">{selectedRequirementForView.protocol}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase">Beneficiário</label>
                <p className="text-base text-slate-900 mt-1">{selectedRequirementForView.beneficiary}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase">CPF</label>
                <p className="text-base text-slate-900 mt-1">{selectedRequirementForView.cpf}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase">Tipo de Benefício</label>
                <p className="text-base text-slate-900 mt-1">{getBenefitTypeLabel(selectedRequirementForView.benefit_type)}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase">Status</label>
                <p className="mt-1">
                  <span
                    className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${getStatusBadge(selectedRequirementForView.status)}`}
                    style={detailStatusConfig?.animationStyle}
                  >
                    {getStatusLabel(selectedRequirementForView.status)}
                    {detailStatusConfig?.icon === 'spinner' && (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    )}
                  </span>
                </p>
              </div>
              {selectedRequirementForView.status === 'em_exigencia' && (
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase">Prazo da Exigência</label>
                  <p className="text-base text-slate-900 mt-1">
                    {selectedRequirementForView.exigency_due_date
                      ? formatDate(selectedRequirementForView.exigency_due_date)
                      : 'Prazo não definido'}
                  </p>
                </div>
              )}

              {(periciaMedicaAt || periciaSocialAt) && (
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase">Perícias</label>
                  <div className="mt-1 space-y-1 text-sm text-slate-900">
                    {periciaMedicaAt && <p>Perícia médica: {formatDateTime(periciaMedicaAt)}</p>}
                    {periciaSocialAt && <p>Perícia social: {formatDateTime(periciaSocialAt)}</p>}
                  </div>
                </div>
              )}

              {selectedRequirementForView.status === 'em_analise' && typeof analysisDays === 'number' && !showMandadoRisk && (
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase">Tempo em análise</label>
                  <p className="text-base text-slate-900 mt-1">{analysisDays} dias</p>
                </div>
              )}
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase">Data de Entrada</label>
                <p className="text-base text-slate-900 mt-1">{formatDate(selectedRequirementForView.entry_date)}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase">Telefone</label>
                <p className="text-base text-slate-900 mt-1">{selectedRequirementForView.phone || 'Não informado'}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase">Senha do INSS</label>
                <p className="text-base text-slate-900 mt-1">{selectedRequirementForView.inss_password || 'Não informado'}</p>
              </div>
              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-slate-500 uppercase">Observações</label>
                <p className="text-base text-slate-900 mt-1">{selectedRequirementForView.observations || 'Nenhuma observação'}</p>
              </div>
              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-slate-500 uppercase">Histórico de notas</label>
                {noteThreads.length === 0 ? (
                  <p className="text-sm text-slate-500 mt-2">Nenhuma nota registrada no momento.</p>
                ) : (
                  <div className="mt-2 space-y-4">{noteThreads.map((thread) => renderNote(thread))}</div>
                )}
              </div>

              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-slate-500 uppercase">Histórico de status</label>
                {statusHistoryLoading ? (
                  <div className="mt-2 rounded-xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-500 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Carregando histórico...
                  </div>
                ) : statusHistory.length === 0 ? (
                  <p className="text-sm text-slate-500 mt-2">Nenhuma alteração de status registrada ainda.</p>
                ) : (
                  <div className="mt-2 rounded-xl border border-slate-200 bg-white overflow-hidden">
                    <div className="divide-y divide-slate-200">
                      {statusHistory.slice(0, 12).map((entry) => (
                        <div key={entry.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900">
                              {getHistoryStatus(entry.from_status)} → {getHistoryStatus(entry.to_status)}
                            </p>
                            <p className="text-xs text-slate-500 mt-0.5">
                              Por: <span className="font-medium text-slate-700">{getHistoryActor(entry.changed_by)}</span>
                            </p>
                          </div>
                          <div className="text-xs text-slate-500 whitespace-nowrap">{formatDateTime(entry.changed_at)}</div>
                        </div>
                      ))}
                    </div>
                    {statusHistory.length > 12 && (
                      <div className="px-4 py-2 text-xs text-slate-500 bg-slate-50 border-t border-slate-200">
                        Mostrando as últimas 12 alterações (total: {statusHistory.length}).
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-slate-500 uppercase">Processos vinculados</label>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Processo Principal</p>
                        <p className="text-xs text-slate-600 mt-1">
                          {linkedProcesses.principal
                            ? `Vinculado: ${linkedProcesses.principal.process_code || 'sem número'}`
                            : 'Ainda não criado'}
                        </p>
                      </div>
                      {loadingLinkedProcesses && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
                    </div>
                    <div className="mt-3 flex gap-2">
                      {linkedProcesses.principal ? (
                        <button
                          type="button"
                          onClick={() => handleOpenProcessDetails(linkedProcesses.principal!.id)}
                          className="flex-1 px-3 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
                        >
                          Abrir
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleCreateProcessFromRequirement('principal')}
                          className="flex-1 px-3 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition"
                        >
                          Converter
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Mandado de Segurança (MS)</p>
                        <p className="text-xs text-slate-600 mt-1">
                          {linkedProcesses.ms
                            ? `Vinculado: ${linkedProcesses.ms.process_code || 'sem número'}`
                            : 'Ainda não criado'}
                        </p>
                      </div>
                      {loadingLinkedProcesses && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
                    </div>
                    <div className="mt-3 flex gap-2">
                      {linkedProcesses.ms ? (
                        <button
                          type="button"
                          onClick={() => handleOpenProcessDetails(linkedProcesses.ms!.id)}
                          className="flex-1 px-3 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
                        >
                          Abrir
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleCreateProcessFromRequirement('ms')}
                          className="flex-1 px-3 py-2 text-xs font-semibold bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition"
                        >
                          Criar MS
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="md:col-span-2">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs font-semibold text-slate-500 uppercase">Documentos do requerimento</label>
                  <button
                    type="button"
                    onClick={handleGenerateMsPdf}
                    disabled={generatingMsPdf}
                    className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg transition disabled:opacity-60"
                  >
                    {generatingMsPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                    Gerar MS (Word/DOCX)
                  </button>
                </div>

                <div className="mt-2 rounded-xl border border-slate-200 bg-white overflow-hidden">
                  {requirementDocumentsLoading ? (
                    <div className="px-4 py-4 text-sm text-slate-500 flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Carregando documentos...
                    </div>
                  ) : requirementDocuments.length === 0 ? (
                    <div className="px-4 py-4">
                      <p className="text-sm text-slate-500">Nenhum documento anexado ainda.</p>
                      <button
                        type="button"
                        onClick={handleGenerateMsPdf}
                        disabled={generatingMsPdf}
                        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold transition disabled:opacity-60"
                        style={{
                          backgroundColor: generatingMsPdf ? '#e2e8f0' : '#0f172a',
                          color: generatingMsPdf ? '#94a3b8' : '#ffffff',
                        }}
                      >
                        {generatingMsPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                        Gerar MS (Word/DOCX)
                      </button>
                      <p className="mt-2 text-xs text-slate-400">
                        O Word (DOCX) será gerado com os dados do requerimento e do cliente e ficará salvo aqui para baixar quando quiser.
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-200">
                      {requirementDocuments.map((doc) => (
                        <div key={doc.id} className="px-4 py-3 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900 truncate">{doc.file_name}</p>
                            <p className="text-xs text-slate-500">{formatDate(doc.created_at)}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleDownloadRequirementDocument(doc)}
                              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
                            >
                              <FileDown className="w-4 h-4" />
                              Baixar
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteRequirementDocument(doc)}
                              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-red-50 hover:bg-red-100 text-red-700 rounded-lg transition"
                            >
                              <Trash2 className="w-4 h-4" />
                              Excluir
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 mt-8 pt-6 border-t border-gray-200">
              {selectedRequirementForView.status !== 'em_analise' && (
                <button
                  onClick={handleQuickBackToAnalysis}
                  className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white font-medium px-4 py-2.5 rounded-lg transition"
                >
                  <Clock className="w-4 h-4" />
                  Voltar p/ Em análise
                </button>
              )}
              <button
                onClick={() => openExigencyModal(selectedRequirementForView)}
                className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-medium px-4 py-2.5 rounded-lg transition"
              >
                <Calendar className="w-4 h-4" />
                Prazo Exigência
              </button>
              <button
                onClick={() => openPericiaModal(selectedRequirementForView)}
                className="inline-flex items-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white font-medium px-4 py-2.5 rounded-lg transition"
              >
                <Calendar className="w-4 h-4" />
                Agendar Perícia
              </button>
              <button
                onClick={() => handleOpenModal(selectedRequirementForView)}
                className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2.5 rounded-lg transition"
              >
                <Edit2 className="w-4 h-4" />
                Editar Requerimento
              </button>
              <button
                onClick={() => handleWhatsApp(selectedRequirementForView.phone)}
                className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-medium px-4 py-2.5 rounded-lg transition"
              >
                <MessageSquare className="w-4 h-4" />
                WhatsApp
              </button>
              <button
                onClick={() => {
                  handleDeleteRequirement(selectedRequirementForView.id);
                  handleBackToList();
                }}
                className="inline-flex items-center gap-2 bg-red-50 hover:bg-red-100 text-red-600 font-medium px-4 py-2.5 rounded-lg transition"
              >
                <Trash2 className="w-4 h-4" />
                Excluir Requerimento
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body
    );
  })() : null;

  return (
    <div className="space-y-6">
      {schedulePromptId && (
        <div className="bg-cyan-50 border border-cyan-200 text-cyan-700 px-4 py-3 rounded-lg text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            <span>
              Requerimento aguardando perícia. Em breve iremos abrir o compromisso automaticamente na agenda.
            </span>
          </div>
          <button onClick={clearSchedulePrompt} className="text-cyan-700 hover:text-cyan-900 text-xs font-semibold uppercase">
            Fechar
          </button>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-3 sm:p-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 sm:gap-3 mb-3 sm:mb-4">
          <div>
            <h3 className="text-lg sm:text-xl font-semibold text-slate-900">Sistema de Requerimentos</h3>
            <p className="text-xs sm:text-sm text-slate-600 mt-1 hidden sm:block">Gerencie requerimentos administrativos do INSS</p>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 w-full sm:w-auto sm:justify-end">
            <button
              onClick={handleExportExcel}
              disabled={exportingExcel}
              className="inline-flex items-center justify-center gap-2 border border-green-600 text-green-700 hover:bg-green-50 disabled:border-green-300 disabled:text-green-400 bg-white font-medium px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg shadow-sm transition disabled:cursor-not-allowed text-xs sm:text-sm w-full sm:w-auto"
            >
              {exportingExcel ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
              <span>{exportingExcel ? 'Gerando Excel...' : 'Exportar Excel'}</span>
            </button>

            <button
              type="button"
              onClick={handleOpenMsTemplateModal}
              className="inline-flex items-center justify-center gap-2 border border-slate-300 text-slate-700 hover:bg-slate-50 bg-white font-medium px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg shadow-sm transition text-xs sm:text-sm w-full sm:w-auto"
              title="Selecionar/enviar modelo Word (DOCX) para o MS"
            >
              <Settings className="w-4 h-4" />
              <span>Template MS</span>
            </button>

            <button
              onClick={() => handleOpenModal(undefined)}
              className="inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium px-3 sm:px-5 py-2 sm:py-2.5 rounded-lg shadow-sm transition text-xs sm:text-sm w-full sm:w-auto"
            >
              <Plus className="w-4 h-4" />
              <span>Novo Requerimento</span>
            </button>
          </div>
        </div>

        {/* Abas de Status */}
        <div className="flex flex-wrap gap-1.5 sm:gap-2 mb-4 sm:mb-6 overflow-x-auto pb-2">
          <button
            onClick={() => setActiveStatusTab('todos')}
            className={`px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition whitespace-nowrap ${
              activeStatusTab === 'todos'
                ? 'bg-blue-600 text-white animate-pulse'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
            style={activeStatusTab === 'todos' ? { animationDuration: '2.4s' } : undefined}
          >
            Todos ({statusCounts.todos})
          </button>
          {STATUS_OPTIONS.map((status) => (
            <button
              key={status.key}
              onClick={() => setActiveStatusTab(status.key)}
              className={`px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition whitespace-nowrap ${
                activeStatusTab === status.key
                  ? `${status.badge} ${status.animation ?? ''}`
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
              style={activeStatusTab === status.key ? status.animationStyle : undefined}
            >
              <span className="inline-flex items-center gap-2">
                {status.label}
                {status.icon === 'spinner' && (
                  <Loader2 className="w-3 h-3 animate-spin" />
                )}
                ({statusCounts[status.key]})
              </span>
            </button>
          ))}
        </div>

        {/* Filtros */}
        <div className="mt-2 sm:mt-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm text-slate-600">Filtros avançados</span>
            <button
              type="button"
              onClick={() => setShowFilters((prev) => !prev)}
              className="text-xs sm:text-sm font-medium text-blue-600 hover:text-blue-700 underline-offset-2 hover:underline"
            >
              {showFilters ? 'Ocultar filtros' : 'Mostrar filtros'}
            </button>
          </div>

          {showFilters && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input
                  type="text"
                  value={filterProtocol}
                  onChange={(event) => setFilterProtocol(event.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  placeholder="Buscar por protocolo..."
                />
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input
                  type="text"
                  value={filterBeneficiary}
                  onChange={(event) => setFilterBeneficiary(event.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  placeholder="Buscar por beneficiário..."
                />
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input
                  type="text"
                  value={filterCPF}
                  onChange={(event) => setFilterCPF(event.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  placeholder="Buscar por CPF..."
                />
              </div>

              <select
                value={filterBenefitType}
                onChange={(event) => setFilterBenefitType(event.target.value as BenefitType | '')}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="">Todos os tipos</option>
                {BENEFIT_TYPES.map((type) => (
                  <option key={type.key} value={type.key}>
                    {type.label}
                  </option>
                ))}
              </select>

              <label className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg bg-white text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={filterOnlyMsRisk}
                  onChange={(e) => setFilterOnlyMsRisk(e.target.checked)}
                  className="accent-red-600"
                />
                Somente risco MS (90+)
              </label>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-16 flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-slate-600">Carregando requerimentos...</p>
        </div>
      ) : filteredRequirements.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
          <p className="text-slate-600">Nenhum requerimento encontrado.</p>
        </div>
      ) : (
        <React.Fragment>
        {/* Desktop: Tabela | Mobile: Cards */}
        <div className="hidden lg:block bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] divide-y divide-gray-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Protocolo
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Beneficiário
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    CPF
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Tipo de Benefício
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Data de Entrada
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {paginatedRequirements.map((requirement) => {
                  const isUpdating = statusUpdatingId === requirement.id;
                  const statusConfig = getStatusConfig(requirement.status);
                  const periciaNextAt = requirement.status === 'aguardando_pericia' ? getPericiaNextAt(requirement) : null;
                  const analysisDays = requirement.status === 'em_analise' ? getAnalysisDays(requirement) : null;
                  const showMandadoRisk = isMandadoRisk(requirement);
                  const analysisLevel = getAnalysisAlertLevel(typeof analysisDays === 'number' ? analysisDays : null);
                  return (
                    <tr key={requirement.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-mono text-gray-900">{requirement.protocol}</div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900 max-w-[200px]">
                        <div className="truncate">{requirement.beneficiary}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{requirement.cpf}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{getBenefitTypeLabel(requirement.benefit_type)}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <select
                            value={requirement.status}
                            onChange={(e) => handleStatusChange(requirement.id, e.target.value as RequirementStatus)}
                            disabled={isUpdating}
                            className={`text-xs font-semibold px-3 py-1 rounded-full border-0 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition ${
                              statusConfig?.badge ?? 'bg-slate-200 text-slate-700'
                            } ${statusConfig?.animation ?? ''}`}
                            style={statusConfig?.animationStyle}
                          >
                            {STATUS_OPTIONS.map((opt) => (
                              <option key={opt.key} value={opt.key}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          {(requirement.status === 'em_analise' || isUpdating) && (
                            <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                          )}
                        </div>
                        {requirement.status === 'em_exigencia' && (
                          <p className="text-amber-600 text-xs font-medium mt-2">
                            Prazo: {requirement.exigency_due_date ? formatDate(requirement.exigency_due_date) : 'não definido'}
                          </p>
                        )}
                        {requirement.status === 'aguardando_pericia' && periciaNextAt && (
                          <p className="text-cyan-700 text-xs font-medium mt-2">
                            Próxima perícia: {formatDateTime(periciaNextAt)}
                          </p>
                        )}
                        {requirement.status === 'em_analise' && typeof analysisDays === 'number' && (
                          <div className={`text-xs font-medium mt-2 ${showMandadoRisk ? 'text-red-600' : 'text-slate-600'} leading-tight break-words max-w-[300px]`}>
                            {showMandadoRisk && (
                              <div className="flex items-center gap-1 bg-red-50 px-2 py-1 rounded-md border border-red-200">
                                <AlertTriangle className="w-3 h-3 flex-shrink-0 text-red-500" />
                                <span className="text-red-700 font-medium">
                                  Mandado de segurança — {analysisDays} dias
                                </span>
                              </div>
                            )}
                            {!showMandadoRisk && analysisLevel === 'high' && (
                              <div className="flex items-center gap-1 bg-orange-50 px-2 py-1 rounded-md border border-orange-200">
                                <AlertTriangle className="w-3 h-3 flex-shrink-0 text-orange-500" />
                                <span className="text-orange-700 font-medium">Atenção — {analysisDays} dias</span>
                              </div>
                            )}
                            {!showMandadoRisk && analysisLevel === 'medium' && (
                              <div className="flex items-center gap-1 bg-yellow-50 px-2 py-1 rounded-md border border-yellow-200">
                                <AlertTriangle className="w-3 h-3 flex-shrink-0 text-yellow-600" />
                                <span className="text-yellow-800 font-medium">Alerta — {analysisDays} dias</span>
                              </div>
                            )}
                            {!showMandadoRisk && analysisLevel === 'none' && (
                              <span className="inline-flex items-center gap-1">
                                <Clock className="w-3 h-3 text-slate-400" />
                                Em análise há {analysisDays} dias
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatDate(requirement.entry_date)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleWhatsApp(requirement.phone)}
                            className="text-green-600 hover:text-green-900 transition-colors"
                            title="WhatsApp"
                          >
                            <MessageSquare className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => handleViewRequirement(requirement)}
                            className="text-cyan-600 hover:text-cyan-900 transition-colors"
                            title="Ver detalhes"
                          >
                            <Eye className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => handleOpenModal(requirement)}
                            className="text-blue-600 hover:text-blue-900 transition-colors"
                            title="Editar"
                          >
                            <Edit2 className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => handleDeleteRequirement(requirement.id)}
                            className="text-red-600 hover:text-red-900 transition-colors"
                            title="Excluir"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Mobile: Cards */}
        <div className="lg:hidden space-y-3">
          {paginatedRequirements.map((requirement) => {
            const isUpdating = statusUpdatingId === requirement.id;
            const statusConfig = getStatusConfig(requirement.status);
            const periciaNextAt = requirement.status === 'aguardando_pericia' ? getPericiaNextAt(requirement) : null;
            const analysisDays = requirement.status === 'em_analise' ? getAnalysisDays(requirement) : null;
            const showMandadoRisk = isMandadoRisk(requirement);
            const analysisLevel = getAnalysisAlertLevel(typeof analysisDays === 'number' ? analysisDays : null);
            return (
              <div
                key={requirement.id}
                className="bg-white border border-gray-200 rounded-xl p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{requirement.beneficiary}</p>
                    <p className="text-xs text-slate-500 font-mono mt-0.5">{requirement.protocol || 'Sem protocolo'}</p>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold shrink-0 ${
                      statusConfig?.badge ?? 'bg-slate-200 text-slate-700'
                    } ${statusConfig?.animation ?? ''}`}
                    style={statusConfig?.animationStyle}
                  >
                    {getStatusLabel(requirement.status)}
                    {(requirement.status === 'em_analise' || isUpdating) && (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    )}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-500">CPF:</span>
                    <span className="ml-1 text-slate-700">{requirement.cpf}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Entrada:</span>
                    <span className="ml-1 text-slate-700">{formatDate(requirement.entry_date)}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-500">Benefício:</span>
                    <span className="ml-1 text-slate-700">{getBenefitTypeLabel(requirement.benefit_type)}</span>
                  </div>
                  {requirement.status === 'em_exigencia' && (
                    <div className="col-span-2">
                      <span className="text-amber-600 font-medium">
                        Prazo: {requirement.exigency_due_date ? formatDate(requirement.exigency_due_date) : 'não definido'}
                      </span>
                    </div>
                  )}
                  {requirement.status === 'aguardando_pericia' && periciaNextAt && (
                    <div className="col-span-2">
                      <span className="text-cyan-700 font-medium">
                        Próxima perícia: {formatDateTime(periciaNextAt)}
                      </span>
                    </div>
                  )}
                  {requirement.status === 'em_analise' && typeof analysisDays === 'number' && (
                    <div className="col-span-2">
                      <div className={`${showMandadoRisk ? 'text-red-600' : 'text-slate-600'} text-xs font-medium leading-tight break-words`}>
                        {showMandadoRisk && (
                          <div className="flex items-center gap-1 bg-red-50 px-2 py-1 rounded-md border border-red-200">
                            <AlertTriangle className="w-3 h-3 flex-shrink-0 text-red-500" />
                            <span className="text-red-700 font-medium">
                              Mandado de segurança — {analysisDays} dias
                            </span>
                          </div>
                        )}
                        {!showMandadoRisk && analysisLevel === 'high' && (
                          <div className="flex items-center gap-1 bg-orange-50 px-2 py-1 rounded-md border border-orange-200">
                            <AlertTriangle className="w-3 h-3 flex-shrink-0 text-orange-500" />
                            <span className="text-orange-700 font-medium">Atenção — {analysisDays} dias</span>
                          </div>
                        )}
                        {!showMandadoRisk && analysisLevel === 'medium' && (
                          <div className="flex items-center gap-1 bg-yellow-50 px-2 py-1 rounded-md border border-yellow-200">
                            <AlertTriangle className="w-3 h-3 flex-shrink-0 text-yellow-600" />
                            <span className="text-yellow-800 font-medium">Alerta — {analysisDays} dias</span>
                          </div>
                        )}
                        {!showMandadoRisk && analysisLevel === 'none' && (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3 text-slate-400" />
                            Em análise há {analysisDays} dias
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                  <select
                    value={requirement.status}
                    onChange={(e) => handleStatusChange(requirement.id, e.target.value as RequirementStatus)}
                    disabled={isUpdating}
                    className="text-xs font-medium px-2 py-1 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 bg-white"
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.key} value={opt.key}>
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleWhatsApp(requirement.phone)}
                      className="text-green-600 hover:text-green-700 transition-colors p-1"
                      title="WhatsApp"
                    >
                      <MessageSquare className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => handleViewRequirement(requirement)}
                      className="text-cyan-600 hover:text-cyan-700 transition-colors p-1"
                      title="Ver detalhes"
                    >
                      <Eye className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => handleOpenModal(requirement)}
                      className="text-blue-600 hover:text-blue-700 transition-colors p-1"
                      title="Editar"
                    >
                      <Edit2 className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => handleDeleteRequirement(requirement.id)}
                      className="text-red-600 hover:text-red-700 transition-colors p-1"
                      title="Excluir"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        </React.Fragment>
      )}

      {filteredRequirements.length > pageSize && (
        <div className="bg-white border border-gray-200 rounded-xl p-3 sm:p-4 flex items-center justify-between gap-2">
          <button
            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
            disabled={currentPage === 1}
            className="px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            <span className="hidden sm:inline">Anterior</span>
            <span className="sm:hidden">←</span>
          </button>
          <div className="text-xs sm:text-sm text-slate-600 text-center">
            <span className="hidden sm:inline">Página </span>{currentPage}<span className="hidden sm:inline"> de</span><span className="sm:hidden">/</span> {totalPages}
          </div>
          <button
            onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={currentPage === totalPages}
            className="px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            <span className="hidden sm:inline">Próxima</span>
            <span className="sm:hidden">→</span>
          </button>
        </div>
      )}

      {requirementModal}
      {exigencyDeadlineModal}
      {periciaSchedulingModal}
      {detailsModal}
      {createClientModal}

      {msTemplateModalOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center px-3 sm:px-6 py-4">
          <div className="absolute inset-0 bg-slate-900/55 backdrop-blur-sm" onClick={handleCloseMsTemplateModal} />
          <div className="relative w-full max-w-2xl max-h-[90vh] min-h-[70vh] !bg-white rounded-2xl shadow-2xl ring-1 ring-black/5 overflow-hidden flex flex-col">
            <div className="h-1 bg-gradient-to-r from-orange-400 via-orange-500 to-orange-600" />
            <div className="px-5 sm:px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Template</p>
                <h3 className="text-lg font-semibold text-slate-900">Template MS (Word/DOCX)</h3>
                <p className="text-xs text-slate-500 mt-1">O MS em Word (DOCX) será gerado usando este modelo (placeholders [[...]]).</p>
              </div>
              <button
                type="button"
                onClick={handleCloseMsTemplateModal}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition"
                aria-label="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 sm:px-6 py-5 space-y-4 flex-1 overflow-y-auto min-h-0">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Selecionar template
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={msTemplateId}
                    onChange={(e) => setMsTemplateId(e.target.value)}
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition hover:border-slate-300 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="">(selecionar um template)</option>
                    {msTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={loadMsTemplates}
                    disabled={msTemplateLoading}
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg transition disabled:opacity-60"
                  >
                    {msTemplateLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    Atualizar
                  </button>
                </div>
                {msTemplate?.id && (
                  <p className="mt-2 text-xs text-slate-500">
                    Selecionado: <span className="font-semibold">{msTemplate.name}</span>
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Enviar novo modelo Word (.docx)
                </label>
                <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                  <input
                    type="file"
                    accept=".docx"
                    onChange={(e) => setMsTemplateUploadFile(e.target.files?.[0] ?? null)}
                    className="flex-1 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-4 file:py-2 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-50"
                  />
                  <button
                    type="button"
                    onClick={handleUploadMsTemplateDocx}
                    disabled={msTemplateSaving || !msTemplateUploadFile}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition disabled:opacity-60"
                  >
                    {msTemplateSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    Enviar
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Placeholders Disponíveis
                </label>
                <div className="text-xs text-slate-600 space-y-1 max-h-[25vh] overflow-y-auto">
                  <p><strong>Dados do Cliente:</strong></p>
                  <p>• [[NOME COMPLETO]], [[nacionalidade]], [[estado civil]], [[profissão]]</p>
                  <p>• [[CPF]], [[endereço]], [[número]], [[complemento]]</p>
                  <p>• [[bairro]], [[cidade]], [[estado]], [[CEP]]</p>
                  <p>• [[telefone]], [[celular]], [[ENDERECO_COMPLETO]]</p>
                  <p><strong>Dados do Requerimento:</strong></p>
                  <p>• [[PROTOCOLO]], [[BENEFICIO]], [[DATA_REQUERIMENTO]]</p>
                  <p>• [[TEMPO_EM_ANALISE_DIAS]], [[DATA_ATUAL_EXTENSO]], [[data]]</p>
                </div>
              </div>
            </div>

            <div className="px-5 sm:px-6 py-4 border-t border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3 shrink-0 bg-white sticky bottom-0">
              <button
                type="button"
                onClick={handleCloseMsTemplateModal}
                disabled={msTemplateSaving}
                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900 transition disabled:opacity-60 w-full sm:w-auto"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveSelectedMsTemplate}
                disabled={msTemplateSaving}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold !bg-black hover:!bg-zinc-900 text-white rounded-lg transition disabled:opacity-60 w-full sm:w-auto justify-center"
              >
                {msTemplateSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RequirementsModule;
