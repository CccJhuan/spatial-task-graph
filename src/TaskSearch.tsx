import * as React from 'react';
import { isSimplifiedChinese } from './language';

interface SearchTask { id: string; label: string; path: string; }

export function TaskSearch({ tasks, onSelect, onClose }: {
    tasks: SearchTask[]; onSelect: (id: string) => void; onClose: () => void;
}) {
    const zh = isSimplifiedChinese();
    const [query, setQuery] = React.useState('');
    const [active, setActive] = React.useState(0);
    const resultsRef = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => {
        resultsRef.current?.children.item(active)?.scrollIntoView({ block: 'nearest' });
    }, [active, query]);
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const results = tasks.filter(task => words.every(word => `${task.label} ${task.path}`.toLowerCase().includes(word))).slice(0, 20);
    const listId = React.useId();
    const select = (index: number) => { const task = results[index]; if (task) onSelect(task.id); };
    return <div className="edit-overlay" onMouseDown={event => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}>
        <div className="edit-modal task-search-modal" role="dialog" aria-modal="true" aria-label={zh ? '搜索任务' : 'Search tasks'}
            onKeyDown={event => {
                event.stopPropagation();
                if (event.key === 'Escape') { event.preventDefault(); onClose(); }
                if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => results.length ? (index + 1) % results.length : 0); }
                if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => results.length ? (index - 1 + results.length) % results.length : 0); }
                if (event.key === 'Enter') { event.preventDefault(); select(active); }
            }}>
            <input autoFocus value={query} onChange={event => { setQuery(event.target.value); setActive(0); }}
                placeholder={zh ? '搜索任务标题、标签或文件路径…' : 'Search title, tags, or file path…'}
                aria-label={zh ? '搜索任务' : 'Search tasks'} role="combobox" aria-expanded="true" aria-controls={listId}
                aria-activedescendant={results[active] ? `${listId}-${active}` : undefined} />
            <div ref={resultsRef} className="task-search-results" id={listId} role="listbox">
                {results.map((task, index) => <div key={task.id} id={`${listId}-${index}`} role="option" aria-selected={index === active}
                    className={`task-search-result${index === active ? ' is-active' : ''}`}
                    onMouseEnter={() => setActive(index)} onMouseDown={event => { event.preventDefault(); select(index); }}>
                    <div>{task.label}</div><small>{task.path}</small>
                </div>)}
            </div>
            {!results.length && <div>{zh ? '没有匹配的任务' : 'No matching tasks'}</div>}
            <div className="task-search-hint">{zh ? '↑↓ 选择 · Enter 定位 · Esc 关闭' : '↑↓ Select · Enter Focus · Esc Close'}</div>
        </div>
    </div>;
}
