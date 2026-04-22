import type { Item, Category } from '../types';

interface Props {
    items: Item[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    onAdd: () => void;
}

function formatDate(ts: number): string {
    return new Date(ts * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const CATEGORY_ICON: Record<Category, string> = {
    login: '🔑',
    card: '💳',
    note: '📝',
    identity: '👤',
};

export default function EntryList({ items, selectedId, onSelect, onAdd }: Props) {
    return (
        <div className="flex flex-col h-full w-64 border-r shrink-0" style={{ backgroundColor: 'var(--vault-bg)', borderColor: 'var(--vault-border)' }}>
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--vault-border)' }}>
                <span className="text-sm font-medium text-gray-400">{items.length} Einträge</span>
                <button
                    onClick={onAdd}
                    className="text-xs px-3 py-1 rounded-lg font-medium text-white"
                    style={{ backgroundColor: 'var(--vault-accent)' }}
                >
                    + Neu
                </button>
            </div>

            <div className="flex-1 overflow-y-auto">
                {items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center p-6">
                        <p className="text-sm" style={{ color: 'var(--vault-muted)' }}>Keine Einträge</p>
                        <button onClick={onAdd} className="mt-3 text-xs underline" style={{ color: 'var(--vault-accent)' }}>
                            Ersten Eintrag erstellen
                        </button>
                    </div>
                ) : (
                    items.map(item => (
                        <button
                            key={item.id}
                            onClick={() => onSelect(item.id)}
                            className="w-full px-4 py-3 text-left border-b flex items-start gap-3 transition-colors"
                            style={{
                                borderColor: 'var(--vault-border)',
                                backgroundColor: selectedId === item.id ? 'var(--vault-surface)' : 'transparent',
                            }}
                        >
                            <span className="text-lg mt-0.5">{CATEGORY_ICON[item.category]}</span>
                            <div className="min-w-0">
                                <p className="text-sm font-medium text-white truncate">{item.payload.title || '(Kein Titel)'}</p>
                                <p className="text-xs truncate mt-0.5" style={{ color: 'var(--vault-muted)' }}>
                                    {item.payload.username || item.payload.url || formatDate(item.updated_at)}
                                </p>
                            </div>
                        </button>
                    ))
                )}
            </div>
        </div>
    );
}
