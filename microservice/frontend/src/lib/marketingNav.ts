export interface MarketingNavLink {
  href: string;
  label: string;
}

// Links rendered in the floating homepage/marketing nav. /docs is included here
// but keeps its existing AppShell sidebar treatment — see MARKETING_CHROMELESS_ROUTES.
export const MARKETING_NAV_LINKS: MarketingNavLink[] = [
  { href: "/product", label: "Product" },
  { href: "/solutions", label: "Solutions" },
  { href: "/docs", label: "Docs" },
  { href: "/resources", label: "Resources" },
  { href: "/company", label: "Company" },
  { href: "/ebook", label: "E-book" },
  { href: "/pricing", label: "Pricing" },
  { href: "/partners", label: "Partners" },
];

// Routes that should render with the floating marketing nav instead of the
// dark dashboard sidebar (AppShell.isChromeless). Deliberately excludes /docs,
// which already has its own AppShell-hosted sidebar (DocsSidebar).
export const MARKETING_CHROMELESS_ROUTES = MARKETING_NAV_LINKS.map((l) => l.href).filter(
  (href) => href !== "/docs"
);
