import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Item, ItemPayload, Category } from '../types';
import { copyToClipboard } from '../utils/clipboard';
import { measureStrength } from '../utils/strength';

interface Props {
    item: Item | null;
    onSaved: () => void;
    onDeleted: () => void;
    onCancel: () => void;
    isNew?: boolean;
    newCategory?: Category;
}

const EMPTY_PAYLOAD: ItemPayload = {
    title: '', username: '', password: '', url: '', notes: '', fields: [],
};

export default function EntryDetail({ item, onSaved, onDeleted, onCancel, isNew, newCategory }: Props) {
    const [payload, setPayload] = useState<ItemPayload>(item?.payload ?? { ...EMPTY_PAYLOAD });
    const [category, setCategory] = useState<Category>(item?.category ?? newCategory ?? 'login');
    const [showPw, setShowPw] = useState(false);
    const [editing, setEditing] = useState(isNew ?? false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        setPayload(item?.payload ?? { ...EMPTY_PAYLOAD });
        setCategory(item?.category ?? newCategory ?? 'login');
        setEditing(isNew ?? false);
        setShowPw(false);
        setError('');
    }, [item, isNew, newCategory]);

    const strength = measureStrength(payload.password);

    function field(key: keyof ItemPayload, label: string, type = 'text') {
        return (
            <div key={key}>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--vault-muted)' }}>{label}</label>
                {editing ? (
                    <input
                        type={type}
                        value={String(payload[key] ?? '')}
                        onChange={e => setPayload(p => ({ ...p, [key]: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg border text-white text-sm focus:outline-none"
                        style={{ backgroundColor: 'var(--vault-bg)', borderColor: 'var(--vault-border)' }}
                    />
                ) : (
                    <p className="text-sm text-white py-2 px-3 rounded-lg" style={{ backgroundColor: 'var(--vault-bg)' }}>
                        {String(payload[key] || '—')}
                    </p>
                )}
            </div>
        );
    }

    async function handleCopyPw() {
        await copyToClipboard(payload.password);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    async function handleSave() {
        setError('');
        setLoading(true);
        try {
            if (isNew || !item) {
                await invoke('add_item', { category, payload });
            } else {
                await invoke('update_item', { id: item.id, payload });
            }
            setEditing(false);
            onSaved();
        } catch (err) {
            setError(String(err));
        } finally {
            setLoading(false);
        }
    }

    async function handleDelete() {
        if (!item || !confirm('Eintrag wirklich löschen?')) return;
        try {
            await invoke('delete_item', { id: item.id });
            onDeleted();
        } catch (err) {
            setError(String(err));
        }
    }

    if (!item && !isNew) {
        return (
            <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--vault-muted)' }}>
                <p className="text-sm">Eintrag auswählen oder neu erstellen</p>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-bold text-white">{isNew ? 'Neuer Eintrag' : (payload.title || '(Kein Titel)')}</h2>
                <div className="flex gap-2">
                    {!isNew && !editing && (
                        <>
                            <button onClick={() => setEditing(true)} className="text-xs px-3 py-1.5 rounded-lg border" style={{ borderColor: 'var(--vault-border)', color: 'var(--vault-muted)' }}>
                                Bearbeiten
                            </button>
                            <button onClick={handleDelete} className="text-xs px-3 py-1.5 rounded-lg border" style={{ borderColor: 'var(--vault-danger)', color: 'var(--vault-danger)' }}>
                                Löschen
                            </button>
                        </>
                    )}
                    {editing && (
                        <>
                            <button onClick={isNew ? onCancel : () => { setEditing(false); setPayload(item!.payload); }} className="text-xs px-3 py-1.5 rounded-lg border" style={{ borderColor: 'var(--vault-border)', color: 'var(--vault-muted)' }}>
                                Abbrechen
                            </button>
                            <button onClick={handleSave} disabled={loading} className="text-xs px-3 py-1.5 rounded-lg text-white disabled:opacity-50" style={{ backgroundColor: 'var(--vault-accent)' }}>
                                {loading ? 'Speichern...' : 'Speichern'}
                            </button>
                        </>
                    )}
                </div>
            </div>

            {field('title', 'Titel')}
            {field('username', 'Benutzername')}

            {/* Password field with show/hide and copy */}
            <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--vault-muted)' }}>Passwort</label>
                <div className="flex gap-2">
                    {editing ? (
                        <input
                            type={showPw ? 'text' : 'password'}
                            value={payload.password}
                            onChange={e => setPayload(p => ({ ...p, password: e.target.value }))}
                            className="flex-1 px-3 py-2 rounded-lg border text-white text-sm focus:outline-none font-mono"
                            style={{ backgroundColor: 'var(--vault-bg)', borderColor: 'var(--vault-border)' }}
                        />
                    ) : (
                        <p className="flex-1 text-sm text-white py-2 px-3 rounded-lg font-mono" style={{ backgroundColor: 'var(--vault-bg)' }}>
                            {showPw ? payload.password : '•'.repeat(Math.min(payload.password.length, 16))}
                        </p>
                    )}
                    <button onClick={() => setShowPw(s => !s)} className="px-3 py-2 rounded-lg border text-xs" style={{ borderColor: 'var(--vault-border)', color: 'var(--vault-muted)' }}>
                        {showPw ? '🙈' : '👁'}
                    </button>
                    <button onClick={handleCopyPw} className="px-3 py-2 rounded-lg border text-xs" style={{ borderColor: 'var(--vault-border)', color: copied ? '#22c55e' : 'var(--vault-muted)' }}>
                        {copied ? '✓' : '📋'}
                    </button>
                </div>
                {editing && payload.password && (
                    <div className="mt-2 flex gap-1">
                        {[0, 1, 2, 3, 4].map(i => (
                            <div key={i} className="h-1 flex-1 rounded-full" style={{ backgroundColor: i <= strength.score ? strength.color : 'var(--vault-border)' }} />
                        ))}
                    </div>
                )}
            </div>

            {field('url', 'URL')}
            {field('notes', 'Notizen')}

            {error && <p className="text-sm" style={{ color: 'var(--vault-danger)' }}>{error}</p>}
        </div>
    );
}
