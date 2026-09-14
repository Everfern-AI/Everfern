import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
    motion: {
        article: ({ children, ...props }: any) => <article {...props}>{children}</article>,
    },
    AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Import the component after mocking
import { SearchResultCard } from '../ToolCallComponents';

// Mock SearchResult interface
interface SearchResult {
    title: string;
    url: string;
    snippet: string;
    publishedDate?: string;
    domain?: string;
    breadcrumbs?: string[];
}

describe('SearchResultCard', () => {
    const mockResult: SearchResult = {
        title: 'Example Search Result',
        url: 'https://example.com/page',
        snippet: 'This is an example snippet from the search result.',
        publishedDate: '2024-01-15',
        domain: 'example.com'
    };

    it('renders with complete data', () => {
        render(<SearchResultCard result={mockResult} index={0} />);

        expect(screen.getByText('Example Search Result')).toBeInTheDocument();
        expect(screen.getByText('example.com')).toBeInTheDocument();
        expect(screen.getByText('This is an example snippet from the search result.')).toBeInTheDocument();
        expect(screen.getByText('2024-01-15')).toBeInTheDocument();
    });

    it('renders with missing optional fields', () => {
        const minimalResult: SearchResult = {
            title: 'Minimal Result',
            url: 'https://example.com',
            snippet: 'Minimal snippet'
        };

        render(<SearchResultCard result={minimalResult} index={0} />);

        expect(screen.getByText('Minimal Result')).toBeInTheDocument();
        expect(screen.getByText('example.com')).toBeInTheDocument();
        expect(screen.getByText('Minimal snippet')).toBeInTheDocument();
        expect(screen.queryByText('2024-01-15')).not.toBeInTheDocument();
    });

    it('extracts domain from URL when domain field is missing', () => {
        const resultWithoutDomain: SearchResult = {
            title: 'Test Result',
            url: 'https://www.test-site.com/page',
            snippet: 'Test snippet'
        };

        render(<SearchResultCard result={resultWithoutDomain} index={0} />);

        expect(screen.getByText('test-site.com')).toBeInTheDocument();
    });

    it('handles invalid URLs gracefully', () => {
        const resultWithInvalidUrl: SearchResult = {
            title: 'Invalid URL Result',
            url: 'not-a-valid-url',
            snippet: 'Test snippet'
        };

        render(<SearchResultCard result={resultWithInvalidUrl} index={0} />);

        expect(screen.getByText('Invalid URL Result')).toBeInTheDocument();
        expect(screen.getByText('Unknown')).toBeInTheDocument();
    });

    it('uses URL as title fallback when title is missing', () => {
        const resultWithoutTitle: SearchResult = {
            title: '',
            url: 'https://example.com/page',
            snippet: 'Test snippet'
        };

        render(<SearchResultCard result={resultWithoutTitle} index={0} />);

        expect(screen.getByText('https://example.com/page')).toBeInTheDocument();
    });

    it('has proper accessibility attributes', () => {
        render(<SearchResultCard result={mockResult} index={0} />);

        const article = screen.getByRole('article');
        expect(article).toHaveAttribute('aria-label', 'Search result');

        const link = screen.getByRole('link');
        expect(link).toHaveAttribute('aria-label', 'Visit Example Search Result at example.com');
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });
});
