import type { ViewCategory } from './Sidebar';

interface Props {
    activeCategory: ViewCategory;
    onCategoryChange: (cat: ViewCategory) => void;
    onSettings: () => void;
    onLock: () => void;
    hasUpdate?: boolean;
}

const NAV_ITEMS: { key: ViewCategory; label: string; icon: JSX.Element }[] = [
    { key: 'all',      label: 'Alle',     icon: <AllIcon /> },
    { key: 'login',    label: 'Logins',   icon: <KeyIcon /> },
    { key: 'card',     label: 'Karten',   icon: <CardIcon /> },
    { key: 'note',     label: 'Notizen',  icon: <NoteIcon /> },
    { key: 'health',   label: 'Check',    icon: <HealthIcon /> },
];

export default function BottomNav({ activeCategory, onCategoryChange, onSettings, onLock, hasUpdate }: Props) {
    return (
        <nav
            className="fixed bottom-0 left-0 right-0 flex items-center border-t z-50"
            style={{
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border)',
                paddingBottom: 'env(safe-area-inset-bottom)',
                height: 'calc(56px + env(safe-area-inset-bottom))',
            }}
        >
            {NAV_ITEMS.map(({ key, label, icon }) => {
                const active = activeCategory === key;
                return (
                    <button
                        key={key}
                        onClick={() => onCategoryChange(key)}
                        className="flex-1 flex flex-col items-center justify-center gap-0.5 h-full"
                        style={{ color: active ? 'var(--accent)' : 'var(--text-3)' }}
                    >
                        <span className="w-5 h-5">{icon}</span>
                        <span className="text-[10px] font-medium">{label}</span>
                    </button>
                );
            })}

            <button
                onClick={onSettings}
                className="flex-1 flex flex-col items-center justify-center gap-0.5 h-full relative"
                style={{ color: 'var(--text-3)' }}
            >
                <span className="w-5 h-5"><SettingsIcon /></span>
                <span className="text-[10px] font-medium">Einst.</span>
                {hasUpdate && (
                    <span className="absolute top-2 right-[20%] w-2 h-2 rounded-full" style={{ backgroundColor: '#3b82f6' }} />
                )}
            </button>

            <button
                onClick={onLock}
                className="flex-1 flex flex-col items-center justify-center gap-0.5 h-full"
                style={{ color: 'var(--text-3)' }}
            >
                <span className="w-5 h-5"><LockIcon /></span>
                <span className="text-[10px] font-medium">Sperren</span>
            </button>
        </nav>
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
function HealthIcon() {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 14s-6-3.8-6-8a4 4 0 018 0 4 4 0 018 0c0 4.2-6 8-6 8z" strokeLinejoin="round" />
        </svg>
    );
}
function SettingsIcon() {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="8" r="2" />
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" strokeLinecap="round" />
        </svg>
    );
}
function LockIcon() {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="7" width="10" height="8" rx="1.5" />
            <path d="M5 7V5a3 3 0 016 0v2" strokeLinecap="round" />
        </svg>
    );
}
