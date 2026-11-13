"use client";

import { useMemo } from "react";
import type { DbRecord, OrderRequest, ShopMessage } from "@/lib/supabase";
import type { OpenOrder } from "@/lib/admin/orders";
import { looseThreads, threadFor, type LooseThread } from "@/lib/admin/messages";
import { useAdmin } from "../_shell/admin-provider";
import { EmptyState } from "../_shell/primitives";
import { MailCard } from "./messages";
import type { PasteDmState } from "./paste-dm";
import { RequestCard } from "./requests";
import type { Desk } from "./use-desk";

type Conversation =
  | { kind: "request"; key: string; at: string; req: OrderRequest; thread: ShopMessage[] }
  | { kind: "mail"; key: string; at: string; thread: LooseThread<ShopMessage> };

// Conversations: every buyer the seller is talking to. A request from the
// shop comes with its emails; mail that belongs to no open request gets a
// card per sender. Whoever wrote most recently is on top.
export function Conversations({
  open,
  desk,
  paste,
  deskRecords,
}: {
  open: OpenOrder[];
  desk: Desk;
  paste: PasteDmState;
  deskRecords: DbRecord[];
}) {
  const { orderRequests, messages, sentMessages } = useAdmin();

  const conversations = useMemo(() => {
    const list: Conversation[] = orderRequests.map((req) => {
      const thread = threadFor(req, messages, sentMessages);
      // Sorted by what the buyer did last, so answering one doesn't move it.
      const lastIn = thread.filter((m) => m.direction === "in").at(-1)?.received_at ?? "";
      return {
        kind: "request",
        key: `request-${req.id}`,
        at: lastIn > req.created_at ? lastIn : req.created_at,
        req,
        thread,
      };
    });
    for (const thread of looseThreads(messages, sentMessages, orderRequests)) {
      list.push({
        kind: "mail",
        key: `mail-${thread.email}`,
        at: thread.latestIn.received_at,
        thread,
      });
    }
    return list.sort((a, b) => b.at.localeCompare(a.at));
  }, [orderRequests, messages, sentMessages]);

  const invoicedRecordIds = useMemo(
    () =>
      new Set(
        open
          .filter((o) => o.order.status === "invoiced")
          .flatMap((o) => o.recs.map((r) => r.id))
      ),
    [open]
  );

  const newCount =
    orderRequests.filter((r) => r.status === "new").length +
    messages.filter((m) => m.direction === "in" && m.status === "new").length;

  return (
    <section aria-labelledby="requests">
      {/* Old links to the Messages section land here too. */}
      <span id="messages" className="block scroll-mt-24" />
      <h2 id="requests" className="scroll-mt-24 text-xl font-medium">
        Conversations{" "}
        {newCount > 0 ? (
          <span className="text-sm text-amber-400">({newCount} new)</span>
        ) : (
          <span className="text-sm text-neutral-400">({conversations.length} open)</span>
        )}
      </h2>
      <p className="mt-1 text-sm text-neutral-400">
        Requests from the shop and mail to orders@curiouserrecords.com, each
        with its emails. Load one onto the sale desk, reply as orders@, or
        close it.
      </p>
      {conversations.length === 0 ? (
        <EmptyState>
          No open conversations. A request from the shop or an email to orders@
          shows up here.
        </EmptyState>
      ) : (
        <div className="mt-3 grid gap-3">
          {conversations.map((c) =>
            c.kind === "request" ? (
              <RequestCard
                key={c.key}
                req={c.req}
                thread={c.thread}
                invoiced={c.req.record_ids.some((id) => invoicedRecordIds.has(id))}
                desk={desk}
              />
            ) : (
              <MailCard
                key={c.key}
                thread={c.thread}
                desk={desk}
                paste={paste}
                deskRecords={deskRecords}
              />
            )
          )}
        </div>
      )}
    </section>
  );
}
