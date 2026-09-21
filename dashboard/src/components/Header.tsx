'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ShieldCheck, Zap } from 'lucide-react';
import { apiService } from '../services/api';
import { cn } from '../lib/utils';

export function Header() {
  const [info, setInfo] = useState<{ capture_mode: string; history_capacity: number } | null>(null);
  const [status, setStatus] = useState('Checking connection');
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [now, setNow] = useState(Date.now());
  const [storageWarning, setStorageWarning] = useState(false);
  const pathname = usePathname().replace(/\/$/, '') || '/';
  useEffect(() => {
    try { localStorage.removeItem('fetchr-request-store'); } catch { setStorageWarning(true); }
    let active = true;
    const check = async () => {
      try {
        const result = await apiService.getCaptureInfo();
        if (active) { setInfo(result); setStatus('Connected'); }
      } catch { if (active) setStatus('Disconnected'); }
      finally { if (active) setCheckedAt(new Date()); }
    };
    void check();
    const poll = setInterval(check, 30000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { active = false; clearInterval(poll); clearInterval(clock); };
  }, []);
  return <header className="border-b bg-background">
    <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
      <Link href="/" className="flex items-center gap-2 font-bold text-xl"><Zap className="h-6 w-6" />netkit</Link>
      <nav aria-label="Main navigation" className="flex flex-wrap gap-1">
        {[['/', 'Request builder'], ['/requests-history', 'Traffic'], ['/requests-statistics', 'Statistics']].map(([href, label]) => <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined} className={cn('rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-muted', pathname === href ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'text-muted-foreground')}>{label}</Link>)}
      </nav>
      <div className="flex items-center gap-2 text-xs" title="Admin API reachability; checked every 30 seconds. Traffic refresh is manual.">
        <span className={cn('h-2 w-2 rounded-full', status === 'Connected' ? 'bg-emerald-500' : status === 'Disconnected' ? 'bg-red-500' : 'bg-amber-500')} />
        <span className="font-medium">{status}</span>
        {checkedAt && <span className="text-muted-foreground">· checked {Math.max(0, Math.floor((now - checkedAt.getTime()) / 1000))}s ago</span>}
      </div>
    </div>
    <div className="flex flex-wrap items-start justify-between gap-3 border-t bg-muted/30 px-6 py-3 text-xs">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground">
        <span className="font-medium text-foreground">{info ? (info.capture_mode === 'http_and_https_inspection' ? 'HTTP + HTTPS inspection' : 'HTTP inspection · HTTPS tunnels') : 'Capture scope unavailable'}</span>
        {info && <span>{info.history_capacity.toLocaleString()} record capacity · in memory</span>}
        <span className="flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" />Sensitive fields masked</span>
      </div>
      <details className="max-w-xl text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">Capture policy & connection</summary>
        <div className="mt-3 space-y-2 leading-relaxed">
          <p>Only complete JSON bodies up to 64 KiB are retained. Masking follows configured field names and patterns; unfamiliar secrets may need custom fields.</p>
          <p>History is lost on restart. Drafts stay in this tab. Traffic refresh is manual.</p>
          <p>{info?.capture_mode === 'http_and_https_inspection' ? 'Protocol upgrades are unsupported.' : 'HTTPS tunnel contents are encrypted and unavailable for inspection.'}{status === 'Disconnected' && info ? ' Capture configuration shown is from the last successful check.' : ''}</p>
          <p className="break-all">Proxy: {apiService.getProxyDisplayAddress()}<br />Admin API: {apiService.getAdminDisplayAddress()}</p>
        </div>
      </details>
      {storageWarning && <p role="alert" className="w-full text-red-700">Unable to remove older saved drafts. Clear this site’s storage in your browser.</p>}
    </div>
  </header>;
}
