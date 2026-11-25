import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata = {
  title: "GroupRide · Carpool planning",
  description: "Organize drivers, pickups, and carpool assignments for your group.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <header className="site-header">
          <div className="header-inner">
            <Link className="brand" href="/">
              <span className="brand-mark" aria-hidden="true"><span /><span /></span>
              GroupRide
            </Link>
            <Link className="new-trip" href="/"><span aria-hidden="true">+</span> New trip</Link>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
