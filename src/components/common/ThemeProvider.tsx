'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
export type AppFont = 'default' | 'sf-pro' | 'segoe-ui';

export interface ThemeContextType {
    theme: Theme;
    setTheme: (theme: Theme) => void;
    font: AppFont;
    setFont: (font: AppFont) => void;
}

export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setThemeState] = useState<Theme>(() => {
        if (typeof window !== 'undefined') {
            const storedTheme = localStorage.getItem('everfern_theme') as Theme;
            if (storedTheme === 'dark' || storedTheme === 'light') {
                return storedTheme;
            }
        }
        return 'light';
    });

    const [font, setFontState] = useState<AppFont>(() => {
        if (typeof window !== 'undefined') {
            const storedFont = localStorage.getItem('everfern_font') as AppFont;
            if (storedFont === 'sf-pro' || storedFont === 'segoe-ui' || storedFont === 'default') {
                return storedFont;
            }
        }
        return 'default';
    });

    const applyFontToDom = (newFont: AppFont) => {
        if (typeof document === 'undefined') return;
        document.documentElement.setAttribute('data-font', newFont);
        if (document.body) {
            document.body.setAttribute('data-font', newFont);
        }
        if (newFont === 'sf-pro') {
            document.documentElement.classList.add('font-sf-pro');
            document.documentElement.classList.remove('font-default', 'font-segoe-ui');
            document.documentElement.style.setProperty(
                '--font-sans',
                "'SF Pro Display', 'SF Pro', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
            );
            document.documentElement.style.setProperty(
                '--font-branding',
                "'SF Pro Display', 'SF Pro', -apple-system, BlinkMacSystemFont, sans-serif"
            );
        } else if (newFont === 'segoe-ui') {
            document.documentElement.classList.add('font-segoe-ui');
            document.documentElement.classList.remove('font-default', 'font-sf-pro');
            document.documentElement.style.setProperty(
                '--font-sans',
                "'Segoe UI', 'Segoe UI Variable', -apple-system, BlinkMacSystemFont, Roboto, sans-serif"
            );
            document.documentElement.style.setProperty(
                '--font-branding',
                "'Segoe UI', 'Segoe UI Variable', sans-serif"
            );
        } else {
            document.documentElement.classList.add('font-default');
            document.documentElement.classList.remove('font-sf-pro', 'font-segoe-ui');
            document.documentElement.style.setProperty(
                '--font-sans',
                "'Satoshi', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
            );
            document.documentElement.style.setProperty(
                '--font-branding',
                "'Figtree', sans-serif"
            );
        }
    };

    const setTheme = (newTheme: Theme) => {
        setThemeState(newTheme);
        localStorage.setItem('everfern_theme', newTheme);
        
        if (newTheme === 'dark') {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    };

    const setFont = (newFont: AppFont) => {
        setFontState(newFont);
        localStorage.setItem('everfern_font', newFont);
        applyFontToDom(newFont);

        try {
            const win = typeof window !== 'undefined' ? window : null;
            win?.electronAPI?.saveConfig?.({ font: newFont });
        } catch {
            // Silently ignore if electronAPI is not present
        }
    };

    useEffect(() => {
        if (theme === 'dark') {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    }, [theme]);

    useEffect(() => {
        applyFontToDom(font);
    }, [font]);

    return (
        <ThemeContext.Provider value={{ theme, setTheme, font, setFont }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme(): ThemeContextType {
    const context = useContext(ThemeContext);
    if (!context) {
        // Safe fallback for isolated components/tests or pre-mounted state
        const isDomDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
        const domFont = (typeof document !== 'undefined' && document.documentElement.getAttribute('data-font')) as AppFont;
        return {
            theme: isDomDark ? 'dark' : 'light',
            setTheme: () => {},
            font: domFont === 'sf-pro' ? 'sf-pro' : domFont === 'segoe-ui' ? 'segoe-ui' : 'default',
            setFont: () => {},
        };
    }
    return context;
}

export function useFont() {
    const { font, setFont } = useTheme();
    return { font, setFont };
}
