import type { Category } from '../types';

interface Props {
    activeCategory: Category | 'all';
    onCategoryChange: (cat: Category | 'all') => void;
    search: string;
    onSearchChange: (s: string) => void;
    onLock: () => void;
    onSettings: () => void;
}

const CATEGORIES: { key: Category | 'all'; label: string; icon: string }[] = [
    { key: 'all', label: 'Alle Einträge', icon: '📋' },
    { key: 'login', label: 'Logins', icon: '🔑' },
    { key: 'card', label: 'Karten', icon: '💳' },
    { key: 'note', label: 'Notizen', icon: '📝' },
    { key: 'identity', label: 'Identitäten', icon: '👤' },
];

export default function Sidebar({ activeCategory, onCategoryChange, search, onSearchChange, onLock, onSettings }: Props) {
    return (
        <aside className="flex flex-col h-full w-56 border-r shrink-0" style={{ backgroundColor: 'var(--vault-surface)', borderColor: 'var(--vault-border)' }}>
            <div className="p-4 border-b" style={{ borderColor: 'var(--vault-border)' }}>
                <h1 className="text-sm font-bold text-white">🔒 SD-Vault</h1>
            </div>

            <div className="p-3">
                <input
                    type="text"
                    value={search}
                    onChange={e => onSearchChange(e.target.value)}
                    placeholder="Suchen..."
                    className="w-full px-3 py-1.5 text-sm rounded-lg border text-white focus:outline-none"
                    style={{ backgroundColor: 'var(--vault-bg)', borderColor: 'var(--vault-border)' }}
                />
            </div>

            <nav className="flex-1 px-2 space-y-0.5">
                {CATEGORIES.map(({ key, label, icon }) => (
                    <button
                        key={key}
                        onClick={() => onCategoryChange(key)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-colors"
                        style={{
                            backgroundColor: activeCategory === key ? 'var(--vault-accent)' : 'transparent',
                            color: activeCategory === key ? 'white' : 'var(--vault-muted)',
                        }}
                    >
                        <span>{icon}</span>
                        <span>{label}</span>
                    </button>
                ))}
            </nav>

            <div className="p-3 border-t flex gap-2" style={{ borderColor: 'var(--vault-border)' }}>
                <button
                    onClick={onSettings}
                    className="flex-1 py-1.5 text-xs rounded-lg border transition-colors"
                    style={{ borderColor: 'var(--vault-border)', color: 'var(--vault-muted)' }}
                >
                    ⚙️ Einstellungen
                </button>
                <button
                    onClick={onLock}
                    className="flex-1 py-1.5 text-xs rounded-lg border transition-colors"
                    style={{ borderColor: 'var(--vault-border)', color: 'var(--vault-muted)' }}
                >
                    🔒 Sperren
                </button>
            </div>
        </aside>
    );
}
