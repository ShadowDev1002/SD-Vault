import { useState, useEffect, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Item, VaultMeta, Category } from '../types';
import type { UpdateInfo } from '../App';
import type { ViewCategory } from './Sidebar';
import type { SortOption } from './EntryList';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';
import EntryList from './EntryList';
import EntryDetail from './EntryDetail';
import QuickSearch from './QuickSearch';
import HealthDashboard from './HealthDashboard';
import { measureStrength } from '../utils/strength';
import { useMobile } from '../utils/mobile';

interface Props {
    meta: VaultMeta;
    onLocked: () => void;
    onSettings: () => void;
    hasUpdate?: boolean;
    updateInfo?: UpdateInfo | null;
    onDismissUpdate?: () => void;
}

export default function VaultView({ meta: _meta, onLocked, onSettings, hasUpdate, updateInfo, onDismissUpdate }: Props) {
    const isMobile = useMobile();
    const [items, setItems] = useState<Item[]>([]);
    const [activeCategory, setActiveCategory] = useState<ViewCategory>('all');
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [isNew, setIsNew] = useState(false);
    const [mobilePanel, setMobilePanel] = useState<'list' | 'detail'>('list');
    const [showQuickSearch, setShowQuickSearch] = useState(false);
    const [sort, setSort] = useState<SortOption>(() =>
        (localStorage.getItem('sd-sort') as SortOption) ?? 'alpha-asc'
    );
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [activeTag, setActiveTag] = useState<string | null>(null);

    const loadItems = useCallback(async () => {
        try {
            const all = await invoke<Item[]>('get_items', { category: null });
            setItems(all);
        } catch { /* ignore */ }
    }, []);

    useEffect(() => { loadItems(); }, [loadItems]);

    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setShowQuickSearch(s => !s);
            }
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    async function handleLock() {
        await invoke('lock_vault');
        onLocked();
    }

    function handleSortChange(s: SortOption) {
        localStorage.setItem('sd-sort', s);
        setSort(s);
    }

    function handleToggleSelect(id: string) {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    async function handleBulkDelete() {
        if (!selectedIds.size || !confirm(`${selectedIds.size} Einträge wirklich löschen?`)) return;
        for (const id of selectedIds) {
            await invoke('delete_item', { id }).catch(() => {});
        }
        setSelectedIds(new Set());
        setSelectedId(null);
        loadItems();
    }

    async function handleBulkMove(cat: Category) {
        for (const id of selectedIds) {
            await invoke('move_item_category', { id, category: cat }).catch(() => {});
        }
        setSelectedIds(new Set());
        loadItems();
    }

    const allTags = useMemo(() => {
        const tagSet = new Set<string>();
        items.forEach(item => item.payload.tags?.forEach(t => tagSet.add(t)));
        return Array.from(tagSet).sort();
    }, [items]);

    const filtered = useMemo(() => items.filter(item => {
        if (activeCategory === 'favorites' && !item.is_favorite) return false;
        if (activeCategory !== 'all' && activeCategory !== 'health' && activeCategory !== 'favorites' && item.category !== activeCategory) return false;
        if (activeTag && !item.payload.tags?.includes(activeTag)) return false;
        if (!search) return true;
        const q = search.toLowerCase();
        return (
            item.payload.title.toLowerCase().includes(q) ||
            item.payload.username.toLowerCase().includes(q) ||
            item.payload.url.toLowerCase().includes(q)
        );
    }), [items, activeCategory, activeTag, search]);

    const sorted = useMemo(() => [...filtered].sort((a, b) => {
        switch (sort) {
            case 'alpha-asc':  return (a.payload.title || '').localeCompare(b.payload.title || '');
            case 'alpha-desc': return (b.payload.title || '').localeCompare(a.payload.title || '');
            case 'date-new':   return b.updated_at - a.updated_at;
            case 'date-old':   return a.updated_at - b.updated_at;
            case 'strength':   return measureStrength(b.payload.password).score - measureStrength(a.payload.password).score;
            default:           return 0;
        }
    }), [filtered, sort]);

    const selectedItem = items.find(i => i.id === selectedId) ?? null;

    function handleSaved() { setIsNew(false); loadItems(); if (isMobile) setMobilePanel('list'); }
    function handleDeleted() { setSelectedId(null); setIsNew(false); loadItems(); if (isMobile) setMobilePanel('list'); }

    function handleSelectEntry(id: string) {
        setSelectedId(id);
        setIsNew(false);
        if (isMobile) setMobilePanel('detail');
    }

    function handleAddEntry() {
        setSelectedId(null);
        setIsNew(true);
        if (isMobile) setMobilePanel('detail');
    }

    function handleBackToList() {
        setMobilePanel('list');
        setIsNew(false);
    }

    function handleCategoryChange(cat: ViewCategory) {
        setActiveCategory(cat);
        setActiveTag(null);
        setSelectedId(null);
        setIsNew(false);
        setSelectedIds(new Set());
        if (isMobile) setMobilePanel('list');
    }

    function handleTagChange(tag: string | null) {
        setActiveTag(tag);
        setSelectedId(null);
        setIsNew(false);
        setSelectedIds(new Set());
        if (isMobile) setMobilePanel('list');
    }

    const newCategory: Category = (activeCategory === 'all' || activeCategory === 'health' || activeCategory === 'favorites')
        ? 'login'
        : activeCategory;

    const updateBanner = updateInfo && (
        <div className="flex items-center justify-between px-4 py-2 shrink-0 text-sm"
            style={{ backgroundColor: '#1d4ed8', color: 'white' }}>
            <span>
                <strong>Update: v{updateInfo.version}</strong>
                {!isMobile && ' — Neue Version auf GitHub verfügbar.'}
            </span>
            <div className="flex items-center gap-3">
                <button
                    onClick={() => invoke('open_url', { url: updateInfo.url }).catch(() => {})}
                    className="px-3 py-1 rounded-md text-xs font-semibold"
                    style={{ backgroundColor: 'white', color: '#1d4ed8' }}
                >
                    Download
                </button>
                <button onClick={onDismissUpdate} className="opacity-70 text-base leading-none">×</button>
            </div>
        </div>
    );

    if (isMobile) {
        return (
            <div className="flex flex-col h-screen overflow-hidden" style={{ backgroundColor: 'var(--vault-bg)' }}>
                {updateBanner}

                {/* Mobile top bar */}
                <div className="flex items-center gap-2 px-4 py-2 shrink-0 border-b" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
                    {mobilePanel === 'detail' && (
                        <button
                            onClick={handleBackToList}
                            className="flex items-center gap-1 mr-1 py-1 pr-2"
                            style={{ color: 'var(--accent)' }}
                        >
                            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M10 3L5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            <span className="text-sm">Zurück</span>
                        </button>
                    )}
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Suchen..."
                        className="flex-1 px-3 py-2 text-sm rounded-xl border"
                        style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--text)', outline: 'none' }}
                    />
                </div>

                {/* Mobile panels */}
                <div className="flex-1 min-h-0 overflow-hidden" style={{ paddingBottom: '56px' }}>
                    {mobilePanel === 'list' && (
                        activeCategory === 'health' ? (
                            <HealthDashboard
                                items={items}
                                onSelect={id => { setSelectedId(id); setActiveCategory('all'); setMobilePanel('detail'); }}
                            />
                        ) : (
                            <EntryList
                                items={sorted}
                                selectedId={selectedId}
                                onSelect={handleSelectEntry}
                                onAdd={handleAddEntry}
                                sort={sort}
                                onSortChange={handleSortChange}
                                selectedIds={selectedIds}
                                onToggleSelect={handleToggleSelect}
                                onBulkDelete={handleBulkDelete}
                                onBulkMove={handleBulkMove}
                            />
                        )
                    )}
                    {mobilePanel === 'detail' && (
                        <EntryDetail
                            item={isNew ? null : selectedItem}
                            onSaved={handleSaved}
                            onDeleted={handleDeleted}
                            onCancel={handleBackToList}
                            isNew={isNew}
                            newCategory={newCategory}
                        />
                    )}
                </div>

                <BottomNav
                    activeCategory={activeCategory}
                    onCategoryChange={handleCategoryChange}
                    onSettings={onSettings}
                    onLock={handleLock}
                    hasUpdate={hasUpdate}
                />
            </div>
        );
    }

    return (
        <div className="flex flex-col h-screen overflow-hidden" style={{ backgroundColor: 'var(--vault-bg)' }}>
            {updateBanner}
            <div className="flex flex-1 min-h-0">
                <Sidebar
                    activeCategory={activeCategory}
                    onCategoryChange={handleCategoryChange}
                    activeTag={activeTag}
                    onTagChange={handleTagChange}
                    tags={allTags}
                    search={search}
                    onSearchChange={setSearch}
                    onLock={handleLock}
                    onSettings={onSettings}
                    hasUpdate={hasUpdate}
                />
                {activeCategory === 'health' ? (
                    <HealthDashboard
                        items={items}
                        onSelect={id => { setSelectedId(id); setActiveCategory('all'); }}
                    />
                ) : (
                    <>
                        <EntryList
                            items={sorted}
                            selectedId={selectedId}
                            onSelect={id => { setSelectedId(id); setIsNew(false); }}
                            onAdd={() => { setSelectedId(null); setIsNew(true); }}
                            sort={sort}
                            onSortChange={handleSortChange}
                            selectedIds={selectedIds}
                            onToggleSelect={handleToggleSelect}
                            onBulkDelete={handleBulkDelete}
                            onBulkMove={handleBulkMove}
                        />
                        <EntryDetail
                            item={isNew ? null : selectedItem}
                            onSaved={handleSaved}
                            onDeleted={handleDeleted}
                            onCancel={() => setIsNew(false)}
                            isNew={isNew}
                            newCategory={newCategory}
                        />
                    </>
                )}
                {showQuickSearch && (
                    <QuickSearch
                        items={items}
                        onSelect={id => { setSelectedId(id); setIsNew(false); }}
                        onClose={() => setShowQuickSearch(false)}
                    />
                )}
            </div>
        </div>
    );
}
