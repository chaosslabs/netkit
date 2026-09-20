import { create } from 'zustand';
import { RequestConfig, ApiResponse, RequestHistory, HeaderPair, HttpMethod } from '../types/api';

interface RequestStore {
  // Current request state
  method: HttpMethod;
  url: string;
  headers: HeaderPair[];
  body: string;

  // Response state
  response: ApiResponse | null;
  isLoading: boolean;
  error: string | null;

  // History
  history: RequestHistory[];

  // Actions
  setMethod: (method: HttpMethod) => void;
  setUrl: (url: string) => void;
  setHeaders: (headers: HeaderPair[]) => void;
  setBody: (body: string) => void;

  addHeader: () => void;
  removeHeader: (index: number) => void;
  updateHeader: (index: number, key: string, value: string, enabled: boolean) => void;

  setResponse: (response: ApiResponse | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  addToHistory: (request: RequestConfig, response?: ApiResponse, error?: string) => void;
  clearHistory: () => void;

  reset: () => void;
}

const defaultHeaders: HeaderPair[] = [
  { key: 'User-Agent', value: 'fetchr.sh/1.0', enabled: true },
  { key: '', value: '', enabled: true },
];

export const useRequestStore = create<RequestStore>()(
  (set, get) => ({
    // Initial state
    method: 'GET',
    url: '',
    headers: defaultHeaders,
    body: '',

    response: null,
    isLoading: false,
    error: null,

    history: [],

    // Actions
    setMethod: (method) => set({ method }),
    setUrl: (url) => set({ url }),
    setHeaders: (headers) => set({ headers }),
    setBody: (body) => set({ body }),

    addHeader: () => {
      const { headers } = get();
      set({ headers: [...headers, { key: '', value: '', enabled: true }] });
    },

    removeHeader: (index) => {
      const { headers } = get();
      set({ headers: headers.filter((_, i) => i !== index) });
    },

    updateHeader: (index, key, value, enabled) => {
      const { headers } = get();
      const newHeaders = [...headers];
      newHeaders[index] = { key, value, enabled };
      set({ headers: newHeaders });
    },

    setResponse: (response) => set({ response }),
    setLoading: (isLoading) => set({ isLoading }),
    setError: (error) => set({ error }),

    addToHistory: (request, response, error) => {
      const { history } = get();
      const newEntry: RequestHistory = {
        id: Date.now().toString(),
        request,
        response,
        error,
        timestamp: Date.now(),
      };
      set({ history: [newEntry, ...history.slice(0, 99)] }); // Keep last 100 entries
    },

    clearHistory: () => set({ history: [] }),

    reset: () => set({
      method: 'GET',
      url: '',
      headers: defaultHeaders,
      body: '',
      response: null,
      error: null,
    }),
  })
);
