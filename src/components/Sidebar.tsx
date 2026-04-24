import logoUrl from '../assets/logo.svg';
import type { Category } from '../types';

export const APP_VERSION = '1.0.0';
export type ViewCategory = Category | 'all' | 'health';

interface Props {
    activeCategory: ViewCategory;
    onCategoryChange: (cat: ViewCategory) => void;
    search: string;
    onSearchChange: (s: string) => void;
    onLock: () => void;
    onSettings: () => void;
    hasUpdate?: boolean;
}

const CATEGORIES: { key: ViewCategory; label: string; icon: JSX.Element }[] = [
    { key: 'all',      label: 'Alle Einträge', icon: <AllIcon /> },
    { key: 'login',    label: 'Logins',        icon: <KeyIcon /> },
    { key: 'card',     label: 'Karten',        icon: <CardIcon /> },
    { key: 'note',     label: 'Notizen',       icon: <NoteIcon /> },
    { key: 'identity', label: 'Identitäten',   icon: <UserIcon /> },
    { key: 'health',   label: 'Passwort-Check', icon: <HealthIcon /> },
];

export default function Sidebar({ activeCategory, onCategoryChange, search, onSearchChange, onLock, onSettings, hasUpdate }: Props) {
    return (
        <aside className="flex flex-col h-full w-56 border-r shrink-0" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
            {/* Logo + version */}
            <div className="px-4 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2.5">
                    <img src={logoUrl} alt="SD-Vault" className="w-7 h-7 shrink-0" />
                    <div>
                        <span className="text-sm font-bold text-white tracking-wide">SD-Vault</span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-xs" style={{ color: 'var(--vault-muted)' }}>v{APP_VERSION}</span>
                            {hasUpdate && (
                                <span className="px-1.5 py-px rounded text-xs font-medium" style={{ backgroundColor: '#3b82f6', color: 'white' }}>
                                    Update
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Search */}
            <div className="p-3">
                <input
                    type="text"
                    value={search}
                    onChange={e => onSearchChange(e.target.value)}
                    placeholder="Suchen..."
                    className="w-full px-3 py-1.5 text-sm rounded-lg border text-white focus:outline-none"
                    style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--border)' }}
                />
            </div>

            {/* Navigation */}
            <nav className="flex-1 px-2 space-y-0.5">
                {CATEGORIES.map(({ key, label, icon }) => (
                    <button
                        key={key}
                        onClick={() => onCategoryChange(key)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-colors"
                        style={{
                            backgroundColor: activeCategory === key ? 'rgba(10,132,255,0.15)' : 'transparent',
                            color: activeCategory === key ? 'white' : 'var(--text-2)',
                        }}
                    >
                        <span className="w-4 h-4 shrink-0" style={{ color: activeCategory === key ? 'var(--accent)' : undefined }}>
                            {icon}
                        </span>
                        <span>{label}</span>
                    </button>
                ))}
            </nav>

            {/* Bottom actions */}
            <div className="p-3 border-t space-y-1.5" style={{ borderColor: 'var(--border)' }}>
                <button
                    onClick={onSettings}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors"
                    style={{ color: 'var(--vault-muted)' }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                    <SettingsIcon />
                    <span>Einstellungen</span>
                    {hasUpdate && <span className="ml-auto w-2 h-2 rounded-full" style={{ backgroundColor: '#3b82f6' }} />}
                </button>
                <button
                    onClick={onLock}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors"
                    style={{ color: 'var(--vault-muted)' }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                    <LockIcon />
                    <span>Sperren</span>
                </button>
            </div>
        </aside>
    );
}

function AllIcon() {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="1" y="1" width="6" height="6" rx="1" /><rect x="9" y="1" width="6" height="6" rx="1" />
            <rect x="1" y="9" width="6" height="6" rx="1" /><rect x="9" y="9" width="6" height="6" rx="1" />
        </svg>
    );
}
function KeyIcon() {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="6" cy="8" r="4" />
            <path d="M10 8h5M13 6v4" strokeLinecap="round" />
        </svg>
    );
}
function CardIcon() {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="1" y="3" width="14" height="10" rx="1.5" />
            <path d="M1 6h14" strokeLinecap="round" />
        </svg>
    );
}
function NoteIcon() {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="1" width="12" height="14" rx="1.5" />
            <path d="M5 5h6M5 8h6M5 11h4" strokeLinecap="round" />
        </svg>
    );
}
function UserIcon() {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="5" r="3" />
            <path d="M2 14c0-3.314 2.686-5 6-5s6 1.686 6 5" strokeLinecap="round" />
        </svg>
    );
}
function HealthIcon() {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 14s-6-3.8-6-8a4 4 0 018 0 4 4 0 018 0c0 4.2-6 8-6 8z" strokeLinejoin="round" />
        </svg>
    );
}
function SettingsIcon() {
    return (
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="8" r="2" />
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" strokeLinecap="round" />
        </svg>
    );
}
function LockIcon() {
    return (
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="7" width="10" height="8" rx="1.5" />
            <path d="M5 7V5a3 3 0 016 0v2" strokeLinecap="round" />
        </svg>
    );
}
