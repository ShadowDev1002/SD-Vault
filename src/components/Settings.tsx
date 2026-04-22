import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import logoUrl from '../assets/logo.svg';
import SecuritySettings from './SecuritySettings';
import SyncSettings from './SyncSettings';
import { APP_VERSION } from './Sidebar';

// Set this to your GitHub repo slug: "username/repo-name"
const GITHUB_REPO = 'ShadowDev/sd-vault';

type Tab = 'security' | 'sync' | 'about';
type UpdateState = 'idle' | 'checking' | 'up-to-date' | 'available' | 'error';

interface Props {
    isUnlocked: boolean;
    lockTimeout: number;
    onTimeoutChange: (minutes: number) => void;
    onClose: () => void;
    onUpdateFound?: () => void;
}

const NAV: { id: Tab; label: string; icon: JSX.Element }[] = [
    { id: 'security', label: 'Sicherheit',    icon: <ShieldIcon /> },
    { id: 'sync',     label: 'Synchronisation', icon: <SyncIcon /> },
    { id: 'about',    label: 'Über die App',  icon: <InfoIcon /> },
];

export default function Settings({ isUnlocked, lockTimeout, onTimeoutChange, onClose, onUpdateFound }: Props) {
    const [tab, setTab] = useState<Tab>('security');
    const [updateState, setUpdateState] = useState<UpdateState>('idle');
    const [latestVersion, setLatestVersion] = useState('');
    const [releaseUrl, setReleaseUrl] = useState('');

    async function checkForUpdate() {
        setUpdateState('checking');
        try {
            const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
            if (!res.ok) throw new Error();
            const data = await res.json();
            const remote = (data.tag_name ?? '').replace(/^v/, '');
            setLatestVersion(remote);
            setReleaseUrl(data.html_url ?? `https://github.com/${GITHUB_REPO}/releases/latest`);
            if (remote && remote !== APP_VERSION) {
                setUpdateState('available');
                onUpdateFound?.();
            } else {
                setUpdateState('up-to-date');
            }
        } catch {
            setUpdateState('error');
        }
    }

    function openUrl(url: string) {
        invoke('open_url', { url }).catch(() => {});
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ backgroundColor: 'rgba(0,0,0,0.72)' }}
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                className="w-full max-w-2xl rounded-xl border overflow-hidden flex flex-col"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', maxHeight: '82vh' }}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
                    <h2 className="text-sm font-bold text-white tracking-wide">Einstellungen</h2>
                    <button
                        onClick={onClose}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-lg leading-none transition-colors"
                        style={{ color: 'var(--text-2)' }}
                        onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)')}
                        onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                        ×
                    </button>
                </div>

                <div className="flex flex-1 min-h-0">
                    {/* Left nav */}
                    <nav className="w-44 border-r shrink-0 p-2 space-y-0.5" style={{ borderColor: 'var(--border)' }}>
                        {NAV.map(({ id, label, icon }) => (
                            <button
                                key={id}
                                onClick={() => setTab(id)}
                                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-left transition-colors"
                                style={{
                                    backgroundColor: tab === id ? 'rgba(10,132,255,0.15)' : 'transparent',
                                    color: tab === id ? 'white' : 'var(--text-2)',
                                }}
                            >
                                <span className="w-4 h-4 shrink-0" style={{ color: tab === id ? 'var(--accent)' : undefined }}>
                                    {icon}
                                </span>
                                <span>{label}</span>
                            </button>
                        ))}
                    </nav>

                    {/* Content */}
                    <div className="flex-1 p-6 overflow-y-auto">
                        {tab === 'security' && (
                            <SecuritySettings lockTimeout={lockTimeout} onTimeoutChange={onTimeoutChange} />
                        )}
                        {tab === 'sync' && (
                            <SyncSettings isUnlocked={isUnlocked} />
                        )}
                        {tab === 'about' && (
                            <div className="space-y-6">
                                {/* App identity */}
                                <div className="flex items-center gap-4">
                                    <img src={logoUrl} alt="SD-Vault" className="w-14 h-14 shrink-0" />
                                    <div>
                                        <h3 className="text-base font-bold text-white">SD-Vault</h3>
                                        <p className="text-sm mt-0.5" style={{ color: 'var(--text-2)' }}>Version {APP_VERSION}</p>
                                        <p className="text-xs mt-1" style={{ color: 'var(--text-2)' }}>
                                            Lokaler Passwort-Manager mit Ende-zu-Ende-Verschlüsselung
                                        </p>
                                    </div>
                                </div>

                                <div className="border-t" style={{ borderColor: 'var(--border)' }} />

                                {/* Update check */}
                                <div className="space-y-3">
                                    <h4 className="text-sm font-semibold text-white">Software-Updates</h4>

                                    <button
                                        onClick={checkForUpdate}
                                        disabled={updateState === 'checking'}
                                        className="px-4 py-2 rounded-lg text-sm text-white disabled:opacity-60 transition-opacity"
                                        style={{ backgroundColor: 'var(--accent)' }}
                                    >
                                        {updateState === 'checking' ? 'Prüfe…' : 'Auf Updates prüfen'}
                                    </button>

                                    {updateState === 'up-to-date' && (
                                        <div className="flex items-center gap-2 text-sm" style={{ color: '#22c55e' }}>
                                            <CheckIcon />
                                            <span>SD-Vault ist auf dem neuesten Stand</span>
                                        </div>
                                    )}

                                    {updateState === 'available' && (
                                        <div className="rounded-lg p-4 border space-y-3" style={{ borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.07)' }}>
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-semibold text-white">Update verfügbar</span>
                                                <span className="px-2 py-0.5 rounded text-xs font-mono" style={{ backgroundColor: '#3b82f6', color: 'white' }}>
                                                    v{latestVersion}
                                                </span>
                                            </div>
                                            <p className="text-xs" style={{ color: 'var(--text-2)' }}>
                                                Eine neue Version ist auf GitHub verfügbar. Aktuelle Version: v{APP_VERSION}
                                            </p>
                                            <button
                                                onClick={() => openUrl(releaseUrl)}
                                                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm text-white"
                                                style={{ backgroundColor: '#3b82f6' }}
                                            >
                                                Jetzt herunterladen
                                                <ExternalLinkIcon />
                                            </button>
                                        </div>
                                    )}

                                    {updateState === 'error' && (
                                        <p className="text-sm" style={{ color: 'var(--vault-danger)' }}>
                                            Update-Prüfung fehlgeschlagen — Internetverbindung prüfen.
                                        </p>
                                    )}
                                </div>

                                <div className="border-t" style={{ borderColor: 'var(--border)' }} />

                                {/* Links */}
                                <div className="space-y-2">
                                    <h4 className="text-sm font-semibold text-white">Links</h4>
                                    <button
                                        onClick={() => openUrl(`https://github.com/${GITHUB_REPO}`)}
                                        className="flex items-center gap-1.5 text-sm transition-colors"
                                        style={{ color: 'var(--text-2)' }}
                                        onMouseEnter={e => (e.currentTarget.style.color = 'white')}
                                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-2)')}
                                    >
                                        <span>GitHub Repository</span>
                                        <ExternalLinkIcon />
                                    </button>
                                    <button
                                        onClick={() => openUrl(`https://github.com/${GITHUB_REPO}/releases`)}
                                        className="flex items-center gap-1.5 text-sm transition-colors"
                                        style={{ color: 'var(--text-2)' }}
                                        onMouseEnter={e => (e.currentTarget.style.color = 'white')}
                                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-2)')}
                                    >
                                        <span>Alle Releases</span>
                                        <ExternalLinkIcon />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function ShieldIcon() {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 1l6 2.5v4C14 11 11.5 14 8 15 4.5 14 2 11 2 7.5v-4L8 1z" strokeLinejoin="round" />
        </svg>
    );
}
function SyncIcon() {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M14 8A6 6 0 102 8" strokeLinecap="round" />
            <path d="M14 8l-2-2M14 8l-2 2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2 8l2-2M2 8l2 2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}
function InfoIcon() {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="8" r="7" />
            <path d="M8 7v5M8 5v.5" strokeLinecap="round" />
        </svg>
    );
}
function CheckIcon() {
    return (
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 8l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}
function ExternalLinkIcon() {
    return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M7 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1V9" strokeLinecap="round" />
            <path d="M10 2h4v4M14 2L8 8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}
