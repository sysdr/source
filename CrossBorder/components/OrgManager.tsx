import React, { useState, useEffect } from 'react';
import { CompanyProfile } from '../types';
import {
  getOrganisationsList,
  getActiveOrgId,
  setActiveOrgId,
  addOrganisation,
  updateOrganisation,
  deleteOrganisation,
} from '../services/storageService';
import Onboarding from './Onboarding';

interface OrgManagerProps {
  onClose: () => void;
  onSelect: () => void;
  onAddComplete?: () => void;
}

const OrgManager: React.FC<OrgManagerProps> = ({ onClose, onSelect, onAddComplete }) => {
  const [orgs, setOrgs] = useState(() => getOrganisationsList());
  const [activeId, setActiveId] = useState<string | null>(() => getActiveOrgId());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editProfileId, setEditProfileId] = useState<string | null>(null);
  const [editProfile, setEditProfile] = useState<CompanyProfile | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editName, setEditName] = useState('');

  useEffect(() => {
    setOrgs(getOrganisationsList());
    setActiveId(getActiveOrgId());
  }, []);

  const handleSwitch = (id: string) => {
    setActiveOrgId(id);
    setActiveId(id);
    onSelect();
    onClose();
  };

  const handleDelete = (id: string) => {
    if (!confirm('Delete this organisation? All its data will be permanently removed.')) return;
    deleteOrganisation(id);
    setOrgs(getOrganisationsList());
    setActiveId(getActiveOrgId());
    if (activeId === id) onSelect();
  };

  const handleStartEdit = (id: string, name: string) => {
    setEditingId(id);
    setEditName(name);
  };

  const handleSaveEdit = () => {
    if (editingId && editName.trim()) {
      updateOrganisation(editingId, { name: editName.trim() });
      setOrgs(getOrganisationsList());
      setEditingId(null);
      setEditName('');
    }
  };


  const handleStartEditProfile = (org: { id: string; profile: CompanyProfile }) => {
    setEditProfileId(org.id);
    setEditProfile(JSON.parse(JSON.stringify(org.profile)));
  };

  const handleSaveProfile = () => {
    if (editProfileId && editProfile) {
      updateOrganisation(editProfileId, { profile: editProfile, name: editProfile.projectName || '' });
      setOrgs(getOrganisationsList());
      setEditProfileId(null);
      setEditProfile(null);
      onSelect();
    }
  };

  const handleOnboardingComplete = (profile: CompanyProfile) => {
    addOrganisation(profile);
    setOrgs(getOrganisationsList());
    setShowAddForm(false);
    setActiveOrgId(getOrganisationsList()[getOrganisationsList().length - 1]?.id || null);
    setActiveId(getActiveOrgId());
    onAddComplete?.();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
      <div className="bg-white w-full max-w-lg rounded-[2rem] shadow-2xl border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
          <h2 className="text-xl font-black text-slate-900 uppercase tracking-tighter">Organisations</h2>
          <button onClick={onClose} className="w-10 h-10 rounded-full hover:bg-slate-100 text-slate-500 flex items-center justify-center text-2xl">×</button>
        </div>

        {showAddForm ? (
          <div className="p-6">
            <button onClick={() => setShowAddForm(false)} className="text-xs font-bold text-slate-500 hover:text-slate-900 mb-4">← Back to list</button>
            <Onboarding onComplete={handleOnboardingComplete} />
          </div>
        ) : (
          <div className="p-6 space-y-4">
            {orgs.map((org) => (
              <div
                key={org.id}
                className={`p-4 rounded-xl border-2 transition-all ${
                  activeId === org.id ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-100 hover:border-slate-200'
                }`}
              >
                {editingId === org.id ? (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm font-bold"
                    />
                    <button onClick={handleSaveEdit} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-black uppercase">Save</button>
                    <button onClick={() => setEditingId(null)} className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-bold">Cancel</button>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-black text-slate-900 uppercase text-sm">{org.name}</p>
                        <p className="text-[10px] text-slate-500 font-bold">{org.profile?.parent?.name || '—'} / {org.profile?.subsidiary?.name || '—'}</p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleStartEdit(org.id, org.name)} className="text-slate-500 hover:text-indigo-600 text-xs font-bold" title="Rename">Rename</button>
                        <button onClick={() => handleStartEditProfile(org)} className="text-slate-500 hover:text-indigo-600 text-xs font-bold" title="Modify details">Modify</button>
                        <button onClick={() => handleDelete(org.id)} className="text-slate-500 hover:text-rose-600 text-xs font-bold">Delete</button>
                      </div>
                    </div>
                    <button
                      onClick={() => handleSwitch(org.id)}
                      className={`mt-3 w-full py-2 rounded-lg text-xs font-black uppercase ${
                        activeId === org.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {activeId === org.id ? 'Current' : 'Switch to this org'}
                    </button>
                  </>
                )}
              </div>
            ))}

            <button
              onClick={() => setShowAddForm(true)}
              className="w-full py-4 border-2 border-dashed border-slate-200 rounded-xl text-slate-500 hover:border-indigo-400 hover:text-indigo-600 font-black text-xs uppercase tracking-widest transition-all"
            >
              + Add Organisation
            </button>

            {editProfileId && editProfile && (
              <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-slate-950/60">
                <div className="bg-white max-w-md w-full rounded-2xl p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
                  <h3 className="font-black text-slate-900 uppercase">Modify Organisation Details</h3>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Project Name</label>
                    <input value={editProfile.projectName} onChange={e => setEditProfile({ ...editProfile, projectName: e.target.value })} className="w-full px-4 py-2 border rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Base Currency</label>
                    <div className="flex gap-2">
                      <button onClick={() => setEditProfile({ ...editProfile, baseCurrency: 'INR' })} className={`flex-1 py-2 rounded-lg border-2 font-bold text-sm ${editProfile.baseCurrency === 'INR' ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200'}`}>INR</button>
                      <button onClick={() => setEditProfile({ ...editProfile, baseCurrency: 'USD' })} className={`flex-1 py-2 rounded-lg border-2 font-bold text-sm ${editProfile.baseCurrency === 'USD' ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200'}`}>USD</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Parent Name</label>
                      <input value={editProfile.parent?.name} onChange={e => setEditProfile({ ...editProfile, parent: { ...editProfile.parent, name: e.target.value } })} className="w-full px-4 py-2 border rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Parent Tax ID</label>
                      <input value={editProfile.parent?.taxId} onChange={e => setEditProfile({ ...editProfile, parent: { ...editProfile.parent, taxId: e.target.value } })} className="w-full px-4 py-2 border rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Subsidiary Name</label>
                      <input value={editProfile.subsidiary?.name} onChange={e => setEditProfile({ ...editProfile, subsidiary: { ...editProfile.subsidiary, name: e.target.value } })} className="w-full px-4 py-2 border rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Subsidiary Tax ID</label>
                      <input value={editProfile.subsidiary?.taxId} onChange={e => setEditProfile({ ...editProfile, subsidiary: { ...editProfile.subsidiary, taxId: e.target.value } })} className="w-full px-4 py-2 border rounded-lg text-sm" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleSaveProfile} className="flex-1 py-2 bg-indigo-600 text-white rounded-lg font-bold text-sm">Save</button>
                    <button onClick={() => { setEditProfileId(null); setEditProfile(null); }} className="px-4 py-2 border border-slate-200 rounded-lg font-bold text-sm">Cancel</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default OrgManager;
