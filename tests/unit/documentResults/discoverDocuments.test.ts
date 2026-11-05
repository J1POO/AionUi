import { describe, expect, it, vi } from 'vitest';
import type { TMessage } from '@/common/chat/chatLib';
import { collectDocumentEvidence } from '@/renderer/pages/conversation/Messages/DocumentResults/discoverDocuments';
import {
  discoverDocuments,
  isDocumentReferenced,
} from '@/renderer/pages/conversation/Messages/DocumentResults/discoverDocuments';

const file = (relativePath: string) => ({
  name: relativePath.split('/').pop()!,
  relativePath,
  fullPath: `/work/${relativePath}`,
});

describe('discoverDocuments', () => {
  it('does not match filename substrings or the same name in another directory', () => {
    expect(isDocumentReferenced(file('report.docx'), 'final-report.docx', '')).toBe(false);
    expect(isDocumentReferenced(file('report.docx'), 'report.docx', 'old-report.docx')).toBe(true);
    expect(isDocumentReferenced(file('a/report.docx'), '/work/b/report.docx', '')).toBe(false);
    expect(isDocumentReferenced(file('a/report.docx'), '`/work/a/report.docx`', '')).toBe(true);
  });
  it('does not mistake a requested output name for an input attachment', () => {
    const evidence = collectDocumentEvidence([
      { id: 'u', conversation_id: 'a', type: 'text', position: 'right', content: { content: 'Create report.xlsx' } },
      {
        id: 'r',
        conversation_id: 'a',
        type: 'tool_call',
        position: 'left',
        content: { call_id: 'r', name: 'Read', status: 'completed', args: { file_path: '/work/sales.csv' } },
      },
      {
        id: 'a',
        conversation_id: 'a',
        type: 'text',
        position: 'left',
        content: { content: 'Created report.xlsx from sales.csv' },
      },
    ]);
    expect(isDocumentReferenced(file('report.xlsx'), evidence.references, evidence.inputs)).toBe(true);
    expect(isDocumentReferenced(file('sales.csv'), evidence.references, evidence.inputs)).toBe(false);
  });
  it('anchors generated documents to the final assistant message in the producing turn', () => {
    const evidence = collectDocumentEvidence([
      {
        id: 'user-1',
        conversation_id: 'a',
        type: 'text',
        position: 'right',
        created_at: 100,
        content: { content: 'Create report.docx' },
      },
      {
        id: 'write-1',
        conversation_id: 'a',
        type: 'tool_call',
        position: 'left',
        created_at: 110,
        content: { call_id: 'w', name: 'Write', status: 'completed', args: { file_path: '/work/report.docx' } },
      },
      {
        id: 'answer-1',
        conversation_id: 'a',
        type: 'text',
        position: 'left',
        created_at: 120,
        content: { content: '已生成 report.docx' },
      },
      {
        id: 'user-2',
        conversation_id: 'a',
        type: 'text',
        position: 'right',
        created_at: 200,
        content: { content: '谢谢' },
      },
      {
        id: 'answer-2',
        conversation_id: 'a',
        type: 'text',
        position: 'left',
        created_at: 210,
        content: { content: '不客气。' },
      },
    ] as TMessage[]);

    expect(evidence.groups).toEqual([
      {
        anchorMessageId: 'answer-1',
        since: 100,
        references: '/work/report.docx\n已生成 report.docx',
        inputs: '',
      },
    ]);
  });

  it('anchors tool-only document output to its write message', () => {
    const evidence = collectDocumentEvidence([
      {
        id: 'user-1',
        conversation_id: 'a',
        type: 'text',
        position: 'right',
        created_at: 100,
        content: { content: 'Create report.docx' },
      },
      {
        id: 'write-1',
        conversation_id: 'a',
        type: 'tool_call',
        position: 'left',
        created_at: 110,
        content: { call_id: 'w', name: 'Write', status: 'completed', args: { file_path: '/work/report.docx' } },
      },
    ] as TMessage[]);

    expect(evidence.groups.map(({ anchorMessageId }) => anchorMessageId)).toEqual(['write-1']);
  });
  it('requires an explicit document reference and excludes named input material', () => {
    expect(isDocumentReferenced(file('report.xlsx'), 'Created report.xlsx', 'Read sales.csv')).toBe(true);
    expect(isDocumentReferenced(file('sales.csv'), 'Read sales.csv', 'Read sales.csv')).toBe(false);
    expect(isDocumentReferenced(file('other.pdf'), 'Created report.xlsx', '')).toBe(false);
  });
  it('verifies real Office and PDF files, preserving spaces and Unicode names', async () => {
    const metadata = vi.fn().mockResolvedValue({ size: 100, lastModified: 200, isDirectory: false });
    const result = await discoverDocuments(
      '/work',
      150,
      [file('报告 one.docx'), file('slides.PPTX'), file('sheet.xlsx'), file('read.pdf'), file('script.py')],
      metadata
    );
    expect(result.map((entry) => entry.name)).toEqual(['read.pdf', 'sheet.xlsx', 'slides.PPTX', '报告 one.docx']);
    expect(metadata).toHaveBeenCalledTimes(4);
  });

  it('excludes old, empty, missing and duplicate files without hiding valid results', async () => {
    const metadata = vi.fn(async (path: string) => {
      if (path.endsWith('missing.pdf')) throw new Error('not found');
      return { size: path.endsWith('empty.pdf') ? 0 : 10, lastModified: path.endsWith('old.pdf') ? 50 : 200 };
    });
    const result = await discoverDocuments(
      '/work',
      150,
      ['old.pdf', 'empty.pdf', 'missing.pdf', 'ok.pdf', 'ok.pdf'].map(file),
      metadata
    );
    expect(result.map((entry) => entry.name)).toEqual(['ok.pdf']);
    expect(metadata).toHaveBeenCalledTimes(4);
  });

  it('rejects traversal and paths outside the workspace before metadata requests', async () => {
    const metadata = vi.fn();
    const result = await discoverDocuments(
      '/work',
      150,
      [file('../secret.pdf'), { ...file('other.pdf'), fullPath: '/work-other/other.pdf' }],
      metadata
    );
    expect(result).toEqual([]);
    expect(metadata).not.toHaveBeenCalled();
  });

  it('does not scan without a conversation timestamp', async () => {
    const metadata = vi.fn();
    expect(await discoverDocuments('/work', 0, [file('a.pdf')], metadata)).toEqual([]);
    expect(metadata).not.toHaveBeenCalled();
  });
});
