import * as React from 'react';
import { isSimplifiedChinese } from './language';

/** Screen-space action near the selection release point, clamped inside this graph. */
export function GroupCreateAction({ point, onCreate, container }: {
    point: { x: number; y: number }; onCreate: () => void; container: HTMLElement;
}) {
    const button = React.useRef<HTMLButtonElement>(null);
    const [position, setPosition] = React.useState({ x: 0, y: 0 });
    React.useLayoutEffect(() => {
        const graph = container.querySelector('.task-graph-container') || container;
        const bounds = graph.getBoundingClientRect();
        const width = button.current?.offsetWidth || 140;
        const height = button.current?.offsetHeight || 36;
        const x = point.x - bounds.left; const y = point.y - bounds.top;
        setPosition({
            x: Math.max(8, Math.min(x + 12, bounds.width - width - 8)),
            y: Math.max(8, Math.min(bounds.height - height - 8, y + 12 + height > bounds.height - 8 ? y - height - 12 : y + 12))
        });
    }, [point, container]);
    return <button ref={button} className="task-group-create-action nodrag nopan"
        style={{ left: position.x, top: position.y }}
        onMouseDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}
        onClick={event => { event.stopPropagation(); onCreate(); }}>
        {isSimplifiedChinese() ? '创建组合框' : 'Create group'}
    </button>;
}
