import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import { CloudAuthLoginButton } from '../UIHelpers';

// Mock ThemeProvider
vi.mock('@/components/ThemeProvider', () => ({
    useTheme: () => ({ theme: 'dark', setTheme: vi.fn() }),
}));

describe('CloudAuthLoginButton', () => {
    it('renders login button when content contains 401 "Unauthorized" and providerType is everfern', () => {
        const onLogin = vi.fn();
        render(
            <CloudAuthLoginButton
                content={'❌ Error during execution: 401 "Unauthorized"'}
                providerType="everfern"
                onLogin={onLogin}
            />
        );

        expect(screen.getByText('Sign in to EverFern Cloud')).toBeInTheDocument();
        expect(screen.getByText(/You need to be logged into EverFern Cloud/i)).toBeInTheDocument();
        const button = screen.getByRole('button', { name: /Login to EverFern Cloud/i });
        expect(button).toBeInTheDocument();

        fireEvent.click(button);
        expect(onLogin).toHaveBeenCalledTimes(1);
    });

    it('renders login button when providerType is undefined and 401 is present', () => {
        const onLogin = vi.fn();
        render(
            <CloudAuthLoginButton
                content={'401 Unauthorized'}
                onLogin={onLogin}
            />
        );

        expect(screen.getByRole('button', { name: /Login to EverFern Cloud/i })).toBeInTheDocument();
    });

    it('renders login button when error specifically mentions everfern cloud even if providerType is different', () => {
        const onLogin = vi.fn();
        render(
            <CloudAuthLoginButton
                content={'Please sign in to your EverFern Cloud account to use this feature'}
                providerType="custom"
                onLogin={onLogin}
            />
        );

        expect(screen.getByRole('button', { name: /Login to EverFern Cloud/i })).toBeInTheDocument();
    });

    it('does NOT render login button if providerType is non-Everfern (e.g. openai) and error does not mention Everfern', () => {
        const onLogin = vi.fn();
        const { container } = render(
            <CloudAuthLoginButton
                content={'401 Unauthorized: Invalid OpenAI API key'}
                providerType="openai"
                onLogin={onLogin}
            />
        );

        expect(container).toBeEmptyDOMElement();
    });

    it('does NOT render login button when content does not contain 401 or auth error', () => {
        const onLogin = vi.fn();
        const { container } = render(
            <CloudAuthLoginButton
                content={'Task completed successfully!'}
                providerType="everfern"
                onLogin={onLogin}
            />
        );

        expect(container).toBeEmptyDOMElement();
    });

    it('handles undefined or non-string content safely without crashing', () => {
        const onLogin = vi.fn();
        const { container: c1 } = render(
            <CloudAuthLoginButton
                content={undefined}
                providerType="everfern"
                onLogin={onLogin}
            />
        );
        expect(c1).toBeEmptyDOMElement();

        const { container: c2 } = render(
            <CloudAuthLoginButton
                content={null as any}
                providerType="everfern"
                onLogin={onLogin}
            />
        );
        expect(c2).toBeEmptyDOMElement();
    });
});
