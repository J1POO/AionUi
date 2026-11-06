import type { IWorkspaceFlatFile } from '@/common/adapter/ipcBridge';
import type { TMessage } from '@/common/chat/chatLib';
import { parseFileMarker } from '../components/fileMarker';

export type DocumentResult = IWorkspaceFlatFile & { size: number; lastModified: number };
type Metadata = { size: number; lastModified: number; isDirectory?: boolean };

export function isDocumentReferenced(file: IWorkspaceFlatFile, references: string, inputs: string): boolean {
  const mentions = (text: string): boolean => {
    const normalized = text.replace(/\\/g, '/');
    const candidates = [file.fullPath, file.relativePath, file.name];
    return candidates.some((candidate) => {
      const escaped = candidate.replace(/\\/g, '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // A bare filename must not match a suffix of a longer name or another path.
      return new RegExp(`(^|[^\\p{L}\\p{N}_./:-])${escaped}(?=$|[^\\p{L}\\p{N}_./-])`, 'u').test(normalized);
    });
  };
  return mentions(references) && !mentions(inputs);
}

export type DocumentEvidenceGroup = {
  anchorMessageId: string;
  since: number;
  references: string;
  inputs: string;
  /** Paths explicitly sent through the channel send protocol, even if older than `since`. */
  explicitPaths: string[];
  /** Workspace paths of files the user uploaded in this turn. */
  inboundPaths: string[];
};

const SEND_BLOCK = /\[AIONUI_CHANNEL_SEND\]([\s\S]*?)\[\/AIONUI_CHANNEL_SEND\]/g;

/** Extract local paths declared in `[AIONUI_CHANNEL_SEND]` blocks. */
export function extractSentPaths(text: string): string[] {
  const paths: string[] = [];
  for (const match of text.matchAll(SEND_BLOCK)) {
    try {
      const payload = JSON.parse(match[1].trim()) as {
        path?: unknown;
        files?: Array<{ path?: unknown }>;
      };
      const actions = Array.isArray(payload.files) ? [...payload.files] : [];
      if (typeof payload.path === 'string') actions.push(payload);
      for (const action of actions) {
        if (action && typeof action.path === 'string') paths.push(action.path);
      }
    } catch {
      // A malformed block must not break card discovery.
    }
  }
  return paths;
}

const INBOUND_MARKER = '[用户上传的文件]';

/** Extract workspace-relative paths declared in the channel inbound-file block. */
export function extractInboundPaths(text: string): string[] {
  const markerIndex = text.indexOf(INBOUND_MARKER);
  if (markerIndex < 0) return [];
  const section = text.slice(markerIndex + INBOUND_MARKER.length);
  const paths: string[] = [];
  for (const line of section.split('\n')) {
    const match = line.match(/^-\s+.*?:\s+(\S.*)$/);
    const candidate = match?.[1]?.trim();
    if (candidate && /\.(?:docx?|xlsx?|xlsm|csv|pptx?|pdf)$/i.test(candidate)) paths.push(candidate);
  }
  return paths;
}

export function collectDocumentEvidence(messages: TMessage[]): {
  references: string;
  inputs: string;
  groups: DocumentEvidenceGroup[];
} {
  const references: string[] = [];
  const inputs: string[] = [];
  const groups: DocumentEvidenceGroup[] = [];
  let turnReferences: string[] = [];
  let turnInputs: string[] = [];
  let turnWriters: Array<{ id: string; createdAt: number }> = [];
  let turnExplicit: string[] = [];
  let pendingInbound: string[] = [];
  let turnStart: { id: string; createdAt: number } | undefined;
  let lastAssistantText: { id: string; createdAt: number } | undefined;
  let turnSince = 0;

  const flushTurn = (): void => {
    // Uploaded files belong under the user message: it is always rendered,
    // while an assistant text can be folded into a tool summary and never get
    // its own render slot.
    const anchor =
      pendingInbound.length > 0 ? turnStart : (lastAssistantText ?? turnWriters.at(-1));
    const messageReferences = turnReferences.join('\n');
    if (
      anchor &&
      messageReferences &&
      /\.(?:docx?|xlsx?|xlsm|csv|pptx?|pdf)(?=$|[\s`'"),;:])/i.test(messageReferences)
    ) {
      groups.push({
        anchorMessageId: anchor.id,
        since: turnSince || anchor.createdAt,
        references: messageReferences,
        inputs: turnInputs.join('\n'),
        explicitPaths: [...turnExplicit, ...pendingInbound],
        inboundPaths: pendingInbound,
      });
    }
    turnReferences = [];
    turnInputs = [];
    turnWriters = [];
    turnExplicit = [];
    pendingInbound = [];
    turnStart = undefined;
    lastAssistantText = undefined;
    turnSince = 0;
  };

  for (const message of messages) {
    if (message.hidden) continue;
    if (message.position !== 'left') {
      if (message.type === 'text') {
        flushTurn();
        turnSince = message.created_at ?? 0;
        turnStart = { id: message.id, createdAt: message.created_at ?? 0 };
        const attachments = parseFileMarker(message.content.content, true).files;
        inputs.push(...attachments);
        turnInputs.push(...attachments);
        const inbound = extractInboundPaths(message.content.content);
        if (inbound.length) {
          references.push(...inbound);
          turnReferences.push(...inbound);
          pendingInbound.push(...inbound);
        }
      }
      continue;
    }
    if (!turnSince) turnSince = message.created_at ?? 0;
    if (message.type === 'text') {
      const sentPaths = extractSentPaths(message.content.content);
      if (sentPaths.length) {
        references.push(...sentPaths);
        turnReferences.push(...sentPaths);
        turnExplicit.push(...sentPaths);
      }
      references.push(message.content.content);
      turnReferences.push(message.content.content);
      lastAssistantText = { id: message.id, createdAt: message.created_at ?? 0 };
    }
    if (message.type === 'tool_call' && message.content.status === 'completed') {
      const path: unknown = message.content.args.file_path;
      if (typeof path !== 'string') continue;
      if (message.content.name === 'Write') {
        references.push(path);
        turnReferences.push(path);
        turnWriters.push({ id: message.id, createdAt: message.created_at ?? 0 });
      }
      if (message.content.name === 'Read') {
        inputs.push(path);
        turnInputs.push(path);
      }
    }
  }
  flushTurn();
  return { references: references.join('\n'), inputs: inputs.join('\n'), groups };
}

const normalize = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '');

const comparable = (path: string): string => normalize(path).replace(/^\.\//, '').replace(/^\/+/, '');

/** A file explicitly declared in a send-protocol or inbound block may predate this turn. */
export function isExplicitlySent(file: IWorkspaceFlatFile, explicitPaths: string[]): boolean {
  if (!explicitPaths.length) return false;
  const candidates = [file.relativePath, file.fullPath, file.name].map(comparable);
  return explicitPaths.some((explicit) => {
    const target = comparable(explicit);
    return candidates.some(
      (candidate) => candidate === target || candidate.endsWith(`/${target}`) || target.endsWith(`/${candidate}`)
    );
  });
}

/** Discover documents generated in this turn, plus files explicitly sent through the protocol. */
export async function discoverDocuments(
  workspace: string,
  since: number,
  files: IWorkspaceFlatFile[],
  metadata: (path: string) => Promise<Metadata>,
  explicitPaths: string[] = []
): Promise<DocumentResult[]> {
  if (!workspace || !Number.isFinite(since) || since <= 0) return [];
  const root = normalize(workspace);
  const windows = /^[A-Za-z]:\//.test(root);
  const compare = (path: string): string => (windows ? path.toLowerCase() : path);
  const candidates = new Map<string, IWorkspaceFlatFile>();
  for (const file of files) {
    const path = normalize(file.fullPath);
    if (!/\.(docx?|xlsx?|xlsm|csv|pptx?|pdf)$/i.test(file.name)) continue;
    if (path.split('/').includes('..') || !compare(path).startsWith(`${compare(root)}/`)) continue;
    candidates.set(compare(path), file);
  }
  const queue = Array.from(candidates.values());
  const results: DocumentResult[] = [];
  // Limit metadata I/O so a large workspace cannot flood the backend.
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (let file = queue.pop(); file; file = queue.pop()) {
        try {
          const info = await metadata(file.fullPath);
          if (
            !info.isDirectory &&
            info.size > 0 &&
            (info.lastModified >= since || isExplicitlySent(file, explicitPaths))
          ) {
            results.push({ ...file, ...info });
          }
        } catch {
          // Files may disappear between listing and verification.
        }
      }
    })
  );
  return results.sort((a, b) => (a.fullPath < b.fullPath ? -1 : a.fullPath > b.fullPath ? 1 : 0));
}
