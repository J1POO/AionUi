import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DocumentResults from '@/renderer/pages/conversation/Messages/DocumentResults';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  metadata: vi.fn(),
  preview: vi.fn(),
  download: vi.fn(),
  open: vi.fn(),
  error: vi.fn(),
  desktop: vi.fn(),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      listWorkspaceFiles: { invoke: mocks.list },
      getContentMetadata: { invoke: mocks.metadata },
      openSystem: { invoke: mocks.open },
    },
  },
}));
vi.mock('@/renderer/pages/conversation/Preview/hooks/useLocalFilePreview', () => ({
  useLocalFilePreview: () => mocks.preview,
}));
vi.mock('@/renderer/utils/file/download', () => ({ downloadFileFromRef: mocks.download }));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: mocks.desktop }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@icon-park/react', () => ({ FileText: () => <span /> }));
vi.mock('@arco-design/web-react', () => ({
  Button: ({
    children,
    loading: _loading,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) => <button {...props}>{children}</button>,
  Message: { error: mocks.error },
}));

const props = {
  conversationId: 'a',
  workspace: '/work',
  since: 100,
  revision: 'done',
  isProcessing: false,
  references: '报告 one.docx',
  inputs: '',
};
describe('DocumentResults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.desktop.mockReturnValue(true);
    mocks.list.mockResolvedValue([
      { name: '报告 one.docx', fullPath: '/work/报告 one.docx', relativePath: '报告 one.docx' },
    ]);
    mocks.metadata.mockResolvedValue({ size: 200, lastModified: 150 });
    mocks.download.mockResolvedValue(undefined);
    mocks.open.mockResolvedValue(undefined);
  });

  it('opens verified document cards in preview and offers original download and desktop open', async () => {
    render(<DocumentResults {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: '报告 one.docx' }));
    expect(mocks.preview).toHaveBeenCalledWith('/work/报告 one.docx');
    fireEvent.click(screen.getByRole('button', { name: 'common.download' }));
    await waitFor(() =>
      expect(mocks.download).toHaveBeenCalledWith({ kind: 'local', path: '/work/报告 one.docx' }, '报告 one.docx')
    );
    fireEvent.click(screen.getByRole('button', { name: 'preview.openInSystemApp' }));
    await waitFor(() =>
      expect(mocks.open).toHaveBeenCalledWith({ file: { kind: 'local', path: '/work/报告 one.docx' } })
    );
  });

  it('does not expose server system-open to Web users and reports download errors', async () => {
    mocks.desktop.mockReturnValue(false);
    mocks.download.mockRejectedValue(new Error('missing'));
    render(<DocumentResults {...props} />);
    await screen.findByRole('button', { name: '报告 one.docx' });
    expect(screen.queryByRole('button', { name: 'preview.openInSystemApp' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'common.download' }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('messages.downloadFailed'));
  });

  it('does not list documents during execution', () => {
    render(<DocumentResults {...props} isProcessing />);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('clears old conversation results and ignores a late response', async () => {
    let resolve!: (files: []) => void;
    mocks.list.mockReturnValueOnce(
      new Promise<[]>((done) => {
        resolve = done;
      })
    );
    const view = render(<DocumentResults {...props} />);
    view.rerender(<DocumentResults {...props} conversationId='b' workspace='/other' />);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    resolve([]);
    await waitFor(() => expect(screen.queryByText('报告 one.docx')).toBeNull());
  });
});
