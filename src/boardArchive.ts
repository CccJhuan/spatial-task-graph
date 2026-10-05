import type { GraphBoard } from './main';

export function archiveBoard(boards: GraphBoard[], id: string) {
    if (!boards.some(board => board.id === id)) throw new Error('Board not found');
    const nextBoards = boards.map(board => board.id === id ? { ...board, archived: true } : board);
    let nextBoard = nextBoards.find(board => !board.archived);
    if (!nextBoard) {
        nextBoard = {
            id: `board-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: 'Main board',
            filters: { tags: [], excludeTags: [], folders: [], status: [' ', '/'], tagMode: 'OR' },
            data: { layout: {}, edges: [], nodeStatus: {}, textNodes: [], taskPaths: [...new Set(boards.flatMap(board => board.data.taskPaths || []))] }
        };
        nextBoards.push(nextBoard);
    }
    return { boards: nextBoards, nextBoardId: nextBoard.id };
}

export function restoreBoard(boards: GraphBoard[], id: string): GraphBoard[] {
    return boards.map(board => board.id === id ? { ...board, archived: false } : board);
}

export function deleteArchivedBoard(boards: GraphBoard[], id: string): GraphBoard[] {
    const removed = boards.find(board => board.id === id && board.archived);
    if (!removed) throw new Error('Only archived boards can be permanently deleted');
    const remaining = boards.filter(board => board.id !== id);
    const owner = remaining.find(board => !board.archived);
    // Preserve cleanup ownership of generated references without retaining the board.
    return remaining.map(board => board === owner ? { ...board, data: {
        ...board.data,
        generatedBlockIds: [...new Set([...(board.data.generatedBlockIds || []), ...(removed.data.generatedBlockIds || [])])],
        taskPaths: [...new Set([...(board.data.taskPaths || []), ...(removed.data.taskPaths || [])])]
    } } : board);
}
