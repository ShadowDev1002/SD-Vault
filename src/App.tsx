import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import LockScreen from './components/LockScreen';
import FirstRunSetup from './components/FirstRunSetup';
import VaultView from './components/VaultView';
import type { VaultMeta } from './types';
import './App.css';

type AppState = 'loading' | 'first-run' | 'locked' | 'unlocked';

export default function App() {
    const [appState, setAppState] = useState<AppState>('loading');
    const [meta, setMeta] = useState<VaultMeta | null>(null);

    useEffect(() => { initApp(); }, []);

    async function initApp() {
        try {
            const exists = await invoke<boolean>('check_vault_exists');
            if (!exists) {
                setAppState('first-run');
                return;
            }
            const unlocked = await invoke<boolean>('is_unlocked');
            if (unlocked) {
                const m = await invoke<VaultMeta>('get_vault_meta');
                setMeta(m);
                setAppState('unlocked');
            } else {
                setAppState('locked');
            }
        } catch {
            setAppState('locked');
        }
    }

    function handleUnlocked(m: VaultMeta) {
        setMeta(m);
        setAppState('unlocked');
    }

    function handleLocked() {
        setMeta(null);
        setAppState('locked');
    }

    if (appState === 'loading') return null;

    if (appState === 'first-run') {
        return <FirstRunSetup onCreated={handleUnlocked} />;
    }

    if (appState === 'locked') {
        return <LockScreen onUnlocked={handleUnlocked} />;
    }

    return (
        <VaultView
            meta={meta!}
            onLocked={handleLocked}
            onSettings={() => {/* TODO: settings modal */}}
        />
    );
}
