import { useState, useEffect, useRef, useCallback } from 'react';
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
    const [lockTimeout, setLockTimeout] = useState(5);
    const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        invoke<boolean>('vault_exists').then(exists => {
            setAppState(exists ? 'locked' : 'first-run');
        });
    }, []);

    const handleLocked = useCallback(async () => {
        if (lockTimer.current) clearTimeout(lockTimer.current);
        await invoke('lock_vault');
        setMeta(null);
        setAppState('locked');
    }, []);

    const resetLockTimer = useCallback(() => {
        if (lockTimer.current) clearTimeout(lockTimer.current);
        lockTimer.current = setTimeout(() => handleLocked(), lockTimeout * 60 * 1000);
    }, [lockTimeout, handleLocked]);

    useEffect(() => {
        if (appState !== 'unlocked') return;
        const events = ['mousemove', 'keydown', 'mousedown', 'touchstart'];
        events.forEach(e => window.addEventListener(e, resetLockTimer, { passive: true }));
        resetLockTimer();
        return () => {
            events.forEach(e => window.removeEventListener(e, resetLockTimer));
            if (lockTimer.current) clearTimeout(lockTimer.current);
        };
    }, [appState, resetLockTimer]);

    function handleUnlocked(m: VaultMeta) {
        setMeta(m);
        setAppState('unlocked');
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
                    lockTimeout={lockTimeout}
                    onTimeoutChange={setLockTimeout}
                    onClose={() => setShowSettings(false)}
                />
            )}
        </>
    );
}
