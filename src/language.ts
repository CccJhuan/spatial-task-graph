import { getLanguage, requireApiVersion } from 'obsidian';

export function isSimplifiedChinese(): boolean {
    // getLanguage was introduced in 1.8.7; guard the call for older hosts.
    const language = requireApiVersion('1.8.7') ? getLanguage() : window.navigator.language;
    return /^zh(?:-cn|-hans)?$/i.test(language || 'en');
}
