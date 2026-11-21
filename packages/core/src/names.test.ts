import { expect, it } from "vitest";
import { displayName } from "./names.js";

it("uses the name the user chose, exactly as typed", () => {
  expect(displayName("LADANI BHAVY RAJESHBHAI", "Bhavy Ladani")).toBe("Bhavy Ladani");
  expect(displayName("LADANI BHAVY RAJESHBHAI", "  Bhavy   Ladani ")).toBe("Bhavy Ladani");
});

it("never guesses which word is the first name: shows the full legal name", () => {
  // Kite's short name for this account is the surname, which broke a guessing rule twice.
  expect(displayName("LADANI BHAVY RAJESHBHAI")).toBe("Ladani Bhavy Rajeshbhai");
  expect(displayName("LADANI BHAVY RAJESHBHAI", "")).toBe("Ladani Bhavy Rajeshbhai");
  expect(displayName("LADANI BHAVY RAJESHBHAI", null)).toBe("Ladani Bhavy Rajeshbhai");
});

it("re-cases names and keeps hyphens and apostrophes", () => {
  expect(displayName("MEERA IYER")).toBe("Meera Iyer");
  expect(displayName("JEAN-PAUL D'SOUZA")).toBe("Jean-Paul D'Souza");
});
