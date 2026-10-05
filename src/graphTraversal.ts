export function hiddenDescendants(children: Record<string, string[]>, collapsed: Set<string>): Set<string> {
    const hidden = new Set<string>();
    const queue: string[] = [];
    for (const id of collapsed) for (const child of children[id] || []) {
        if (!hidden.has(child)) { hidden.add(child); queue.push(child); }
    }
    for (let index = 0; index < queue.length; index++) {
        for (const child of children[queue[index]!] || []) {
            if (!hidden.has(child)) { hidden.add(child); queue.push(child); }
        }
    }
    return hidden;
}

/** Visit each descendant once without recursion or copying the path at every step. */
export function compactDescendants(children: Record<string, string[]>, root: string): { id: string; depth: number }[] {
    const seen = new Set([root]);
    const result: { id: string; depth: number }[] = [];
    const stack = (children[root] || []).map(id => ({ id, depth: 1 })).reverse();
    while (stack.length) {
        const row = stack.pop()!;
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        result.push(row);
        const descendants = children[row.id] || [];
        for (let i = descendants.length - 1; i >= 0; i--) stack.push({ id: descendants[i]!, depth: row.depth + 1 });
    }
    return result;
}
