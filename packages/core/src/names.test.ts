import { expect, it } from "vitest";
import { displayName } from "./names.js";

it("keeps first name and surname, drops the middle name, and fixes the casing", () => {
  expect(displayName("BHAVY RAJESHKUMAR LADANI")).toBe("Bhavy Ladani");
  expect(displayName("  priya   s   nair ")).toBe("Priya Nair");
  expect(displayName("ANIL KUMAR SINGH CHAUHAN")).toBe("Anil Chauhan");
});

it("leaves short names whole and handles hyphens and apostrophes", () => {
  expect(displayName("RAVI")).toBe("Ravi");
  expect(displayName("meera iyer")).toBe("Meera Iyer");
  expect(displayName("JEAN-PAUL D'SOUZA")).toBe("Jean-Paul D'Souza");
  expect(displayName("")).toBe("");
});
