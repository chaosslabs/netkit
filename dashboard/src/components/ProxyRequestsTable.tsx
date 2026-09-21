'use client';

import { CaptureNotice } from './CaptureNotice';

import { outcomeLabel } from '../lib/inspection';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { ScrollArea } from './ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import {
  Server,
  RefreshCw,
  Search,
  Filter,
  Copy,
  Eye,
  ChevronDown,
  ChevronUp,
  Clock,
  Database,
  AlertCircle
} from 'lucide-react';
import { apiService, BackendRequestRecord } from '../services/api';
import { useRefresh } from '../hooks/useRefreshContext';
import { formatDistanceToNow } from 'date-fns';

type SortField = 'timestamp' | 'method' | 'url' | 'status' | 'duration' | 'size';
type SortDirection = 'asc' | 'desc';

interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

export function ProxyRequestsTable() {
  const [requests, setRequests] = useState<BackendRequestRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [methodFilter, setMethodFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    field: 'timestamp',
    direction: 'desc'
  });
  const [selectedRequest, setSelectedRequest] = useState<BackendRequestRecord | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const { onRefresh } = useRefresh();

  const fetchRequests = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const records = await apiService.getRequestHistory();
      setRequests(records);
      setLastRefresh(new Date());
    } catch {
      setError('Cannot refresh traffic. Check the API connection and retry.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, []);

  useEffect(() => {
    const cleanup = onRefresh(fetchRequests);
    return cleanup;
  }, [onRefresh]);

  // Filter and sort requests
  const filteredAndSortedRequests = useMemo(() => {
    const filtered = requests.filter(request => {
      const matchesSearch = searchTerm === '' ||
        request.url.toLowerCase().includes(searchTerm.toLowerCase()) ||
        request.method.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesMethod = methodFilter === 'all' || request.method === methodFilter;

      const matchesStatus = statusFilter === 'all' ||
        (statusFilter === 'success' && request.success) ||
        (statusFilter === 'error' && !request.success) ||
        (statusFilter === '2xx' && request.response_status >= 200 && request.response_status < 300) ||
        (statusFilter === '3xx' && request.response_status >= 300 && request.response_status < 400) ||
        (statusFilter === '4xx' && request.response_status >= 400 && request.response_status < 500) ||
        (statusFilter === '5xx' && request.response_status >= 500);

      return matchesSearch && matchesMethod && matchesStatus;
    });

    // Sort the filtered results
    filtered.sort((a, b) => {
      let aValue: string | number, bValue: string | number;

      switch (sortConfig.field) {
        case 'timestamp':
          aValue = new Date(a.timestamp).getTime();
          bValue = new Date(b.timestamp).getTime();
          break;
        case 'method':
          aValue = a.method;
          bValue = b.method;
          break;
        case 'url':
          aValue = a.url;
          bValue = b.url;
          break;
        case 'status':
          aValue = a.response_status;
          bValue = b.response_status;
          break;
        case 'duration':
          aValue = a.total_duration_us;
          bValue = b.total_duration_us;
          break;
        case 'size':
          aValue = a.request_size + a.response_size;
          bValue = b.request_size + b.response_size;
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [requests, searchTerm, methodFilter, statusFilter, sortConfig]);

  const handleSort = (field: SortField) => {
    setSortConfig(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
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

  const getStatusColor = (statusCode: number) => {
    if (statusCode >= 200 && statusCode < 300) return 'bg-green-100 text-green-800';
    if (statusCode >= 300 && statusCode < 400) return 'bg-blue-100 text-blue-800';
    if (statusCode >= 400 && statusCode < 500) return 'bg-yellow-100 text-yellow-800';
    if (statusCode >= 500) return 'bg-red-100 text-red-800';
    return 'bg-gray-100 text-gray-800';
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDuration = (microseconds: number) => {
    if (microseconds < 1000) return `${microseconds}μs`;
    if (microseconds < 1000000) return `${(microseconds / 1000).toFixed(1)}ms`;
    return `${(microseconds / 1000000).toFixed(2)}s`;
  };

  const SortButton = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <Button
      variant="ghost"
      className="h-8 p-0 font-medium hover:bg-transparent"
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center gap-1">
        {children}
        {sortConfig.field === field ? (
          sortConfig.direction === 'asc' ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )
        ) : (
          <div className="h-4 w-4" />
        )}
      </div>
    </Button>
  );

  const uniqueMethods = Array.from(new Set(requests.map(r => r.method)));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              <span>Requests History</span>
              <Badge variant="outline">{lastRefresh ? `${filteredAndSortedRequests.length} of ${requests.length}` : 'Not loaded'}</Badge>
            </div>
            <div className="flex items-center gap-2">
              {lastRefresh && (
                <span className="text-sm text-muted-foreground">
                  Updated {lastRefresh.toLocaleTimeString()}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={fetchRequests}
                disabled={isLoading}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <CaptureNotice lastRefresh={lastRefresh} loading={isLoading} onRetry={fetchRequests} />}
          {isLoading && <p role="status">Loading traffic…</p>}
          <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">How to read captured traffic</summary><p className="mt-2 max-w-2xl leading-relaxed">HTTP status describes the response. Transfer outcome describes whether the exchange finished. Duration includes response body transfer, polling, and streaming lifetime.</p></details>
          {/* Filters */}
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4" />
              <Input
                placeholder="Search URL or method..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-64"
              />
            </div>

            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4" />
              <Select value={methodFilter} onValueChange={setMethodFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="Method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Methods</SelectItem>
                  {uniqueMethods.map(method => (
                    <SelectItem key={method} value={method}>{method}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="success">Completed transfer</SelectItem>
                <SelectItem value="error">Incomplete transfer</SelectItem>
                <SelectItem value="2xx">2xx</SelectItem>
                <SelectItem value="3xx">3xx</SelectItem>
                <SelectItem value="4xx">4xx</SelectItem>
                <SelectItem value="5xx">5xx</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          <div className="border rounded-lg">
            <div className="max-h-[600px] overflow-auto" tabIndex={0} aria-label="Captured traffic table">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">
                      <SortButton field="method">Method</SortButton>
                    </TableHead>
                    <TableHead>
                      <SortButton field="url">URL</SortButton>
                    </TableHead>
                    <TableHead className="w-20">
                      <SortButton field="status">Status</SortButton>
                    </TableHead>
                    <TableHead className="w-24">
                      <SortButton field="duration">Duration</SortButton>
                    </TableHead>
                    <TableHead className="w-20">
                      <SortButton field="size">Size</SortButton>
                    </TableHead>
                    <TableHead className="w-32">
                      <SortButton field="timestamp">Time</SortButton>
                    </TableHead>
                    <TableHead className="w-20">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSortedRequests.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <Server className="h-8 w-8" />
                          <p>{isLoading ? 'Loading traffic…' : error ? 'Traffic unavailable' : requests.length ? 'No matching requests' : 'No captured requests yet'}</p>
                          <p className="text-sm">
                            {isLoading || error ? "" : requests.length === 0
                              ? "Requests through the proxy will appear here"
                              : "Try adjusting your filters"
                            }
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredAndSortedRequests.map((request) => (
                      <TableRow key={request.id} className="hover:bg-muted/50">
                        <TableCell>
                          <Badge className={getMethodColor(request.method)} variant="secondary">
                            {request.method}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="truncate max-w-96">
                                  {request.url}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="max-w-md break-all">{request.url}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(request.response_status)} variant="secondary">{request.response_status || '—'}</Badge>
                          <div className="text-xs">{outcomeLabel(request)}</div>
                          <div className="text-xs text-muted-foreground">{request.response_source || 'Unknown source'}</div>
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>{formatDuration(request.total_duration_us)}</span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="text-xs space-y-1">
                                  <div>Total: {formatDuration(request.total_duration_us)}</div>
                                  <div>To headers: {formatDuration(request.upstream_latency_us)}</div>
                                  <div>Other elapsed: {formatDuration(request.proxy_overhead_us)}</div>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>{formatBytes(request.request_size + request.response_size)}</span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="text-xs space-y-1">
                                  <div>Request: {formatBytes(request.request_size)}</div>
                                  <div>Response: {formatBytes(request.response_size)}</div>
                                  <div>Total: {formatBytes(request.request_size + request.response_size)}</div>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableCell>
                        <TableCell className="text-sm">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>{formatDistanceToNow(new Date(request.timestamp), { addSuffix: true })}</span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{new Date(request.timestamp).toLocaleString()}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0"
                                  aria-label="Inspect request"
                                  onClick={() => setSelectedRequest(request)}
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent aria-describedby={undefined} className="max-w-4xl max-h-[80vh] overflow-auto">
                                <DialogHeader>
                                  <DialogTitle className="flex items-center gap-2">
                                    <Badge className={getMethodColor(request.method)} variant="secondary">
                                      {request.method}
                                    </Badge>
                                    <span className="min-w-0 break-all pr-6 font-mono text-sm">{request.url}</span>
                                  </DialogTitle>
                                </DialogHeader>
                                {selectedRequest && <RequestDetails request={selectedRequest} />}
                              </DialogContent>
                            </Dialog>

                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 p-0"
                                    aria-label="Copy sanitized URL"
                                    onClick={() => navigator.clipboard.writeText(request.url)}
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Copy sanitized URL</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CopyCapture({ value, label }: { value: string; label: string }) {
  const [feedback, setFeedback] = useState('');
  return <div className="flex items-center gap-2">
    <span role="status" className="text-xs text-muted-foreground">{feedback}</span>
    <Button variant="outline" size="sm" aria-label={`Copy sanitized ${label}`} onClick={async () => {
      try { await navigator.clipboard.writeText(value); setFeedback('Copied'); }
      catch { setFeedback('Copy unavailable'); }
    }}><Copy className="mr-2 h-3.5 w-3.5" />Copy</Button>
  </div>;
}

function RequestDetails({ request }: { request: BackendRequestRecord }) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-muted/30 p-4">
        <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{request.response_status ? `HTTP ${request.response_status}` : 'No HTTP response'}</Badge><span className="text-sm font-semibold">{outcomeLabel(request)}</span><span className="text-xs text-muted-foreground">Response from {request.response_source || 'unknown source'}</span></div>
        <p className="mt-2 text-xs text-muted-foreground">Captured values are masked by policy. Omitted bodies cannot be recovered from history.</p>
      </div>
      {/* Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-1">
              <Clock className="h-4 w-4" />
              Duration
            </div>
            <div className="text-xl font-semibold tabular-nums">{(request.total_duration_us / 1000).toFixed(1)}ms</div>
            <div className="text-xs text-muted-foreground">
              To headers: {(request.upstream_latency_us / 1000).toFixed(1)}ms
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-1">
              <Database className="h-4 w-4" />
              Size
            </div>
            <div className="text-xl font-semibold tabular-nums">
              {((request.request_size + request.response_size) / 1024).toFixed(1)}KB
            </div>
            <div className="text-xs text-muted-foreground">
              Req: {(request.request_size / 1024).toFixed(1)}KB | Res: {(request.response_size / 1024).toFixed(1)}KB
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-1">
              <Server className="h-4 w-4" />
              Other elapsed time
            </div>
            <div className="text-xl font-semibold tabular-nums">{(request.proxy_overhead_us / 1000).toFixed(1)}ms</div>
            <div className="text-xs text-muted-foreground">
              {(request.total_duration_us > 0 ? (request.proxy_overhead_us / request.total_duration_us) * 100 : 0).toFixed(1)}% of total
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Error Details */}
      {!request.success && request.error && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <AlertCircle className="h-5 w-5" />
              Error Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-sm bg-red-50 p-3 rounded border text-red-800 whitespace-pre-wrap">
              {outcomeLabel(request)}{request.failure_reason === 'tls_certificate' ? ': origin certificate verification failed' : request.failure_reason === 'timeout' ? ': upstream timeout' : ''}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Request Details */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="text-base">Request Headers</CardTitle><CopyCapture label="request headers" value={JSON.stringify(request.request_headers || {}, null, 2)} /></div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-40">
              <div className="space-y-2">
                {Object.entries(request.request_headers || {}).map(([key, value]) => (
                  <div key={key} className="break-all font-mono text-xs leading-relaxed">
                    <span className="font-medium">{key}:</span>
                    <span className="ml-2 text-muted-foreground">{value}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="text-base">Response Headers</CardTitle><CopyCapture label="response headers" value={JSON.stringify(request.response_headers || {}, null, 2)} /></div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-40">
              <div className="space-y-2">
                {Object.entries(request.response_headers || {}).map(([key, value]) => (
                  <div key={key} className="break-all font-mono text-xs leading-relaxed">
                    <span className="font-medium">{key}:</span>
                    <span className="ml-2 text-muted-foreground">{value}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Request Body */}
      {request.request_body && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="text-base">Request Body</CardTitle><CopyCapture label="request body" value={request.request_body} /></div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-40">
              <pre className="break-all text-xs leading-relaxed bg-muted p-3 rounded whitespace-pre-wrap">
                {request.request_body}
              </pre>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Response Body */}
      {request.response_body && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="text-base">Response Body</CardTitle><CopyCapture label="response body" value={request.response_body} /></div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-60">
              <pre className="break-all text-xs leading-relaxed bg-muted p-3 rounded whitespace-pre-wrap">
                {request.response_body}
              </pre>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Timing Details */}
      <Card>
        <CardHeader>
          <CardTitle>Timing Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div>
              <div className="font-medium">Proxy Start:</div>
              <div className="text-muted-foreground">{new Date(request.proxy_start_time).toISOString()}</div>
            </div>
            <div>
              <div className="font-medium">Proxy End:</div>
              <div className="text-muted-foreground">{new Date(request.proxy_end_time).toISOString()}</div>
            </div>
            <div>
              <div className="font-medium">Upstream Start:</div>
              <div className="text-muted-foreground">{new Date(request.upstream_start_time).toISOString()}</div>
            </div>
            <div>
              <div className="font-medium">Upstream End:</div>
              <div className="text-muted-foreground">{new Date(request.upstream_end_time).toISOString()}</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
