import * as React from 'react';
import { isSimplifiedChinese } from './language';

export function ConnectionActions({ x, y, activeAction, canCreate, onChoose }: {
    x: number; y: number; activeAction: 'search' | 'cancel' | 'create' | null; canCreate: boolean; onChoose: (action: 'search' | 'cancel' | 'create') => void;
}) {
    const zh = isSimplifiedChinese();
    return <div className="connection-actions" style={{ left: x, top: y }}>
        <button type="button" className={activeAction === 'search' ? 'is-active' : ''} data-connection-action="search" aria-label={zh ? '搜索并连接任务' : 'Search and connect task'}
            onMouseDown={event => event.stopPropagation()} onClick={() => onChoose('search')}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
        </button>
        <button type="button" className={activeAction === 'cancel' ? 'is-active connection-cancel' : 'connection-cancel'} data-connection-action="cancel" aria-label={zh ? '取消连线' : 'Cancel connection'}
            onMouseDown={event => event.stopPropagation()} onClick={() => onChoose('cancel')}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <button type="button" className={activeAction === 'create' ? 'is-active' : ''} data-connection-action="create" disabled={!canCreate}
            aria-label={canCreate ? (zh ? '创建子任务' : 'Create child task') : (zh ? '请在 TaskNotes 中创建任务' : 'Create tasks in TaskNotes')}
            onMouseDown={event => event.stopPropagation()} onClick={() => onChoose('create')}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
    </div>;
}
