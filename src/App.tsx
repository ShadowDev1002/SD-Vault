import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import LockScreen from './components/LockScreen';
import FirstRunSetup from './components/FirstRunSetup';
import VaultView from './components/VaultView';
import Settings from './components/Settings';
import type { VaultMeta } from './types';
import './App.css';

type AppState = 'loading' | 'first-run' | 'locked' | 'unlocked';

export default function App() {
    const [appState, setAppState] = useState<AppState>('loading');
    const [meta, setMeta] = useState<VaultMeta | null>(null);
    const [showSettings, setShowSettings] = useState(false);

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

    return (
        <>
            {appState === 'first-run' && <FirstRunSetup onCreated={handleUnlocked} />}
            {appState === 'locked' && <LockScreen onUnlocked={handleUnlocked} />}
            {appState === 'unlocked' && meta && (
                <VaultView
                    meta={meta}
                    onLocked={handleLocked}
                    onSettings={() => setShowSettings(true)}
                />
            )}
            {showSettings && (
                <Settings
                    isUnlocked={appState === 'unlocked'}
                    onClose={() => setShowSettings(false)}
                />
            )}
        </>
    );
}
