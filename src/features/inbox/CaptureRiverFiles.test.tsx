import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { CaptureRiver } from './CaptureRiver';
import type { CaptureSummary } from './useCaptureList';

const base = {
  content: null,
  created_at: new Date().toISOString(),
  is_favorite: false,
  kind: 'file',
  source_url: null,
};

function renderRiver(captures: CaptureSummary[]) {
  render(
    <MemoryRouter>
      <CaptureRiver
        captures={captures}
        isBusy={false}
        onToggleFavorite={() => undefined}
        status="inbox"
        thumbnails={{}}
      />
    </MemoryRouter>,
  );
}

describe('file captures in the list', () => {
  it('names an untitled file capture after its first file and sums the sizes', () => {
    renderRiver([
      {
        ...base,
        attachments: [
          {
            created_at: '2026-11-16T10:00:00.000Z',
            mime_type: 'application/pdf',
            original_name: 'Contract.pdf',
            size_bytes: 1_048_576,
            storage_path: 'u/a/1.pdf',
          },
          {
            created_at: '2026-11-16T10:00:00.001Z',
            mime_type: 'application/zip',
            original_name: 'scans.zip',
            size_bytes: 3_145_728,
            storage_path: 'u/a/2.zip',
          },
        ],
        id: 'file-1',
        title: null,
      },
    ]);

    const row = screen.getByRole('link', { name: 'Open Contract.pdf' });
    expect(within(row).getByRole('heading', { name: 'Contract.pdf' })).toBeVisible();
    expect(within(row).getByText('+1 more · 4 MB')).toBeVisible();
    expect(within(row).getByText('file')).toBeVisible();
  });

  it('keeps a given title and lists the file under it', () => {
    renderRiver([
      {
        ...base,
        attachments: [
          {
            created_at: '2026-11-16T10:00:00.000Z',
            mime_type: 'application/vnd.android.package-archive',
            original_name: 'second-brain.apk',
            size_bytes: 8_388_608,
            storage_path: 'u/a/1.apk',
          },
        ],
        id: 'file-2',
        title: 'Latest build',
      },
    ]);

    const row = screen.getByRole('link', { name: 'Open Latest build' });
    expect(within(row).getByText('second-brain.apk · 8 MB')).toBeVisible();
  });

  it('copes with a capture whose files are missing', () => {
    renderRiver([{ ...base, attachments: [], id: 'file-3', title: null }]);

    expect(screen.getByRole('link', { name: 'Open Untitled file' })).toBeVisible();
  });
});
