'use client';

/**
 * Web Search Results View Component
 * Displays search results with titles, URLs, snippets, and domains
 */

import React from 'react';
import { WebSearchResultsViewProps } from './types';
import { getFaviconUrl, truncateText } from './utils';
import { Search, ExternalLink, Link2, Info } from 'lucide-react';

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
      className="p-3.5 bg-white border border-gray-150 rounded-xl hover:bg-blue-50/20 hover:border-blue-200 cursor-pointer transition-all duration-200 group"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`${title} - ${domain}`}
    >
      <div className="flex items-center gap-2 mb-2">
        {favicon && (
          <div className="p-0.5 bg-white rounded border border-gray-100 flex items-center justify-center flex-shrink-0">
            <img
              src={favicon}
              alt=""
              className="w-3.5 h-3.5 rounded"
              loading="lazy"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          </div>
        )}
        <span className="text-[11px] font-bold text-gray-500 tracking-wide truncate uppercase">
          {domain}
        </span>
      </div>

      <h3 className="text-sm font-semibold text-blue-600 group-hover:text-blue-700 group-hover:underline mb-1.5 line-clamp-2 leading-snug">
        {title}
      </h3>

      <p className="text-xs text-gray-600 mb-3 leading-relaxed line-clamp-3">
        {snippet}
      </p>

      <div className="flex items-center justify-between text-[11px] text-gray-400 border-t border-gray-100/70 pt-2 font-mono">
        <span className="truncate max-w-[200px] flex items-center gap-1">
          <Link2 className="w-3.5 h-3.5 text-gray-300" />
          {truncateText(url, 40)}
        </span>
        <ExternalLink className="w-3.5 h-3.5 text-gray-400 group-hover:text-blue-500 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform duration-200" />
      </div>
    </article>
  );
}

/**
 * Web Search Results View Component
 */
export default function WebSearchResultsView({
  query,
  results = [],
  totalResults = 0
}: WebSearchResultsViewProps) {
  const safeResults = Array.isArray(results) ? results : [];
  const safeTotalResults = typeof totalResults === 'number' ? totalResults : safeResults.length;

  if (safeResults.length === 0) {
    return (
      <div className="flex flex-col h-full bg-gray-50/30">
        {/* Search query header with premium gradients */}
        <div className="px-6 py-5 border-b border-gray-150 bg-white">
          <div className="bg-gradient-to-br from-blue-50/50 to-indigo-50/50 border border-blue-100/50 rounded-xl p-4 mb-3">
            <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-2 flex items-center gap-1.5 font-sans">
              <Search className="w-3.5 h-3.5" />
              Query String
            </p>
            <p className="text-sm font-semibold text-gray-800 break-words leading-relaxed selection:bg-blue-200/30">
              "{query}"
            </p>
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center min-h-0">
          <div className="relative mb-6">
            <div className="absolute inset-0 bg-gray-100 rounded-full blur-2xl opacity-40 animate-pulse" />
            <div className="relative p-5 bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200/50 rounded-full text-gray-400">
              <Search className="w-10 h-10" />
            </div>
          </div>
          
          <h3 className="text-sm font-semibold text-gray-800 mb-2">No results found</h3>
          <p className="text-xs text-gray-500 max-w-[280px] leading-relaxed">
            Search did not return any matches.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50/30 overflow-hidden">
      {/* Search query header with premium gradients */}
      <div className="px-6 py-5 border-b border-gray-150 bg-white">
        <div className="bg-gradient-to-br from-blue-50/50 to-indigo-50/50 border border-blue-100/50 rounded-xl p-4 mb-3">
          <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-2 flex items-center gap-1.5 font-sans">
            <Search className="w-3.5 h-3.5" />
            Query String
          </p>
          <p className="text-sm font-semibold text-gray-800 break-words leading-relaxed selection:bg-blue-200/30">
            "{query}"
          </p>
        </div>
        
        <div className="flex items-center justify-between text-xs font-semibold text-gray-500 uppercase tracking-wider px-1">
          <span>Search Results</span>
          <span className="px-2.5 py-1 bg-gray-100 border border-gray-200 rounded-full text-[10px] font-bold text-gray-600 font-mono">
            {safeTotalResults} Matches
          </span>
        </div>
      </div>

      {/* Results list */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4" role="list">
        {safeResults.map((result, index) => (
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
      {safeTotalResults > 50 && (
        <div className="px-6 py-4 border-t border-amber-100 bg-amber-50/80 backdrop-blur-sm flex items-center gap-3 text-xs text-amber-800 select-none">
          <Info className="w-4.5 h-4.5 flex-shrink-0" />
          <p className="font-medium">
            Showing first 50 results of {safeTotalResults} total entries.
          </p>
        </div>
      )}
    </div>
  );
}
