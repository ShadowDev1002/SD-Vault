export type Category = 'login' | 'card' | 'note' | 'identity';

export interface CustomField {
    label: string;
    value: string;
}

export interface ItemPayload {
    title: string;
    username: string;
    password: string;
    url: string;
    notes: string;
    fields: CustomField[];
}

export interface Item {
    id: string;
    category: Category;
    updated_at: number;
    payload: ItemPayload;
}

export interface VaultMeta {
    id: string;
    created_at: number;
    argon2_mem: number;
    argon2_ops: number;
}

export interface BackupEntry {
    id: string;
    timestamp: number;
    size_bytes: number;
}

export interface SftpConfig {
    host: string;
    port: number;
    username: string;
    remote_path: string;
    auth:
        | { type: 'Password'; password: string }
        | { type: 'KeyFile'; key_path: string };
}

export interface CreateVaultResult {
    vault_id: string;
    secret_key_formatted: string;
    created_at_formatted: string;
    pdf_bytes: number[];
}
