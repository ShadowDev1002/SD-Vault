import { useState, useRef } from 'react';
import type { Item, Category, ViewCategory } from '../types';
import { invoke } from '@tauri-apps/api/core';
import { CATEGORY_COLORS, CategoryIcon } from '../utils/categories';

const CATEGORY_CHIPS: { key: ViewCategory; label: string }[] = [
    { key: 'all',      label: 'Alle' },
    { key: 'login',    label: 'Login' },
    { key: 'card',     label: 'Karte' },
    { key: 'note',     label: 'Notiz' },
    { key: 'identity', label: 'Identität' },
];

interface Props {
    items: Item[];
    activeCategory: ViewCategory;
    activeTag: string | null;
    allTags: string[];
    search: string;
    onSearchChange: (s: string) => void;
    onCategoryChange: (cat: ViewCategory) => void;
    onTagChange: (tag: string | null) => void;
    onSelect: (id: string) => void;
    onAdd: (cat: Category) => void;
    onLock: () => void;
    onDeleted: () => void;
}

export default function MobileVaultList({
    items, activeCategory, activeTag, allTags, search, onSearchChange,
    onCategoryChange, onTagChange, onSelect, onAdd, onLock, onDeleted,
}: Props) {
    const [sheetOpen, setSheetOpen] = useState(false);
    const swipeStartX = useRef<number>(0);
    const swipeEl = useRef<Map<string, HTMLDivElement>>(new Map());
    const swipeOffset = useRef<Map<string, number>>(new Map());

    function handleSwipeStart(id: string, x: number) {
        swipeEl.current.forEach((el, key) => {
            if (key !== id) {
                el.style.transform = 'translateX(0)';
                swipeOffset.current.set(key, 0);
            }
        });
        swipeStartX.current = x;
        swipeOffset.current.set(id, 0);
    }

    function handleSwipeMove(id: string, x: number) {
        const delta = swipeStartX.current - x;
        if (delta < 0) {
            const el = swipeEl.current.get(id);
            if (el) el.style.transform = 'translateX(0)';
            swipeOffset.current.set(id, 0);
            return;
        }
        const el = swipeEl.current.get(id);
        if (el) el.style.transform = `translateX(-${Math.min(delta, 80)}px)`;
        swipeOffset.current.set(id, delta);
    }

    function handleSwipeEnd(id: string) {
        const offset = swipeOffset.current.get(id) ?? 0;
        const el = swipeEl.current.get(id);
        if (offset < 80) {
            if (el) el.style.transform = 'translateX(0)';
            swipeOffset.current.set(id, 0);
        }
    }

    async function handleDelete(id: string) {
        if (!confirm('Eintrag wirklich löschen?')) return;
        await invoke('delete_item', { id });
        const el = swipeEl.current.get(id);
        if (el) el.style.transform = 'translateX(0)';
        swipeEl.current.delete(id);
        swipeOffset.current.delete(id);
        onDeleted();
    }

    function subtitle(item: Item): string {
        const p = item.payload;
        switch (item.category) {
            case 'login':    return p.username || p.url || '';
            case 'card':     return p.cardholder || (p.card_number ? `•••• ${p.card_number.slice(-4)}` : '');
            case 'note':     return p.notes?.slice(0, 60) || '';
            case 'identity': return [p.first_name, p.last_name].filter(Boolean).join(' ');
            default:         return '';
        }
    }

    return (
        <div className="flex flex-col h-full" style={{ backgroundColor: 'var(--vault-bg)' }}>
            {/* Header */}
            <div
                className="flex items-center justify-between px-4 shrink-0 border-b"
                style={{ height: 52, backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
            >
                <span className="text-[17px] font-semibold" style={{ color: 'var(--text)' }}>SD-Vault</span>
                <button
                    onClick={onLock}
                    style={{ width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)' }}
                >
                    <LockIcon />
                </button>
            </div>

            {/* Search bar */}
            <div className="px-4 pt-3 pb-1 shrink-0">
                <div className="relative">
                    <input
                        type="text"
                        value={search}
                        onChange={e => onSearchChange(e.target.value)}
                        placeholder="Suchen…"
                        className="w-full text-sm"
                        style={{
                            height: 40, paddingLeft: 16, paddingRight: search ? 36 : 16,
                            backgroundColor: 'var(--surface-2)', border: '1px solid var(--border)',
                            borderRadius: 12, color: 'var(--text)', outline: 'none',
                        }}
                    />
                    {search && (
                        <button
                            onClick={() => onSearchChange('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full"
                            style={{ color: 'var(--text-3)', backgroundColor: 'var(--surface-3)' }}
                        >
                            <svg viewBox="0 0 12 12" width="10" height="10" fill="currentColor">
                                <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
                            </svg>
                        </button>
                    )}
                </div>
            </div>

            {/* Category chips */}
            <div className="shrink-0 overflow-x-auto" style={{ padding: '8px 12px', scrollbarWidth: 'none' }}>
                <div className="flex gap-2" style={{ width: 'max-content' }}>
                    {CATEGORY_CHIPS.map(({ key, label }) => {
                        const active = activeCategory === key && !activeTag;
                        return (
                            <button
                                key={key}
                                onClick={() => { onCategoryChange(key); onTagChange(null); }}
                                className="text-sm font-medium whitespace-nowrap"
                                style={{
                                    padding: '6px 12px', borderRadius: 8,
                                    backgroundColor: active ? 'var(--accent)' : 'transparent',
                                    border: active ? 'none' : '1px solid var(--border)',
                                    color: active ? 'white' : 'var(--text-2)',
                                    transition: 'background-color 150ms',
                                }}
                            >
                                {label}
                            </button>
                        );
                    })}
                    {allTags.map(tag => {
                        const active = activeTag === tag;
                        return (
                            <button
                                key={tag}
                                onClick={() => { onTagChange(active ? null : tag); }}
                                className="text-sm font-medium whitespace-nowrap"
                                style={{
                                    padding: '6px 12px', borderRadius: 8,
                                    backgroundColor: active ? 'var(--accent)' : 'transparent',
                                    border: active ? 'none' : '1px solid var(--border)',
                                    color: active ? 'white' : 'var(--text-2)',
                                    transition: 'background-color 150ms',
                                }}
                            >
                                #{tag}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Entry list */}
            <div className="flex-1 overflow-y-auto" style={{ paddingBottom: 76 }}>
                {items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3" style={{ paddingTop: 80 }}>
                        <div className="flex items-center justify-center rounded-full" style={{ width: 56, height: 56, backgroundColor: 'var(--surface-2)' }}>
                            <LockIcon />
                        </div>
                        <p className="text-sm" style={{ color: 'var(--text-2)' }}>Noch keine Einträge</p>
                        <button
                            onClick={() => setSheetOpen(true)}
                            className="text-sm font-medium"
                            style={{ color: 'var(--accent)' }}
                        >
                            Ersten Eintrag anlegen →
                        </button>
                    </div>
                ) : (
                    items.map(item => {
                        const color = CATEGORY_COLORS[item.category] ?? '#8e8e93';
                        return (
                            <div key={item.id} className="relative overflow-hidden">
                                {/* Delete button behind the row */}
                                <div
                                    className="absolute right-0 top-0 bottom-0 flex items-center justify-center"
                                    style={{ width: 80, backgroundColor: 'var(--danger)' }}
                                    onClick={() => handleDelete(item.id)}
                                >
                                    <span className="text-xs font-medium text-white">Löschen</span>
                                </div>

                                {/* Row */}
                                <div
                                    ref={el => { if (el) swipeEl.current.set(item.id, el); }}
                                    className="flex items-center gap-3 relative"
                                    style={{
                                        minHeight: 64, padding: '12px 16px',
                                        backgroundColor: 'var(--vault-bg)',
                                        borderBottom: '1px solid var(--border)',
                                        transition: 'transform 0.05s',
                                    }}
                                    onClick={() => onSelect(item.id)}
                                    onTouchStart={e => handleSwipeStart(item.id, e.touches[0].clientX)}
                                    onTouchMove={e => handleSwipeMove(item.id, e.touches[0].clientX)}
                                    onTouchEnd={() => handleSwipeEnd(item.id)}
                                >
                                    <CategoryIcon category={item.category} size={40} />

                                    {/* Text */}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[15px] font-semibold truncate" style={{ color: 'var(--text)' }}>
                                            {item.payload.title || '—'}
                                        </p>
                                        <p className="text-[13px] truncate" style={{ color: 'var(--text-3)' }}>
                                            {subtitle(item)}
                                        </p>
                                    </div>

                                    {/* Favorite / Chevron */}
                                    {item.is_favorite ? (
                                        <svg viewBox="0 0 16 16" width="16" height="16" fill="#ffd60a">
                                            <path d="M8 1.5l1.8 3.7 4.1.6-3 2.9.7 4.1L8 10.9l-3.6 1.9.7-4.1-3-2.9 4.1-.6L8 1.5z" />
                                        </svg>
                                    ) : (
                                        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--text-3)' }}>
                                            <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* FAB */}
            <button
                onClick={() => setSheetOpen(true)}
                className="fixed flex items-center justify-center"
                style={{
                    bottom: 76, right: 20, width: 56, height: 56,
                    borderRadius: '50%', backgroundColor: 'var(--accent)',
                    color: 'white', fontSize: 24, fontWeight: 300,
                    boxShadow: '0 4px 16px rgba(0,0,0,0.4)', zIndex: 40,
                }}
            >
                +
            </button>

            {/* Category Sheet */}
            {sheetOpen && (
                <MobileCategorySheet
                    onSelect={cat => { setSheetOpen(false); onAdd(cat); }}
                    onClose={() => setSheetOpen(false)}
                />
            )}
        </div>
    );
}

function MobileCategorySheet({ onSelect, onClose }: { onSelect: (cat: Category) => void; onClose: () => void }) {
    const CATS: { cat: Category; label: string }[] = [
        { cat: 'login',    label: 'Login' },
        { cat: 'card',     label: 'Karte' },
        { cat: 'note',     label: 'Notiz' },
        { cat: 'identity', label: 'Identität' },
    ];
    return (
        <>
            <div className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
            <div
                className="fixed left-0 right-0 bottom-0 z-50 rounded-t-2xl sheet-active"
                style={{ backgroundColor: 'var(--surface)', paddingBottom: 'env(safe-area-inset-bottom)' }}
            >
                <div className="flex justify-center pt-3 pb-2">
                    <div style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: 'var(--border)' }} />
                </div>
                <p className="text-[15px] font-semibold px-5 pb-4" style={{ color: 'var(--text)' }}>
                    Neuen Eintrag erstellen
                </p>
                <div className="grid grid-cols-2 gap-2 px-4 pb-6">
                    {CATS.map(({ cat, label }) => (
                        <button
                            key={cat}
                            onClick={() => onSelect(cat)}
                            className="flex items-center justify-center gap-2 rounded-xl"
                            style={{ height: 60, backgroundColor: 'var(--surface-2)', color: CATEGORY_COLORS[cat] }}
                        >
                            <CategoryIcon category={cat} size={24} />
                            <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>{label}</span>
                        </button>
                    ))}
                </div>
            </div>
        </>
    );
}

function LockIcon() {
    return (
        <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="4" y="9" width="12" height="9" rx="2" />
            <path d="M7 9V7a3 3 0 016 0v2" strokeLinecap="round" />
        </svg>
    );
}
