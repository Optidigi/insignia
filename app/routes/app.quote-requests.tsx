import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  Badge,
  BlockStack,
  Card,
  EmptyState,
  IndexTable,
  InlineStack,
  Link,
  Page,
  Text,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";

const PAGE_SIZE = 50;

type QuoteProductSnapshot = {
  productTitle?: string;
  variantTitle?: string | null;
  methodLabel?: string | null;
  maxFormatLabel?: string | null;
  imageUrl?: string | null;
};

const DECORATION_LABELS: Record<string, string> = {
  print: "Bedrukken",
  embroidery: "Borduren",
  advise: "Stitchs adviseert",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const rawPage = parseInt(url.searchParams.get("page") || "1", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;

  const shop = await db.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });

  if (!shop) {
    return { quoteRequests: [], page: 1, totalPages: 1, totalCount: 0 };
  }

  const [totalCount, quoteRequests] = await Promise.all([
    db.quoteRequest.count({ where: { shopId: shop.id } }),
    db.quoteRequest.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        decorationChoice: true,
        maxFormatChoice: true,
        maxFormatCustom: true,
        placementWish: true,
        notes: true,
        contactName: true,
        contactEmail: true,
        contactPhone: true,
        companyName: true,
        productSnapshot: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    quoteRequests: quoteRequests.map((request) => ({
      ...request,
      createdAt: request.createdAt.toISOString(),
      productSnapshot: request.productSnapshot as QuoteProductSnapshot,
    })),
    page,
    totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
    totalCount,
  };
};

export default function QuoteRequestsPage() {
  const { quoteRequests, page, totalPages, totalCount } = useLoaderData<typeof loader>();

  return (
    <Page
      title="Quote requests"
      subtitle={`${totalCount} submitted request${totalCount === 1 ? "" : "s"}`}
    >
      <Card padding="0">
        {quoteRequests.length === 0 ? (
          <EmptyState
            heading="No quote requests yet"
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>Submitted Stitchs quote forms will appear here.</p>
          </EmptyState>
        ) : (
          <IndexTable
            resourceName={{ singular: "quote request", plural: "quote requests" }}
            itemCount={quoteRequests.length}
            selectable={false}
            headings={[
              { title: "Submitted" },
              { title: "Product" },
              { title: "Contact" },
              { title: "Technique" },
              { title: "Placement" },
            ]}
            pagination={{
              hasPrevious: page > 1,
              hasNext: page < totalPages,
              onPrevious: () => {
                window.location.href = `/app/quote-requests?page=${page - 1}`;
              },
              onNext: () => {
                window.location.href = `/app/quote-requests?page=${page + 1}`;
              },
            }}
          >
            {quoteRequests.map((request, index) => {
              const productTitle = request.productSnapshot.productTitle || "Product";
              const formatLabel =
                request.maxFormatChoice === "other"
                  ? request.maxFormatCustom || "Anders"
                  : `Tot ${request.maxFormatChoice.replace("cm", " cm")}`;
              return (
                <IndexTable.Row id={request.id} key={request.id} position={index}>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {new Date(request.createdAt).toLocaleString("nl-NL")}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <BlockStack gap="050">
                      <Text as="span" fontWeight="semibold">{productTitle}</Text>
                      {request.productSnapshot.variantTitle ? (
                        <Text as="span" variant="bodySm" tone="subdued">
                          {request.productSnapshot.variantTitle}
                        </Text>
                      ) : null}
                    </BlockStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <BlockStack gap="050">
                      <Text as="span" fontWeight="semibold">{request.contactName}</Text>
                      <InlineStack gap="100">
                        <Link url={`mailto:${request.contactEmail}`}>{request.contactEmail}</Link>
                        {request.contactPhone ? <Text as="span">{request.contactPhone}</Text> : null}
                      </InlineStack>
                      {request.companyName ? (
                        <Text as="span" variant="bodySm" tone="subdued">{request.companyName}</Text>
                      ) : null}
                    </BlockStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <BlockStack gap="100">
                      <Badge>{DECORATION_LABELS[request.decorationChoice] ?? request.decorationChoice}</Badge>
                      <Text as="span" variant="bodySm">{formatLabel}</Text>
                    </BlockStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <BlockStack gap="050">
                      <Text as="span">{request.placementWish}</Text>
                      {request.notes ? (
                        <Text as="span" variant="bodySm" tone="subdued">{request.notes}</Text>
                      ) : null}
                    </BlockStack>
                  </IndexTable.Cell>
                </IndexTable.Row>
              );
            })}
          </IndexTable>
        )}
      </Card>
    </Page>
  );
}
