interface ListItem {
    task?: string;
    position: { start: { line: number }; end: { line: number } };
}

/** Compute next deeper checklist entries in linear time, respecting the existing list-item boundaries. */
export function checklistRanges(items: ListItem[], lines: string[]) {
    const indents = items.map(item => (lines[item.position.start.line]?.match(/^\s*/) || [''])[0].length);
    const stack: number[] = [];
    const deeper = new Map<number, number>();
    for (let i = items.length - 1; i >= 0; i--) {
        if (!items[i]?.task) continue;
        while (stack.length && indents[stack[stack.length - 1]!]! <= indents[i]!) stack.pop();
        if (stack.length) deeper.set(i, items[stack[stack.length - 1]!]!.position.start.line);
        stack.push(i);
    }
    return items.map((item, i) => {
        const startLine = item.position.start.line;
        const nextLine = items[i + 1]?.position.start.line;
        const endLine = nextLine !== undefined && nextLine <= item.position.end.line ? nextLine - 1 : item.position.end.line;
        const child = deeper.get(i);
        return { startLine, endLine, notesStartLine: startLine + 1, notesEndLine: child !== undefined && child <= endLine ? child - 1 : endLine };
    });
}
