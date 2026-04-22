import { useState } from 'react';
import SecuritySettings from './SecuritySettings';
import SyncSettings from './SyncSettings';

type Tab = 'security' | 'sync';

interface Props {
    isUnlocked: boolean;
    onClose: () => void;
}

export default function Settings({ isUnlocked, onClose }: Props) {
    const [tab, setTab] = useState<Tab>('security');
    const [lockTimeout, setLockTimeout] = useState(5);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
            <div className="w-full max-w-xl rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--vault-surface)', borderColor: 'var(--vault-border)' }}>
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--vault-border)' }}>
                    <h2 className="text-base font-bold text-white">Einstellungen</h2>
                    <button onClick={onClose} className="text-xl leading-none" style={{ color: 'var(--vault-muted)' }}>×</button>
                </div>

                {/* Tabs */}
                <div className="flex border-b" style={{ borderColor: 'var(--vault-border)' }}>
                    {(['security', 'sync'] as Tab[]).map(t => (
                        <button
                            key={t}
                            onClick={() => setTab(t)}
                            className="px-6 py-3 text-sm font-medium border-b-2 transition-colors"
                            style={{
                                borderBottomColor: tab === t ? 'var(--vault-accent)' : 'transparent',
                                color: tab === t ? 'white' : 'var(--vault-muted)',
                            }}
                        >
                            {t === 'security' ? 'Sicherheit' : 'Sync'}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="p-6 max-h-96 overflow-y-auto">
                    {tab === 'security' && (
                        <SecuritySettings lockTimeout={lockTimeout} onTimeoutChange={setLockTimeout} />
                    )}
                    {tab === 'sync' && (
                        <SyncSettings isUnlocked={isUnlocked} />
                    )}
                </div>
            </div>
        </div>
    );
}
