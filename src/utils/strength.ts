import zxcvbn from 'zxcvbn';

export type StrengthLevel = 0 | 1 | 2 | 3 | 4;

export interface StrengthResult {
    score: StrengthLevel;
    label: string;
    color: string;
}

const LABELS = ['Sehr schwach', 'Schwach', 'Mittel', 'Stark', 'Sehr stark'];
const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#16a34a'];

export function measureStrength(password: string): StrengthResult {
    if (!password) {
        return { score: 0, label: LABELS[0], color: COLORS[0] };
    }

    const result = zxcvbn(password);
    const score = result.score as StrengthLevel;
    return { score, label: LABELS[score], color: COLORS[score] };
}
