import { useContext } from "react";
import { ARControlContext } from "./ar-control-context";

export function useARControls() {
  const context = useContext(ARControlContext);
  if (context === undefined) {
    throw new Error("useARControls must be used within an ARControlProvider");
  }
  return context;
}
