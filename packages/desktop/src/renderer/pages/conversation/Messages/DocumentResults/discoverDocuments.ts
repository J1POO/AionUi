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

export type DocumentEvidenceGroup = { anchorMessageId: string; since: number; references: string; inputs: string };

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
  let lastAssistantText: { id: string; createdAt: number } | undefined;
  let turnSince = 0;

  const flushTurn = (): void => {
    const anchor = lastAssistantText ?? turnWriters.at(-1);
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
      });
    }
    turnReferences = [];
    turnInputs = [];
    turnWriters = [];
    lastAssistantText = undefined;
    turnSince = 0;
  };

  for (const message of messages) {
    if (message.hidden) continue;
    if (message.position !== 'left') {
      if (message.type === 'text') {
        flushTurn();
        turnSince = message.created_at ?? 0;
        const attachments = parseFileMarker(message.content.content, true).files;
        inputs.push(...attachments);
        turnInputs.push(...attachments);
      }
      continue;
    }
    if (!turnSince) turnSince = message.created_at ?? 0;
    if (message.type === 'text') {
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

/** Discover actual documents modified during the loaded conversation window. */
export async function discoverDocuments(
  workspace: string,
  since: number,
  files: IWorkspaceFlatFile[],
  metadata: (path: string) => Promise<Metadata>
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
          if (!info.isDirectory && info.size > 0 && info.lastModified >= since) results.push({ ...file, ...info });
        } catch {
          // Files may disappear between listing and verification.
        }
      }
    })
  );
  return results.sort((a, b) => (a.fullPath < b.fullPath ? -1 : a.fullPath > b.fullPath ? 1 : 0));
}
