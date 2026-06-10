import { useState } from 'react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (project: { template: string; name: string; location: string }) => void;
}

export default function CreateProjectModal({ isOpen, onClose, onCreated }: Props) {
  const [template, setTemplate] = useState('react-vite');
  const [name, setName] = useState('');
  const [location, setLocation] = useState('C:/Users/user/Downloads/EverFern/projects');

  if (!isOpen) return null;

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
      <div style={{ backgroundColor: 'white', borderRadius: '12px', padding: '24px', maxWidth: '500px', width: '90%' }}>
        <h2>🛠️ Create Project</h2>
        <div style={{ marginBottom: '12px' }}>
          <label>Project Name</label>
          <input value={name} onChange={e => setName(e.target.value)} style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: '6px' }} />
        </div>
        <div style={{ marginBottom: '12px' }}>
          <label>Template</label>
          <select value={template} onChange={e => setTemplate(e.target.value)} style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: '6px' }}>
            <option value="react-vite">React + Vite</option>
            <option value="nextjs">Next.js</option>
            <option value="express-api">Express API</option>
          </select>
        </div>
        <div style={{ marginBottom: '12px' }}>
          <label>Location</label>
          <input value={location} onChange={e => setLocation(e.target.value)} style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: '6px' }} />
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', border: '1px solid #ccc', borderRadius: '6px', cursor: 'pointer' }}>Cancel</button>
          <button 
            onClick={() => { if (name && onCreated) { onCreated({ template, name, location }); }}}
            disabled={!name}
            style={{ padding: '8px 16px', backgroundColor: !name ? '#ccc' : '#0070f3', color: 'white', border: 'none', borderRadius: '6px', cursor: !name ? 'not-allowed' : 'pointer' }}
          >
            🚀 Create
          </button>
        </div>
      </div>
    </div>
  );
}
