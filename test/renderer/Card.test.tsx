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

  it("wires the Reconnect button to this instance via aria-label (renderToStaticMarkup cannot fire onClick, so this asserts the button is bound to the instance rather than a dead/generic control)", () => {
    const html = renderToStaticMarkup(<Card instance={instance({ status: "auth-expired", label: "Claude Work", windows: [] })} />);

    expect(html).toContain('aria-label="Reconnect Claude Work"');
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

  it("shows a live reset countdown instead of an absolute clock time (quota-popup spec: Countdown reflects remaining time)", () => {
    const now = new Date("2026-07-13T12:00:00.000Z");
    const resetsAt = new Date(now.getTime() + 90 * 60 * 1000).toISOString();
    const html = renderToStaticMarkup(
      <Card
        instance={instance({
          windows: [{ kind: "five_hour", label: "Last 5 hours", utilization: 50, resetsAt }],
        })}
        now={now}
      />,
    );

    expect(html).toContain("1h 30m remaining");
  });

  it("shows the last-updated indicator using the injected clock (quota-popup spec: Last update shown)", () => {
    const now = new Date("2026-07-13T12:00:00.000Z");
    const fetchedAt = now.getTime() - 3 * 60 * 1000;
    const html = renderToStaticMarkup(<Card instance={instance({ fetchedAt })} now={now} />);

    expect(html).toContain("last updated 3 minutes ago");
  });
});
