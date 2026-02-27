export const getInputValue = (event: Event, fallback = ""): string => {
  const target = event.target as { value?: string } | null;
  return target && typeof target.value === "string" ? target.value : fallback;
};
