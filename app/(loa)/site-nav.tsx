"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "https://curiouserrecords.com", label: "Records for Sale" },
  { href: "/reviews", label: "Reviews" },
  { href: "/vinyl-collection", label: "Vinyl Collection" },
  { href: "/mysystem", label: "My System" },
  { href: "/music", label: "Music" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export default function SiteNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <nav className="sticky top-0 z-50 border-b border-white/10 bg-neutral-950/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-4 md:px-10">
        <Link
          href="/"
          onClick={() => setOpen(false)}
          className="flex shrink-0 items-center transition hover:opacity-90"
          aria-label="Late Onset Audiophile home"
        >
          <Image
            src="/images/loalogo.webp"
            alt="Late Onset Audiophile logo"
            width={1024}
            height={1024}
            className="h-12 w-12 object-contain md:h-[52px] md:w-[52px]"
            priority
          />
        </Link>

        <div className="hidden flex-1 items-center gap-6 text-sm lg:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`transition hover:text-white ${
                isActive(link.href) ? "text-white" : "text-neutral-300"
              }`}
            >
              {link.label}
            </Link>
          ))}
          <a
            href="https://instagram.com/lateonsetaudiophile"
            target="_blank"
            rel="noreferrer"
            className="text-neutral-300 transition hover:text-white"
          >
            Instagram
          </a>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          className="ml-auto inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 text-neutral-200 transition hover:bg-white/10 lg:hidden"
        >
          {open ? (
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          )}
        </button>
      </div>

      {open ? (
        <div className="border-t border-white/10 lg:hidden">
          <div className="mx-auto flex max-w-7xl flex-col px-4 py-3">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={`rounded-lg px-2 py-3 text-base transition hover:bg-white/5 hover:text-white ${
                  isActive(link.href) ? "text-white" : "text-neutral-300"
                }`}
              >
                {link.label}
              </Link>
            ))}
            <a
              href="https://instagram.com/lateonsetaudiophile"
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpen(false)}
              className="rounded-lg px-2 py-3 text-base text-neutral-300 transition hover:bg-white/5 hover:text-white"
            >
              Instagram
            </a>
          </div>
        </div>
      ) : null}
    </nav>
  );
}
