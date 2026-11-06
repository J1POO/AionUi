import { ipcBridge } from '@/common';
import { getConfiguredRemoteCoreUrl } from '@/common/adapter/backendEndpoint';
import { localFileRef } from '@/common/types/chatFile';
import { useLocalFilePreview } from '@/renderer/pages/conversation/Preview/hooks/useLocalFilePreview';
import { downloadFileFromRef } from '@/renderer/utils/file/download';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { Button, Message } from '@arco-design/web-react';
import { FileText } from '@icon-park/react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  discoverDocuments,
  isDocumentReferenced,
  isExplicitlySent,
  type DocumentResult,
} from './discoverDocuments';

type Props = {
  conversationId: string;
  workspace?: string;
  since: number;
  revision: string;
  isProcessing: boolean;
  references: string;
  inputs: string;
  explicitPaths: string[];
  kind?: 'generated' | 'uploaded' | 'mixed';
};

/** Verified document results, including binary files produced by shell tools. */
const DocumentResults: React.FC<Props> = ({
  conversationId,
  workspace,
  since,
  revision,
  isProcessing,
  references,
  inputs,
  explicitPaths,
  kind = 'generated',
}) => {
  const { t } = useTranslation();
  const titleKey =
    kind === 'uploaded'
      ? 'messages.documentResults.uploadedTitle'
      : kind === 'mixed'
        ? 'messages.documentResults.mixedTitle'
        : 'messages.documentResults.title';
  const preview = useLocalFilePreview(workspace);
  const [snapshot, setSnapshot] = useState<{ owner: string; files: DocumentResult[] }>({ owner: '', files: [] });
  const [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [busyPath, setBusyPath] = useState<string>();
  const owner = `${conversationId}:${workspace ?? ''}`;
  const files = snapshot.owner === owner ? snapshot.files : [];

  useEffect(() => {
    let active = true;
    setFailed(false);
    if (!workspace || !Number.isFinite(since) || since <= 0 || isProcessing) return;
    void (async () => {
      try {
        const listed = await ipcBridge.fs.listWorkspaceFiles.invoke({ root: workspace });
        const verified = await discoverDocuments(
          workspace,
          since,
          listed.filter(
            (file) => isDocumentReferenced(file, references, inputs) || isExplicitlySent(file, explicitPaths)
          ),
          (path) => ipcBridge.fs.getContentMetadata.invoke({ file: localFileRef(path) }),
          explicitPaths
        );
        if (active) setSnapshot({ owner, files: verified });
      } catch {
        if (active) setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [owner, workspace, since, revision, isProcessing, refresh, references, inputs, explicitPaths]);

  const perform = async (file: DocumentResult, action: 'download' | 'open'): Promise<void> => {
    setBusyPath(file.fullPath);
    try {
      const ref = localFileRef(file.fullPath);
      if (action === 'download') await downloadFileFromRef(ref, file.name);
      else await ipcBridge.fs.openSystem.invoke({ file: ref });
    } catch {
      Message.error(t(action === 'download' ? 'messages.downloadFailed' : 'preview.openInSystemFailed'));
    } finally {
      setBusyPath(undefined);
    }
  };

  if (!files.length && !failed) return null;
  return (
    <section
      className='my-12px flex flex-col gap-8px'
      aria-label={t(titleKey)}
      data-testid='document-results'
    >
      <div className='flex items-center justify-between text-t-secondary text-12px'>
        <span>{t(titleKey)}</span>
        <Button type='text' size='mini' onClick={() => setRefresh((value) => value + 1)} disabled={isProcessing}>
          {t('common.refresh')}
        </Button>
      </div>
      {failed && (
        <span role='alert' className='text-t-secondary text-12px'>
          {t('messages.documentResults.loadFailed')}
        </span>
      )}
      {files.map((file) => (
        <div
          key={file.fullPath}
          className='flex flex-col gap-8px p-12px rd-8px border-1 border-solid border-base bg-base min-w-0'
        >
          <div className='flex items-center gap-8px min-w-0'>
            <FileText size='24' className='text-t-secondary flex-shrink-0' />
            <Button
              type='text'
              className='min-w-0 flex-1 !text-left !overflow-hidden'
              onClick={() => void preview(file.fullPath)}
              title={file.name}
            >
              <span className='block truncate min-w-0'>{file.name}</span>
            </Button>
            <span className='text-12px text-t-secondary flex-shrink-0'>
              {Math.max(1, Math.ceil(file.size / 1024))} KB
            </span>
          </div>
          <div className='flex flex-wrap items-center gap-8px'>
            <Button size='mini' loading={busyPath === file.fullPath} onClick={() => void perform(file, 'download')}>
              {t('common.download')}
            </Button>
            {isElectronDesktop() && !getConfiguredRemoteCoreUrl() && (
              <Button size='mini' disabled={busyPath === file.fullPath} onClick={() => void perform(file, 'open')}>
                {t('preview.openInSystemApp')}
              </Button>
            )}
          </div>
        </div>
      ))}
    </section>
  );
};

export default DocumentResults;
