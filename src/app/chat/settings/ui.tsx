'use client';
import React from 'react';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import { motion } from 'framer-motion';

/** Serif display heading used at the top of every settings section. */
export const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 28, fontWeight: 400, color: 'var(--color-text-primary)', margin: '0 0 6px', letterSpacing: '-0.01em' }}>
        {children}
    </h2>
);

/** Descriptive one-liner rendered directly beneath the section title. */
export const SectionSubtitle = ({ children }: { children: React.ReactNode }) => (
    <p style={{ fontSize: 14, color: 'var(--color-text-tertiary)', margin: '0 0 28px', lineHeight: 1.5 }}>{children}</p>
);

/** Rounded surface card; the standard container for each settings block. */
export const Card = ({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) => (
    <div style={{ backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: 24, marginBottom: 16, ...style }}>
        {children}
    </div>
);

/** Small uppercase field label used above inputs/selects. */
export const Label = ({ children }: { children: React.ReactNode }) => (
    <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
        {children}
    </p>
);

/** Themed text input. stopPropagation on mousedown keeps click-to-open
 *  parents (drag regions, cards) from swallowing focus clicks. */
export const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
        {...props}
        style={{
            width: '100%', padding: '12px 16px', backgroundColor: 'var(--color-bg-subtle)',
            border: '1px solid var(--color-border)', borderRadius: 12, color: 'var(--color-text-primary)',
            fontSize: 14, outline: 'none', transition: 'border 0.2s', boxSizing: 'border-box',
            fontFamily: 'var(--font-sans)',
            ...props.style,
        }}
        onFocus={e => { e.target.style.borderColor = 'var(--color-border-focus)'; }}
        onBlur={e => { e.target.style.borderColor = 'var(--color-border)'; }}
        onMouseDown={e => e.stopPropagation()}
    />
);

/**
 * Custom dropdown that renders a styled div-based listbox while keeping a
 * hidden native <select> in the DOM (for form submission/compat). Mirrors
 * controlled `value` updates, closes on outside click, and re-dispatches a
 * synthetic ChangeEvent so parent onChange handlers work unchanged.
 */
export const Select = (props: React.SelectHTMLAttributes<HTMLSelectElement>) => {
    const [isFocused, setIsFocused] = React.useState(false);
    const [isOpen, setIsOpen] = React.useState(false);
    // Dual-mode: `value` when controlled, else fall back to defaultValue,
    // then '' — keeps the same controlled/uncontrolled contract as a native select.
    const [selectedValue, setSelectedValue] = React.useState(props.value?.toString() || props.defaultValue?.toString() || '');
    const selectRef = React.useRef<HTMLDivElement>(null);

    // Mirror external `value` updates into internal state so parent-driven
    // resets/rebindings are reflected even though we render our own listbox.
    React.useEffect(() => {
        if (props.value !== undefined) {
            setSelectedValue(props.value.toString());
        }
    }, [props.value]);

    // Leak-prevention: single document-level mousedown listener registered once
    // on mount and torn down on unmount ([]) — re-registering per render would
    // pile up listeners every open/close cycle.
    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelect = (value: string) => {
        // Close the listbox before notifying so parent onChange handlers that
        // read layout/visibility see the post-selection (closed) state.
        setSelectedValue(value);
        setIsOpen(false);
        if (props.onChange) {
            const event = {
                target: { value, name: props.name },
            } as React.ChangeEvent<HTMLSelectElement>;
            props.onChange(event);
        }
    };

    const options = React.Children.toArray(props.children)
        .filter((child): child is React.ReactElement => React.isValidElement(child))
        // Extract {value, label} pairs from the declarative <option> children
        // so the custom listbox can render them and the hidden native select
        // stays in sync with the same source.
        .map((child: any) => ({
            value: child.props?.value?.toString() || '',
            label: child.props?.children?.toString() || '',
        }));

    const selectedLabel = options.find(opt => opt.value === selectedValue)?.label || options[0]?.label || '';

    return (
        <div ref={selectRef} style={{ position: 'relative', width: '100%' }}>
            <div
                onClick={() => setIsOpen(!isOpen)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                style={{
                    width: '100%', padding: '12px 40px 12px 16px', backgroundColor: isFocused || isOpen ? 'var(--color-bg-surface)' : 'var(--color-bg-subtle)',
                    border: `1px solid ${isFocused || isOpen ? 'var(--color-border-focus)' : 'var(--color-border)'}`, borderRadius: 12, color: 'var(--color-text-primary)',
                    fontSize: 14, outline: 'none', cursor: 'pointer', appearance: 'none',
                    fontFamily: 'var(--font-sans)', boxSizing: 'border-box',
                    transition: 'all 0.2s',
                    boxShadow: isFocused || isOpen ? '0 0 0 3px var(--color-bg-overlay)' : 'none',
                    display: 'flex', alignItems: 'center', userSelect: 'none',
                }}
                tabIndex={0}
            >
                {selectedLabel}
            </div>

            <ChevronRightIcon
                width={14}
                height={14}
                style={{
                    position: 'absolute', right: 14, top: '50%', transform: `translateY(-50%) rotate(${isOpen ? 90 : 0}deg)`,
                    color: isFocused || isOpen ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                    pointerEvents: 'none',
                    transition: 'all 0.2s'
                }}
            />

            {isOpen && (
                <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.15 }}
                    className="glossy"
                    style={{
                        position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6,
                        backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 12,
                        zIndex: 1000,
                        maxHeight: 240, overflowY: 'auto',
                    }}
                >
                    {options.map((option, idx) => (
                        <div
                            key={idx}
                            onClick={() => handleSelect(option.value)}
                            style={{
                                padding: '10px 16px', fontSize: 14, color: selectedValue === option.value ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                                backgroundColor: selectedValue === option.value ? 'var(--color-bg-hover)' : 'var(--color-bg-surface)',
                                cursor: 'pointer', transition: 'all 0.1s',
                                borderBottom: idx < options.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
                                fontWeight: selectedValue === option.value ? 600 : 400,
                            }}
                            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'}
                            onMouseLeave={e => e.currentTarget.style.backgroundColor = selectedValue === option.value ? 'var(--color-bg-hover)' : 'var(--color-bg-surface)'}
                        >
                            {option.label}
                        </div>
                    ))}
                </motion.div>
            )}

            {/* Hidden native select for form submission — kept mounted so the
                value participates in form state; visually replaced by the div UI. */}
            {(() => {
                // Strip controlled props before spreading onto the hidden native
                // select: we own its `value` (selectedValue) and route its onChange
                // through handleSelect to avoid double-dispatching to parent onChange.
                const { defaultValue, value, ...rest } = props;
                return (
                    <select
                        {...rest}
                        value={selectedValue}
                        onChange={e => handleSelect(e.target.value)}
                        style={{ display: 'none' }}
                    >
                        {props.children}
                    </select>
                );
            })()}
        </div>
    );
};
