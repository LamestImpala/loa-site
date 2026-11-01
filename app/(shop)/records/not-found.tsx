import Link from "next/link";

export default function ShopNotFound() {
  return (
    <div className="shop-shell shop-main">
      <div className="card shop-empty">
        <h1 className="shop-empty-title">That one isn&rsquo;t on the shelf.</h1>
        <p className="shop-muted" style={{ margin: 0 }}>
          It may have sold and come down, or the link is mistyped.
        </p>
        <Link className="btn btn-primary" href="/">
          Browse what&rsquo;s here
        </Link>
      </div>
    </div>
  );
}
