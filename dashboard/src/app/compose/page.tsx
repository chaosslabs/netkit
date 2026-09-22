"use client";
import { Header } from "../../components/Header";
import { RequestBuilder } from "../../components/RequestBuilder";
import { RefreshProvider } from "../../hooks/useRefreshContext";
export default function ComposePage() {
  return (
    <RefreshProvider>
      <Header />
      <main className="mx-auto max-w-6xl p-4 md:p-6">
        <h1 className="mb-4 text-2xl font-semibold">Compose</h1>
        <RequestBuilder />
      </main>
    </RefreshProvider>
  );
}
