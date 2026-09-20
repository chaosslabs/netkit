'use client';

import { outcomeLabel } from '../lib/inspection';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { History, Copy, Server, RefreshCw } from 'lucide-react';
import { useRequestStore } from '../hooks/useRequestStore';
import { useRefresh } from '../hooks/useRefreshContext';
import { apiService, BackendRequestRecord } from '../services/api';
import { formatDistanceToNow } from 'date-fns';
import { HttpMethod } from '../types/api';

export function Sidebar() {
  const { 
    setMethod,
    setUrl,
    setHeaders,
    setBody,
  } = useRequestStore();

  const { onRefresh } = useRefresh();
  const [backendHistory, setBackendHistory] = useState<BackendRequestRecord[]>([]);
  const [isLoadingBackend, setIsLoadingBackend] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchBackendHistory = async () => {
    setIsLoadingBackend(true);
    setError(null);
    try {
      const records = await apiService.getRequestHistory();
      setBackendHistory(records);
      setLastRefresh(new Date());
    } catch {
      setError("Traffic unavailable. Retry refresh; any displayed records are stale.");
    } finally {
      setIsLoadingBackend(false);
    }
  };

  useEffect(() => {
    fetchBackendHistory();
  }, []);

  // Listen for refresh events from other components  
  useEffect(() => {
    const cleanup = onRefresh(fetchBackendHistory);
    return cleanup;
  }, [onRefresh]);

  const loadBackendHistoryItem = (item: BackendRequestRecord) => {
    setMethod(item.method as HttpMethod);
    setUrl(item.url);
    setBody(item.request_body || '');
    
    // Convert headers object back to HeaderPair array
    const headerPairs = Object.entries(item.request_headers || {}).map(([key, value]) => ({
      key,
      value: value as string,
      enabled: true,
    }));
    
    // Add an empty header pair at the end
    headerPairs.push({ key: '', value: '', enabled: true });
    
    setHeaders(headerPairs);
  };

  const getMethodColor = (method: string) => {
    switch (method) {
      case 'GET': return 'bg-green-100 text-green-800';
      case 'POST': return 'bg-blue-100 text-blue-800';
      case 'PUT': return 'bg-orange-100 text-orange-800';
      case 'DELETE': return 'bg-red-100 text-red-800';
      case 'PATCH': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const truncateUrl = (url: string, maxLength: number = 40) => {
    if (url.length <= maxLength) return url;
    return '...' + url.slice(-(maxLength - 3));
  };

  return (
    <div className="h-full bg-background flex flex-col">
      <Card className="h-full rounded-none border-0 flex flex-col">
        <CardHeader className="pb-0 pt-2 px-3 flex-shrink-0">
          <CardTitle className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-1">
              <History className="h-4 w-4" />
              <span>Requests History</span>
            </div>
            <div className="flex items-center gap-1">
              <Badge variant="outline" className="text-xs h-5 px-1.5">
                {lastRefresh ? backendHistory.length : '—'}
              </Badge>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      aria-label="Refresh traffic"
                      onClick={fetchBackendHistory}
                      disabled={isLoadingBackend}
                      className="h-6 w-6 p-0"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isLoadingBackend ? 'animate-spin' : ''}`} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Refresh requests history</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </CardTitle>
          {lastRefresh && (
            <p className="text-xs text-muted-foreground mt-0.5 leading-none">
              Last updated: {formatDistanceToNow(lastRefresh, { addSuffix: true })}
            </p>
          )}
        </CardHeader>
        <CardContent className="p-0 flex-1 flex flex-col min-h-0">
          {error && <p role="alert" className="p-2 text-xs text-red-700">{error}</p>}
          <div className="flex-1 min-h-0">
            <ScrollArea className="h-full">
              <div className="min-h-full">
                {backendHistory.length === 0 ? (
                  <div className="p-4 text-center text-muted-foreground">
                    <Server className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">{isLoadingBackend ? "Loading traffic…" : error ? "Traffic unavailable" : "No requests yet"}</p>
                    <p className="text-xs mt-1">{isLoadingBackend || error ? "" : "Requests through the proxy will appear here"}</p>
                  </div>
                ) : (
                  <div className="space-y-1.5 p-1.5 pb-2">
                    {backendHistory.map((item) => (
                      <div
                        key={item.id}
                        className="border rounded-lg p-2 hover:bg-muted/50 cursor-pointer transition-colors"
                        onClick={() => loadBackendHistoryItem(item)}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <Badge 
                            className={`text-xs ${getMethodColor(item.method)}`}
                            variant="secondary"
                          >
                            {item.method}
                          </Badge>
                          <div className="flex gap-1 items-center">
                            <Badge variant="secondary">{item.response_status || '—'} · {outcomeLabel(item)}</Badge>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-5 w-5 p-0"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigator.clipboard.writeText(item.url);
                                    }}
                                  >
                                    <Copy className="h-3 w-3" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Copy sanitized URL</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        </div>
                        
                        <div className="space-y-1">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <p className="text-sm font-medium truncate">
                                  {truncateUrl(item.url)}
                                </p>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="max-w-md break-all">{item.url}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>
                              {formatDistanceToNow(new Date(item.timestamp), { addSuffix: true })}
                            </span>
                            <div className="flex gap-2">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span>{(item.total_duration_us / 1000).toFixed(1)}ms</span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <div className="text-xs">
                                      <div>Total: {(item.total_duration_us / 1000).toFixed(1)}ms</div>
                                      <div>Upstream: {(item.upstream_latency_us / 1000).toFixed(1)}ms</div>
                                      <div>Proxy: {(item.proxy_overhead_us / 1000).toFixed(1)}ms</div>
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                          </div>
                          
                          {!item.success && item.error && (
                            <p className="text-xs text-red-600 truncate">
                              {item.error}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 