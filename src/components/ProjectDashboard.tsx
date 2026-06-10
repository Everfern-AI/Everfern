/**
 * Project Dashboard - Show created projects like Cursor's sidebar
 */

import { useState } from 'react';

export interface ProjectInfo {
  name: string;
  path: string;
  template: string;
  createdAt: string;
  lastOpened?: string;
  port?: number;
}

export function ProjectDashboard() {
  const [projects, setProjects] = useState<ProjectInfo[]>([
    {
      name: 'my-react-app',
      path: 'C:/Users/user/Downloads/EverFern/projects/my-react-app',
      template: 'React + Vite',
      createdAt: '2026-05-07',
      port: 5173,
    },
  ]);

  const openProject = (path: string) => {
    console.log('Opening project:', path);
    // Trigger file open in editor
  };

  const startDev = (project: ProjectInfo) => {
    console.log('Starting dev server for:', project.name);
    // Execute npm run dev
  };

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '16px' }}>
        📁 My Projects
      </h2>

      <div style={{ display: 'grid', gap: '12px' }}>
        {projects.map((proj, idx) => (
          <div
            key={idx}
            style={{
              padding: '16px',
              borderRadius: '8px',
              border: '1px solid #e5e7eb',
              backgroundColor: 'white',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 4px 0' }}>
                {proj.name}
              </h3>
              <p style={{ fontSize: '12px', color: '#6b7280', margin: 0 }}>
                {proj.template} • {proj.path}
              </p>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => openProject(proj.path)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: '1px solid #e5e7eb',
                  backgroundColor: 'white',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                📂 Open
              </button>
              {proj.port && (
                <button
                  onClick={() => startDev(proj)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    backgroundColor: '#3b82f6',
                    color: 'white',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '13px',
                  }}
                >
                  ▶ Dev (:{proj.port})
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <button
        style={{
          marginTop: '16px',
          padding: '10px 20px',
          borderRadius: '8px',
          backgroundColor: '#10b981',
          color: 'white',
          border: 'none',
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: 500,
        }}
        onClick={() => console.log('Create new project')}
      >
        ➕ New Project
      </button>
    </div>
  );
}
