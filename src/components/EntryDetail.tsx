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

const STRENGTH_COLOR = ['#ff453a', '#ff9f0a', '#ffd60a', '#32d74b', '#32d74b'];
const STRENGTH_LABEL = ['Sehr schwach', 'Schwach', 'Mittel', 'Stark', 'Sehr stark'];

export default function EntryDetail({ item, onSaved, onDeleted, onCancel, isNew, newCategory }: Props) {
    const [payload, setPayload] = useState<ItemPayload>(item?.payload ?? { ...EMPTY_PAYLOAD });
    const [category, setCategory] = useState<Category>(item?.category ?? newCategory ?? 'login');
    const [showPw, setShowPw] = useState(false);
    const [editing, setEditing] = useState(isNew ?? false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [copiedField, setCopiedField] = useState<string | null>(null);

    useEffect(() => {
        setPayload(item?.payload ?? { ...EMPTY_PAYLOAD });
        setCategory(item?.category ?? newCategory ?? 'login');
        setEditing(isNew ?? false);
        setShowPw(false);
        setError('');
    }, [item, isNew, newCategory]);

    const strength = measureStrength(payload.password);

    async function copy(value: string, field: string) {
        await copyToClipboard(value);
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 2000);
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
            <div className="flex-1 flex flex-col items-center justify-center gap-3 anim-fade-in" style={{ color: 'var(--text-3)' }}>
                <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                    <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" strokeLinecap="round" />
                </svg>
                <p className="text-sm">Eintrag auswählen</p>
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col h-full anim-slide-right">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-6 py-4 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
                <h2 className="text-base font-semibold truncate" style={{ color: 'var(--text)' }}>
                    {isNew ? 'Neuer Eintrag' : (payload.title || '(Kein Titel)')}
                </h2>
                <div className="flex items-center gap-2 shrink-0">
                    {!isNew && !editing && (
                        <>
                            <ToolBtn onClick={() => setEditing(true)} label="Bearbeiten" />
                            <ToolBtn onClick={handleDelete} label="Löschen" danger />
                        </>
                    )}
                    {editing && (
                        <>
                            <ToolBtn
                                onClick={isNew ? onCancel : () => { setEditing(false); setPayload(item!.payload); }}
                                label="Abbrechen"
                            />
                            <button
                                onClick={handleSave}
                                disabled={loading}
                                className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white transition-opacity disabled:opacity-50"
                                style={{ background: 'var(--accent)' }}
                            >
                                {loading ? 'Speichern…' : 'Speichern'}
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Fields */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                {/* Titel */}
                <Field label="Titel">
                    {editing
                        ? <input className="sd-input" value={payload.title} onChange={e => setPayload(p => ({ ...p, title: e.target.value }))} placeholder="Name des Eintrags" />
                        : <ReadField value={payload.title} />}
                </Field>

                {/* Benutzername */}
                <Field label="Benutzername">
                    {editing
                        ? <input className="sd-input" value={payload.username} onChange={e => setPayload(p => ({ ...p, username: e.target.value }))} placeholder="user@example.com" />
                        : (
                            <ReadFieldWithCopy
                                value={payload.username}
                                onCopy={() => copy(payload.username, 'username')}
                                copied={copiedField === 'username'}
                            />
                        )}
                </Field>

                {/* Passwort */}
                <div>
                    <label className="block text-xs font-medium mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                        Passwort
                    </label>
                    <div className="flex gap-2">
                        {editing
                            ? (
                                <input
                                    type={showPw ? 'text' : 'password'}
                                    value={payload.password}
                                    onChange={e => setPayload(p => ({ ...p, password: e.target.value }))}
                                    className="sd-input font-mono flex-1"
                                    placeholder="••••••••"
                                />
                            ) : (
                                <div
                                    className="flex-1 px-3 py-2.5 rounded-xl text-sm font-mono"
                                    style={{ background: 'var(--surface-2)', color: 'var(--text)' }}
                                >
                                    {showPw ? payload.password : '•'.repeat(Math.min(payload.password.length, 20))}
                                </div>
                            )}
                        <IconBtn onClick={() => setShowPw(s => !s)} title={showPw ? 'Verbergen' : 'Anzeigen'}>
                            {showPw ? <EyeOffSvg /> : <EyeSvg />}
                        </IconBtn>
                        <IconBtn onClick={() => copy(payload.password, 'password')} title="Kopieren">
                            {copiedField === 'password' ? <CheckSvg /> : <CopySvg />}
                        </IconBtn>
                    </div>

                    {editing && payload.password && (
                        <div className="mt-2.5 space-y-1">
                            <div className="flex gap-1">
                                {[0, 1, 2, 3, 4].map(i => (
                                    <div
                                        key={i}
                                        className="h-1 flex-1 rounded-full transition-all duration-300"
                                        style={{ background: i <= strength.score ? STRENGTH_COLOR[strength.score] : 'var(--surface-3)' }}
                                    />
                                ))}
                            </div>
                            <p className="text-xs" style={{ color: STRENGTH_COLOR[strength.score] }}>
                                {STRENGTH_LABEL[strength.score]}
                            </p>
                        </div>
                    )}
                </div>

                {/* URL */}
                <Field label="URL">
                    {editing
                        ? <input className="sd-input" value={payload.url} onChange={e => setPayload(p => ({ ...p, url: e.target.value }))} placeholder="https://example.com" />
                        : (
                            <ReadFieldWithCopy
                                value={payload.url}
                                onCopy={() => copy(payload.url, 'url')}
                                copied={copiedField === 'url'}
                            />
                        )}
                </Field>

                {/* Notizen */}
                <Field label="Notizen">
                    {editing
                        ? (
                            <textarea
                                value={payload.notes}
                                onChange={e => setPayload(p => ({ ...p, notes: e.target.value }))}
                                className="sd-input resize-none"
                                rows={4}
                                placeholder="Optionale Notizen…"
                            />
                        ) : <ReadField value={payload.notes} multiline />}
                </Field>

                {error && (
                    <div className="px-3 py-2.5 rounded-xl text-xs" style={{ background: 'rgba(255,69,58,0.08)', border: '1px solid rgba(255,69,58,0.2)', color: '#ff6b63' }}>
                        {error}
                    </div>
                )}
            </div>
        </div>
    );
}

/* ─── Sub-components ─── */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                {label}
            </label>
            {children}
        </div>
    );
}

