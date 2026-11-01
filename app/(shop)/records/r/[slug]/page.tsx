import type { Metadata } from "next";
import { ItemPage, itemMetadata } from "../../_item/item-page";

// A record's page: /r/<id>-<slug>. The page itself is shared with posters
// and equipment (see _item/item-page.tsx); this file only names the kind.

export const revalidate = 60;

export async function generateMetadata({ params }: PageProps<"/records/r/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  return itemMetadata("record", slug);
}

export default async function RecordPage({ params }: PageProps<"/records/r/[slug]">) {
  const { slug } = await params;
  return <ItemPage kind="record" slug={slug} />;
}
