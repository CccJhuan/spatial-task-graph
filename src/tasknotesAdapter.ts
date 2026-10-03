export type TaskNotesStatusCategory = 'backlog' | 'in_progress' | 'finished';

export interface TaskNotesSettings {
    enabled: boolean;
    identificationMethod: 'tag' | 'property';
    taskTag: string;
    propertyName: string;
    propertyValue: string;
    titleProperty: string;
    statusProperty: string;
    backlogStatuses: string;
    inProgressStatuses: string;
    finishedStatuses: string;
}

export interface ParsedTaskNotes {
    title: string;
    status: string;
    category: TaskNotesStatusCategory;
    notes: string;
}

const scalar = (value: unknown): string => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
const normalize = (value: unknown): string => scalar(value)
    .trim()
    .replace(/^#/, '')
    .replace(/\s+/g, '-')
    .toLowerCase();

const listValues = (value: unknown): unknown[] => Array.isArray(value) ? value : [value];

const csv = (value: string): string[] => value.split(',').map(normalize).filter(Boolean);

export function frontmatterTags(value: unknown): string[] {
    return listValues(value).map(normalize).filter(Boolean);
}

export function matchesTaskNotesIdentifier(frontmatter: Record<string, unknown>, settings: TaskNotesSettings): boolean {
    if (settings.identificationMethod === 'property') {
        const expected = normalize(settings.propertyValue);
        if (!settings.propertyName.trim() || !expected) return false;
        return listValues(frontmatter[settings.propertyName]).some(value => {
            if (typeof value === 'boolean') return String(value) === expected;
            return normalize(value) === expected;
        });
    }

    const expected = normalize(settings.taskTag);
    return Boolean(expected) && frontmatterTags(frontmatter.tags).includes(expected);
}

export function taskNotesStatusCategory(status: string, settings: TaskNotesSettings): TaskNotesStatusCategory {
    const normalized = normalize(status);
    if (csv(settings.finishedStatuses).includes(normalized)) return 'finished';
    if (csv(settings.inProgressStatuses).includes(normalized)) return 'in_progress';
    return 'backlog';
}

export function taskNotesStatusForCategory(category: TaskNotesStatusCategory, settings: TaskNotesSettings): string {
    const values = category === 'finished' ? csv(settings.finishedStatuses)
        : category === 'in_progress' ? csv(settings.inProgressStatuses)
            : csv(settings.backlogStatuses);
    return values[0] || (category === 'finished' ? 'done' : category === 'in_progress' ? 'in-progress' : 'open');
}

export function parseTaskNotesFrontmatter(
    frontmatter: Record<string, unknown>,
    settings: TaskNotesSettings,
    basename: string,
    body: string
): ParsedTaskNotes | null {
    if (!matchesTaskNotesIdentifier(frontmatter, settings)) return null;
    const configuredTitle = settings.titleProperty.trim() ? frontmatter[settings.titleProperty] : undefined;
    const title = typeof configuredTitle === 'string' && configuredTitle.trim() ? configuredTitle.trim() : basename;
    const rawStatus = frontmatter[settings.statusProperty.trim() || 'status'];
    const statusValue = scalar(rawStatus);
    const status = statusValue.trim() === '' ? taskNotesStatusForCategory('backlog', settings) : statusValue;
    return { title, status, category: taskNotesStatusCategory(status, settings), notes: body.trim() };
}
