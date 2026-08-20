"use client";

import React, { Component, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  componentName?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

/**
 * Error Boundary component to catch and handle React component errors
 * Used to wrap components that might fail and provide graceful fallback UI
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const componentName = this.props.componentName || 'Component';
    console.error(`[ErrorBoundary] ${componentName} error:`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided, otherwise use default
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default fallback UI
      return (
        <div style={{
          padding: '12px 16px',
          borderRadius: 8,
          backgroundColor: '#fef2f2',
          border: '1px solid #fecaca',
          color: '#991b1b',
          fontSize: 13,
          lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            Something went wrong
          </div>
          <div style={{ fontSize: 12, color: '#dc2626' }}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
