import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Company — Neutrack",
  description:
    "Neutrack is an Indonesian technology studio building AI agents, software, e-books, and webinars. The team behind Amadeus.",
};

export default function CompanyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
