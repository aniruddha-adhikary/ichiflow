import { describe, expect, it } from "vitest";
import {
  defaultDeliverySpi,
  runDelivery,
  poisonAwareReceiver,
  selectDriver,
} from "../src/delivery.js";
import { render, RenderError } from "../src/templating.js";
import { runNotifications } from "../src/run.js";
import type { NotificationRequest, NotificationTemplate } from "../src/types.js";

const emailTemplate: NotificationTemplate = {
  schemaVersion: "notification/v1",
  id: "t",
  version: "1.0.0",
  channel: "email",
  codeSet: "codeset://t@1.0.0",
  text: {
    en: { subject: "Hi {{name}}", body: "Ref {{ref}} for {{name}}." },
  },
  params: ["name", "ref"],
};

function request(overrides: Partial<NotificationRequest> = {}): NotificationRequest {
  return {
    schemaVersion: "notification/v1",
    notificationId: "n1",
    correlationId: "c1",
    caseId: "case1",
    stepId: "s1",
    template: "t@1.0.0",
    locale: "en",
    recipient: "x@example.test",
    params: { name: "Ada", ref: "R-1" },
    ...overrides,
  };
}

describe("templating (pure render)", () => {
  it("substitutes declared params into subject + body deterministically", () => {
    expect(render(emailTemplate, request())).toEqual({
      channel: "email",
      locale: "en",
      recipient: "x@example.test",
      subject: "Hi Ada",
      body: "Ref R-1 for Ada.",
    });
  });

  it("drops the subject on an SMS channel", () => {
    const sms: NotificationTemplate = {
      ...emailTemplate,
      channel: "sms",
      text: { en: { body: "Ref {{ref}}" } },
    };
    expect(render(sms, request()).subject).toBeUndefined();
  });

  it("rejects an unresolved locale", () => {
    expect(() => render(emailTemplate, request({ locale: "fr" }))).toThrow(RenderError);
  });

  it("rejects an undeclared supplied param", () => {
    expect(() =>
      render(emailTemplate, request({ params: { name: "Ada", ref: "R-1", extra: "x" } })),
    ).toThrow(RenderError);
  });

  it("rejects a missing declared param the text references", () => {
    expect(() => render(emailTemplate, request({ params: { name: "Ada" } }))).toThrow(RenderError);
  });
});

describe("delivery SPI selection", () => {
  it("selects a distinct provider driver per channel", () => {
    const spi = defaultDeliverySpi();
    expect(selectDriver(spi, "email").id).toBe("smtp-capture");
    expect(selectDriver(spi, "sms").id).toBe("sms-gateway-capture");
  });
});

describe("reliability (Idempotent Receiver + DLQ)", () => {
  it("dedups a duplicate notificationId once and emits notify.deduped", () => {
    const out = runDelivery(
      [{ notificationId: "a" }, { notificationId: "a" }],
      3,
      poisonAwareReceiver(),
    );
    expect({ sent: out.sent, deduped: out.deduped, dlq: out.dlq }).toEqual({
      sent: 1,
      deduped: 1,
      dlq: 0,
    });
    expect(out.events.map((e) => e.type)).toEqual([
      "notify.requested",
      "notify.sent",
      "notify.requested",
      "notify.deduped",
    ]);
  });

  it("quarantines a poison delivery after bounded attempts", () => {
    const out = runDelivery([{ notificationId: "p", poison: true }], 3, poisonAwareReceiver());
    expect(out.dlq).toBe(1);
    expect(out.dispositions[0]!.attempts).toBe(3);
    expect(out.events.map((e) => e.type)).toEqual(["notify.requested", "notify.dlq"]);
  });
});

describe("harness verdict", () => {
  it("is green across render goldens, driver selection and reliability", () => {
    const r = runNotifications();
    expect(r.renderGoldensGreen).toBe(r.renderGoldens.length);
    expect(r.renderGoldens.length).toBeGreaterThan(0);
    expect(r.driverSelectionGreen).toBe(r.driverSelection.length);
    expect(r.dedupPass && r.dlqPass && r.redeliveryPass).toBe(true);
  });
});
