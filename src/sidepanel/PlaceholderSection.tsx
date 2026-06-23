import type { ReactNode } from 'react';

interface PlaceholderSectionProps {
  title: string;
  children: ReactNode;
}

/** A titled card with muted placeholder copy for not-yet-built features. */
export function PlaceholderSection({ title, children }: PlaceholderSectionProps) {
  return (
    <section className="card card--placeholder">
      <h2 className="card__heading">{title}</h2>
      <p className="empty">{children}</p>
    </section>
  );
}
