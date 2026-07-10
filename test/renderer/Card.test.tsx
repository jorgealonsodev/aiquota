import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Card } from "../../src/renderer/Card";
import type { InstanceViewModel } from "../../src/shared/ipc";

function instance(overrides: Partial<InstanceViewModel> = {}): InstanceViewModel {
  return {
    instanceId: "codex-1",
    label: "Codex",
    enabled: true,
    status: "healthy",
    windows: [],
    ...overrides,
  };
}

describe("Card (quota-popup spec)", () => {
  it("renders the instance label", () => {
    const html = renderToStaticMarkup(<Card instance={instance()} />);
    expect(html).toContain("Codex");
  });

  it("renders per-window utilization and label", () => {
    const html = renderToStaticMarkup(
      <Card
        instance={instance({
          windows: [
            { kind: "five_hour", label: "Last 5 hours", utilization: 75, resetsAt: null },
            { kind: "seven_day", label: "Last 7 days", utilization: 45, resetsAt: null },
          ],
        })}
      />,
    );

    expect(html).toContain("Last 5 hours");
    expect(html).toContain("75%");
    expect(html).toContain("Last 7 days");
    expect(html).toContain("45%");
  });

  it("renders an auth-expired state as a reconnect prompt", () => {
    const html = renderToStaticMarkup(<Card instance={instance({ status: "auth-expired", windows: [] })} />);

    expect(html).toContain("Reconnect");
  });

  it("renders a network error state", () => {
    const html = renderToStaticMarkup(<Card instance={instance({ status: "network", windows: [] })} />);

    expect(html).toContain("Offline");
  });

  it("renders a provider-broken error state", () => {
    const html = renderToStaticMarkup(<Card instance={instance({ status: "provider-broken", windows: [] })} />);

    expect(html).toContain("error");
  });

  it("renders an unconfigured placeholder", () => {
    const html = renderToStaticMarkup(<Card instance={instance({ status: "unconfigured", windows: [] })} />);

    expect(html).toContain("Not configured");
  });

  it("includes a refresh button for healthy instances", () => {
    const html = renderToStaticMarkup(<Card instance={instance()} />);

    expect(html).toContain("Refresh");
  });
});
