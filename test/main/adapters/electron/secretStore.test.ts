import { describe, expect, it } from "vitest";
import { maskCookie } from "../../../../src/main/adapters/electron/secretStore";

describe("maskCookie (credential-store spec, No Plaintext Credentials in Logs)", () => {
  it("keeps the first 4 and last 4 characters and masks the middle", () => {
    expect(maskCookie("sk-ant-sid01-abcdefghijklmnopqrstuvwxyz")).toBe("sk-a...wxyz");
  });

  it("fully masks values too short to safely reveal any substring", () => {
    expect(maskCookie("abc")).toBe("***");
  });

  it("masks a different value to a different result, proving it isn't a hardcoded string", () => {
    expect(maskCookie("cookie-value-1234567890")).toBe("cook...7890");
    expect(maskCookie("cookie-value-1234567890")).not.toBe(maskCookie("sk-ant-sid01-abcdefghijklmnopqrstuvwxyz"));
  });
});
