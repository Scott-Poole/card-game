import {
  BrowserRouter,
  Link,
  Outlet,
  Route,
  Routes,
  useNavigate,
  useLocation,
} from "react-router";
import { css, cx } from "../../styled-system/css/index.js";
import { button, panel } from "../../styled-system/recipes/index.js";
import { useEffect, useRef } from "react";
import { useAppSelector } from "./hooks.ts";
import { selectScreen } from "./matchSlice.ts";
import { send } from "./store.ts";
import ProtocolGame from "./ProtocolGame.tsx";

function Shell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const screen = useAppSelector(selectScreen);
  const previousScreen = useRef("/");
  useEffect(() => {
    if (screen === previousScreen.current) return;
    previousScreen.current = screen;
    void navigate(screen);
  }, [screen, navigate]);
  return (
    <main
      className={css({
        minH: "[100dvh]",
        bg: "surface",
        color: "text",
        pt: "[max(env(safe-area-inset-top), {spacing.lg})]",
        pb: "[max(env(safe-area-inset-bottom), {spacing.lg})]",
        pl: "[max(env(safe-area-inset-left), {spacing.md})]",
        pr: "[max(env(safe-area-inset-right), {spacing.md})]",
      })}
    >
      <div className={css({ maxW: "content", mx: "auto" })}>
        {pathname === "/" && <h1>Home</h1>}
        <div>
          <ProtocolGame />
        </div>
        <Outlet />
      </div>
    </main>
  );
}

function Screen({
  title,
  description,
  to,
  action,
}: {
  title: string;
  description: string;
  to: string;
  action: string;
}) {
  return (
    <section className={cx(panel(), css({ p: { base: "md", md: "lg" } }))}>
      <h1>{title}</h1>
      <p className={css({ color: "muted", my: "lg" })}>{description}</p>
      <Link className={button()} to={to}>
        {action}
      </Link>
    </section>
  );
}

function Home() {
  return (
    <>
      <section className={panel()}>
        <p className={css({ color: "muted", my: "lg" })}>
          A contest of myth across three lanes.
        </p>
        <button
          className={button()}
          onClick={() => {
            send({ type: "join" });
          }}
        >
          Play
        </button>
      </section>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="waiting" element={<h1>Waiting</h1>} />
          <Route path="match" element={<h1>Match</h1>} />
          <Route path="result" element={<h1>Result</h1>} />
          <Route
            path="*"
            element={
              <Screen
                title="Page not found"
                description="This path leads beyond the board."
                to="/"
                action="Home"
              />
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
