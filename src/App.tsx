import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LockScreen } from "./components/LockScreen";
import { Sidebar } from "./components/Sidebar";
import { EntryList } from "./components/EntryList";
import { EntryDetail } from "./components/EntryDetail";
import { Settings } from "./components/Settings";
import { SyncStatus } from "./components/SyncStatus";
import { PasswordGenerator } from "./components/PasswordGenerator";
import type { PasswordItem, FilterCategory } from "./types";
import "./App.css";

const AUTO_LOCK_MS = 5 * 60 * 1000;

export default function App() {
    const [vaultExists, setVaultExists] = useState<boolean | null>(null);
    const [isUnlocked, setIsUnlocked] = useState(false);
    const [items, setItems] = useState<PasswordItem[]>([]);
    const [selectedCategory, setSelectedCategory] = useState<FilterCategory>('all');
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedItem, setSelectedItem] = useState<PasswordItem | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [showSync, setShowSync] = useState(false);
    const [showGenerator, setShowGenerator] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => { initApp(); }, []);

    useEffect(() => {
        if (!isUnlocked) return;
        const reset = () => {
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(lockVault, AUTO_LOCK_MS);
        };
        const events = ['mousemove', 'keydown', 'mousedown', 'touchstart'];
        events.forEach(ev => document.addEventListener(ev, reset));
        reset();
        return () => {
            events.forEach(ev => document.removeEventListener(ev, reset));
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [isUnlocked]);

    async function initApp() {
        try {
            const exists = await invoke<boolean>("check_vault_exists");
            setVaultExists(exists);
            const unlocked = await invoke<boolean>("is_unlocked");
            setIsUnlocked(unlocked);
            if (unlocked) await loadItems();
        } catch (e) { console.error(e); }
    }

    async function loadItems() {
        setItems(await invoke<PasswordItem[]>("get_items"));
    }

    async function lockVault() {
        await invoke("lock_vault");
        setIsUnlocked(false);
        setItems([]);
        setSelectedItem(null);
        setIsCreating(false);
        if (timerRef.current) clearTimeout(timerRef.current);
    }

    async function handleSelectItem(item: PasswordItem) {
        setIsCreating(false);
        const latest = await invoke<PasswordItem[]>("get_items");
        setItems(latest);
        setSelectedItem(latest.find(i => i.id === item.id) ?? item);
    }

    async function handleSaved(savedId: string) {
        const latest = await invoke<PasswordItem[]>("get_items");
        setItems(latest);
        setIsCreating(false);
        setSelectedItem(latest.find(i => i.id === savedId) ?? null);
    }

    if (vaultExists === null) return null;

    if (!isUnlocked) {
        return (
            <LockScreen
                vaultExists={vaultExists}
                onUnlocked={async () => {
                    setIsUnlocked(true);
                    setVaultExists(true);
                    await loadItems();
                }}
            />
        );
    }

    return (
        <div className="app-layout">
            <Sidebar
                selectedCategory={selectedCategory}
                onCategoryChange={setSelectedCategory}
                onSettings={() => setShowSettings(true)}
                onLock={lockVault}
                onSync={() => setShowSync(true)}
                onGenerator={() => setShowGenerator(true)}
            />
            <EntryList
                items={items}
                selectedId={selectedItem?.id ?? null}
                selectedCategory={selectedCategory}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onSelectItem={handleSelectItem}
                onNewItem={() => { setSelectedItem(null); setIsCreating(true); }}
            />
            <EntryDetail
                item={selectedItem}
                isCreating={isCreating}
                onSaved={handleSaved}
                onDeleted={() => { setSelectedItem(null); loadItems(); }}
                onCancelCreate={() => setIsCreating(false)}
                onFavoriteToggled={loadItems}
            />
            {showSettings && <Settings onClose={() => setShowSettings(false)} />}
            {showSync && <SyncStatus onClose={() => setShowSync(false)} />}
            {showGenerator && <PasswordGenerator onClose={() => setShowGenerator(false)} />}
        </div>
    );
}
