import type { ViewCategory } from './Sidebar';

interface Props {
    activeCategory: ViewCategory;
    onCategoryChange: (cat: ViewCategory) => void;
    onSettings: () => void;
    hasUpdate?: boolean;
}

const NAV_ITEMS: { key: ViewCategory | 'settings'; label: string; icon: JSX.Element }[] = [
    { key: 'all',       label: 'Vault',        icon: <VaultIcon /> },
    { key: 'favorites', label: 'Favoriten',    icon: <StarIcon /> },
    { key: 'health',    label: 'Health',       icon: <HealthIcon /> },
    { key: 'settings',  label: 'Einstellungen', icon: <SettingsIcon /> },
];

export default function BottomNav({ activeCategory, onCategoryChange, onSettings, hasUpdate }: Props) {
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
                const isSettings = key === 'settings';
                const active = !isSettings && activeCategory === key;
                return (
                    <button
                        key={key}
                        onClick={() => isSettings ? onSettings() : onCategoryChange(key as ViewCategory)}
                        className="flex-1 flex flex-col items-center justify-center gap-0.5 h-full relative"
                        style={{ color: active ? 'var(--accent)' : 'var(--text-3)' }}
                    >
                        <span className="w-5 h-5">{icon}</span>
                        <span className="text-[10px] font-medium">{label}</span>
                        {isSettings && hasUpdate && (
                            <span className="absolute top-2 right-[22%] w-2 h-2 rounded-full" style={{ backgroundColor: '#3b82f6' }} />
                        )}
                    </button>
                );
            })}
        </nav>
    );
}

function VaultIcon() {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="1" y="1" width="6" height="6" rx="1" /><rect x="9" y="1" width="6" height="6" rx="1" />
            <rect x="1" y="9" width="6" height="6" rx="1" /><rect x="9" y="9" width="6" height="6" rx="1" />
        </svg>
    );
}
function StarIcon() {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 1.5l1.8 3.7 4.1.6-3 2.9.7 4.1L8 10.9l-3.6 1.9.7-4.1-3-2.9 4.1-.6L8 1.5z" strokeLinejoin="round" />
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
