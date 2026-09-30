import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import Layout, { RequireAuth } from "./pages/Layout";
import LoginPage from "./pages/LoginPage";
import FlowsPage from "./pages/FlowsPage";
import SubmissionsPage from "./pages/SubmissionsPage";
import SessionsPage from "./pages/SessionsPage";
import { Toaster } from "./lib/toast";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000 } },
});

const router = createBrowserRouter(
  [
    { path: "/login", element: <LoginPage /> },
    {
      element: <RequireAuth />,
      children: [
        {
          element: <Layout />,
          children: [
            { index: true, element: <FlowsPage /> },
            { path: "submissions", element: <SubmissionsPage /> },
            { path: "sessions", element: <SessionsPage /> },
          ],
        },
        // React Flow is the heavy part of the bundle; load it only when a flow is opened.
        { path: "flows/:id", lazy: async () => ({ Component: (await import("./pages/EditorPage")).default }) },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, "") },
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
);
