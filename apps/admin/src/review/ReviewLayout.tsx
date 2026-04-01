import { AppNavLayout } from "../shell/AppNavLayout";
import { ReviewRunsProvider } from "./ReviewRunsContext";

/** Review state is remounted when the operator store changes (same as prior `key` on the screen). */
export function ReviewLayout({ remountKey }: { remountKey: string }) {
  return (
    <ReviewRunsProvider key={remountKey}>
      <AppNavLayout />
    </ReviewRunsProvider>
  );
}
