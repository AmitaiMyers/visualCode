import { useCallback } from "react";
import { AppShell } from "./app/AppShell";
import { WorkspaceProvider } from "./state/workspace";
import { ToastProvider, useToast } from "./ui/Toasts";

export function App() {
  return (
    <ToastProvider>
      <WorkspaceWithToasts />
    </ToastProvider>
  );
}

/** Review saves happen in the background; a failure is reported as an error toast. */
function WorkspaceWithToasts() {
  const toast = useToast();
  const onSaveError = useCallback((message: string) => toast({ message, tone: "error" }), [toast]);
  return (
    <WorkspaceProvider onSaveError={onSaveError}>
      <AppShell />
    </WorkspaceProvider>
  );
}
