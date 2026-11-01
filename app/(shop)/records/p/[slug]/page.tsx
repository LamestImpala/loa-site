import type { Metadata } from "next";
import { ItemPage, itemMetadata } from "../../_item/item-page";

// A poster's page: /p/<id>-<slug>. Shared page in _item/item-page.tsx.

export const revalidate = 60;

export async function generateMetadata({ params }: PageProps<"/records/p/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  return itemMetadata("poster", slug);
}

export default async function PosterPage({ params }: PageProps<"/records/p/[slug]">) {
  const { slug } = await params;
  return <ItemPage kind="poster" slug={slug} />;
}
