import { useState, useEffect, useCallback } from 'react';

interface IDEModeProps {
  visible?: boolean;
  onClose?: () => void;
  projectPath?: string | null;
}

export default function IDEMode({ visible, onClose, projectPath }: IDEModeProps) {
  const [activeTab, setActiveTab] = useState<'files' | 'editor' | 'terminal'>('files');
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [loading, setLoading] = useState(false);

  const loadFiles = useCallback(async () => {
    if (!projectPath) {
      setFiles([]);
      return;
    }
    setLoading(true);
    try {
      const result = await (window as any).electronAPI?.projects?.listFiles?.(projectPath);
      if (result?.files) {
        setFiles(result.files);
      }
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    if (visible && projectPath) {
      loadFiles();
    }
  }, [visible, projectPath, loadFiles]);

  const handleFileSelect = async (filePath: string) => {
    setSelectedFile(filePath);
    setActiveTab('editor');
    setLoading(true);
    try {
      const content = await (window as any).electronAPI?.projects?.readFile?.(projectPath, filePath);
      setFileContent(content || '');
    } catch {
      setFileContent('// Unable to read file');
    } finally {
      setLoading(false);
    }
  };

  if (!visible) return null;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-primary)" strokeWidth="1.5" style={{ marginRight: 6 }}>
            <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
          </svg>
          Code
        </span>
        <span style={styles.path}>{projectPath || 'No project'}</span>
        {onClose && (
          <button onClick={onClose} style={styles.closeBtn} title="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        )}
      </div>

      <div style={styles.tabBar}>
        <button onClick={() => setActiveTab('files')} style={tabBtnStyle(activeTab === 'files')}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginRight: 4 }}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          Files
        </button>
        <button onClick={() => setActiveTab('editor')} style={tabBtnStyle(activeTab === 'editor')}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginRight: 4 }}><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          Editor
        </button>
        <button onClick={() => setActiveTab('terminal')} style={tabBtnStyle(activeTab === 'terminal')}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginRight: 4 }}><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
          Terminal
        </button>
      </div>

      <div style={styles.body}>
        {activeTab === 'files' && (
          <div style={styles.fileList}>
            {!projectPath && (
              <div style={styles.emptyState}>No project selected</div>
            )}
            {projectPath && loading && files.length === 0 && (
              <div style={styles.emptyState}>Loading...</div>
            )}
            {projectPath && !loading && files.length === 0 && (
              <div style={styles.emptyState}>No files found</div>
            )}
            {files.map((f: string) => (
              <div
                key={f}
                onClick={() => handleFileSelect(f)}
                style={fileItemStyle(f === selectedFile)}
              >
                <span style={{ marginRight: 6, fontSize: 13 }}>
                  {f.endsWith('/') ? '📁' : getFileIcon(f)}
                </span>
                {f}
              </div>
            ))}
          </div>
        )}

        {activeTab === 'editor' && (
          <div style={styles.editor}>
            {!selectedFile && (
              <div style={styles.emptyState}>Select a file to view</div>
            )}
            {selectedFile && loading && (
              <div style={styles.emptyState}>Loading...</div>
            )}
            {selectedFile && !loading && (
              <pre style={styles.code}>
                {fileContent.split('\n').map((line: string, i: number) => (
                  <div key={i} style={styles.codeLine}>
                    <span style={styles.lineNum}>{i + 1}</span>
                    <span style={{ color: 'var(--color-text-primary)' }}>{line}</span>
                  </div>
                ))}
              </pre>
            )}
          </div>
        )}

        {activeTab === 'terminal' && (
          <div style={styles.terminal}>
            <div style={styles.termLine}><span style={styles.prompt}>$</span> Ready</div>
          </div>
        )}
      </div>
    </div>
  );
}

function getFileIcon(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: '💙', tsx: '💙', js: '💛', jsx: '💛', py: '🐍',
    json: '📋', css: '🎨', html: '🌐', md: '📄',
    svg: '🖼️', png: '🖼️', jpg: '🖼️',
  };
  return map[ext] || '📄';
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: 'var(--color-bg-surface)',
    color: 'var(--color-text-primary)',
    fontFamily: "'Figtree', system-ui, sans-serif",
    fontSize: 13,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 14px',
    borderBottom: '1px solid var(--color-border)',
    gap: 8,
  },
  title: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--color-text-primary)',
    display: 'flex',
    alignItems: 'center',
  },
  path: {
    fontSize: 11,
    color: 'var(--color-text-secondary)',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  closeBtn: {
    width: 28,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: 6,
    backgroundColor: 'transparent',
    color: 'var(--color-text-secondary)',
    cursor: 'pointer',
    flexShrink: 0,
  },
  tabBar: {
    display: 'flex',
    gap: 2,
    padding: '6px 10px',
    borderBottom: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-subtle)',
  },
  body: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
  },
  fileList: {
    flex: 1,
    overflowY: 'auto',
    padding: '6px 0',
  },
  emptyState: {
    padding: '24px 16px',
    textAlign: 'center',
    color: 'var(--color-text-tertiary)',
    fontSize: 12,
  },
  editor: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  code: {
    flex: 1,
    margin: 0,
    padding: '12px 16px',
    overflow: 'auto',
    fontSize: 12,
    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
    lineHeight: 1.6,
  },
  codeLine: {
    display: 'flex',
  },
  lineNum: {
    color: 'var(--color-text-tertiary)',
    marginRight: 16,
    userSelect: 'none',
    minWidth: 24,
    textAlign: 'right',
  },
  terminal: {
    flex: 1,
    padding: '12px 16px',
    overflowY: 'auto',
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    fontSize: 12,
    color: 'var(--color-text-primary)',
  },
  termLine: {
    marginBottom: 4,
  },
  prompt: {
    color: 'var(--color-accent)',
    marginRight: 8,
  },
};

function tabBtnStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    padding: '5px 10px',
    border: 'none',
    borderRadius: 6,
    backgroundColor: active ? 'var(--color-bg-selected)' : 'transparent',
    color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 500,
    transition: '0.15s',
  };
}

function fileItemStyle(selected: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    padding: '5px 14px',
    cursor: 'pointer',
    fontSize: 12,
    color: 'var(--color-text-primary)',
    backgroundColor: selected ? 'var(--color-bg-selected)' : 'transparent',
    transition: 'background 0.1s',
  };
}