function ReadField({ value, multiline }: { value: string; multiline?: boolean }) {
    const Tag = multiline ? 'p' : 'p';
    return (
        <Tag
            className="px-3 py-2.5 rounded-xl text-sm whitespace-pre-wrap"
            style={{ background: 'var(--surface-2)', color: value ? 'var(--text)' : 'var(--text-3)', minHeight: multiline ? '72px' : undefined }}
        >
            {value || '—'}
        </Tag>
    );
}

function ReadFieldWithCopy({ value, onCopy, copied }: { value: string; onCopy: () => void; copied: boolean }) {
    return (
        <div className="flex gap-2">
            <div className="flex-1 px-3 py-2.5 rounded-xl text-sm" style={{ background: 'var(--surface-2)', color: value ? 'var(--text)' : 'var(--text-3)' }}>
                {value || '—'}
            </div>
            <IconBtn onClick={onCopy} title="Kopieren">
                {copied ? <CheckSvg /> : <CopySvg />}
            </IconBtn>
        </div>
    );
}

function ToolBtn({ onClick, label, danger }: { onClick: () => void; label: string; danger?: boolean }) {
    return (
        <button
            onClick={onClick}
            className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
            style={{
                borderColor: danger ? 'rgba(255,69,58,0.3)' : 'var(--border)',
                color: danger ? 'var(--danger)' : 'var(--text-2)',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = danger ? 'rgba(255,69,58,0.08)' : 'var(--surface-2)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
            {label}
        </button>
    );
}

function IconBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
    return (
        <button
            onClick={onClick}
            title={title}
            className="w-10 h-10 flex items-center justify-center rounded-xl border shrink-0 transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
            {children}
        </button>
    );
}

function EyeSvg()    { return <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z" /><circle cx="10" cy="10" r="2.5" /></svg>; }
function EyeOffSvg() { return <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 3l14 14M9.88 9.88A2.5 2.5 0 0012.12 12M6.1 6.1C4.2 7.2 2.8 8.8 2 10c1.7 3 4.6 6 8 6a9 9 0 004-1M11.17 6.18A9 9 0 0118 10c-.8 1.2-2.2 2.8-4.1 3.9" strokeLinecap="round" /></svg>; }
function CopySvg()   { return <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M3 13V3h10" strokeLinecap="round" /></svg>; }
function CheckSvg()  { return <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--success)' }}><path d="M4 10l5 5 7-8" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
