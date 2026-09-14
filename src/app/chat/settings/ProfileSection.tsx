'use client';
import { useRouter } from 'next/navigation';
import { SectionTitle, SectionSubtitle, Card, Label, Input, Select } from './ui';

/** Usage counters for the signed-in EverFern Cloud account, rendered as the
 *  token/vision progress bars in this section. All fields optional except
 *  the token/cost counters. */
export interface CloudUsage {
    dailyUsed: number;
    dailyLimit: number;
    inputTokensUsed: number;
    inputTokenLimit: number;
    outputTokensUsed: number;
    outputTokenLimit: number;
    dailyCostUsd: number;
    plan?: string;
    tier?: string;
    visionRequests10Days?: number;
    visionRequestsLimit?: number;
    visionModelDowngraded?: boolean;
}

interface ProfileSectionProps {
    profileName: string;
    setProfileName: (v: string) => void;
    displayName: string;
    setDisplayName: (v: string) => void;
    preferences: string;
    setPreferences: (v: string) => void;
    workFunction: string;
    setWorkFunction: (v: string) => void;
    isSavingProfile: boolean;
    profileSaveSuccess: boolean;
    handleSaveProfile: () => void;
    isCloudUser: boolean;
    cloudEmail: string;
    cloudUsage: CloudUsage | null;
    handleSignOut: () => void;
}

/** Profile settings: name/display-name/work-function/preferences form plus
 *  the EverFern Cloud session card (tier badge, token & vision usage bars,
 *  upgrade/sign-out). All state and save logic live in the parent page. */
