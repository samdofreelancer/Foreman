export const routes = [
  { path: "/board", label: "Board", description: "Your work, organized around tasks", icon: "board" },
  { path: "/projects", label: "Projects", description: "Your local workspaces", icon: "projects" },
  { path: "/inbox", label: "Inbox", description: "Things that need your attention", icon: "inbox" },
  { path: "/activity", label: "Activity", description: "A timeline of work in Foreman", icon: "activity" },
] as const

export type AppRoute = (typeof routes)[number]["path"] | "/settings"

export function normalizeRoute(pathname: string): AppRoute {
  if (pathname === "/" || pathname === "") return "/board"
  if (routes.some((route) => route.path === pathname)) return pathname as AppRoute
  if (pathname === "/settings") return "/settings"
  return "/board"
}

export function routeTitle(pathname: string): string {
  const route = normalizeRoute(pathname)
  return routes.find((item) => item.path === route)?.label ?? "Settings"
}
