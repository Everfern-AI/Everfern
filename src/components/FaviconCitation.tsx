'use client';

import React, { useState } from 'react';
import { GlobeAltIcon } from '@heroicons/react/24/outline';

export function getFaviconUrl(url: string): string {
    try {
        const { origin } = new URL(url);
        return `${origin}/favicon.ico`;
    } catch {
        return '';
    }
}

interface FaviconCitationProps {
    url: string;
    label?: string;
}

export function FaviconCitation({ url, label }: FaviconCitationProps) {
    const [errored, setErrored] = useState(false);
    const faviconSrc = getFaviconUrl(url);
    const displayLabel = label ?? url;

    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {!errored && faviconSrc ? (
                <img
                    src={faviconSrc}
                    width={16}
                    height={16}
                    alt=""
                    onError={() => setErrored(true)}
                    style={{ width: 16, height: 16, flexShrink: 0 }}
                />
            ) : (
                <GlobeAltIcon width={16} height={16} style={{ flexShrink: 0 }} />
            )}
            <span>{displayLabel}</span>
        </span>
    );
}
