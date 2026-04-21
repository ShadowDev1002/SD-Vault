import { Plus, Search, Star } from "lucide-react";
import type { PasswordItem, FilterCategory } from "../types";
import { getAvatarColor, CATEGORIES } from "../types";

interface EntryListProps {
    items: PasswordItem[];
    selectedId: string | null;
    selectedCategory: FilterCategory;
    searchQuery: string;
    onSearchChange: (q: string) => void;
    onSelectItem: (item: PasswordItem) => void;
    onNewItem: () => void;
}

export function EntryList({ items, selectedId, selectedCategory, searchQuery, onSearchChange, onSelectItem, onNewItem }: EntryListProps) {
    const filtered = items.filter(item => {
        const s = searchQuery.toLowerCase();
        const matchesSearch = item.title.toLowerCase().includes(s) || item.username.toLowerCase().includes(s);
        if (!matchesSearch) return false;
        if (selectedCategory === 'all') return true;
        if (selectedCategory === 'favorites') return item.is_favorite;
        return item.category === selectedCategory;
    });

    return (
        <div className="item-list-pane">
            <div className="list-toolbar">
                <div className="search-box">
                    <Search size={14} color="var(--text-secondary)" />
                    <input placeholder="Suchen" value={searchQuery} onChange={e => onSearchChange(e.target.value)} />
                </div>
                <button className="icon-btn" onClick={onNewItem} style={{ background: 'var(--accent-blue)', color: 'white' }}>
                    <Plus size={16} />
                </button>
            </div>
            <div className="items-scroll">
                {filtered.map(item => (
                    <div key={item.id} className={`list-item ${selectedId === item.id ? 'selected' : ''}`} onClick={() => onSelectItem(item)}>
                        <div className="item-avatar" style={{ backgroundColor: getAvatarColor(item.title) }}>
                            {item.title.charAt(0).toUpperCase()}
                        </div>
                        <div className="list-item-details">
                            <div className="list-item-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                {item.title}
                                {item.is_favorite && (
                                    <Star size={11} fill="#FFCC00" color="#FFCC00" />
                                )}
                            </div>
                            <div className="list-item-subtitle">
                                {item.username || CATEGORIES.find(c => c.id === item.category)?.label}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
