"use client";

import { Odometer, useDirection } from "./Odometer";

/**
 * A number that rolls its changed digits, odometer-style, when the data refreshes:
 * up when it rose, down when it fell. The first render shows the value as is:
 * animating on page load is decoration, not information.
 */
export function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const dir = useDirection(value);
  return <Odometer text={format(value)} dir={dir} />;
}
