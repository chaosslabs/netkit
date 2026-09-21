'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';

export function CaptureNotice({ lastRefresh, loading, onRetry }: { lastRefresh: Date | null; loading: boolean; onRetry: () => void }) {
  return <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950">
    <AlertTriangle className="h-5 w-5 shrink-0" />
    <div className="min-w-0 flex-1 text-sm">
      <p className="font-semibold">{lastRefresh ? 'Showing saved results · refresh failed' : 'Capture data unavailable'}</p>
      <p className="mt-1 text-xs">{lastRefresh ? `Last successful update: ${lastRefresh.toLocaleString()}. These results may be out of date.` : 'Check the API connection, then try again.'}</p>
    </div>
    <Button variant="outline" size="sm" onClick={onRetry} disabled={loading} className="bg-background text-foreground"><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Retry</Button>
  </div>;
}
