export const getInputValue = (event: Event, fallback = ""): string => {
  const target = event.target as { value?: string } | null;
  return target && typeof target.value === "string" ? target.value : fallback;
};

export const parseNumberInput = (event: Event, fallback: number): number => {
  const rawValue = (event.target as { value?: string }).value ?? "";
  const parsedValue = Number.parseFloat(rawValue);
  return Number.isNaN(parsedValue) ? fallback : parsedValue;
};
