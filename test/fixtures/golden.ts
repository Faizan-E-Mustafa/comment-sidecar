import { session } from "./session";

export function App() {
  const ready = session.ready;
  if (!ready) return null;
  const label = "日本語 🧪";
  }
  return render(label);
}
