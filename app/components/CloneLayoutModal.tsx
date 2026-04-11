/**
 * CloneLayoutModal
 *
 * Polaris modal for selecting a source setup to clone print areas,
 * positions, sizes, and pricing into the current setup.
 */

import { useState, useMemo } from "react";
import { Modal, TextField, Text, Banner, BlockStack, InlineStack, Box } from "@shopify/polaris";

// ============================================================================
// Types
// ============================================================================

export type SetupItem = {
  id: string;
  name: string;
  viewCount: number;
  placementCount: number;
  methodNames: string[];
};

type Props = {
  open: boolean;
  onClose: () => void;
  onApply: (sourceConfigId: string) => void;
  setups: SetupItem[];
  loading?: boolean;
};

// ============================================================================
// Component
// ============================================================================

export function CloneLayoutModal({ open, onClose, onApply, setups, loading = false }: Props) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return setups;
    return setups.filter((s) => s.name.toLowerCase().includes(q));
  }, [setups, search]);

  function handleClose() {
    setSearch("");
    setSelectedId(null);
    onClose();
  }

  function handleApply() {
    if (selectedId) {
      onApply(selectedId);
      setSearch("");
      setSelectedId(null);
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Clone from another setup"
      primaryAction={{
        content: "Apply",
        disabled: !selectedId || loading,
        loading,
        onAction: handleApply,
      }}
      secondaryActions={[
        {
          content: "Cancel",
          onAction: handleClose,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text as="p" tone="subdued">
            Select a setup to copy its print areas, positions, size tiers, and pricing into this
            setup. This will replace all existing print area configuration on this setup.
          </Text>

          <TextField
            label="Search setups"
            labelHidden
            placeholder="Search by name..."
            value={search}
            onChange={setSearch}
            autoComplete="off"
            clearButton
            onClearButtonClick={() => setSearch("")}
          />

          {/* Scrollable list */}
          <div
            style={{
              maxHeight: 240,
              overflowY: "auto",
              border: "1px solid #E5E7EB",
              borderRadius: 8,
            }}
          >
            {filtered.length === 0 ? (
              <div
                style={{
                  padding: "20px 16px",
                  textAlign: "center",
                  color: "#9CA3AF",
                  fontSize: 13,
                }}
              >
                {search ? "No setups match your search." : "No other setups available."}
              </div>
            ) : (
              filtered.map((setup, index) => {
                const isSelected = setup.id === selectedId;
                return (
                  <button
                    key={setup.id}
                    type="button"
                    onClick={() => setSelectedId(setup.id)}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "10px 14px",
                      textAlign: "left",
                      border: "none",
                      borderTop: index === 0 ? "none" : "1px solid #F3F4F6",
                      background: isSelected ? "#EFF6FF" : "#ffffff",
                      cursor: "pointer",
                      transition: "background 0.1s",
                    }}
                  >
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="050">
                        <Text
                          as="span"
                          variant="bodyMd"
                          fontWeight={isSelected ? "semibold" : "regular"}
                          tone={isSelected ? "magic" : undefined}
                        >
                          {setup.name}
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {setup.viewCount} {setup.viewCount === 1 ? "view" : "views"} &middot;{" "}
                          {setup.placementCount}{" "}
                          {setup.placementCount === 1 ? "print area" : "print areas"}
                          {setup.methodNames.length > 0
                            ? ` \u00b7 ${setup.methodNames.join(", ")}`
                            : ""}
                        </Text>
                      </BlockStack>
                      {isSelected && (
                        <Box>
                          <svg
                            width="16"
                            height="16"
                            fill="none"
                            stroke="#2563EB"
                            strokeWidth="2.5"
                            viewBox="0 0 24 24"
                          >
                            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </Box>
                      )}
                    </InlineStack>
                  </button>
                );
              })
            )}
          </div>

          <Banner tone="warning">
            <Text as="p">
              This will replace all print areas, positions, sizes, and pricing in this setup.
            </Text>
          </Banner>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
