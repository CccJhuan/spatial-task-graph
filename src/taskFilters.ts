export interface FilterCondition {
    operator: 'AND' | 'OR';
    field: 'tag' | 'path';
    value: string;
    enabled: boolean;
    matchAll?: boolean;
}

interface LegacyFilters {
    tags: string[]; folders: string[]; tagMode?: 'AND' | 'OR'; conditions?: FilterCondition[];
}

export function getFilterConditions(filters: LegacyFilters): FilterCondition[] {
    if (filters.conditions) return filters.conditions.map(condition => ({ ...condition }));
    const conditions: FilterCondition[] = [];
    if (filters.tagMode === 'AND') {
        for (const tag of filters.tags) conditions.push({ operator: 'AND', field: 'tag', value: tag, enabled: true });
    } else if (filters.tags.length) conditions.push({ operator: 'AND', field: 'tag', value: filters.tags.join(', '), enabled: true });
    if (filters.folders.length) conditions.push({ operator: 'AND', field: 'path', value: filters.folders.join(', '), enabled: true });
    return conditions;
}

/** Conditions combine in their displayed order, starting with the first active row. */
export function matchesFilterConditions(rawText: string, path: string, conditions: FilterCondition[]): boolean {
    const tags = new Set((rawText.match(/#[\w\u4e00-\u9fa5-]+(?:\/[\w\u4e00-\u9fa5-]+)*/g) || []).map(tag => tag.toLowerCase()));
    let result: boolean | undefined;
    for (const condition of conditions) {
        if (!condition.enabled) continue;
        const values = condition.value.split(/[,，]/).map(value => value.trim()).filter(Boolean);
        if (!values.length) continue;
        const match = (value: string) => condition.field === 'tag'
            ? tags.has((value.startsWith('#') ? value : `#${value}`).toLowerCase())
            : path === value.replace(/\/$/, '') || path.startsWith(`${value.replace(/\/$/, '')}/`);
        const matches = condition.matchAll ? values.every(match) : values.some(match);
        result = result === undefined ? matches : condition.operator === 'OR' ? result || matches : result && matches;
    }
    return result ?? true;
}

/** Match complete values or any segment, with or without a leading hash. */
export function filterSuggestions(options: string[], query: string): string[] {
    const normalized = query.trim().replace(/^#/, '').toLowerCase();
    return options.filter(option => option.replace(/^#/, '').toLowerCase().includes(normalized)).slice(0, 10);
}
