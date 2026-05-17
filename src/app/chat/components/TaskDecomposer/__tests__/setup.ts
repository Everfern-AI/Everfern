/**
 * Test setup and configuration for Task Decomposer Narrative UI
 *
 * This module provides setup utilities for testing, including mock implementations
 * and test configuration.
 */

import { vi } from 'vitest';

/**
 * Setup function to be called before running tests
 */
export function setupTaskDecomposerTests() {
  // Mock window.matchMedia if needed
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  }

  // Mock IntersectionObserver if needed
  if (!window.IntersectionObserver) {
    (window as any).IntersectionObserver = class IntersectionObserver {
      constructor() {}
      disconnect() {}
      observe() {}
      takeRecords() {
        return [];
      }
      unobserve() {}
    };
  }

  // Mock ResizeObserver if needed
  if (!window.ResizeObserver) {
    (window as any).ResizeObserver = class ResizeObserver {
      constructor() {}
      disconnect() {}
      observe() {}
      unobserve() {}
    };
  }

  // Mock SVG getTotalLength method on all SVG elements
  const mockGetTotalLength = () => 100;

  if (typeof SVGPathElement !== 'undefined') {
    Object.defineProperty(SVGPathElement.prototype, 'getTotalLength', {
      value: mockGetTotalLength,
      writable: true,
    });
  }

  if (typeof SVGGeometryElement !== 'undefined') {
    Object.defineProperty(SVGGeometryElement.prototype, 'getTotalLength', {
      value: mockGetTotalLength,
      writable: true,
    });
  }

  // Mock scrollTo
  if (typeof window !== 'undefined' && !window.scrollTo) {
    window.scrollTo = vi.fn();
  }
}

/**
 * Cleanup function to be called after running tests
 */
export function cleanupTaskDecomposerTests() {
  vi.clearAllMocks();
}

/**
 * Mock console methods for testing
 */
export const mockConsole = {
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
};

/**
 * Restore console methods
 */
export function restoreConsole() {
  vi.restoreAllMocks();
}

/**
 * Create a mock React context for testing
 */
export function createMockContext<T>(defaultValue: T) {
  return {
    Provider: ({ children }: { children: React.ReactNode }) => children,
    Consumer: ({ children }: { children: (value: T) => React.ReactNode }) =>
      children(defaultValue),
  };
}

/**
 * Wait for async operations to complete
 */
export async function flushPromises() {
  return new Promise(resolve => setImmediate(resolve));
}

/**
 * Create a mock animation frame
 */
export function mockAnimationFrame() {
  let frameId = 0;
  const callbacks: Map<number, FrameRequestCallback> = new Map();

  const requestAnimationFrame = (callback: FrameRequestCallback) => {
    const id = ++frameId;
    callbacks.set(id, callback);
    return id;
  };

  const cancelAnimationFrame = (id: number) => {
    callbacks.delete(id);
  };

  const flush = (time: number = 0) => {
    const cbs = Array.from(callbacks.values());
    callbacks.clear();
    cbs.forEach(cb => cb(time));
  };

  return {
    requestAnimationFrame,
    cancelAnimationFrame,
    flush,
  };
}
