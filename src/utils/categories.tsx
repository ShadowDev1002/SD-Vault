import type { Category } from '../types';

export const CATEGORY_COLORS: Record<Category, string> = {
    login:    '#0a84ff',
    card:     '#32d74b',
    note:     '#ff9f0a',
    identity: '#bf5af2',
};

export const CATEGORY_LABELS: Record<Category, string> = {
    login:    'Login',
    card:     'Karte',
    note:     'Notiz',
    identity: 'Identität',
};

export const CATEGORIES: Category[] = ['login', 'card', 'note', 'identity'];

export function CategoryIcon({ category, size = 36 }: { category: Category; size?: number }) {
    const color = CATEGORY_COLORS[category];
    return (
        <div
            className="flex items-center justify-center shrink-0"
            style={{
                width: size, height: size,
                borderRadius: Math.round(size * 0.28),
                background: `linear-gradient(135deg, ${color}cc, ${color}88)`,
                color: 'white',
            }}
        >
            <span style={{ width: size * 0.45, height: size * 0.45, display: 'flex' }}>
                <CategorySvg category={category} />
            </span>
        </div>
    );
}

function CategorySvg({ category }: { category: Category }) {
    if (category === 'login') return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="5.5" cy="8" r="3.5" />
            <path d="M9 8h6M13 6v4" strokeLinecap="round" />
        </svg>
    );
    if (category === 'card') return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="1" y="3" width="14" height="10" rx="1.5" />
            <path d="M1 6h14" strokeLinecap="round" />
        </svg>
    );
    if (category === 'note') return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="1" width="12" height="14" rx="1.5" />
            <path d="M5 5h6M5 8h6M5 11h4" strokeLinecap="round" />
        </svg>
    );
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="5" r="3" />
            <path d="M2 14c0-3.3 2.7-5 6-5s6 1.7 6 5" strokeLinecap="round" />
        </svg>
    );
}
