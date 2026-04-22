/**
 * ProductionNotesCard — real production notes form.
 *
 * Lists existing notes (from loader.notes, newest first), then renders
 * a <s-text-area> + Save button. Submits via useFetcher with
 * intent=save-note + body + shopifyOrderId.
 *
 * On success: toast "Note saved" + clear textarea.
 * On error: inline banner inside the card.
 */

import { useState, useEffect } from "react";
import { useFetcher } from "react-router";
import { useToast } from "../../../lib/admin/app-bridge.client";
import type { OrderNoteResult } from "../../../lib/services/order-notes.server";

// ---------------------------------------------------------------------------
// Relative timestamp helper
// ---------------------------------------------------------------------------

function relativeTime(isoString: string): string {
  const date = new Date(isoString);
  const diffMs = Date.now() - date.getTime();
  const diffS = Math.floor(diffMs / 1000);
  if (diffS < 60) return "just now";
  const diffM = Math.floor(diffS / 60);
  if (diffM < 60) return `${diffM}m ago`;
  const diffH = Math.floor(diffM / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `${diffD}d ago`;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FetcherData = {
  ok?: boolean;
  note?: OrderNoteResult;
  error?: { code: string; message: string } | string;
};

type Props = {
  notes: OrderNoteResult[];
  shopifyOrderId: string;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProductionNotesCard({ notes, shopifyOrderId }: Props) {
  const showToast = useToast();
  const fetcher = useFetcher<FetcherData>();
  const [body, setBody] = useState("");
  const [inlineError, setInlineError] = useState<string | null>(null);

  const isSubmitting = fetcher.state === "submitting";

  // Handle fetcher result.
  useEffect(() => {
    if (fetcher.state !== "idle") return;
    if (!fetcher.data) return;
    if (fetcher.data.ok) {
      showToast("Note saved");
      setBody("");
      setInlineError(null);
    } else if (fetcher.data.error) {
      const msg =
        typeof fetcher.data.error === "string"
          ? fetcher.data.error
          : fetcher.data.error.message;
      setInlineError(msg ?? "Failed to save note");
      showToast(msg ?? "Failed to save note", { isError: true });
    }
  }, [fetcher.state, fetcher.data, showToast]);

  function handleSave() {
    if (!body.trim()) {
      setInlineError("Note body must not be empty");
      return;
    }
    setInlineError(null);
    const fd = new FormData();
    fd.append("intent", "save-note");
    fd.append("body", body.trim());
    fd.append("shopifyOrderId", shopifyOrderId);
    fetcher.submit(fd, { method: "POST" });
  }

  return (
    <s-section heading="Production notes">
      <s-stack direction="block" gap="base">
        {/* Existing notes list */}
        {notes.length > 0 ? (
          notes.map((note) => (
            <s-stack key={note.id} direction="block" gap="small-100">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-text type="strong">
                  {note.authorName ?? "System"}
                </s-text>
                <s-text color="subdued">{relativeTime(note.createdAt)}</s-text>
              </s-stack>
              <s-paragraph>{note.body}</s-paragraph>
            </s-stack>
          ))
        ) : (
          <s-text color="subdued">No notes yet.</s-text>
        )}

        <s-divider />

        {/* Inline error banner */}
        {inlineError && (
          <s-banner
            tone="critical"
            heading="Could not save note"
            dismissible={true}
            onDismiss={() => setInlineError(null)}
          >
            <s-paragraph>{inlineError}</s-paragraph>
          </s-banner>
        )}

        {/* New note form */}
        <s-text-area
          label="Add a note"
          labelAccessibilityVisibility="visible"
          placeholder="Add a production note..."
          rows={3}
          name="production-note"
          disabled={isSubmitting}
          value={body}
          onInput={(e: Event) => {
            const target = e.target as HTMLInputElement;
            setBody(target.value ?? "");
          }}
        />

        <s-button-group>
          <s-button
            slot="primary-action"
            variant="primary"
            loading={isSubmitting}
            disabled={isSubmitting || !body.trim()}
            onClick={handleSave}
          >
            Save note
          </s-button>
          <s-button
            slot="secondary-actions"
            icon="email"
            disabled={true}
            accessibilityLabel="Message customer — coming soon"
          >
            Message customer
          </s-button>
        </s-button-group>
      </s-stack>
    </s-section>
  );
}
