'use client';

import React from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Textarea } from './ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Badge } from './ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { Plus, X, Send, RotateCcw, Copy } from 'lucide-react';
import { useRequestStore } from '../hooks/useRequestStore';
import { useRefresh } from '../hooks/useRefreshContext';
import { apiService } from '../services/api';
import { HttpMethod, ApiError } from '../types/api';

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

export function RequestBuilder() {
  const {
    method,
    url,
    headers,
    body,
    response,
    isLoading,
    error,
    setMethod,
    setUrl,
    setBody,
    addHeader,
    removeHeader,
    updateHeader,
    setResponse,
    setLoading,
    setError,
    reset,
  } = useRequestStore();

  const { triggerRefresh } = useRefresh();

  const handleSendRequest = async () => {
    if (!url.trim()) {
      setError('URL is required');
      return;
    }

    if (/\[REDACTED\]|%5BREDACTED%5D|\[Body omitted/i.test(JSON.stringify({ url, headers, body }))) {
      setError('Replace redacted or omitted values before sending this draft.');
      return;
    }

    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      // Convert headers array to object, filtering out empty/disabled headers
      const requestHeaders: Record<string, string> = {};
      headers.forEach(({ key, value, enabled }) => {
        if (enabled && key.trim() && value.trim()) {
          requestHeaders[key.trim()] = value.trim();
        }
      });

      const requestConfig = {
        method,
        url: url.trim(),
        headers: requestHeaders,
        body: body.trim() || undefined,
      };

      const apiResponse = await apiService.makeRequest(requestConfig);
      setResponse(apiResponse);
      
      // Trigger refresh of statistics and history after successful request
      triggerRefresh();
    } catch (err: unknown) {
      const error = err as ApiError;
      const errorMessage = error?.body || error?.message || 'Request failed';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const formatResponseBody = (responseBody: string, contentType?: string) => {
    try {
      if (contentType?.includes('application/json')) {
        return JSON.stringify(JSON.parse(responseBody), null, 2);
      }
    } catch {
      // If parsing fails, return as-is
    }
    return responseBody;
  };

  const getStatusBadgeColor = (statusCode: number) => {
    if (statusCode >= 200 && statusCode < 300) return 'bg-green-500';
    if (statusCode >= 300 && statusCode < 400) return 'bg-blue-500';
    if (statusCode >= 400 && statusCode < 500) return 'bg-yellow-500';
    if (statusCode >= 500) return 'bg-red-500';
    return 'bg-gray-500';
  };

  const copyResponse = () => {
    if (response?.body) {
      navigator.clipboard.writeText(response.body);
    }
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Request Section */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center justify-between">
            <span>Request Builder</span>
            <div className="flex gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" onClick={reset}>
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Reset request</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">Drafts are temporary and may contain credentials you enter. Captured data and response copies are sanitized; omitted values must be replaced before sending.</p>
          {/* Method and URL */}
          <div className="flex gap-2">
            <Select value={method} onValueChange={(value: HttpMethod) => setMethod(value)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HTTP_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    <Badge variant={m === 'GET' ? 'secondary' : 'default'} className="text-xs">
                      {m}
                    </Badge>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="https://api.example.com/endpoint"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="flex-1"
            />
            <Button 
              onClick={handleSendRequest} 
              disabled={isLoading || !url.trim()}
              className="px-6"
            >
              {isLoading ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Sending...
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Send className="h-4 w-4" />
                  Send
                </div>
              )}
            </Button>
          </div>

          {/* Request Details */}
          <Tabs defaultValue="headers" className="w-full">
            <TabsList>
              <TabsTrigger value="headers">Headers</TabsTrigger>
              <TabsTrigger value="body">Body</TabsTrigger>
            </TabsList>
            
            <TabsContent value="headers" className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Headers</Label>
                <Button variant="outline" size="sm" onClick={addHeader}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Header
                </Button>
              </div>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {headers.map((header, index) => (
                  <div key={index} className="flex gap-2 items-center">
                    <input
                      type="checkbox"
                      checked={header.enabled}
                      onChange={(e) => updateHeader(index, header.key, header.value, e.target.checked)}
                      className="rounded"
                    />
                    <Input
                      placeholder="Header name"
                      value={header.key}
                      onChange={(e) => updateHeader(index, e.target.value, header.value, header.enabled)}
                      className="flex-1"
                    />
                    <Input
                      placeholder="Header value"
                      value={header.value}
                      onChange={(e) => updateHeader(index, header.key, e.target.value, header.enabled)}
                      className="flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeHeader(index)}
                      disabled={headers.length <= 1}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </TabsContent>
            
            <TabsContent value="body">
              <div className="space-y-2">
                <Label>Request Body</Label>
                <Textarea
                  placeholder="Request body (JSON, XML, plain text...)"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="min-h-32 font-mono text-sm"
                />
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Response Section */}
      {(response || error) && (
        <Card className="flex-1">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center justify-between">
              <span>Response</span>
              {response && (
                <div className="flex items-center gap-2">
                  <Badge className={`${getStatusBadgeColor(response.statusCode)} text-white`}>
                    {response.statusCode}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {response.duration}ms
                  </span>
                  <Button variant="outline" size="sm" aria-label="Copy sanitized response" onClick={copyResponse}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {error ? (
              <div className="bg-red-50 border border-red-200 rounded-md p-4">
                <p className="text-red-800 font-medium">Error</p>
                <p className="text-red-600 text-sm mt-1">{error}</p>
              </div>
            ) : response ? (
              <Tabs defaultValue="body" className="w-full">
                <TabsList>
                  <TabsTrigger value="body">Body</TabsTrigger>
                  <TabsTrigger value="headers">Headers</TabsTrigger>
                </TabsList>
                
                <TabsContent value="body">
                  <div className="bg-muted rounded-md p-4 max-h-96 overflow-auto">
                    <pre className="text-sm whitespace-pre-wrap font-mono">
                      {formatResponseBody(response.body, response.headers['content-type'])}
                    </pre>
                  </div>
                </TabsContent>
                
                <TabsContent value="headers">
                  <div className="space-y-2">
                    {Object.entries(response.headers).map(([key, value]) => (
                      <div key={key} className="flex gap-4 py-1 border-b">
                        <span className="font-medium text-sm w-48 truncate">{key}:</span>
                        <span className="text-sm text-muted-foreground flex-1">{value}</span>
                      </div>
                    ))}
                  </div>
                </TabsContent>
              </Tabs>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
} 