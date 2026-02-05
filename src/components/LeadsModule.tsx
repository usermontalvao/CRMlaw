import React, { useEffect, useState } from 'react';
import { Plus, Mail, Phone, Loader2, Trash2, ExternalLink, X, CheckCircle2, TrendingUp, Clock, FileCheck, Target, Edit2, Save } from 'lucide-react';
import LeadModal from './LeadModal';
import { leadService } from '../services/lead.service';
import type { Lead, LeadStage, CreateLeadDTO } from '../types/lead.types';

const STAGES: { key: LeadStage; label: string; accent: string; gradient: string; description: string; icon: React.ReactNode }[] = [
  { key: 'novo', label: 'Novo', accent: 'text-slate-600', gradient: 'from-slate-950/90 via-slate-900 to-slate-800', description: 'Lead recém-cadastrado, aguarda primeiro contato.', icon: <Plus className="w-4 h-4" /> },
  { key: 'qualificando', label: 'Qualificando', accent: 'text-blue-600', gradient: 'from-blue-950/90 via-blue-900 to-blue-800', description: 'Contato em andamento para entender necessidades.', icon: <TrendingUp className="w-4 h-4" /> },
  { key: 'qualificado', label: 'Qualificado', accent: 'text-emerald-600', gradient: 'from-emerald-950/90 via-emerald-900 to-emerald-800', description: 'Lead validado e pronto para conversão.', icon: <CheckCircle2 className="w-4 h-4" /> },
  { key: 'aguardando_documentos', label: 'Aguardando Documentos', accent: 'text-amber-600', gradient: 'from-amber-950/90 via-amber-900 to-amber-800', description: 'Lead enviando documentos ou informações.', icon: <FileCheck className="w-4 h-4" /> },
  { key: 'nao_qualificado', label: 'Não Qualificado', accent: 'text-red-600', gradient: 'from-red-950/90 via-red-900 to-red-800', description: 'Lead não avançará como cliente.', icon: <X className="w-4 h-4" /> },
];

interface LeadsModuleProps {
  onConvertLead: (lead: Lead) => void;
}

