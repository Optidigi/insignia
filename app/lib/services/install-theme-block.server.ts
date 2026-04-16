/**
 * Theme Block Install Check Service
 *
 * Checks whether the Insignia "customize-button" app block is already present
 * in the active (MAIN) theme's product template. Does NOT modify the theme —
 * Shopify gates `themeFilesUpsert` behind a per-app exemption. The caller
 * should open the Shopify theme editor with an `addAppBlockId` deep link when
 * the block is missing, so the merchant can add it with one click.
 *
 * This service requires `read_themes` scope to check installation state. If
 * the scope is missing OR the query returns no data, the result includes a
 * `debug` blob describing exactly what was seen — surfaced in the admin UI
 * banner — so scope/auth issues can be diagnosed without server logs.
 *
 * Docs: https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration
 */

type AdminGraphql = (
  query: string,
  options?: { variables?: Record<string, unknown> }
) => Promise<Response>;

// The block type Shopify writes into product.json has the format:
//   shopify://apps/<app_name>/blocks/<block_handle>/<suffix>
//
// The `<suffix>` has historically been either the app's client_id (api_key)
// or the theme app extension's UUID — docs say api_key is current but many
// stores still have the UUID form written from older installs. The `<app_name>`
// segment derives from the extension/app handle and differs between prod vs
// demo builds (e.g. "insignia-customize" vs "insignia-demo").
//
// The ONLY segment that's both (a) ours and (b) invariant across all variants
// is the block handle. We additionally require the `shopify://apps/` prefix
// so we never false-positive on a section's native block whose handle
// coincidentally matches.
const BLOCK_HANDLE = "customize-button";

function isOurBlock(blockType: string): boolean {
  return (
    blockType.startsWith("shopify://apps/") &&
    blockType.includes(`/blocks/${BLOCK_HANDLE}/`)
  );
}

export type ThemeBlockCheckDebug = {
  themeId?: string;
  themeName?: string;
  fileFound: boolean;
  parseOk: boolean;
  sectionCount: number;
  blockTypesSeen: string[];
  ourBlockCount: number;
  graphqlErrors?: string[];
};

export type ThemeBlockCheckResult =
  | { status: "already_installed"; themeId: string; debug: ThemeBlockCheckDebug }
  | { status: "needs_install"; themeId?: string; debug: ThemeBlockCheckDebug }
  | { status: "error"; message: string; debug: ThemeBlockCheckDebug };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Walk every section/block in the template, collecting every block `type`
 * string we see and counting how many of them are ours. Returning the full
 * list lets the caller show the merchant exactly what's in the theme when
 * things don't go as expected.
 */
function scanTemplateForBlock(templateJson: Record<string, unknown>): {
  sectionCount: number;
  blockTypesSeen: string[];
  ourBlockCount: number;
} {
  const sections = templateJson.sections as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!sections) {
    return { sectionCount: 0, blockTypesSeen: [], ourBlockCount: 0 };
  }

  const blockTypesSeen: string[] = [];
  let ourBlockCount = 0;
  const sectionEntries = Object.values(sections);

  for (const section of sectionEntries) {
    const blocks = section.blocks as
      | Record<string, Record<string, unknown>>
      | undefined;
    if (!blocks) continue;
    for (const block of Object.values(blocks)) {
      const type = block.type;
      if (typeof type !== "string") continue;
      blockTypesSeen.push(type);
      if (isOurBlock(type)) ourBlockCount += 1;
    }
  }

  return {
    sectionCount: sectionEntries.length,
    blockTypesSeen,
    ourBlockCount,
  };
}

/**
 * Parse JSON that may contain Shopify-flavoured extras (comments, trailing
 * commas, UTF-8 BOM). Returns null on total failure; callers decide whether
 * that warrants `needs_install` or `error`.
 */
