export function App() {
  const { user, loading } = useSession();

  if (loading) return <Splash />;
  if (!user) return <Login />;

  return <Dashboard user={user} />;
}
