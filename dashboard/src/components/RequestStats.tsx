'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { BarChart3, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { apiService, RequestStats as RequestStatsType } from '../services/api';
import { useRefresh } from '../hooks/useRefreshContext';

interface RequestStatsProps {
  className?: string;
}

export function RequestStats({ className }: RequestStatsProps) {
  const [stats, setStats] = useState<RequestStatsType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { onRefresh } = useRefresh();

  const fetchStats = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiService.getRequestStats();
      setStats(data);
    } catch (err) {
      setError('Failed to fetch stats');
      console.error('Failed to fetch request stats:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  // Listen for refresh events from other components
  useEffect(() => {
    const cleanup = onRefresh(fetchStats);
    return cleanup;
  }, [onRefresh]);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    if (isNaN(bytes) || !isFinite(bytes)) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getSuccessRate = (): number => {
    if (!stats || stats.total_requests === 0) return 0;
    const rate = (stats.success_count / stats.total_requests) * 100;
    return isNaN(rate) ? 0 : rate;
  };

  const safeFormatDuration = (microseconds: number): string => {
    if (isNaN(microseconds) || !isFinite(microseconds)) return '0ms';
    return (microseconds / 1000).toFixed(1) + 'ms';
  };

  if (!stats && !isLoading && !error) return null;

  return (
    <Card className={className}>
      {stats && <p className="px-3 py-2 text-xs text-muted-foreground">
        Retained: {stats.total_requests} / {stats.capacity}. Transfer counts, not HTTP success.
      </p>}
      <CardHeader className="pb-0 pt-2 px-3">
        <CardTitle className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-1">
            <BarChart3 className="h-4 w-4" />
            <span>Request Statistics</span>
          </div>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={fetchStats}
                  disabled={isLoading}
                  className="h-6 w-6 p-0"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh statistics</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {error && stats && <p role="alert" className="text-red-700">{error}. Showing stale results; retry Refresh.</p>}
        {error && !stats ? (
          <div className="text-center text-sm text-muted-foreground">
            <p className="text-red-500">{error}</p>
            <Button variant="outline" size="sm" onClick={fetchStats} className="mt-2">
              Retry
            </Button>
          </div>
        ) : isLoading && !stats ? (
          <div className="text-center text-sm text-muted-foreground">
            <div className="animate-pulse">Loading stats...</div>
          </div>
        ) : stats ? (
          <div className="space-y-2">
            {/* Request counts */}
            <div className="grid grid-cols-2 gap-1.5">
              <div className="flex items-center gap-1.5">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <div>
                  <div className="text-xs text-muted-foreground">Complete</div>
                  <div className="text-sm font-medium">{stats.success_count}</div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <XCircle className="h-4 w-4 text-red-500" />
                <div>
                  <div className="text-xs text-muted-foreground">Incomplete</div>
                  <div className="text-sm font-medium">{stats.error_count}</div>
                </div>
              </div>
            </div>

            {/* Success rate */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Transfer Completion</span>
              <Badge 
                variant="secondary"
                className={getSuccessRate() >= 90 ? 'bg-green-100 text-green-800' : 
                          getSuccessRate() >= 70 ? 'bg-yellow-100 text-yellow-800' : 
                          'bg-red-100 text-red-800'}
              >
                {stats.total_requests ? `${getSuccessRate().toFixed(1)}%` : '—'}
              </Badge>
            </div>

            {/* Timing stats */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Avg Duration</span>
                <span className="text-xs font-medium">{stats.total_requests ? safeFormatDuration(stats.avg_duration_us) : '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Avg to headers/attempt</span>
                <span className="text-xs font-medium">{stats.total_requests ? safeFormatDuration(stats.avg_upstream_latency_us) : '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Avg other elapsed</span>
                <span className="text-xs font-medium">{stats.total_requests ? safeFormatDuration(stats.avg_proxy_overhead_us) : '—'}</span>
              </div>
            </div>

            {/* Data transfer */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Request bytes</span>
                <span className="text-xs font-medium">{formatBytes(stats.total_request_size)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Response bytes</span>
                <span className="text-xs font-medium">{formatBytes(stats.total_response_size)}</span>
              </div>
            </div>

            {/* Top status codes */}
            {stats.status_codes && Object.keys(stats.status_codes).length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Status Codes</div>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(stats.status_codes)
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 3)
                    .map(([code, count]) => (
                      <Badge key={code} variant="outline" className="text-xs">
                        {code}: {count}
                      </Badge>
                    ))}
                </div>
              </div>
            )}

            {/* Top methods */}
            {stats.methods && Object.keys(stats.methods).length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Methods</div>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(stats.methods)
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 4)
                    .map(([method, count]) => (
                      <Badge key={method} variant="outline" className="text-xs">
                        {method}: {count}
                      </Badge>
                    ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center text-sm text-muted-foreground">
            No statistics available
          </div>
        )}
      </CardContent>
    </Card>
  );
} 