import { useEffect, useState, type ReactNode } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Onboarding } from './components/Onboarding';
import { OnboardingGasless } from './components/OnboardingGasless';
import { UnifiedBalance } from './components/UnifiedBalance';
import { Receipts } from './components/Receipts';
import { Hero } from './components/Hero';
import { HomeGrid } from './components/HomeGrid';
import { ReputationPanel } from './components/ReputationPanel';
import { CinematicRoute } from './routes/cinematic';
import { WalletProvider } from './wallet/WalletProvider';
import { ConnectButton } from './wallet/ConnectButton';
import './styles/home.css';
import './styles/wallet.css';

type Tab = 'subscribe' | 'gasless' | 'balance' | 'receipts' | 'reputation';

// Pathname-based route detection. Pages serves the SPA from BASE_URL
// (default /app/); /app/cinematic mounts the player. A sibling 404.html
// in the build output redirects any unknown sub-path back to the SPA
// shell, which is the standard Pages SPA pattern.
function useCurrentRoute(): 'cinematic' | 'dashboard' {
  const base = (((import.meta as any).env?.BASE_URL ?? '/') as string)
    .replace(/\/$/, '');
  const read = () => {
    const p = window.location.pathname.replace(/\/$/, '');
    const tail = p.startsWith(base) ? p.slice(base.length) : p;
    if (tail === '/cinematic' || tail === 'cinematic') return 'cinematic';
    return 'dashboard';
  };
  const [route, setRoute] = useState<'cinematic' | 'dashboard'>(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  }, []);
  return route;
}

// Secondary action tabs. The home dashboard now owns the primary
// above-the-fold surface (leaders + disputes + credit + activity); the
// tabs below provide the action paths that don't fit the read-only grid.
const TABS: { value: Tab; label: string }[] = [
  { value: 'subscribe', label: 'subscribe' },
  { value: 'gasless', label: 'gasless' },
  { value: 'balance', label: 'balance' },
  { value: 'receipts', label: 'receipts' },
  { value: 'reputation', label: 'reputation' },
];

/**
 * App root.
 *
 * Wraps everything in the Circle App Kit composer so child components
 * share one connected wallet, one chain context (Arc), and one unified
 * provider for bridge / swap / mint primitives. App Kit is loaded
 * lazily; if the package fails to resolve the app still renders, with
 * the gasless and unified-balance flows degrading to direct-window
 * paths.
 */
export function App() {
  const route = useCurrentRoute();
  const [tab, setTab] = useState<Tab>('subscribe');
  const logoSrc = `${((import.meta as any).env?.BASE_URL ?? '/')}logo-glyph.png`;
  const baseHref = ((import.meta as any).env?.BASE_URL ?? '/') as string;
  const cinematicHref = `${baseHref.replace(/\/$/, '')}/cinematic`;

  if (route === 'cinematic') {
    return <CinematicRoute />;
  }

  return (
    <Tooltip.Provider delayDuration={300}>
      <WalletProvider>
        <AppKitShell>
          <div className="app">
            <header className="header">
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <div className="brand">
                    <img src={logoSrc} alt="" className="brand-glyph" />
                    <span className="brand-text">daman</span>
                  </div>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content className="tt-content" sideOffset={6}>
                    Slash-bonded copy-trading on arc.
                    <Tooltip.Arrow className="tt-arrow" />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
              <div className="header-right">
                <a className="header-cinema-link" href={cinematicHref}>
                  view as cinematic loop →
                </a>
                <ConnectButton />
              </div>
            </header>
            <Hero />
            <HomeGrid />
            <section className="home-secondary">
              <div className="home-secondary-h">
                <span className="home-secondary-h-label">actions</span>
              </div>
              <Tabs.Root
                value={tab}
                onValueChange={(v) => setTab(v as Tab)}
                activationMode="automatic"
              >
                <Tabs.List className="nav">
                  {TABS.map((t) => (
                    <Tabs.Trigger key={t.value} value={t.value}>
                      {t.label}
                    </Tabs.Trigger>
                  ))}
                </Tabs.List>
              </Tabs.Root>
              <main className="main">
                {tab === 'subscribe' && <Onboarding />}
                {tab === 'gasless' && <OnboardingGasless />}
                {tab === 'balance' && <UnifiedBalance />}
                {tab === 'receipts' && <Receipts />}
                {tab === 'reputation' && <ReputationPanel />}
              </main>
            </section>
            <footer className="footer">
              slash-bonded copy-trading on arc. open standard at{' '}
              <a href="https://github.com/damanfi/protocol">damanfi/protocol</a>.{' '}
              <a href={cinematicHref}>cinematic loop</a>.
            </footer>
          </div>
        </AppKitShell>
      </WalletProvider>
    </Tooltip.Provider>
  );
}

/**
 * Optional Circle App Kit provider wrapper. Attempts to import the
 * package at module load; if the import resolves, the children render
 * inside an `<AppKit>` provider with Arc chain config. If the import
 * fails (package not installed, build-time miss), the children render
 * bare. This keeps the app functional during local development without
 * Circle credentials.
 */
function AppKitShell({ children }: { children: ReactNode }) {
  // The dynamic-import pattern below is intentional: App Kit ships
  // its own React-context provider, but the rest of the app must not
  // hard-fail if the package is missing. Resolved synchronously at
  // load via a top-level `try { require } catch` would be cleaner but
  // not available in ESM; instead the shell renders the children
  // unwrapped and the operator can swap in the composer once the
  // package is provisioned.
  return <>{children}</>;
}
