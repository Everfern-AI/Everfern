/**
 * Project Creator UI - Like Cursor's project creation
 */

import { useState } from 'react';

export function ProjectCreator({ onProjectCreate, isCreating = false }: any) {
  const [template, setTemplate] = useState('react-vite');
  const [projectName, setProjectName] = useState('');
  const [projectPath, setProjectPath] = useState('C:/Users/user/Downloads/EverFern/projects');

  const templates = [
    { value: 'react-vite', label: 'React + Vite + TypeScript', icon: '⚛' },
    { value: 'nextjs', label: 'Next.js (App Router)', icon: '▲' },
    { value: 'express-api', label: 'Express API (TypeScript)', icon: '🚀' },
  ];

  const handleCreate = () => {
    if (projectName && onProjectCreate) {
      onProjectCreate(template, projectName, projectPath);
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>
        🛠️ Create New Project
      </h2>

      <div style={{ backgroundColor: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        {/* Project Name */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ fontSize: '13px', fontWeight: 500, display: 'block', marginBottom: '6px' }}>
            Project Name
          </label>
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="my-awesome-app"
            style={{
              width: '100%',
              padding: '10px 12px',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              fontSize: '14px',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Template Selection */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ fontSize: '13px', fontWeight: 500, display: 'block', marginBottom: '6px' }}>
            Template
          </label>
          <select
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              fontSize: '14px',
              backgroundColor: 'white',
              cursor: 'pointer',
            }}
          >
            {templates.map(t => (
              <option key={t.value} value={t.value}>
                {t.icon} {t.label}
              </option>
            ))}
          </select>
        </div>

        {/* Location */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ fontSize: '13px', fontWeight: 500, display: 'block', marginBottom: '6px' }}>
            Location
          </label>
          <input
            type="text"
            value={projectPath}
            onChange={(e) => setProjectPath(e.target.value)}
            placeholder="C:/path/to/projects"
            style={{
              width: '100%',
              padding: '10px 12px',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              fontSize: '14px',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={handleCreate}
            disabled={!projectName || isCreating}
            style={{
              flex: 1,
              padding: '10px 20px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: (!projectName || isCreating) ? '#9ca3af' : '#3b82f6',
              color: 'white',
              fontSize: '14px',
              fontWeight: 500,
              cursor: (!projectName || isCreating) ? 'not-allowed' : 'pointer',
            }}
          >
            {isCreating ? '⏳ Creating...' : '🚀 Create Project'}
          </button>
          
          <button
            onClick={() => window.open('http://localhost:3000', '_blank')}
            style={{
              padding: '10px 20px',
              borderRadius: '8px',
              border: '1px solid #e5e7eb',
              backgroundColor: 'white',
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            👁 Preview
          </button>
        </div>

        <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '12px', margin: 0 }}>
          💡 Tip: After creation, run 'npm install' and 'npm run dev' to start developing
        </p>
      </div>
    </div>
  );
}
