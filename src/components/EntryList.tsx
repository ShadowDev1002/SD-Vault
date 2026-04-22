import type { Item, Category } from '../types';

interface Props {
    items: Item[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    onAdd: () => void;
}

const CATEGORY_COLOR: Record<Category, string> = {
    login:    '#0a84ff',
    card:     '#32d74b',
    note:     '#ff9f0a',
    identity: '#bf5af2',
};

const CATEGORY_LABEL: Record<Category, string> = {
    login:    'Login',
    card:     'Karte',
    note:     'Notiz',
    identity: 'Identität',
};

function CategoryIcon({ category }: { category: Category }) {
    const color = CATEGORY_COLOR[category];
    return (
        <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-white font-semibold text-sm"
            style={{ background: `linear-gradient(135deg, ${color}cc, ${color}88)` }}
        >
            {category === 'login'    && <KeySvg />}
            {category === 'card'     && <CardSvg />}
            {category === 'note'     && <NoteSvg />}
            {category === 'identity' && <UserSvg />}
        </div>
    );
}

export default function EntryList({ items, selectedId, onSelect, onAdd }: Props) {
    return (
        <div className="flex flex-col h-full w-64 border-r shrink-0" style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}>
            {/* Header */}
            <div
                className="flex items-center justify-between px-4 py-3.5 border-b"
                style={{ borderColor: 'var(--border)' }}
            >
                <span className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                    {items.length} {items.length === 1 ? 'Eintrag' : 'Einträge'}
                </span>
                <button
                    onClick={onAdd}
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg font-medium text-white transition-opacity hover:opacity-80 active:scale-95"
                    style={{ background: 'var(--accent)' }}
                >
                    <span className="text-base leading-none">+</span>
                    <span>Neu</span>
                </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto py-1">
                {items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center px-6 gap-3 anim-fade-in">
                        <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'var(--surface-2)' }}>
                            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--text-3)' }}>
                                <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" strokeLinecap="round" />
                            </svg>
                        </div>
                        <div>
                            <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>Keine Einträge</p>
                            <button onClick={onAdd} className="mt-1.5 text-xs" style={{ color: 'var(--accent)' }}>
                                Ersten Eintrag erstellen →
                            </button>
                        </div>
                    </div>
                ) : (
                    items.map((item, i) => {
                        const isSelected = selectedId === item.id;
                        return (
                            <button
                                key={item.id}
                                onClick={() => onSelect(item.id)}
                                className="w-full px-3 py-2.5 text-left flex items-center gap-3 mx-1 rounded-xl transition-colors anim-fade-in"
                                style={{
                                    width: 'calc(100% - 8px)',
                                    backgroundColor: isSelected ? 'var(--surface-2)' : 'transparent',
                                    animationDelay: `${i * 0.03}s`,
                                }}
                                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--surface-2)'; }}
                                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent'; }}
                            >
                                <CategoryIcon category={item.category} />
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>
                                        {item.payload.title || '(Kein Titel)'}
                                    </p>
                                    <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-2)' }}>
                                        {item.payload.username || item.payload.url || CATEGORY_LABEL[item.category]}
                                    </p>
                                </div>
                                {isSelected && (
                                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--accent)' }} />
                                )}
                            </button>
                        );
                    })
                )}
            </div>
        </div>
    );
}

function KeySvg() {
    return <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="1.5"><circle cx="5.5" cy="8" r="3.5" /><path d="M9 8h6M13 6v4" strokeLinecap="round" /></svg>;
}
function CardSvg() {
    return <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="1.5"><rect x="1" y="3" width="14" height="10" rx="1.5" /><path d="M1 6h14" strokeLinecap="round" /></svg>;
}
function NoteSvg() {
    return <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="1.5"><rect x="2" y="1" width="12" height="14" rx="1.5" /><path d="M5 5h6M5 8h6M5 11h4" strokeLinecap="round" /></svg>;
}
function UserSvg() {
    return <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="1.5"><circle cx="8" cy="5" r="3" /><path d="M2 14c0-3.3 2.7-5 6-5s6 1.7 6 5" strokeLinecap="round" /></svg>;
}
