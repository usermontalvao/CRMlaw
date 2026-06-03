import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus,
  Loader2,
  Edit2,
  Trash2,
  Reply,
  SendHorizontal,
  ChevronDown,
  Eye,
  X,
  MessageSquare,
  FileSpreadsheet,
  Calendar,
  AlertTriangle,
  FileDown,
  FileText,
  Clock,
  Settings,
  Upload,
  ClipboardList,
  Bell,
  Stethoscope,
  History,
  NotebookPen,
  User,
  FileCheck,
  Phone,
  Lock,
  File,
  Link,
  FolderOpen,
  Search,
  Activity,
  HeartPulse,
  Brain,
  Microscope,
  TestTube,
  TrendingUp,
  Zap,
  RefreshCw,
  Download,
  Archive,
  ArchiveRestore,
  Scale,
  Pencil,
  Check,
  Printer,
  EyeOff,
} from 'lucide-react';
import { formatDateTime as formatDateTimeValue } from '../utils/formatters';
import { matchesNormalizedSearch, normalizeSearchText } from '../utils/search';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { requirementService } from '../services/requirement.service';
import { clientService } from '../services/client.service';
import { signatureService } from '../services/signature.service';
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
import { djenLocalService } from '../services/djenLocal.service';
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
  icon?: React.ComponentType<{ className?: string }>;
  animation?: string;
  animationStyle?: React.CSSProperties;
}[] = [
  {
    key: 'em_exigencia',
    label: 'Em Exigência',
    badge: 'bg-amber-500 text-white border border-amber-600',
    color: 'amber',
    icon: AlertTriangle,
  },
  {
    key: 'em_analise',
    label: 'Em Análise',
    badge: 'bg-blue-500 text-white border border-blue-600',
    color: 'blue',
    icon: Activity,
  },
  {
    key: 'aguardando_pericia',
    label: 'Aguardando Perícia',
    badge: 'bg-cyan-500 text-white border border-cyan-600',
    color: 'cyan',
    icon: Stethoscope,
  },
  {
    key: 'aguardando_confeccao',
    label: 'Aguardando Confecção',
    badge: 'bg-indigo-500 text-white border border-indigo-600',
    color: 'indigo',
    icon: FileText,
  },
  {
    key: 'deferido',
    label: 'Deferidos',
    badge: 'bg-green-500 text-white border border-green-600',
    color: 'green',
    icon: TrendingUp,
  },
  {
    key: 'indeferido',
    label: 'Indeferidos',
    badge: 'bg-red-500 text-white border border-red-600',
    color: 'red',
  },
  {
    key: 'ajuizado',
    label: 'Ajuizados',
    badge: 'bg-slate-700 text-white border border-slate-800',
    color: 'slate',
  },
];

type StatusConfig = (typeof STATUS_OPTIONS)[number];

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
  { key: 'bpc_loas', label: 'BPC LOAS - Deficiente' },
  { key: 'bpc_loas_deficiencia', label: 'BPC LOAS - Deficiência' },
  { key: 'bpc_loas_idoso', label: 'BPC LOAS - Idoso' },
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
  
  // Se a data está em UTC midnight (ex: 2026-02-04T00:00:00.000Z)
  // e queremos exibir a mesma data independentemente do timezone
  const utcDate = parsed.getUTCDate();
  const utcMonth = parsed.getUTCMonth();
  const utcYear = parsed.getUTCFullYear();
  
  // Formatar como dd/mm/yyyy usando os valores UTC
  const day = String(utcDate).padStart(2, '0');
  const month = String(utcMonth + 1).padStart(2, '0');
  const year = utcYear;
  
  return `${day}/${month}/${year}`;
};

const formatDateTime = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return formatDateTimeValue(value);
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (value.includes('T')) return value.split('T')[0];
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    // Usar timezone local em vez de UTC para evitar mudança de data
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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
    // Usar valores UTC para manter consistência com a data salva
    const day = String(date.getUTCDate()).padStart(2, '0');
    const monthNames = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
                        'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    const month = monthNames[date.getUTCMonth()];
    const year = date.getUTCFullYear();
    
    return `${day} de ${month} de ${year}`;
  } catch {
    // Fallback usando valores UTC
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const year = date.getUTCFullYear();
    return `${day}/${month}/${year}`;
  }
};

const getManausNow = () => {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Manaus',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) return now;
  return new Date(`${year}-${month}-${day}T12:00:00-04:00`);
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

const REQUIREMENTS_MS_TEMPLATE_TAG = '[REQUERIMENTOS_MS]';

const isRequirementsMsTemplate = (template: DocumentTemplate) => {
  const name = (template.name || '').toLowerCase();
  const description = (template.description || '').toUpperCase();

  return (
    description.includes(REQUIREMENTS_MS_TEMPLATE_TAG)
    || name.includes('modelo ms (requerimentos)')
    || name.includes('modelo ms requerimentos')
  );
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

Conforme o Artigo 5º LXIX, da Constituição da República Federativa do Brasil, conceder-se-á mandado de segurança para proteger direito líquido e certo, não amparado por "habeas-corpus" ou "habeas-data", quando o responsável pela ilegalidade ou abuso de poder for autoridade pública ou agente de pessoa jurídica no exercício de atribuições do Poder Público.
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
    signature_id?: string;
    role?: string;
  };
  initialStatusTab?: RequirementStatus | 'todos';
  onParamConsumed?: () => void;
}

