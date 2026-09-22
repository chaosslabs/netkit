"use client";
import { Header } from "../../components/Header";
import { InvestigationWorkspace } from "../../components/InvestigationWorkspace";
export default function Page() {
  return (
    <>
      <Header />
      <main className="p-4 md:p-6">
        <InvestigationWorkspace />
      </main>
    </>
  );
}