const LeadsModule: React.FC<LeadsModuleProps> = ({ onConvertLead }) => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [formData, setFormData] = useState<CreateLeadDTO>({
    name: '',
    email: '',
    phone: '',
    source: '',
    stage: 'novo',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  const [draggingLeadId, setDraggingLeadId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<LeadStage | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const leadsData = await leadService.listLeads();
      setLeads(leadsData);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      await leadService.createLead(formData);
      await loadData();
      setIsModalOpen(false);
      setFormData({ name: '', email: '', phone: '', source: '', stage: 'novo', notes: '' });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleOpenLead = (lead: Lead) => {
    setSelectedLead(lead);
    setFormData({
      name: lead.name,
      email: lead.email || '',
      phone: lead.phone || '',
      source: lead.source || '',
      stage: lead.stage,
      notes: lead.notes || '',
    });
    setEditMode(false);
    setIsViewModalOpen(true);
  };

  const handleUpdateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead) return;
    try {
      setSaving(true);
      await leadService.updateLead(selectedLead.id, formData);
      await loadData();
      setIsViewModalOpen(false);
      setSelectedLead(null);
      setEditMode(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleOpenNewLeadModal = () => {
    setFormData({ name: '', email: '', phone: '', source: '', stage: 'novo', notes: '' });
    setIsModalOpen(true);
  };

  const handleMoveStage = async (lead: Lead, newStage: LeadStage) => {
    if (lead.stage === newStage) return;
    setLeads((prev) =>
      prev.map((item) => (item.id === lead.id ? { ...item, stage: newStage } : item)),
    );
    try {
      await leadService.updateLead(lead.id, { stage: newStage });
      await loadData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDragStart = (event: React.DragEvent<HTMLDivElement>, lead: Lead) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/json', JSON.stringify({ leadId: lead.id, stage: lead.stage }));
    setDraggingLeadId(lead.id);
  };

  const handleDragEnd = () => {
    setDraggingLeadId(null);
    setDragOverStage(null);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>, stage: LeadStage) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOverStage(stage);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>, targetStage: LeadStage) => {
    event.preventDefault();
    const payload = event.dataTransfer.getData('application/json');
    setDraggingLeadId(null);
    setDragOverStage(null);
    if (!payload) return;
    try {
      const { leadId } = JSON.parse(payload) as { leadId: string; stage: LeadStage };
      const lead = leads.find((item) => item.id === leadId);
      if (lead) {
        handleMoveStage(lead, targetStage);
      }
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleDeleteLead = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este lead?')) return;
    try {
      await leadService.deleteLead(id);
      await loadData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const getLeadsByStage = (stage: LeadStage) =>
    leads.filter((l) => l.stage === stage).sort((a, b) => a.name.localeCompare(b.name));

  const totalLeads = leads.length;
  const qualifyingLeads = leads.filter((lead) => lead.stage === 'qualificando').length;
  const qualifiedLeads = leads.filter((lead) => lead.stage === 'qualificado').length;
  const awaitingDocsLeads = leads.filter((lead) => lead.stage === 'aguardando_documentos').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 text-amber-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h3 className="text-xl font-semibold text-slate-900">Pipeline de Leads</h3>
            <p className="text-sm text-slate-600">Gerencie seus leads com quadro Kanban</p>
          </div>
          <button
            onClick={handleOpenNewLeadModal}
            className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-semibold px-6 py-3 rounded-lg flex items-center gap-2 transition-all shadow-lg shadow-orange-500/40 hover:shadow-orange-500/60"
          >
            <Plus className="w-5 h-5" />
            Novo Lead
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Highlights */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-blue-600 via-blue-500 to-blue-400 text-white rounded-2xl p-6 shadow-xl border border-blue-400/20 hover:shadow-2xl transition-all duration-300">
          <div className="flex items-center justify-between mb-3">
            <div className="bg-white/20 backdrop-blur-sm p-2.5 rounded-xl">
              <TrendingUp className="w-5 h-5" />
            </div>
            <span className="text-xs font-semibold bg-white/20 px-2.5 py-1 rounded-full">{qualifyingLeads}</span>
          </div>
          <p className="text-sm text-white/90 font-medium">Em Qualificação</p>
          <p className="text-xs text-white/70 mt-1">Interações ativas em andamento</p>
        </div>

        <div className="bg-gradient-to-br from-emerald-600 via-emerald-500 to-emerald-400 text-white rounded-2xl p-6 shadow-xl border border-emerald-400/20 hover:shadow-2xl transition-all duration-300">
          <div className="flex items-center justify-between mb-3">
            <div className="bg-white/20 backdrop-blur-sm p-2.5 rounded-xl">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <span className="text-xs font-semibold bg-white/20 px-2.5 py-1 rounded-full">{qualifiedLeads}</span>
          </div>
          <p className="text-sm text-white/90 font-medium">Qualificados</p>
          <p className="text-xs text-white/70 mt-1">Prontos para conversão</p>
        </div>

        <div className="bg-gradient-to-br from-amber-600 via-amber-500 to-amber-400 text-white rounded-2xl p-6 shadow-xl border border-amber-400/20 hover:shadow-2xl transition-all duration-300">
          <div className="flex items-center justify-between mb-3">
            <div className="bg-white/20 backdrop-blur-sm p-2.5 rounded-xl">
              <Clock className="w-5 h-5" />
            </div>
            <span className="text-xs font-semibold bg-white/20 px-2.5 py-1 rounded-full">{awaitingDocsLeads}</span>
          </div>
          <p className="text-sm text-white/90 font-medium">Aguardando Docs</p>
          <p className="text-xs text-white/70 mt-1">Pendentes de documentação</p>
        </div>

        <div className="bg-gradient-to-br from-slate-800 via-slate-700 to-slate-600 text-white rounded-2xl p-6 shadow-xl border border-slate-500/20 hover:shadow-2xl transition-all duration-300">
          <div className="flex items-center justify-between mb-3">
            <div className="bg-white/20 backdrop-blur-sm p-2.5 rounded-xl">
              <Target className="w-5 h-5" />
            </div>
            <span className="text-xs font-semibold bg-white/20 px-2.5 py-1 rounded-full">{totalLeads}</span>
          </div>
          <p className="text-sm text-white/90 font-medium">Total de Leads</p>
          <p className="text-xs text-white/70 mt-1">Base consolidada no CRM</p>
        </div>
      </div>

      {/* Kanban Board */}
      <div className="flex flex-col md:flex-row gap-3 md:gap-4 md:overflow-x-auto pb-4">
        {STAGES.map((stage) => {
          const stageLeads = getLeadsByStage(stage.key);
          const isActiveDrop = dragOverStage === stage.key;
          return (
            <div key={stage.key} className="flex-shrink-0 w-full md:w-80">
              <div
                className={`bg-white rounded-2xl border ${
                  isActiveDrop ? 'border-amber-400 shadow-lg shadow-amber-200/40' : 'border-gray-200 shadow-sm'
                } overflow-hidden backdrop-blur-sm transition-all duration-150`}
                onDragOver={(event) => handleDragOver(event, stage.key)}
                onDrop={(event) => handleDrop(event, stage.key)}
              >
                <div className={`px-3 md:px-5 py-3 md:py-4 border-b border-white/10 bg-gradient-to-r ${stage.gradient}`}>
                  <div className="flex items-center justify-between text-white mb-2">
                    <div className="flex items-center gap-2">
                      <div className="bg-white/20 backdrop-blur-sm p-1.5 rounded-lg">
                        {stage.icon}
                      </div>
                      <h4 className="font-semibold text-xs md:text-sm tracking-wide uppercase">{stage.label}</h4>
                    </div>
                    <span className="text-xs font-bold px-2 md:px-2.5 py-0.5 md:py-1 bg-black/30 backdrop-blur-sm rounded-full">
                      {stageLeads.length}
                    </span>
                  </div>
                  <p className="text-[10px] md:text-[11px] text-white/80 leading-relaxed hidden md:block">{stage.description}</p>
                </div>

                <div className="p-3 md:p-4 space-y-2 md:space-y-3 min-h-[150px] md:min-h-[200px] max-h-[400px] md:max-h-[600px] overflow-y-auto bg-gradient-to-b from-slate-50/80 to-white">
                  {stageLeads.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <div className="bg-slate-100 p-3 rounded-full mb-3">
                        {stage.icon}
                      </div>
                      <p className="text-xs text-slate-400 font-medium">Nenhum lead neste estágio</p>
                      <p className="text-[10px] text-slate-300 mt-1">Arraste e solte leads aqui</p>
                    </div>
                  ) : (
                    stageLeads.map((lead) => (
                      <div
                        key={lead.id}
                        draggable
                        onDragStart={(event) => handleDragStart(event, lead)}
                        onDragEnd={handleDragEnd}
                        onClick={() => handleOpenLead(lead)}
                        className={`relative bg-white border border-slate-200 rounded-xl p-3 md:p-4 hover:shadow-xl hover:border-amber-300 transition-all duration-200 cursor-pointer group ${
                          draggingLeadId === lead.id ? 'opacity-50 scale-95 shadow-2xl shadow-amber-300/50 border-amber-400' : ''
                        }`}
                      >
                        <div className="flex items-start justify-between mb-2 md:mb-3">
                          <div className="flex-1 min-w-0">
                            <span className="text-[9px] md:text-[10px] uppercase tracking-[0.15em] text-slate-400 font-semibold block mb-1">Lead</span>
                            <h5 className="font-bold text-xs md:text-sm text-slate-900 leading-tight truncate">{lead.name}</h5>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteLead(lead.id);
                            }}
                            className="text-slate-300 hover:text-red-500 hover:bg-red-50 p-1 md:p-1.5 rounded-lg transition-all flex-shrink-0"
                            title="Excluir lead"
                          >
                            <Trash2 className="w-3 h-3 md:w-4 md:h-4" />
                          </button>
                        </div>

                        {lead.email && (
                          <div className="flex items-center gap-1.5 md:gap-2 text-[10px] md:text-xs text-slate-600 mb-2 bg-slate-50 border border-slate-100 px-2 md:px-2.5 py-1 md:py-1.5 rounded-lg">
                            <Mail className="w-3 h-3 md:w-3.5 md:h-3.5 text-slate-400 flex-shrink-0" />
                            <span className="line-clamp-1 font-medium">{lead.email}</span>
                          </div>
                        )}

                        {lead.phone && (
                          <a
                            href={`https://wa.me/${lead.phone.replace(/\D/g, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-between gap-2 text-xs text-emerald-700 mb-2 bg-emerald-50 border border-emerald-100 px-2.5 py-1.5 rounded-lg hover:bg-emerald-100 hover:border-emerald-200 transition-all group/phone"
                          >
                            <span className="inline-flex items-center gap-2 font-medium">
                              <Phone className="w-3.5 h-3.5" />
                              <span>{lead.phone}</span>
                            </span>
                            <ExternalLink className="w-3 h-3 opacity-0 group-hover/phone:opacity-100 transition-opacity" />
                          </a>
                        )}

                        {lead.source && (
                          <div className="text-xs text-slate-600 mb-2 bg-blue-50 border border-blue-100 px-2.5 py-1.5 rounded-lg">
                            <span className="font-semibold text-blue-700">Origem:</span> <span className="font-medium">{lead.source}</span>
                          </div>
                        )}

                        {lead.notes && (
                          <div className="bg-slate-50 border border-slate-100 rounded-lg p-2.5 mb-3">
                            <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">{lead.notes}</p>
                          </div>
                        )}

                        <div className="flex gap-2 pt-2 border-t border-slate-100">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onConvertLead(lead);
                            }}
                            className="flex-1 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-700 hover:to-amber-600 text-white text-xs font-semibold px-3 py-2 rounded-lg flex items-center justify-center gap-1.5 shadow-sm hover:shadow-md transition-all"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Converter em Cliente
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal Visualizar/Editar Lead */}
      {isViewModalOpen && selectedLead && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
          <div
            className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
            onClick={() => {
              setIsViewModalOpen(false);
              setSelectedLead(null);
              setEditMode(false);
            }}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-2xl max-h-[92vh] bg-white rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
            <div className="h-2 w-full bg-orange-500" />
            
            {/* Header padrão do sistema */}
            <div className="px-5 sm:px-8 py-5 border-b border-slate-200 bg-white flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  {editMode ? 'Editando Lead' : 'Detalhes do Lead'}
                </p>
                <h2 className="text-xl font-semibold text-slate-900">{selectedLead.name}</h2>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-slate-600">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${STAGES.find(s => s.key === selectedLead.stage)?.accent || 'text-slate-600'}`}>
                    {STAGES.find(s => s.key === selectedLead.stage)?.icon}
                    {STAGES.find(s => s.key === selectedLead.stage)?.label}
                  </span>
                  {selectedLead.email && (
                    <span className="text-slate-500">{selectedLead.email}</span>
                  )}
                  {selectedLead.phone && (
                    <span className="text-slate-500">{selectedLead.phone}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!editMode && (
                  <button
                    onClick={() => setEditMode(true)}
                    className="p-2 text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                    title="Editar"
                  >
                    <Edit2 className="w-5 h-5" />
                  </button>
                )}
                <button
                  onClick={() => {
                    setIsViewModalOpen(false);
                    setSelectedLead(null);
                    setEditMode(false);
                  }}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition"
                  aria-label="Fechar modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <form onSubmit={handleUpdateLead} className="p-4 sm:p-6 space-y-4 sm:space-y-5 bg-white">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-2">Nome *</label>
                  {editMode ? (
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                      required
                    />
                  ) : (
                    <p className="text-base font-semibold text-slate-900 bg-slate-50 px-4 py-3 rounded-lg">{selectedLead.name}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">E-mail</label>
                  {editMode ? (
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                    />
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-slate-700 bg-slate-50 px-4 py-3 rounded-lg">
                      <Mail className="w-4 h-4 text-slate-400" />
                      <span>{selectedLead.email || 'Não informado'}</span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Telefone</label>
                  {editMode ? (
                    <input
                      type="text"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                    />
                  ) : (
                    selectedLead.phone ? (
                      <a
                        href={`https://wa.me/${selectedLead.phone.replace(/\D/g, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 px-4 py-3 rounded-lg hover:bg-emerald-100 transition-colors"
                      >
                        <Phone className="w-4 h-4" />
                        <span>{selectedLead.phone}</span>
                        <ExternalLink className="w-3 h-3 ml-auto" />
                      </a>
                    ) : (
                      <p className="text-sm text-slate-500 bg-slate-50 px-4 py-3 rounded-lg">Não informado</p>
                    )
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Origem</label>
                  {editMode ? (
                    <input
                      type="text"
                      value={formData.source}
                      onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                      placeholder="Ex: Indicação, Site, Instagram"
                    />
                  ) : (
                    <p className="text-sm text-slate-700 bg-slate-50 px-4 py-3 rounded-lg">{selectedLead.source || 'Não informado'}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Estágio</label>
                  {editMode ? (
                    <select
                      value={formData.stage}
                      onChange={(e) => setFormData({ ...formData, stage: e.target.value as LeadStage })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                    >
                      {STAGES.map((stage) => (
                        <option key={stage.key} value={stage.key}>
                          {stage.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-2 px-4 py-3 rounded-lg font-medium text-sm bg-gradient-to-r ${STAGES.find(s => s.key === selectedLead.stage)?.gradient} text-white`}>
                        {STAGES.find(s => s.key === selectedLead.stage)?.icon}
                        {STAGES.find(s => s.key === selectedLead.stage)?.label}
                      </span>
                    </div>
                  )}
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-2">Observações</label>
                  {editMode ? (
                    <textarea
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none transition-all"
                      rows={4}
                    />
                  ) : (
                    <p className="text-sm text-slate-700 bg-slate-50 px-4 py-3 rounded-lg whitespace-pre-wrap min-h-[100px]">
                      {selectedLead.notes || 'Nenhuma observação registrada'}
                    </p>
                  )}
                </div>
              </div>

              {editMode && (
                <div className="border-t border-slate-200 bg-slate-50 px-4 sm:px-6 py-3">
                  <div className="flex justify-end items-center gap-4">
                    <button
                      type="button"
                      onClick={() => {
                        setEditMode(false);
                        setFormData({
                          name: selectedLead.name,
                          email: selectedLead.email || '',
                          phone: selectedLead.phone || '',
                          source: selectedLead.source || '',
                          stage: selectedLead.stage,
                          notes: selectedLead.notes || '',
                        });
                      }}
                      className="px-6 py-2.5 rounded-lg text-sm font-semibold bg-slate-200 text-slate-700 hover:bg-slate-300 transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 border border-orange-600/60 shadow-md shadow-orange-500/25 focus:outline-none focus:ring-2 focus:ring-orange-500/40 focus:ring-offset-1 focus:ring-offset-white transition-all disabled:from-orange-300 disabled:to-orange-300 disabled:border-orange-300/60 disabled:shadow-none disabled:cursor-not-allowed"
                    >
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      {saving ? 'Salvando...' : 'Salvar Alterações'}
                    </button>
                  </div>
                </div>
              )}

              {!editMode && (
                <div className="border-t border-slate-200 bg-slate-50 px-4 sm:px-6 py-3">
                  <button
                    type="button"
                    onClick={() => {
                      setIsViewModalOpen(false);
                      onConvertLead(selectedLead);
                    }}
                    className="w-full flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-700 hover:to-amber-600 border border-amber-600/60 shadow-md shadow-amber-500/25 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:ring-offset-1 focus:ring-offset-white transition-all"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Converter em Cliente
                  </button>
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {/* Modal Novo Lead */}
      <LeadModal
        isOpen={isModalOpen}
        saving={saving}
        formData={formData}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleCreateLead}
        onChange={(field, value) => setFormData({ ...formData, [field]: value })}
      />
    </div>
  );
};

export default LeadsModule;
