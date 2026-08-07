import { type JSX, ErrorBoundary as SolidErrorBoundary } from "solid-js";
import Icon from "./icons";

interface ErrorBoundaryProps {
  children: JSX.Element;
}

export default function ErrorBoundary({ children }: ErrorBoundaryProps) {
  return (
    <SolidErrorBoundary
      fallback={(err) => (
        <div class="holos-error">
          <div class="holos-error__card">
            <div class="holos-error__head">
              <Icon name="alert" size={20} color="var(--holos-danger)" />
              <div>
                <p class="holos-error__title">Monitor Board crashed</p>
                <p class="holos-error__message">
                  {err instanceof Error ? err.message : String(err ?? "Unknown error")}
                </p>
              </div>
            </div>
            <div class="holos-error__actions">
              <button
                type="button"
                class="holos-btn"
                onClick={() => {
                  // Solid ErrorBoundary reset via keyed remount of children is
                  // handled by the fallback contract; here we just clear the DOM.
                  window.location.reload();
                }}
              >
                <Icon name="refresh" size={12} color="var(--holos-accent)" />
                Reload
              </button>
            </div>
          </div>
        </div>
      )}
    >
      {children}
    </SolidErrorBoundary>
  );
}
