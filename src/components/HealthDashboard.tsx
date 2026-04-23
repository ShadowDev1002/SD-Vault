import { useMemo } from 'react';
import type { Item } from '../types';
import { measureStrength } from '../utils/strength';

interface Props {
    items: Item[];
    onSelect: (id: string) => void;
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export default function HealthDashboard({ items, onSelect }: Props) {
    const now = Date.now();
    const logins = useMemo(() => items.filter(i => i.category === 'login'), [items]);

    const weak = useMemo(
        () => logins.filter(i => i.payload.password && measureStrength(i.payload.password).score <= 1),
        [logins],
    );

    const reused = useMemo(() => {
        const byPw = new Map<string, Item[]>();
        for (const item of logins) {
            if (!item.payload.password) continue;
            const pw = item.payload.password;
            if (!byPw.has(pw)) byPw.set(pw, []);
            byPw.get(pw)!.push(item);
        }
        return [...byPw.values()].filter(g => g.length > 1).flat();
    }, [logins]);

    const old = useMemo(
        () => logins.filter(i => now - i.updated_at * 1000 > NINETY_DAYS_MS),
        [logins, now],
    );

    const issueCount = new Set([...weak, ...reused, ...old].map(i => i.id)).size;
    const score = logins.length === 0 ? 100 : Math.round((1 - issueCount / logins.length) * 100);
    const scoreColor = score >= 80 ? '#22c55e' : score >= 60 ? '#eab308' : '#ef4444';

    return (
        <div className="flex-1 overflow-y-auto p-6 space-y-6" style={{ backgroundColor: 'var(--vault-bg)' }}>
            {/* Score */}
            <div className="rounded-2xl p-6 space-y-4" style={{ backgroundColor: 'var(--surface)' }}>
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-sm font-semibold text-white">Passwort-Gesundheit</h2>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>
                            {logins.length} Login{logins.length !== 1 ? 's' : ''} analysiert
                        </p>
                    </div>
                    <span className="text-4xl font-bold tabular-nums" style={{ color: scoreColor }}>
                        {score}%
                    </span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--surface-2)' }}>
                    <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${score}%`, backgroundColor: scoreColor }}
                    />
                </div>
                <div className="flex gap-4 text-xs" style={{ color: 'var(--text-2)' }}>
                    <span><span className="font-semibold" style={{ color: '#ef4444' }}>{weak.length}</span> schwach</span>
                    <span><span className="font-semibold" style={{ color: '#f97316' }}>{reused.length}</span> wiederverwendet</span>
                    <span><span className="font-semibold" style={{ color: '#eab308' }}>{old.length}</span> veraltet</span>
                </div>
            </div>

            {logins.length === 0 && (
                <p className="text-center text-sm py-8" style={{ color: 'var(--text-2)' }}>
                    Keine Login-Einträge vorhanden.
                </p>
            )}

            <HealthSection
                title="Schwache Passwörter"
                description="Sehr schwache oder schwache Stärke"
                items={weak}
                color="#ef4444"
                onSelect={onSelect}
            />
            <HealthSection
                title="Wiederverwendete Passwörter"
                description="Dasselbe Passwort in mehreren Einträgen"
                items={reused}
                color="#f97316"
                onSelect={onSelect}
            />
            <HealthSection
                title="Veraltete Passwörter"
                description="Seit über 90 Tagen nicht geändert"
                items={old}
                color="#eab308"
                onSelect={onSelect}
            />
        </div>
    );
}

function HealthSection({ title, description, items, color, onSelect }: {
    title: string;
    description: string;
    items: Item[];
    color: string;
    onSelect: (id: string) => void;
}) {
    if (items.length === 0) return null;
    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <h3 className="text-sm font-semibold text-white">{title}</h3>
                <span
                    className="ml-auto text-xs px-2 py-0.5 rounded-full font-semibold tabular-nums"
                    style={{ backgroundColor: color + '22', color }}
                >
                    {items.length}
                </span>
            </div>
            <p className="text-xs pl-4" style={{ color: 'var(--text-2)' }}>{description}</p>
            <div className="space-y-1">
                {items.map(item => (
                    <button
                        key={item.id}
                        onClick={() => onSelect(item.id)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors"
                        style={{ backgroundColor: 'var(--surface-2)' }}
                        onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--surface-3)')}
                        onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'var(--surface-2)')}
                    >
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate text-white">
                                {item.payload.title || '(Kein Titel)'}
                            </p>
                            {(item.payload.username || item.payload.url) && (
                                <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-2)' }}>
                                    {item.payload.username || item.payload.url}
                                </p>
                            )}
                        </div>
                        <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--text-3)' }}>
                            <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                ))}
            </div>
        </div>
    );
}
