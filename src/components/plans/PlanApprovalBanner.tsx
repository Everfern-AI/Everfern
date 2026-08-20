import React from 'react';

// ── Plan Approval Banner ────────────────────────────────────────────────────
export const PlanApprovalBanner = () => (
    <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 18px', borderRadius: 14,
        background: 'linear-gradient(135deg, rgba(34,197,94,0.08) 0%, rgba(16,185,129,0.05) 100%)',
        border: '1px solid rgba(34,197,94,0.25)',
        marginBottom: 8
    }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(34,197,94,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
            </svg>
        </div>
        <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Plan Approved</div>
            <div style={{ fontSize: 14, color: '#15803d', lineHeight: 1.5 }}>I have reviewed and approved your execution plan. Please proceed with the execution as planned.</div>
        </div>
    </div>
);
