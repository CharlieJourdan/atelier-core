// Primitives shared by every module of the IPC contract.

export const EFFORTS = ['low', 'medium', 'high', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export const PROVIDER_IDS = ['claude-code', 'anthropic'] as const
export type ProviderId = (typeof PROVIDER_IDS)[number]

export const VIEWS = ['chats', 'dashboard', 'board', 'content', 'approvals', 'computer', 'spend'] as const
export type ViewId = (typeof VIEWS)[number]
