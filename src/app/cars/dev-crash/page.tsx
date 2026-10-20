import { Suspense } from "react";
import Harness from "./Harness";

// TEMPORARY dev harness for the crash lab's scene (delete before shipping)
export default function Page() {
  return (
    <Suspense fallback={null}>
      <Harness />
    </Suspense>
  );
}
