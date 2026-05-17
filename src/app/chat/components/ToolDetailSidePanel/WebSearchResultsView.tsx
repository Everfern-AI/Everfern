'use client';

/**
 * Web Search Results View Component
 * Displays search results with titles, URLs, snippets, and domains
 */

import React from 'react';
import { WebSearchResultsViewProps } from './types';
import { getFaviconUrl, truncateText } from './utils';

/**
 * External link icon component
 */
function ExternalLinkIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M11 3L3 11M11 3H7M11 3V7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Search result card component
 */
function SearchResultCard({
  title,
  url,
  snippet,
  domain,
  favicon
}: {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  favicon?: string;
}) {
  const handleClick = () => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <article
      className="p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`${title} - ${domain}`}
    >
      <div className="flex items-center gap-2 mb-2">
        {favicon && (
          <img
            src={favicon}
            alt=""
            className="w-4 h-4 flex-shrink-0 rounded"
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        )}
        <div className="flex-1 min-w-0">
          <span className="text-xs text-gray-500 truncate">{domain}</span>
        </div>
      </div>

      <h3 className="text-sm font-medium text-blue-600 hover:underline mb-1 line-clamp-2">{title}</h3>

      <p className="text-xs text-gray-600 mb-2 line-clamp-2">{snippet}</p>

      <div className="flex items-center justify-between text-xs text-gray-500">
        <span className="truncate">{truncateText(url, 50)}</span>
        <ExternalLinkIcon />
      </div>
    </article>
  );
}

/**
 * Web Search Results View Component
 */
export default function WebSearchResultsView({
  query,
  results,
  totalResults
}: WebSearchResultsViewProps) {
  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <p className="text-sm font-medium text-gray-900 mb-1">No results found</p>
        <p className="text-xs text-gray-500">No search results for "{query}"</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search query header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 sticky top-0">
        <p className="text-xs text-gray-500 mb-1">Search Query</p>
        <p className="text-sm font-medium text-gray-900 mb-2 break-words">{query}</p>
        <p className="text-xs text-gray-500">
          {totalResults} result{totalResults !== 1 ? 's' : ''} found
        </p>
      </div>

      {/* Results list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2" role="list">
        {results.map((result, index) => (
          <div key={`${result.url}-${index}`} role="listitem">
            <SearchResultCard
              title={result.title}
              url={result.url}
              snippet={result.snippet}
              domain={result.domain}
              favicon={result.favicon || getFaviconUrl(result.domain)}
            />
          </div>
        ))}
      </div>

      {/* Results limit notice */}
      {totalResults > 50 && (
        <div className="px-4 py-3 border-t border-gray-200 bg-yellow-50">
          <p className="text-xs text-yellow-800">Showing first 50 results of {totalResults} total</p>
        </div>
      )}
    </div>
  );
}
