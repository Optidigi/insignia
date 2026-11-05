import { useEffect, useState } from "preact/hooks";
import type { TargetedMouseEvent as MouseEvent } from "preact";
import { scenarios } from "./scenario-catalog";
import { ThemeControl } from "./theme";
import { LocalDesigner } from "./demo/local-designer";
import { AdminPreview } from "./admin-preview";

export function PreviewShell() {
  const [location, setLocation] = useState(() => new URL(window.location.href));
  useEffect(() => {
    const onPop = () => setLocation(new URL(window.location.href));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  function navigate(url: URL) {
    window.history.pushState({}, "", url);
    setLocation(url);
  }
  function navigateLink(event: MouseEvent<HTMLAnchorElement>, url: URL) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey
    )
      return;
    event.preventDefault();
    navigate(url);
  }
  const id = location.searchParams.get("scenario") ?? "classic";
  const scenario = scenarios.find((entry) => entry.id === id);
  const example = location.searchParams.get("example") === "accordion";
  const lab = location.searchParams.get("lab") === "1";
  if (location.searchParams.has("adminPreview")) {
    return (
      <AdminPreview
        nonce={location.searchParams.get("adminPreview")}
        locale={location.searchParams.get("locale") ?? "en"}
      />
    );
  }
  function scenarioUrl(next: string, withArtwork: boolean, controls = true) {
    const url = new URL("/", location);
    url.searchParams.set("scenario", next);
    if (withArtwork) url.searchParams.set("example", "accordion");
    if (controls) url.searchParams.set("lab", "1");
    const locale = location.searchParams.get("locale");
    if (locale) url.searchParams.set("locale", locale);
    return url;
  }
  if (location.pathname === "/scenarios" || !scenario)
    return (
      <main className="scenario-page">
        <header>
          <h1>Preview scenarios</h1>
          <ThemeControl />
          <p>
            Fictional store configurations for testing the designer. Switching
            scenarios starts a new local design.
          </p>
        </header>
        {!scenario && (
          <p role="alert">Unknown scenario: {id}. Choose one below.</p>
        )}
        <div className="scenario-cards">
          {scenarios.map((entry) => (
            <article key={entry.id}>
              <h2>{entry.name}</h2>
              <p>{entry.description}</p>
              <dl>
                {[
                  ["Colours", entry.colors.length],
                  ["Sizes", entry.sizes.length],
                  ["Views", entry.views.length],
                  ["Placements", entry.positions.length],
                  ["Methods", entry.methods.length],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="scenario-actions">
                <a
                  className="primary-button"
                  href={
                    scenarioUrl(entry.id, true).pathname +
                    scenarioUrl(entry.id, true).search
                  }
                  onClick={(event) =>
                    navigateLink(event, scenarioUrl(entry.id, true))
                  }
                >
                  Preview example
                </a>
                <a
                  className="text-action"
                  href={
                    scenarioUrl(entry.id, false).pathname +
                    scenarioUrl(entry.id, false).search
                  }
                  onClick={(event) =>
                    navigateLink(event, scenarioUrl(entry.id, false))
                  }
                >
                  Start empty
                </a>
              </div>
            </article>
          ))}
        </div>
      </main>
    );
  return (
    <div className={lab ? "preview-shell" : undefined}>
      {lab && (
        <aside
          className="preview-switcher"
          aria-label="Preview controls"
          onKeyDown={(event) => event.stopPropagation()}
        >
          <a
            href="/scenarios"
            onClick={(event) =>
              navigateLink(event, new URL("/scenarios", location))
            }
          >
            All scenarios
          </a>
          <label>
            Product
            <select
              aria-label="Preview scenario"
              value={id}
              onChange={(event) =>
                navigate(scenarioUrl(event.currentTarget.value, example))
              }
            >
              {scenarios.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Start
            <select
              aria-label="Preview starting state"
              value={example ? "example" : "empty"}
              onChange={(event) =>
                navigate(
                  scenarioUrl(id, event.currentTarget.value === "example"),
                )
              }
            >
              <option value="empty">Empty design</option>
              <option value="example">With artwork</option>
            </select>
          </label>
          <a
            className="preview-hide"
            href={scenarioUrl(id, example, false).toString()}
            onClick={(event) => {
              const url = new URL(location);
              url.searchParams.delete("lab");
              navigateLink(event, url);
            }}
          >
            Hide controls
          </a>
        </aside>
      )}
      <LocalDesigner
        key={`${scenario.id}:${example}`}
        config={scenario}
        locale={location.searchParams.get("locale") ?? undefined}
        showExample={example}
        onLocationChange={() => setLocation(new URL(window.location.href))}
      />
    </div>
  );
}
