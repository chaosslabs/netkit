'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { Globe, Settings, Info, Zap, Home, Server, BarChart3 } from 'lucide-react';
import { apiService } from '../services/api';
import { cn } from '../lib/utils';

export function Header() {
  const [proxyStatus, setProxyStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [captureInfo, setCaptureInfo] = useState<{ capture_mode: string; history_capacity: number } | null>(null);
  const [storageWarning, setStorageWarning] = useState(false);
  const pathname = usePathname();
  const proxyAddress = apiService.getProxyDisplayAddress();
  const adminAddress = apiService.getAdminDisplayAddress();

  useEffect(() => {
    try { localStorage.removeItem('fetchr-request-store'); } catch { setStorageWarning(true); }
    const checkProxyStatus = async () => {
      try {
        const info = await apiService.getCaptureInfo();
        setCaptureInfo(info);
        setProxyStatus('online');
      } catch {
        setProxyStatus('offline');
      }
    };

    checkProxyStatus();
    const interval = setInterval(checkProxyStatus, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, []);

  const getStatusBadge = () => {
    switch (proxyStatus) {
      case 'checking':
        return (
          <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
            <div className="w-2 h-2 bg-yellow-500 rounded-full mr-2 animate-pulse" />
            Checking...
          </Badge>
        );
      case 'online':
        return (
          <Badge variant="secondary" className="bg-green-100 text-green-800">
            <div className="w-2 h-2 bg-green-500 rounded-full mr-2" />
            API last check: reachable
          </Badge>
        );
      case 'offline':
        return (
          <Badge variant="secondary" className="bg-red-100 text-red-800">
            <div className="w-2 h-2 bg-red-500 rounded-full mr-2" />
            API last check: unreachable
          </Badge>
        );
    }
  };

  const navItems = [
    {
      href: '/',
      label: 'Request Builder',
      icon: Home,
      isActive: pathname === '/'
    },
    {
      href: '/requests-history',
      label: 'Requests History',
      icon: Server,
      isActive: pathname === '/requests-history'
    },
    {
      href: '/requests-statistics',
      label: 'Requests Statistics',
      icon: BarChart3,
      isActive: pathname === '/requests-statistics'
    }
  ];

  return (
    <header className="border-b bg-background">
      <div className="flex flex-wrap items-center justify-between min-h-16 px-6">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-8 h-8 bg-primary rounded-lg">
              <Zap className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold">netkit</h1>
              <p className="text-xs text-muted-foreground">HTTP Proxy Dashboard</p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex items-center gap-1">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href}>
                <Button
                  variant={item.isActive ? "default" : "ghost"}
                  size="sm"
                  className={cn(
                    "flex items-center gap-2",
                    item.isActive && "bg-primary text-primary-foreground"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Button>
              </Link>
            ))}
          </nav>
          
          <div className="flex items-center gap-2">
            {getStatusBadge()}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="text-xs">
                    <Globe className="h-3 w-3 mr-1" />
                    {proxyAddress}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Proxy Server Address</p>
                  <p className="text-xs text-muted-foreground">Configure your HTTP client to use this proxy when exposed</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="text-xs bg-blue-50">
                    {adminAddress}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Admin Server Port</p>
                  <p className="text-xs text-muted-foreground">Health checks and metrics endpoint</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm">
                  <Info className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <div className="max-w-sm">
                  <p className="font-medium">How to use:</p>
                  <ul className="text-xs mt-1 space-y-1">
                    <li>• Enter an API URL and click Send</li>
                    <li>• Configure headers and request body as needed</li>
                    <li>• View responses in real-time</li>
                    <li>• Access request history in the sidebar</li>
                  </ul>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm">
                  <Settings className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Settings (Coming Soon)</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
      <div className="border-t px-6 py-2 text-xs text-muted-foreground" role="status">
        {captureInfo ? <>
          {captureInfo.capture_mode === 'http_and_https_inspection' ? 'HTTP + HTTPS inspection; protocol upgrades unsupported' : 'HTTP inspection; HTTPS tunnels only (encrypted contents unavailable)'}
          {' · '}Last {captureInfo.history_capacity} records in memory; lost on restart. Traffic refresh is manual; API health checked every 30 s.
          {' · '}Sensitive fields masked; only complete JSON up to 64 KiB retained. Drafts stay in this tab.
        </> : 'Capture scope unavailable until the API responds.'}
        {storageWarning && <span role="alert"> Unable to remove older saved drafts. Clear this site’s storage in your browser.</span>}
      </div>
    </header>
  );
}
