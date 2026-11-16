import {
  BrowserRouter,
  Link,
  Outlet,
  Route,
  Routes,
  Navigate,
  useLocation,
} from "react-router";
import { css, cx } from "../../styled-system/css/index.js";
import { button, panel } from "../../styled-system/recipes/index.js";
import { useAppDispatch, useAppSelector } from "./hooks.ts";
import { selectMatch } from "./matchSlice.ts";
import { selectConnection } from "./connectionSlice.ts";
import { selectScreen } from "./navigation.ts";
import { send } from "./store.ts";
import ProtocolGame from "./ProtocolGame.tsx";

function Shell() {
  const { pathname } = useLocation();
  const screen = useAppSelector(selectScreen);
  const normalizedPath = pathname.toLowerCase().replace(/\/+$/, "") || "/";
  if (
    ["/", "/waiting", "/match", "/result"].includes(normalizedPath) &&
    pathname !== screen
  )
    return <Navigate to={screen} replace />;
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
  const dispatch = useAppDispatch();
  const { status } = useAppSelector(selectConnection);
  const { pending } = useAppSelector(selectMatch);
  return (
    <>
      <section className={panel()}>
        <p className={css({ color: "muted", my: "lg" })}>
          A contest of myth across three lanes.
        </p>
        <button
          className={button()}
          disabled={status !== "connected" || pending !== null}
          onClick={() => {
            dispatch(send({ type: "join" }));
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
