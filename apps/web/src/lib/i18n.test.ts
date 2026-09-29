// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import i18n from "./i18n";

describe("language selection", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("switches the application to Nepali and persists the selection", async () => {
    await i18n.changeLanguage("ne");

    expect(i18n.t("nav.dashboard")).toBe("ड्यासबोर्ड");
    expect(i18n.t("common.signOut")).toBe("साइन आउट");
    expect(document.documentElement.lang).toBe("ne");
    expect(localStorage.getItem("nhp_language")).toBe("ne");
  });
});
