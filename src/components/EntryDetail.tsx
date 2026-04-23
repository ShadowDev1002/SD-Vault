import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Item, ItemPayload, Category, CustomField, FieldType, AttachmentMeta } from '../types';
import { copyToClipboard } from '../utils/clipboard';
import { measureStrength } from '../utils/strength';
import { generateTotp } from '../utils/totp';
import { checkHibp } from '../utils/hibp';

interface Props {
    item: Item | null;
    onSaved: () => void;
    onDeleted: () => void;
    onCancel: () => void;
    isNew?: boolean;
    newCategory?: Category;
}

const EMPTY_PAYLOAD: ItemPayload = {
    title: '', notes: '', favorite: false, fields: [],
    username: '', password: '', url: '', totp: '',
    cardholder: '', card_number: '', expiry: '', cvv: '', pin: '',
    first_name: '', last_name: '', email: '', phone: '',
    company: '', job_title: '', address: '', city: '', zip: '', country: '', birthday: '',
};

const CATEGORY_META: Record<Category, { label: string; color: string }> = {
    login:    { label: 'Login',      color: '#0a84ff' },
    card:     { label: 'Karte',      color: '#32d74b' },
    note:     { label: 'Notiz',      color: '#ff9f0a' },
    identity: { label: 'Identität',  color: '#bf5af2' },
};

const STRENGTH_COLOR = ['#ff453a', '#ff9f0a', '#ffd60a', '#32d74b', '#32d74b'];
const STRENGTH_LABEL = ['Sehr schwach', 'Schwach', 'Mittel', 'Stark', 'Sehr stark'];

function genPassword(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*_+-=';
    const arr = new Uint8Array(24);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => chars[b % chars.length]).join('');
}

function formatDate(ts: number) {
    return new Date(ts * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' });
}

// ─── View mode field ───────────────────────────────────────────
function VField({
    label, value, secret = false, mono = false, onCopy, onOpen,
}: {
    label: string; value: string; secret?: boolean; mono?: boolean;
    onCopy?: () => void; onOpen?: () => void;
}) {
    const [revealed, setRevealed] = useState(false);
    const display = !value
        ? <span style={{ color: 'var(--text-3)' }}>—</span>
        : secret && !revealed
            ? <span className="tracking-widest" style={{ color: 'var(--text-2)' }}>{'•'.repeat(Math.min(value.length, 18))}</span>
            : <span className={mono ? 'font-mono' : ''}>{value}</span>;

    return (
        <div className="group flex items-start gap-3 py-3 px-4 border-b last:border-b-0" style={{ borderColor: 'var(--border-2)' }}>
            <div className="flex-1 min-w-0">
                <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>{label}</p>
                <p className="text-sm break-all" style={{ color: 'var(--text)' }}>{display}</p>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-4">
                {secret && value && (
                    <SmBtn onClick={() => setRevealed(r => !r)} title={revealed ? 'Verbergen' : 'Anzeigen'}>
                        {revealed ? <EyeOffSvg /> : <EyeSvg />}
                    </SmBtn>
                )}
                {onCopy && value && <SmBtn onClick={onCopy} title="Kopieren"><CopySvg /></SmBtn>}
                {onOpen && value && <SmBtn onClick={onOpen} title="Öffnen"><ExtLinkSvg /></SmBtn>}
            </div>
        </div>
    );
}

// ─── TOTP live code ────────────────────────────────────────────
function TotpField({ secret, onCopy }: { secret: string; onCopy: () => void }) {
    const [code, setCode] = useState('------');
    const [remaining, setRemaining] = useState(30);
    const [err, setErr] = useState(false);

    useEffect(() => {
        if (!secret) return;
        let cancelled = false;
        async function tick() {
            try {
                const r = await generateTotp(secret);
                if (!cancelled) { setCode(r.code); setRemaining(r.remaining); setErr(false); }
            } catch { if (!cancelled) setErr(true); }
        }
        tick();
        const id = setInterval(tick, 1000);
        return () => { cancelled = true; clearInterval(id); };
    }, [secret]);

    const pct = remaining / 30;
    const r = 10, circ = 2 * Math.PI * r;

    return (
        <div className="group flex items-start gap-3 py-3 px-4 border-b last:border-b-0" style={{ borderColor: 'var(--border-2)' }}>
            <div className="flex-1 min-w-0">
                <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>Einmalcode (TOTP)</p>
                {err ? (
                    <span className="text-sm" style={{ color: '#ff453a' }}>Ungültiger TOTP-Secret</span>
                ) : (
                    <div className="flex items-center gap-3">
                        <span className="text-2xl font-mono tracking-[0.2em] font-semibold" style={{ color: remaining <= 5 ? '#ff453a' : 'var(--text)' }}>
                            {code.slice(0, 3)} {code.slice(3)}
                        </span>
                        <svg width="26" height="26" viewBox="0 0 26 26">
                            <circle cx="13" cy="13" r={r} fill="none" stroke="var(--border-2)" strokeWidth="2.5" />
                            <circle cx="13" cy="13" r={r} fill="none"
                                stroke={remaining <= 5 ? '#ff453a' : 'var(--accent)'}
                                strokeWidth="2.5"
                                strokeDasharray={circ}
                                strokeDashoffset={circ * (1 - pct)}
                                strokeLinecap="round"
                                transform="rotate(-90 13 13)"
                                style={{ transition: 'stroke-dashoffset 0.9s linear, stroke 0.3s' }}
                            />
                        </svg>
                        <span className="text-xs tabular-nums" style={{ color: 'var(--text-3)' }}>{remaining}s</span>
                    </div>
                )}
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-4">
                {!err && <SmBtn onClick={onCopy} title="Kopieren"><CopySvg /></SmBtn>}
            </div>
        </div>
    );
}

// ─── Section card ──────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2 px-1" style={{ color: 'var(--text-3)' }}>{title}</p>
            <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                {children}
            </div>
        </div>
    );
}

