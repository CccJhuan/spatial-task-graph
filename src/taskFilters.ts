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
export function createFilterMatcher(conditions: FilterCondition[]): (rawText: string, path: string) => boolean {
    const compiled = conditions.filter(condition => condition.enabled).map(condition => ({
        ...condition,
        values: condition.value.split(/[,，]/).map(value => value.trim()).filter(Boolean).map(value => condition.field === 'tag'
            ? (value.startsWith('#') ? value : `#${value}`).toLowerCase() : value.replace(/\/$/, ''))
    })).filter(condition => condition.values.length > 0);
    const needsTags = compiled.some(condition => condition.field === 'tag');
    return (rawText, path) => {
        if (!compiled.length) return true;
        const tags = needsTags ? new Set((rawText.match(/#[\w\u4e00-\u9fa5-]+(?:\/[\w\u4e00-\u9fa5-]+)*/g) || []).map(tag => tag.toLowerCase())) : undefined;
        let result: boolean | undefined;
        for (const condition of compiled) {
            const match = (value: string) => condition.field === 'tag' ? tags!.has(value) : path === value || path.startsWith(`${value}/`);
            const matches = condition.matchAll ? condition.values.every(match) : condition.values.some(match);
            result = result === undefined ? matches : condition.operator === 'OR' ? result || matches : result && matches;
        }
        return result ?? true;
    };
}

export function matchesFilterConditions(rawText: string, path: string, conditions: FilterCondition[]): boolean {
    return createFilterMatcher(conditions)(rawText, path);
}

/** Match complete values or any segment, with or without a leading hash. */
export function filterSuggestions(options: string[], query: string): string[] {
    const normalized = query.trim().replace(/^#/, '').toLowerCase();
    const matches: string[] = [];
    for (const option of options) {
        if (option.replace(/^#/, '').toLowerCase().includes(normalized)) matches.push(option);
        if (matches.length === 10) break;
    }
    return matches;
}