const RequirementsModule: React.FC<RequirementsModuleProps> = ({ forceCreate, entityId, prefillData, initialStatusTab, onParamConsumed }) => {
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
  const [searchTerm, setSearchTerm] = useState('');
  const [filterProtocol, setFilterProtocol] = useState('');
  const [filterBeneficiary, setFilterBeneficiary] = useState('');
  const [filterCPF, setFilterCPF] = useState('');
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [filterBenefitType, setFilterBenefitType] = useState<BenefitType | ''>('');
  const [filterOnlyMsRisk, setFilterOnlyMsRisk] = useState(false);
  const [activeStatusTab, setActiveStatusTab] = useState<RequirementStatus | 'todos'>('todos');
  const [viewMode, setViewMode] = useState<'list' | 'details'>('list');
  const [activeDetailTab, setActiveDetailTab] = useState<'overview' | 'notes' | 'observations' | 'documents' | 'history'>('overview');
  const [selectedRequirementForView, setSelectedRequirementForView] = useState<Requirement | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [addingReply, setAddingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [statusExpanded, setStatusExpanded] = useState(false);
  const [documentsExpanded, setDocumentsExpanded] = useState(false);

  const appliedInitialStatusRef = useRef(false);
  useEffect(() => {
    if (!initialStatusTab) return;
    if (appliedInitialStatusRef.current) return;
    appliedInitialStatusRef.current = true;
    setActiveStatusTab(initialStatusTab);
    onParamConsumed?.();
  }, [initialStatusTab, onParamConsumed]);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [linkedProcesses, setLinkedProcesses] = useState<{ principal?: Process | null; ms?: Process | null }>({
    principal: null,
    ms: null,
  });
  const [loadingLinkedProcesses, setLoadingLinkedProcesses] = useState(false);
  const [requirementsWithMs, setRequirementsWithMs] = useState<Set<string>>(new Set());
  const [requirementsMsMap, setRequirementsMsMap] = useState<Map<string, { process_code: string; court: string | null; djenOrgao: string | null }>>(new Map());
  const [requirementsWithProcess, setRequirementsWithProcess] = useState<Set<string>>(new Set());
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
  const [msSelectTemplateModalOpen, setMsSelectTemplateModalOpen] = useState(false);
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
  const [indeferidoConfirm, setIndeferidoConfirm] = useState<{ requirementId: string; hasMedica: boolean; hasSocial: boolean } | null>(null);
  const [periciaForm, setPericiaForm] = useState<PericiaScheduleFormState>({
    includeMedica: true,
    medicaDate: '',
    medicaTime: '',
    includeSocial: false,
    socialDate: '',
    socialTime: '',
    notifyDaysBefore: '1',
  });
  const [periciaResponsibleId, setPericiaResponsibleId] = useState('');
  const [periciaSaving, setPericiaSaving] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filterNoPhone, setFilterNoPhone] = useState(false);
  const [filterNoCpf, setFilterNoCpf] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkActioning, setIsBulkActioning] = useState(false);
  const [whatsappTemplateReq, setWhatsappTemplateReq] = useState<Requirement | null>(null);
  const [selectedWATemplate, setSelectedWATemplate] = useState<{ label: string; text: string } | null>(null);
  const [copiedCpfId, setCopiedCpfId] = useState<string | null>(null);
  const [showDetailPassword, setShowDetailPassword] = useState(false);
  const [copiedDetailField, setCopiedDetailField] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false);
  const [statusHistory, setStatusHistory] = useState<RequirementStatusHistoryEntry[]>([]);
  const [statusHistoryLoading, setStatusHistoryLoading] = useState(false);
  const [editingHistoryId, setEditingHistoryId] = useState<string | null>(null);
  const [editingHistoryDate, setEditingHistoryDate] = useState<string>('');
  const [savingHistoryDate, setSavingHistoryDate] = useState(false);
  const [exigencyForm, setExigencyForm] = useState({
    title: '',
    due_date: '',
    priority: 'alta' as DeadlinePriority,
    notify_days_before: '3',
    responsible_id: '',
  });
  const exigencySubmittingRef = useRef(false);
  const [sourceSignatureId, setSourceSignatureId] = useState<string | null>(null);

  useEffect(() => {
    if (showFilters) setMobileControlsOpen(true);
  }, [showFilters]);

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

      // Atualizar lista de requerimentos com MS
      if (ms && !requirementsWithMs.has(selectedRequirementForView.id)) {
        setRequirementsWithMs(prev => new Set([...prev, selectedRequirementForView.id]));
        setRequirementsMsMap(prev => new Map([...prev, [selectedRequirementForView.id, { process_code: ms.process_code ?? '', court: ms.court ?? null, djenOrgao: null }]]));
      }

      // Atualizar lista de requerimentos indeferidos com processo
      if (selectedRequirementForView.status === 'indeferido' && (principal || ms)) {
        setRequirementsWithProcess(prev => new Set([...prev, selectedRequirementForView.id]));
      }

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
    // Só conta enquanto o requerimento está em análise
    if (requirement.status !== 'em_analise') return null;

    // Prazo conta a partir de quando o requerimento ficou em análise (analysis_started_at).
    // Fallback para entry_date ou created_at apenas em requerimentos antigos sem o campo.
    const base = requirement.analysis_started_at
      || requirement.entry_date
      || requirement.created_at;

    if (!base) return null;
    const t = new Date(base).getTime();
    if (Number.isNaN(t)) return null;
    return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
  };

  // Converte ISO string → formato aceito pelo input datetime-local (YYYY-MM-DDTHH:mm)
  const toDatetimeLocal = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const handleSaveHistoryDate = async (entry: RequirementStatusHistoryEntry) => {
    if (!editingHistoryDate || savingHistoryDate) return;
    setSavingHistoryDate(true);
    try {
      const newISO = new Date(editingHistoryDate).toISOString();
      await requirementService.updateHistoryEntryDate(entry.id, newISO, entry.requirement_id, entry.to_status);

      // Atualiza histórico local e reordena
      setStatusHistory((prev) =>
        [...prev.map((e) => (e.id === entry.id ? { ...e, changed_at: newISO } : e))]
          .sort((a, b) => b.changed_at.localeCompare(a.changed_at))
      );

      // Se era transição para em_analise, atualiza analysis_started_at nos states
      // para que o contador de dias recalcule imediatamente
      if (entry.to_status === 'em_analise') {
        const patchReq = (r: Requirement) =>
          r.id === entry.requirement_id ? { ...r, analysis_started_at: newISO } : r;
        setRequirements((prev) => prev.map(patchReq));
        setSelectedRequirementForView((prev) => prev ? patchReq(prev) : prev);
      }

      setEditingHistoryId(null);
    } catch (err: any) {
      alert(err.message || 'Erro ao atualizar data.');
    } finally {
      setSavingHistoryDate(false);
    }
  };

  // < 30d  → null  (não exibe nada)
  // 30–59d → 'low'      (contador simples, sem badge)
  // 60–89d → 'high'     (laranja)
  // ≥ 90d  → 'critical' (vermelho, risco MS)
  const getAnalysisAlertLevel = (days: number | null): 'critical' | 'high' | 'low' | null => {
    if (typeof days !== 'number') return null;
    if (days >= 90) return 'critical';
    if (days >= 60) return 'high';
    if (days >= 30) return 'low';
    return null;
  };

  const isMandadoRisk = (requirement: Requirement) => {
    if (requirement.status !== 'em_analise') return false;
    const days = getAnalysisDays(requirement);
    return typeof days === 'number' && days >= 90;
  };

  // Days remaining until exigency due date (negative = overdue)
  const getExigencyDaysLeft = (req: Requirement): number | null => {
    if (req.status !== 'em_exigencia' || !req.exigency_due_date) return null;
    const due = new Date(req.exigency_due_date);
    if (isNaN(due.getTime())) return null;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  };

  const getExigencyUrgency = (daysLeft: number | null): 'overdue' | 'critical' | 'warning' | 'ok' | null => {
    if (daysLeft === null) return null;
    if (daysLeft < 0) return 'overdue';
    if (daysLeft <= 3) return 'critical';
    if (daysLeft <= 7) return 'warning';
    return 'ok';
  };

  // Days until next INSS deadline milestone (45d or 90d) — for proactive warning
  const getInssCountdown = (req: Requirement): { threshold: number; daysLeft: number } | null => {
    if (req.status !== 'em_analise') return null;
    const days = getAnalysisDays(req);
    if (typeof days !== 'number' || days >= 90) return null;
    if (days >= 45) return { threshold: 90, daysLeft: 90 - days };
    if (days >= 30) return { threshold: 45, daysLeft: 45 - days };
    return null;
  };

  // WhatsApp templates per status
  const WHATSAPP_TEMPLATES: Partial<Record<RequirementStatus, { label: string; text: string }[]>> = {
    em_exigencia: [
      { label: 'Exigência pendente', text: 'Olá, *{nome}*! Informamos que seu requerimento (*{protocolo}*) está com exigência pendente no INSS e precisa ser atendida para dar continuidade ao processo. Entre em contato conosco para orientações. 🙏' },
    ],
    em_analise: [
      { label: 'Em análise', text: 'Olá, *{nome}*! Seu requerimento (*{protocolo}*) está em análise no INSS. Assim que houver qualquer atualização, entrarei em contato. Qualquer dúvida, estou à disposição! 😊' },
      { label: 'Prazo próximo', text: 'Olá, *{nome}*! Seu requerimento (*{protocolo}*) está em análise há mais de 45 dias. Caso não haja decisão em breve, podemos estudar medidas judiciais para garantir seu direito. Podemos conversar?' },
    ],
    aguardando_pericia: [
      { label: 'Perícia agendada', text: 'Olá, *{nome}*! Seu requerimento (*{protocolo}*) está aguardando perícia. Lembre-se de comparecer no dia e horário agendados com todos os documentos. Qualquer dúvida, estou à disposição!' },
    ],
    aguardando_confeccao: [
      { label: 'Em preparação', text: 'Olá, *{nome}*! Seu processo (*{protocolo}*) está em preparação. Em breve daremos início ao protocolo junto ao INSS. Qualquer dúvida, estou à disposição! 👍' },
    ],
    deferido: [
      { label: '🎉 Deferido!', text: '🎉 Olá, *{nome}*! Ótima notícia: seu requerimento (*{protocolo}*) foi *deferido*! O benefício foi aprovado. Em breve o valor estará disponível. Parabéns! Qualquer dúvida, estou à disposição.' },
    ],
    indeferido: [
      { label: 'Indeferido — próximos passos', text: 'Olá, *{nome}*! Infelizmente seu requerimento (*{protocolo}*) foi *indeferido* pelo INSS. Não desanime — podemos estudar alternativas, como recurso administrativo ou ação judicial. Vamos conversar?' },
    ],
    ajuizado: [
      { label: 'Processo judicial', text: 'Olá, *{nome}*! Seu processo judicial (*{protocolo}*) está em andamento. Acompanharemos cada movimentação e manteremos você informado(a). Qualquer dúvida, estou à disposição! ⚖️' },
    ],
  };

  const buildWAText = (text: string, req: Requirement) =>
    text.replace(/{nome}/g, req.beneficiary ?? 'Beneficiário')
        .replace(/{protocolo}/g, req.protocol ?? 'sem protocolo');

  const handlePrintRequirement = (req: Requirement) => {
    const statusLabel  = getStatusLabel(req.status);
    const benefitLabel = getBenefitTypeLabel(req.benefit_type);
    const analysisDays = getAnalysisDays(req);
    const alertLevel   = getAnalysisAlertLevel(typeof analysisDays === 'number' ? analysisDays : null);
    const now          = new Date();
    const dateStr      = now.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    const timeStr      = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const esc          = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    // Quem está emitindo
    const emitterName = currentProfile?.name || user?.email || 'Usuário';

    // Resolve nome do ator no histórico
    const resolveActor = (changedBy: string | null): string => {
      if (!changedBy) return 'Sistema';
      const m = memberByUserId.get(changedBy);
      if (m?.name) return m.name;
      if (changedBy === user?.id && currentProfile?.name) return currentProfile.name;
      return 'Usu&aacute;rio';
    };

    // Alerta de análise
    const alertBlock = alertLevel === 'critical'
      ? `<div class="alert alert-red">&#9888; ${analysisDays} dias em an&aacute;lise${isMandadoRisk(req) ? ' &mdash; Risco de perda do prazo para MS' : ''}</div>`
      : alertLevel === 'high'
      ? `<div class="alert alert-orange">&#9888; ${analysisDays} dias em an&aacute;lise</div>`
      : '';

    // Campos extras
    const analysisRow = typeof analysisDays === 'number'
      ? `<div class="field"><div class="field-label">Dias em An&aacute;lise</div><div class="field-value">${analysisDays} dias</div></div>`
      : '';
    const exigencyRow = req.exigency_due_date
      ? `<div class="field"><div class="field-label">Prazo da Exig&ecirc;ncia</div><div class="field-value">${formatDate(req.exigency_due_date)}</div></div>`
      : '';

    // Seção de Perícia
    const medicaDate  = req.pericia_medica_at ? new Date(req.pericia_medica_at) : null;
    const socialDate  = req.pericia_social_at ? new Date(req.pericia_social_at) : null;
    const hasMedica   = medicaDate && !isNaN(medicaDate.getTime());
    const hasSocial   = socialDate && !isNaN(socialDate.getTime());
    const periciaBlock = (hasMedica || hasSocial) ? (() => {
      const fmtPericia = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
        + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const futureBadge = (d: Date) => d > now
        ? '<span class="badge badge-future">Futura</span>'
        : '<span class="badge badge-past">Realizada</span>';
      const rows = [
        hasMedica ? `<tr><td>P&eacute;ricia M&eacute;dica</td><td>${fmtPericia(medicaDate!)}</td><td>${futureBadge(medicaDate!)}</td></tr>` : '',
        hasSocial ? `<tr><td>P&eacute;ricia Social</td><td>${fmtPericia(socialDate!)}</td><td>${futureBadge(socialDate!)}</td></tr>` : '',
      ].join('');
      return `<div class="section-title">P&eacute;ricia</div>
<table class="hist-table">
  <thead><tr><th>Tipo</th><th>Data e Hora</th><th>Situa&ccedil;&atilde;o</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
    })() : '';

    // Observações
    const obsBlock = req.observations
      ? `<div class="section-title">Observa&ccedil;&otilde;es</div><div class="obs-box">${esc(req.observations)}</div>`
      : '';

    // Histórico de status
    const histBlock = statusHistory.length > 0 ? (() => {
      const rows = [...statusHistory]
        .sort((a, b) => a.changed_at.localeCompare(b.changed_at))
        .map(entry => {
          const when = new Date(entry.changed_at);
          const whenStr = isNaN(when.getTime()) ? entry.changed_at
            : when.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
              + ' ' + when.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          const fromLabel = entry.from_status ? getStatusLabel(entry.from_status as RequirementStatus) : '&mdash;';
          const toLabel   = getStatusLabel(entry.to_status as RequirementStatus);
          const actor     = resolveActor(entry.changed_by);
          return `<tr><td>${whenStr}</td><td>${fromLabel}</td><td>${toLabel}</td><td>${actor}</td></tr>`;
        }).join('');
      return `<div class="section-title">Hist&oacute;rico de Status</div>
<table class="hist-table">
  <thead><tr><th>Data / Hora</th><th>De</th><th>Para</th><th>Por</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
    })() : '';

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <title>Requerimento &mdash; ${esc(req.beneficiary ?? '')}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; background: #fff; font-size: 13px; }

    .header { background: #ea580c; color: #fff; padding: 22px 40px; display: flex; justify-content: space-between; align-items: center; }
    .header-left { display: flex; align-items: center; gap: 14px; }
    .header-icon { width: 42px; height: 42px; background: rgba(255,255,255,.18); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0; }
    .header-title { font-size: 17px; font-weight: 700; letter-spacing: -.2px; }
    .header-sub { font-size: 11px; opacity: .8; margin-top: 2px; }
    .header-date { text-align: right; font-size: 11px; opacity: .85; line-height: 1.7; }

    .content { padding: 26px 40px 16px; }

    .name { font-size: 21px; font-weight: 700; color: #0f172a; letter-spacing: -.3px; }
    .protocol { font-size: 12px; color: #64748b; font-family: monospace; margin-top: 4px; }

    .divider { height: 1px; background: #e2e8f0; margin: 18px 0; }

    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 48px; }
    .field-label { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #94a3b8; margin-bottom: 3px; }
    .field-value { font-size: 13px; font-weight: 600; color: #0f172a; }

    .alert { display: inline-flex; align-items: center; gap: 8px; padding: 7px 14px; border-radius: 8px; font-size: 12px; font-weight: 600; margin-bottom: 16px; }
    .alert-red    { background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; }
    .alert-orange { background: #fff7ed; border: 1px solid #fed7aa; color: #c2410c; }

    .section-title { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; color: #94a3b8; margin: 22px 0 8px; }

    .obs-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; font-size: 12.5px; color: #374151; line-height: 1.65; white-space: pre-wrap; }

    .hist-table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
    .hist-table thead tr { background: #f8fafc; }
    .hist-table th { text-align: left; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: #94a3b8; padding: 6px 10px; border-bottom: 1px solid #e2e8f0; }
    .hist-table td { padding: 7px 10px; border-bottom: 1px solid #f1f5f9; color: #334155; vertical-align: middle; }
    .hist-table tbody tr:last-child td { border-bottom: none; }

    .badge { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 10px; font-weight: 700; }
    .badge-future { background: #eff6ff; border: 1px solid #bfdbfe; color: #1d4ed8; }
    .badge-past   { background: #f0fdf4; border: 1px solid #bbf7d0; color: #15803d; }

    .footer { margin-top: 24px; padding: 12px 40px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; font-size: 10.5px; color: #94a3b8; }
    .footer-emitter { font-weight: 600; color: #64748b; }

    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .hist-table thead tr { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>

  <div class="header">
    <div class="header-left">
      <div class="header-icon">&#128203;</div>
      <div>
        <div class="header-title">Requerimento INSS</div>
        <div class="header-sub">Ficha do benefici&aacute;rio &mdash; uso interno</div>
      </div>
    </div>
    <div class="header-date">
      ${dateStr}<br/>${timeStr}
    </div>
  </div>

  <div class="content">
    <div class="name">${esc(req.beneficiary ?? '&mdash;')}</div>
    <div class="protocol">Protocolo: ${req.protocol ?? '&mdash;'}</div>

    <div class="divider"></div>

    ${alertBlock}

    <div class="grid">
      <div class="field">
        <div class="field-label">CPF</div>
        <div class="field-value">${req.cpf ? formatCPF(req.cpf) : '&mdash;'}</div>
      </div>
      <div class="field">
        <div class="field-label">Tipo de Benef&iacute;cio</div>
        <div class="field-value">${benefitLabel}</div>
      </div>
      <div class="field">
        <div class="field-label">Data de Entrada</div>
        <div class="field-value">${formatDate(req.entry_date)}</div>
      </div>
      <div class="field">
        <div class="field-label">Status Atual</div>
        <div class="field-value">${statusLabel}</div>
      </div>
      <div class="field">
        <div class="field-label">Telefone</div>
        <div class="field-value">${req.phone ?? '&mdash;'}</div>
      </div>
      <div class="field">
        <div class="field-label">Senha INSS</div>
        <div class="field-value">${req.inss_password ?? '&mdash;'}</div>
      </div>
      ${analysisRow}
      ${exigencyRow}
    </div>

    ${periciaBlock}

    ${obsBlock}

    ${histBlock}
  </div>

  <div class="footer">
    <span>CRM &mdash; Documento gerado automaticamente</span>
    <span class="footer-emitter">Emitido por ${esc(emitterName)} &mdash; ${dateStr} &agrave;s ${timeStr}</span>
  </div>

</body>
</html>`;

    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 400); }
  };

  const periciaAutoUpdateRef = useRef(false);
  const autoUpdatePericiaStatuses = async (list: Requirement[]) => {
    if (periciaAutoUpdateRef.current) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfToday = today.getTime();

    const candidates = list
      .filter((req) => req.status === 'aguardando_pericia')
      .map((req) => ({ req, endAt: getPericiaEndAt(req) }))
      .filter((item) => {
        if (!item.endAt) return false;
        const endTime = new Date(item.endAt).getTime();
        return !Number.isNaN(endTime) && endTime < startOfToday;
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
      responsible_id: '',
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

        // Atualizar lista de requerimentos indeferidos com processo
        if (selectedRequirementForView.status === 'indeferido' && (principal || ms)) {
          setRequirementsWithProcess(prev => new Set([...prev, selectedRequirementForView.id]));
        }
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
      const filtered = list.filter((template) => (
        isRequirementsMsTemplate(template) || template.id === msTemplateId
      ));
      setMsTemplates(filtered);
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

      const originalFileName = msTemplateUploadFile.name.replace(/\.docx$/i, '');
      const payload: CreateDocumentTemplateDTO = {
        name: originalFileName,
        description: `${REQUIREMENTS_MS_TEMPLATE_TAG} Template DOCX usado pelo módulo de Requerimentos para gerar MS em Word (DOCX).`,
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

  const handleRemoveMsTemplate = async () => {
    const targetId = (msTemplateId || msTemplate?.id || '').trim();
    if (!targetId) {
      toast.error('Selecione um modelo para remover.');
      return;
    }

    const templateToDelete = msTemplates.find((item) => item.id === targetId) || msTemplate;
    const confirmed = await confirmDelete({
      title: 'Remover modelo MS',
      entityName: templateToDelete?.name,
      message: 'Deseja remover permanentemente este modelo MS? Esta ação não pode ser desfeita.',
      confirmLabel: 'Remover',
    });

    if (!confirmed) return;

    try {
      setMsTemplateSaving(true);
      await documentTemplateService.deleteTemplate(targetId);

      const currentSetting = (msTemplateId || '').trim();
      if (currentSetting === targetId) {
        await settingsService.updateSetting('requirements_ms_template_id', '');
        setMsTemplateId('');
        setMsTemplate(null);
      }

      await loadMsTemplates();
      toast.success('Modelo removido com sucesso.');
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Erro ao remover modelo.');
    } finally {
      setMsTemplateSaving(false);
    }
  };

  const handleDownloadMsTemplate = async () => {
    const targetId = (msTemplateId || msTemplate?.id || '').trim();
    if (!targetId) {
      toast.error('Selecione um modelo para baixar.');
      return;
    }

    const templateToDownload = msTemplates.find((item) => item.id === targetId) || msTemplate;
    if (!templateToDownload) {
      toast.error('Modelo não encontrado.');
      return;
    }

    try {
      const blob = await documentTemplateService.downloadTemplateFile(templateToDownload);
      const fileName = templateToDownload.file_name || `${templateToDownload.name}.docx`;
      saveAs(blob, fileName);
      toast.success('Download iniciado');
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Erro ao baixar modelo.');
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

    const now = getManausNow();
    const benefitLabel = getMsBenefitTypeLabel(requirement.benefit_type);
    const primaryPhone = client.mobile || client.phone || requirement.phone || '';

    const entryDate = requirement.entry_date ? new Date(requirement.entry_date.includes('Z') ? requirement.entry_date : requirement.entry_date + 'Z') : null;
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
    registerPlaceholder('data', now.toLocaleDateString('pt-BR', { timeZone: 'America/Manaus' }));

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

    await loadMsTemplates();
    setMsSelectTemplateModalOpen(true);
  };

  const handleGenerateMsWithSelectedTemplate = async () => {
    if (!selectedRequirementForView) return;
    if (!selectedRequirementForView.client_id) {
      toast.error('Vincule um cliente ao requerimento antes de gerar o MS.');
      return;
    }

    const templateToUse = msTemplateId ? msTemplates.find(t => t.id === msTemplateId) : msTemplate;
    if (!templateToUse) {
      toast.error('Selecione um modelo para gerar o MS.');
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
      const docxBlob = await generateMsDocxFromTemplate(templateToUse, placeholders);

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
      toast.error('Abra um requerimento em "Detalhes" para gerar o MS em Word.');
      return;
    }
    void handleGenerateMsPdf();
  };

  const fetchRequirementsWithMs = async () => {
    try {
      const allProcesses = await processService.listProcesses();
      const msProcesses = allProcesses.filter(p => p.requirement_role === 'ms' && p.requirement_id);

      // 1ª tentativa: busca nome_orgao do DJEN pelo UUID do processo MS
      const msProcessIds = msProcesses.map(p => p.id);
      const djenOrgaoByIdMap = await djenLocalService.getOrgaoByProcessIds(msProcessIds);

      // 2ª tentativa: para processos sem orgao, tenta pelo número do processo (código)
      const missingCodes = msProcesses
        .filter(p => !djenOrgaoByIdMap.has(p.id) && !!p.process_code?.trim())
        .map(p => p.process_code!.trim());
      const djenOrgaoByCodeMap = missingCodes.length
        ? await djenLocalService.getOrgaoByProcessCodes(missingCodes)
        : new Map<string, string>();

      // Mapa: requirement_id → { process_code, court, djenOrgao }
      // djenOrgao tem prioridade sobre court para exibir a vara
      const msMap = new Map<string, { process_code: string; court: string | null; djenOrgao: string | null }>(
        msProcesses.map(p => {
          const byId = djenOrgaoByIdMap.get(p.id) ?? null;
          const byCode = p.process_code ? (djenOrgaoByCodeMap.get(p.process_code.trim()) ?? null) : null;
          return [
            p.requirement_id!,
            {
              process_code: p.process_code ?? '',
              court: p.court ?? null,
              djenOrgao: (byId ?? byCode) as string | null,
            },
          ] as [string, { process_code: string; court: string | null; djenOrgao: string | null }];
        })
      );

      setRequirementsWithMs(new Set(msProcesses.map(p => p.requirement_id!)));
      setRequirementsMsMap(msMap);
    } catch (err) {
      console.error('Erro ao buscar processos MS:', err);
    }
  };

  // Separar ativos e arquivados
  const activeRequirements = useMemo(() => requirements.filter((r) => !r.archived), [requirements]);
  const archivedRequirements = useMemo(() => requirements.filter((r) => r.archived), [requirements]);

  const applySearch = (list: Requirement[], term: string) => {
    if (!term.trim()) return list;
    const normalized = normalizeSearchText(term);
    const digits = term.replace(/\D/g, '');
    return list.filter((req) =>
      matchesNormalizedSearch(normalized, [req.beneficiary, req.protocol ?? '']) ||
      (digits && req.cpf.replace(/\D/g, '').includes(digits))
    );
  };

  const filteredRequirements = useMemo(() => {
    let filtered = activeRequirements;

    if (activeStatusTab !== 'todos') {
      filtered = filtered.filter((req) => req.status === activeStatusTab);
    }

    filtered = applySearch(filtered, searchTerm);

    // filtros avançados (legado — mantidos para compatibilidade)
    if (filterProtocol.trim()) {
      const term = normalizeSearchText(filterProtocol);
      filtered = filtered.filter((req) => matchesNormalizedSearch(term, [req.protocol ?? '']));
    }
    if (filterBeneficiary.trim()) {
      const term = normalizeSearchText(filterBeneficiary);
      filtered = filtered.filter((req) => matchesNormalizedSearch(term, [req.beneficiary]));
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

    if (filterNoPhone) {
      filtered = filtered.filter((req) => !req.phone?.trim());
    }

    if (filterNoCpf) {
      filtered = filtered.filter((req) => !req.cpf?.trim());
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
  }, [activeRequirements, activeStatusTab, searchTerm, filterProtocol, filterBeneficiary, filterCPF, filterBenefitType, filterOnlyMsRisk, filterNoPhone, filterNoCpf]);

  const filteredArchivedReqs = useMemo(
    () => applySearch(archivedRequirements, searchTerm),
    [archivedRequirements, searchTerm],
  );

  // Auto-expande arquivados quando a busca tem resultados lá
  useEffect(() => {
    if (searchTerm.trim() && filteredArchivedReqs.length > 0) {
      setArchivedExpanded(true);
    }
  }, [searchTerm, filteredArchivedReqs.length]);

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(filteredRequirements.length / pageSize));

  const paginatedRequirements = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRequirements.slice(start, start + pageSize);
  }, [filteredRequirements, currentPage]);

  const statusCounts = useMemo(() => {
    const counts: Record<RequirementStatus | 'todos', number> = {
      todos: activeRequirements.length,
      aguardando_confeccao: 0,
      em_analise: 0,
      em_exigencia: 0,
      aguardando_pericia: 0,
      deferido: 0,
      indeferido: 0,
      ajuizado: 0,
    };

    activeRequirements.forEach((req) => {
      counts[req.status]++;
    });

    return counts;
  }, [activeRequirements]);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await requirementService.listRequirements();
        setRequirements(data);
        await autoUpdatePericiaStatuses(data);
        await fetchRequirementsWithMs(); // Carregar processos MS vinculados
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
        const formattedCpf = prefillData.cpf ? formatCPF(prefillData.cpf) : '';

        const newFormData = {
          ...emptyForm,
          client_id: prefillData.client_id || emptyForm.client_id,
          beneficiary: prefillData.beneficiary || emptyForm.beneficiary,
          cpf: formattedCpf || emptyForm.cpf,
        };

        setFormData(newFormData);
        setSourceSignatureId(prefillData.signature_id ?? null);

        if (prefillData.beneficiary) {
          setBeneficiarySearchTerm(prefillData.beneficiary);
        }
      } else {
        setFormData(emptyForm);
        setBeneficiarySearchTerm('');
        setSourceSignatureId(null);
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
      await fetchRequirementsWithMs(); // Manter mapa MS atualizado

      // Carregar processos para requerimentos indeferidos
      const indeferidos = data.filter(req => req.status === 'indeferido');
      if (indeferidos.length > 0) {
        try {
          const processPromises = indeferidos.map(async (req) => {
            const processes = await processService.listProcesses({ requirement_id: req.id });
            return { requirementId: req.id, hasProcess: processes.length > 0 };
          });
          const processResults = await Promise.all(processPromises);
          const withProcess = new Set(
            processResults.filter(r => r.hasProcess).map(r => r.requirementId)
          );
          setRequirementsWithProcess(withProcess);
        } catch (err) {
          console.error('Erro ao carregar processos de indeferidos:', err);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Não foi possível atualizar a lista de requerimentos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [activeStatusTab, searchTerm, filterProtocol, filterBeneficiary, filterCPF, filterBenefitType, filterOnlyMsRisk, filterNoPhone, filterNoCpf]);

  // Scroll to top of list on page change
  useEffect(() => {
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [currentPage]);

  // Auto-select first WA template when modal opens
  useEffect(() => {
    if (!whatsappTemplateReq) { setSelectedWATemplate(null); return; }
    const templates = WHATSAPP_TEMPLATES[whatsappTemplateReq.status] ?? [];
    setSelectedWATemplate(templates[0] ?? null);
  }, [whatsappTemplateReq]);

  // Escape key closes overlays
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (whatsappTemplateReq) { setWhatsappTemplateReq(null); return; }
      if (exigencyModal) { handleCloseExigencyModal(); return; }
      if (periciaModal) { handleClosePericiaModal(); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [whatsappTemplateReq, exigencyModal, periciaModal]);

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
    setSourceSignatureId(null);
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
        entry_date: formData.entry_date ? toUtcMidnightIso(formData.entry_date) : null,
        exigency_due_date:
          formData.status === 'em_exigencia' && formData.exigency_due_date
            ? toUtcMidnightIso(formData.exigency_due_date)
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

        const created = await requirementService.createRequirement(createPayload as any);

        // Se foi criado a partir de uma assinatura, atualizar o requirement_id na assinatura
        if (sourceSignatureId) {
          try {
            const updatePayload: Record<string, any> = {
              requirement_id: created.id,
              requirement_number: created.protocol || null,
            };

            await signatureService.updateRequest(sourceSignatureId, updatePayload);
          } catch (error) {
            console.error('❌ Erro ao atualizar assinatura com requirement_id:', error);
            // Não bloquear o fluxo se falhar a atualização da assinatura
          }
        }

        await handleReload();
      }
      setIsModalOpen(false);
      if (!updatedRequirement) {
        setSelectedRequirement(null);
      }
      setFormData(emptyForm);
      setSourceSignatureId(null);
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

  const handleArchiveRequirement = async (id: string, archived: boolean) => {
    if (archived) {
      const req = requirements.find((r) => r.id === id);
      const confirmed = await confirmDelete({
        title: 'Arquivar requerimento',
        entityName: req?.protocol || req?.beneficiary || undefined,
        message: 'Deseja arquivar este requerimento? Ele ficará visível na seção "Arquivados" e poderá ser restaurado a qualquer momento.',
        confirmLabel: 'Arquivar',
      });
      if (!confirmed) return;
    }
    setArchivingId(id);
    try {
      const updated = await requirementService.archiveRequirement(id, archived);
      setRequirements((prev) => prev.map((r) => (r.id === id ? updated : r)));
      toast.success(archived ? 'Requerimento arquivado' : 'Requerimento restaurado');
    } catch (err: any) {
      toast.error(err.message || 'Não foi possível arquivar o requerimento.');
    } finally {
      setArchivingId(null);
    }
  };

  const handleViewRequirement = (requirement: Requirement) => {
    setSelectedRequirementForView(requirement);
    setViewMode('details');
    setNoteDraft('');
    setNoteError(null);
    setShowDetailPassword(false);
    setCopiedDetailField(null);
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
    setShowDetailPassword(false);
    setCopiedDetailField(null);
  };

  const getStatusConfig = (status: RequirementStatus) => STATUS_OPTIONS.find((s) => s.key === status);

  const getStatusBadge = (status: RequirementStatus) => {
    const statusConfig = getStatusConfig(status);
    return statusConfig
      ? `${statusConfig.badge}`
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

  const getMsBenefitTypeLabel = (type: BenefitType) => {
    if (type === 'bpc_loas' || type === 'bpc_loas_deficiencia') {
      return 'Benefício de Prestação Continuada (BPC/LOAS) à Pessoa com Deficiência';
    }
    if (type === 'bpc_loas_idoso') {
      return 'Benefício de Prestação Continuada (BPC/LOAS) – Idoso';
    }
    return getBenefitTypeLabel(type);
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
    // Se indeferindo, verificar se há péricias futuras em aberto
    if (newStatus === 'indeferido') {
      const req = requirements.find((r) => r.id === requirementId);
      const now = Date.now();
      const hasMedica = !!(req?.pericia_medica_at && new Date(req.pericia_medica_at).getTime() > now);
      const hasSocial = !!(req?.pericia_social_at && new Date(req.pericia_social_at).getTime() > now);
      if (hasMedica || hasSocial) {
        setIndeferidoConfirm({ requirementId, hasMedica, hasSocial });
        return; // aguarda confirmação do usuário
      }
    }
    await doStatusChange(requirementId, newStatus, false);
  };

  const doStatusChange = async (requirementId: string, newStatus: RequirementStatus, clearPericia: boolean) => {
    try {
      setStatusUpdatingId(requirementId);
      const requirement = requirements.find((req) => req.id === requirementId) || null;
      await requirementService.updateStatus(requirementId, newStatus);
      if (clearPericia) {
        await requirementService.updateRequirement(requirementId, {
          pericia_medica_at: null as any,
          pericia_social_at: null as any,
        });
      }
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
      responsible_id: '',
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

    if (!periciaResponsibleId) {
      toast.error('Selecione o responsável pelo agendamento.');
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
          user_id: periciaResponsibleId || null,
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
          user_id: periciaResponsibleId || null,
        };

        periciaEvents.push(calendarService.createEvent(payloadEvent));
      }

      await Promise.all(periciaEvents);

      const statusesNaoFinalizar: RequirementStatus[] = ['indeferido', 'deferido', 'ajuizado', 'aguardando_pericia'];
      if (!statusesNaoFinalizar.includes(requirement.status as RequirementStatus)) {
        await requirementService.updateStatus(requirement.id, 'aguardando_pericia');
      }

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
    // Criar data como UTC meia-noite para evitar problemas de timezone
    const [year, month, day] = dateOnly.split('-').map(Number);
    const utcDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
    return utcDate.toISOString();
  };

  const handleCreateExigencyDeadline = async () => {
    if (!exigencyModal) return;
    const title = exigencyForm.title.trim();
    if (!title) {
      toast.error('Informe o título do prazo.');
      return;
    }
    if (!exigencyForm.due_date) {
      toast.error('Informe a data de vencimento.');
      return;
    }
    if (!exigencyForm.responsible_id) {
      toast.error('Selecione um responsável pelo prazo.');
      return;
    }

    let succeeded = false;
    try {
      exigencySubmittingRef.current = true;
      const requirement = requirements.find((req) => req.id === exigencyModal.requirementId) || null;
      if (!requirement) {
        toast.error('Requerimento não encontrado.');
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
        responsible_id: exigencyForm.responsible_id || null,
        notify_days_before: parseInt(exigencyForm.notify_days_before || '3', 10) || 3,
      };

      await deadlineService.createDeadline(payload);

      await requirementService.updateRequirement(requirement.id, {
        exigency_due_date: dueDateIso,
      });

      setRequirements((prev) =>
        prev.map((req) =>
          req.id === requirement.id
            ? { ...req, exigency_due_date: dueDateIso }
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
      succeeded = true;
      toast.success('Prazo criado', 'Exigência enviada para o módulo de Prazos.');
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Não foi possível criar o prazo de exigência.');
    } finally {
      exigencySubmittingRef.current = false;
      if (succeeded) handleCloseExigencyModal();
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

  const handleOpenWhatsAppTemplateModal = (req: Requirement) => {
    if (!req.phone) {
      alert('Telefone não informado para este requerimento.');
      return;
    }
    setWhatsappTemplateReq(req);
  };

  const handleSendWATemplate = (text: string, req: Requirement) => {
    const cleaned = (req.phone ?? '').replace(/\D/g, '');
    const built = buildWAText(text, req);
    window.open(`https://wa.me/55${cleaned}?text=${encodeURIComponent(built)}`, '_blank');
    setWhatsappTemplateReq(null);
  };

  const handleBulkStatusChange = async (newStatus: RequirementStatus) => {
    if (!selectedIds.size) return;
    setIsBulkActioning(true);
    try {
      await Promise.all([...selectedIds].map((id) => requirementService.updateStatus(id, newStatus)));
      toast.success(`${selectedIds.size} requerimento(s) atualizados para "${getStatusLabel(newStatus)}".`);
      setSelectedIds(new Set());
      await handleReload();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao atualizar status em lote.');
    } finally {
      setIsBulkActioning(false);
    }
  };

  const handleBulkArchive = async () => {
    if (!selectedIds.size) return;
    const confirmed = await confirmDelete({
      title: 'Arquivar selecionados',
      message: `Deseja arquivar ${selectedIds.size} requerimento(s) selecionado(s)?`,
      confirmLabel: 'Arquivar',
    });
    if (!confirmed) return;
    setIsBulkActioning(true);
    try {
      await Promise.all([...selectedIds].map((id) => requirementService.archiveRequirement(id, true)));
      toast.success(`${selectedIds.size} requerimento(s) arquivado(s).`);
      setSelectedIds(new Set());
      await handleReload();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao arquivar em lote.');
    } finally {
      setIsBulkActioning(false);
    }
  };

  const activeFilterCount = [
    filterProtocol.trim(),
    filterBeneficiary.trim(),
    filterCPF.trim(),
    filterBenefitType,
    filterOnlyMsRisk ? 'x' : '',
    filterNoPhone ? 'x' : '',
    filterNoCpf ? 'x' : '',
  ].filter(Boolean).length;

  const handleClearAllFilters = () => {
    setFilterProtocol('');
    setFilterBeneficiary('');
    setFilterCPF('');
    setFilterBenefitType('');
    setFilterOnlyMsRisk(false);
    setFilterNoPhone(false);
    setFilterNoCpf(false);
  };

  const handleCopyCpf = (id: string, cpf: string) => {
    navigator.clipboard.writeText(cpf).then(() => {
      setCopiedCpfId(id);
      setTimeout(() => setCopiedCpfId(null), 1500);
    }).catch(() => {});
  };

  const handleCopyDetailField = (field: string, value: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedDetailField(field);
      setTimeout(() => setCopiedDetailField(null), 1500);
    }).catch(() => {});
  };

  const toggleSelectId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === paginatedRequirements.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginatedRequirements.map((r) => r.id)));
    }
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
    const noteDate = new Date(note.created_at);
    const formattedDate = noteDate.toLocaleDateString('pt-BR');
    const formattedTime = noteDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const authorName = note.author_name || 'Usuário';
    const authorInitial = authorName.charAt(0).toUpperCase();
    const hasReplies = note.replies && note.replies.length > 0;

    return (
      <div key={note.id} className={`${depth > 0 ? 'ml-10 pl-4 border-l-2 border-slate-200 dark:border-zinc-600' : ''} mb-3`}>
        <div className="flex items-start gap-3 group">
          {/* Avatar do usuário */}
          <div
            className="flex-shrink-0 w-8 h-8 rounded-full border border-slate-200 dark:border-zinc-700 bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-300 font-medium text-sm flex items-center justify-center overflow-hidden"
            style={note.author_avatar ? { backgroundImage: `url(${note.author_avatar})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
            title={authorName}
          >
            {!note.author_avatar && authorInitial}
          </div>
          
          {/* Conteúdo do comentário */}
          <div className="flex-1 min-w-0">
            <div className="bg-white dark:bg-zinc-800 rounded-xl p-3 border border-slate-200 dark:border-zinc-700">
              {/* Cabeçalho com nome e data */}
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">{authorName}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">•</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400" title={`${formattedDate} às ${formattedTime}`}>
                    {formattedDate} {formattedTime}
                  </span>
                </div>
                {canDelete && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteNote(note.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-colors p-1 -mr-1"
                    title="Excluir comentário"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              
              {/* Texto do comentário */}
              <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words">{note.text}</p>
              
              {/* Ações do comentário */}
              <div className="mt-2 flex items-center gap-4">
                <button
                  onClick={() => setReplyingTo(isReplying ? null : note.id)}
                  className="text-xs text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 flex items-center gap-1 transition-colors"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Responder</span>
                </button>
                {hasReplies && (
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    {note.replies?.length} {note.replies?.length === 1 ? 'resposta' : 'respostas'}
                  </span>
                )}
              </div>
            </div>
            
            {/* Formulário de resposta */}
            {isReplying && (
              <div className="mt-3 pl-2">
                <div className="bg-white dark:bg-zinc-800 rounded-xl border border-slate-200 dark:border-zinc-700 overflow-hidden transition-all duration-200">
                  {replyError && (
                    <div className="px-4 py-2 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 text-sm">
                      {replyError}
                    </div>
                  )}
                  <div className="p-3">
                    <textarea
                      value={replyDraft}
                      onChange={(e) => setReplyDraft(e.target.value)}
                      rows={2}
                      className="w-full bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-600 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent transition-colors resize-none"
                      placeholder="Digite sua resposta..."
                    />
                    <div className="flex items-center justify-end gap-2 mt-2">
                      <button
                        onClick={() => setReplyingTo(null)}
                        className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={handleAddReply}
                        disabled={addingReply || !replyDraft.trim()}
                        className="px-4 py-1.5 text-xs font-medium bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {addingReply ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Enviando...</span>
                          </>
                        ) : (
                          <>
                            <SendHorizontal className="w-3.5 h-3.5" />
                            <span>Responder</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Respostas */}
        {hasReplies && (
          <div className="mt-2 pl-11">
            {note.replies?.map((reply) => renderNote(reply, depth + 1))}
          </div>
        )}
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

  const inputClass = "w-full px-4 py-2.5 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all";
  const selectClass = "w-full px-4 py-2.5 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all cursor-pointer";
  const textareaClass = "w-full px-4 py-2.5 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all resize-none min-h-[80px]";
  const labelClass = "block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5";

  const requirementModal = isModalOpen && createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
      <div
        className="aero-backdrop absolute inset-0"
        onClick={handleCloseModal}
        aria-hidden="true"
      />
      <div className="aero-modal relative w-full max-w-3xl max-h-[92vh] rounded-2xl flex flex-col overflow-hidden">
        <div className="h-1.5 w-full bg-orange-500 shrink-0" />

        {/* Header */}
        <div className="aero-modal-inner px-5 sm:px-7 py-4 border-b border-white/30 dark:border-white/10 flex items-start justify-between gap-4 shrink-0">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
              {selectedRequirement ? 'Editar' : 'Novo'}
            </p>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
              {selectedRequirement ? 'Editar Requerimento' : 'Novo Requerimento'}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleCloseModal}
            className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-5 sm:p-7 space-y-5">
            {error && (
              <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            {/* ── Seção: Identificação ── */}
            <div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Protocolo */}
                <label className="flex flex-col">
                  <span className={labelClass}>Protocolo INSS *</span>
                  <input
                    value={formData.protocol}
                    onChange={(e) => handleFormChange('protocol', e.target.value)}
                    className={inputClass}
                    placeholder="NB / Protocolo"
                    required
                  />
                </label>

                {/* Beneficiário */}
                <label className="flex flex-col sm:col-span-2">
                  <span className={labelClass}>Beneficiário *</span>
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
                      placeholder="Nome do beneficiário"
                      required
                    />
                    {clientsLoading && (
                      <Loader2 className="w-4 h-4 text-orange-500 absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin" />
                    )}
                    {showBeneficiarySuggestions && (
                      <div className="absolute mt-1.5 w-full bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl shadow-xl max-h-56 overflow-y-auto z-20">
                        {clientsLoading ? (
                          <div className="px-4 py-3 text-sm text-slate-500">Buscando...</div>
                        ) : clients.length === 0 ? (
                          <div className="px-4 py-3">
                            <p className="text-sm text-slate-500 dark:text-zinc-400 mb-2">Nenhum cliente encontrado.</p>
                            <button
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => openClientModal({ full_name: beneficiarySearchTerm })}
                              className="w-full text-left px-3 py-2.5 bg-orange-50 dark:bg-orange-500/10 hover:bg-orange-100 dark:hover:bg-orange-500/20 border border-orange-200 dark:border-orange-500/30 rounded-xl flex items-center gap-2 text-orange-700 dark:text-orange-400 transition"
                            >
                              <Plus className="w-4 h-4 shrink-0" />
                              <div>
                                <div className="text-sm font-semibold">Adicionar novo cliente</div>
                                <div className="text-xs opacity-70">"{beneficiarySearchTerm}"</div>
                              </div>
                            </button>
                          </div>
                        ) : (
                          clients.map((client) => (
                            <button
                              type="button"
                              key={client.id}
                              className="w-full text-left px-4 py-3 text-sm hover:bg-slate-50 dark:hover:bg-zinc-700/50 transition border-b border-slate-100 dark:border-zinc-700/50 last:border-0"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                handleFormChange('beneficiary', client.full_name);
                                handleFormChange('client_id', client.id);
                                setBeneficiarySearchTerm(client.full_name);
                                if (client.cpf_cnpj) handleFormChange('cpf', formatCPF(client.cpf_cnpj));
                                const phoneValue = client.phone || client.mobile || '';
                                if (phoneValue) handleFormChange('phone', phoneValue);
                                setShowBeneficiarySuggestions(false);
                              }}
                            >
                              <div className="font-semibold text-slate-800 dark:text-white">{client.full_name}</div>
                              <div className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                                {client.cpf_cnpj ? formatCPF(client.cpf_cnpj) : 'CPF não informado'} · {client.email || 'Sem e-mail'}
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </label>

                {/* CPF */}
                <label className="flex flex-col">
                  <span className={labelClass}>CPF *</span>
                  <input
                    value={formData.cpf}
                    onChange={(e) => handleFormChange('cpf', e.target.value)}
                    className={inputClass}
                    placeholder="000.000.000-00"
                    maxLength={14}
                    required
                  />
                </label>
              </div>
            </div>

            {/* ── Seção: Benefício e Status ── */}
            <div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Tipo de Benefício */}
                <label className="flex flex-col sm:col-span-2">
                  <span className={labelClass}>Tipo de Benefício</span>
                  <select
                    value={formData.benefit_type}
                    onChange={(e) => handleFormChange('benefit_type', e.target.value as BenefitType | '')}
                    className={selectClass}
                  >
                    <option value="" disabled>Selecione...</option>
                    {BENEFIT_TYPES.map((type) => (
                      <option key={type.key} value={type.key}>{type.label}</option>
                    ))}
                  </select>
                </label>

                {/* Status */}
                <label className="flex flex-col">
                  <span className={labelClass}>Status</span>
                  <select
                    value={formData.status}
                    onChange={(e) => handleFormChange('status', e.target.value as RequirementStatus)}
                    className={selectClass}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s.key} value={s.key}>{s.label}</option>
                    ))}
                  </select>
                </label>

                {/* Data de Entrada */}
                <label className="flex flex-col">
                  <span className={labelClass}>Data de Entrada</span>
                  <input
                    type="date"
                    value={formData.entry_date}
                    onChange={(e) => handleFormChange('entry_date', e.target.value)}
                    className={inputClass}
                  />
                </label>

                {/* Prazo da Exigência (condicional) */}
                {formData.status === 'em_exigencia' && (
                  <label className="flex flex-col">
                    <span className={labelClass}>Prazo da Exigência</span>
                    <input
                      type="date"
                      value={formData.exigency_due_date}
                      onChange={(e) => handleFormChange('exigency_due_date', e.target.value)}
                      className={inputClass}
                      min={new Date().toISOString().split('T')[0]}
                    />
                  </label>
                )}
              </div>
            </div>

            {/* ── Seção: Contato e Acesso ── */}
            <div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="flex flex-col">
                  <span className={labelClass}>Telefone</span>
                  <input
                    value={formData.phone}
                    onChange={(e) => handleFormChange('phone', e.target.value)}
                    className={inputClass}
                    placeholder="(00) 00000-0000"
                    maxLength={15}
                  />
                </label>
                <label className="flex flex-col">
                  <span className={labelClass}>Senha do INSS</span>
                  <input
                    type="text"
                    value={formData.inss_password}
                    onChange={(e) => handleFormChange('inss_password', e.target.value)}
                    className={inputClass}
                    placeholder="Senha de acesso"
                  />
                </label>
              </div>
            </div>

            {/* ── Seção: Notas ── */}
            <div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="flex flex-col">
                  <span className={labelClass}>Observações</span>
                  <textarea
                    value={formData.observations}
                    onChange={(e) => handleFormChange('observations', e.target.value)}
                    className={textareaClass}
                    placeholder="Observações sobre o requerimento..."
                  />
                </label>
                <label className="flex flex-col">
                  <span className={labelClass}>Notas Internas</span>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => handleFormChange('notes', e.target.value)}
                    className={textareaClass}
                    placeholder="Notas internas do escritório..."
                  />
                </label>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="shrink-0 px-5 sm:px-7 py-4 border-t border-slate-100 dark:border-white/10 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-400 dark:text-zinc-500">* Campos obrigatórios</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCloseModal}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
              >
                Cancelar
              </button>
              <button
                type="submit"
                onClick={handleSubmit}
                disabled={saving}
                className="inline-flex items-center gap-2 px-5 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-xl transition disabled:opacity-60"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  , document.body);

  const exigencyDeadlineModal = exigencyModal && (
    <div className="pericia-light-modal fixed inset-0 z-[95] flex items-center justify-center p-4">
      <div className="absolute inset-0" onClick={handleCloseExigencyModal} aria-hidden="true" />
      <div className="pericia-light-modal__panel relative w-full max-w-lg overflow-hidden rounded-2xl shadow-2xl bg-white dark:bg-zinc-900">
        <div className="h-2 w-full bg-orange-500" />
        <div className="px-6 py-4 border-b border-slate-200 dark:border-zinc-800 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="mt-0.5 h-10 w-10 rounded-xl bg-orange-50 dark:bg-orange-500/10 flex items-center justify-center flex-shrink-0">
              <ClipboardList className="w-5 h-5 text-orange-600 dark:text-orange-400" />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Registrar prazo para exigência</h3>
              <div className="mt-1 space-y-0.5">
                {exigencyModal.beneficiaryName && (
                  <p className="text-sm text-slate-600 dark:text-zinc-300 truncate">
                    Beneficiário: <span className="font-medium">{exigencyModal.beneficiaryName}</span>
                  </p>
                )}
                {exigencyModal.benefitTypeLabel && (
                  <p className="text-xs text-slate-500 dark:text-zinc-400 truncate">Benefício: {exigencyModal.benefitTypeLabel}</p>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCloseExigencyModal}
            className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
            title="Fechar"
            aria-label="Fechar"
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
                min={new Date().toISOString().split('T')[0]}
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

          {members.length > 0 && (
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-2">
                Responsável <span className="text-red-500">*</span>
                {exigencyForm.responsible_id && (
                  <span className="ml-2 text-xs font-normal text-orange-600">
                    {members.find((m) => m.id === exigencyForm.responsible_id)?.name || ''}
                  </span>
                )}
              </label>
              <div className="flex flex-wrap gap-2">
                {members.map((m) => {
                  const isSelected = exigencyForm.responsible_id === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleExigencyFormChange('responsible_id', isSelected ? '' : m.id)}
                      className={`relative flex-shrink-0 rounded-full focus:outline-none transition-all ${
                        isSelected
                          ? 'ring-2 ring-offset-2 ring-orange-500'
                          : 'ring-1 ring-transparent hover:ring-slate-300'
                      }`}
                      title={m.name || m.email || ''}
                    >
                      {m.avatar_url ? (
                        <img src={m.avatar_url} className="w-9 h-9 rounded-full object-cover" alt={m.name || ''} />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-orange-100 flex items-center justify-center text-sm font-semibold text-orange-700">
                          {(m.name || m.email || '?')[0].toUpperCase()}
                        </div>
                      )}
                      {isSelected && (
                        <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-orange-500 rounded-full flex items-center justify-center">
                          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2 6l3 3 5-5" />
                          </svg>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 dark:border-zinc-800 flex items-center justify-end gap-3 bg-slate-50/60 dark:bg-zinc-900">
          <button
            type="button"
            onClick={handleCloseExigencyModal}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleCreateExigencyDeadline}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition disabled:opacity-60"
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
    <div className="pericia-light-modal fixed inset-0 z-[95] flex items-center justify-center p-4">
      <div className="absolute inset-0" onClick={handleClosePericiaModal} aria-hidden="true" />
      <div className="pericia-light-modal__panel relative w-full max-w-lg rounded-2xl shadow-2xl bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="h-2 w-full bg-cyan-500" />
        <div className="px-6 py-4 border-b border-slate-200 dark:border-zinc-800 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="mt-0.5 h-10 w-10 rounded-xl bg-cyan-50 dark:bg-cyan-500/10 flex items-center justify-center flex-shrink-0">
              <Stethoscope className="w-5 h-5 text-cyan-700 dark:text-cyan-300" />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Agendar perícia</h3>
              <div className="mt-1 space-y-0.5">
                {periciaModal.beneficiaryName && (
                  <p className="text-sm text-slate-700 dark:text-zinc-300 truncate">
                    Beneficiário: <span className="font-medium">{periciaModal.beneficiaryName}</span>
                  </p>
                )}
                {periciaModal.benefitTypeLabel && (
                  <p className="text-xs text-slate-600 dark:text-zinc-400 truncate">Benefício: {periciaModal.benefitTypeLabel}</p>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClosePericiaModal}
            className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
            title="Fechar"
            aria-label="Fechar"
          >
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
                  min={new Date().toISOString().split('T')[0]}
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
                  min={new Date().toISOString().split('T')[0]}
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
            Após passar a data da última perícia (médica/social), o requerimento será movido automaticamente para "Em análise".
          </p>

          {members.length > 0 && (
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-zinc-300 block mb-2">
                Responsável <span className="text-red-500">*</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {members.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPericiaResponsibleId(periciaResponsibleId === (m.user_id || m.id) ? '' : (m.user_id || m.id))}
                    className={`relative flex-shrink-0 rounded-full focus:outline-none transition-all ${
                      periciaResponsibleId === (m.user_id || m.id)
                        ? 'ring-2 ring-offset-2 ring-amber-500'
                        : 'ring-1 ring-transparent hover:ring-slate-300'
                    }`}
                    title={m.name || m.email || ''}
                  >
                    {m.avatar_url ? (
                      <img src={m.avatar_url} className="w-9 h-9 rounded-full object-cover" alt={m.name || ''} />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center text-sm font-semibold text-amber-700">
                        {(m.name || m.email || '?')[0].toUpperCase()}
                      </div>
                    )}
                    {periciaResponsibleId === (m.user_id || m.id) && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-amber-500 rounded-full flex items-center justify-center">
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2 6l3 3 5-5"/>
                        </svg>
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 dark:border-zinc-800 flex items-center justify-end gap-3 bg-slate-50/60 dark:bg-zinc-900">
          <button
            type="button"
            onClick={handleClosePericiaModal}
            disabled={periciaSaving}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
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
          
          {/* Header padrão do sistema */}
          <div className="px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                Detalhes do Requerimento
              </p>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">{selectedRequirementForView.beneficiary}</h2>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-slate-600 dark:text-slate-400">
                <span className="font-mono">{selectedRequirementForView.protocol}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2">
                {statusUpdatingId === selectedRequirementForView.id ? (
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${getStatusBadge(selectedRequirementForView.status)}`}>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Atualizando...
                  </span>
                ) : (
                  <div className="relative" title="Alterar status">
                    <select
                      value={selectedRequirementForView.status}
                      onChange={(e) => void handleStatusChange(selectedRequirementForView.id, e.target.value as RequirementStatus)}
                      disabled={!!statusUpdatingId}
                      className={`appearance-none text-xs font-bold pl-2.5 pr-6 py-1 rounded-full cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/40 disabled:opacity-60 transition-all ${getStatusBadge(selectedRequirementForView.status)}`}
                      style={detailStatusConfig?.animationStyle}
                    >
                      {STATUS_OPTIONS.map((opt) => (
                        <option key={opt.key} value={opt.key}>{opt.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 opacity-80" />
                  </div>
                )}
                {showMandadoRisk && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-red-600 text-white animate-pulse">
                    <AlertTriangle className="w-3 h-3" /> MS Risk
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => handlePrintRequirement(selectedRequirementForView)}
                className="p-2 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-xl transition"
                aria-label="Exportar/Imprimir"
                title="Exportar / Imprimir"
              >
                <Printer className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleBackToList}
                className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
                aria-label="Fechar modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Abas de navegação */}
          <div className="px-5 sm:px-6 py-2 bg-white dark:bg-zinc-900 border-b border-slate-200 dark:border-zinc-800 flex items-center gap-1 overflow-x-auto">
            {[
              { key: 'overview', label: 'Visão Geral', icon: ClipboardList },
              { key: 'notes', label: 'Notas', icon: MessageSquare, count: noteThreads.length },
              { key: 'observations', label: 'Observações', icon: NotebookPen },
              { key: 'documents', label: 'Documentos', icon: FileText, count: requirementDocuments.length },
              { key: 'history', label: 'Histórico', icon: History, count: statusHistory.length },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveDetailTab(tab.key as typeof activeDetailTab)}
                className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition whitespace-nowrap ${
                  activeDetailTab === tab.key
                    ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
                {typeof tab.count === 'number' && tab.count > 0 && (
                  <span className={`ml-1 px-1.5 py-0.5 text-xs font-bold rounded-full ${activeDetailTab === tab.key ? 'bg-orange-200 dark:bg-orange-800 text-orange-800 dark:text-orange-200' : 'bg-slate-200 dark:bg-zinc-700 text-slate-600 dark:text-slate-300'}`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Conteúdo das Abas */}
          <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-zinc-950 p-4 sm:p-6">
            {error && (
              <div className="mb-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                {error}
              </div>
            )}

            {/* ABA: VISÃO GERAL */}
            {activeDetailTab === 'overview' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Coluna Esquerda - Informações do Cliente */}
                <div className="space-y-5">
                  <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
                    <div className="px-5 py-4 border-b border-slate-100 dark:border-zinc-800">
                      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Informações do Cliente</h3>
                    </div>
                    <dl className="divide-y divide-slate-100 dark:divide-zinc-800 px-5">
                      <div className="flex items-center justify-between gap-4 py-3">
                        <dt className="text-sm text-slate-500 dark:text-slate-400">Nome</dt>
                        <dd className="text-sm font-semibold text-slate-900 dark:text-white text-right">{selectedRequirementForView.beneficiary}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-4 py-3">
                        <dt className="text-sm text-slate-500 dark:text-slate-400">CPF</dt>
                        <dd className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900 dark:text-white font-mono">{formatCPF(selectedRequirementForView.cpf)}</span>
                          {selectedRequirementForView.cpf && (
                            <button
                              type="button"
                              onClick={() => handleCopyDetailField('cpf', selectedRequirementForView.cpf)}
                              title="Copiar CPF"
                              className="p-1 rounded text-slate-400 hover:text-orange-600 hover:bg-orange-50 transition-colors"
                            >
                              {copiedDetailField === 'cpf' ? <Check className="w-3.5 h-3.5 text-green-500" /> : <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>}
                            </button>
                          )}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-4 py-3">
                        <dt className="text-sm text-slate-500 dark:text-slate-400">Telefone</dt>
                        <dd className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900 dark:text-white">{selectedRequirementForView.phone ? formatPhone(selectedRequirementForView.phone) : '—'}</span>
                          {selectedRequirementForView.phone && (
                            <button
                              type="button"
                              onClick={() => handleWhatsApp(selectedRequirementForView.phone)}
                              title="Abrir no WhatsApp"
                              className="p-1 rounded text-slate-400 hover:text-green-600 hover:bg-green-50 transition-colors"
                            >
                              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current" xmlns="http://www.w3.org/2000/svg">
                                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                              </svg>
                            </button>
                          )}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-4 py-3">
                        <dt className="text-sm text-slate-500 dark:text-slate-400">Benefício</dt>
                        <dd className="text-sm font-semibold text-slate-900 dark:text-white">{getBenefitTypeLabel(selectedRequirementForView.benefit_type) || '—'}</dd>
                      </div>
                    </dl>
                  </div>

                  <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
                    <div className="px-5 py-4 border-b border-slate-100 dark:border-zinc-800 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Processos Vinculados</h3>
                      <span className="text-xs text-slate-400 dark:text-slate-500">Controle rápido</span>
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-zinc-800">
                      <div className="flex items-center justify-between px-5 py-4 gap-3">
                        <div className="flex items-start gap-3">
                          <FolderOpen className="w-4 h-4 text-blue-500 mt-0.5" />
                          <div>
                            <p className="text-sm font-semibold text-slate-900 dark:text-white">Processo Principal</p>
                            <p className="text-xs text-slate-500">{linkedProcesses.principal ? linkedProcesses.principal.process_code || 'Vinculado' : 'Não criado'}</p>
                          </div>
                        </div>
                        {linkedProcesses.principal ? (
                          <button
                            type="button"
                            onClick={() => handleOpenProcessDetails(linkedProcesses.principal!.id)}
                            className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
                          >
                            Abrir
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleCreateProcessFromRequirement('principal')}
                            className="px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition"
                          >
                            Criar
                          </button>
                        )}
                      </div>
                      <div className="flex items-center justify-between px-5 py-4 gap-3">
                        <div className="flex items-start gap-3">
                          <AlertTriangle className="w-4 h-4 text-purple-500 mt-0.5" />
                          <div>
                            <p className="text-sm font-semibold text-slate-900 dark:text-white">Mandado de Segurança</p>
                            <p className="text-xs text-slate-500">{linkedProcesses.ms ? linkedProcesses.ms.process_code || 'Vinculado' : 'Não criado'}</p>
                          </div>
                        </div>
                        {linkedProcesses.ms ? (
                          <button
                            type="button"
                            onClick={() => handleOpenProcessDetails(linkedProcesses.ms!.id)}
                            className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
                          >
                            Abrir
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleCreateProcessFromRequirement('ms')}
                            className="px-3 py-1.5 text-xs font-medium bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition"
                          >
                            Criar MS
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Coluna Direita - Informações do Requerimento */}
                <div className="space-y-5">
                  <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
                    <div className="px-5 py-4 border-b border-slate-100 dark:border-zinc-800">
                      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Informações do Requerimento</h3>
                    </div>
                    <dl className="divide-y divide-slate-100 dark:divide-zinc-800 px-5">
                      <div className="flex items-center justify-between gap-4 py-3">
                        <dt className="text-sm text-slate-500 dark:text-slate-400">Data de Entrada</dt>
                        <dd className="text-sm font-semibold text-slate-900 dark:text-white">
                          {formatDate(selectedRequirementForView.entry_date)}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-4 py-3">
                        <dt className="text-sm text-slate-500 dark:text-slate-400">Senha INSS</dt>
                        <dd className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900 dark:text-white font-mono tracking-widest select-none">
                            {selectedRequirementForView.inss_password
                              ? (showDetailPassword ? selectedRequirementForView.inss_password : '•'.repeat(Math.min(selectedRequirementForView.inss_password.length, 8)))
                              : '—'}
                          </span>
                          {selectedRequirementForView.inss_password && (
                            <>
                              <button
                                type="button"
                                onClick={() => setShowDetailPassword((p) => !p)}
                                title={showDetailPassword ? 'Ocultar senha' : 'Mostrar senha'}
                                className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-zinc-700 transition-colors"
                              >
                                {showDetailPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                              </button>
                              {showDetailPassword && (
                                <button
                                  type="button"
                                  onClick={() => handleCopyDetailField('senha', selectedRequirementForView.inss_password!)}
                                  title="Copiar senha"
                                  className="p-1 rounded text-slate-400 hover:text-orange-600 hover:bg-orange-50 transition-colors"
                                >
                                  {copiedDetailField === 'senha' ? <Check className="w-3.5 h-3.5 text-green-500" /> : <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>}
                                </button>
                              )}
                            </>
                          )}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-4 py-3">
                        <dt className="text-sm text-slate-500 dark:text-slate-400">Protocolo</dt>
                        <dd className="text-sm font-semibold text-slate-900 dark:text-white font-mono">{selectedRequirementForView.protocol}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-4 py-3">
                        <dt className="text-sm text-slate-500 dark:text-slate-400">Benefício</dt>
                        <dd className="text-sm font-semibold text-slate-900 dark:text-white">{getBenefitTypeLabel(selectedRequirementForView.benefit_type)}</dd>
                      </div>
                      {selectedRequirementForView.status === 'em_analise' && typeof analysisDays === 'number' && (
                        <div className="flex items-center justify-between gap-4 py-3">
                          <dt className="text-sm text-slate-500 dark:text-slate-400">Tempo em Análise</dt>
                          <dd className={`text-sm font-semibold ${showMandadoRisk ? 'text-red-600' : 'text-slate-900 dark:text-white'}`}>{analysisDays} dias</dd>
                        </div>
                      )}
                      {selectedRequirementForView.status === 'em_exigencia' && selectedRequirementForView.exigency_due_date && (
                        <div className="flex items-center justify-between gap-4 py-3">
                          <dt className="text-sm text-amber-600 dark:text-amber-400">Prazo Exigência</dt>
                          <dd className="text-sm font-semibold text-amber-700 dark:text-amber-300">{formatDate(selectedRequirementForView.exigency_due_date)}</dd>
                        </div>
                      )}
                    </dl>
                  </div>

                  {(periciaMedicaAt || periciaSocialAt) && (() => {
                    const nowMs = Date.now();
                    const makeCalendarLink = (isoDate: string, label: string) => {
                      const d = new Date(isoDate);
                      if (isNaN(d.getTime())) return null;
                      const pad = (n: number) => String(n).padStart(2, '0');
                      const fmt = (dt: Date) =>
                        `${dt.getUTCFullYear()}${pad(dt.getUTCMonth()+1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}00Z`;
                      const end = new Date(d.getTime() + 60 * 60 * 1000); // +1h
                      const name = selectedRequirementForView.beneficiary ?? 'Beneficiário';
                      const title = encodeURIComponent(`Perícia ${label} — ${name}`);
                      const details = encodeURIComponent(`Protocolo: ${selectedRequirementForView.protocol ?? '—'}`);
                      return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${details}&dates=${fmt(d)}/${fmt(end)}`;
                    };

                    const PericiaRow = ({ label, isoDate }: { label: string; isoDate: string }) => {
                      const d = new Date(isoDate);
                      const isPast = !isNaN(d.getTime()) && d.getTime() < nowMs;
                      const calLink = makeCalendarLink(isoDate, label);
                      return (
                        <div className="flex items-center justify-between gap-3 text-sm py-0.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-slate-500 dark:text-slate-400 shrink-0">{label}</span>
                            {isPast ? (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-500 dark:bg-zinc-700 dark:text-slate-400">
                                Realizada
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-cyan-50 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300">
                                Pendente
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`font-semibold tabular-nums ${isPast ? 'text-slate-400 dark:text-slate-500 line-through' : 'text-cyan-700 dark:text-cyan-300'}`}>
                              {formatDateTime(isoDate)}
                            </span>
                            {calLink && !isPast && (
                              <a
                                href={calLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Adicionar ao Google Agenda"
                                className="p-1 rounded-md text-slate-400 hover:text-cyan-600 hover:bg-cyan-50 dark:hover:bg-cyan-900/30 transition-colors"
                              >
                                <Calendar className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    };

                    return (
                      <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
                        <div className="px-5 py-4 border-b border-slate-100 dark:border-zinc-800">
                          <h3 className="text-sm font-semibold text-cyan-700 dark:text-cyan-300">Perícias</h3>
                        </div>
                        <div className="px-5 py-3 space-y-2">
                          {periciaMedicaAt && <PericiaRow label="Médica" isoDate={periciaMedicaAt} />}
                          {periciaSocialAt && <PericiaRow label="Social" isoDate={periciaSocialAt} />}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* ABA: NOTAS */}
            {activeDetailTab === 'notes' && (
              <div className="space-y-4">
                <div className="bg-white dark:bg-zinc-900 rounded-xl border border-slate-200 dark:border-zinc-800 overflow-hidden">
                  {noteThreads.length === 0 ? (
                    <div className="text-center py-12">
                      <MessageSquare className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                      <p className="text-sm text-slate-500 dark:text-slate-400">Nenhuma nota registrada.</p>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Use o campo abaixo para adicionar a primeira nota.</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-zinc-800 max-h-[400px] overflow-y-auto p-4 space-y-3">
                      {noteThreads.slice().reverse().map((thread) => renderNote(thread))}
                    </div>
                  )}
                </div>

                <div className="bg-white dark:bg-zinc-900 rounded-xl p-4 border border-slate-200 dark:border-zinc-800">
                  {noteError && (
                    <div className="mb-3 text-sm text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 rounded-lg px-3 py-2">
                      {noteError}
                    </div>
                  )}
                  <div className="flex items-start gap-3">
                    <div
                      className="flex-shrink-0 w-9 h-9 rounded-full border border-slate-200 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-slate-200 font-semibold text-sm flex items-center justify-center overflow-hidden"
                      style={user?.user_metadata?.avatar_url ? { backgroundImage: `url(${String(user.user_metadata.avatar_url)})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                    >
                      {!user?.user_metadata?.avatar_url && String(user?.email || 'U').charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <textarea
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleAddNote(); } }}
                        rows={2}
                        className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500/50 transition resize-none"
                        placeholder="Adicione uma nota..."
                      />
                      <div className="mt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() => void handleAddNote()}
                          disabled={addingNote || !noteDraft.trim()}
                          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition disabled:opacity-50"
                        >
                          {addingNote ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendHorizontal className="w-4 h-4" />}
                          Publicar
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ABA: OBSERVAÇÕES */}
            {activeDetailTab === 'observations' && (
              <div className="space-y-4">
                <div className="bg-white dark:bg-zinc-900 rounded-xl p-4 border border-slate-200 dark:border-zinc-800">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                      <NotebookPen className="w-5 h-5 text-orange-600 dark:text-orange-300" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Observações do Requerimento</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Notas internas adicionadas pela equipe</p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-100 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 p-4">
                    <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                      {selectedRequirementForView.observations || 'Nenhuma observação registrada.'}
                    </p>
                  </div>
                </div>

                <div className="bg-white dark:bg-zinc-900 rounded-xl p-4 border border-slate-200 dark:border-zinc-800">
                  <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">Última atualização</p>
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    {selectedRequirementForView.updated_at
                      ? formatDateTime(selectedRequirementForView.updated_at)
                      : '—'}
                  </p>
                </div>
              </div>
            )}

            {/* ABA: DOCUMENTOS */}
            {activeDetailTab === 'documents' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {requirementDocuments.length} documento{requirementDocuments.length !== 1 ? 's' : ''} anexado{requirementDocuments.length !== 1 ? 's' : ''}
                  </p>
                  <button
                    type="button"
                    onClick={handleGenerateMsPdf}
                    disabled={generatingMsPdf}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition disabled:opacity-50"
                  >
                    {generatingMsPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                    Gerar MS (DOCX)
                  </button>
                </div>

                <div className="bg-white dark:bg-zinc-900 rounded-xl border border-slate-200 dark:border-zinc-800 overflow-hidden">
                  {requirementDocumentsLoading ? (
                    <div className="px-4 py-12 text-sm text-slate-500 dark:text-slate-400 flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Carregando documentos...
                    </div>
                  ) : requirementDocuments.length === 0 ? (
                    <div className="text-center py-12">
                      <FileText className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                      <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum documento anexado.</p>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Clique em "Gerar MS" para criar o documento do Mandado de Segurança.</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-zinc-800">
                      {requirementDocuments.map((doc) => (
                        <div key={doc.id} className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-zinc-800/50 transition">
                          <div className="min-w-0 flex items-center gap-3">
                            <div className="w-10 h-10 bg-rose-100 dark:bg-rose-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                              <FileText className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{doc.file_name}</p>
                              <p className="text-xs text-slate-500 dark:text-slate-400">{formatDate(doc.created_at)}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={() => handleDownloadRequirementDocument(doc)} className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition" title="Baixar">
                              <FileDown className="w-4 h-4" />
                            </button>
                            <button type="button" onClick={() => handleDeleteRequirementDocument(doc)} className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition" title="Excluir">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ABA: HISTÓRICO */}
            {activeDetailTab === 'history' && (
              <div className="bg-white dark:bg-zinc-900 rounded-xl border border-slate-200 dark:border-zinc-800 overflow-hidden">
                {statusHistoryLoading ? (
                  <div className="px-4 py-12 text-sm text-slate-500 dark:text-slate-400 flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Carregando histórico...
                  </div>
                ) : statusHistory.length === 0 ? (
                  <div className="text-center py-12">
                    <History className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                    <p className="text-sm text-slate-500 dark:text-slate-400">Nenhuma alteração de status registrada.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-zinc-800 max-h-[400px] overflow-y-auto">
                    {statusHistory.slice(0, 20).map((entry) => {
                      const isEditing = editingHistoryId === entry.id;
                      return (
                      <div key={entry.id} className="px-4 py-3 flex items-start justify-between gap-3 hover:bg-slate-50 dark:hover:bg-zinc-800/50 transition group">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-900 dark:text-white">
                            {getHistoryStatus(entry.from_status)} → {getHistoryStatus(entry.to_status)}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Por: {getHistoryActor(entry.changed_by)}</p>
                          {isEditing ? (
                            <div className="flex items-center gap-2 mt-1.5">
                              <input
                                type="datetime-local"
                                value={editingHistoryDate}
                                onChange={(e) => setEditingHistoryDate(e.target.value)}
                                className="text-xs px-2 py-1 rounded-lg border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                              <button
                                type="button"
                                onClick={() => handleSaveHistoryDate(entry)}
                                disabled={savingHistoryDate}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition disabled:opacity-50"
                              >
                                {savingHistoryDate ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                Salvar
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingHistoryId(null)}
                                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded transition"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <p className="text-xs text-slate-400 dark:text-slate-500">{formatDateTime(entry.changed_at)}</p>
                          )}
                        </div>
                        {!isEditing && (
                          <button
                            type="button"
                            title="Ajustar data manualmente"
                            onClick={() => {
                              setEditingHistoryId(entry.id);
                              setEditingHistoryDate(toDatetimeLocal(entry.changed_at));
                            }}
                            className="opacity-0 group-hover:opacity-100 transition p-1.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg shrink-0 mt-0.5"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      );
                    })}
                    {statusHistory.length > 20 && (
                      <div className="px-4 py-2 text-center text-xs text-slate-500 bg-slate-50 dark:bg-zinc-800">
                        Mostrando 20 de {statusHistory.length} alterações
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer com ações */}
          <div className="px-5 sm:px-6 py-4 bg-white dark:bg-zinc-900 border-t border-slate-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => { handleDeleteRequirement(selectedRequirementForView.id); handleBackToList(); }}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition"
            >
              <Trash2 className="w-4 h-4" />
              Excluir
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => handleWhatsApp(selectedRequirementForView.phone)} className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition">
                <MessageSquare className="w-4 h-4" />
                WhatsApp
              </button>
              {selectedRequirementForView.status !== 'em_analise' && (
                <button type="button" onClick={handleQuickBackToAnalysis} className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 rounded-lg transition">
                  <Clock className="w-4 h-4" />
                  Análise
                </button>
              )}
              <button type="button" onClick={() => openExigencyModal(selectedRequirementForView)} className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition">
                <Calendar className="w-4 h-4" />
                Exigência
              </button>
              <button type="button" onClick={() => openPericiaModal(selectedRequirementForView)} className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-700 rounded-lg transition">
                <Stethoscope className="w-4 h-4" />
                Perícia
              </button>
              <button type="button" onClick={() => handleOpenModal(selectedRequirementForView)} className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition">
                <Edit2 className="w-4 h-4" />
                Editar
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body
    );
  })() : null;

  return (
    <div className="space-y-6 overflow-x-hidden">
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

      {/* ── Painel de controle ─────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        {/* Barra de acento laranja no topo */}
        <div className="h-1 w-full bg-gradient-to-r from-orange-400 via-orange-500 to-amber-400" />

        <div className="p-4 sm:p-5">
          {/* Mobile toggle */}
          <div className="flex items-center justify-between gap-2 mb-3 sm:hidden">
            <button
              type="button"
              onClick={() => setMobileControlsOpen((prev) => !prev)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
              {mobileControlsOpen ? 'Ocultar filtros' : 'Filtros e busca'}
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${mobileControlsOpen ? 'rotate-180' : ''}`} />
            </button>
            <button
              onClick={() => handleOpenModal(undefined)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:from-orange-600 hover:to-orange-700 active:scale-95 transition-all"
            >
              <Plus className="w-3.5 h-3.5" /> Novo
            </button>
          </div>

          <div className={`${mobileControlsOpen ? 'block' : 'hidden'} sm:block space-y-4`}>
            {/* Linha 1: status tabs + botões de ação */}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              {/* Status tabs */}
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <button
                  onClick={() => setActiveStatusTab('todos')}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold leading-none transition-all duration-150 ${
                    activeStatusTab === 'todos'
                      ? 'bg-slate-900 text-white shadow-md shadow-slate-900/20'
                      : 'border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:border-slate-300'
                  }`}
                >
                  <ClipboardList className="h-3 w-3" />
                  Todos
                  <span className={`inline-flex items-center justify-center rounded-full text-[10px] font-black px-1.5 min-w-[1.25rem] h-4 ${
                    activeStatusTab === 'todos' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
                  }`}>{statusCounts.todos}</span>
                </button>
                {STATUS_OPTIONS.map((status) => (
                  <button
                    key={status.key}
                    onClick={() => setActiveStatusTab(status.key)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold leading-none transition-all duration-150 ${
                      activeStatusTab === status.key
                        ? `${status.badge} shadow-md`
                        : 'border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:border-slate-300'
                    }`}
                  >
                    {status.icon && <status.icon className="h-3 w-3" />}
                    <span className="whitespace-nowrap hidden sm:inline">{status.label.replace('Aguardando ', '')}</span>
                    <span className="whitespace-nowrap sm:hidden">{status.label.split(' ')[0]}</span>
                    {statusCounts[status.key] > 0 && (
                      <span className={`inline-flex items-center justify-center rounded-full text-[10px] font-black px-1.5 min-w-[1.25rem] h-4 ${
                        activeStatusTab === status.key ? 'bg-white/25 text-white' : 'bg-slate-200 text-slate-700'
                      }`}>{statusCounts[status.key]}</span>
                    )}
                  </button>
                ))}
              </div>

              {/* Botões de ação */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleExportExcel}
                  disabled={exportingExcel}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 hover:border-emerald-300 disabled:opacity-50 transition-all"
                >
                  {exportingExcel ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileSpreadsheet className="h-3 w-3" />}
                  Excel
                </button>
                <button
                  type="button"
                  onClick={handleOpenMsTemplateModal}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 hover:border-amber-300 transition-all"
                  title="Gerenciar modelo Word (DOCX) para o MS"
                >
                  <Settings className="h-3 w-3" />
                  <span className="hidden sm:inline">Gerenciar MS</span>
                  <span className="sm:hidden">MS</span>
                </button>
                <button
                  onClick={() => handleOpenModal(undefined)}
                  className="hidden sm:inline-flex h-8 items-center gap-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 px-3 text-[11px] font-bold text-white shadow-sm hover:from-orange-600 hover:to-orange-700 active:scale-95 transition-all"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Novo Requerimento
                </button>
              </div>
            </div>

            {/* Linha 2: busca */}
            <div className="relative group">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                <Search className="w-4 h-4 text-slate-400 group-focus-within:text-orange-500 transition-colors" />
              </div>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por beneficiário, protocolo ou CPF..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-10 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-400/40 focus:border-orange-400 focus:bg-white transition-all"
              />
              {searchTerm ? (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-all"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : null}
            </div>

            {/* Linha 3: filtros avançados */}
            <div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowFilters((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-orange-600 transition-colors"
                >
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${showFilters ? 'rotate-180' : ''}`} />
                  {showFilters ? 'Ocultar filtros' : 'Filtros avançados'}
                  {activeFilterCount > 0 && (
                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 text-white text-[9px] font-black">
                      {activeFilterCount}
                    </span>
                  )}
                </button>
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAllFilters}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-orange-600 hover:text-orange-800 transition-colors"
                  >
                    <X className="w-3 h-3" /> Limpar filtros
                  </button>
                )}
              </div>

              {showFilters && (
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 animate-in slide-in-from-top-1 duration-150">
                  {[
                    { value: filterProtocol, onChange: (v: string) => setFilterProtocol(v), placeholder: 'Protocolo' },
                    { value: filterBeneficiary, onChange: (v: string) => setFilterBeneficiary(v), placeholder: 'Beneficiário' },
                    { value: filterCPF, onChange: (v: string) => setFilterCPF(v), placeholder: 'CPF' },
                  ].map(({ value, onChange, placeholder }) => (
                    <div key={placeholder} className="relative">
                      <Search className="absolute left-2.5 top-1/2 w-3 h-3 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-7 pr-3 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-400/40 focus:border-orange-400 transition-all"
                        placeholder={placeholder}
                      />
                    </div>
                  ))}
                  <select
                    value={filterBenefitType}
                    onChange={(e) => setFilterBenefitType(e.target.value as BenefitType | '')}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-400/40 focus:border-orange-400 transition-all"
                  >
                    <option value="">Todos os tipos</option>
                    {BENEFIT_TYPES.map((type) => (
                      <option key={type.key} value={type.key}>{type.label}</option>
                    ))}
                  </select>
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 cursor-pointer hover:border-orange-300 transition-all">
                    <input
                      type="checkbox"
                      checked={filterOnlyMsRisk}
                      onChange={(e) => setFilterOnlyMsRisk(e.target.checked)}
                      className="accent-orange-500 w-3.5 h-3.5"
                    />
                    Somente risco MS (90+ dias)
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 cursor-pointer hover:border-orange-300 transition-all">
                    <input
                      type="checkbox"
                      checked={filterNoPhone}
                      onChange={(e) => setFilterNoPhone(e.target.checked)}
                      className="accent-orange-500 w-3.5 h-3.5"
                    />
                    Sem telefone
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 cursor-pointer hover:border-orange-300 transition-all">
                    <input
                      type="checkbox"
                      checked={filterNoCpf}
                      onChange={(e) => setFilterNoCpf(e.target.checked)}
                      className="accent-orange-500 w-3.5 h-3.5"
                    />
                    Sem CPF
                  </label>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* ── Bulk action toolbar ──────────────────────────────────────── */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-orange-200 bg-orange-50 shadow-sm animate-in slide-in-from-top-1 duration-150">
          <span className="text-sm font-bold text-orange-700">{selectedIds.size} selecionado(s)</span>
          <div className="flex items-center gap-2 ml-auto">
            <select
              onChange={(e) => { if (e.target.value) void handleBulkStatusChange(e.target.value as RequirementStatus); e.target.value = ''; }}
              disabled={isBulkActioning}
              defaultValue=""
              className="rounded-xl border border-orange-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-400/40 disabled:opacity-50 transition-all"
            >
              <option value="" disabled>Alterar status para…</option>
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>{opt.label}</option>
              ))}
            </select>
            <button
              onClick={() => void handleBulkArchive()}
              disabled={isBulkActioning}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50 transition-all"
            >
              {isBulkActioning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />}
              Arquivar
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-white transition-all"
              title="Cancelar seleção"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Results counter + scroll anchor */}
      <div ref={listRef} className="flex items-center justify-between gap-2 px-1">
        {!loading && (
          <p className="text-[11px] text-slate-400 font-medium">
            {filteredRequirements.length === activeRequirements.length
              ? <span>{activeRequirements.length} requerimento{activeRequirements.length !== 1 ? 's' : ''}</span>
              : <span><span className="text-orange-600 font-bold">{filteredRequirements.length}</span> de {activeRequirements.length} requerimento{activeRequirements.length !== 1 ? 's' : ''}</span>
            }
          </p>
        )}
      </div>

      {loading ? (
        /* Skeleton loader */
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <div className="h-1 w-full bg-gradient-to-r from-orange-400 via-orange-500 to-amber-400 animate-pulse" />
          <div className="divide-y divide-slate-100">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-4 animate-pulse">
                <div className="w-24 h-4 bg-slate-200 rounded-full" style={{ opacity: 1 - i * 0.15 }} />
                <div className="flex-1 h-4 bg-slate-100 rounded-full" />
                <div className="w-28 h-6 bg-slate-200 rounded-full" />
                <div className="w-20 h-4 bg-slate-100 rounded-full" />
                <div className="flex gap-2">
                  {[...Array(4)].map((_, j) => <div key={j} className="w-7 h-7 bg-slate-100 rounded-lg" />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : filteredRequirements.length === 0 ? (
        /* Empty state */
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-16 flex flex-col items-center gap-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center">
            <ClipboardList className="w-8 h-8 text-slate-400" />
          </div>
          <div>
            <p className="text-base font-semibold text-slate-700">Nenhum requerimento encontrado</p>
            <p className="text-sm text-slate-400 mt-1">
              {searchTerm ? `Sem resultados para "${searchTerm}"` : 'Crie o primeiro requerimento usando o botão acima'}
            </p>
          </div>
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition"
            >
              <X className="w-4 h-4" /> Limpar busca
            </button>
          )}
        </div>
      ) : (
        <React.Fragment>
        {/* ── Desktop: Tabela ─────────────────────────────────────────────── */}
        <div className="hidden lg:block rounded-2xl border border-slate-200/80 bg-white overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] divide-y divide-slate-100">
              <thead>
                <tr className="bg-gradient-to-r from-slate-50 to-slate-50/60">
                  <th className="pl-4 pr-2 py-3.5">
                    <input
                      type="checkbox"
                      checked={paginatedRequirements.length > 0 && selectedIds.size === paginatedRequirements.length}
                      onChange={handleSelectAll}
                      className="accent-orange-500 w-3.5 h-3.5 cursor-pointer"
                      title="Selecionar todos"
                    />
                  </th>
                  <th className="px-5 py-3.5 text-left text-[10px] font-bold text-slate-500 uppercase tracking-widest">Protocolo</th>
                  <th className="px-5 py-3.5 text-left text-[10px] font-bold text-slate-500 uppercase tracking-widest">Beneficiário</th>
                  <th className="px-5 py-3.5 text-left text-[10px] font-bold text-slate-500 uppercase tracking-widest">CPF</th>
                  <th className="px-5 py-3.5 text-left text-[10px] font-bold text-slate-500 uppercase tracking-widest">Benefício</th>
                  <th className="px-5 py-3.5 text-left text-[10px] font-bold text-slate-500 uppercase tracking-widest">Status</th>
                  <th className="px-5 py-3.5 text-left text-[10px] font-bold text-slate-500 uppercase tracking-widest">Entrada</th>
                  <th className="px-5 py-3.5 text-right text-[10px] font-bold text-slate-500 uppercase tracking-widest">Ações</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100">
                {paginatedRequirements.map((requirement) => {
                  const isUpdating = statusUpdatingId === requirement.id;
                  const statusConfig = getStatusConfig(requirement.status);
                  const periciaNextAt = requirement.status === 'aguardando_pericia' ? getPericiaNextAt(requirement) : null;
                  const analysisDays = requirement.status === 'em_analise' ? getAnalysisDays(requirement) : null;
                  const msJaCriado = requirementsWithMs.has(requirement.id);
                  const showMandadoRisk = isMandadoRisk(requirement) && !msJaCriado;
                  const analysisLevel = getAnalysisAlertLevel(typeof analysisDays === 'number' ? analysisDays : null);

                  // Cor da borda esquerda por status
                  const rowAccent =
                    requirement.status === 'em_exigencia'    ? 'border-l-[3px] border-l-amber-500'  :
                    requirement.status === 'em_analise'      ? 'border-l-[3px] border-l-blue-500'   :
                    requirement.status === 'aguardando_pericia' ? 'border-l-[3px] border-l-cyan-500':
                    requirement.status === 'aguardando_confeccao' ? 'border-l-[3px] border-l-indigo-400' :
                    requirement.status === 'deferido'        ? 'border-l-[3px] border-l-green-500'  :
                    requirement.status === 'indeferido'      ? 'border-l-[3px] border-l-red-500'    :
                    requirement.status === 'ajuizado'        ? 'border-l-[3px] border-l-slate-500'  : '';

                  const exigencyDaysLeft = getExigencyDaysLeft(requirement);
                  const exigencyUrgency = getExigencyUrgency(exigencyDaysLeft);
                  const inssCountdown = getInssCountdown(requirement);

                  return (
                    <tr
                      key={requirement.id}
                      className={`group hover:bg-orange-50/40 transition-colors duration-100 ${rowAccent} ${selectedIds.has(requirement.id) ? 'bg-orange-50/30' : ''}`}
                    >
                      {/* Checkbox */}
                      <td className="pl-4 pr-2 py-4">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(requirement.id)}
                          onChange={() => toggleSelectId(requirement.id)}
                          className="accent-orange-500 w-3.5 h-3.5 cursor-pointer"
                        />
                      </td>

                      {/* Protocolo */}
                      <td className="px-5 py-4 whitespace-nowrap">
                        <span className="font-mono text-xs font-semibold text-slate-700 bg-slate-100 group-hover:bg-orange-100/60 px-2 py-1 rounded-md transition-colors">
                          {requirement.protocol || '—'}
                        </span>
                      </td>

                      {/* Beneficiário */}
                      <td className="px-5 py-4 max-w-[200px]">
                        <p className="text-sm font-semibold text-slate-800 truncate">{requirement.beneficiary}</p>
                      </td>

                      {/* CPF */}
                      <td className="px-5 py-4 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleCopyCpf(requirement.id, requirement.cpf)}
                          title="Copiar CPF"
                          className="group/cpf inline-flex items-center gap-1 font-mono text-xs text-slate-500 hover:text-orange-600 transition-colors"
                        >
                          {requirement.cpf}
                          <span className={`transition-all ${copiedCpfId === requirement.id ? 'text-green-500 opacity-100' : 'opacity-0 group-hover/cpf:opacity-60'}`}>
                            {copiedCpfId === requirement.id
                              ? <Check className="w-3 h-3" />
                              : <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                            }
                          </span>
                        </button>
                      </td>

                      {/* Benefício */}
                      <td className="px-5 py-4">
                        <span className="text-xs text-slate-600">{getBenefitTypeLabel(requirement.benefit_type)}</span>
                      </td>

                      {/* Status */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          {statusConfig?.icon && (
                            <statusConfig.icon className={`w-3.5 h-3.5 shrink-0 ${
                              statusConfig.key === 'em_exigencia'       ? 'text-amber-500 animate-pulse'  :
                              statusConfig.key === 'aguardando_pericia' ? 'text-cyan-500 animate-bounce'  :
                              statusConfig.key === 'aguardando_confeccao' ? 'text-indigo-400 animate-pulse':
                              statusConfig.key === 'deferido'           ? 'text-green-500'                :
                              'text-slate-500'
                            }`} />
                          )}
                          <select
                            value={requirement.status}
                            onChange={(e) => handleStatusChange(requirement.id, e.target.value as RequirementStatus)}
                            disabled={isUpdating}
                            className={`text-xs font-bold px-2.5 py-1 rounded-full border-0 ring-1 ring-inset ring-white/30 shadow-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:opacity-60 transition-all ${
                              statusConfig?.badge ?? 'bg-slate-200 text-slate-700'
                            }`}
                          >
                            {STATUS_OPTIONS.map((opt) => (
                              <option key={opt.key} value={opt.key}>{opt.label}</option>
                            ))}
                          </select>
                          {isUpdating && <Loader2 className="w-3.5 h-3.5 text-orange-500 animate-spin" />}
                        </div>

                        {/* Sub-info de status */}
                        {requirement.status === 'em_exigencia' && (
                          <div className="mt-1.5 flex flex-col gap-0.5">
                            <p className="text-amber-600 text-[11px] font-semibold flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              Prazo: {requirement.exigency_due_date ? formatDate(requirement.exigency_due_date) : 'não definido'}
                            </p>
                            {exigencyUrgency && exigencyUrgency !== 'ok' && (
                              <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                exigencyUrgency === 'overdue' ? 'bg-red-100 text-red-800 border border-red-300' :
                                exigencyUrgency === 'critical' ? 'bg-red-50 text-red-700 border border-red-200' :
                                'bg-amber-50 text-amber-700 border border-amber-200'
                              }`}>
                                <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
                                {exigencyUrgency === 'overdue' ? `Vencido há ${Math.abs(exigencyDaysLeft!)}d` :
                                 exigencyUrgency === 'critical' ? `Vence em ${exigencyDaysLeft}d` :
                                 `${exigencyDaysLeft} dias`}
                              </span>
                            )}
                          </div>
                        )}
                        {requirement.status === 'aguardando_pericia' && periciaNextAt && (
                          <p className="text-cyan-700 text-[11px] font-semibold mt-1.5 flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {formatDateTime(periciaNextAt)}
                          </p>
                        )}
                        {requirement.status === 'em_analise' && typeof analysisDays === 'number' && (
                          <div className="mt-1.5">
                            {analysisLevel === 'critical' ? (
                              <div className="inline-flex items-center gap-1 bg-red-50 border border-red-200 text-red-700 text-[11px] font-semibold px-2 py-0.5 rounded-full">
                                <AlertTriangle className="w-3 h-3 shrink-0" />
                                {showMandadoRisk ? `Risco MS — ${analysisDays}d` : `${analysisDays}d em análise`}
                              </div>
                            ) : analysisLevel === 'high' ? (
                              <div className="inline-flex items-center gap-1 bg-orange-50 border border-orange-200 text-orange-700 text-[11px] font-semibold px-2 py-0.5 rounded-full">
                                <AlertTriangle className="w-3 h-3 shrink-0" />
                                {analysisDays}d em análise
                              </div>
                            ) : (
                              /* < 60d: contador simples, sem badge */
                              <span className="text-[11px] text-slate-400">{analysisDays}d em análise</span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Data de entrada */}
                      <td className="px-5 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-slate-600">{formatDate(requirement.entry_date)}</span>
                          {msJaCriado && (() => {
                            const msData = requirementsMsMap.get(requirement.id);
                            const hasCode = !!(msData?.process_code);
                            const court = msData?.djenOrgao || (msData?.court && msData.court !== 'Mandado de Segurança' ? msData.court : null);
                            return (
                              <div className="relative group/msbadge">
                                {/* Badge */}
                                <span className="relative inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-purple-600 text-white border border-purple-700 shadow-sm shadow-purple-400/40 cursor-default select-none">
                                  <Scale className="w-2.5 h-2.5 shrink-0" />
                                  MS
                                  <span className="relative flex h-1.5 w-1.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
                                  </span>
                                </span>
                                {/* Tooltip: pt-2 cria ponte invisível entre badge e painel */}
                                <div className="absolute top-full left-1/2 -translate-x-1/2 pt-2 w-64 z-[200]
                                                pointer-events-none group-hover/msbadge:pointer-events-auto
                                                opacity-0 group-hover/msbadge:opacity-100
                                                transition-all duration-150 scale-95 group-hover/msbadge:scale-100">
                                  <div className="flex justify-center mb-0">
                                    <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[6px] border-b-slate-900" />
                                  </div>
                                  <div className="rounded-xl bg-slate-900 px-3.5 py-3 shadow-2xl shadow-black/30 text-left">
                                    <p className="text-[10px] font-extrabold uppercase tracking-widest text-purple-400 mb-2 flex items-center gap-1.5">
                                      <Scale className="w-3 h-3" /> Mandado de Segurança
                                    </p>
                                    {/* Número + copiar */}
                                    <div className="flex items-center justify-between gap-2">
                                      {hasCode ? (
                                        <p className="font-mono text-xs font-semibold text-white leading-snug flex-1 break-all">{msData!.process_code}</p>
                                      ) : (
                                        <p className="text-xs text-slate-400 italic flex-1">Número não cadastrado</p>
                                      )}
                                      {hasCode && (
                                        <button
                                          type="button"
                                          onClick={() => navigator.clipboard.writeText(msData!.process_code)}
                                          className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                                          title="Copiar número"
                                        >
                                          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                                          </svg>
                                        </button>
                                      )}
                                    </div>
                                    {/* Vara */}
                                    <div className="mt-2 pt-2 border-t border-white/10">
                                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-0.5">Tramitando em</p>
                                      {court ? (
                                        <p className="text-[11px] text-slate-300 flex items-center gap-1">
                                          <Scale className="w-3 h-3 text-slate-500 shrink-0" />{court}
                                        </p>
                                      ) : (
                                        <p className="text-[11px] text-slate-500 italic">Vara não informada no processo</p>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                          {requirement.status === 'indeferido' && requirementsWithProcess.has(requirement.id) && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                              <FileText className="w-2.5 h-2.5" />Proc.
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Ações */}
                      <td className="px-5 py-4 whitespace-nowrap">
                        <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => handleViewRequirement(requirement)} title="Detalhes" className="p-1.5 rounded-lg text-slate-500 hover:bg-orange-50 hover:text-orange-600 transition-all">
                            <Eye className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleOpenModal(requirement)} title="Editar" className="p-1.5 rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600 transition-all">
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleArchiveRequirement(requirement.id, true)}
                            disabled={archivingId === requirement.id}
                            title="Arquivar"
                            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-all disabled:opacity-40"
                          >
                            {archivingId === requirement.id
                              ? <Loader2 className="w-4 h-4 animate-spin" />
                              : <Archive className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => handleDeleteRequirement(requirement.id)}
                            title="Excluir"
                            className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
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

        {/* ── Mobile: Cards ──────────────────────────────────────────────── */}
        <div className="lg:hidden space-y-2.5">
          {paginatedRequirements.map((requirement) => {
            const isUpdating = statusUpdatingId === requirement.id;
            const statusConfig = getStatusConfig(requirement.status);
            const periciaNextAt = requirement.status === 'aguardando_pericia' ? getPericiaNextAt(requirement) : null;
            const analysisDays = requirement.status === 'em_analise' ? getAnalysisDays(requirement) : null;
            const msJaCriado = requirementsWithMs.has(requirement.id);
            const showMandadoRisk = isMandadoRisk(requirement) && !msJaCriado;
            const analysisLevel = getAnalysisAlertLevel(typeof analysisDays === 'number' ? analysisDays : null);
            const cardExigencyDaysLeft = getExigencyDaysLeft(requirement);
            const cardExigencyUrgency = getExigencyUrgency(cardExigencyDaysLeft);
            const cardInssCountdown = getInssCountdown(requirement);
            const isCardSelected = selectedIds.has(requirement.id);

            const cardAccentColor =
              requirement.status === 'em_exigencia'       ? 'bg-amber-500'  :
              requirement.status === 'em_analise'         ? 'bg-blue-500'   :
              requirement.status === 'aguardando_pericia' ? 'bg-cyan-500'   :
              requirement.status === 'aguardando_confeccao' ? 'bg-indigo-400':
              requirement.status === 'deferido'           ? 'bg-green-500'  :
              requirement.status === 'indeferido'         ? 'bg-red-500'    :
              'bg-slate-500';

            return (
              <div
                key={requirement.id}
                className={`bg-white border rounded-2xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 ${isCardSelected ? 'border-orange-300 ring-1 ring-orange-200' : 'border-slate-200'}`}
              >
                {/* Barra de acento no topo */}
                <div className={`h-1 w-full rounded-t-2xl ${cardAccentColor}`} />

                <div className="p-4 space-y-3">
                  {/* Cabeçalho */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      <input
                        type="checkbox"
                        checked={isCardSelected}
                        onChange={() => toggleSelectId(requirement.id)}
                        className="accent-orange-500 w-4 h-4 cursor-pointer mt-0.5 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-900 truncate leading-tight">{requirement.beneficiary}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[11px] text-slate-400 font-mono">{requirement.protocol || 'Sem protocolo'}</span>
                        {msJaCriado && (() => {
                          const msData = requirementsMsMap.get(requirement.id);
                          const hasCode = !!(msData?.process_code);
                          const court = msData?.court && msData.court !== 'Mandado de Segurança' ? msData.court : null;
                          return (
                            <div className="relative group/msbadge-m">
                              <span className="relative inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-purple-600 text-white border border-purple-700 shadow-sm shadow-purple-400/40 cursor-default select-none">
                                <Scale className="w-2.5 h-2.5 shrink-0" />
                                MS
                                <span className="relative flex h-1.5 w-1.5">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
                                </span>
                              </span>
                              {/* pt-2 = invisible bridge to keep hover alive when moving to tooltip */}
                              <div className="absolute top-full left-0 pt-2 w-64 z-[200]
                                              pointer-events-none group-hover/msbadge-m:pointer-events-auto
                                              opacity-0 group-hover/msbadge-m:opacity-100
                                              transition-all duration-150 scale-95 group-hover/msbadge-m:scale-100">
                                <div className="flex ml-3">
                                  <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[6px] border-b-slate-900" />
                                </div>
                                <div className="rounded-xl bg-slate-900 px-3.5 py-3 shadow-2xl shadow-black/30 text-left">
                                  <p className="text-[10px] font-extrabold uppercase tracking-widest text-purple-400 mb-2 flex items-center gap-1.5">
                                    <Scale className="w-3 h-3" /> Mandado de Segurança
                                  </p>
                                  <div className="flex items-center justify-between gap-2">
                                    {hasCode ? (
                                      <p className="font-mono text-xs font-semibold text-white leading-snug flex-1 break-all">{msData!.process_code}</p>
                                    ) : (
                                      <p className="text-xs text-slate-400 italic flex-1">Número não cadastrado</p>
                                    )}
                                    {hasCode && (
                                      <button type="button" onClick={() => navigator.clipboard.writeText(msData!.process_code)}
                                        className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors" title="Copiar número">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                          <rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                                        </svg>
                                      </button>
                                    )}
                                  </div>
                                  <div className="mt-2 pt-2 border-t border-white/10">
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-0.5">Tramitando em</p>
                                    {court ? (
                                      <p className="text-[11px] text-slate-300 flex items-center gap-1">
                                        <Scale className="w-3 h-3 text-slate-500 shrink-0" />{court}
                                      </p>
                                    ) : (
                                      <p className="text-[11px] text-slate-500 italic">Vara não informada no processo</p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                        {requirement.status === 'indeferido' && requirementsWithProcess.has(requirement.id) && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                            <FileText className="w-2.5 h-2.5" />Proc.
                          </span>
                        )}
                      </div>
                    </div>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0 ${statusConfig?.badge ?? 'bg-slate-200 text-slate-700'}`}>
                      {statusConfig?.icon && <statusConfig.icon className="w-3 h-3" />}
                      {getStatusLabel(requirement.status)}
                      {isUpdating && <Loader2 className="w-3 h-3 animate-spin" />}
                    </span>
                  </div>

                  {/* Infos */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400 font-medium">CPF</span>
                      <button
                        type="button"
                        onClick={() => handleCopyCpf(requirement.id, requirement.cpf)}
                        className="inline-flex items-center gap-1 text-slate-600 font-mono hover:text-orange-600 transition-colors"
                        title="Copiar CPF"
                      >
                        {requirement.cpf}
                        <span className={copiedCpfId === requirement.id ? 'text-green-500' : 'text-slate-300'}>
                          {copiedCpfId === requirement.id ? <Check className="w-2.5 h-2.5" /> : <svg xmlns="http://www.w3.org/2000/svg" className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>}
                        </span>
                      </button>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400 font-medium">Entrada</span>
                      <span className="text-slate-600">{formatDate(requirement.entry_date)}</span>
                    </div>
                    <div className="col-span-2 flex items-center gap-1">
                      <span className="text-slate-400 font-medium">Benefício</span>
                      <span className="text-slate-600 truncate">{getBenefitTypeLabel(requirement.benefit_type)}</span>
                    </div>
                  </div>

                  {/* Alertas de status */}
                  {requirement.status === 'em_exigencia' && (
                    <div className="space-y-1">
                      <div className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-xl border ${
                        cardExigencyUrgency === 'overdue' ? 'bg-red-100 border-red-300 text-red-800' :
                        cardExigencyUrgency === 'critical' ? 'bg-red-50 border-red-200 text-red-700' :
                        cardExigencyUrgency === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-700' :
                        'bg-amber-50 border-amber-200 text-amber-700'
                      }`}>
                        <Clock className="w-3.5 h-3.5 shrink-0" />
                        Prazo: {requirement.exigency_due_date ? formatDate(requirement.exigency_due_date) : 'não definido'}
                        {cardExigencyUrgency && cardExigencyUrgency !== 'ok' && cardExigencyDaysLeft !== null && (
                          <span className="ml-auto font-bold text-[10px]">
                            {cardExigencyUrgency === 'overdue' ? `Vencido há ${Math.abs(cardExigencyDaysLeft)}d` :
                             `Vence em ${cardExigencyDaysLeft}d`}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  {requirement.status === 'aguardando_pericia' && periciaNextAt && (
                    <div className="flex items-center gap-1.5 bg-cyan-50 border border-cyan-200 text-cyan-700 text-[11px] font-semibold px-3 py-1.5 rounded-xl">
                      <Calendar className="w-3.5 h-3.5 shrink-0" />
                      Perícia: {formatDateTime(periciaNextAt)}
                    </div>
                  )}
                  {requirement.status === 'em_analise' && typeof analysisDays === 'number' && (
                    analysisLevel === 'critical' || analysisLevel === 'high' ? (
                      <div className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-xl border ${
                        analysisLevel === 'critical' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-orange-50 border-orange-200 text-orange-700'
                      }`}>
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        {analysisLevel === 'critical' && showMandadoRisk ? `Risco MS — ${analysisDays}d` : `${analysisDays}d em análise`}
                      </div>
                    ) : (
                      /* < 60d: contador simples, sem badge */
                      <span className="text-[11px] text-slate-400">{analysisDays}d em análise</span>
                    )
                  )}

                  {/* Rodapé: select + ações */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 gap-2">
                    <select
                      value={requirement.status}
                      onChange={(e) => handleStatusChange(requirement.id, e.target.value as RequirementStatus)}
                      disabled={isUpdating}
                      className="text-xs font-semibold px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-orange-400/40 focus:border-orange-400 disabled:opacity-50 transition-all"
                    >
                      {STATUS_OPTIONS.map((opt) => (
                        <option key={opt.key} value={opt.key}>{opt.label}</option>
                      ))}
                    </select>

                    <div className="flex items-center gap-1">
                      <button onClick={() => handleViewRequirement(requirement)} title="Detalhes" className="p-1.5 rounded-lg text-slate-500 hover:bg-orange-50 hover:text-orange-600 transition-all">
                        <Eye className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleOpenModal(requirement)} title="Editar" className="p-1.5 rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600 transition-all">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleArchiveRequirement(requirement.id, true)}
                        disabled={archivingId === requirement.id}
                        title="Arquivar"
                        className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-all disabled:opacity-40"
                      >
                        {archivingId === requirement.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => handleDeleteRequirement(requirement.id)}
                        title="Excluir"
                        className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        </React.Fragment>
      )}

      {filteredRequirements.length > pageSize && (
        <div className="flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-sm">
          <button
            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
            disabled={currentPage === 1}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95"
          >
            ← <span className="hidden sm:inline">Anterior</span>
          </button>
          <div className="flex items-center gap-1.5">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                onClick={() => setCurrentPage(page)}
                className={`w-7 h-7 rounded-lg text-xs font-bold transition-all ${
                  page === currentPage
                    ? 'bg-orange-500 text-white shadow-md shadow-orange-500/30 scale-110'
                    : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                {page}
              </button>
            ))}
          </div>
          <button
            onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={currentPage === totalPages}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95"
          >
            <span className="hidden sm:inline">Próxima</span> →
          </button>
        </div>
      )}

      {/* ── Seção Arquivados ──────────────────────────────────────────────── */}
      {archivedRequirements.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setArchivedExpanded((prev) => !prev)}
            className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition text-left"
          >
            <Archive className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="text-sm font-semibold text-slate-500">Arquivados</span>
            <span className={`inline-flex items-center justify-center min-w-[1.4rem] h-5 px-1.5 rounded-full text-xs font-bold ${
              searchTerm && filteredArchivedReqs.length > 0
                ? 'bg-orange-100 text-orange-700'
                : 'bg-slate-200 text-slate-600'
            }`}>
              {searchTerm ? filteredArchivedReqs.length : archivedRequirements.length}
            </span>
            {searchTerm && filteredArchivedReqs.length > 0 && (
              <span className="text-xs text-orange-600 font-medium">encontrado na busca</span>
            )}
            <ChevronDown
              className={`w-4 h-4 text-slate-400 ml-auto shrink-0 transition-transform duration-200 ${archivedExpanded ? 'rotate-180' : ''}`}
            />
          </button>

          {archivedExpanded && (
            <div className="border-t border-slate-100">
              {filteredArchivedReqs.length === 0 ? (
                <p className="text-center text-sm text-slate-400 py-8">
                  {searchTerm ? 'Nenhum arquivado corresponde à busca.' : 'Nenhum requerimento arquivado.'}
                </p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {filteredArchivedReqs.map((req) => {
                    const statusConfig = getStatusConfig(req.status);
                    return (
                      <div
                        key={req.id}
                        className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50/60 transition"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-slate-600 truncate">{req.beneficiary}</p>
                            <span className="text-xs text-slate-400 font-mono">{req.protocol || '—'}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold opacity-75 ${statusConfig?.badge ?? 'bg-slate-200 text-slate-600'}`}
                            >
                              {getStatusLabel(req.status)}
                            </span>
                            <span className="text-xs text-slate-400">{getBenefitTypeLabel(req.benefit_type)}</span>
                            {req.entry_date && (
                              <span className="text-xs text-slate-400">Entrada: {formatDate(req.entry_date)}</span>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleViewRequirement(req)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 border border-slate-200 hover:border-slate-300 hover:text-slate-700 hover:bg-slate-50 transition"
                            title="Ver detalhes"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            Detalhes
                          </button>
                          <button
                            type="button"
                            onClick={() => handleArchiveRequirement(req.id, false)}
                            disabled={archivingId === req.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 border border-slate-200 hover:border-orange-300 hover:text-orange-700 hover:bg-orange-50 transition disabled:opacity-50"
                            title="Restaurar"
                          >
                            {archivingId === req.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <ArchiveRestore className="w-3.5 h-3.5" />
                            )}
                            Restaurar
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
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
                  <button
                    type="button"
                    onClick={handleDownloadMsTemplate}
                    disabled={!(msTemplateId || msTemplate?.id)}
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg transition disabled:opacity-60"
                  >
                    <Download className="w-4 h-4" />
                    Baixar
                  </button>
                  <button
                    type="button"
                    onClick={handleRemoveMsTemplate}
                    disabled={msTemplateSaving || !(msTemplateId || msTemplate?.id)}
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold bg-red-50 hover:bg-red-100 text-red-700 rounded-lg transition disabled:opacity-60"
                  >
                    {msTemplateSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    Remover
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  A lista exibe apenas modelos do contexto <span className="font-semibold">MS (Requerimentos)</span>.
                </p>
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
                disabled={msTemplateSaving || generatingMsPdf}
                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900 transition disabled:opacity-60 w-full sm:w-auto"
              >
                Cancelar
              </button>
              {selectedRequirementForView && (
                <button
                  type="button"
                  onClick={async () => {
                    await handleGenerateMsWithSelectedTemplate();
                    setMsTemplateModalOpen(false);
                  }}
                  disabled={generatingMsPdf || !msTemplateId}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition disabled:opacity-60 w-full sm:w-auto justify-center"
                >
                  {generatingMsPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                  Gerar MS
                </button>
              )}
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

      {msSelectTemplateModalOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center px-3 sm:px-6 py-4">
          <div className="absolute inset-0 bg-slate-900/55 backdrop-blur-sm" onClick={() => setMsSelectTemplateModalOpen(false)} />
          <div className="relative w-full max-w-md !bg-white rounded-2xl shadow-2xl ring-1 ring-black/5 overflow-hidden flex flex-col">
            <div className="h-1 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600" />
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">Selecionar Modelo MS</h3>
              <p className="text-xs text-slate-500 mt-1">Escolha o modelo para gerar o Mandado de Segurança</p>
            </div>

            <div className="px-5 py-5 space-y-4">
              {msTemplateLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                </div>
              ) : msTemplates.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-slate-500">Nenhum modelo MS disponível</p>
                  <button
                    type="button"
                    onClick={() => {
                      setMsSelectTemplateModalOpen(false);
                      handleOpenMsTemplateModal();
                    }}
                    className="mt-3 text-sm text-blue-600 hover:text-blue-700 font-medium"
                  >
                    Gerenciar modelos
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {msTemplates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={async () => {
                        setMsTemplateId(template.id);
                        setMsTemplate(template);
                        setMsSelectTemplateModalOpen(false);
                        setGeneratingMsPdf(true);
                        try {
                          if (!selectedRequirementForView?.client_id) {
                            toast.error('Cliente não vinculado ao requerimento.');
                            return;
                          }
                          const client = selectedClientForRequirement ?? (await clientService.getClientById(selectedRequirementForView.client_id));
                          if (!client) {
                            toast.error('Cliente não encontrado.');
                            return;
                          }
                          const placeholders = buildMsPlaceholders(selectedRequirementForView, client);
                          const docxBlob = await generateMsDocxFromTemplate(template, placeholders);
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
                      }}
                      disabled={generatingMsPdf}
                      className="w-full text-left px-4 py-3 rounded-lg border border-slate-200 hover:border-amber-400 hover:bg-amber-50/50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <div className="flex items-center gap-3">
                        <FileText className="w-5 h-5 text-amber-600 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">{template.name}</p>
                          {template.description && (
                            <p className="text-xs text-slate-500 truncate mt-0.5">{template.description.replace(REQUIREMENTS_MS_TEMPLATE_TAG, '').trim()}</p>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-slate-200 flex items-center justify-between gap-3 bg-slate-50">
              <button
                type="button"
                onClick={() => {
                  setMsSelectTemplateModalOpen(false);
                  handleOpenMsTemplateModal();
                }}
                className="text-sm text-slate-600 hover:text-slate-900 font-medium"
              >
                Gerenciar modelos
              </button>
              <button
                type="button"
                onClick={() => setMsSelectTemplateModalOpen(false)}
                disabled={generatingMsPdf}
                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900 transition disabled:opacity-60"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Indeferido — Confirmar com péricias em aberto ───────────────── */}
      {indeferidoConfirm && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setIndeferidoConfirm(null)} />
          <div className="relative w-full max-w-sm bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/10 overflow-hidden">
            {/* Barra de atenção */}
            <div className="h-1 bg-amber-500" />

            <div className="px-6 py-5">
              {/* Ícone + título */}
              <div className="flex items-start gap-3 mb-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white leading-tight">
                    Péricias em aberto
                  </h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    Este requerimento possui{' '}
                    {[
                      indeferidoConfirm.hasMedica && 'perícia médica',
                      indeferidoConfirm.hasSocial && 'perícia social',
                    ].filter(Boolean).join(' e ')}{' '}
                    agendada{indeferidoConfirm.hasMedica && indeferidoConfirm.hasSocial ? 's' : ''} com data futura.
                  </p>
                </div>
              </div>

              {/* Aviso */}
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3 mb-5 text-sm text-amber-800 dark:text-amber-300">
                Ao indeferir, deseja <strong>cancelar e remover</strong> os agendamentos de perícia pendentes?
              </div>

              {/* Ações */}
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    const { requirementId } = indeferidoConfirm;
                    setIndeferidoConfirm(null);
                    await doStatusChange(requirementId, 'indeferido', true);
                    toast.success('Indeferido', 'Status atualizado e péricias canceladas.');
                  }}
                  className="w-full px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition flex items-center justify-center gap-2"
                >
                  <AlertTriangle className="w-4 h-4" />
                  Indeferir e cancelar péricias
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const { requirementId } = indeferidoConfirm;
                    setIndeferidoConfirm(null);
                    await doStatusChange(requirementId, 'indeferido', false);
                  }}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 text-slate-700 dark:text-slate-300 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-zinc-800 transition"
                >
                  Indeferir sem cancelar péricias
                </button>
                <button
                  type="button"
                  onClick={() => setIndeferidoConfirm(null)}
                  className="w-full px-4 py-2 text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── WhatsApp Template Modal ─────────────────────────────────────── */}
      {whatsappTemplateReq && (() => {
        const waTemplates = WHATSAPP_TEMPLATES[whatsappTemplateReq.status] ?? [];
        const previewText = selectedWATemplate
          ? buildWAText(selectedWATemplate.text, whatsappTemplateReq)
          : null;
        const initials = (whatsappTemplateReq.beneficiary ?? '?')
          .split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase();
        return (
          <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center sm:px-4 sm:py-6">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setWhatsappTemplateReq(null)} />

            {/* Card */}
            <div className="relative w-full sm:max-w-2xl bg-white sm:rounded-2xl shadow-2xl ring-1 ring-black/10 overflow-hidden flex flex-col max-h-[92dvh] sm:max-h-[85vh]">

              {/* ── Header ── */}
              <div className="bg-[#075E54] px-5 py-4 flex items-center gap-3.5 flex-shrink-0">
                {/* Avatar */}
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-sm font-bold tracking-tight">{initials}</span>
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-sm leading-tight truncate">
                    {whatsappTemplateReq.beneficiary ?? 'Beneficiário'}
                  </p>
                  <p className="text-green-200 text-xs font-mono mt-0.5">
                    {whatsappTemplateReq.phone ?? 'Sem telefone'}
                  </p>
                </div>
                {/* WA Logo + close */}
                <div className="flex items-center gap-3 flex-shrink-0">
                  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white opacity-70" xmlns="http://www.w3.org/2000/svg">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  <button
                    onClick={() => setWhatsappTemplateReq(null)}
                    className="p-1.5 rounded-full text-white/60 hover:text-white hover:bg-white/10 transition"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* ── Body: two-column on desktop ── */}
              <div className="flex flex-col sm:flex-row flex-1 min-h-0">

                {/* Left — template list */}
                <div className="sm:w-52 sm:border-r border-slate-100 flex flex-col flex-shrink-0">
                  <p className="px-4 pt-3 pb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 flex-shrink-0">
                    Modelos
                  </p>
                  <div className="flex-1 overflow-y-auto pb-2 space-y-0.5 px-2">
                    {waTemplates.length === 0 && (
                      <p className="text-xs text-slate-400 text-center py-6 px-3">
                        Nenhum modelo para este status.
                      </p>
                    )}
                    {waTemplates.map((tpl, i) => {
                      const isSelected = selectedWATemplate?.label === tpl.label;
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setSelectedWATemplate(tpl)}
                          className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-medium transition-all flex items-center gap-2 ${
                            isSelected
                              ? 'bg-[#DCF8C6] text-[#075E54] font-semibold'
                              : 'text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isSelected ? 'bg-[#25D366]' : 'bg-slate-300'}`} />
                          <span className="truncate">{tpl.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  {/* No-template shortcut */}
                  <div className="border-t border-slate-100 px-3 py-3 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => handleWhatsApp(whatsappTemplateReq.phone)}
                      className="w-full text-[10px] font-semibold text-slate-400 hover:text-slate-600 transition flex items-center justify-center gap-1.5"
                    >
                      <svg viewBox="0 0 24 24" className="w-3 h-3 fill-current flex-shrink-0" xmlns="http://www.w3.org/2000/svg">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                      </svg>
                      Abrir sem template
                    </button>
                  </div>
                </div>

                {/* Right — chat preview */}
                <div className="flex-1 flex flex-col min-h-0 min-w-0">
                  {/* Chat area */}
                  <div
                    className="flex-1 overflow-y-auto px-4 py-4"
                    style={{ background: 'url("data:image/svg+xml,%3Csvg width=\'400\' height=\'400\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3C/svg%3E") #ECE5DD' }}
                  >
                    {previewText ? (
                      <div className="flex justify-end">
                        <div className="max-w-[85%] relative">
                          {/* Bubble tail */}
                          <div className="absolute -right-1.5 top-0 w-3 h-3 overflow-hidden">
                            <div className="w-4 h-4 bg-[#DCF8C6] rotate-45 translate-x-1 -translate-y-1" />
                          </div>
                          {/* Bubble */}
                          <div className="bg-[#DCF8C6] rounded-2xl rounded-tr-sm px-3.5 py-2.5 shadow-sm">
                            <p className="text-[12.5px] text-slate-800 leading-[1.55] whitespace-pre-wrap break-words">
                              {previewText}
                            </p>
                            <p className="text-[10px] text-slate-400 text-right mt-1.5 flex items-center justify-end gap-1">
                              {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                              <svg viewBox="0 0 16 11" className="w-3.5 h-2.5 fill-[#53bdeb]" xmlns="http://www.w3.org/2000/svg">
                                <path d="M11.071.653a.75.75 0 00-1.142-.97L4.917 6.31 2.07 3.772a.75.75 0 10-1.04 1.081l3.5 3.375a.75.75 0 001.091-.056l5.45-7.52zM15.071.653a.75.75 0 00-1.142-.97l-5.012 6.627-.252-.243a.75.75 0 10-1.04 1.081l.856.825a.75.75 0 001.091-.056l5.5-7.264z"/>
                              </svg>
                            </p>
                          </div>
                          {/* Template label tag */}
                          <p className="text-[9.5px] text-slate-400 text-right mt-1 pr-0.5 font-medium">
                            {selectedWATemplate?.label}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center gap-2 py-6">
                        <svg viewBox="0 0 24 24" className="w-10 h-10 fill-slate-300" xmlns="http://www.w3.org/2000/svg">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                        </svg>
                        <p className="text-xs text-slate-400">Selecione um modelo</p>
                      </div>
                    )}
                  </div>

                  {/* Send footer */}
                  <div className="border-t border-slate-100 bg-white px-4 py-3 flex-shrink-0">
                    <button
                      type="button"
                      disabled={!selectedWATemplate}
                      onClick={() => selectedWATemplate && handleSendWATemplate(selectedWATemplate.text, whatsappTemplateReq)}
                      className="w-full inline-flex items-center justify-center gap-2.5 px-5 py-2.5 rounded-xl bg-[#25D366] hover:bg-[#20BC5A] disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-semibold transition shadow-sm disabled:shadow-none disabled:cursor-not-allowed"
                    >
                      <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" xmlns="http://www.w3.org/2000/svg">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                      </svg>
                      {selectedWATemplate ? `Enviar "${selectedWATemplate.label}"` : 'Selecione um modelo'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default RequirementsModule;
