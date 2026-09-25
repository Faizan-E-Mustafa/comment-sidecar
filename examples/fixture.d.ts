declare namespace JSX {
  interface Element { readonly fixtureElement: unique symbol }
}

type FixtureUser = { name: string };
declare function useSession(): { user: FixtureUser | null; loading: boolean };
declare function Splash(): JSX.Element;
declare function Login(): JSX.Element;
declare function Dashboard(props: { user: FixtureUser }): JSX.Element;
