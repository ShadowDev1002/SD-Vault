import { Shield, KeyRound, CreditCard, FileText, Code, StickyNote, Smartphone, Database, Star } from "lucide-react";
import type { FilterCategory } from "../types";

const NAV_ITEMS: { id: FilterCategory; label: string; Icon: React.ElementType }[] = [
    { id: 'all', label: 'Alle Objekte', Icon: Database },
    { id: 'favorites', label: 'Favoriten', Icon: Star },
    { id: 'login', label: 'Anmeldedaten', Icon: KeyRound },
    { id: 'finance', label: 'Kreditkarten', Icon: CreditCard },
    { id: 'document', label: 'Dokumente', Icon: FileText },
    { id: 'totp', label: 'Einmalpasswörter', Icon: Smartphone },
    { id: 'tech', label: 'Tech-Geheimnisse', Icon: Code },
    { id: 'note', label: 'Sichere Notizen', Icon: StickyNote },
];

interface SidebarProps {
    selectedCategory: FilterCategory;
    onCategoryChange: (cat: FilterCategory) => void;
    onSettings: () => void;
    onLock: () => void;
}

export function Sidebar({ selectedCategory, onCategoryChange, onSettings, onLock }: SidebarProps) {
    return (
        <div className="sidebar">
            <div className="sidebar-header">
                <Shield size={22} color="var(--accent-blue)" />
                <h2>SD-Passwort</h2>
            </div>

            <div className="sidebar-nav">
                <div className="sidebar-section-title">Tresor</div>
                {NAV_ITEMS.slice(0, 2).map(({ id, label, Icon }) => (
                    <div key={id} className={`nav-item ${selectedCategory === id ? 'active' : ''}`} onClick={() => onCategoryChange(id)}>
                        <Icon size={16} /> {label}
                    </div>
                ))}
                <div className="sidebar-section-title" style={{ marginTop: '16px' }}>Kategorien</div>
                {NAV_ITEMS.slice(2).map(({ id, label, Icon }) => (
                    <div key={id} className={`nav-item ${selectedCategory === id ? 'active' : ''}`} onClick={() => onCategoryChange(id)}>
                        <Icon size={16} /> {label}
                    </div>
                ))}
            </div>

            <div className="sidebar-footer" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button className="lock-btn" onClick={onSettings} style={{ background: 'transparent', color: 'var(--text-secondary)' }}>
                    Einstellungen
                </button>
                <button className="lock-btn" onClick={onLock}>Tresor sperren</button>
            </div>
        </div>
    );
}
