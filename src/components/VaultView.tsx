import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Item, VaultMeta, Category } from '../types';
import type { UpdateInfo } from '../App';
import Sidebar from './Sidebar';
import EntryList from './EntryList';
import EntryDetail from './EntryDetail';
import QuickSearch from './QuickSearch';

interface Props {
    meta: VaultMeta;
    onLocked: () => void;
    onSettings: () => void;
    hasUpdate?: boolean;
    updateInfo?: UpdateInfo | null;
    onDismissUpdate?: () => void;
}

export default function VaultView({ meta: _meta, onLocked, onSettings, hasUpdate, updateInfo, onDismissUpdate }: Props) {
    const [items, setItems] = useState<Item[]>([]);
    const [activeCategory, setActiveCategory] = useState<Category | 'all'>('all');
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [isNew, setIsNew] = useState(false);
    const [showQuickSearch, setShowQuickSearch] = useState(false);

    const loadItems = useCallback(async () => {
        try {
            const all = await invoke<Item[]>('get_items', { category: null });
            setItems(all);
        } catch {
            // ignore
        }
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

    const filtered = items.filter(item => {
        if (activeCategory !== 'all' && item.category !== activeCategory) return false;
        if (!search) return true;
        const q = search.toLowerCase();
        return (
            item.payload.title.toLowerCase().includes(q) ||
            item.payload.username.toLowerCase().includes(q) ||
            item.payload.url.toLowerCase().includes(q)
        );
    });

    const selectedItem = items.find(i => i.id === selectedId) ?? null;

    function handleSaved() {
        setIsNew(false);
        loadItems();
    }

    function handleDeleted() {
        setSelectedId(null);
        setIsNew(false);
        loadItems();
    }

    return (
        <div className="flex flex-col h-screen overflow-hidden" style={{ backgroundColor: 'var(--vault-bg)' }}>
            {/* Update-Banner */}
            {updateInfo && (
                <div className="flex items-center justify-between px-4 py-2 shrink-0 text-sm"
                    style={{ backgroundColor: '#1d4ed8', color: 'white' }}>
                    <span>
                        <strong>Update verfügbar: v{updateInfo.version}</strong>
                        {' '}— Neue Version auf GitHub verfügbar.
                    </span>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => invoke('open_url', { url: updateInfo.url }).catch(() => {})}
                            className="px-3 py-1 rounded-md text-xs font-semibold"
                            style={{ backgroundColor: 'white', color: '#1d4ed8' }}
                        >
                            Herunterladen
                        </button>
                        <button
                            onClick={onDismissUpdate}
                            className="opacity-70 hover:opacity-100 text-base leading-none"
                        >
                            ×
                        </button>
                    </div>
                </div>
            )}
            <div className="flex flex-1 min-h-0">
            <Sidebar
                activeCategory={activeCategory}
                onCategoryChange={cat => { setActiveCategory(cat); setSelectedId(null); setIsNew(false); }}
                search={search}
                onSearchChange={setSearch}
                onLock={handleLock}
                onSettings={onSettings}
                hasUpdate={hasUpdate}
            />
            <EntryList
                items={filtered}
                selectedId={selectedId}
                onSelect={id => { setSelectedId(id); setIsNew(false); }}
                onAdd={() => { setSelectedId(null); setIsNew(true); }}
            />
            <EntryDetail
                item={isNew ? null : selectedItem}
                onSaved={handleSaved}
                onDeleted={handleDeleted}
                onCancel={() => setIsNew(false)}
                isNew={isNew}
                newCategory={activeCategory === 'all' ? 'login' : activeCategory}
            />
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
