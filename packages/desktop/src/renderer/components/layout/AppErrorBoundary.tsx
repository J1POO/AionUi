import { Button, Result } from '@arco-design/web-react';
import type { TFunction } from 'i18next';
import React from 'react';
import { useTranslation } from 'react-i18next';

type BoundaryProps = React.PropsWithChildren<{ t: TFunction }>;

type BoundaryState = {
  error: Error | null;
};

/**
 * Last-resort renderer guard: without it a render error unmounts the whole
 * React tree and leaves an empty white window with no way back.
 */
class Boundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[AppErrorBoundary] render error:', error, info.componentStack);
  }

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const { t } = this.props;
    return (
      <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Result
          status='error'
          title={t('common.errorBoundary.title')}
          subTitle={t('common.errorBoundary.description')}
          extra={
            <Button type='primary' onClick={() => window.location.reload()}>
              {t('common.errorBoundary.reload')}
            </Button>
          }
        >
          <pre
            style={{
              maxHeight: 240,
              overflow: 'auto',
              padding: 12,
              borderRadius: 6,
              background: 'var(--color-fill-2, #f2f3f5)',
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {error.stack || error.message}
          </pre>
        </Result>
      </div>
    );
  }
}

const AppErrorBoundary: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { t } = useTranslation();
  return <Boundary t={t}>{children}</Boundary>;
};

export default AppErrorBoundary;
