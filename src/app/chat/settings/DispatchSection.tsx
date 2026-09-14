'use client';
import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { ExclamationTriangleIcon, ServerIcon } from '@heroicons/react/24/outline';
import { SectionTitle, SectionSubtitle, Card } from './ui';
/**
 * EverFern Dispatch settings: start/stop a remote-control bridge that pairs
 * this desktop with EverFern Cloud via a 6-digit PIN (enterable at
 * everfern.app/dispatch). Also lists and revokes other active sessions.
 * Requires an EverFern Cloud login (isCloudUser).
 */
export const DispatchSection = ({ isCloudUser }: { isCloudUser: boolean }) => {
    const [status, setStatus] = useState<'idle' | 'pending' | 'connected' | 'error'>('idle');
    const [sessionId, setSessionId] = useState('');
    const [pinCode, setPinCode] = useState('');
    const [isForever, setIsForever] = useState(false);
    const [existingSessions, setExistingSessions] = useState<any[]>([]);
    // NR-LEAK-02: unsubscribe functions for the onDispatchActive listeners
    // registered by this mount (restore flow + start flow), applied on unmount.
    const unsubscribeRef = useRef<Array<() => void>>([]);

    /**
     * Register a callback that flips status to 'connected' when the main
     * process reports the remote peer dialed in. Handles both the new
     * unsubscribe-returning API and the older offDispatchActive preload, and
     * records the teardown in unsubscribeRef for unmount cleanup.
     */
    const registerDispatchActiveListener = (): (() => void) | null => {
        const api = (window as any).electronAPI?.system;
        const cb = () => setStatus('connected');
        if (!api?.onDispatchActive) return null;
        // onDispatchActive now returns an unsubscribe fn; fall back to
        // offDispatchActive with the same cb for older preload builds.
        const unsub = api.onDispatchActive(cb);
        const teardown = typeof unsub === 'function'
            ? unsub
            : api.offDispatchActive
                ? () => api.offDispatchActive(cb)
                : null;
        if (teardown) {
            unsubscribeRef.current.push(teardown);
            return teardown;
        }
        return null;
    };

    useEffect(() => {
        return () => {
            unsubscribeRef.current.forEach((unsub) => unsub?.());
            unsubscribeRef.current = [];
        };
    }, []);

    /**
     * On mount (for cloud users): list the device's existing dispatch sessions
     * from the API, then ask the main process to silently restore any session
     * previously started on this machine (filling PIN/session state).
     */
    useEffect(() => {
        if (!isCloudUser) return;
        
        let restoreTeardown: (() => void) | null = null;
        const fetchSessionsAndRestore = async () => {
            const sessionStr = localStorage.getItem('everfern_cloud_session');
            if (!sessionStr) return;
            let session;
            try {
                session = JSON.parse(sessionStr);
            } catch {
                return;
            }
            if (!session?.accessToken) return;
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://api.everfern.app';
            
            // 1. Fetch existing sessions
            try {
                const res = await fetch(`${apiUrl.replace(/\/$/, '')}/api/dispatch/sessions`, {
                    headers: { 'Authorization': `Bearer ${session.accessToken}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.success) {
                        setExistingSessions(data.sessions || []);
                    }
                }
            } catch (e) {
                console.error("Failed to fetch sessions", e);
            }

            // 2. Try to restore active session for this device
            try {
                const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://api.everfern.app';
                const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'default_key';
                
                // Attach the 'connected' listener BEFORE awaiting
                // restoreDispatch — if the session is already active
                // remotely, the IPC event would fire with no listener.
                restoreTeardown = registerDispatchActiveListener();

                const restoreRes = await (window as any).electronAPI?.system?.restoreDispatch?.({ 
                    url, apiUrl, key, token: session.accessToken, userId: session.user?.id || session.user?.sub || session.user?.user_id || 'unknown'
                });

                if (restoreRes?.success && restoreRes.session) {
                    setSessionId(restoreRes.session.id);
                    setPinCode(restoreRes.session.pin_code);
                    setStatus(restoreRes.session.status === 'active' ? 'connected' : 'pending');
                }
            } catch (e) {
                console.error("Failed to restore session", e);
            }
        };
        fetchSessionsAndRestore();
        return () => {
            // NR-LEAK-02: if isCloudUser flips, drop this effect's listener
            // before the next run re-registers it.
            if (restoreTeardown) {
                restoreTeardown();
                const idx = unsubscribeRef.current.indexOf(restoreTeardown);
                if (idx !== -1) unsubscribeRef.current.splice(idx, 1);
            }
        };
    }, [isCloudUser]);

    // If startDispatch succeeds, stay in 'pending' — the transition to
    // 'connected' only happens when the remote peer actually dials in and the
    // main process fires the onDispatchActive IPC event.
    const handleStartDispatch = async () => {
        try {
            const newPin = Math.floor(100000 + Math.random() * 900000).toString();
            const newSessionId = crypto.randomUUID();
            
            setPinCode(newPin);
            setSessionId(newSessionId);
            setStatus('pending');

            const sessionStr = localStorage.getItem('everfern_cloud_session');
            if (!sessionStr) throw new Error("No cloud session found");
            const session = JSON.parse(sessionStr);
            if (!session?.accessToken) throw new Error("No access token found");
            
            const res = await (window as any).electronAPI?.system?.startDispatch?.({ 
                sessionId: newSessionId, 
                pinCode: newPin,
                url: process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://api.everfern.app',
                apiUrl: process.env.NEXT_PUBLIC_API_URL || 'https://api.everfern.app',
                key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'default_key',
                token: session.accessToken,
                userId: session.user?.id || session.user?.sub || session.user?.user_id || 'unknown',
                isForever
            });
            
            if (res?.success) {
                // Keep status as pending, wait for IPC event
                registerDispatchActiveListener();
            } else {
                setStatus('error');
            }
        } catch (e) {
            console.error(e);
            setStatus('error');
        }
    };

    const handleDisconnect = async () => {
        try {
            await (window as any).electronAPI?.system?.stopDispatch?.();
            setStatus('idle');
            setSessionId('');
            setPinCode('');
        } catch (e) {
            console.error(e);
        }
    };

    const handleStopExisting = async (id: string) => {
        try {
            // Guard: without a stored cloud session/token there's nothing to
            // authorize the DELETE against, so bail silently.
            const sessionStr = localStorage.getItem('everfern_cloud_session');
            if (!sessionStr) return;
            const session = JSON.parse(sessionStr);
            if (!session?.accessToken) return;
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://api.everfern.app';

            await fetch(`${apiUrl.replace(/\/$/, '')}/api/dispatch/session/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${session.accessToken}` }
            });
            
            setExistingSessions(prev => prev.filter(s => s.id !== id));
            
            // Optimistic UI: the row is already removed above; if the deleted
            // session was the locally active one, also tear down local dispatch.
            // If stopping current session
            if (id === sessionId) {
                handleDisconnect();
            }
        } catch (e) {
            console.error("Failed to stop session", e);
        }
    };

    if (!isCloudUser) {
        return (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <SectionTitle>EverFern Dispatch</SectionTitle>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, backgroundColor: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Beta</span>
                </div>
                <SectionSubtitle>Control your desktop remotely from EverFern Cloud.</SectionSubtitle>

                {/* Beta Warning Banner */}
                <div style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    padding: '14px 16px',
                    borderRadius: 12,
                    backgroundColor: 'rgba(245, 158, 11, 0.08)',
                    border: '1px solid rgba(245, 158, 11, 0.25)',
                    marginBottom: 20,
                }}>
                    <ExclamationTriangleIcon width={20} height={20} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 2 }} />
                    <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#f59e0b', marginBottom: 2 }}>
                            Experimental Beta Feature
                        </div>
                        <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                            EverFern Dispatch is currently in beta with known instability and connection issues. You may experience dropped sessions, latency, or out-of-sync states. We are actively refining remote dispatch reliability.
                        </div>
                    </div>
                </div>

                <Card style={{ textAlign: 'center', padding: '40px 20px' }}>
                    <ServerIcon width={48} height={48} style={{ color: 'var(--color-text-tertiary)', margin: '0 auto 16px' }} />
                    <h3 style={{ fontSize: 18, color: 'var(--color-text-primary)', margin: '0 0 8px' }}>EverFern Cloud Required</h3>
                    <p style={{ fontSize: 14, color: 'var(--color-text-tertiary)', margin: '0 auto', maxWidth: 400, lineHeight: 1.5 }}>
                        To use EverFern Dispatch, please log into EverFern Cloud in the <strong>Profile</strong> tab first.
                    </p>
                </Card>
            </motion.div>
        );
    }

    return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <SectionTitle>EverFern Dispatch</SectionTitle>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, backgroundColor: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Beta</span>
            </div>
            <SectionSubtitle>Connect your desktop to EverFern Cloud to control it remotely.</SectionSubtitle>

            {/* Beta Warning Banner */}
            <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: '14px 16px',
                borderRadius: 12,
                backgroundColor: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid rgba(245, 158, 11, 0.25)',
                marginBottom: 20,
            }}>
                <ExclamationTriangleIcon width={20} height={20} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 2 }} />
                <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#f59e0b', marginBottom: 2 }}>
                        Experimental Beta Feature — Known Issues & Active Development
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                        EverFern Dispatch is currently in active development and beta. You may encounter connection drops, high latency, or synchronization issues. We recommend keeping important sessions local while we work on stability improvements.
                    </div>
                </div>
            </div>

            <Card>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {status === 'idle' && (
                        <div style={{ textAlign: 'center', padding: '20px 0' }}>
                            <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 20 }}>
                                Start dispatch to generate a secure PIN. You can then enter this PIN on <strong>everfern.app/dispatch</strong> from your phone or another device.
                            </p>
                            
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 20 }}>
                                <input 
                                    type="checkbox" 
                                    id="foreverToggle" 
                                    checked={isForever} 
                                    onChange={(e) => setIsForever(e.target.checked)} 
                                    style={{ cursor: 'pointer' }}
                                />
                                <label htmlFor="foreverToggle" style={{ fontSize: 13, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
                                    Keep session active forever (default: 10 minutes)
                                </label>
                            </div>

                            <button
                                onClick={handleStartDispatch}
                                style={{ padding: '12px 24px', backgroundColor: 'var(--color-text-primary)', color: 'var(--color-text-inverse)', borderRadius: 12, fontWeight: 600, fontSize: 14, border: 'none', cursor: 'pointer' }}
                            >
                                Start Dispatch Session
                            </button>
                        </div>
                    )}

                    {(status === 'pending' || status === 'connected') && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, padding: '10px 0' }}>
                            <div style={{ textAlign: 'center' }}>
                                <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 8 }}>
                                    Your Dispatch PIN
                                </p>
                                <div style={{ fontSize: 42, letterSpacing: '0.2em', fontFamily: 'monospace', color: 'var(--color-text-primary)', fontWeight: 600, backgroundColor: 'var(--color-bg-subtle)', padding: '12px 32px', borderRadius: 16 }}>
                                    {pinCode}
                                </div>
                            </div>
                            
                            <div style={{ textAlign: 'center' }}>
                                <p style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
                                    Go to <a href="https://everfern.app/dispatch" target="_blank" rel="noreferrer" style={{ color: 'var(--color-text-primary)', fontWeight: 600, textDecoration: 'underline' }}>everfern.app/dispatch</a> and enter this PIN.
                                </p>
                            </div>

                            <div style={{ display: 'flex', gap: 12, marginTop: 8, alignItems: 'center' }}>
                                <button
                                    onClick={handleDisconnect}
                                    style={{ padding: '10px 20px', backgroundColor: 'var(--color-error-dim)', color: 'var(--color-error)', borderRadius: 10, fontWeight: 600, fontSize: 13, border: '1px solid var(--color-error-dim)', cursor: 'pointer' }}
                                >
                                    Stop Dispatch
                                </button>
                                
                                {status === 'pending' && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-warning)', fontSize: 13, fontWeight: 600 }}>
                                        <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--color-warning)', animation: 'pulse 2s infinite' }} />
                                        Waiting for someone to connect...
                                    </div>
                                )}
                                
                                {status === 'connected' && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-success)', fontSize: 13, fontWeight: 600 }}>
                                        <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--color-success)' }} />
                                        Connected & Active
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {status === 'error' && (
                        <div style={{ textAlign: 'center', padding: '20px 0' }}>
                            <div style={{ color: 'var(--color-error)', fontSize: 14, fontWeight: 600, marginBottom: 16 }}>
                                Failed to start dispatch session. Please try again.
                            </div>
                            <button
                                onClick={() => setStatus('idle')}
                                style={{ padding: '10px 20px', backgroundColor: 'var(--color-bg-subtle)', color: 'var(--color-text-primary)', borderRadius: 10, fontWeight: 600, fontSize: 13, border: '1px solid var(--color-border)', cursor: 'pointer' }}
                            >
                                Try Again
                            </button>
                        </div>
                    )}
                </div>

                {existingSessions.length > 0 && (
                    <div style={{ marginTop: 32, borderTop: '1px solid var(--color-border)', paddingTop: 20 }}>
                        <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 12 }}>Existing Sessions</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {existingSessions.map(session => (
                                <div key={session.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', backgroundColor: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', borderRadius: 12 }}>
                                    <div>
                                        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)' }}>{session.device_name}</div>
                                        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                                            Status: <span style={{ color: session.status === 'active' ? 'var(--color-success)' : 'var(--color-warning)' }}>{session.status}</span>
                                            <span style={{ margin: '0 6px' }}>&bull;</span>
                                            PIN: {session.pin_code}
                                        </div>
                                    </div>
                                    <button 
                                        onClick={() => handleStopExisting(session.id)}
                                        style={{ padding: '6px 12px', backgroundColor: 'transparent', color: 'var(--color-error)', border: '1px solid var(--color-error-dim)', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}
                                    >
                                        Stop
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </Card>
        </motion.div>
    );
};
