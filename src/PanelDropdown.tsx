import * as React from 'react';

interface DropdownProps {
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
    label: string;
    className?: string;
}

export function PanelDropdown({ value, options, onChange, label, className = '' }: DropdownProps) {
    const [open, setOpen] = React.useState(false);
    const [active, setActive] = React.useState(0);
    const root = React.useRef<HTMLDivElement>(null);
    const button = React.useRef<HTMLButtonElement>(null);
    const listId = React.useId();
    React.useEffect(() => {
        if (!open) return;
        const doc = root.current?.ownerDocument;
        const closeOutside = (event: PointerEvent) => {
            if (!event.composedPath().includes(root.current as EventTarget)) setOpen(false);
        };
        doc?.addEventListener('pointerdown', closeOutside);
        return () => doc?.removeEventListener('pointerdown', closeOutside);
    }, [open]);
    const select = (index: number) => {
        const option = options[index];
        if (option) onChange(option.value);
        setOpen(false);
        button.current?.focus();
    };
    return <div ref={root} className={`task-panel-dropdown ${className}`} onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
        <button ref={button} type="button" className="task-panel-dropdown-trigger" aria-label={label}
            aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
            aria-activedescendant={open ? `${listId}-${active}` : undefined}
            onClick={() => { setActive(Math.max(0, options.findIndex(option => option.value === value))); setOpen(!open); }}
            onKeyDown={event => {
                event.stopPropagation();
                if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    if (!open) { setActive(Math.max(0, options.findIndex(option => option.value === value))); setOpen(true); }
                    else setActive(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
                }
                if (open && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); select(active); }
                if (open && event.key === 'Home') { event.preventDefault(); setActive(0); }
                if (open && event.key === 'End') { event.preventDefault(); setActive(options.length - 1); }
            }}>
            <span>{options.find(option => option.value === value)?.label || value}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </button>
        {open && <div id={listId} role="listbox" aria-label={label} className="task-panel-dropdown-menu">
            {options.map((option, index) => <div id={`${listId}-${index}`} key={option.value} role="option" aria-selected={option.value === value}
                className={index === active ? 'is-active' : ''} onMouseEnter={() => setActive(index)}
                onMouseDown={event => { event.preventDefault(); select(index); }}>{option.label}</div>)}
        </div>}
    </div>;
}
