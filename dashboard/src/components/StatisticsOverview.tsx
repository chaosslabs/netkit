'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { 
  BarChart3, 
  CheckCircle, 
  XCircle, 
  RefreshCw, 
  Clock,
  Database,
  TrendingUp,
  Activity,
  Globe,
  Zap,
  AlertTriangle
} from 'lucide-react';
import { apiService, RequestStats as RequestStatsType } from '../services/api';
import { useRefresh } from '../hooks/useRefreshContext';
import { formatDistanceToNow } from 'date-fns';

export function StatisticsOverview() {
  const [stats, setStats] = useState<RequestStatsType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const { onRefresh } = useRefresh();

  const fetchStats = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiService.getRequestStats();
      setStats(data);
      setLastRefresh(new Date());
    } catch (err) {
      setError('Failed to fetch statistics');
      console.error('Failed to fetch request stats:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  useEffect(() => {
    const cleanup = onRefresh(fetchStats);
    return cleanup;
  }, [onRefresh]);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDuration = (microseconds: number): string => {
    if (microseconds < 1000) return `${microseconds}μs`;
    if (microseconds < 1000000) return `${(microseconds / 1000).toFixed(1)}ms`;
    return `${(microseconds / 1000000).toFixed(2)}s`;
  };

  const getSuccessRate = (): number => {
    if (!stats || stats.total_requests === 0) return 0;
    const rate = (stats.success_count / stats.total_requests) * 100;
    return isNaN(rate) ? 0 : rate;
  };

  const getErrorRate = (): number => {
    if (!stats || stats.total_requests === 0) return 0;
    const rate = (stats.error_count / stats.total_requests) * 100;
    return isNaN(rate) ? 0 : rate;
  };

  const getProxyOverheadPercentage = (): number => {
    if (!stats || stats.avg_duration_us === 0) return 0;
    const percentage = (stats.avg_proxy_overhead_us / stats.avg_duration_us) * 100;
    return isNaN(percentage) ? 0 : percentage;
  };

  const getStatusCodePercentage = (count: number): number => {
    if (!stats || stats.total_requests === 0) return 0;
    const percentage = (count / stats.total_requests) * 100;
    return isNaN(percentage) ? 0 : percentage;
  };

  const getMethodPercentage = (count: number): number => {
    if (!stats || stats.total_requests === 0) return 0;
    const percentage = (count / stats.total_requests) * 100;
    return isNaN(percentage) ? 0 : percentage;
  };

  const safeFormatDuration = (microseconds: number): string => {
    if (isNaN(microseconds) || !isFinite(microseconds)) return '0ms';
    return formatDuration(microseconds);
  };

  const safeFormatBytes = (bytes: number): string => {
    if (isNaN(bytes) || !isFinite(bytes)) return '0 B';
    return formatBytes(bytes);
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

  const getStatusColor = (statusCode: string) => {
    const code = parseInt(statusCode);
    if (code >= 200 && code < 300) return 'bg-green-100 text-green-800';
    if (code >= 300 && code < 400) return 'bg-blue-100 text-blue-800';
    if (code >= 400 && code < 500) return 'bg-yellow-100 text-yellow-800';
    if (code >= 500) return 'bg-red-100 text-red-800';
    return 'bg-gray-100 text-gray-800';
  };

  const getSuccessRateColor = (rate: number) => {
    if (rate >= 95) return 'text-green-600';
    if (rate >= 90) return 'text-green-500';
    if (rate >= 80) return 'text-yellow-500';
    if (rate >= 70) return 'text-orange-500';
    return 'text-red-500';
  };

  if (error && !stats) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                <span>Statistics Error</span>
              </div>
              <Button variant="outline" size="sm" onClick={fetchStats}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-red-600">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && <p role="alert" className="text-red-700">{error}. Showing stale results; retry Refresh.</p>}
      {stats && <p className="px-3 py-2 text-xs text-muted-foreground">
        Retained buffer: {stats.total_requests} / {stats.capacity} records. {stats.oldest_at && stats.newest_at ? `${new Date(stats.oldest_at).toLocaleString()} – ${new Date(stats.newest_at).toLocaleString()}.` : 'No captured time window.'}
        {' '}Completion counts transfers (including tunnel establishment), not HTTP success. Other elapsed time includes body transfer, not pure proxy overhead.
      </p>}
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              <span>Statistics</span>
              {stats && (
                <Badge variant="outline">{stats.total_requests} total requests</Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {lastRefresh && (
                <span className="text-sm text-muted-foreground">
                  Updated {formatDistanceToNow(lastRefresh, { addSuffix: true })}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={fetchStats}
                disabled={isLoading}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
      </Card>

      {isLoading && !stats ? (
        <Card>
          <CardContent className="p-8">
            <div className="text-center">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-muted-foreground">Loading statistics...</p>
            </div>
          </CardContent>
        </Card>
      ) : !stats ? (
        <Card>
          <CardContent className="p-8">
            <div className="text-center text-muted-foreground">
              <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">No statistics available</p>
              <p className="text-sm">Make some requests through the proxy to see statistics</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Overview Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Requests</p>
                    <p className="text-3xl font-bold">{stats.total_requests}</p>
                  </div>
                  <Activity className="h-8 w-8 text-blue-500" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Transfer Completion</p>
                    <p className={`text-3xl font-bold ${getSuccessRateColor(getSuccessRate())}`}>
                      {stats.total_requests ? `${getSuccessRate().toFixed(1)}%` : '—'}
                    </p>
                  </div>
                  <CheckCircle className="h-8 w-8 text-green-500" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Avg Duration</p>
                    <p className="text-3xl font-bold">{stats.total_requests ? safeFormatDuration(stats.avg_duration_us) : '—'}</p>
                  </div>
                  <Clock className="h-8 w-8 text-orange-500" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Data</p>
                    <p className="text-3xl font-bold">
                      {safeFormatBytes(stats.total_request_size + stats.total_response_size)}
                    </p>
                  </div>
                  <Database className="h-8 w-8 text-purple-500" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Success/Error Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Request Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <CheckCircle className="h-8 w-8 text-green-500" />
                      <div>
                        <p className="font-medium">Completed Transfers</p>
                        <p className="text-sm text-muted-foreground">
                          {stats.total_requests ? `${getSuccessRate().toFixed(1)}%` : '—'} transfer completion
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-green-600">{stats.success_count}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-red-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <XCircle className="h-8 w-8 text-red-500" />
                      <div>
                        <p className="font-medium">Incomplete Transfers</p>
                        <p className="text-sm text-muted-foreground">
                          {stats.total_requests ? `${getErrorRate().toFixed(1)}%` : '—'} incomplete transfers
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-red-600">{stats.error_count}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  Performance Metrics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Average Total Duration</span>
                    <span className="font-mono text-sm">{stats.total_requests ? safeFormatDuration(stats.avg_duration_us) : '—'}</span>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Average time to headers / attempt end</span>
                    <span className="font-mono text-sm">{stats.total_requests ? safeFormatDuration(stats.avg_upstream_latency_us) : '—'}</span>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Average other elapsed time</span>
                    <span className="font-mono text-sm">{stats.total_requests ? safeFormatDuration(stats.avg_proxy_overhead_us) : '—'}</span>
                  </div>

                  <div className="pt-2 border-t">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Other elapsed percentage</span>
                      <span>
                        {stats.total_requests ? `${getProxyOverheadPercentage().toFixed(1)}%` : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Data Transfer */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Data Transfer
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="text-center p-4 bg-blue-50 rounded-lg">
                  <p className="text-sm font-medium text-muted-foreground">Total Request Data</p>
                  <p className="text-2xl font-bold text-blue-600">{safeFormatBytes(stats.total_request_size)}</p>
                </div>
                
                <div className="text-center p-4 bg-green-50 rounded-lg">
                  <p className="text-sm font-medium text-muted-foreground">Total Response Data</p>
                  <p className="text-2xl font-bold text-green-600">{safeFormatBytes(stats.total_response_size)}</p>
                </div>
                
                <div className="text-center p-4 bg-purple-50 rounded-lg">
                  <p className="text-sm font-medium text-muted-foreground">Combined Total</p>
                  <p className="text-2xl font-bold text-purple-600">
                    {safeFormatBytes(stats.total_request_size + stats.total_response_size)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Status Codes and Methods */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {stats.status_codes && Object.keys(stats.status_codes).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Globe className="h-5 w-5" />
                    Upstream HTTP Status Distribution
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {Object.entries(stats.status_codes)
                      .sort(([,a], [,b]) => b - a)
                      .map(([code, count]) => (
                        <div key={code} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge className={getStatusColor(code)} variant="secondary">
                              {code}
                            </Badge>
                            <span className="text-sm font-medium">HTTP {code}</span>
                          </div>
                          <div className="text-right">
                            <span className="font-mono text-sm">{count}</span>
                            <span className="text-xs text-muted-foreground ml-2">
                              ({getStatusCodePercentage(count).toFixed(1)}%)
                            </span>
                          </div>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {stats.methods && Object.keys(stats.methods).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    HTTP Methods Distribution
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {Object.entries(stats.methods)
                      .sort(([,a], [,b]) => b - a)
                      .map(([method, count]) => (
                        <div key={method} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge className={getMethodColor(method)} variant="secondary">
                              {method}
                            </Badge>
                            <span className="text-sm font-medium">{method}</span>
                          </div>
                          <div className="text-right">
                            <span className="font-mono text-sm">{count}</span>
                            <span className="text-xs text-muted-foreground ml-2">
                              ({getMethodPercentage(count).toFixed(1)}%)
                            </span>
                          </div>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
} 