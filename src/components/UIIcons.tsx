import React from 'react';
import { motion } from 'framer-motion';

const WaveformIcon = ({ size = 16, style }: { size?: number; style?: React.CSSProperties }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 58 58" style={{ width: size, height: size, ...style }}>
        <rect x="3" y="21" width="10" height="16" rx="5" fill="currentColor" />
        <rect x="16" y="9" width="10" height="40" rx="5" fill="currentColor" />
        <rect x="29" y="3" width="10" height="52" rx="5" fill="currentColor" />
        <rect x="42" y="9" width="10" height="40" rx="5" fill="currentColor" />
        <rect x="55" y="21" width="10" height="16" rx="5" fill="currentColor" />
    </svg>
);

const FernStarburst = ({ size = 40, color = '#e5e5e5', animate = false }: { size?: number; color?: string; animate?: boolean }) => {
    const rays = 12;
    const inner = size * 0.15;
    const outer = size * 0.45;
    const center = size / 2;
    const points: string[] = [];
    for (let i = 0; i < rays * 2; i++) {
        const angle = (Math.PI * 2 * i) / (rays * 2) - Math.PI / 2;
        const r = i % 2 === 0 ? outer : inner;
        points.push(`${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`);
    }
    const Wrapper = animate ? motion.div : 'div';
    const animProps = animate ? { animate: { rotate: 360 }, transition: { duration: 8, repeat: Infinity, ease: 'linear' as const } } : {};
    return (
        <Wrapper {...(animProps as any)} style={{ width: size, height: size, display: 'inline-flex' }}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
                <polygon points={points.join(' ')} fill={color} />
            </svg>
        </Wrapper>
    );
};

export { WaveformIcon, FernStarburst };