// ─── Edit field ────────────────────────────────────────────────
function EField({
    label, value, onChange, type = 'text', placeholder = '', mono = false,
}: {
    label: string; value: string; onChange: (v: string) => void;
    type?: string; placeholder?: string; mono?: boolean;
}) {
    return (
        <div>
            <label className="block text-xs uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-3)' }}>{label}</label>
            <input
                type={type}
                value={value}
                onChange={e => onChange(e.target.value)}
                placeholder={placeholder}
                className={`sd-input${mono ? ' font-mono' : ''}`}
            />
        </div>
    );
}

// ─── Main component ────────────────────────────────────────────
export default function EntryDetail({ item, onSaved, onDeleted, onCancel, isNew, newCategory }: Props) {
    const [p, setP] = useState<ItemPayload>(item?.payload ?? { ...EMPTY_PAYLOAD });
    const [cat, setCat] = useState<Category>(item?.category ?? newCategory ?? 'login');
    const [showPw, setShowPw] = useState(false);
    const [editing, setEditing] = useState(isNew ?? false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [copied, setCopied] = useState<string | null>(null);
    const [hibpCount, setHibpCount] = useState<number | null>(null);
    const [hibpChecking, setHibpChecking] = useState(false);
    const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
    const [dragOver, setDragOver] = useState(false);

    useEffect(() => {
        setP(item?.payload ?? { ...EMPTY_PAYLOAD });
        setCat(item?.category ?? newCategory ?? 'login');
        setEditing(isNew ?? false);
        setShowPw(false);
        setError('');
        setHibpCount(null);
        if (item && !isNew) {
            invoke<AttachmentMeta[]>('get_attachments', { itemId: item.id })
                .then(setAttachments)
                .catch(() => setAttachments([]));
        } else {
            setAttachments([]);
        }
    }, [item?.id, isNew, newCategory]);

    const strength = measureStrength(p.password);
    const meta = CATEGORY_META[cat];

    function set(key: keyof ItemPayload, val: string | boolean) {
        setP(prev => ({ ...prev, [key]: val }));
    }

    async function cp(value: string, key: string) {
        await copyToClipboard(value);
        setCopied(key);
        setTimeout(() => setCopied(null), 2000);
    }

    function openUrl(url: string) {
        invoke('open_url', { url }).catch(() => {});
    }

    async function handleSave() {
        setError('');
        setLoading(true);
        try {
            if (isNew || !item) {
                await invoke('add_item', { category: cat, payload: p });
            } else {
                await invoke('update_item', { id: item.id, payload: p });
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

    function addCustomField() {
        const field: CustomField = {
            id: crypto.randomUUID(),
            label: 'Neues Feld',
            value: '',
            field_type: 'text',
        };
        setP(prev => ({ ...prev, fields: [...prev.fields, field] }));
    }

    function updateCustomField(id: string, key: keyof CustomField, val: string) {
        setP(prev => ({
            ...prev,
            fields: prev.fields.map(f => f.id === id ? { ...f, [key]: val } : f),
        }));
    }

    function removeCustomField(id: string) {
        setP(prev => ({ ...prev, fields: prev.fields.filter(f => f.id !== id) }));
    }

    async function handleAttachmentDrop(files: FileList | null) {
        if (!files || !item) return;
        for (const file of Array.from(files)) {
            if (file.size > 10 * 1024 * 1024) { alert(`${file.name} ist zu groß (max. 10 MB)`); continue; }
            const buf = await file.arrayBuffer();
            const data = Array.from(new Uint8Array(buf));
            await invoke('add_attachment', { itemId: item.id, name: file.name, mime: file.type, data });
        }
        const updated = await invoke<AttachmentMeta[]>('get_attachments', { itemId: item.id });
        setAttachments(updated);
    }

    async function handleDownloadAttachment(att: AttachmentMeta) {
        const bytes: number[] = await invoke('get_attachment_data', { id: att.id });
        const blob = new Blob([new Uint8Array(bytes)], { type: att.mime || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = att.name; a.click();
        URL.revokeObjectURL(url);
    }

    async function handleExportPdf() {
        if (!item) return;
        try {
            const { save } = await import('@tauri-apps/plugin-dialog');
            const path = await save({
                defaultPath: `${item.payload.title || 'eintrag'}.pdf`,
                filters: [{ name: 'PDF', extensions: ['pdf'] }],
            });
            if (!path) return;
            await invoke('export_entry_pdf', { id: item.id, savePath: path });
        } catch (err) {
            setError(String(err));
        }
    }

    if (!item && !isNew) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 anim-fade-in" style={{ color: 'var(--text-3)' }}>
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'var(--surface-2)' }}>
                    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                        <rect x="3" y="11" width="18" height="11" rx="2.5" />
                        <path d="M7 11V7a5 5 0 0110 0v4" strokeLinecap="round" />
                    </svg>
                </div>
                <p className="text-sm">Eintrag auswählen oder neu erstellen</p>
            </div>
        );
    }

    // ── EDIT MODE ──────────────────────────────────────────────
    if (editing) {
        return (
            <div className="flex-1 flex flex-col h-full anim-slide-right">
                {/* Toolbar */}
                <div className="flex items-center gap-3 px-6 py-4 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: meta.color }}>
                        <CategorySvg cat={cat} />
                    </div>
                    <input
                        value={p.title}
                        onChange={e => set('title', e.target.value)}
                        placeholder="Titel"
                        className="flex-1 bg-transparent text-base font-semibold focus:outline-none border-b border-transparent focus:border-current transition-colors"
                        style={{ color: 'var(--text)' }}
                        autoFocus={!p.title}
                    />
                    <div className="flex items-center gap-2 shrink-0">
                        <button onClick={isNew ? onCancel : () => { setEditing(false); setP(item!.payload); }}
                            className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
                            style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}>
                            Abbrechen
                        </button>
                        <button onClick={handleSave} disabled={loading}
                            className="text-xs px-4 py-1.5 rounded-lg font-semibold text-white disabled:opacity-50"
                            style={{ background: 'var(--accent)' }}>
                            {loading ? 'Speichern…' : 'Speichern'}
                        </button>
                    </div>
                </div>

                {/* Category tabs (only when new) */}
                {isNew && (
                    <div className="flex gap-1 px-6 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                        {(Object.entries(CATEGORY_META) as [Category, typeof meta][]).map(([k, m]) => (
                            <button key={k} onClick={() => setCat(k)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                                style={{
                                    background: cat === k ? m.color + '22' : 'transparent',
                                    color: cat === k ? m.color : 'var(--text-2)',
                                    border: `1px solid ${cat === k ? m.color + '44' : 'transparent'}`,
                                }}>
                                <span className="w-3 h-3"><CategorySvg cat={k} /></span>
                                {m.label}
                            </button>
                        ))}
                    </div>
                )}

                {/* Fields */}
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
                    {cat === 'login' && <>
                        <Section title="Anmeldedaten">
                            <div className="p-4 space-y-4">
                                <EField label="Benutzername" value={p.username} onChange={v => set('username', v)} placeholder="user@example.com" />
                                {/* Password with generator */}
                                <div>
                                    <label className="block text-xs uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-3)' }}>Passwort</label>
                                    <div className="flex gap-2">
                                        <input
                                            type={showPw ? 'text' : 'password'}
                                            value={p.password}
                                            onChange={e => set('password', e.target.value)}
                                            placeholder="••••••••"
                                            className="sd-input font-mono flex-1"
                                        />
                                        <SmBtn onClick={() => setShowPw(s => !s)} title={showPw ? 'Verbergen' : 'Anzeigen'}>
                                            {showPw ? <EyeOffSvg /> : <EyeSvg />}
                                        </SmBtn>
                                        <SmBtn onClick={() => set('password', genPassword())} title="Passwort generieren">
                                            <GenSvg />
                                        </SmBtn>
                                    </div>
                                    {p.password && (
                                        <div className="mt-2 space-y-1">
                                            <div className="flex gap-1">
                                                {[0,1,2,3,4].map(i => (
                                                    <div key={i} className="h-1 flex-1 rounded-full transition-all duration-300"
                                                        style={{ background: i <= strength.score ? STRENGTH_COLOR[strength.score] : 'var(--surface-3)' }} />
                                                ))}
                                            </div>
                                            <p className="text-xs" style={{ color: STRENGTH_COLOR[strength.score] }}>{STRENGTH_LABEL[strength.score]}</p>
                                        </div>
                                    )}
                                </div>
                                <EField label="Website" value={p.url} onChange={v => set('url', v)} placeholder="https://example.com" />
                                <EField label="2FA / TOTP-Schlüssel" value={p.totp} onChange={v => set('totp', v)} placeholder="otpauth:// oder Secret Key" mono />
                            </div>
                        </Section>
                    </>}

                    {cat === 'card' && <>
                        <Section title="Kartendaten">
                            <div className="p-4 space-y-4">
                                <EField label="Karteninhaber" value={p.cardholder} onChange={v => set('cardholder', v)} placeholder="Max Mustermann" />
                                <EField label="Kartennummer" value={p.card_number} onChange={v => set('card_number', v)} placeholder="•••• •••• •••• ••••" mono />
                                <div className="grid grid-cols-2 gap-4">
                                    <EField label="Ablaufdatum" value={p.expiry} onChange={v => set('expiry', v)} placeholder="MM/JJ" />
                                    <EField label="CVV" value={p.cvv} onChange={v => set('cvv', v)} placeholder="•••" />
                                </div>
                                <EField label="PIN" value={p.pin} onChange={v => set('pin', v)} placeholder="••••" type="password" />
                            </div>
                        </Section>
                    </>}

                    {cat === 'identity' && <>
                        <Section title="Persönliche Daten">
                            <div className="p-4 space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <EField label="Vorname" value={p.first_name} onChange={v => set('first_name', v)} placeholder="Max" />
                                    <EField label="Nachname" value={p.last_name} onChange={v => set('last_name', v)} placeholder="Mustermann" />
                                </div>
                                <EField label="Geburtstag" value={p.birthday} onChange={v => set('birthday', v)} placeholder="TT.MM.JJJJ" />
                            </div>
                        </Section>
                        <Section title="Kontakt">
                            <div className="p-4 space-y-4">
                                <EField label="E-Mail" value={p.email} onChange={v => set('email', v)} placeholder="max@example.com" type="email" />
                                <EField label="Telefon" value={p.phone} onChange={v => set('phone', v)} placeholder="+49 123 456789" />
                            </div>
                        </Section>
                        <Section title="Beruf">
                            <div className="p-4 space-y-4">
                                <EField label="Unternehmen" value={p.company} onChange={v => set('company', v)} placeholder="Musterfirma GmbH" />
                                <EField label="Position" value={p.job_title} onChange={v => set('job_title', v)} placeholder="Software Engineer" />
                            </div>
                        </Section>
                        <Section title="Adresse">
                            <div className="p-4 space-y-4">
                                <EField label="Straße & Hausnummer" value={p.address} onChange={v => set('address', v)} placeholder="Musterstraße 1" />
                                <div className="grid grid-cols-2 gap-4">
                                    <EField label="PLZ" value={p.zip} onChange={v => set('zip', v)} placeholder="12345" />
                                    <EField label="Stadt" value={p.city} onChange={v => set('city', v)} placeholder="Berlin" />
                                </div>
                                <EField label="Land" value={p.country} onChange={v => set('country', v)} placeholder="Deutschland" />
                            </div>
                        </Section>
                    </>}

                    {/* Notes (all categories) */}
                    <Section title="Notizen">
                        <div className="p-4">
                            <textarea
                                value={p.notes}
                                onChange={e => set('notes', e.target.value)}
                                className="sd-input resize-none"
                                rows={4}
                                placeholder="Optionale Notizen…"
                            />
                        </div>
                    </Section>

                    {/* Custom fields */}
                    {p.fields.length > 0 && (
                        <Section title="Weitere Felder">
                            <div className="p-4 space-y-3">
                                {p.fields.map(f => (
                                    <div key={f.id} className="flex gap-2 items-start">
                                        <div className="flex-1 space-y-2">
                                            <input
                                                value={f.label}
                                                onChange={e => updateCustomField(f.id, 'label', e.target.value)}
                                                className="sd-input text-xs"
                                                placeholder="Feldname"
                                            />
                                            <input
                                                type={f.field_type === 'password' ? 'password' : 'text'}
                                                value={f.value}
                                                onChange={e => updateCustomField(f.id, 'value', e.target.value)}
                                                className="sd-input"
                                                placeholder="Wert"
                                            />
                                        </div>
                                        <button onClick={() => removeCustomField(f.id)} className="mt-2 p-2 rounded-lg transition-colors" style={{ color: 'var(--danger)' }}
                                            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,69,58,0.1)')}
                                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                                            <TrashSvg />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </Section>
                    )}

                    <button onClick={addCustomField}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed text-sm transition-colors"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}>
                        <span className="text-lg leading-none">+</span>
                        Feld hinzufügen
                    </button>

                    {error && (
                        <div className="px-3 py-2.5 rounded-xl text-xs" style={{ background: 'rgba(255,69,58,0.08)', border: '1px solid rgba(255,69,58,0.2)', color: '#ff6b63' }}>
                            {error}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ── VIEW MODE ──────────────────────────────────────────────
    const name = cat === 'identity'
        ? [p.first_name, p.last_name].filter(Boolean).join(' ') || p.title
        : p.title || '(Kein Titel)';

    const subtitle = cat === 'login'    ? (p.url ? new URL(p.url.startsWith('http') ? p.url : 'https://' + p.url).hostname : p.username)
                   : cat === 'card'     ? (p.card_number ? '•••• ' + p.card_number.replace(/\s/g, '').slice(-4) : p.cardholder)
                   : cat === 'identity' ? (p.email || p.phone)
                   : '';

    return (
        <div className="flex-1 flex flex-col h-full anim-slide-right">
            {/* Header */}
            <div className="px-6 py-5 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 text-white"
                        style={{ background: `linear-gradient(135deg, ${meta.color}dd, ${meta.color}88)` }}>
                        <CategorySvgLg cat={cat} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h2 className="text-lg font-semibold leading-tight" style={{ color: 'var(--text)' }}>{name}</h2>
                        {subtitle && <p className="text-sm mt-0.5 truncate" style={{ color: 'var(--text-2)' }}>{subtitle}</p>}
                        <span className="inline-block mt-1.5 px-2 py-0.5 rounded-md text-xs font-medium"
                            style={{ background: meta.color + '22', color: meta.color }}>
                            {meta.label}
                        </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                        <SmBtn onClick={() => set('favorite', !p.favorite)} title="Favorit">
                            <svg className="w-4 h-4" viewBox="0 0 20 20" fill={p.favorite ? '#ffd60a' : 'none'} stroke={p.favorite ? '#ffd60a' : 'currentColor'} strokeWidth="1.5">
                                <path d="M10 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L10 14.3l-4.8 2.6.9-5.4L2.2 7.7l5.4-.8L10 2z" strokeLinejoin="round" />
                            </svg>
                        </SmBtn>
                        <SmBtn onClick={handleExportPdf} title="Als PDF exportieren">
                            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                                <path d="M4 2h6l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" strokeLinejoin="round"/>
                                <path d="M9 2v4h4M6 9h4M6 12h2" strokeLinecap="round"/>
                            </svg>
                        </SmBtn>
                        <SmBtn onClick={() => setEditing(true)} title="Bearbeiten"><EditSvg /></SmBtn>
                        <SmBtn onClick={handleDelete} title="Löschen" danger><TrashSvg /></SmBtn>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                {cat === 'login' && (
                    <Section title="Anmeldedaten">
                        <VField label="Benutzername" value={p.username} onCopy={() => cp(p.username, 'username')} />
                        <VField label="Passwort" value={p.password} secret mono onCopy={() => cp(p.password, 'password')} />
                        {p.password && (
                            <div className="px-4 py-2 flex items-center gap-3 border-b" style={{ borderColor: 'var(--border-2)' }}>
                                <button
                                    onClick={async () => {
                                        setHibpChecking(true); setHibpCount(null);
                                        try { setHibpCount(await checkHibp(p.password)); }
                                        catch { setHibpCount(-1); }
                                        finally { setHibpChecking(false); }
                                    }}
                                    disabled={hibpChecking}
                                    className="text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50"
                                    style={{ borderColor: 'var(--border)', color: 'var(--text-3)', backgroundColor: 'transparent' }}
                                >
                                    {hibpChecking ? 'Prüfe…' : 'Auf Datenleck prüfen'}
                                </button>
                                {hibpCount !== null && hibpCount >= 0 && (
                                    hibpCount === 0
                                        ? <span className="text-xs" style={{ color: '#32d74b' }}>✓ Kein Datenleck gefunden</span>
                                        : <span className="text-xs font-medium" style={{ color: '#ff453a' }}>⚠ {hibpCount.toLocaleString('de-DE')}× in Datenlecks</span>
                                )}
                                {hibpCount === -1 && <span className="text-xs" style={{ color: 'var(--text-3)' }}>Prüfung fehlgeschlagen</span>}
                            </div>
                        )}
                        <VField label="Website" value={p.url} onCopy={() => cp(p.url, 'url')} onOpen={() => openUrl(p.url)} />
                        {p.totp && (
                            <TotpField secret={p.totp} onCopy={async () => {
                                try { const { code } = await generateTotp(p.totp); copyToClipboard(code); } catch {}
                            }} />
                        )}
                    </Section>
                )}

                {cat === 'card' && (
                    <Section title="Kartendaten">
                        <VField label="Karteninhaber" value={p.cardholder} onCopy={() => cp(p.cardholder, 'cardholder')} />
                        <VField label="Kartennummer" value={p.card_number} secret mono onCopy={() => cp(p.card_number, 'card_number')} />
                        <VField label="Ablaufdatum" value={p.expiry} onCopy={() => cp(p.expiry, 'expiry')} />
                        <VField label="CVV" value={p.cvv} secret mono onCopy={() => cp(p.cvv, 'cvv')} />
                        {p.pin && <VField label="PIN" value={p.pin} secret mono onCopy={() => cp(p.pin, 'pin')} />}
                    </Section>
                )}

                {cat === 'identity' && (<>
                    <Section title="Persönliche Daten">
                        <VField label="Vorname"   value={p.first_name} onCopy={() => cp(p.first_name, 'fn')} />
                        <VField label="Nachname"  value={p.last_name}  onCopy={() => cp(p.last_name,  'ln')} />
                        {p.birthday && <VField label="Geburtstag" value={p.birthday} />}
                    </Section>
                    {(p.email || p.phone) && (
                        <Section title="Kontakt">
                            {p.email && <VField label="E-Mail"   value={p.email} onCopy={() => cp(p.email, 'email')} />}
                            {p.phone && <VField label="Telefon"  value={p.phone} onCopy={() => cp(p.phone, 'phone')} />}
                        </Section>
                    )}
                    {(p.company || p.job_title) && (
                        <Section title="Beruf">
                            {p.company   && <VField label="Unternehmen" value={p.company}   onCopy={() => cp(p.company,   'company')} />}
                            {p.job_title && <VField label="Position"    value={p.job_title} onCopy={() => cp(p.job_title, 'job')} />}
                        </Section>
                    )}
                    {(p.address || p.city) && (
                        <Section title="Adresse">
                            {p.address && <VField label="Straße"  value={p.address} />}
                            {p.city    && <VField label="Stadt"   value={`${p.zip ? p.zip + ' ' : ''}${p.city}`} />}
                            {p.country && <VField label="Land"    value={p.country} />}
                        </Section>
                    )}
                </>)}

                {/* Notes */}
                {p.notes && (
                    <Section title="Notizen">
                        <div className="px-4 py-3">
                            <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text)' }}>{p.notes}</p>
                        </div>
                    </Section>
                )}

                {/* Custom fields */}
                {p.fields.length > 0 && (
                    <Section title="Weitere Felder">
                        {p.fields.map(f => (
                            <VField
                                key={f.id}
                                label={f.label}
                                value={f.value}
                                secret={f.field_type === 'password'}
                                onCopy={() => cp(f.value, f.id)}
                            />
                        ))}
                    </Section>
                )}

                {/* Anhänge */}
                {item && !isNew && (
                    <Section title="Anhänge">
                        <div
                            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                            onDragLeave={() => setDragOver(false)}
                            onDrop={e => { e.preventDefault(); setDragOver(false); handleAttachmentDrop(e.dataTransfer.files); }}
                            onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.onchange = () => handleAttachmentDrop(inp.files); inp.click(); }}
                            className="mx-4 my-2 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 py-5 transition-colors cursor-pointer"
                            style={{ borderColor: dragOver ? 'var(--accent)' : 'var(--border)', backgroundColor: dragOver ? 'rgba(10,132,255,0.05)' : 'transparent' }}
                        >
                            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--text-3)' }}>
                                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            <p className="text-xs" style={{ color: 'var(--text-3)' }}>Dateien hierhin ziehen oder klicken (max. 10 MB)</p>
                        </div>
                        {attachments.map(att => (
                            <div key={att.id} className="group flex items-center gap-3 px-4 py-3 border-t" style={{ borderColor: 'var(--border-2)' }}>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm truncate" style={{ color: 'var(--text)' }}>{att.name}</p>
                                    <p className="text-xs" style={{ color: 'var(--text-3)' }}>{(att.size / 1024).toFixed(1)} KB</p>
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <SmBtn onClick={() => handleDownloadAttachment(att)} title="Herunterladen">
                                        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                                            <path d="M8 2v8M5 7l3 3 3-3" strokeLinecap="round" strokeLinejoin="round"/>
                                            <path d="M3 12h10" strokeLinecap="round"/>
                                        </svg>
                                    </SmBtn>
                                    <SmBtn onClick={async () => { await invoke('delete_attachment', { id: att.id }); setAttachments(prev => prev.filter(a => a.id !== att.id)); }} title="Löschen" danger>
                                        <TrashSvg />
                                    </SmBtn>
                                </div>
                            </div>
                        ))}
                    </Section>
                )}

                {/* Footer */}
                {item && (
                    <p className="text-xs text-center pb-2" style={{ color: 'var(--text-3)' }}>
                        Zuletzt geändert: {formatDate(item.updated_at)}
                    </p>
                )}

                {error && (
                    <div className="px-3 py-2.5 rounded-xl text-xs" style={{ background: 'rgba(255,69,58,0.08)', border: '1px solid rgba(255,69,58,0.2)', color: '#ff6b63' }}>
                        {error}
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Icon helpers ──────────────────────────────────────────────
function SmBtn({ onClick, title, danger, children }: { onClick: () => void; title: string; danger?: boolean; children: React.ReactNode }) {
    return (
        <button onClick={onClick} title={title}
            className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: danger ? 'var(--danger)' : 'var(--text-2)' }}
            onMouseEnter={e => (e.currentTarget.style.background = danger ? 'rgba(255,69,58,0.1)' : 'var(--surface-2)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
            {children}
        </button>
    );
}

function CategorySvg({ cat }: { cat: Category }) {
    if (cat === 'login')    return <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="1.5"><circle cx="5.5" cy="8" r="3.5" /><path d="M9 8h6M13 6v4" strokeLinecap="round" /></svg>;
    if (cat === 'card')     return <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="1.5"><rect x="1" y="3" width="14" height="10" rx="1.5" /><path d="M1 6h14" strokeLinecap="round" /></svg>;
    if (cat === 'note')     return <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="1.5"><rect x="2" y="1" width="12" height="14" rx="1.5" /><path d="M5 5h6M5 8h6M5 11h4" strokeLinecap="round" /></svg>;
    return <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="1.5"><circle cx="8" cy="5" r="3" /><path d="M2 14c0-3.3 2.7-5 6-5s6 1.7 6 5" strokeLinecap="round" /></svg>;
}

function CategorySvgLg({ cat }: { cat: Category }) {
    if (cat === 'login')    return <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5"><circle cx="8" cy="12" r="5" /><path d="M13 12h9M19 9v6" strokeLinecap="round" /></svg>;
    if (cat === 'card')     return <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" strokeLinecap="round" /></svg>;
    if (cat === 'note')     return <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5"><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" strokeLinecap="round" /></svg>;
    return <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" strokeLinecap="round" /></svg>;
}

function EyeSvg()     { return <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z" /><circle cx="10" cy="10" r="2.5" /></svg>; }
function EyeOffSvg()  { return <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 3l14 14M9.88 9.88A2.5 2.5 0 0012.12 12M6.1 6.1C4.2 7.2 2.8 8.8 2 10c1.7 3 4.6 6 8 6a9 9 0 004-1M11.17 6.18A9 9 0 0118 10" strokeLinecap="round" /></svg>; }
function CopySvg()    { return <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M3 13V3h10" strokeLinecap="round" /></svg>; }
function ExtLinkSvg() { return <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 5H5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-4" strokeLinecap="round" /><path d="M15 3h2v2M17 3l-7 7" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function GenSvg()     { return <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 10a6 6 0 1012 0" strokeLinecap="round" /><path d="M16 10l-2-2M16 10l-2 2" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function EditSvg()    { return <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M13.5 3.5l3 3L7 16H4v-3L13.5 3.5z" strokeLinejoin="round" /></svg>; }
function TrashSvg()   { return <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 6h12M8 6V4h4v2M7 6v10a1 1 0 001 1h4a1 1 0 001-1V6" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
