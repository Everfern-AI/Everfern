/**
 * IDE Pane - Cursor-like interface integrated in chat
 * Simplified version without TypeScript errors
 */

import { useState } from 'react';

export function IDEPane({ visible = true }: any) {
  const [activeTab, setActiveTab] = useState('explorer');
  const [selectedFile, setSelectedFile] = useState('src/App.tsx');

  if (!visible) return null;

  const files = [
    { path: 'src/App.tsx', icon: '⚛' },
    { path: 'src/main.tsx', icon: '⚛' },
    { path: 'src/App.css', icon: '🎨' },
    { path: 'index.html', icon: '📄' },
  ];

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: '12px', overflow: 'hidden', backgroundColor: '#1e1e1e', color: '#d4d4d4', fontFamily: 'monospace', fontSize: '13px', margin: '16px 0', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', backgroundColor: '#2d2d2d', borderBottom: '1px solid #3e3e42' }}>
        <span style={{ fontSize: '11px', color: '#858587', marginRight: '8px' }}>⚙</span>
        <span style={{ fontSize: '12px', fontWeight: 500 }}>EverFern IDE</span>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '2px' }}>
          <button onClick={() => setActiveTab('explorer')} style={{ padding: '4px 12px', border: 'none', borderRadius: '6px', backgroundColor: activeTab === 'explorer' ? '#3e3e42' : 'transparent', color: activeTab === 'explorer' ? 'var(--color-bg-surface)' : '#858587', cursor: 'pointer', fontSize: '11px' }}>📂 Explorer</button>
          <button onClick={() => setActiveTab('editor')} style={{ padding: '4px 12px', border: 'none', borderRadius: '6px', backgroundColor: activeTab === 'editor' ? '#3e3e42' : 'transparent', color: activeTab === 'editor' ? 'var(--color-bg-surface)' : '#858587', cursor: 'pointer', fontSize: '11px' }}>⚛ Editor</button>
          <button onClick={() => setActiveTab('terminal')} style={{ padding: '4px 12px', border: 'none', borderRadius: '6px', backgroundColor: activeTab === 'terminal' ? '#3e3e42' : 'transparent', color: activeTab === 'terminal' ? 'var(--color-bg-surface)' : '#858587', cursor: 'pointer', fontSize: '11px' }}>💻 Terminal</button>
        </div>
      </div>

      {/* Body */}
      <div style={{ display: 'flex', height: '400px' }}>
        {/* Sidebar */}
        {activeTab === 'explorer' && (
          <div style={{ width: '200px', borderRight: '1px solid #3e3e42', padding: '8px', overflowY: 'auto' }}>
            <div style={{ fontSize: '10px', color: '#858587', marginBottom: '8px', textTransform: 'uppercase' }}>Explorer</div>
            {files.map((f: any) => (
              <div
                key={f.path}
                onClick={() => { setSelectedFile(f.path); setActiveTab('editor'); }}
                style={{ padding: '4px 8px', cursor: 'pointer', backgroundColor: selectedFile === f.path ? '#37373d' : 'transparent', borderRadius: '4px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <span>{f.icon}</span>
                <span>{f.path.split('/').pop()}</span>
              </div>
            ))}
          </div>
        )}

        {/* Main Content */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {activeTab === 'editor' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', padding: '6px 12px', backgroundColor: '#2d2d2d', borderBottom: '1px solid #3e3e42', fontSize: '12px' }}>
                <span style={{ marginRight: '6px' }}>⚛</span>
                {selectedFile}
              </div>
              <pre style={{ flex: 1, margin: 0, padding: '12px', overflow: 'auto', backgroundColor: '#1e1e1e', color: '#d4d4d4', fontSize: '13px', lineHeight: '1.5', whiteSpace: 'pre' }}>
                <code>{`import { useState } from 'react';\n\nexport default function App() {\n  const [count, setCount] = useState(0);\n  return <div>{count}</div>;\n}`}</code>
              </pre>
            </>
          )}

          {activeTab === 'terminal' && (
            <div style={{ flex: 1, padding: '12px', backgroundColor: '#1e1e1e', overflowY: 'auto', fontFamily: 'monospace' }}>
              <div style={{ color: '#6a9955', marginBottom: '2px' }}>$ npm install</div>
              <div style={{ marginBottom: '2px' }}>added 124 packages in 12s</div>
              <div style={{ color: '#6a9955', marginBottom: '2px' }}>$ npm run dev</div>
              <div>VITE v5.0.8  ready in 450 ms</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default IDEPane;
