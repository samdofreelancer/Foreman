import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import { normalizeRoute, routeTitle, routes, type AppRoute } from "./routes"

type StartupState = "loading" | "ready" | "error"

async function establishSession(): Promise<void> {
  const response = await fetch("/api/session", { credentials: "same-origin", headers: { accept: "application/json" } })
  if (!response.ok) throw new Error("Foreman could not establish a secure local session.")
  const payload: unknown = await response.json()
  if (!payload || typeof payload !== "object" || !("csrfToken" in payload) || typeof payload.csrfToken !== "string") {
    throw new Error("Foreman received an invalid session response. Refresh the application to try again.")
  }
}

function Icon(props: { name: string; size?: number }) {
  const size = () => props.size ?? 19
  const common = { width: size(), height: size(), viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 1.7, "stroke-linecap": "round" as const, "stroke-linejoin": "round" as const, "aria-hidden": true }
  return <svg {...common}>
    {props.name === "board" && <><rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="13" rx="1"/></>}
    {props.name === "projects" && <><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H10l2 2h7.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><path d="M3 10h18"/></>}
    {props.name === "inbox" && <><path d="M4 4h16l1 11h-5l-2 3h-4l-2-3H3z"/><path d="M3 15h5l2 3h4l2-3h5"/></>}
    {props.name === "activity" && <><path d="M3 12h4l3-8 4 16 3-8h4"/></>}
    {props.name === "settings" && <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.2.9-1.2 2.1-1.4-.6a8 8 0 0 1-1.7 1l-.2 1.5h-2.4l-.2-1.5a8 8 0 0 1-1.8-1l-1.3.6-1.2-2.1 1.2-.9a7 7 0 0 1 0-2l-1.2-.9 1.2-2.1 1.3.6a8 8 0 0 1 1.8-1l.2-1.5h2.4l.2 1.5a8 8 0 0 1 1.7 1l1.4-.6 1.2 2.1-1.2.9a7 7 0 0 1 0 2Z" transform="translate(-1 -1)"/></>}
    {props.name === "chevron" && <path d="m9 18 6-6-6-6"/>}
    {props.name === "close" && <path d="m6 6 12 12M18 6 6 18"/>}
    {props.name === "menu" && <><path d="M4 7h16M4 12h16M4 17h16"/></>}
    {props.name === "arrow" && <><path d="M7 17 17 7M7 7h10v10"/></>}
    {props.name === "refresh" && <><path d="M20 7v5h-5"/><path d="M4.8 9a8 8 0 0 1 13.5-2L20 12M4 17v-5h5"/><path d="M19.2 15a8 8 0 0 1-13.5 2L4 12"/></>}
  </svg>
}

export function App() {
  if (window.location.pathname === "/") window.history.replaceState({}, "", "/board")
  const [route, setRoute] = createSignal<AppRoute>(normalizeRoute(window.location.pathname))
  const [startup, setStartup] = createSignal<StartupState>("loading")
  const [startupError, setStartupError] = createSignal("")
  const [drawerOpen, setDrawerOpen] = createSignal(false)
  const [serverOnline, setServerOnline] = createSignal(true)

  const navigate = (path: AppRoute) => {
    if (window.location.pathname !== path) window.history.pushState({}, "", path)
    setRoute(path)
    setDrawerOpen(false)
  }

  const onPopState = () => { setRoute(normalizeRoute(window.location.pathname)); setDrawerOpen(false) }
  window.addEventListener("popstate", onPopState)
  onCleanup(() => window.removeEventListener("popstate", onPopState))

  const initialize = async () => {
    setStartup("loading")
    setStartupError("")
    try {
      const health = await fetch("/api/health", { cache: "no-store" })
      if (!health.ok) throw new Error("The local Foreman service is not healthy.")
      const healthPayload: unknown = await health.json()
      if (healthPayload && typeof healthPayload === "object" && "status" in healthPayload && healthPayload.status === "degraded") {
        const database = "database" in healthPayload && healthPayload.database && typeof healthPayload.database === "object" ? healthPayload.database : undefined
        const message = database && "message" in database && typeof database.message === "string" ? database.message : "The local database is unavailable."
        throw new Error(message)
      }
      await establishSession()
      setServerOnline(true)
      setStartup("ready")
    } catch (error) {
      setServerOnline(false)
      setStartupError(error instanceof Error ? error.message : "Unable to connect to the local Foreman service.")
      setStartup("error")
    }
  }

  createEffect(() => { void initialize() })

  const activeTitle = () => routeTitle(route())

  return <Show when={startup() === "ready"} fallback={
    <main class="startup-screen" aria-live="polite">
      <div class="startup-brand"><span class="brand-mark">F</span><span>foreman</span></div>
      <Show when={startup() === "loading"} fallback={
        <section class="startup-card" role="alert">
          <div class="startup-icon startup-icon-error">!</div>
          <p class="eyebrow">LOCAL SERVICE UNAVAILABLE</p>
          <h1>We couldn't start Foreman.</h1>
          <p class="muted">{startupError()}</p>
          <button class="button button-primary" onClick={() => void initialize()}><Icon name="refresh" size={16}/> Try again</button>
        </section>
      }>
        <section class="startup-card">
          <div class="loader" />
          <p class="eyebrow">INITIALIZING WORKSPACE</p>
          <h1>Getting things ready.</h1>
          <p class="muted">Starting your local control plane…</p>
        </section>
      </Show>
      <p class="startup-footnote">Runs locally. Your tasks stay on this machine.</p>
    </main>
  }>
    <div class="app-frame">
      <Show when={drawerOpen()}><button class="drawer-backdrop" aria-label="Close navigation" onClick={() => setDrawerOpen(false)} /></Show>
      <aside classList={{ sidebar: true, "sidebar-open": drawerOpen() }} aria-label="Main navigation">
        <div class="sidebar-brand">
          <span class="brand-mark">F</span><span class="brand-name">foreman</span>
          <button class="icon-button sidebar-close" aria-label="Close navigation" onClick={() => setDrawerOpen(false)}><Icon name="close"/></button>
        </div>
        <div class="workspace-switcher">
          <div class="workspace-avatar">W</div>
          <div class="workspace-copy"><strong>My workspace</strong><span>Local workspace</span></div>
          <span class="workspace-chevron"><Icon name="chevron" size={15}/></span>
        </div>
        <div class="nav-section-label">WORKSPACE</div>
        <nav class="primary-nav" aria-label="Main navigation">
          <For each={routes}>{(item) => <a href={item.path} classList={{ "nav-link": true, active: route() === item.path }} aria-current={route() === item.path ? "page" : undefined} onClick={(event) => { event.preventDefault(); navigate(item.path) }}>
            <Icon name={item.icon}/><span>{item.label}</span><Show when={item.path === "/inbox"}><span class="nav-count">0</span></Show>
          </a>}</For>
        </nav>
        <div class="sidebar-spacer" />
        <div class="runtime-card">
          <div class="runtime-card-top"><span class="status-dot status-muted"/><span>OpenCode</span><span class="runtime-state">Disconnected</span></div>
          <p>Connect a runtime to start executing tasks.</p>
          <button class="runtime-link" onClick={() => navigate("/settings")}>Connection settings <Icon name="arrow" size={14}/></button>
        </div>
        <a classList={{ "nav-link": true, "settings-link": true, active: route() === "/settings" }} href="/settings" onClick={(event) => { event.preventDefault(); navigate("/settings") }}><Icon name="settings"/><span>Settings</span></a>
        <div class="sidebar-footer"><span class="avatar">G</span><div><strong>Local user</strong><small>Personal workspace</small></div><span class="footer-menu">···</span></div>
      </aside>

      <div class="main-panel">
        <header class="topbar">
          <button class="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setDrawerOpen(true)}><Icon name="menu"/></button>
          <div class="breadcrumbs"><span>Workspace</span><Icon name="chevron" size={14}/><strong>{activeTitle()}</strong></div>
          <div class="topbar-actions"><span class="local-indicator"><span class="status-dot status-online"/>Local app running</span><span class="topbar-divider"/><button class="help-button" aria-label="Application version">v0.1.0</button></div>
        </header>
        <main class="page-content" id="main-content" tabindex="-1">
          <Show when={route() === "/board"}>
            <div class="page-heading"><div><p class="eyebrow">YOUR WORKSPACE</p><h1>Board</h1><p class="page-description">A clear view of what you're working on.</p></div><div class="heading-actions"><span class="runtime-pill"><span class="status-dot status-muted"/>OpenCode disconnected</span></div></div>
            <section class="welcome-panel">
              <div class="welcome-copy"><span class="welcome-kicker">YOUR CONTROL PLANE</span><h2>Make progress visible.<br/><span>Keep the work moving.</span></h2><p>Foreman brings your tasks and OpenCode sessions into one focused workspace. Your local app is ready; task management is the next milestone.</p><button class="button button-primary" onClick={() => navigate("/projects")}>Explore workspace <Icon name="arrow" size={16}/></button></div>
              <div class="welcome-visual" aria-hidden="true"><div class="visual-orbit orbit-one"/><div class="visual-orbit orbit-two"/><div class="visual-core"><span>F</span></div><div class="visual-node node-one"><i/><b>Plan</b></div><div class="visual-node node-two"><i/><b>Build</b></div><div class="visual-node node-three"><i/><b>Review</b></div></div>
            </section>
            <div class="section-heading"><div><h2>Workspace overview</h2><p>Everything starts with a task.</p></div><span class="section-meta">PHASE 4 · FOUNDATION</span></div>
            <div class="overview-grid">
              <article class="overview-card"><div class="overview-card-head"><span class="metric-icon metric-green"><Icon name="board"/></span><span class="card-state">Coming next</span></div><strong class="metric-value">—</strong><h3>Tasks</h3><p>Your work, organized into a focused four-column board.</p></article>
              <article class="overview-card"><div class="overview-card-head"><span class="metric-icon metric-blue"><Icon name="projects"/></span><span class="card-state">Coming next</span></div><strong class="metric-value">—</strong><h3>Projects</h3><p>Keep work grouped by local project and repository.</p></article>
              <article class="overview-card"><div class="overview-card-head"><span class="metric-icon metric-amber"><Icon name="inbox"/></span><span class="card-state">Runtime offline</span></div><strong class="metric-value">0</strong><h3>Needs attention</h3><p>Permissions, questions, and issues will appear here.</p></article>
            </div>
          </Show>
          <Show when={route() !== "/board"}>
            <div class="page-heading"><div><p class="eyebrow">WORKSPACE</p><h1>{activeTitle()}</h1><p class="page-description">{routes.find((item) => item.path === route())?.description ?? "Configure how Foreman works on this machine."}</p></div></div>
            <section class="placeholder-panel"><div class="placeholder-icon"><Icon name={route() === "/settings" ? "settings" : routes.find((item) => item.path === route())?.icon ?? "board"} size={23}/></div><p class="eyebrow">PHASE {route() === "/settings" ? "8" : "5"}</p><h2>{route() === "/settings" ? "Connection settings are next." : `${activeTitle()} is taking shape.`}</h2><p>{route() === "/settings" ? "Managed and external OpenCode connection controls will arrive in the connection phase." : "This view will be connected to your local Foreman data in the task management phase."}</p><button class="text-button" onClick={() => navigate("/board")}>Back to Board <Icon name="arrow" size={15}/></button></section>
          </Show>
          <footer class="page-footer"><span><span class="status-dot status-online"/> Foreman is running locally</span><span>Your data stays on this machine</span></footer>
        </main>
      </div>
    </div>
  </Show>
}
