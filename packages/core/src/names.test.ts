import { expect, it } from "vitest";
import { displayName } from "./names.js";

it("handles surname-first legal names using the short name as the anchor", () => {
  // The real case that broke a word-position rule: surname, first name, father's name.
  expect(displayName("LADANI BHAVY RAJESHBHAI", "Bhavy")).toBe("Bhavy Ladani");
});

it("handles first-name-first legal names", () => {
  expect(displayName("BHAVY RAJESHBHAI LADANI", "BHAVY")).toBe("Bhavy Ladani");
  expect(displayName("ANIL KUMAR SINGH CHAUHAN", "Anil")).toBe("Anil Chauhan");
});

it("never drops words without an anchor: shows the full name instead", () => {
  expect(displayName("LADANI BHAVY RAJESHBHAI")).toBe("Ladani Bhavy Rajeshbhai");
  expect(displayName("LADANI BHAVY RAJESHBHAI", "Bob")).toBe("Ladani Bhavy Rajeshbhai");
});

it("re-cases short names and keeps hyphens and apostrophes", () => {
  expect(displayName("MEERA IYER", "Meera")).toBe("Meera Iyer");
  expect(displayName("RAVI")).toBe("Ravi");
  expect(displayName("JEAN-PAUL D'SOUZA")).toBe("Jean-Paul D'Souza");
  expect(displayName("", "Ravi")).toBe("Ravi");
});
