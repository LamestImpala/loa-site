// Parchment skeleton while the Supabase query resolves — hero silhouette plus
// a grid of shimmering cards, so a slow load never shows a blank page.
export default function Loading() {
  return (
    <div className="shop-shell shop-main" aria-busy="true" aria-label="Loading records">
      <div
        className="shop-skeleton"
        style={{ height: 280, borderRadius: "var(--radius-lg)", marginBlock: "var(--space-4) var(--space-8)" }}
      />
      <div className="shop-grid">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="card elev-sm record-card">
            <div className="shop-skeleton" style={{ aspectRatio: "1 / 1", borderRadius: "var(--radius-lg)" }} />
            <div className="shop-skeleton" style={{ height: 16, width: "80%" }} />
            <div className="shop-skeleton" style={{ height: 12, width: "55%" }} />
            <div className="shop-skeleton" style={{ height: 26, width: "40%" }} />
          </div>
        ))}
      </div>
    </div>
  );
}
