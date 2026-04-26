import { useEffect, useState } from 'react';
import EntryDetail from './EntryDetail';
import type { Item, Category } from '../types';

interface Props {
    item: Item | null;
    isNew: boolean;
    newCategory: Category;
    onSaved: () => void;
    onDeleted: () => void;
    onBack: () => void;
}

export default function MobileDetailScreen({ item, isNew, newCategory, onSaved, onDeleted, onBack }: Props) {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const id = requestAnimationFrame(() => setVisible(true));
        return () => cancelAnimationFrame(id);
    }, []);

    function handleBack() {
        setVisible(false);
        setTimeout(onBack, 240);
    }

    function handleSaved() {
        setVisible(false);
        setTimeout(onSaved, 240);
    }

    function handleDeleted() {
        setVisible(false);
        setTimeout(onDeleted, 240);
    }

    return (
        <div
            className={visible ? 'slide-active' : 'slide-enter'}
            style={{
                position: 'fixed', inset: 0, zIndex: 60,
                backgroundColor: 'var(--vault-bg)',
                display: 'flex', flexDirection: 'column',
                overflow: 'hidden',
            }}
        >
            {/* Navigation header */}
            <div
                className="flex items-center justify-between px-4 shrink-0 border-b"
                style={{ height: 52, backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
            >
                <button
                    onClick={handleBack}
                    style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', color: 'var(--accent)' }}
                >
                    <svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M10 3L5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </button>
                <span className="text-[17px] font-semibold truncate max-w-[60%]" style={{ color: 'var(--text)' }}>
                    {isNew ? 'Neuer Eintrag' : (item?.payload.title || '—')}
                </span>
                <div style={{ width: 44 }} />
            </div>

            {/* EntryDetail body — fills remaining height, handles its own scrolling */}
            <div className="flex-1" style={{ minHeight: 0, overflow: 'hidden' }}>
                <EntryDetail
                    item={isNew ? null : item}
                    onSaved={handleSaved}
                    onDeleted={handleDeleted}
                    onCancel={handleBack}
                    isNew={isNew}
                    newCategory={newCategory}
                    isMobile
                />
            </div>
        </div>
    );
}
