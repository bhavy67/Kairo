"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

/** The current session; shares the cache entry the shell already loaded. */
export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: api.me });
}

/** True only once we know this is the read-only public demo. */
export function useReadOnly(): boolean {
  return useMe().data?.readOnly === true;
}