export function ProfileSection({
    profileName,
    setProfileName,
    displayName,
    setDisplayName,
    preferences,
    setPreferences,
    workFunction,
    setWorkFunction,
    isSavingProfile,
    profileSaveSuccess,
    handleSaveProfile,
    isCloudUser,
    cloudEmail,
    cloudUsage,
    handleSignOut,
}: ProfileSectionProps) {
    const router = useRouter();
    return (
        <div>
            <SectionTitle>Profile</SectionTitle>
            <SectionSubtitle>Your personal information and preferences.</SectionSubtitle>

            <Card>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
                    <div>
                        <Label>Full name</Label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ width: 38, height: 38, borderRadius: '50%', backgroundColor: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-inverse)' }}>{profileName.charAt(0).toUpperCase()}</span>
                            </div>
                            <Input value={profileName} onChange={e => setProfileName(e.target.value)} placeholder="Your full name" />
                        </div>
                    </div>
                    <div>
                        <Label>What should EverFern call you?</Label>
                        <Input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Nickname" />
                    </div>
                </div>

                <div style={{ marginBottom: 20 }}>
                    <Label>What best describes your work?</Label>
                    <Select value={workFunction} onChange={e => setWorkFunction(e.target.value)}>
                        <option value="" disabled>Select your work function</option>
                        <option value="developer">Software Developer</option>
                        <option value="designer">Designer</option>
                        <option value="researcher">Researcher</option>
                        <option value="writer">Writer</option>
                        <option value="student">Student</option>
                        <option value="other">Other</option>
                    </Select>
                </div>

                <div>
                    <Label>Custom preferences</Label>
                    <textarea
                        value={preferences} onChange={e => setPreferences(e.target.value)}
                        style={{ width: '100%', padding: '12px 16px', backgroundColor: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', borderRadius: 12, color: 'var(--color-text-primary)', fontSize: 14, outline: 'none', resize: 'vertical', fontFamily: 'var(--font-sans)', boxSizing: 'border-box', lineHeight: 1.6 }}
                        onFocus={e => e.target.style.borderColor = 'var(--color-border-focus)'}
                        onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
                        placeholder="E.g. Use TypeScript for all code examples, explain concepts simply..."
                    />
                </div>

                {/* Profile Save Action */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, paddingTop: 18, borderTop: '1px solid var(--color-border)' }}>
                    <div>
                        {profileSaveSuccess && (
                            <span style={{ fontSize: 13, color: '#10b981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                                ✓ Profile saved successfully
                            </span>
                        )}
                    </div>
                    <button
                        onClick={handleSaveProfile}
                        disabled={isSavingProfile}
                        style={{
                            padding: '10px 20px',
                            backgroundColor: 'var(--color-text-primary)',
                            color: 'var(--color-text-inverse)',
                            borderRadius: 10,
                            fontWeight: 600,
                            fontSize: 13,
                            border: 'none',
                            cursor: isSavingProfile ? 'not-allowed' : 'pointer',
                            opacity: isSavingProfile ? 0.7 : 1,
                            transition: 'all 0.2s'
                        }}
                    >
                        {isSavingProfile ? 'Saving...' : 'Save Profile'}
                    </button>
                </div>

                {isCloudUser ? (
                    <div style={{ marginTop: 24, padding: 20, backgroundColor: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', borderRadius: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                    <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>EverFern Cloud Session</h3>
                                    <span style={{
                                        fontSize: 10,
                                        fontWeight: 700,
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.05em',
                                        padding: '2px 8px',
                                        borderRadius: 6,
                                        backgroundColor: cloudUsage?.plan === 'max' ? 'rgba(168, 85, 247, 0.15)' : cloudUsage?.plan === 'pro' ? 'rgba(16, 185, 129, 0.15)' : 'var(--color-bg-surface)',
                                        color: cloudUsage?.plan === 'max' ? '#a855f7' : cloudUsage?.plan === 'pro' ? '#10b981' : 'var(--color-text-tertiary)',
                                        border: cloudUsage?.plan === 'max' ? '1px solid rgba(168, 85, 247, 0.3)' : cloudUsage?.plan === 'pro' ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid var(--color-border)'
                                    }}>
                                        {cloudUsage?.plan ? `${cloudUsage.plan} TIER` : 'FREE TIER'}
                                    </span>
                                </div>
                                <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: 0 }}>Logged in as {cloudEmail}</p>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <button
                                    onClick={() => {
                                        const targetUrl = cloudUsage?.plan && cloudUsage.plan !== 'free'
                                            ? 'https://everfern.app/customer-portal'
                                            : 'https://everfern.app/pricing';
                                        // openExternal sits under different namespaces across
                                        // preload builds; try each before falling back to window.open.
                                        if ((window as any).electronAPI?.system?.openExternal) {
                                            (window as any).electronAPI.system.openExternal(targetUrl);
                                        } else if ((window as any).electronAPI?.shell?.openExternal) {
                                            (window as any).electronAPI.shell.openExternal(targetUrl);
                                        } else {
                                            window.open(targetUrl, '_blank');
                                        }
                                    }}
                                    style={{
                                        padding: '8px 16px',
                                        backgroundColor: 'var(--color-text-primary)',
                                        color: 'var(--color-text-inverse)',
                                        borderRadius: 10,
                                        fontWeight: 600,
                                        fontSize: 13,
                                        border: 'none',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s'
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                                    onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                                >
                                    {cloudUsage?.plan && cloudUsage.plan !== 'free' ? 'Manage Subscription' : 'Upgrade ($5/mo)'}
                                </button>
                                <button
                                    onClick={handleSignOut}
                                    style={{ padding: '8px 16px', backgroundColor: 'var(--color-bg-surface)', color: 'var(--color-error)', borderRadius: 10, fontWeight: 600, fontSize: 13, border: '1px solid var(--color-error-dim)', cursor: 'pointer', transition: 'all 0.2s' }}
                                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-error-dim)'}
                                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-surface)'}
                                >
                                    Sign Out
                                </button>
                            </div>
                        </div>
                        {cloudUsage && (
                            <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--color-border)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>Daily usage ({(cloudUsage.plan || 'free').toUpperCase()} Tier)</span>
                                    <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{cloudUsage.outputTokensUsed.toLocaleString()} / {cloudUsage.outputTokenLimit.toLocaleString()} output tokens</span>
                                </div>
                                <div style={{ width: '100%', height: 6, backgroundColor: 'var(--color-border)', borderRadius: 3, overflow: 'hidden' }}>
                                    {/* Usage bar turns red at exactly 100% so the quota wall is
                                        visible before the user hits a rejected request. */}
                                    <div style={{
                                        width: `${cloudUsage.outputTokenLimit ? Math.min(100, (cloudUsage.outputTokensUsed / cloudUsage.outputTokenLimit) * 100) : 0}%`,
                                        height: '100%',
                                        backgroundColor: (cloudUsage.outputTokenLimit && cloudUsage.outputTokensUsed >= cloudUsage.outputTokenLimit) ? '#ef4444' : '#10b981',
                                        borderRadius: 3,
                                        transition: 'width 0.3s ease'
                                    }} />
                                </div>
                                <div style={{ display: 'flex', gap: 24, marginTop: 16 }}>
                                    <div>
                                        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 2 }}>Input tokens</div>
                                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                            {cloudUsage.inputTokensUsed.toLocaleString()} / {cloudUsage.inputTokenLimit.toLocaleString()}
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 2 }}>Output tokens</div>
                                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                            {cloudUsage.outputTokensUsed.toLocaleString()} / {cloudUsage.outputTokenLimit.toLocaleString()}
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 2 }}>Daily cost</div>
                                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                            ${cloudUsage.dailyCostUsd.toFixed(2)}
                                        </div>
                                    </div>
                                </div>
                                <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '14px 0 0' }}>Usage resets daily at midnight.</p>
                            </div>
                        )}

                        {/* Vision Usage Section */}
                        {cloudUsage && (
                            <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--color-border-subtle)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>Vision & Computer Use (10 days)</span>
                                    <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                                        {cloudUsage.visionRequests10Days ?? 0} / {cloudUsage.visionRequestsLimit ?? 5} requests
                                    </span>
                                </div>
                                <div style={{ width: '100%', height: 6, backgroundColor: 'var(--color-border)', borderRadius: 3, overflow: 'hidden' }}>
                                    {/* Amber bar + downgrade banner appear once the
                                        backend has silently switched to the cheaper
                                        vision model (visionModelDowngraded flag). */}
                                    <div style={{
                                        width: `${Math.min(100, ((cloudUsage.visionRequests10Days ?? 0) / (cloudUsage.visionRequestsLimit ?? 5)) * 100)}%`,
                                        height: '100%',
                                        backgroundColor: (cloudUsage.visionModelDowngraded) ? '#f59e0b' : '#6366f1',
                                        borderRadius: 3,
                                        transition: 'width 0.3s ease'
                                    }} />
                                </div>
                                {cloudUsage.visionModelDowngraded && (
                                    <div style={{
                                        marginTop: 12,
                                        padding: '10px 12px',
                                        backgroundColor: 'rgba(245, 158, 11, 0.08)',
                                        border: '1px solid rgba(245, 158, 11, 0.25)',
                                        borderRadius: 8,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 8
                                    }}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2">
                                            <circle cx="12" cy="12" r="10"/>
                                            <path d="M12 8v4M12 16h.01"/>
                                        </svg>
                                        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                                            Using cost-optimized vision model. <button
                                                onClick={() => {
                                                    if ((window as any).electronAPI?.system?.openExternal) {
                                                        (window as any).electronAPI.system.openExternal('https://everfern.app/pricing');
                                                    } else {
                                                        window.open('https://everfern.app/pricing', '_blank');
                                                    }
                                                }}
                                                style={{
                                                    background: 'none',
                                                    border: 'none',
                                                    padding: 0,
                                                    color: '#f59e0b',
                                                    fontWeight: 600,
                                                    cursor: 'pointer',
                                                    textDecoration: 'underline'
                                                }}
                                            >Upgrade</button> for higher quality
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    <div style={{ marginTop: 24, padding: 20, backgroundColor: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', borderRadius: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4 }}>EverFern Cloud</h3>
                                <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: 0 }}>Login to access cloud models, dispatch, and sync.</p>
                            </div>
                            <button
                                onClick={() => router.push('/auth')}
                                style={{ padding: '8px 16px', backgroundColor: 'var(--color-text-primary)', color: 'var(--color-text-inverse)', borderRadius: 10, fontWeight: 600, fontSize: 13, border: 'none', cursor: 'pointer', transition: 'all 0.2s' }}
                                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-text-secondary)'}
                                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'var(--color-text-primary)'}
                            >
                                Login
                            </button>
                        </div>
                    </div>
                )}
            </Card>
        </div>
    );
}
