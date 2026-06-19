
import React, { useState, useEffect } from 'react';
import { CompanyProfile, VaultDocument, Employee } from '../types';
import { getCompanyProfile, getPlatformRules, setPlatformRules, getModulePermissions, setModulePermissions, getOrganisationsList, getActiveOrgId, getLiveModeDataStatus, clearAllDataInLiveMode, getEmployees, updateEmployee, getManualUsdToInrRate, setManualUsdToInrRate, exportConfig, importConfig, type ConfigExportPayload, getUIState, setUIState, StorageKeys, addVaultDocument } from '../services/storageService';
import { loadDefaultOrganisationConfig } from '../services/defaultOrganisation';
import { getTodayUsdToInrRate, fetchTodayUsdToInrRate } from '../services/currencyService';

interface AdminPanelProps {
  onOpenOrgManager?: () => void;
}

const AdminPanel: React.FC<AdminPanelProps> = ({ onOpenOrgManager }) => {
  const [profile, setProfile] = useState<CompanyProfile | null>(() => getCompanyProfile());
  const [activeTab, setActiveTabState] = useState<'config' | 'documents' | 'organisations' | 'employees'>(() => getUIState(StorageKeys.UI_ADMIN_TAB, 'config' as 'config' | 'documents' | 'organisations' | 'employees'));
  const setActiveTab = (v: 'config' | 'documents' | 'organisations' | 'employees') => { setActiveTabState(v); setUIState(StorageKeys.UI_ADMIN_TAB, v); };
  const [orgs, setOrgs] = useState(() => getOrganisationsList());
  const [liveStatus, setLiveStatus] = useState(() => getLiveModeDataStatus());
  const [employees, setEmployees] = useState<Employee[]>(() => getEmployees());
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [editForm, setEditForm] = useState<Partial<Employee>>({});

  useEffect(() => {
    const refresh = () => {
      setProfile(getCompanyProfile());
      setOrgs(getOrganisationsList());
      setLiveStatus(getLiveModeDataStatus());
      setEmployees(getEmployees());
      setTodayRate(getTodayUsdToInrRate());
    };
    window.addEventListener('suez_data_updated', refresh);
    return () => window.removeEventListener('suez_data_updated', refresh);
  }, []);
  const [isGenerating, setIsGenerating] = useState(false);
  const [platformRules, setPlatformRulesState] = useState(() => getPlatformRules());
  const [modulePermissions, setModulePermissionsState] = useState(() => getModulePermissions());
  const [manualUsdInr, setManualUsdInr] = useState<string>(() => {
    const v = getManualUsdToInrRate();
    return v ? String(v) : '';
  });
  const [todayRate, setTodayRate] = useState(() => getTodayUsdToInrRate());
  const [importStatus, setImportStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleExportConfig = () => {
    const payload = exportConfig();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `suez-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleImportConfig = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportStatus(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result as string) as ConfigExportPayload;
        const result = importConfig(json);
        if (result.success) {
          setImportStatus({ type: 'success', msg: 'Configuration imported successfully. Reloading...' });
          setTimeout(() => window.location.reload(), 1200);
        } else {
          setImportStatus({ type: 'error', msg: result.error || 'Import failed' });
        }
      } catch (err) {
        setImportStatus({ type: 'error', msg: (err as Error).message || 'Invalid JSON file' });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const [docData, setDocDataState] = useState(() => getUIState(StorageKeys.UI_ADMIN_DOC_DRAFT, {
    candidateName: '',
    role: '',
    salary: '',
    joiningDate: '',
    docType: 'Offer Letter'
  }));
  const setDocData = (v: typeof docData) => { setDocDataState(v); setUIState(StorageKeys.UI_ADMIN_DOC_DRAFT, v); };

  const downloadDocument = () => {
    setIsGenerating(true);
    const docContent = `
============================================================
           ${docData.docType.toUpperCase()} - PROJECT SUEZ
============================================================
Date: ${new Date().toLocaleDateString()}

To,
${docData.candidateName}

Subject: ${docData.docType} for the position of ${docData.role}

Dear ${docData.candidateName},

We are pleased to issue this ${docData.docType} on behalf of 
${profile?.parent.name || 'Suez Media LLP'}.

Position    : ${docData.role}
Location    : Remote / ${profile?.parent.state || 'Maharashtra'}, India
CTC         : ₹${Number(docData.salary).toLocaleString()} per annum
Joining Date: ${docData.joiningDate}

${docData.docType === 'Offer Letter' ? `
Please note that this offer is subject to successful background 
verification and completion of statutory documentation as per 
Project Suez compliance standards.` : `
By accepting this appointment, you agree to the company's code 
of conduct and confidentiality agreements. This appointment is 
effective from the Joining Date mentioned above.`}

------------------------------------------------------------
Issued via: Project Suez Admin Panel
Entity: ${profile?.parent.name}
------------------------------------------------------------
This is a digitally generated document.
============================================================
    `;

    setTimeout(() => {
      const newDoc: VaultDocument = {
        id: `DOC-${Date.now()}`,
        date: new Date().toISOString().split('T')[0],
        title: `${docData.docType}: ${docData.candidateName}`,
        type: docData.docType,
        candidateName: docData.candidateName,
        content: docContent.trim()
      };
      addVaultDocument(newDoc);

      const blob = new Blob([docContent.trim()], { type: 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${docData.docType.replace(/\s+/g, '_')}_${docData.candidateName.replace(/\s+/g, '_')}.txt`;
      a.click();
      setIsGenerating(false);
      alert('Document issued and archived in Compliance Hub.');
    }, 1000);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">Admin Control Center</h2>
          <p className="text-slate-500 mt-1 font-medium">Master configuration and document issuance hub.</p>
        </div>
        <div className="flex bg-slate-200 p-1 rounded-xl text-[10px] font-black shadow-inner">
           <button onClick={() => setActiveTab('config')} className={`px-4 py-1.5 rounded-lg transition-all ${activeTab === 'config' ? 'bg-white text-slate-900 shadow-md' : 'text-slate-500'}`}>MODULE CONFIG</button>
           <button onClick={() => setActiveTab('documents')} className={`px-4 py-1.5 rounded-lg transition-all ${activeTab === 'documents' ? 'bg-white text-slate-900 shadow-md' : 'text-slate-500'}`}>DOCUMENT ISSUER</button>
           <button onClick={() => setActiveTab('employees')} className={`px-4 py-1.5 rounded-lg transition-all ${activeTab === 'employees' ? 'bg-white text-slate-900 shadow-md' : 'text-slate-500'}`}>EMPLOYEES</button>
           <button onClick={() => setActiveTab('organisations')} className={`px-4 py-1.5 rounded-lg transition-all ${activeTab === 'organisations' ? 'bg-white text-slate-900 shadow-md' : 'text-slate-500'}`}>ORGANISATIONS</button>
        </div>
      </header>

      {activeTab === 'config' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
             <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                Module Permissions
             </h3>
             <div className="space-y-4">
               {modulePermissions.map((mod) => (
                 <div key={mod.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100 group hover:border-indigo-200 transition-all">
                    <div>
                       <p className="text-xs font-black text-slate-800 uppercase tracking-tight">{mod.name}</p>
                       <p className="text-[10px] font-medium text-slate-400">{mod.desc}</p>
                    </div>
                    <button
                      onClick={() => {
                        const updated = modulePermissions.map(m => m.id === mod.id ? { ...m, enabled: !m.enabled } : m);
                        setModulePermissionsState(updated);
                        setModulePermissions(updated);
                      }}
                      className={`relative inline-flex items-center w-11 h-6 rounded-full transition-colors ${mod.enabled ? 'bg-indigo-600' : 'bg-slate-200'}`}
                    >
                      <span className={`absolute top-[2px] left-[2px] w-5 h-5 bg-white rounded-full border border-slate-300 transition-transform ${mod.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                 </div>
               ))}
             </div>
          </div>

          <div className="bg-slate-900 p-8 rounded-[2.5rem] text-white flex flex-col justify-between relative overflow-hidden">
             <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-600/20 rounded-full -mr-32 -mt-32 blur-3xl"></div>
             <div className="relative z-10">
                <h3 className="text-lg font-black uppercase tracking-tighter mb-2">Platform Customization</h3>
                <p className="text-xs text-slate-400 leading-relaxed font-medium">Adjust platform-wide settings like default FX markup, partner remuneration caps, and intercompany service categories.</p>
                
                <div className="mt-8 space-y-6">
                  <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                    <label className="block text-[10px] font-black text-indigo-300 uppercase tracking-widest mb-2">USD → INR Rate (today)</label>
                    <p className="text-[10px] text-slate-400 mb-2">Set a manual rate to override the live FX rate.{getManualUsdToInrRate() ? ' Manual override active.' : ''}</p>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Enter rate (blank = auto)"
                        value={manualUsdInr}
                        onChange={(e) => setManualUsdInr(e.target.value)}
                        className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs font-bold outline-none focus:border-indigo-500"
                      />
                      <button
                        onClick={() => {
                          const v = parseFloat(manualUsdInr);
                          if (v > 0) {
                            setManualUsdToInrRate(v);
                            setTodayRate(v);
                          } else {
                            setManualUsdToInrRate(null);
                            fetchTodayUsdToInrRate().then(setTodayRate);
                          }
                          setManualUsdInr('');
                          window.dispatchEvent(new Event('suez_data_updated'));
                        }}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase"
                      >
                        Set
                      </button>
                      <button
                        onClick={async () => {
                          const r = await fetchTodayUsdToInrRate();
                          setTodayRate(r);
                          setManualUsdToInrRate(null);
                          setManualUsdInr('');
                          window.dispatchEvent(new Event('suez_data_updated'));
                        }}
                        className="px-4 py-2 bg-white/10 text-white rounded-xl text-[10px] font-black uppercase hover:bg-white/20"
                      >
                        Auto
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-indigo-300 uppercase tracking-widest mb-2">Base FX Markup (%)</label>
                    <input 
                      type="number" 
                      value={platformRules.fxMarkup} 
                      onChange={e => setPlatformRulesState({...platformRules, fxMarkup: Number(e.target.value) || 0})}
                      step="0.1"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs font-bold outline-none focus:border-indigo-500" 
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-indigo-300 uppercase tracking-widest mb-2">Audit Risk Threshold (INR)</label>
                    <input 
                      type="number" 
                      value={platformRules.auditRiskThreshold} 
                      onChange={e => setPlatformRulesState({...platformRules, auditRiskThreshold: Number(e.target.value) || 0})}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs font-bold outline-none focus:border-indigo-500" 
                    />
                  </div>
                </div>
             </div>
             <button 
               onClick={() => { setPlatformRules(platformRules); window.dispatchEvent(new Event('suez_data_updated')); alert('Platform rules saved.'); }}
               className="mt-8 bg-white text-slate-900 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:scale-[1.02] transition-all"
             >
               Update Platform Rules
             </button>
          </div>

          <div className="md:col-span-2 bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-teal-500"></span>
              Import / Export Configuration
            </h3>
            <p className="text-xs text-slate-500 font-medium mb-6">
              Backup or restore all settings: company details, org IDs, Stripe accounts & API keys, employees, transactions, platform rules, module permissions, vault documents, and more.
            </p>
            <div className="flex flex-wrap gap-4 items-center">
              <button
                onClick={handleExportConfig}
                className="px-6 py-3 bg-teal-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-teal-700 transition-all flex items-center gap-2"
              >
                Export Configuration
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleImportConfig}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-6 py-3 border-2 border-slate-200 text-slate-700 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center gap-2"
              >
                Import Configuration
              </button>
              <button
                onClick={() => {
                  if (!window.confirm('Restore the bundled Systemdr default organisation? This replaces all current settings.')) return;
                  setImportStatus(null);
                  const result = loadDefaultOrganisationConfig();
                  if (result.success) {
                    setImportStatus({ type: 'success', msg: 'Default organisation (Systemdr) loaded. Reloading...' });
                    setTimeout(() => window.location.reload(), 1200);
                  } else {
                    setImportStatus({ type: 'error', msg: result.error || 'Failed to load default organisation' });
                  }
                }}
                className="px-6 py-3 border-2 border-indigo-200 text-indigo-700 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-indigo-50 transition-all"
              >
                Restore Systemdr Default
              </button>
            </div>
            {importStatus && (
              <div className={`mt-4 p-4 rounded-xl text-xs font-bold ${importStatus.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>
                {importStatus.msg}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'documents' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-8">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Generate New Instrument</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase mb-2">Candidate Name</label>
                  <input 
                    type="text" 
                    value={docData.candidateName}
                    onChange={e => setDocData({...docData, candidateName: e.target.value})}
                    placeholder="John Doe" 
                    className="w-full px-5 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs" 
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase mb-2">Role Title</label>
                  <input 
                    type="text" 
                    value={docData.role}
                    onChange={e => setDocData({...docData, role: e.target.value})}
                    placeholder="Product Designer" 
                    className="w-full px-5 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs" 
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase mb-2">Annual CTC (INR)</label>
                  <input 
                    type="number" 
                    value={docData.salary}
                    onChange={e => setDocData({...docData, salary: e.target.value})}
                    placeholder="1200000" 
                    className="w-full px-5 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs" 
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase mb-2">Document Type</label>
                  <select 
                    value={docData.docType}
                    onChange={e => setDocData({...docData, docType: e.target.value})}
                    className="w-full px-5 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs appearance-none"
                  >
                    <option>Offer Letter</option>
                    <option>Appointment Letter</option>
                    <option>Experience Letter</option>
                    <option>Relieving Letter</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase mb-2">Joining Date</label>
                  <input 
                    type="date" 
                    value={docData.joiningDate}
                    onChange={e => setDocData({...docData, joiningDate: e.target.value})}
                    className="w-full px-5 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs" 
                  />
                </div>
              </div>
              <button 
                onClick={downloadDocument}
                disabled={!docData.candidateName || !docData.role}
                className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-indigo-200 hover:bg-indigo-700 transition-all disabled:opacity-50 disabled:grayscale flex items-center justify-center gap-2"
              >
                {isGenerating ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                    Issuing...
                  </>
                ) : 'Generate & Issue Document'}
              </button>
            </div>
          </div>

          <div className="bg-emerald-900 p-10 rounded-[2.5rem] text-white space-y-6 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-48 h-48 bg-white/5 rounded-full -mr-24 -mt-24 blur-3xl group-hover:scale-125 transition-transform duration-1000"></div>
            <h3 className="text-xl font-black uppercase tracking-tighter">Instrument Preview</h3>
            <div className="bg-white/10 p-8 rounded-3xl border border-white/10 font-mono text-[9px] whitespace-pre-wrap h-96 overflow-y-auto scrollbar-hide text-emerald-100">
{`COMPANY: ${profile?.parent.name || 'SUEZ MEDIA LLP'}
------------------------------------------------------------
${docData.docType.toUpperCase()}
------------------------------------------------------------
NAME     : ${docData.candidateName || '---'}
ROLE     : ${docData.role || '---'}
SALARY   : ₹${Number(docData.salary || 0).toLocaleString()}
JOINING  : ${docData.joiningDate || '---'}

This document is authorized by the Board of Directors of 
${profile?.parent.name} and holds legal validity for 
employment purposes in India.

Authorized Signatory:
[Digitally Signed via Suez Admin]`}
            </div>
            <div className="p-4 bg-emerald-800/50 rounded-2xl border border-emerald-700 text-[10px] font-medium leading-relaxed">
               All generated documents are automatically archived in the Compliance Hub and synced with the Employee Directory for audit trails.
            </div>
          </div>
        </div>
      )}

      {activeTab === 'employees' && (
        <div className="space-y-6">
          <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-2 mb-6">
              <span className="w-2 h-2 rounded-full bg-amber-500"></span>
              Employee Directory
            </h3>
            <p className="text-xs text-slate-500 font-medium mb-6">
              Edit employee details for the active organisation. Add new employees from Payroll & HR.
            </p>
            <div className="space-y-3">
              {employees.length === 0 ? (
                <p className="text-slate-400 text-sm font-medium py-8 text-center">No employees. Add employees from the Payroll & HR module.</p>
              ) : (
                employees.map((emp) => (
                  <div key={emp.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100 hover:border-amber-200 transition-all group">
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center font-black text-white ${emp.status === 'Active' ? 'bg-emerald-500' : emp.status === 'Inactive' ? 'bg-slate-400' : 'bg-amber-500'}`}>
                        {emp.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                      </div>
                      <div>
                        <h4 className="font-black text-slate-900 uppercase text-xs tracking-tight">{emp.name}</h4>
                        <p className="text-[10px] font-bold text-slate-400 uppercase">{emp.designation} • {emp.email}</p>
                        <p className="text-[9px] font-bold text-slate-400 mt-0.5">CTC: ₹{emp.ctc.toLocaleString('en-IN')} • DOJ: {emp.doj} • {emp.status}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setEditingEmployee(emp);
                        setEditForm({ ...emp });
                      }}
                      className="bg-slate-900 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all"
                    >
                      Edit
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {editingEmployee && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm animate-in fade-in duration-300">
              <div className="bg-white w-full max-w-lg rounded-[2.5rem] p-10 shadow-2xl space-y-8 animate-in zoom-in-95 duration-300">
                <div className="flex justify-between items-center">
                  <h3 className="text-xl font-black text-slate-900 uppercase tracking-tighter">Edit Employee</h3>
                  <button onClick={() => { setEditingEmployee(null); setEditForm({}); }} className="text-2xl text-slate-400 hover:text-slate-900">×</button>
                </div>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Full Name</label>
                      <input type="text" value={editForm.name ?? ''} onChange={e => setEditForm({ ...editForm, name: e.target.value })} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Email</label>
                      <input type="email" value={editForm.email ?? ''} onChange={e => setEditForm({ ...editForm, email: e.target.value })} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Designation</label>
                      <input type="text" value={editForm.designation ?? ''} onChange={e => setEditForm({ ...editForm, designation: e.target.value })} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Annual CTC (INR)</label>
                      <input type="number" value={editForm.ctc ?? 0} onChange={e => setEditForm({ ...editForm, ctc: Number(e.target.value) })} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Date of Joining</label>
                      <input type="date" value={editForm.doj ?? ''} onChange={e => setEditForm({ ...editForm, doj: e.target.value })} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Status</label>
                      <select value={editForm.status ?? 'Active'} onChange={e => setEditForm({ ...editForm, status: e.target.value as Employee['status'] })} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs appearance-none">
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                        <option value="Onboarding">Onboarding</option>
                        <option value="Notice">Notice</option>
                        <option value="Exited">Exited</option>
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Documents Collected</label>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 text-xs font-bold">
                          <input type="checkbox" checked={editForm.documents?.pan ?? false} onChange={e => setEditForm({ ...editForm, documents: { ...editForm.documents!, pan: e.target.checked } })} className="accent-indigo-600" />
                          PAN
                        </label>
                        <label className="flex items-center gap-2 text-xs font-bold">
                          <input type="checkbox" checked={editForm.documents?.aadhaar ?? false} onChange={e => setEditForm({ ...editForm, documents: { ...editForm.documents!, aadhaar: e.target.checked } })} className="accent-indigo-600" />
                          Aadhaar
                        </label>
                        <label className="flex items-center gap-2 text-xs font-bold">
                          <input type="checkbox" checked={editForm.documents?.contract ?? false} onChange={e => setEditForm({ ...editForm, documents: { ...editForm.documents!, contract: e.target.checked } })} className="accent-indigo-600" />
                          Contract
                        </label>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (editingEmployee.id && editForm.name && editForm.email) {
                        updateEmployee(editingEmployee.id, {
                          name: editForm.name,
                          email: editForm.email,
                          designation: editForm.designation ?? '',
                          ctc: editForm.ctc ?? 0,
                          doj: editForm.doj ?? new Date().toISOString().split('T')[0],
                          status: editForm.status ?? 'Active',
                          documents: editForm.documents ?? { pan: false, aadhaar: false, contract: false },
                        });
                        setEmployees(getEmployees());
                        setEditingEmployee(null);
                        setEditForm({});
                        window.dispatchEvent(new Event('suez_data_updated'));
                      }
                    }}
                    className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'organisations' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-violet-500"></span>
              Organisations
            </h3>
            <p className="text-xs text-slate-500 font-medium">
              Switch, add, edit, or remove organisations. The active organisation drives base currency, ledger, payroll, and Stripe config.
            </p>
            <div className="space-y-3">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Current</p>
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <p className="font-black text-slate-900 uppercase text-xs">{profile?.projectName || '—'}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Base: {profile?.baseCurrency ?? '—'}</p>
              </div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-4">All ({orgs.length})</p>
              <ul className="space-y-2 max-h-48 overflow-y-auto">
                {orgs.map((org) => (
                  <li key={org.id} className="flex items-center justify-between py-2 px-3 bg-slate-50 rounded-xl border border-slate-100 text-xs font-bold">
                    <span className={org.id === getActiveOrgId() ? 'text-indigo-600' : 'text-slate-700'}>{org.name}</span>
                    {org.id === getActiveOrgId() && <span className="text-[9px] font-black text-indigo-600 uppercase">Active</span>}
                  </li>
                ))}
              </ul>
            </div>
            <button
              onClick={() => onOpenOrgManager?.()}
              className="w-full bg-violet-600 text-white py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-violet-200 hover:bg-violet-700 transition-all flex items-center justify-center gap-2"
            >
              Manage organisations
            </button>

            <div className="pt-6 border-t border-slate-200 space-y-3">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Live mode data</p>
              <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 text-xs">
                <p className="font-bold text-slate-800">Mode: {liveStatus.isLiveMode ? 'Live' : 'Mock'}</p>
                <p className="text-slate-600 mt-1">Data: {liveStatus.hasData ? `${liveStatus.orgCount} org(s), ${liveStatus.totalTransactions} ledger txns, ${liveStatus.totalRevenueTransactions} revenue txns, ${liveStatus.vaultDocCount} vault doc(s)` : 'None'}</p>
              </div>
              {liveStatus.isLiveMode && liveStatus.hasData && (
                <button
                  onClick={() => {
                    if (!confirm('Remove ALL data in live mode? This cannot be undone. The app will reload.')) return;
                    if (clearAllDataInLiveMode()) window.location.reload();
                  }}
                  className="w-full bg-rose-600 text-white py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-rose-700 transition-all"
                >
                  Remove all data (live mode)
                </button>
              )}
            </div>
          </div>
          <div className="bg-slate-900 p-10 rounded-[2.5rem] text-white flex flex-col justify-between relative overflow-hidden">
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-violet-600/20 rounded-full -ml-24 -mb-24 blur-3xl"></div>
            <div className="relative z-10 space-y-4">
              <h3 className="text-lg font-black uppercase tracking-tighter">Quick actions</h3>
              <p className="text-xs text-slate-400 leading-relaxed font-medium">
                From the organisation manager you can: switch the active org, rename an org, edit its company profile (entity names, tax IDs, base currency), add a new organisation via onboarding, or delete an org and all its data.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPanel;
