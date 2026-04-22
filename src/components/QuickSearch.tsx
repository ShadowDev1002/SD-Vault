import { useState, useEffect, useRef } from 'react';
import type { Item } from '../types';

const CATEGORY_COLOR: Record<string, string> = {
    login: '#0a84ff', card: '#32d74b', note: '#ff9f0a', identity: '#bf5af2',
};
const CATEGORY_LABEL: Record<string, string> = {
    login: 'Login', card: 'Karte', note: 'Notiz', identity: 'Identität',
};

interface Props {
    items: Item[];
    onSelect: (id: string) => void;
    onClose: () => void;
}

export default function QuickSearch({ items, onSelect, onClose }: Props) {
    const [query, setQuery] = useState('');
    const [cursor, setCursor] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { inputRef.current?.focus(); }, []);

    const results = query.trim()
        ? items.filter(item => {
            const q = query.toLowerCase();
            return (
                item.payload.title.toLowerCase().includes(q) ||
                item.payload.username.toLowerCase().includes(q) ||
                item.payload.url.toLowerCase().includes(q) ||
                item.payload.email.toLowerCase().includes(q)
            );
        }).slice(0, 12)
        : [];

    useEffect(() => { setCursor(0); }, [query]);

    function handleKey(e: React.KeyboardEvent) {
        if (e.key === 'Escape') { onClose(); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, results.length - 1)); }
        if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
        if (e.key === 'Enter' && results[cursor]) { onSelect(results[cursor].id); onClose(); }
    }

    function subtitle(item: Item): string {
        if (item.payload.url) {
            try { return new URL(item.payload.url.startsWith('http') ? item.payload.url : 'https://' + item.payload.url).hostname; }
            catch { return item.payload.url; }
        }
        if (item.payload.username) return item.payload.username;
        if (item.payload.email) return item.payload.email;
        return '';
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-start justify-center pt-24"
            style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                className="w-full max-w-xl rounded-2xl overflow-hidden shadow-2xl anim-scale-in"
                style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
            >
                <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ color: 'var(--text-3)' }}>
                        <circle cx="6.5" cy="6.5" r="4.5"/><path d="M10.5 10.5l3.5 3.5" strokeLinecap="round"/>
                    </svg>
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={handleKey}
                        placeholder="Suche in allen Einträgen…"
                        className="flex-1 bg-transparent text-sm outline-none"
                        style={{ color: 'var(--text)' }}
                    />
                    <kbd className="text-xs px-1.5 py-0.5 rounded border font-mono" style={{ borderColor: 'var(--border)', color: 'var(--text-3)' }}>Esc</kbd>
                </div>

                <div className="max-h-80 overflow-y-auto">
                    {results.length === 0 && query.trim() && (
                        <p className="text-sm text-center py-8" style={{ color: 'var(--text-3)' }}>Keine Ergebnisse für „{query}"</p>
                    )}
                    {results.length === 0 && !query.trim() && (
                        <p className="text-sm text-center py-8" style={{ color: 'var(--text-3)' }}>Suchbegriff eingeben…</p>
                    )}
                    {results.map((item, i) => (
                        <button
                            key={item.id}
                            onClick={() => { onSelect(item.id); onClose(); }}
                            className="w-full flex items-center gap-3 px-4 py-3 text-left border-b last:border-b-0 transition-colors"
                            style={{ borderColor: 'var(--border-2)', backgroundColor: i === cursor ? 'rgba(10,132,255,0.12)' : 'transparent' }}
                            onMouseEnter={() => setCursor(i)}
                        >
                            <div
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0"
                                style={{ backgroundColor: CATEGORY_COLOR[item.category] + '22', color: CATEGORY_COLOR[item.category] }}
                            >
                                {item.payload.title.charAt(0).toUpperCase() || '?'}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>{item.payload.title}</p>
                                <p className="text-xs truncate" style={{ color: 'var(--text-3)' }}>{subtitle(item)}</p>
                            </div>
                            <span className="text-xs px-2 py-0.5 rounded-full shrink-0"
                                style={{ backgroundColor: CATEGORY_COLOR[item.category] + '22', color: CATEGORY_COLOR[item.category] }}>
                                {CATEGORY_LABEL[item.category]}
                            </span>
                        </button>
                    ))}
                </div>

                {results.length > 0 && (
                    <div className="px-4 py-2 border-t flex items-center gap-4 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--text-3)' }}>
                        <span>↑↓ navigieren</span><span>↵ auswählen</span><span>Esc schließen</span>
                    </div>
                )}
            </div>
        </div>
    );
}
