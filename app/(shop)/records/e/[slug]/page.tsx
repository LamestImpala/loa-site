import type { Metadata } from "next";
import { ItemPage, itemMetadata } from "../../_item/item-page";

// A piece of equipment's page: /e/<id>-<slug>. Shared page in _item/item-page.tsx.

export const revalidate = 60;

export async function generateMetadata({ params }: PageProps<"/records/e/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  return itemMetadata("gear", slug);
}

export default async function GearPage({ params }: PageProps<"/records/e/[slug]">) {
  const { slug } = await params;
  return <ItemPage kind="gear" slug={slug} />;
}
