import { useState } from 'react';
import type { Item, Category, SortOption } from '../types';
import { CATEGORY_LABELS, CATEGORIES, CategoryIcon } from '../utils/categories';

export type { SortOption } from '../types';

interface Props {
    items: Item[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    onAdd: () => void;
    sort: SortOption;
    onSortChange: (s: SortOption) => void;
    selectedIds: Set<string>;
    onToggleSelect: (id: string) => void;
    onBulkDelete: () => void;
    onBulkMove: (cat: Category) => void;
}

const SORT_LABELS: Record<SortOption, string> = {
    'alpha-asc':  'A → Z',
    'alpha-desc': 'Z → A',
    'date-new':   'Neueste zuerst',
    'date-old':   'Älteste zuerst',
    'strength':   'Passwortstärke',
};

export default function EntryList({
    items, selectedId, onSelect, onAdd,
    sort, onSortChange,
    selectedIds, onToggleSelect, onBulkDelete, onBulkMove,
}: Props) {
    const [showSort, setShowSort] = useState(false);
    const [showMove, setShowMove] = useState(false);
    const hasSelection = selectedIds.size > 0;

    return (
        <div className="flex flex-col h-full w-64 border-r shrink-0 relative" style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-3.5 border-b" style={{ borderColor: 'var(--border)' }}>
                <span className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                    {items.length} {items.length === 1 ? 'Eintrag' : 'Einträge'}
                </span>
                <div className="flex items-center gap-1.5">
                    {/* Sort */}
                    <div className="relative">
                        <button
                            onClick={() => { setShowSort(s => !s); setShowMove(false); }}
                            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
                            style={{ color: sort !== 'alpha-asc' ? 'var(--accent)' : 'var(--text-2)' }}
                            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.07)')}
                            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                            title="Sortierung"
                        >
                            <SortIcon />
                        </button>
                        {showSort && (
                            <div
                                className="absolute right-0 top-full mt-1 z-30 rounded-xl border py-1 w-44 shadow-lg"
                                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
                            >
                                {(Object.entries(SORT_LABELS) as [SortOption, string][]).map(([key, label]) => (
                                    <button
                                        key={key}
                                        onClick={() => { onSortChange(key); setShowSort(false); }}
                                        className="w-full flex items-center justify-between px-3 py-2 text-sm text-left"
                                        style={{ color: sort === key ? 'var(--accent)' : 'var(--text-2)' }}
                                        onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)')}
                                        onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                                    >
                                        <span>{label}</span>
                                        {sort === key && <CheckSmallIcon />}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    {/* Add */}
                    <button
                        onClick={onAdd}
                        className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg font-medium text-white transition-opacity hover:opacity-80 active:scale-95"
                        style={{ background: 'var(--accent)' }}
                    >
                        <span className="text-base leading-none">+</span>
                        <span>Neu</span>
                    </button>
                </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto py-1" onClick={() => { setShowSort(false); setShowMove(false); }}>
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
                        const isChecked = selectedIds.has(item.id);
                        return (
                            <div
                                key={item.id}
                                className="flex items-center mx-1 rounded-xl anim-fade-in"
                                style={{
                                    backgroundColor: isSelected ? 'var(--surface-2)' : 'transparent',
                                    animationDelay: `${i * 0.03}s`,
                                }}
                                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--surface-2)'; }}
                                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent'; }}
                            >
                                {/* Checkbox */}
                                <button
                                    onClick={e => { e.stopPropagation(); onToggleSelect(item.id); }}
                                    className="pl-2.5 pr-1.5 py-2.5 flex items-center shrink-0"
                                    style={{ color: 'transparent' }}
                                >
                                    <span
                                        className="w-4 h-4 rounded border-2 flex items-center justify-center transition-colors"
                                        style={{
                                            borderColor: isChecked ? 'var(--accent)' : 'var(--border)',
                                            backgroundColor: isChecked ? 'var(--accent)' : 'transparent',
                                        }}
                                    >
                                        {isChecked && (
                                            <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="2">
                                                <path d="M2 5l2.5 2.5L8 3" strokeLinecap="round" strokeLinejoin="round" />
                                            </svg>
                                        )}
                                    </span>
                                </button>

                                {/* Row */}
                                <button
                                    onClick={() => { onSelect(item.id); }}
                                    className="flex-1 py-2.5 pr-3 text-left flex items-center gap-2.5 min-w-0"
                                    style={{ width: 'calc(100% - 36px)' }}
                                >
                                    <CategoryIcon category={item.category} size={36} />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>
                                            {item.payload.title || '(Kein Titel)'}
                                        </p>
                                        <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-2)' }}>
                                            {item.payload.username || item.payload.url || CATEGORY_LABELS[item.category]}
                                        </p>
                                    </div>
                                    {isSelected && !hasSelection && (
                                        <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--accent)' }} />
                                    )}
                                </button>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Bulk action bar */}
            {hasSelection && (
                <div className="border-t px-3 py-2.5 shrink-0" style={{ borderColor: 'var(--border)' }}>
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-medium mr-auto" style={{ color: 'var(--text-2)' }}>
                            {selectedIds.size} ausgewählt
                        </span>
                        {/* Move dropdown */}
                        <div className="relative">
                            <button
                                onClick={() => setShowMove(s => !s)}
                                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border transition-colors"
                                style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
                                onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)')}
                                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                            >
                                Verschieben
                                <svg className="w-3 h-3" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                                    <path d="M2 4l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            </button>
                            {showMove && (
                                <div
                                    className="absolute bottom-full right-0 mb-1 z-30 rounded-xl border py-1 w-36 shadow-lg"
                                    style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
                                >
                                    {CATEGORIES.map(cat => (
                                        <button
                                            key={cat}
                                            onClick={() => { onBulkMove(cat); setShowMove(false); }}
                                            className="w-full px-3 py-2 text-sm text-left"
                                            style={{ color: 'var(--text-2)' }}
                                            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)')}
                                            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                                        >
                                            {CATEGORY_LABELS[cat]}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <button
                            onClick={onBulkDelete}
                            className="text-xs px-2.5 py-1.5 rounded-lg transition-colors"
                            style={{ color: 'var(--vault-danger)' }}
                            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(255,69,58,0.1)')}
                            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                        >
                            Löschen
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

function SortIcon() {
    return (
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 4h12M4 8h8M6 12h4" strokeLinecap="round" />
        </svg>
    );
}
function CheckSmallIcon() {
    return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2.5 7l3 3 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}
