import { IncortaAuthProvider } from "@incorta/auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { Button } from "@incorta/ui/components/button";
import { Toaster } from "@incorta/ui/components/sonner";
import { TooltipProvider } from "@incorta/ui/components/tooltip";
import { type ReactNode } from "react";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">
          Page not found
        </h2>
        <p className="mt-2 text-sm text-secondary-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          {/* Base UI composes through `render`, not `asChild`. */}
          <Button render={<Link to="/" />} nativeButton={false}>
            Go home
          </Button>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-secondary-foreground">
          Something went wrong on our end. You can try refreshing or head back
          home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button
            onClick={() => {
              router.invalidate();
              reset();
            }}
          >
            Try again
          </Button>
          <Button
            variant="outline"
            render={<a href="/" />}
            nativeButton={false}
          >
            Go home
          </Button>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    head: () => ({
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: "ESNS PM Dashboard" },
        { name: "description", content: "Project overview, commitments, invoicing and cost performance for ESNS PMs." },
        { property: "og:title", content: "ESNS PM Dashboard" },
        {
          property: "og:description",
          content: "Project overview, commitments, invoicing and cost performance for ESNS PMs.",
        },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
      links: [
        {
          rel: "stylesheet",
          href: appCss,
        },
      ],
    }),
    shellComponent: RootShell,
    component: RootComponent,
    notFoundComponent: NotFoundComponent,
    errorComponent: ErrorComponent,
  },
);

function RootShell({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning covers each element's OWN attributes only:
    // browser extensions (Grammarly, LastPass, dark-mode…) stamp attributes
    // onto <html>/<body> before React hydrates, which would otherwise log a
    // hydration-mismatch error on every load for every user with such an
    // extension. Mismatches deeper in the tree still warn — this does not
    // mask real hydration bugs in app code.
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    // Incorta auth context: every route can read the signed-in user via
    // useUser()/useAuth() from @incorta/auth/react. The actual access gate
    // is server-side (src/server.ts) — keep this provider mounted.
    <IncortaAuthProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </IncortaAuthProvider>
  );
}
