import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoCollapse } from '../use-auto-collapse';

describe('useAutoCollapse', () => {
  it('should be expanded (open) when isLive is initially true', () => {
    const { result } = renderHook(() => useAutoCollapse(true, true));
    expect(result.current[0]).toBe(true);
  });

  it('should be closed when isLive is initially false', () => {
    const { result } = renderHook(() => useAutoCollapse(false, true));
    expect(result.current[0]).toBe(false);
  });

  it('should open when isLive transitions from false to true', () => {
    let isLive = false;
    const { result, rerender } = renderHook(() => useAutoCollapse(isLive, true));
    expect(result.current[0]).toBe(false);

    isLive = true;
    rerender();
    expect(result.current[0]).toBe(true);
  });

  it('should auto-collapse (close) when isLive transitions from true to false and autoCollapse is true', () => {
    let isLive = true;
    const { result, rerender } = renderHook(() => useAutoCollapse(isLive, true));
    expect(result.current[0]).toBe(true);

    isLive = false;
    rerender();
    expect(result.current[0]).toBe(false);
  });

  it('should not auto-collapse when autoCollapseEnabled is false', () => {
    let isLive = true;
    const { result, rerender } = renderHook(() => useAutoCollapse(isLive, false));
    expect(result.current[0]).toBe(true);

    isLive = false;
    rerender();
    expect(result.current[0]).toBe(true);
  });

  it('should support manual toggle while running or finished', () => {
    const { result } = renderHook(() => useAutoCollapse(true, true));
    expect(result.current[0]).toBe(true);

    act(() => {
      result.current[1](false);
    });
    expect(result.current[0]).toBe(false);

    act(() => {
      result.current[1](true);
    });
    expect(result.current[0]).toBe(true);
  });
});
