// CU-UI-06: shared guard for keyboard handlers that must ignore editable targets
export function isEditableTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el || typeof (el as any).tagName !== 'string') return false;
    const tag = el.tagName.toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}
