'use client';
import React, { useState, useEffect } from 'react';
import { useTheme } from '@/components/common/ThemeProvider';
import { SectionTitle, SectionSubtitle, Card } from './ui';
/**
 * Linux VM & skill-environment settings. Detects the platform-specific sandbox
 * (Docker on macOS, native on Linux, WSL 2 on Windows), offers install/setup
 * flows for it, and tracks the Python venv + pip toolchain provisioning with
 * live streamed progress from IPC events.
 */
export const LinuxVMSection = () => {
    const { theme } = useTheme();
    const [wslStatus, setWslStatus] = useState<{ installed: boolean | null; healthy: boolean | null; osName?: string; uptime?: string }>({ installed: null, healthy: null });
    const [platform, setPlatform] = useState<string | null>(null);
    const [isInstalling, setIsInstalling] = useState(false);
    const [installError, setInstallError] = useState('');
    const [installWarning, setInstallWarning] = useState('');

    const [depsStatus, setDepsStatus] = useState<any>(null);
    const [depsLoading, setDepsLoading] = useState(false);
    const [depsInstalling, setDepsInstalling] = useState(false);
    const [depsMessage, setDepsMessage] = useState('');
    const [depsProgress, setDepsProgress] = useState<{
        percent: number;
        step: number;
        title: string;
        detail: string;
    }>({
        percent: 0,
        step: 0,
        title: '',
        detail: ''
    });

    /**
     * Probe the sandbox toolchain (Python/Node runtimes, venv, pip packages)
     * over IPC. The result drives the two readiness cards; called after any
     * sandbox install/setup completes and once on mount when a sandbox exists.
     */
    const checkDeps = async () => {
        setDepsLoading(true);
        try {
            const electronAPI = (window as any).electronAPI;
            if (electronAPI?.system?.checkEnvironmentDependencies) {
                const res = await electronAPI.system.checkEnvironmentDependencies();
                setDepsStatus(res);
            }
        } catch (err) {
            console.error('Failed to check dependencies', err);
        } finally {
            setDepsLoading(false);
        }
    };

    useEffect(() => {
        const check = async () => {
            try {
                const plat = await (window as any).electronAPI?.system?.getPlatform?.();
                setPlatform(plat || 'win32');

                // The "Linux VM" is a different concrete thing per OS: Docker
                // (Ubuntu container) on darwin, the host itself on linux, and
                // WSL 2 on Windows. Probe the matching runtime and only check
                // toolchain deps if a sandbox actually exists.
                if (plat === 'darwin') {
                    const isInstalled = await (window as any).electronAPI?.system?.checkDocker?.();
                    if (isInstalled) {
                        setWslStatus({ installed: true, healthy: true, osName: 'Docker (Ubuntu)', uptime: 'Active' });
                        checkDeps();
                    } else {
                        setWslStatus({ installed: false, healthy: null });
                    }
                } else if (plat === 'linux') {
                    setWslStatus({ installed: true, healthy: true, osName: 'Native Linux', uptime: 'Active' });
                    checkDeps();
                } else {
                    const isInstalled = await (window as any).electronAPI?.system?.checkWSL?.();
                    if (isInstalled) {
                        const info = await (window as any).electronAPI?.system?.getWSLInfo?.();
                        setWslStatus({ installed: true, healthy: info?.healthy, osName: info?.osName, uptime: info?.uptime });
                        checkDeps();
                    } else {
                        setWslStatus({ installed: false, healthy: null });
                    }
                }
            } catch (e) {
                console.error('Failed to check WSL/Docker', e);
                setWslStatus({ installed: false, healthy: null });
            }
        };
        check();
    }, []);

    // Listen to real-time setup logs
    useEffect(() => {
        const electronAPI = (window as any).electronAPI;
        if (electronAPI?.system?.onVMSetupLog) {
            electronAPI.system.onVMSetupLog((data: { timestamp: string; message: string; level?: string; step?: number }) => {
                if (data.step) {
                    // Backend emits a 1-5 step number; map it to a coarse percent
                    // (each step = +20%, clamped 15-100) and a human title.
                    const stepNum = data.step;
                    const stepPct = Math.min(100, Math.max(15, stepNum * 20));
                    const stepTitles: Record<number, string> = {
                        1: "Initializing VM sandbox & resource limits...",
                        2: "Verifying Python 3 & Node.js runtimes...",
                        3: "Provisioning isolated virtualenv (~/.everfern/venv)...",
                        4: "Installing pypdf, pandas, python-pptx, openpyxl, matplotlib, docx...",
                        5: "Toolchain setup complete & verified ✓"
                    };
                    setDepsProgress({
                        percent: stepPct,
                        step: stepNum,
                        title: stepTitles[stepNum] || data.message,
                        detail: data.message
                    });
                } else if (data.message) {
                    // No step number — treat as an in-progress log line and only
                    // update the detail text, keeping the last known percent/step.
                    setDepsProgress(prev => ({
                        ...prev,
                        detail: data.message
                    }));
                }
            });

            // Teardown: drop the IPC log listener so remounts (tab switches)
            // don't stack duplicate handlers writing into stale state.
            return () => {
                electronAPI.system.removeVMSetupLogListeners?.();
            };
        }
    }, []);

    const handleInstall = async () => {
        setIsInstalling(true);
        setInstallError('');
        setInstallWarning('');
        try {
            // Platform may still be null if the user clicks before the
            // mount-time probe resolves — re-fetch rather than assume.
            const plat = platform || await (window as any).electronAPI?.system?.getPlatform?.();
            if (plat === 'darwin') {
                // Re-probe Docker here: the mount-time check may be stale by
                // the time the user clicks, and setup would hang without it.
                const dockerAvailable = await (window as any).electronAPI?.system?.checkDocker?.();
                if (!dockerAvailable) {
                    window.open("https://www.docker.com/products/docker-desktop", "_blank");
                    setInstallError("Docker Desktop is not running or not installed. We have opened the Docker Desktop download page in your browser. Please install, start Docker Desktop, and try installing again.");
                    return;
                }
                const res = await (window as any).electronAPI?.system?.setupDockerUbuntu?.();
                if (res?.success) {
                    setWslStatus({ installed: true, healthy: true, osName: 'Docker (Ubuntu)', uptime: 'Active (just now)' });
                    checkDeps();
                } else {
                    setInstallError(res?.error || 'Failed to set up Docker Ubuntu container.');
                }
            } else {
                // Catch-all: every non-darwin/non-linux platform (win32 or
                // anything unknown) takes the WSL 2 install path.
                const res = await (window as any).electronAPI?.system?.installWSL?.();
                if (res?.success) {
                    setWslStatus({ installed: true, healthy: true, osName: 'Ubuntu', uptime: 'Active (just now)' });
                    if (res.warning) setInstallWarning(res.warning);
                    checkDeps();
                } else {
                    setInstallError(res?.error || 'Failed to install Linux VM.');
                }
            }
        } catch (e: any) {
            setInstallError(e.message || 'Unknown error occurred.');
        } finally {
            setIsInstalling(false);
        }
    };

    const handleInstallDependencies = async () => {
        // Seed optimistic progress (15% / step 1) so the progress bar is visible
        // immediately — real increments only arrive via the VM setup log events.
        setDepsInstalling(true);
        setDepsProgress({
            percent: 15,
            step: 1,
            title: 'Starting environment setup...',
            detail: 'Connecting to VM runtime...'
        });
        setDepsMessage('');

        try {
            const electronAPI = (window as any).electronAPI;
            if (electronAPI?.system?.setupEnvironmentDependencies) {
                const res = await electronAPI.system.setupEnvironmentDependencies();
                if (!res?.success) {
                    throw new Error(res?.error || 'Failed to install dependencies');
                }
            }
            setDepsProgress({
                percent: 100,
                step: 5,
                title: 'All dependencies installed successfully!',
                detail: 'Toolchain ready'
            });
            await checkDeps();
            setDepsMessage('✓ All dependencies installed and ready!');
            // Success path is transient: show the ✓ banner for 4s, then wipe
            // both the message and the progress state so a subsequent install
            // starts from a clean bar instead of a stale 100%.
            setTimeout(() => {
                setDepsMessage('');
                setDepsProgress({ percent: 0, step: 0, title: '', detail: '' });
            }, 4000);
        } catch (err: any) {
            setDepsMessage(`❌ ${err?.message || 'Installation failed'}`);
        } finally {
            setDepsInstalling(false);
        }
    };

    return (
        <div style={{ animation: 'fadeIn 0.3s ease' }}>
            <SectionTitle>Linux VM & Skill Environment</SectionTitle>
            <SectionSubtitle>
                {platform === 'darwin'
                    ? 'Manage the local Linux sandbox (Docker) and Python virtual environment used by EverFern for file skills, PDF processing, spreadsheets, and code execution.'
                    : platform === 'linux'
                    ? 'Manage the local Linux toolchain and Python virtual environment used by EverFern for advanced tasks and code execution.'
                    : 'Manage the local Linux virtual machine (WSL 2) and Python virtual environment used by EverFern for advanced tasks, PDF generation, spreadsheets, and code execution.'}
            </SectionSubtitle>

            {/* Sandbox VM Status */}
            <Card>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width={20} height={20}>
                                <path fill="#DD4814" d="M64 3.246C30.445 3.246 3.245 30.446 3.245 64c0 33.552 27.2 60.754 60.755 60.754 33.554 0 60.755-27.202 60.755-60.754 0-33.554-27.2-60.754-60.755-60.754zm13.631 20.922a8.108 8.108 0 1114.046 8.108A8.105 8.105 0 0180.6 35.243a8.11 8.11 0 01-2.969-11.075zM64 28.763c3.262 0 6.417.453 9.414 1.281a11.357 11.357 0 005.548 8.042 11.378 11.378 0 009.725.789c5.998 5.898 9.901 13.919 10.47 22.854l-11.558.17C86.532 49.796 76.377 40.306 64 40.306a23.6 23.6 0 00-9.98 2.203L48.383 32.41A35.116 35.116 0 0164 28.763zM22.689 72.112A8.112 8.112 0 0114.576 64a8.111 8.111 0 018.113-8.113 8.113 8.113 0 010 16.225zm7.191.722A11.377 11.377 0 0034.08 64c0-3.565-1.639-6.747-4.2-8.836 2.194-8.489 7.475-15.738 14.571-20.483l5.931 9.934C44.29 48.902 40.308 55.984 40.308 64s3.981 15.098 10.074 19.383l-5.931 9.937c-7.099-4.744-12.38-11.995-14.571-20.486zm58.831 33.964a8.105 8.105 0 01-11.077-2.969c-2.241-3.877-.911-8.835 2.969-11.076 3.877-2.239 8.838-.908 11.077 2.969a8.106 8.106 0 01-2.969 11.076zm-.024-17.673a11.357 11.357 0 00-9.725.788 11.36 11.36 0 00-5.547 8.042A35.232 35.232 0 0164 99.239a35.097 35.097 0 01-15.616-3.649l5.636-10.1A23.6 23.6 0 0064 87.694c12.378 0 22.532-9.488 23.596-21.592l11.561.169c-.569 8.935-4.472 16.956-10.47 22.854z"/>
                            </svg>
                            <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                                {platform === 'darwin' ? 'Docker Container (Ubuntu)' : platform === 'linux' ? 'Linux Environment' : 'Windows Subsystem for Linux (Ubuntu)'}
                            </h3>
                            {wslStatus.installed === null ? (
                                <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>Checking...</span>
                            ) : wslStatus.installed ? (
                                <span style={{ fontSize: 12, fontWeight: 600, color: wslStatus.healthy ? '#10b981' : '#f59e0b', padding: '2px 8px', backgroundColor: wslStatus.healthy ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)', borderRadius: 12 }}>
                                    {wslStatus.healthy ? 'Healthy' : 'Unresponsive'}
                                </span>
                            ) : (
                                <span style={{ fontSize: 12, fontWeight: 600, color: '#ef4444', padding: '2px 8px', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: 12 }}>
                                    {platform === 'darwin' ? 'Docker Not Ready' : 'Not Installed'}
                                </span>
                            )}
                        </div>
                        <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', margin: 0 }}>
                            {wslStatus.installed === false 
                                ? (platform === 'darwin' 
                                    ? 'Docker is required to run the Linux VM on macOS.'
                                    : platform === 'linux'
                                    ? 'A Linux environment is required for many tools to function properly.'
                                    : 'A Linux VM (WSL) is required for many tools to function properly on Windows.')
                                : wslStatus.osName ? `OS: ${wslStatus.osName}` : 'Virtual machine environment'}
                        </p>
                        {wslStatus.uptime && (
                            <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: '4px 0 0 0' }}>
                                Status: {wslStatus.uptime}
                            </p>
                        )}
                    </div>

                    {wslStatus.installed === false && (
                        <button
                            onClick={handleInstall}
                            disabled={isInstalling}
                            style={{
                                padding: '8px 16px',
                                backgroundColor: theme === 'dark' ? '#000000' : 'var(--color-text-primary)',
                                color: theme === 'dark' ? '#ffffff' : 'var(--color-text-inverse)',
                                border: theme === 'dark' ? '1px solid var(--color-border)' : 'none',
                                borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: isInstalling ? 'not-allowed' : 'pointer',
                                opacity: isInstalling ? 0.7 : 1, transition: 'opacity 0.2s'
                            }}
                        >
                            {isInstalling ? 'Installing...' : (platform === 'darwin' ? 'Set up Linux VM' : 'Install Linux VM')}
                        </button>
                    )}
                </div>
                
                {installError && (
                    <div style={{ marginTop: 12, padding: 12, backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 8 }}>
                        <p style={{ fontSize: 13, color: '#ef4444', margin: 0, fontWeight: 500 }}>{installError}</p>
                    </div>
                )}
                {installWarning && (
                    <div style={{ marginTop: 12, padding: 12, backgroundColor: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: 8 }}>
                        <p style={{ fontSize: 13, color: '#f59e0b', margin: 0, fontWeight: 500 }}>{installWarning}</p>
                    </div>
                )}
            </Card>

            {/* Skill Toolchain & Dependencies */}
            {wslStatus.installed && (
                <Card style={{ marginTop: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                        <div>
                            <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                                Skill Toolchain & Dependencies
                            </h3>
                            <p style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)', margin: '4px 0 0 0' }}>
                                Pre-installed Python virtual environment (<code>~/.everfern/venv</code>) and Node.js packages for document processing.
                            </p>
                        </div>
                        <button
                            onClick={handleInstallDependencies}
                            disabled={depsInstalling || depsLoading}
                            style={{
                                padding: '6px 14px',
                                backgroundColor: 'var(--color-bg-subtle)',
                                color: 'var(--color-text-primary)',
                                border: '1px solid var(--color-border)',
                                borderRadius: 8,
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: (depsInstalling || depsLoading) ? 'wait' : 'pointer',
                                transition: 'all 0.15s'
                            }}
                        >
                            {depsInstalling ? 'Installing...' : depsLoading ? 'Checking...' : 'Re-install / Verify'}
                        </button>
                    </div>

                    {/* Live Progress Bar when Installing / Verifying */}
                    {depsInstalling && (
                        <div style={{
                            padding: '14px 16px',
                            borderRadius: 10,
                            backgroundColor: 'var(--color-bg-subtle)',
                            border: '1px solid var(--color-border)',
                            marginBottom: 14,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', backgroundColor: '#10b981', animation: 'pulse 1.5s infinite' }} />
                                    {depsProgress.title || 'Installing packages in background...'}
                                </span>
                                <span style={{ fontSize: 12, fontWeight: 700, color: '#10b981' }}>
                                    {depsProgress.percent}%
                                </span>
                            </div>

                            {/* Animated Progress Bar Track & Fill */}
                            <div style={{
                                width: '100%',
                                height: 8,
                                borderRadius: 6,
                                backgroundColor: 'var(--color-bg-surface)',
                                border: '1px solid var(--color-border-subtle)',
                                overflow: 'hidden'
                            }}>
                                <div style={{
                                    height: '100%',
                                    width: `${depsProgress.percent}%`,
                                    background: 'linear-gradient(90deg, #10b981 0%, #059669 100%)',
                                    borderRadius: 6,
                                    transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
                                }} />
                            </div>

                            {depsProgress.detail && (
                                <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontFamily: 'monospace' }}>
                                    {depsProgress.detail}
                                </span>
                            )}
                        </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
                        {/* Python 3 & Node.js */}
                        <div style={{ padding: '14px 16px', borderRadius: 10, backgroundColor: 'var(--color-bg-subtle)', border: '1px solid var(--color-border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div style={{ position: 'relative', width: 38, height: 34, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                                    <img
                                        src="/images/etc/python.png"
                                        alt="Python"
                                        style={{ width: 26, height: 26, objectFit: 'contain', position: 'absolute', top: 0, left: 0, zIndex: 2 }}
                                    />
                                    <img
                                        src="/images/etc/node-js.svg"
                                        alt="Node.js"
                                        style={{ width: 22, height: 22, objectFit: 'contain', position: 'absolute', bottom: 0, right: 0, zIndex: 3, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.15))' }}
                                    />
                                </div>
                                <div>
                                    <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                        Python 3 &amp; Node.js Environment
                                    </div>
                                    <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                                        {depsStatus?.pythonVersion || 'Python 3'} · {depsStatus?.nodeVersion || 'Node.js'} · <code style={{ fontSize: 10.5 }}>~/.everfern/venv</code>
                                    </div>
                                </div>
                            </div>
                            <span style={{ fontSize: 11.5, fontWeight: 600, color: depsStatus?.pythonInstalled && depsStatus?.nodeInstalled && depsStatus?.venvReady ? '#10b981' : '#f59e0b' }}>
                                {depsStatus?.pythonInstalled && depsStatus?.nodeInstalled && depsStatus?.venvReady ? '✓ Ready' : 'Incomplete'}
                            </span>
                        </div>

                        {/* Dependencies */}
                        <div style={{ padding: '14px 16px', borderRadius: 10, backgroundColor: 'var(--color-bg-subtle)', border: '1px solid var(--color-border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div style={{ width: 38, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                    <img
                                        src="/images/etc/pip.png"
                                        alt="Dependencies"
                                        style={{ width: 36, height: 36, objectFit: 'contain' }}
                                    />
                                </div>
                                <div>
                                    <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                        Dependencies
                                    </div>
                                    <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                                        pypdf, pandas, python-pptx, openpyxl, matplotlib, docx
                                    </div>
                                </div>
                            </div>
                            <span style={{ fontSize: 11.5, fontWeight: 600, color: depsStatus?.pipPackagesInstalled ? '#10b981' : '#f59e0b' }}>
                                {depsStatus?.pipPackagesInstalled ? '✓ Ready' : 'Incomplete'}
                            </span>
                        </div>
                    </div>

                    {depsMessage && (
                        <div style={{ marginTop: 12, padding: 10, borderRadius: 8, backgroundColor: 'rgba(32,30,36,0.03)', border: '1px solid var(--color-border-subtle)', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                            {depsMessage}
                        </div>
                    )}
                </Card>
            )}
        </div>
    );
};
