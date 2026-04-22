import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { VaultMeta } from '../types';
import logoUrl from '../assets/logo.svg';

interface Props {
    onUnlocked: (meta: VaultMeta) => void;
}

function Spinner() {
    return (
        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="3" strokeOpacity="0.3" />
            <path d="M4 12a8 8 0 018-8" stroke="white" strokeWidth="3" strokeLinecap="round" />
        </svg>
    );
}

export default function LockScreen({ onUnlocked }: Props) {
    const [mode, setMode] = useState<'unlock' | 'reset' | 'reset-done'>('unlock');

    const [masterPw, setMasterPw]         = useState('');
    const [unlockError, setUnlockError]   = useState('');
    const [unlockLoading, setUnlockLoading] = useState(false);

    const [secretKey, setSecretKey]     = useState('');
    const [newPw, setNewPw]             = useState('');
    const [confirmPw, setConfirmPw]     = useState('');
    const [resetError, setResetError]   = useState('');
    const [resetLoading, setResetLoading] = useState(false);

    async function handleUnlock(e: React.FormEvent) {
        e.preventDefault();
        setUnlockError('');
        setUnlockLoading(true);
        try {
            const meta = await invoke<VaultMeta>('unlock_vault', { masterPw });
            onUnlocked(meta);
        } catch (err) {
            setUnlockError(String(err));
        } finally {
            setUnlockLoading(false);
        }
    }

    async function handleReset(e: React.FormEvent) {
        e.preventDefault();
        setResetError('');
        if (newPw !== confirmPw) { setResetError('Passwörter stimmen nicht überein.'); return; }
        if (newPw.length < 8)    { setResetError('Mindestens 8 Zeichen erforderlich.'); return; }
        setResetLoading(true);
        try {
            await invoke('reset_master_password', { secretKeyFormatted: secretKey, newMasterPw: newPw });
            setMode('reset-done');
        } catch (err) {
            setResetError(String(err));
        } finally {
            setResetLoading(false);
        }
    }

    function goBack() {
        setMode('unlock');
        setSecretKey(''); setNewPw(''); setConfirmPw(''); setResetError('');
    }

    return (
        <div
            className="min-h-screen flex items-center justify-center px-4 anim-fade-in"
            style={{ background: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(10,132,255,0.07) 0%, var(--bg) 60%)' }}
        >
            <div className="glass-card anim-slide-up w-full max-w-sm overflow-hidden">
                <div className="card-top-line" />

                <div className="px-8 py-8">
                    {/* Logo */}
                    <div className="flex flex-col items-center mb-8">
                        <div
                            className="p-3 rounded-2xl mb-4"
                            style={{ background: 'rgba(10,132,255,0.1)', border: '1px solid rgba(10,132,255,0.2)' }}
                        >
                            <img src={logoUrl} alt="SD-Vault" className="w-12 h-12" draggable={false} />
                        </div>
                        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--text)' }}>SD-Vault</h1>
                        <p className="mt-1 text-xs uppercase tracking-widest" style={{ color: 'var(--text-3)', letterSpacing: '0.14em' }}>
                            {mode === 'unlock' ? 'Sicherer Zugang' : mode === 'reset' ? 'Passwort zurücksetzen' : 'Erfolgreich'}
                        </p>
                    </div>

                    {/* ── Unlock ── */}
                    {mode === 'unlock' && (
                        <form onSubmit={handleUnlock} className="space-y-4 anim-slide-down">
                            <input
                                type="password"
                                value={masterPw}
                                onChange={e => setMasterPw(e.target.value)}
                                className="sd-input"
                                placeholder="Master-Passwort"
                                required
                                autoFocus
                            />

                            {unlockError && <ErrorBox>{unlockError}</ErrorBox>}

                            <button type="submit" disabled={unlockLoading} className="sd-btn-primary">
                                {unlockLoading
                                    ? <span className="flex items-center justify-center gap-2"><Spinner />Entsperren…</span>
                                    : 'Vault entsperren'}
                            </button>

                            <button
                                type="button"
                                onClick={() => setMode('reset')}
                                className="w-full text-xs py-1.5 transition-colors"
                                style={{ color: 'var(--text-3)' }}
                                onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
                                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-3)')}
                            >
                                Passwort vergessen?
                            </button>
                        </form>
                    )}

                    {/* ── Reset ── */}
                    {mode === 'reset' && (
                        <form onSubmit={handleReset} className="space-y-3 anim-slide-down">
                            <div className="px-3 py-2.5 rounded-xl text-xs leading-relaxed" style={{ background: 'rgba(10,132,255,0.07)', border: '1px solid rgba(10,132,255,0.18)', color: 'rgba(10,132,255,0.9)' }}>
                                Secret Key aus dem Emergency Kit eingeben, um ein neues Passwort zu setzen.
                            </div>
                            <input
                                type="text"
                                value={secretKey}
                                onChange={e => setSecretKey(e.target.value.toUpperCase())}
                                className="sd-input font-mono text-xs"
                                placeholder="SDVLT-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"
                                required autoFocus
                            />
                            <input
                                type="password"
                                value={newPw}
                                onChange={e => setNewPw(e.target.value)}
                                className="sd-input"
                                placeholder="Neues Passwort"
                                required
                            />
                            <input
                                type="password"
                                value={confirmPw}
                                onChange={e => setConfirmPw(e.target.value)}
                                className="sd-input"
                                placeholder="Passwort wiederholen"
                                required
                            />

                            {resetError && <ErrorBox>{resetError}</ErrorBox>}

                            <button type="submit" disabled={resetLoading} className="sd-btn-primary">
                                {resetLoading
                                    ? <span className="flex items-center justify-center gap-2"><Spinner />Zurücksetzen…</span>
                                    : 'Passwort zurücksetzen'}
                            </button>
                            <button type="button" onClick={goBack} className="w-full text-xs py-1.5 transition-colors" style={{ color: 'var(--text-3)' }}
                                onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-2)')}
                                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-3)')}
                            >← Zurück</button>
                        </form>
                    )}

                    {/* ── Reset done ── */}
                    {mode === 'reset-done' && (
                        <div className="space-y-5 text-center anim-scale-in">
                            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto" style={{ background: 'rgba(50,215,75,0.1)', border: '1px solid rgba(50,215,75,0.25)', color: 'var(--success)' }}>
                                <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            </div>
                            <div>
                                <p className="font-semibold" style={{ color: 'var(--text)' }}>Passwort geändert</p>
                                <p className="text-xs mt-1" style={{ color: 'var(--text-2)' }}>Melde dich mit dem neuen Passwort an.</p>
                            </div>
                            <button onClick={goBack} className="sd-btn-primary">Zum Login</button>
                        </div>
                    )}

                    {mode === 'unlock' && (
                        <p className="mt-6 text-center text-xs" style={{ color: 'var(--text-3)' }}>
                            Ende-zu-Ende-verschlüsselt · AES-256-GCM
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
    return (
        <div className="px-3 py-2.5 rounded-xl text-xs" style={{ background: 'rgba(255,69,58,0.08)', border: '1px solid rgba(255,69,58,0.2)', color: '#ff6b63' }}>
            {children}
        </div>
    );
}
