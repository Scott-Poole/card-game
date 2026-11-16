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
import ProtocolGame from "./ProtocolGame.tsx";

function Shell() {
  const { pathname } = useLocation();
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
        <div hidden={pathname !== "/"}>
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
  const navigate = useNavigate();
  return (
    <>
      <section className={panel()}>
        <p className={css({ color: "muted", my: "lg" })}>
          A contest of myth across three lanes.
        </p>
        <button
          className={button()}
          onClick={() => {
            void navigate("/waiting");
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
          <Route
            path="waiting"
            element={
              <Screen
                title="Waiting"
                description="The next contest awaits."
                to="/match"
                action="Preview match"
              />
            }
          />
          <Route
            path="match"
            element={
              <Screen
                title="Match"
                description="Three lanes. Six turns. Your board will appear here."
                to="/result"
                action="Preview result"
              />
            }
          />
          <Route
            path="result"
            element={
              <Screen
                title="Result"
                description="The outcome of your contest will appear here."
                to="/"
                action="Home"
              />
            }
          />
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