function parseLenientJson(source: string): Record<string, unknown> | null {
  let text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;

  try {
    return JSON.parse(text);
  } catch {
    // fall through to lenient pass
  }

  text = text.replace(/\/\*[\s\S]*?\*\//g, "");
  text = text.replace(/(^|[^:"'\\])\/\/.*$/gm, "$1");
  text = text.replace(/,(\s*[}\]])/g, "$1");

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Extract human-readable GraphQL error messages from a response. Shopify
 * returns these under `errors` for top-level errors (e.g. missing scope,
 * invalid field) and sometimes under `data.<op>.userErrors` for mutations.
 */
function extractGraphqlErrors(json: unknown): string[] {
  if (!json || typeof json !== "object") return [];
  const root = json as { errors?: unknown };
  const errors = root.errors;
  if (!Array.isArray(errors)) return [];
  return errors
    .map((e) => {
      if (!e || typeof e !== "object") return null;
      const err = e as { message?: unknown };
      return typeof err.message === "string" ? err.message : null;
    })
    .filter((m): m is string => !!m);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Returns whether the Insignia customize-button block is present in the
 * active theme's product template. Never modifies the theme. The result
 * always includes a `debug` blob describing exactly what the service saw.
 */
export async function checkThemeBlockInstalled(
  graphql: AdminGraphql
): Promise<ThemeBlockCheckResult> {
  const debug: ThemeBlockCheckDebug = {
    fileFound: false,
    parseOk: false,
    sectionCount: 0,
    blockTypesSeen: [],
    ourBlockCount: 0,
  };

  try {
    // 1. Get the active (MAIN) theme ID
    const themesRes = await graphql(
      `#graphql
        query GetActiveTheme {
          themes(first: 1, roles: [MAIN]) {
            nodes {
              id
              name
              role
            }
          }
        }`
    );
    const themesJson = await themesRes.json();
    const themesErrors = extractGraphqlErrors(themesJson);
    if (themesErrors.length > 0) {
      debug.graphqlErrors = themesErrors;
      return {
        status: "error",
        message: `Could not read themes: ${themesErrors.join("; ")}`,
        debug,
      };
    }

    const themeNode = themesJson?.data?.themes?.nodes?.[0];
    if (!themeNode?.id) {
      return { status: "needs_install", debug };
    }

    const themeId: string = themeNode.id;
    debug.themeId = themeId;
    if (typeof themeNode.name === "string") debug.themeName = themeNode.name;

    // 2. Read templates/product.json from the active theme.
    //    Requires `read_themes` scope.
    const fileRes = await graphql(
      `#graphql
        query GetThemeFile($themeId: ID!, $filenames: [String!]!) {
          theme(id: $themeId) {
            files(filenames: $filenames, first: 1) {
              nodes {
                filename
                body {
                  ... on OnlineStoreThemeFileBodyText {
                    content
                  }
                }
              }
            }
          }
        }`,
      {
        variables: {
          themeId,
          filenames: ["templates/product.json"],
        },
      }
    );
    const fileJson = await fileRes.json();
    const fileErrors = extractGraphqlErrors(fileJson);
    if (fileErrors.length > 0) {
      debug.graphqlErrors = fileErrors;
      return {
        status: "error",
        message: `Could not read theme file: ${fileErrors.join("; ")}`,
        debug,
      };
    }

    const fileNode = fileJson?.data?.theme?.files?.nodes?.[0];

    if (!fileNode?.body?.content) {
      // Liquid-based theme or file unreadable — can't detect. Deep-link
      // flow will still work for themes that support app blocks.
      return { status: "needs_install", themeId, debug };
    }
    debug.fileFound = true;

    const rawContent = fileNode.body.content;
    const templateJson =
      typeof rawContent === "string"
        ? parseLenientJson(rawContent)
        : (rawContent as Record<string, unknown>);

    if (!templateJson) {
      return { status: "needs_install", themeId, debug };
    }
    debug.parseOk = true;

    const scan = scanTemplateForBlock(templateJson);
    debug.sectionCount = scan.sectionCount;
    debug.blockTypesSeen = scan.blockTypesSeen;
    debug.ourBlockCount = scan.ourBlockCount;

    if (scan.ourBlockCount > 0) {
      return { status: "already_installed", themeId, debug };
    }

    return { status: "needs_install", themeId, debug };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unexpected error checking theme";
    console.error("[install-theme-block] error:", err);
    return { status: "error", message, debug };
  }
}
