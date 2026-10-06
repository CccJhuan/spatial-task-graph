import * as React from 'react';
import { Panel, useReactFlow } from 'reactflow';
import { isSimplifiedChinese } from './language';

export function GraphToolbar({ onBack, onCanvas }: { onBack?: () => void; onCanvas?: () => void }) {
    const { zoomIn, zoomOut, fitView } = useReactFlow();
    const zh = isSimplifiedChinese();
    const icon = (content: React.ReactNode) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{content}</svg>;
    return <Panel position="bottom-right" className="task-graph-toolbar" onMouseDown={event => event.stopPropagation()}>
        {onBack && <button onClick={onBack} title={zh ? '返回上一级' : 'Back to parent'} aria-label={zh ? '返回上一级' : 'Back to parent'}>{icon(<><path d="m9 14-5-5 5-5" /><path d="M4 9h9a7 7 0 0 1 7 7v4" /></>)}</button>}
        {onCanvas && <button className="task-graph-toolbar-canvas" onClick={onCanvas} title={zh ? '返回完整画布' : 'Return to canvas'} aria-label={zh ? '返回完整画布' : 'Return to canvas'}>{icon(<><rect x="3" y="3" width="18" height="18" rx="3" /><rect x="6" y="6" width="4" height="4" rx="1" /><rect x="14" y="14" width="4" height="4" rx="1" /><path d="M10 8h6v6" /></>)}</button>}
        <button onClick={() => { zoomIn(); }} title={zh ? '放大' : 'Zoom in'} aria-label={zh ? '放大' : 'Zoom in'}>{icon(<><path d="M12 5v14" /><path d="M5 12h14" /></>)}</button>
        <button onClick={() => { zoomOut(); }} title={zh ? '缩小' : 'Zoom out'} aria-label={zh ? '缩小' : 'Zoom out'}>{icon(<path d="M5 12h14" />)}</button>
        <button onClick={() => { fitView({ duration: 800 }); }} title={zh ? '适应画布' : 'Fit view'} aria-label={zh ? '适应画布' : 'Fit view'}>{icon(<><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></>)}</button>
    </Panel>;
}
